import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.ts';
import { db, getMaterialsByIds, getRuntimeSettings, recordRunLog } from '../db.ts';
import { getImageProvider } from '../providers/imageProvider.ts';
import { getOutputProvider } from '../providers/outputProvider.ts';

interface QueuedVersionRow {
  id: string;
  card_id: string;
  version_number: number;
  provider: 'mock' | 'cloud';
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
  result_url: string;
  result_kind: string;
}

const activeVersionControllers = new Map<string, AbortController>();
const simulateFailVersions = new Set<string>();
const simulateFailJobs = new Set<string>();

export function markVersionSimulateFail(versionId: string): void {
  simulateFailVersions.add(versionId);
}

export function markJobSimulateFail(jobId: string): void {
  simulateFailJobs.add(jobId);
}

export function enqueueImageVersion(versionId: string): void {
  // Brief queued window (350ms) so cancellation of queued tasks can be tested reliably
  setTimeout(() => {
    void processImageVersion(versionId);
  }, 350);
}

export function enqueueOutputJob(jobId: string): void {
  setTimeout(() => {
    void processOutputJob(jobId);
  }, 400);
}

async function processImageVersion(versionId: string): Promise<void> {
  const now = new Date().toISOString();
  const claim = db
    .prepare(
      `UPDATE card_versions
       SET status = 'running', started_at = ?
       WHERE id = ? AND status = 'queued'`
    )
    .run(now, versionId);

  if (claim.changes === 0) {
    return;
  }

  const row = db
    .prepare(
      `SELECT cv.id, cv.card_id, cv.version_number, cv.provider,
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

  const photoPath = path.join(config.storagePath, 'photos', row.photo_ref);
  if (!fs.existsSync(photoPath) || new Date(row.photo_expires_at).getTime() < Date.now()) {
    finalizeVersionFailure(
      versionId,
      row.provider,
      'PHOTO_EXPIRED',
      '原始照片已过期清理，无法继续生成，请新建创作并重新上传'
    );
    return;
  }

  const controller = new AbortController();
  activeVersionControllers.set(versionId, controller);
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, config.imageTimeoutMs);

  const startedMs = Date.now();
  const runtimeSettings = getRuntimeSettings();

  try {
    const photoBuffer = fs.readFileSync(photoPath);
    const accessoryIds = JSON.parse(row.accessory_ids || '[]') as string[];
    const selectedMaterials = getMaterialsByIds(accessoryIds);
    const provider = getImageProvider(row.provider);
    const shouldFail = simulateFailVersions.delete(versionId);

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
        accessoryIds,
        selectedMaterials,
        strictMaterialConstraint: runtimeSettings.strictMaterialConstraint,
        imageModelTier: runtimeSettings.imageModelTier,
        imageModel: runtimeSettings.imageModel,
        simulateFail: shouldFail,
      },
      controller.signal
    );

    const finishedAt = new Date().toISOString();
    const updated = db
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
        result.resultUrl,
        result.suggestedName ?? null,
        JSON.stringify(result.keywords ?? []),
        result.latencyMs,
        finishedAt,
        versionId
      );

    if (updated.changes > 0) {
      recordRunLog({
        id: `log_${crypto.randomBytes(6).toString('hex')}`,
        kind: 'image',
        provider: row.provider,
        resultKind: result.resultKind,
        status: 'succeeded',
        totalMs: result.latencyMs,
        requestId: result.providerRequestId,
        detail: `card=${row.card_id} v${row.version_number} model=${
          row.provider === 'cloud' ? runtimeSettings.imageModel : 'mock-svg'
        } materials=${selectedMaterials.length}`,
      });
    }
  } catch (err: unknown) {
    const errObj = err as { code?: string; message?: string };
    const code = controller.signal.aborted
      ? 'GENERATION_TIMEOUT'
      : errObj?.code || 'PROVIDER_ERROR';
    const message = controller.signal.aborted
      ? `生图任务超过 ${Math.round(config.imageTimeoutMs / 1000)} 秒硬超时上限`
      : errObj?.message || '形象生成失败';
    finalizeVersionFailure(versionId, row.provider, code, message, Date.now() - startedMs);
  } finally {
    clearTimeout(timeoutTimer);
    activeVersionControllers.delete(versionId);
  }
}

function finalizeVersionFailure(
  versionId: string,
  provider: string,
  errorCode: string,
  errorMessage: string,
  latencyMs?: number
): void {
  const finishedAt = new Date().toISOString();
  const updated = db
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
    recordRunLog({
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
  const claim = db
    .prepare(`UPDATE output_jobs SET status = 'running' WHERE id = ? AND status = 'queued'`)
    .run(jobId);

  if (claim.changes === 0) return;

  const row = db
    .prepare(
      `SELECT oj.id, oj.card_id, oj.card_version_id, oj.paper_size, cv.result_url, cv.result_kind
       FROM output_jobs oj
       JOIN card_versions cv ON cv.id = oj.card_version_id
       WHERE oj.id = ?`
    )
    .get(jobId) as QueuedOutputJobRow | undefined;

  if (!row || !row.result_url) {
    db.prepare(
      `UPDATE output_jobs SET status = 'failed', error_code = 'INVALID_CARD_VERSION', error_message = '关联的生成版本资源不可访问', finished_at = ? WHERE id = ? AND status = 'running'`
    ).run(new Date().toISOString(), jobId);
    return;
  }

  const startedMs = Date.now();
  try {
    const shouldFail = simulateFailJobs.delete(jobId);
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

    db.prepare(
      `UPDATE output_jobs
       SET status = 'succeeded',
           mode = ?,
           physical_executed = ?,
           finished_at = ?
       WHERE id = ? AND status = 'running'`
    ).run(result.mode, result.physicalExecuted ? 1 : 0, new Date().toISOString(), jobId);

    recordRunLog({
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
    db.prepare(
      `UPDATE output_jobs
       SET status = 'failed',
           error_code = ?,
           error_message = ?,
           finished_at = ?
       WHERE id = ? AND status = 'running'`
    ).run(errorCode, errorMessage, new Date().toISOString(), jobId);

    recordRunLog({
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

export function resumeQueuedTasksOnBoot(): { queuedVersions: number; queuedJobs: number } {
  const queuedVersions = db
    .prepare(`SELECT id FROM card_versions WHERE status = 'queued' ORDER BY created_at ASC`)
    .all() as Array<{ id: string }>;

  for (const v of queuedVersions) {
    enqueueImageVersion(v.id);
  }

  const queuedJobs = db
    .prepare(`SELECT id FROM output_jobs WHERE status = 'queued' ORDER BY created_at ASC`)
    .all() as Array<{ id: string }>;

  for (const j of queuedJobs) {
    enqueueOutputJob(j.id);
  }

  return { queuedVersions: queuedVersions.length, queuedJobs: queuedJobs.length };
}

export function startPhotoCleanupTimer(): void {
  const runCleanup = () => {
    const nowIso = new Date().toISOString();
    const expiredCards = db
      .prepare(`SELECT photo_ref FROM cards WHERE photo_expires_at < ?`)
      .all(nowIso) as Array<{ photo_ref: string }>;

    for (const c of expiredCards) {
      const filePath = path.join(config.storagePath, 'photos', c.photo_ref);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Best-effort cleanup
        }
      }
    }
  };

  runCleanup();
  setInterval(runCleanup, 15 * 60 * 1000).unref();
}
