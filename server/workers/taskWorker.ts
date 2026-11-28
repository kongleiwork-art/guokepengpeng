import crypto from 'node:crypto';
import { config, isPhotoMbtiEnabled } from '../config.ts';
import {
  db, getMaterialsByIds, getRuntimeSettings, listCreationMaterials, recordRunLog, selectMaterialPlan,
  type MaterialRecord, type RuntimeSettings,
} from '../db.ts';
import { getImageProvider, saveGeneratedAsset, type DollBrief } from '../providers/imageProvider.ts';
import { materialReviewUnavailable, verifyGeneratedMaterials } from '../providers/materialReview.ts';
import { getOutputProvider } from '../providers/outputProvider.ts';
import { deleteMedia, readMedia } from '../mediaStore.ts';
import { publishTask, TASK_VISIBILITY_TIMEOUT_SECONDS, type Task } from './taskQueue.ts';

export type ImageSettings = Pick<RuntimeSettings, 'imageVendor' | 'imageModel' | 'imageModelTier' | 'strictMaterialConstraint'> &
  DollBrief & { materialPlan?: MaterialRecord[] };

interface QueuedVersionRow {
  id: string;
  card_id: string;
  version_number: number;
  provider: 'mock' | 'cloud';
  image_settings: string | null;
  simulate_fail: number;
  photo_ref: string;
  photo_mime: string;
  photo_expires_at: string;
  user_nickname: string;
  persona_id: string;
  accessory_ids: string;
  persona_name: string;
  persona_mbti: string;
  persona_material_hint: string;
  persona_visual_trait: string;
}

interface QueuedOutputJobRow {
  id: string;
  card_id: string;
  card_version_id: string;
  paper_size: string;
  simulate_fail: number;
  result_url: string;
  result_kind: string;
}

export function snapshotImageSettings({
  imageVendor, imageModel, imageModelTier, strictMaterialConstraint, photoStyle, dollDesign, materialPlan,
}: ImageSettings): string {
  return JSON.stringify({ imageVendor, imageModel, imageModelTier, strictMaterialConstraint, photoStyle, dollDesign, materialPlan });
}

async function enqueueTask(kind: 'image' | 'output', id: string): Promise<void> {
  if (!config.isVercel) {
    setTimeout(() => {
      void processTask({ kind, id }).catch((error) => {
        console.error('[worker] failed to complete local task', kind, id, error);
      });
    }, 350);
    return;
  }

  const table = kind === 'image' ? 'card_versions' : 'output_jobs';
  const needsDispatch = await db.prepare(
    `SELECT 1 FROM ${table} WHERE id = ? AND status = 'queued' AND dispatched_at IS NULL`
  ).get(id);
  if (!needsDispatch) return;

  try {
    await publishTask({ kind, id });
    await db.prepare(`UPDATE ${table} SET dispatched_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  } catch (error) {
    console.error('[worker] queue dispatch failed', kind, id, (error as { code?: string }).code);
    throw Object.assign(new Error('暂时无法提交任务，请重试原请求'), { status: 503, code: 'QUEUE_UNAVAILABLE' });
  }
}

export function enqueueImageVersion(id: string) {
  return enqueueTask('image', id);
}

export function enqueueOutputJob(id: string) {
  return enqueueTask('output', id);
}

export async function schedulePhotoCleanup(filename: string) {
  if (config.isVercel) await publishTask({ kind: 'expire-photo', id: filename }, config.photoTtlHours * 3600);
}

export async function processTask(task: Task): Promise<void> {
  if (task.kind === 'image') return processImageVersion(task.id);
  if (task.kind === 'output') return processOutputJob(task.id);
  if (task.kind === 'expire-photo' && /^card_[0-9a-f]+\.(jpeg|jpg|png|webp)$/.test(task.id)) {
    await deleteMedia(`photos/${task.id}`);
  }
}

async function recoverInterruptedTask(kind: 'image' | 'output', id: string): Promise<void> {
  if (!config.isVercel) return;
  const table = kind === 'image' ? 'card_versions' : 'output_jobs';
  const staleBefore = new Date(Date.now() - TASK_VISIBILITY_TIMEOUT_SECONDS * 1000).toISOString();
  await db.prepare(
    `UPDATE ${table} SET status = 'failed', finished_at = ?, error_code = ?, error_message = ?
     WHERE id = ? AND status = 'running' AND started_at < ?`
  ).run(
    new Date().toISOString(),
    kind === 'image' ? 'GENERATION_STATUS_UNKNOWN' : 'WORKER_INTERRUPTED',
    kind === 'image' ? '生图任务状态未能确认，请先在服务商控制台核对结果与费用' : '模拟出图任务中断，请重新提交',
    id,
    staleBefore,
  );
  if (await db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND status = 'running'`).get(id)) {
    throw new Error('Task claim is still active');
  }
}

async function processImageVersion(versionId: string): Promise<void> {
  const now = new Date().toISOString();
  const claim = await db
    .prepare(
      `UPDATE card_versions
       SET status = 'running', started_at = ?
       WHERE id = ? AND status = 'queued'`
    )
    .run(now, versionId);

  if (claim.changes === 0) return recoverInterruptedTask('image', versionId);

  const row = await db
    .prepare(
      `SELECT cv.id, cv.card_id, cv.version_number, cv.provider, cv.image_settings, cv.simulate_fail,
              c.photo_ref, c.photo_mime, c.photo_expires_at, c.user_nickname, c.persona_id, c.accessory_ids,
              p.name AS persona_name, p.mbti AS persona_mbti, p.material_hint AS persona_material_hint,
              p.visual_trait AS persona_visual_trait
       FROM card_versions cv
       JOIN cards c ON c.id = cv.card_id
       JOIN personas p ON p.id = c.persona_id
       WHERE cv.id = ?`
    )
    .get(versionId) as QueuedVersionRow | undefined;

  if (!row) return;

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), config.imageTimeoutMs);
  const startedMs = Date.now();

  try {
    if (!config.imageGenerationEnabled) {
      await finalizeVersionFailure(versionId, row.provider, 'CREATION_CLOSED', '照片定制和生图暂未开放');
      return;
    }
    const photoBuffer = Date.parse(row.photo_expires_at) > Date.now()
      ? await readMedia(`photos/${row.photo_ref}`)
      : null;
    if (!photoBuffer) {
      await finalizeVersionFailure(versionId, row.provider, 'PHOTO_EXPIRED', '原始照片已过期，请重新上传');
      return;
    }
    const accessoryIds = JSON.parse(row.accessory_ids || '[]') as string[];
    const runtimeSettings: ImageSettings = row.image_settings
      ? JSON.parse(row.image_settings)
      : await getRuntimeSettings();
    const useExactMaterialReferences = runtimeSettings.strictMaterialConstraint || Boolean(runtimeSettings.materialPlan);
    const selectedMaterials = useExactMaterialReferences
      ? selectMaterialPlan(accessoryIds, runtimeSettings.materialPlan ?? await listCreationMaterials(true))
      : await getMaterialsByIds(accessoryIds);
    if (!selectedMaterials) {
      await finalizeVersionFailure(versionId, row.provider, 'MATERIAL_SELECTION_REQUIRED', '请重新定制并选择有参考图的材料');
      return;
    }
    const canReviewMaterials = isPhotoMbtiEnabled();
    const shouldReviewMaterials = useExactMaterialReferences && row.provider === 'cloud' && (config.isVercel || canReviewMaterials);
    if (shouldReviewMaterials && !canReviewMaterials) throw materialReviewUnavailable();
    const provider = getImageProvider(row.provider, runtimeSettings.imageVendor);
    const shouldFail = row.simulate_fail === 1;
    controller.signal.throwIfAborted();

    const result = await provider.generate(
      {
        cardId: row.card_id,
        versionId: row.id,
        versionNumber: row.version_number,
        photoBuffer,
        photoMime: row.photo_mime,
        userNickname: row.user_nickname,
        personaId: row.persona_id,
        personaName: row.persona_name,
        personaMbti: row.persona_mbti,
        personaMaterialHint: row.persona_material_hint,
        personaVisualTrait: row.persona_visual_trait,
        photoStyle: runtimeSettings.photoStyle,
        dollDesign: runtimeSettings.dollDesign,
        accessoryIds,
        selectedMaterials,
        useExactMaterialReferences,
        strictMaterialConstraint: runtimeSettings.strictMaterialConstraint,
        imageModelTier: runtimeSettings.imageModelTier,
        imageModel: runtimeSettings.imageModel,
        simulateFail: shouldFail,
      },
      controller.signal
    );
    clearTimeout(timeoutTimer);

    let resultUrl: string;
    if (result.resultKind === 'generated') {
      if (shouldReviewMaterials) await verifyGeneratedMaterials(result.image, selectedMaterials, runtimeSettings.dollDesign);
      const { ext, bytes, mimeType } = result.image;
      resultUrl = await saveGeneratedAsset(versionId, ext, bytes, mimeType);
    } else {
      resultUrl = result.resultUrl;
    }

    const finishedAt = new Date().toISOString();
    const latencyMs = Date.now() - startedMs;
    const updated = await db
      .prepare(
        `UPDATE card_versions
         SET status = 'succeeded',
             provider_request_id = ?,
             result_kind = ?,
             result_url = ?,
             suggested_name = ?,
             keywords = ?,
             latency_ms = ?,
             finished_at = ?
         WHERE id = ? AND status = 'running'`
      )
      .run(
        result.providerRequestId,
        result.resultKind,
        resultUrl,
        result.suggestedName ?? null,
        JSON.stringify(result.keywords ?? []),
        latencyMs,
        finishedAt,
        versionId
      );

    if (updated.changes > 0) {
      await recordRunLog({
        id: `log_${crypto.randomBytes(6).toString('hex')}`,
        kind: 'image',
        provider: row.provider,
        resultKind: result.resultKind,
        status: 'succeeded',
        totalMs: latencyMs,
        requestId: result.providerRequestId,
        detail: `card=${row.card_id} v${row.version_number} model=${
          row.provider === 'cloud' ? runtimeSettings.imageModel : 'mock-svg'
        } materials=${selectedMaterials.length}`,
      });
    }
  } catch (err: unknown) {
    const errObj = err as { code?: string; message?: string };
    const code = controller.signal.aborted && row.provider === 'cloud'
      ? 'GENERATION_STATUS_UNKNOWN'
      : errObj?.code || 'PROVIDER_ERROR';
    const message = code === 'GENERATION_STATUS_UNKNOWN'
      ? '生图任务状态未能确认，请先在服务商控制台核对结果与费用'
      : errObj?.message || '形象生成失败';
    await finalizeVersionFailure(versionId, row.provider, code, message, Date.now() - startedMs);
  } finally {
    clearTimeout(timeoutTimer);
  }
}

async function finalizeVersionFailure(
  versionId: string,
  provider: string,
  errorCode: string,
  errorMessage: string,
  latencyMs?: number
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const updated = await db
    .prepare(
      `UPDATE card_versions
       SET status = 'failed',
           error_code = ?,
           error_message = ?,
           latency_ms = COALESCE(?, latency_ms),
           finished_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(errorCode, errorMessage, latencyMs ?? null, finishedAt, versionId);

  if (updated.changes > 0) {
    await recordRunLog({
      id: `log_${crypto.randomBytes(6).toString('hex')}`,
      kind: 'image',
      provider,
      resultKind: provider === 'cloud' ? 'generated' : 'mock',
      status: 'failed',
      totalMs: latencyMs ?? null,
      errorCode,
      detail: errorMessage,
    });
  }
}

async function processOutputJob(jobId: string): Promise<void> {
  const claim = await db
    .prepare(`UPDATE output_jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`)
    .run(new Date().toISOString(), jobId);

  if (claim.changes === 0) return recoverInterruptedTask('output', jobId);

  const row = await db
    .prepare(
      `SELECT oj.id, oj.card_id, oj.card_version_id, oj.paper_size, oj.simulate_fail, cv.result_url, cv.result_kind
       FROM output_jobs oj
       JOIN card_versions cv ON cv.id = oj.card_version_id
       WHERE oj.id = ?`
    )
    .get(jobId) as QueuedOutputJobRow | undefined;

  if (!row || !row.result_url) {
    await db.prepare(
      `UPDATE output_jobs SET status = 'failed', error_code = 'INVALID_CARD_VERSION', error_message = '关联的生成版本资源不可访问', finished_at = ? WHERE id = ? AND status = 'running'`
    ).run(new Date().toISOString(), jobId);
    return;
  }

  const startedMs = Date.now();
  try {
    const shouldFail = row.simulate_fail === 1;
    const provider = getOutputProvider();
    const result = await provider.execute({
      jobId: row.id,
      cardId: row.card_id,
      cardVersionId: row.card_version_id,
      resultUrl: row.result_url,
      resultKind: row.result_kind,
      paperSize: row.paper_size,
      simulateFail: shouldFail,
    });

    await db.prepare(
      `UPDATE output_jobs
       SET status = 'succeeded',
           mode = ?,
           physical_executed = ?,
           finished_at = ?
       WHERE id = ? AND status = 'running'`
    ).run(result.mode, result.physicalExecuted ? 1 : 0, new Date().toISOString(), jobId);

    await recordRunLog({
      id: `log_${crypto.randomBytes(6).toString('hex')}`,
      kind: 'output',
      provider: result.mode,
      resultKind: 'mock',
      status: 'succeeded',
      totalMs: Date.now() - startedMs,
      detail: result.artifactNote,
    });
  } catch (err: unknown) {
    const errObj = err as { code?: string; message?: string };
    const errorCode = errObj?.code || 'PROVIDER_ERROR';
    const errorMessage = errObj?.message || '模拟出图执行失败';
    await db.prepare(
      `UPDATE output_jobs
       SET status = 'failed',
           error_code = ?,
           error_message = ?,
           finished_at = ?
       WHERE id = ? AND status = 'running'`
    ).run(errorCode, errorMessage, new Date().toISOString(), jobId);

    await recordRunLog({
      id: `log_${crypto.randomBytes(6).toString('hex')}`,
      kind: 'output',
      provider: 'mock',
      resultKind: 'mock',
      status: 'failed',
      totalMs: Date.now() - startedMs,
      errorCode,
      detail: errorMessage,
    });
  }
}

export async function resumeQueuedTasksOnBoot(): Promise<{ queuedVersions: number; queuedJobs: number }> {
  const queuedVersions = await db
    .prepare(`SELECT id FROM card_versions WHERE status = 'queued' ORDER BY created_at ASC`)
    .all() as Array<{ id: string }>;

  for (const v of queuedVersions) {
    await enqueueImageVersion(v.id);
  }

  const queuedJobs = await db
    .prepare(`SELECT id FROM output_jobs WHERE status = 'queued' ORDER BY created_at ASC`)
    .all() as Array<{ id: string }>;

  for (const j of queuedJobs) {
    await enqueueOutputJob(j.id);
  }

  return { queuedVersions: queuedVersions.length, queuedJobs: queuedJobs.length };
}

export function startPhotoCleanupTimer(): void {
  const runCleanup = async () => {
    const nowIso = new Date().toISOString();
    const expiredCards = await db
      .prepare(`SELECT photo_ref FROM cards WHERE photo_expires_at < ?`)
      .all(nowIso) as Array<{ photo_ref: string }>;
    for (const card of expiredCards) await deleteMedia(`photos/${card.photo_ref}`);
  };
  const cleanup = () => {
    void runCleanup().catch((error) => console.error('[worker] photo cleanup failed', error));
  };
  cleanup();
  setInterval(cleanup, 15 * 60 * 1000).unref();
}
