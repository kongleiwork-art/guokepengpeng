import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import {
  buildPublicBaseUrl,
  config,
  IMAGE_MODELS,
  IMAGE_TIER_LABELS,
  isChatCloudConfigured,
  isImageCloudConfigured,
  nfcWriteScope,
  validatePublicBaseUrl,
  type ImageModelTier,
  type ProviderMode,
} from '../config.ts';
import {
  FALLBACK_TEMPLATES,
  MATERIAL_CATEGORY_LABELS,
  type MaterialCategory,
} from '../data/seed.ts';
import {
  db,
  getMaterialsByIds,
  getRuntimeSettings,
  listMaterials,
  recordRunLog,
  setRuntimeSetting,
} from '../db.ts';
import {
  clearSessionCookie,
  createNewSession,
  ensureSession,
  extractVisitorKey,
  loadExistingSession,
  loadSessionById,
  requireAdmin,
  sendError,
  sendSuccess,
  setSessionCookie,
} from '../middleware/session.ts';
import { getChatProvider } from '../providers/chatProvider.ts';
import { recommendMbti, type MbtiQuizAnswers } from '../providers/mbtiAnalyzer.ts';
import {
  runMbtiGuideTurn,
  type CognitiveFunctionScores,
  type MbtiGuideHistoryItem,
} from '../providers/mbtiGuideEngine.ts';
import { validateImageBuffer } from '../utils/imageValidation.ts';
import { deleteMedia, mediaExists, openMedia, writeMedia, type MediaKey } from '../mediaStore.ts';
import { findNfcTarget } from '../nfc.ts';
import {
  enqueueImageVersion,
  enqueueOutputJob,
  schedulePhotoCleanup,
  snapshotImageSettings,
} from '../workers/taskWorker.ts';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
    fields: 10,
  },
});

const uploadPhoto: express.RequestHandler = (req, res, next) => {
  upload.single('photo')(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    sendError(req, res, tooLarge ? 413 : 400, tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_INPUT',
      tooLarge ? '图片体积超过限制（最大 2 MB）' : '照片上传格式无效');
  });
};

const VALID_MATERIAL_CATEGORIES = new Set<MaterialCategory>([
  'nut_body',
  'yarn_hair',
  'fabric_outfit',
  'hardware_charm',
  'dried_botanical',
]);

function hashObject(obj: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function getLiveBaseUrl(req: express.Request): Promise<string> {
  const settings = await getRuntimeSettings();
  return buildPublicBaseUrl(req, settings.nfcPublicBaseUrl);
}

async function resolveMaterialLabels(ids: string[]): Promise<string[]> {
  const mats = await getMaterialsByIds(ids);
  if (mats.length > 0) return mats.map((m) => m.label);
  return [];
}

async function checkIdempotency<T = unknown>(
  sessionId: string,
  operation: string,
  key: string | undefined,
  requestHash: string
):
  Promise<| { hit: false }
  | { hit: true; conflict: true }
  | { hit: true; conflict: false; status: number; body: T }> {
  if (!key || !key.trim()) return { hit: false };
  const row = await db
    .prepare(
      `SELECT request_hash, response_status, response_body
       FROM idempotency_keys
       WHERE session_id = ? AND operation = ? AND idempotency_key = ?`
    )
    .get(sessionId, operation, key.trim()) as
    | { request_hash: string; response_status: number; response_body: string }
    | undefined;

  if (!row) return { hit: false };
  if (row.request_hash !== requestHash) {
    return { hit: true, conflict: true };
  }
  return {
    hit: true,
    conflict: false,
    status: row.response_status,
    body: JSON.parse(row.response_body),
  };
}

async function saveIdempotency(
  sessionId: string,
  operation: string,
  key: string | undefined,
  requestHash: string,
  status: number,
  body: unknown
): Promise<void> {
  if (!key || !key.trim()) return;
  await db.prepare(
    `INSERT OR IGNORE INTO idempotency_keys (session_id, operation, idempotency_key, request_hash, response_status, response_body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    operation,
    key.trim(),
    requestHash,
    status,
    JSON.stringify(body),
    new Date().toISOString()
  );
}

async function persistTask<T>(
  sessionId: string,
  operation: string,
  key: string | undefined,
  requestHash: string,
  create: () => Promise<T>,
): Promise<T> {
  return db.transaction(async () => {
    const cached = await checkIdempotency<T>(sessionId, operation, key, requestHash);
    if (cached.hit) {
      if (cached.conflict) {
        throw Object.assign(new Error('相同幂等键提交了不同的任务参数'), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
      }
      return cached.body;
    }
    const body = await create();
    await saveIdempotency(sessionId, operation, key, requestHash, 202, body);
    return body;
  })();
}

async function recoverQueuedDelivery(kind: 'image' | 'output', row: Record<string, unknown>) {
  if (!config.isVercel || row.status !== 'queued' || row.dispatched_at) return;
  const enqueue = kind === 'image' ? enqueueImageVersion : enqueueOutputJob;
  await enqueue(String(row.id)).catch(() => {
    // The next poll or the original idempotent retry can dispatch it again.
  });
}

function extractIdempotencyKey(req: express.Request): string | undefined {
  const h = req.get('idempotency-key') || req.get('x-idempotency-key');
  if (h && h.trim()) return h.trim();
  if (typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()) {
    return req.body.idempotencyKey.trim();
  }
  return undefined;
}

function formatCardVersion(row: Record<string, unknown>) {
  return {
    id: row.id,
    cardId: row.card_id,
    versionNumber: row.version_number,
    status: row.status,
    provider: row.provider,
    providerRequestId: row.provider_request_id ?? null,
    resultKind: row.result_kind,
    resultUrl: row.result_url ?? null,
    suggestedName: row.suggested_name ?? null,
    keywords: row.keywords ? JSON.parse(String(row.keywords)) : [],
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    latencyMs: row.latency_ms ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    createdAt: row.created_at,
  };
}

async function generateQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    width: 220,
    color: {
      dark: '#1F2421',
      light: '#FFFFFF',
    },
  });
}

// ============================================================
// 1. Health, Session & Cross-Browser Claim Code Sync
// ============================================================
router.get('/health', (_req, res) => {
  sendSuccess(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

router.post('/session', async (req, res) => {
  const visitorKey = extractVisitorKey(req);
  let session = await loadExistingSession(req);
  if (!session) {
    session = await createNewSession(visitorKey);
  }
  setSessionCookie(req, res, session);
  sendSuccess(res, {
    sessionId: session.id,
    isDemo: session.isDemo,
    expiresAt: session.expiresAt,
  });
});

function generateClaimCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

router.post('/session/claim-code', ensureSession, async (req, res) => {
  const sessionId = req.session!.id;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

  // Clean up expired codes opportunistically
  await db.prepare(`DELETE FROM session_claim_codes WHERE expires_at < ?`).run(now.toISOString());

  let code = generateClaimCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await db.prepare(`SELECT code FROM session_claim_codes WHERE code = ?`).get(code);
    if (!exists) break;
    code = generateClaimCode();
  }

  await db.prepare(
    `INSERT INTO session_claim_codes (code, session_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(code, sessionId, expiresAt, now.toISOString());

  sendSuccess(res, {
    code,
    expiresAt,
    sessionId,
  });
});

router.post('/session/claim', async (req, res) => {
  const rawCode = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6}$/.test(rawCode)) {
    sendError(req, res, 400, 'INVALID_INPUT', '请输入有效的 6 位记忆口令');
    return;
  }

  const row = await db
    .prepare(`SELECT code, session_id, expires_at FROM session_claim_codes WHERE code = ?`)
    .get(rawCode) as { code: string; session_id: string; expires_at: string } | undefined;

  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    sendError(req, res, 404, 'CLAIM_CODE_EXPIRED', '该记忆口令不存在或已过期，请重新生成');
    return;
  }

  const targetSession = await loadSessionById(row.session_id);
  if (!targetSession) {
    sendError(req, res, 404, 'NOT_FOUND', '对应记忆档案已失效');
    return;
  }

  const visitorKey = extractVisitorKey(req);
  if (visitorKey) {
    await db.prepare(`UPDATE sessions SET visitor_key = ? WHERE id = ?`).run(visitorKey, targetSession.id);
    targetSession.visitorKey = visitorKey;
  }
  setSessionCookie(req, res, targetSession);

  sendSuccess(res, {
    sessionId: targetSession.id,
    expiresAt: targetSession.expiresAt,
    synced: true,
  });
});

// ============================================================
// 2. Personas, Materials, Templates & MBTI Analyzer
// ============================================================
router.get('/personas', ensureSession, async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, name, mbti, mbti_group, cognitive_axis, tagline, material_hint,
              speech_style, visual_trait, recommended_materials, opening_line, featured
       FROM personas
       ORDER BY featured DESC, mbti ASC`
    )
    .all() as Array<Record<string, unknown>>;

  sendSuccess(
    res,
    rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      mbti: String(r.mbti),
      mbtiGroup: String(r.mbti_group || 'NF'),
      cognitiveAxis: String(r.cognitive_axis || ''),
      tagline: String(r.tagline),
      materialHint: String(r.material_hint),
      speechStyle: String(r.speech_style || ''),
      visualTrait: String(r.visual_trait || ''),
      recommendedMaterials: r.recommended_materials
        ? (JSON.parse(String(r.recommended_materials)) as string[])
        : [],
      openingLine: String(r.opening_line),
      featured: Number(r.featured) === 1,
    }))
  );
});

router.get('/accessories', ensureSession, async (_req, res) => {
  const inStockMaterials = await listMaterials(true);
  sendSuccess(
    res,
    inStockMaterials.map((m) => ({
      id: m.id,
      label: m.label,
      category: m.category,
      categoryLabel: MATERIAL_CATEGORY_LABELS[m.category] || '手作材料',
      material: m.material,
      visualHint: m.visualHint,
      inStock: m.inStock,
    }))
  );
});

router.get('/materials', ensureSession, async (_req, res) => {
  const inStockMaterials = await listMaterials(true);
  sendSuccess(res, {
    categories: MATERIAL_CATEGORY_LABELS,
    items: inStockMaterials,
  });
});

router.get('/templates', ensureSession, (_req, res) => {
  sendSuccess(res, FALLBACK_TEMPLATES);
});

router.post('/mbti/recommend', ensureSession, uploadPhoto, async (req, res) => {
  let photoBuffer: Buffer | undefined;
  let photoMime: string | undefined;
  if (req.file?.buffer) {
    try {
      const validated = validateImageBuffer(req.file.buffer);
      photoBuffer = req.file.buffer;
      photoMime = validated.mimeType;
    } catch (err: unknown) {
      const e = err as { status?: number; code?: string; message?: string };
      sendError(req, res, e.status || 400, e.code || 'UNSUPPORTED_IMAGE', e.message || '图片校验失败');
      return;
    }
  }

  let quizAnswers: MbtiQuizAnswers | undefined;
  if (typeof req.body?.quizAnswers === 'string' && req.body.quizAnswers.trim()) {
    try {
      const parsed = JSON.parse(req.body.quizAnswers);
      if (parsed && typeof parsed === 'object') {
        quizAnswers = {
          energy: parsed.energy === 'E' || parsed.energy === 'I' ? parsed.energy : undefined,
          perception: parsed.perception === 'S' || parsed.perception === 'N' ? parsed.perception : undefined,
          judgment: parsed.judgment === 'T' || parsed.judgment === 'F' ? parsed.judgment : undefined,
          lifestyle: parsed.lifestyle === 'J' || parsed.lifestyle === 'P' ? parsed.lifestyle : undefined,
        };
      }
    } catch {
      // Ignore malformed optional quiz payload
    }
  } else if (req.body?.quizAnswers && typeof req.body.quizAnswers === 'object') {
    const parsed = req.body.quizAnswers;
    quizAnswers = {
      energy: parsed.energy === 'E' || parsed.energy === 'I' ? parsed.energy : undefined,
      perception: parsed.perception === 'S' || parsed.perception === 'N' ? parsed.perception : undefined,
      judgment: parsed.judgment === 'T' || parsed.judgment === 'F' ? parsed.judgment : undefined,
      lifestyle: parsed.lifestyle === 'J' || parsed.lifestyle === 'P' ? parsed.lifestyle : undefined,
    };
  }

  try {
    const settings = await getRuntimeSettings();
    const inStockMaterials = await listMaterials(true);
    const result = await recommendMbti({
      photoBuffer,
      photoMime,
      quizAnswers,
      providerMode: settings.chatProviderMode,
      inStockMaterials,
    });
    sendSuccess(res, result);
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    sendError(
      req,
      res,
      e.status || 502,
      e.code || 'PROVIDER_ERROR',
      e.message || 'MBTI 人格推荐分析失败，请稍后重试'
    );
  }
});

router.post('/mbti/guide/turn', ensureSession, async (req, res) => {
  try {
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const history: MbtiGuideHistoryItem[] = rawHistory
      .slice(0, 12)
      .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item: Record<string, unknown>) => ({
        questionId: typeof item.questionId === 'string' ? item.questionId.slice(0, 80) : 'q',
        questionPrompt: typeof item.questionPrompt === 'string' ? item.questionPrompt.slice(0, 400) : '',
        userAnswer: typeof item.userAnswer === 'string' ? item.userAnswer.slice(0, 600) : '',
        selectedOptionId:
          typeof item.selectedOptionId === 'string' ? item.selectedOptionId.slice(0, 80) : undefined,
        optionWeights:
          item.optionWeights && typeof item.optionWeights === 'object'
            ? (item.optionWeights as Partial<CognitiveFunctionScores>)
            : undefined,
      }));

    const rawScores =
      req.body?.rawScores && typeof req.body.rawScores === 'object'
        ? (req.body.rawScores as Partial<CognitiveFunctionScores>)
        : undefined;
    const maxRounds =
      typeof req.body?.maxRounds === 'number' && Number.isFinite(req.body.maxRounds)
        ? Math.max(4, Math.min(8, Math.round(req.body.maxRounds)))
        : 5;
    const forceConclude = Boolean(req.body?.forceConclude);

    const settings = await getRuntimeSettings();
    const inStockMaterials = await listMaterials(true);
    const result = await runMbtiGuideTurn({
      history,
      rawScores,
      maxRounds,
      forceConclude,
      providerMode: settings.chatProviderMode,
      inStockMaterials,
    });
    sendSuccess(res, result);
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    sendError(
      req,
      res,
      e.status || 502,
      e.code || 'PROVIDER_ERROR',
      e.message || 'AI 人格引导分析失败，请稍后重试'
    );
  }
});

// ============================================================
// 3. NFC Tag Short Alias Resolution
// ============================================================
router.get('/nfc/resolve/:alias', async (req, res) => {
  const tag = await findNfcTarget(req.params.alias);
  if (tag) sendSuccess(res, tag);
  else sendError(req, res, 404, 'NOT_FOUND', '未找到对应的 NFC 果壳标签映射');
});

// ============================================================
// 4. Dolls (Demo + Session Personal)
// ============================================================
router.get('/dolls', ensureSession, async (req, res) => {
  const sessionId = req.session!.id;
  const baseUrl = await getLiveBaseUrl(req);

  const rows = await db
    .prepare(
      `SELECT d.id, d.kind, d.name, d.avatar_url, d.card_id, d.card_version_id, d.created_at,
              p.id AS persona_id, p.name AS persona_name, p.mbti AS persona_mbti,
              p.mbti_group AS persona_mbti_group, p.cognitive_axis AS persona_cognitive_axis,
              p.tagline AS persona_tagline, p.material_hint AS persona_material_hint,
              p.opening_line AS persona_opening_line,
              (SELECT alias FROM nfc_tags nt WHERE nt.doll_id = d.id LIMIT 1) AS nfc_alias
       FROM dolls d
       JOIN personas p ON p.id = d.persona_id
       WHERE d.kind = 'demo' OR d.owner_session_id = ?
       ORDER BY CASE WHEN d.kind = 'demo' THEN 0 ELSE 1 END, d.created_at DESC`
    )
    .all(sessionId) as Array<Record<string, unknown>>;

  sendSuccess(
    res,
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      avatarUrl: r.avatar_url,
      cardId: r.card_id ?? null,
      cardVersionId: r.card_version_id ?? null,
      dollUrl: `${baseUrl}/d/${r.id}`,
      nfcUrl: r.nfc_alias ? `${baseUrl}/nfc/${r.nfc_alias}` : `${baseUrl}/nfc/${r.id}`,
      nfcAlias: r.nfc_alias ?? null,
      createdAt: r.created_at,
      persona: {
        id: r.persona_id,
        name: r.persona_name,
        mbti: r.persona_mbti,
        mbtiGroup: r.persona_mbti_group,
        cognitiveAxis: r.persona_cognitive_axis,
        tagline: r.persona_tagline,
        materialHint: r.persona_material_hint,
        openingLine: r.persona_opening_line,
      },
    }))
  );
});

router.get('/dolls/:id', ensureSession, async (req, res) => {
  const dollId = req.params.id;
  const settings = await getRuntimeSettings();
  const baseUrl = buildPublicBaseUrl(req, settings.nfcPublicBaseUrl);

  const row = await db
    .prepare(
      `SELECT d.id, d.kind, d.owner_session_id, d.name, d.avatar_url, d.card_id, d.card_version_id, d.created_at,
              p.id AS persona_id, p.name AS persona_name, p.mbti AS persona_mbti,
              p.mbti_group AS persona_mbti_group, p.cognitive_axis AS persona_cognitive_axis,
              p.speech_style AS persona_speech_style,
              p.tagline AS persona_tagline, p.material_hint AS persona_material_hint,
              p.opening_line AS persona_opening_line,
              (SELECT alias FROM nfc_tags nt WHERE nt.doll_id = d.id LIMIT 1) AS nfc_alias
       FROM dolls d
       JOIN personas p ON p.id = d.persona_id
       WHERE d.id = ?`
    )
    .get(dollId) as Record<string, unknown> | undefined;

  if (!row) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的娃娃档案');
    return;
  }

  const dollUrl = `${baseUrl}/d/${row.id}`;
  const nfcUrl = `${baseUrl}/nfc/${encodeURIComponent(String(row.nfc_alias || row.id))}`;
  const isOwner = row.kind === 'personal' && row.owner_session_id === req.session!.id;
  const qrSvg = await generateQrSvg(nfcUrl);

  sendSuccess(res, {
    id: row.id,
    kind: row.kind,
    name: row.name,
    avatarUrl: row.avatar_url,
    dollUrl,
    nfcUrl,
    nfcAlias: row.nfc_alias ?? null,
    nfcWriteScope: nfcWriteScope(settings.nfcPublicBaseUrl),
    qrData: nfcUrl,
    qrSvg,
    isOwner,
    cardUrl: isOwner && row.card_id ? `${baseUrl}/card/${row.card_id}` : null,
    cardId: isOwner ? row.card_id : null,
    createdAt: row.created_at,
    persona: {
      id: row.persona_id,
      name: row.persona_name,
      mbti: row.persona_mbti,
      mbtiGroup: row.persona_mbti_group,
      cognitiveAxis: row.persona_cognitive_axis,
      speechStyle: row.persona_speech_style,
      tagline: row.persona_tagline,
      materialHint: row.persona_material_hint,
      openingLine: row.persona_opening_line,
    },
  });
});

router.patch('/dolls/:id', ensureSession, async (req, res) => {
  const dollId = req.params.id;
  const sessionId = req.session!.id;
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

  if (!rawName || rawName.length > 32) {
    sendError(req, res, 400, 'VALIDATION_ERROR', '名称长度需在 1 到 32 个字符之间');
    return;
  }

  const row = await db
    .prepare(`SELECT id, kind, owner_session_id FROM dolls WHERE id = ?`)
    .get(dollId) as { id: string; kind: string; owner_session_id: string | null } | undefined;

  if (!row) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的娃娃档案');
    return;
  }

  if (row.kind !== 'personal' || row.owner_session_id !== sessionId) {
    sendError(req, res, 403, 'FORBIDDEN', '仅可重命名当前会话绑定的个人娃娃');
    return;
  }

  await db.prepare(`UPDATE dolls SET name = ? WHERE id = ?`).run(rawName, dollId);
  await db.prepare(
    `UPDATE memories
     SET value = ?
     WHERE doll_id = ? AND session_id = ? AND type = 'doll_name'`
  ).run(rawName, dollId, sessionId);

  sendSuccess(res, { id: dollId, name: rawName });
});

// ============================================================
// 5. Messages & Streaming Chat (SSE)
// ============================================================
router.get('/dolls/:id/messages', ensureSession, async (req, res) => {
  const dollId = req.params.id;
  const sessionId = req.session!.id;

  const dollExists = await db.prepare(`SELECT id FROM dolls WHERE id = ?`).get(dollId);
  if (!dollExists) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的娃娃');
    return;
  }

  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim() ? req.query.cursor.trim() : null;

  let rows: Array<Record<string, unknown>>;
  if (cursor) {
    rows = await db
      .prepare(
        `SELECT id, client_message_id, reply_attempt, role, content, status, provider, first_token_ms, total_ms, error_code, created_at
         FROM messages
         WHERE session_id = ? AND doll_id = ? AND created_at < ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(sessionId, dollId, cursor, limit) as Array<Record<string, unknown>>;
  } else {
    rows = await db
      .prepare(
        `SELECT id, client_message_id, reply_attempt, role, content, status, provider, first_token_ms, total_ms, error_code, created_at
         FROM messages
         WHERE session_id = ? AND doll_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(sessionId, dollId, limit) as Array<Record<string, unknown>>;
  }

  rows.reverse();

  sendSuccess(res, {
    items: rows.map((r) => ({
      id: r.id,
      clientMessageId: r.client_message_id,
      replyAttempt: r.reply_attempt,
      role: r.role,
      content: r.content,
      status: r.status,
      provider: r.provider ?? null,
      firstTokenMs: r.first_token_ms ?? null,
      totalMs: r.total_ms ?? null,
      errorCode: r.error_code ?? null,
      createdAt: r.created_at,
    })),
    nextCursor: rows.length === limit ? rows[0].created_at : null,
  });
});

function writeSseEvent(res: express.Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.post('/dolls/:id/chat', ensureSession, async (req, res) => {
  const dollId = req.params.id;
  const sessionId = req.session!.id;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const clientMessageId =
    typeof req.body?.clientMessageId === 'string' ? req.body.clientMessageId.trim() : '';
  const explicitRemember =
    typeof req.body?.rememberText === 'string' ? req.body.rememberText.trim() : '';

  if (!text || text.length > 2000) {
    sendError(req, res, 400, 'INVALID_INPUT', '请输入 1–2000 字以内的对话内容');
    return;
  }
  if (!clientMessageId || clientMessageId.length > 100) {
    sendError(req, res, 400, 'INVALID_INPUT', '缺少有效的 clientMessageId');
    return;
  }

  const dollRow = await db
    .prepare(
      `SELECT d.id, d.kind, d.name,
              p.id AS persona_id, p.name AS persona_name, p.mbti AS persona_mbti,
              p.cognitive_axis AS persona_cognitive_axis,
              p.speech_style AS persona_speech_style,
              p.material_hint AS persona_material_hint,
              p.prompt AS persona_prompt, p.opening_line AS persona_opening_line
       FROM dolls d
       JOIN personas p ON p.id = d.persona_id
       WHERE d.id = ?`
    )
    .get(dollId) as
    | {
        id: string;
        kind: 'demo' | 'personal';
        name: string;
        persona_id: string;
        persona_name: string;
        persona_mbti: string;
        persona_cognitive_axis: string;
        persona_speech_style: string;
        persona_material_hint: string;
        persona_prompt: string;
        persona_opening_line: string;
      }
    | undefined;

  if (!dollRow) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的娃娃');
    return;
  }

  const { chatProviderMode: providerMode } = await getRuntimeSettings();
  const now = new Date().toISOString();
  const assistantMessageId = `reply_${crypto.randomBytes(8).toString('hex')}`;

  const claim = await db.transaction(async () => {
    const user = await db.prepare(
      `SELECT content FROM messages
       WHERE session_id = ? AND doll_id = ? AND client_message_id = ? AND role = 'user'`
    ).get(sessionId, dollId, clientMessageId) as { content: string } | undefined;
    if (user && user.content !== text) {
      throw Object.assign(new Error('相同消息编号对应了不同的内容'), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    }

    const completed = await db.prepare(
      `SELECT id, content, provider FROM messages
       WHERE session_id = ? AND doll_id = ? AND client_message_id = ? AND role = 'assistant' AND status = 'completed'
       ORDER BY reply_attempt DESC LIMIT 1`
    ).get(sessionId, dollId, clientMessageId) as { id: string; content: string; provider: string } | undefined;
    if (completed) return { completed };

    if (providerMode === 'cloud' && !isChatCloudConfigured()) {
      throw Object.assign(new Error('阶跃星辰对话尚未配置 STEPFUN_API_KEY'), { status: 503, code: 'PROVIDER_NOT_CONFIGURED' });
    }

    // A serverless timeout can leave a stream open in the database. A new user retry may reclaim it.
    const staleBefore = new Date(Date.now() - 75_000).toISOString();
    await db.prepare(
      `UPDATE messages SET status = 'incomplete', error_code = 'STREAM_INTERRUPTED'
       WHERE session_id = ? AND doll_id = ? AND client_message_id = ? AND role = 'assistant'
         AND status IN ('pending', 'streaming') AND created_at < ?`
    ).run(sessionId, dollId, clientMessageId, staleBefore);
    const attempt = await db.prepare(
      `SELECT COALESCE(MAX(reply_attempt), 0) AS count,
              COALESCE(SUM(CASE WHEN status IN ('pending', 'streaming') THEN 1 ELSE 0 END), 0) AS active
       FROM messages WHERE session_id = ? AND doll_id = ? AND client_message_id = ? AND role = 'assistant'`
    ).get(sessionId, dollId, clientMessageId) as { count: number; active: number };
    if (attempt.active) {
      throw Object.assign(new Error('该消息正在生成回复中'), { status: 409, code: 'TASK_ALREADY_RUNNING' });
    }

    if (!user) {
      await db.prepare(
        `INSERT INTO messages (id, session_id, doll_id, client_message_id, reply_attempt, role, content, status, created_at)
         VALUES (?, ?, ?, ?, 0, 'user', ?, 'completed', ?)`
      ).run(`msg_${crypto.randomBytes(8).toString('hex')}`, sessionId, dollId, clientMessageId, text, now);
    }
    const replyAttempt = attempt.count + 1;
    await db.prepare(
      `INSERT INTO messages (id, session_id, doll_id, client_message_id, reply_attempt, role, content, status, provider, created_at)
       VALUES (?, ?, ?, ?, ?, 'assistant', '', 'streaming', ?, ?)`
    ).run(assistantMessageId, sessionId, dollId, clientMessageId, replyAttempt, providerMode, new Date().toISOString());
    return { replyAttempt };
  })();

  const completedReply = claim.completed;
  if (completedReply) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    writeSseEvent(res, 'meta', {
      requestId: req.requestId,
      clientMessageId,
      provider: completedReply.provider || providerMode,
      replayed: true,
    });
    writeSseEvent(res, 'delta', { text: completedReply.content });
    writeSseEvent(res, 'done', {
      assistantMessageId: completedReply.id,
      status: 'completed',
    });
    res.end();
    return;
  }

  const { replyAttempt } = claim;
  const abortController = new AbortController();
  let clientClosed = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientClosed = true;
      abortController.abort();
    }
  });

  let startedAt = Date.now();
  let firstTokenMs: number | null = null;
  let accumulated = '';
  let endedWithEvent = false;
  try {
    let savedMemoryId: string | null = null;
    let rememberToSave = explicitRemember;
    if (!rememberToSave) {
      const match = text.match(/^记住[：:]\s*(.+)$/);
      if (match && match[1].trim()) {
        rememberToSave = match[1].trim();
      }
    }
    if (rememberToSave) {
      const existingMem = await db
        .prepare(
          `SELECT id FROM memories WHERE session_id = ? AND doll_id = ? AND type = 'fact' AND value = ? LIMIT 1`
        )
        .get(sessionId, dollId, rememberToSave) as { id: string } | undefined;

      if (!existingMem) {
        savedMemoryId = `mem_${crypto.randomBytes(8).toString('hex')}`;
        await db.prepare(
          `INSERT INTO memories (id, session_id, doll_id, type, value, source, created_at)
           VALUES (?, ?, ?, 'fact', ?, ?, ?)`
        ).run(
          savedMemoryId,
          sessionId,
          dollId,
          rememberToSave.slice(0, 300),
          explicitRemember ? 'chat_explicit_field' : 'chat_prefix_rule',
          now
        );
      } else {
        savedMemoryId = existingMem.id;
      }
    }

    const memories = await db
      .prepare(
        `SELECT type, value, source
         FROM memories
         WHERE session_id = ? AND doll_id = ?
         ORDER BY created_at ASC`
      )
      .all(sessionId, dollId) as Array<{ type: string; value: string; source: string }>;

    const historyRows = await db
      .prepare(
        `SELECT role, content
         FROM messages
         WHERE session_id = ? AND doll_id = ? AND status = 'completed'
           AND NOT (role = 'user' AND client_message_id = ?)
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(sessionId, dollId, clientMessageId, config.chatContextMaxMessages) as Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
    historyRows.reverse();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    writeSseEvent(res, 'meta', {
      requestId: req.requestId,
      clientMessageId,
      assistantMessageId,
      provider: providerMode,
      savedMemoryId,
    });

    startedAt = Date.now();
    const provider = getChatProvider(providerMode);
    for await (const event of provider.streamChat({
      dollName: dollRow.name,
      dollKind: dollRow.kind,
      persona: {
        id: dollRow.persona_id,
        name: dollRow.persona_name,
        mbti: dollRow.persona_mbti,
        cognitiveAxis: dollRow.persona_cognitive_axis,
        speechStyle: dollRow.persona_speech_style,
        materialHint: dollRow.persona_material_hint,
        prompt: dollRow.persona_prompt,
        openingLine: dollRow.persona_opening_line,
      },
      memories,
      history: historyRows,
      userText: text,
      requestId: req.requestId,
      signal: abortController.signal,
    })) {
      if (clientClosed) break;

      if (event.type === 'delta') {
        if (firstTokenMs === null) {
          firstTokenMs = Date.now() - startedAt;
        }
        accumulated += event.text;
        writeSseEvent(res, 'delta', { text: event.text });
      } else if (event.type === 'done') {
        const totalMs = Date.now() - startedAt;
        await db.prepare(
          `UPDATE messages
           SET content = ?, status = 'completed', provider_request_id = ?, first_token_ms = ?, total_ms = ?
           WHERE id = ?`
        ).run(accumulated, event.providerRequestId ?? null, firstTokenMs, totalMs, assistantMessageId);

        await recordRunLog({
          id: `log_${crypto.randomBytes(6).toString('hex')}`,
          kind: 'chat',
          provider: providerMode,
          resultKind: providerMode === 'cloud' ? 'generated' : 'mock',
          status: 'succeeded',
          firstTokenMs,
          totalMs,
          requestId: event.providerRequestId ?? req.requestId,
          detail: `doll=${dollId} mbti=${dollRow.persona_mbti} attempt=${replyAttempt}`,
        });

        writeSseEvent(res, 'done', {
          assistantMessageId,
          status: 'completed',
          firstTokenMs,
          totalMs,
          savedMemoryId,
        });
        endedWithEvent = true;
        break;
      } else if (event.type === 'error') {
        const totalMs = Date.now() - startedAt;
        const failStatus = accumulated.length > 0 ? 'incomplete' : 'failed';
        await db.prepare(
          `UPDATE messages
           SET content = ?, status = ?, error_code = ?, first_token_ms = ?, total_ms = ?
           WHERE id = ?`
        ).run(accumulated, failStatus, event.code, firstTokenMs, totalMs, assistantMessageId);

        await recordRunLog({
          id: `log_${crypto.randomBytes(6).toString('hex')}`,
          kind: 'chat',
          provider: providerMode,
          resultKind: providerMode === 'cloud' ? 'generated' : 'mock',
          status: 'failed',
          firstTokenMs,
          totalMs,
          errorCode: event.code,
          requestId: req.requestId,
          detail: event.message,
        });

        writeSseEvent(res, 'error', {
          code: event.code,
          message: event.message,
          requestId: req.requestId,
        });
        endedWithEvent = true;
        break;
      }
    }

    if (!endedWithEvent) {
      const totalMs = Date.now() - startedAt;
      await db.prepare(
        `UPDATE messages
         SET content = ?, status = 'incomplete', error_code = 'STREAM_INTERRUPTED', first_token_ms = ?, total_ms = ?
         WHERE id = ?`
      ).run(accumulated, firstTokenMs, totalMs, assistantMessageId);

      if (!clientClosed && !res.writableEnded) {
        writeSseEvent(res, 'error', {
          code: 'PROVIDER_ERROR',
          message: '对话流意外中断，请点击重试',
          requestId: req.requestId,
        });
      }
    }
  } catch (err: unknown) {
    const totalMs = Date.now() - startedAt;
    const message = '对话暂时中断，请重试';
    await db.prepare(
      `UPDATE messages
       SET content = ?, status = 'failed', error_code = 'PROVIDER_ERROR', first_token_ms = ?, total_ms = ?
       WHERE id = ? AND status = 'streaming'`
    ).run(accumulated, firstTokenMs, totalMs, assistantMessageId);

    if (!res.headersSent) throw err;
    if (!clientClosed && !res.writableEnded) {
      writeSseEvent(res, 'error', {
        code: 'PROVIDER_ERROR',
        message,
        requestId: req.requestId,
      });
    }
  } finally {
    if (res.headersSent && !res.writableEnded) {
      res.end();
    }
  }
});

// ============================================================
// 6. Explicit Memory CRUD (scoped by sessionId + dollId)
// ============================================================
router.get('/dolls/:id/memory', ensureSession, async (req, res) => {
  const dollId = req.params.id;
  const sessionId = req.session!.id;

  const dollExists = await db.prepare(`SELECT id FROM dolls WHERE id = ?`).get(dollId);
  if (!dollExists) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的娃娃');
    return;
  }

  const rows = await db
    .prepare(
      `SELECT id, type, value, source, created_at
       FROM memories
       WHERE session_id = ? AND doll_id = ?
       ORDER BY created_at ASC`
    )
    .all(sessionId, dollId) as Array<Record<string, unknown>>;

  sendSuccess(
    res,
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      value: r.value,
      source: r.source,
      createdAt: r.created_at,
    }))
  );
});

const ALLOWED_MEMORY_TYPES = new Set(['user_nickname', 'doll_name', 'persona', 'accessories', 'fact']);

router.post('/dolls/:id/memory', ensureSession, async (req, res) => {
  const dollId = req.params.id;
  const sessionId = req.session!.id;

  const dollExists = await db.prepare(`SELECT id FROM dolls WHERE id = ?`).get(dollId);
  if (!dollExists) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的娃娃');
    return;
  }

  const type = typeof req.body?.type === 'string' ? req.body.type.trim() : 'fact';
  const value = typeof req.body?.value === 'string' ? req.body.value.trim() : '';

  if (!ALLOWED_MEMORY_TYPES.has(type)) {
    sendError(req, res, 400, 'INVALID_INPUT', '不支持的记忆类型，允许：user_nickname、doll_name、persona、accessories、fact');
    return;
  }
  if (!value || value.length > 300) {
    sendError(req, res, 400, 'INVALID_INPUT', '记忆内容需在 1–300 字之间');
    return;
  }

  const now = new Date().toISOString();
  if (type === 'user_nickname') {
    await db.prepare(
      `DELETE FROM memories WHERE session_id = ? AND doll_id = ? AND type = 'user_nickname'`
    ).run(sessionId, dollId);
  }

  const memoryId = `mem_${crypto.randomBytes(8).toString('hex')}`;
  await db.prepare(
    `INSERT INTO memories (id, session_id, doll_id, type, value, source, created_at)
     VALUES (?, ?, ?, ?, ?, 'manual', ?)`
  ).run(memoryId, sessionId, dollId, type, value, now);

  sendSuccess(
    res,
    {
      memoryId,
      id: memoryId,
      type,
      value,
      source: 'manual',
      createdAt: now,
    },
    201
  );
});

router.delete('/dolls/:id/memory/:memoryId', ensureSession, async (req, res) => {
  const dollId = req.params.id;
  const memoryId = req.params.memoryId;
  const sessionId = req.session!.id;

  const del = await db
    .prepare(`DELETE FROM memories WHERE id = ? AND doll_id = ? AND session_id = ?`)
    .run(memoryId, dollId, sessionId);

  if (del.changes === 0) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到可删除的记忆记录');
    return;
  }
  res.status(204).end();
});

// ============================================================
// 7. Cards, Versions, Redraw, Cancel, Fallback & Bind
// ============================================================
router.get('/cards', ensureSession, async (req, res) => {
  const sessionId = req.session!.id;
  const baseUrl = await getLiveBaseUrl(req);
  const maxAttempts = 1 + config.maxRegenerations;

  const cards = await db
    .prepare(
      `SELECT c.*, p.name AS persona_name, p.mbti AS persona_mbti
       FROM cards c
       JOIN personas p ON p.id = c.persona_id
       WHERE c.owner_session_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(sessionId) as Array<Record<string, unknown>>;

  const versionsStmt = db.prepare(
    `SELECT * FROM card_versions WHERE card_id = ? ORDER BY version_number ASC`
  );

  sendSuccess(
    res,
    await Promise.all(cards.map(async (c) => {
      const versions = (await versionsStmt.all(c.id) as Array<Record<string, unknown>>).map(formatCardVersion);
      return {
        id: c.id,
        userNickname: c.user_nickname,
        personaId: c.persona_id,
        personaName: c.persona_name,
        personaMbti: c.persona_mbti,
        accessoryIds: JSON.parse(String(c.accessory_ids || '[]')),
        activeVersionId: c.active_version_id,
        boundDollId: c.bound_doll_id ?? null,
        generationAttempts: c.generation_attempts,
        maxAttempts,
        remainingAttempts: Math.max(0, maxAttempts - Number(c.generation_attempts || 0)),
        cardUrl: `${baseUrl}/card/${c.id}`,
        dollUrl: c.bound_doll_id ? `${baseUrl}/d/${c.bound_doll_id}` : null,
        createdAt: c.created_at,
        versions,
      };
    }))
  );
});

router.post('/cards', ensureSession, uploadPhoto, async (req, res) => {
  const sessionId = req.session!.id;
  const idempotencyKey = extractIdempotencyKey(req);
  const userNickname = typeof req.body?.userNickname === 'string' ? req.body.userNickname.trim() : '';
  const personaId = typeof req.body?.personaId === 'string' ? req.body.personaId.trim() : '';

  let accessoryIds: string[] = [];
  if (Array.isArray(req.body?.accessoryIds)) {
    accessoryIds = req.body.accessoryIds.map(String);
  } else if (typeof req.body?.accessoryIds === 'string' && req.body.accessoryIds.trim()) {
    try {
      const parsed = JSON.parse(req.body.accessoryIds);
      accessoryIds = Array.isArray(parsed)
        ? parsed.map(String)
        : req.body.accessoryIds.split(',').map((s: string) => s.trim()).filter(Boolean);
    } catch {
      accessoryIds = req.body.accessoryIds.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
  }

  // Validate against live in-stock SQLite craft materials
  const inStockMaterials = await listMaterials(true);
  const validMaterialSet = new Set(inStockMaterials.map((m) => m.id));
  accessoryIds = Array.from(new Set(accessoryIds.filter((id) => validMaterialSet.has(id)))).slice(0, 6);

  if (!req.file?.buffer) {
    sendError(req, res, 400, 'INVALID_INPUT', '请上传一张 JPEG、PNG 或 WebP 照片');
    return;
  }
  if (!userNickname || userNickname.length > 32) {
    sendError(req, res, 400, 'INVALID_INPUT', '请填写 1–32 字的你的称呼');
    return;
  }
  const personaExists = await db.prepare(`SELECT id FROM personas WHERE id = ?`).get(personaId);
  if (!personaExists) {
    sendError(req, res, 400, 'INVALID_INPUT', '请选择有效的人格设定');
    return;
  }

  let validatedImage;
  try {
    validatedImage = validateImageBuffer(req.file.buffer);
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    sendError(req, res, e.status || 400, e.code || 'UNSUPPORTED_IMAGE', e.message || '图片校验失败');
    return;
  }

  const photoHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const simulateFail = req.get('x-mock-fail') === 'true';
  const requestHash = hashObject({ userNickname, personaId, accessoryIds, photoHash, simulateFail });
  const cached = await checkIdempotency<{ data: { versionId: string } }>(
    sessionId, 'create_card', idempotencyKey, requestHash,
  );
  if (cached.hit) {
    if (cached.conflict) {
      sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', '相同幂等键提交了不同的创作参数');
    } else {
      await enqueueImageVersion(cached.body.data.versionId);
      res.status(cached.status).json(cached.body);
    }
    return;
  }

  const settings = await getRuntimeSettings();
  const provider = settings.imageProviderMode;
  if (provider === 'cloud' && !isImageCloudConfigured(settings.imageVendor)) {
    sendError(req, res, 503, 'PROVIDER_NOT_CONFIGURED', '当前生图服务尚未配置密钥');
    return;
  }

  const cardId = `card_${crypto.randomBytes(8).toString('hex')}`;
  const versionId = `ver_${crypto.randomBytes(8).toString('hex')}`;
  const photoFilename = `${cardId}.${validatedImage.ext}`;
  const baseUrl = buildPublicBaseUrl(req, settings.nfcPublicBaseUrl);
  const now = new Date();
  const expires = new Date(now.getTime() + config.photoTtlHours * 3600_000).toISOString();
  const timestamp = now.toISOString();
  // Schedule deletion before writing so an interrupted upload cannot leave a permanent photo.
  await schedulePhotoCleanup(photoFilename);
  await writeMedia(`photos/${photoFilename}`, req.file.buffer, validatedImage.mimeType);

  const payload = await persistTask(sessionId, 'create_card', idempotencyKey, requestHash, async () => {
    await db.prepare(
      `INSERT INTO cards (id, owner_session_id, photo_ref, photo_mime, photo_expires_at, user_nickname, persona_id,
                         accessory_ids, active_version_id, generation_attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(cardId, sessionId, photoFilename, validatedImage.mimeType, expires, userNickname, personaId,
      JSON.stringify(accessoryIds), versionId, timestamp);
    await db.prepare(
      `INSERT INTO card_versions (id, card_id, version_number, status, provider, result_kind, created_at, image_settings, simulate_fail)
       VALUES (?, ?, 1, 'queued', ?, ?, ?, ?, ?)`
    ).run(versionId, cardId, provider, provider === 'cloud' ? 'generated' : 'mock', timestamp,
      snapshotImageSettings(settings), Number(provider === 'mock' && simulateFail));
    return { data: {
      cardId, versionId, status: 'queued', provider,
      imageModelTier: settings.imageModelTier,
      cardUrl: `${baseUrl}/card/${cardId}`,
      processingUrl: `${baseUrl}/create/processing?cardId=${cardId}`,
    } };
  }).catch(async (error) => {
    // A transport failure may have happened after commit. Keep the photo if the card exists.
    const saved = await db.prepare('SELECT 1 FROM cards WHERE id = ?').get(cardId).catch(() => true);
    if (!saved) await deleteMedia(`photos/${photoFilename}`).catch(() => {});
    throw error;
  });
  if (payload.data.cardId !== cardId) await deleteMedia(`photos/${photoFilename}`).catch(() => {});
  await enqueueImageVersion(payload.data.versionId);
  res.status(202).json(payload);
});

router.get('/cards/:id', ensureSession, async (req, res) => {
  const cardId = req.params.id;
  const sessionId = req.session!.id;
  const baseUrl = await getLiveBaseUrl(req);

  const card = await db
    .prepare(
      `SELECT c.*, p.name AS persona_name, p.mbti AS persona_mbti, p.tagline AS persona_tagline, p.material_hint AS persona_material_hint
       FROM cards c
       JOIN personas p ON p.id = c.persona_id
       WHERE c.id = ? AND c.owner_session_id = ?`
    )
    .get(cardId, sessionId) as Record<string, unknown> | undefined;

  if (!card) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的创作卡片');
    return;
  }

  const versionRows = await db
    .prepare(`SELECT * FROM card_versions WHERE card_id = ? ORDER BY version_number ASC`)
    .all(cardId) as Array<Record<string, unknown>>;

  const queued = versionRows.find((row) => row.status === 'queued');
  if (queued) await recoverQueuedDelivery('image', queued);

  const maxAttempts = 1 + config.maxRegenerations;
  const attempts = Number(card.generation_attempts || 0);
  const photoExpired = Date.parse(String(card.photo_expires_at)) <= Date.now() ||
    !await mediaExists(`photos/${card.photo_ref}`);

  const cardUrl = `${baseUrl}/card/${cardId}`;
  const dollUrl = card.bound_doll_id ? `${baseUrl}/d/${card.bound_doll_id}` : null;
  const qrSvg = dollUrl ? await generateQrSvg(dollUrl) : null;

  let boundDoll = null;
  if (card.bound_doll_id) {
    const dRow = await db
      .prepare(`SELECT id, name, avatar_url, card_version_id, created_at FROM dolls WHERE id = ?`)
      .get(card.bound_doll_id) as Record<string, unknown> | undefined;
    if (dRow) {
      boundDoll = {
        id: dRow.id,
        name: dRow.name,
        avatarUrl: dRow.avatar_url,
        cardVersionId: dRow.card_version_id,
        dollUrl,
        qrSvg,
        createdAt: dRow.created_at,
      };
    }
  }

  const parsedAccIds = JSON.parse(String(card.accessory_ids || '[]')) as string[];

  sendSuccess(res, {
    id: card.id,
    userNickname: card.user_nickname,
    personaId: card.persona_id,
    persona: {
      id: card.persona_id,
      name: card.persona_name,
      mbti: card.persona_mbti,
      tagline: card.persona_tagline,
      materialHint: card.persona_material_hint,
    },
    accessoryIds: parsedAccIds,
    accessoryLabels: await resolveMaterialLabels(parsedAccIds),
    activeVersionId: card.active_version_id,
    boundDollId: card.bound_doll_id ?? null,
    boundDoll,
    generationAttempts: attempts,
    maxAttempts,
    remainingAttempts: Math.max(0, maxAttempts - attempts),
    photoAvailable: !photoExpired,
    photoUrl: !photoExpired ? `/api/cards/${card.id}/photo` : null,
    photoExpiresAt: card.photo_expires_at,
    cardUrl,
    dollUrl,
    createdAt: card.created_at,
    versions: versionRows.map(formatCardVersion),
  });
});

router.get('/cards/:id/photo', ensureSession, async (req, res) => {
  const cardId = req.params.id;
  const sessionId = req.session!.id;

  const card = await db
    .prepare(`SELECT photo_ref, photo_mime, photo_expires_at FROM cards WHERE id = ? AND owner_session_id = ?`)
    .get(cardId, sessionId) as
    | { photo_ref: string; photo_mime: string; photo_expires_at: string }
    | undefined;

  if (!card) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到原始照片');
    return;
  }

  const photo = Date.parse(card.photo_expires_at) > Date.now()
    ? await openMedia(`photos/${card.photo_ref}`) : null;
  if (!photo) {
    sendError(req, res, 410, 'PHOTO_EXPIRED', '原始照片已过期清理');
    return;
  }

  res.setHeader('Content-Type', card.photo_mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store');
  await pipeline(photo, res);
});

router.get('/card-versions/:id', ensureSession, async (req, res) => {
  const versionId = req.params.id;
  const sessionId = req.session!.id;

  const row = await db
    .prepare(
      `SELECT cv.*
       FROM card_versions cv
       JOIN cards c ON c.id = cv.card_id
       WHERE cv.id = ? AND c.owner_session_id = ?`
    )
    .get(versionId, sessionId) as Record<string, unknown> | undefined;

  if (!row) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的生成版本');
    return;
  }

  await recoverQueuedDelivery('image', row);
  sendSuccess(res, formatCardVersion(row));
});

router.post('/cards/:id/redraw', ensureSession, async (req, res) => {
  const cardId = req.params.id;
  const sessionId = req.session!.id;
  const idempotencyKey = extractIdempotencyKey(req);
  const simulateFail = req.get('x-mock-fail') === 'true' || req.body?.simulateFail === true;
  const reviewedUnknown = req.body?.reviewedUnknown === true;
  const requestHash = hashObject({ cardId, action: 'redraw', simulateFail, reviewedUnknown });

  const runtimeSettings = await getRuntimeSettings();
  const providerMode = runtimeSettings.imageProviderMode;
  const maxAttempts = 1 + config.maxRegenerations;
  const payload = await persistTask(sessionId, `redraw:${cardId}`, idempotencyKey, requestHash, async () => {
    if (providerMode === 'cloud' && !isImageCloudConfigured(runtimeSettings.imageVendor)) {
      throw Object.assign(new Error('当前生图服务尚未配置密钥'), { status: 503, code: 'PROVIDER_NOT_CONFIGURED' });
    }
    const card = await db
      .prepare(`SELECT * FROM cards WHERE id = ? AND owner_session_id = ?`)
      .get(cardId, sessionId) as Record<string, unknown> | undefined;

    if (!card) {
      throw Object.assign(new Error('未找到对应的创作卡片'), { status: 404, code: 'NOT_FOUND' });
    }
    if (card.bound_doll_id) {
      throw Object.assign(new Error('该作品已绑定个人娃娃并冻结，无法继续重生成，请新建创作'), {
        status: 409,
        code: 'CARD_LOCKED',
      });
    }

    const latestCloudVersion = await db.prepare(
      `SELECT error_code FROM card_versions WHERE card_id = ? AND provider = 'cloud'
       ORDER BY version_number DESC LIMIT 1`
    ).get(cardId) as { error_code: string | null } | undefined;
    if (latestCloudVersion?.error_code === 'GENERATION_STATUS_UNKNOWN' && !reviewedUnknown) {
      throw Object.assign(new Error('请核对上一次生图的结果和费用后再提交'), { status: 409, code: 'GENERATION_REVIEW_REQUIRED' });
    }

    const activeTask = await db
      .prepare(
        `SELECT id FROM card_versions WHERE card_id = ? AND status IN ('queued', 'running') LIMIT 1`
      )
      .get(cardId);
    if (activeTask) {
      throw Object.assign(new Error('当前已有排队或运行中的生成任务，请等待完成或取消排队任务'), {
        status: 409,
        code: 'TASK_ALREADY_RUNNING',
      });
    }

    if (Date.parse(String(card.photo_expires_at)) <= Date.now()) {
      throw Object.assign(new Error('原始照片已过期清理，无法重生成，请新建创作并重新上传照片'), {
        status: 410,
        code: 'PHOTO_EXPIRED',
      });
    }

    const attempts = Number(card.generation_attempts || 0);
    if (attempts >= maxAttempts) {
      throw Object.assign(
        new Error(`单次创作最多尝试 ${maxAttempts} 次模型生成（初次 + ${config.maxRegenerations} 次重生成），可选择已有成功版本或预设模板兜底`),
        { status: 409, code: 'GENERATION_LIMIT_REACHED' }
      );
    }

    const maxVerRow = await db
      .prepare(`SELECT MAX(version_number) AS max_v FROM card_versions WHERE card_id = ?`)
      .get(cardId) as { max_v: number | null };

    const versionNumber = (maxVerRow?.max_v ?? 0) + 1;
    const newVersionId = `ver_${crypto.randomBytes(8).toString('hex')}`;
    const resultKind = providerMode === 'cloud' ? 'generated' : 'mock';
    const nowIso = new Date().toISOString();

    await db.prepare(
      `INSERT INTO card_versions (id, card_id, version_number, status, provider, result_kind, created_at, image_settings, simulate_fail)
       VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`
    ).run(newVersionId, cardId, versionNumber, providerMode, resultKind, nowIso, snapshotImageSettings(runtimeSettings), Number(simulateFail && providerMode === 'mock'));

    await db.prepare(
      `UPDATE cards SET generation_attempts = generation_attempts + 1, active_version_id = ? WHERE id = ?`
    ).run(newVersionId, cardId);
    return { data: { cardId, versionId: newVersionId, versionNumber, status: 'queued', provider: providerMode } };
  });
  await enqueueImageVersion(payload.data.versionId);
  res.status(202).json(payload);
});

router.post('/card-versions/:id/cancel', ensureSession, async (req, res) => {
  const versionId = req.params.id;
  const sessionId = req.session!.id;
  const idempotencyKey = extractIdempotencyKey(req);
  const requestHash = hashObject({ versionId, action: 'cancel' });

  const idem = await checkIdempotency(sessionId, `cancel:${versionId}`, idempotencyKey, requestHash);
  if (idem.hit) {
    if (idem.conflict) {
      sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', '幂等键冲突');
      return;
    }
    res.status(idem.status).json(idem.body);
    return;
  }

  const row = await db
    .prepare(
      `SELECT cv.id, cv.status, cv.provider
       FROM card_versions cv
       JOIN cards c ON c.id = cv.card_id
       WHERE cv.id = ? AND c.owner_session_id = ?`
    )
    .get(versionId, sessionId) as { id: string; status: string; provider: string } | undefined;

  if (!row) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的生成任务');
    return;
  }

  if (row.status === 'running') {
    sendError(req, res, 409, 'TASK_ALREADY_RUNNING', '任务已进入执行中，无法取消');
    return;
  }

  if (row.status === 'cancelled') {
    const payload = { data: { versionId, status: 'cancelled' } };
    await saveIdempotency(sessionId, `cancel:${versionId}`, idempotencyKey, requestHash, 200, payload);
    res.status(200).json(payload);
    return;
  }

  if (row.status !== 'queued') {
    sendError(req, res, 409, 'INVALID_CARD_VERSION', `当前任务状态为 ${row.status}，无法取消`);
    return;
  }

  const updated = await db
    .prepare(
      `UPDATE card_versions
       SET status = 'cancelled', finished_at = ?
       WHERE id = ? AND status = 'queued'`
    )
    .run(new Date().toISOString(), versionId);

  if (updated.changes === 0) {
    sendError(req, res, 409, 'TASK_ALREADY_RUNNING', '任务刚刚已开始执行，无法取消');
    return;
  }

  await recordRunLog({
    id: `log_${crypto.randomBytes(6).toString('hex')}`,
    kind: 'image',
    provider: row.provider,
    resultKind: row.provider === 'cloud' ? 'generated' : 'mock',
    status: 'cancelled',
    detail: `cancelled queued version ${versionId}`,
  });

  const payload = { data: { versionId, status: 'cancelled' } };
  await saveIdempotency(sessionId, `cancel:${versionId}`, idempotencyKey, requestHash, 200, payload);
  res.status(200).json(payload);
});

router.post('/cards/:id/fallback', ensureSession, async (req, res) => {
  const cardId = req.params.id;
  const sessionId = req.session!.id;
  const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId.trim() : FALLBACK_TEMPLATES[0].id;
  const idempotencyKey = extractIdempotencyKey(req);

  const template = FALLBACK_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    sendError(req, res, 400, 'INVALID_INPUT', '未找到指定的预设兜底模板');
    return;
  }

  const requestHash = hashObject({ cardId, templateId });
  const idem = await checkIdempotency(sessionId, `fallback:${cardId}`, idempotencyKey, requestHash);
  if (idem.hit) {
    if (idem.conflict) {
      sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', '相同幂等键提交了不同的模板编号');
      return;
    }
    res.status(idem.status).json(idem.body);
    return;
  }

  let versionRecord: Record<string, unknown> | undefined;
  let statusCode = 201;

  try {
    const tx = db.transaction(async () => {
      const card = await db
        .prepare(`SELECT * FROM cards WHERE id = ? AND owner_session_id = ?`)
        .get(cardId, sessionId) as Record<string, unknown> | undefined;

      if (!card) {
        throw Object.assign(new Error('未找到对应的创作卡片'), { status: 404, code: 'NOT_FOUND' });
      }
      if (card.bound_doll_id) {
        throw Object.assign(new Error('该作品已绑定个人娃娃，无法添加模板版本'), {
          status: 409,
          code: 'CARD_LOCKED',
        });
      }

      const running = await db
        .prepare(`SELECT id FROM card_versions WHERE card_id = ? AND status IN ('queued', 'running') LIMIT 1`)
        .get(cardId);
      if (running) {
        throw Object.assign(new Error('当前存在运行或排队中的生成任务，请等待结束后再启用模板兜底'), {
          status: 409,
          code: 'TASK_ALREADY_RUNNING',
        });
      }

      const existingTpl = await db
        .prepare(`SELECT * FROM card_versions WHERE card_id = ? AND result_kind = 'template' LIMIT 1`)
        .get(cardId) as Record<string, unknown> | undefined;

      if (existingTpl) {
        await db.prepare(`UPDATE card_versions SET result_url = ?, suggested_name = ?, keywords = ? WHERE id = ?`).run(
          template.imageUrl,
          template.name.replace(' · 预设版', ''),
          JSON.stringify([template.id, '预设模板']),
          existingTpl.id
        );
        await db.prepare(`UPDATE cards SET active_version_id = ? WHERE id = ?`).run(existingTpl.id, cardId);
        versionRecord = await db.prepare(`SELECT * FROM card_versions WHERE id = ?`).get(existingTpl.id) as Record<string, unknown>;
        statusCode = 201;
        return;
      }

      const maxVer = await db
        .prepare(`SELECT MAX(version_number) AS max_v FROM card_versions WHERE card_id = ?`)
        .get(cardId) as { max_v: number | null };
      const versionNumber = (maxVer?.max_v ?? 0) + 1;
      const versionId = `ver_tpl_${crypto.randomBytes(6).toString('hex')}`;
      const nowIso = new Date().toISOString();

      await db.prepare(
        `INSERT INTO card_versions (id, card_id, version_number, status, provider, result_kind, result_url, suggested_name, keywords, latency_ms, started_at, finished_at, created_at)
         VALUES (?, ?, ?, 'succeeded', 'template', 'template', ?, ?, ?, 0, ?, ?, ?)`
      ).run(
        versionId,
        cardId,
        versionNumber,
        template.imageUrl,
        template.name.replace(' · 预设版', ''),
        JSON.stringify([template.id, '预设模板']),
        nowIso,
        nowIso,
        nowIso
      );

      await db.prepare(`UPDATE cards SET active_version_id = ? WHERE id = ?`).run(versionId, cardId);
      versionRecord = await db.prepare(`SELECT * FROM card_versions WHERE id = ?`).get(versionId) as Record<string, unknown>;

      await recordRunLog({
        id: `log_${crypto.randomBytes(6).toString('hex')}`,
        kind: 'image',
        provider: 'template',
        resultKind: 'template',
        status: 'succeeded',
        totalMs: 0,
        detail: `card=${cardId} template=${template.id}`,
      });
    });
    await tx();
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    sendError(req, res, e.status || 400, e.code || 'INVALID_INPUT', e.message || '启用模板兜底失败');
    return;
  }

  const payload = { data: formatCardVersion(versionRecord!) };
  await saveIdempotency(sessionId, `fallback:${cardId}`, idempotencyKey, requestHash, statusCode, payload);
  res.status(statusCode).json(payload);
});

router.post('/cards/:id/bind', ensureSession, async (req, res) => {
  const cardId = req.params.id;
  const sessionId = req.session!.id;
  const versionId = typeof req.body?.versionId === 'string' ? req.body.versionId.trim() : '';
  const dollName = typeof req.body?.dollName === 'string' ? req.body.dollName.trim() : '';
  const idempotencyKey = extractIdempotencyKey(req);

  if (!versionId) {
    sendError(req, res, 400, 'INVALID_INPUT', '绑定时必须明确提交选定的成功 versionId');
    return;
  }
  if (!dollName || dollName.length > 32) {
    sendError(req, res, 400, 'INVALID_INPUT', '请给娃娃起一个 1–32 字的名字');
    return;
  }

  const requestHash = hashObject({ cardId, versionId, dollName });
  const idem = await checkIdempotency(sessionId, `bind:${cardId}`, idempotencyKey, requestHash);
  if (idem.hit) {
    if (idem.conflict) {
      sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', '相同幂等键提交了不同的绑定版本或娃娃名称');
      return;
    }
    res.status(idem.status).json(idem.body);
    return;
  }

  const baseUrl = await getLiveBaseUrl(req);
  let resultStatus = 201;
  let resultDollId = '';

  try {
    const bindTx = db.transaction(async () => {
      const card = await db
        .prepare(
          `SELECT c.*, p.name AS persona_name, p.mbti AS persona_mbti
           FROM cards c
           JOIN personas p ON p.id = c.persona_id
           WHERE c.id = ? AND c.owner_session_id = ?`
        )
        .get(cardId, sessionId) as Record<string, unknown> | undefined;

      if (!card) {
        throw Object.assign(new Error('未找到对应的创作卡片'), { status: 404, code: 'NOT_FOUND' });
      }

      const version = await db
        .prepare(`SELECT * FROM card_versions WHERE id = ? AND card_id = ?`)
        .get(versionId, cardId) as Record<string, unknown> | undefined;

      if (!version) {
        throw Object.assign(new Error('选定的版本不属于当前创作卡片'), {
          status: 400,
          code: 'INVALID_CARD_VERSION',
        });
      }

      if (version.status !== 'succeeded' || !version.result_url) {
        throw Object.assign(new Error('只能选择状态为成功且已保存结果图的版本进行绑定'), {
          status: 400,
          code: 'INVALID_CARD_VERSION',
        });
      }

      if (card.bound_doll_id) {
        const existingDoll = await db
          .prepare(`SELECT id, card_version_id FROM dolls WHERE id = ?`)
          .get(card.bound_doll_id) as { id: string; card_version_id: string } | undefined;

        if (existingDoll && existingDoll.card_version_id === versionId) {
          resultDollId = existingDoll.id;
          resultStatus = 200;
          return;
        }
        throw Object.assign(new Error('该作品已绑定其他版本的个人娃娃，不可更换版本'), {
          status: 409,
          code: 'CARD_LOCKED',
        });
      }

      const dollId = `doll_${crypto.randomBytes(6).toString('hex')}`;
      const nowIso = new Date().toISOString();

      await db.prepare(
        `INSERT INTO dolls (id, kind, owner_session_id, persona_id, name, avatar_url, card_id, card_version_id, created_at)
         VALUES (?, 'personal', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        dollId,
        sessionId,
        card.persona_id,
        dollName,
        version.result_url,
        cardId,
        versionId,
        nowIso
      );

      await db.prepare(`UPDATE cards SET bound_doll_id = ?, active_version_id = ? WHERE id = ?`).run(
        dollId,
        versionId,
        cardId
      );

      const insertMem = db.prepare(
        `INSERT INTO memories (id, session_id, doll_id, type, value, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'creation_form', ?)`
      );

      await insertMem.run(
        `mem_${crypto.randomBytes(6).toString('hex')}`,
        sessionId,
        dollId,
        'user_nickname',
        String(card.user_nickname),
        nowIso
      );
      await insertMem.run(
        `mem_${crypto.randomBytes(6).toString('hex')}`,
        sessionId,
        dollId,
        'doll_name',
        dollName,
        nowIso
      );
      await insertMem.run(
        `mem_${crypto.randomBytes(6).toString('hex')}`,
        sessionId,
        dollId,
        'persona',
        `${card.persona_mbti} · ${card.persona_name}`,
        nowIso
      );

      const accessoryLabels = await resolveMaterialLabels(JSON.parse(String(card.accessory_ids || '[]')));
      if (accessoryLabels.length > 0) {
        await insertMem.run(
          `mem_${crypto.randomBytes(6).toString('hex')}`,
          sessionId,
          dollId,
          'accessories',
          accessoryLabels.join('、'),
          nowIso
        );
      }

      resultDollId = dollId;
      resultStatus = 201;
    });
    await bindTx();
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    sendError(req, res, e.status || 400, e.code || 'INVALID_INPUT', e.message || '绑定失败');
    return;
  }

  const responsePayload = {
    data: {
      dollId: resultDollId,
      dollUrl: `${baseUrl}/d/${resultDollId}`,
      cardUrl: `${baseUrl}/card/${cardId}`,
      cardVersionId: versionId,
    },
  };
  await saveIdempotency(sessionId, `bind:${cardId}`, idempotencyKey, requestHash, resultStatus, responsePayload);
  res.status(resultStatus).json(responsePayload);
});

// ============================================================
// 8. Mock Output Jobs (Plot / Print Simulation)
// ============================================================
const ALLOWED_PAPER_SIZES = new Set(['A6', 'A5', 'SQUARE_100']);

router.post('/plot/jobs', ensureSession, async (req, res) => {
  const sessionId = req.session!.id;
  const cardVersionId = typeof req.body?.cardVersionId === 'string' ? req.body.cardVersionId.trim() : '';
  const paperSize = typeof req.body?.paperSize === 'string' ? req.body.paperSize.trim() : 'A6';
  const simulateFail = req.body?.simulateFail === true || req.get('x-mock-fail') === 'true';
  const idempotencyKey = extractIdempotencyKey(req);

  if (!cardVersionId) {
    sendError(req, res, 400, 'INVALID_INPUT', '请指定要出图的 cardVersionId');
    return;
  }
  if (!ALLOWED_PAPER_SIZES.has(paperSize)) {
    sendError(req, res, 400, 'INVALID_INPUT', '不支持的纸张规格，可选：A6、A5、SQUARE_100');
    return;
  }

  const requestHash = hashObject({ cardVersionId, paperSize, simulateFail });
  const payload = await persistTask(sessionId, 'create_plot_job', idempotencyKey, requestHash, async () => {
    const verRow = await db
      .prepare(
        `SELECT cv.id, cv.card_id, cv.status, cv.result_url
         FROM card_versions cv
         JOIN cards c ON c.id = cv.card_id
         WHERE cv.id = ? AND c.owner_session_id = ?`
      )
      .get(cardVersionId, sessionId) as
      | { id: string; card_id: string; status: string; result_url: string | null }
      | undefined;

    if (!verRow) {
      throw Object.assign(new Error('未找到属于当前会话的生成版本'), { status: 404, code: 'NOT_FOUND' });
    }
    if (verRow.status !== 'succeeded' || !verRow.result_url) {
      throw Object.assign(new Error('仅支持对成功的生成版本提交模拟出图'), { status: 400, code: 'INVALID_CARD_VERSION' });
    }

    const jobId = `job_${crypto.randomBytes(8).toString('hex')}`;
    const nowIso = new Date().toISOString();

    await db.prepare(
      `INSERT INTO output_jobs (id, owner_session_id, card_id, card_version_id, paper_size, status, mode,
                                physical_executed, idempotency_key, created_at, simulate_fail)
       VALUES (?, ?, ?, ?, ?, 'queued', 'mock', 0, ?, ?, ?)`
    ).run(jobId, sessionId, verRow.card_id, cardVersionId, paperSize, idempotencyKey ?? null, nowIso, Number(simulateFail));
    return { data: {
      jobId, cardId: verRow.card_id, cardVersionId, paperSize, status: 'queued', mode: 'mock',
      physicalExecuted: false, errorCode: null, errorMessage: null, finishedAt: null, createdAt: nowIso,
    } };
  });
  await enqueueOutputJob(payload.data.jobId);
  res.status(202).json(payload);
});

router.get('/plot/jobs', ensureSession, async (req, res) => {
  const sessionId = req.session!.id;
  const cardId = typeof req.query.cardId === 'string' ? req.query.cardId.trim() : '';

  const rows = cardId
    ? (await db
        .prepare(
          `SELECT * FROM output_jobs WHERE owner_session_id = ? AND card_id = ? ORDER BY created_at DESC`
        )
        .all(sessionId, cardId) as Array<Record<string, unknown>>)
    : (await db
        .prepare(`SELECT * FROM output_jobs WHERE owner_session_id = ? ORDER BY created_at DESC LIMIT 30`)
        .all(sessionId) as Array<Record<string, unknown>>);

  await Promise.all(rows.map((row) => recoverQueuedDelivery('output', row)));

  sendSuccess(
    res,
    rows.map((r) => ({
      jobId: r.id,
      cardId: r.card_id,
      cardVersionId: r.card_version_id,
      paperSize: r.paper_size,
      status: r.status,
      mode: r.mode,
      physicalExecuted: r.physical_executed === 1,
      errorCode: r.error_code ?? null,
      errorMessage: r.error_message ?? null,
      createdAt: r.created_at,
      finishedAt: r.finished_at ?? null,
    }))
  );
});

router.get('/plot/jobs/:id', ensureSession, async (req, res) => {
  const jobId = req.params.id;
  const sessionId = req.session!.id;

  const r = await db
    .prepare(`SELECT * FROM output_jobs WHERE id = ? AND owner_session_id = ?`)
    .get(jobId, sessionId) as Record<string, unknown> | undefined;

  if (!r) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的模拟出图任务');
    return;
  }

  await recoverQueuedDelivery('output', r);
  sendSuccess(res, {
    jobId: r.id,
    cardId: r.card_id,
    cardVersionId: r.card_version_id,
    paperSize: r.paper_size,
    status: r.status,
    mode: r.mode,
    physicalExecuted: r.physical_executed === 1,
    errorCode: r.error_code ?? null,
    errorMessage: r.error_message ?? null,
    createdAt: r.created_at,
    finishedAt: r.finished_at ?? null,
  });
});

// ============================================================
// 9. Persistent Generated Asset Serving & Download
// ============================================================
router.get('/assets/generated/:filename', async (req, res) => {
  const safeName = path.basename(String(req.params.filename));
  const session = await loadExistingSession(req);
  res.vary('Cookie');
  res.setHeader('Cache-Control', 'private, no-store');
  const visible = await db.prepare(`
    SELECT 1 FROM card_versions v JOIN cards c ON c.id = v.card_id
    LEFT JOIN dolls d ON d.id = c.bound_doll_id AND d.card_version_id = v.id
    WHERE v.id = ? AND v.result_url = ? AND v.status = 'succeeded'
      AND (c.owner_session_id = ? OR d.id IS NOT NULL)
  `).get(path.parse(safeName).name, '/api/assets/generated/' + safeName, session?.id ?? null);
  const media = visible ? await openMedia(`generated/${safeName}`) : null;
  if (!media) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到生成结果文件');
    return;
  }

  const ext = path.extname(safeName).toLowerCase();
  const mime =
    ext === '.svg'
      ? 'image/svg+xml'
      : ext === '.png'
      ? 'image/png'
      : ext === '.webp'
      ? 'image/webp'
      : 'image/jpeg';

  res.setHeader('Content-Type', mime);
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="nutshell_${safeName}"`);
  }
  await pipeline(media, res);
});

// ============================================================
// 10. Protected Demo Admin Endpoints (/api/demo/*)
// ============================================================
router.get('/demo/status', requireAdmin, async (req, res) => {
  const settings = await getRuntimeSettings();
  const liveBaseUrl = buildPublicBaseUrl(req, settings.nfcPublicBaseUrl);

  const versionStats = await db
    .prepare(
      `SELECT provider, result_kind, status, COUNT(*) AS cnt, AVG(latency_ms) AS avg_ms
       FROM card_versions
       GROUP BY provider, result_kind, status`
    )
    .all();

  const chatStats = await db
    .prepare(
      `SELECT provider, status, COUNT(*) AS cnt, AVG(first_token_ms) AS avg_ttft_ms, AVG(total_ms) AS avg_total_ms
       FROM messages
       WHERE role = 'assistant'
       GROUP BY provider, status`
    )
    .all();

  const outputStats = await db
    .prepare(
      `SELECT mode, status, COUNT(*) AS cnt, SUM(physical_executed) AS physical_count
       FROM output_jobs
       GROUP BY mode, status`
    )
    .all();

  const recentErrors = await db
    .prepare(
      `SELECT id, kind, provider, result_kind, error_code, detail, request_id, created_at
       FROM run_logs
       WHERE status = 'failed'
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all();

  const recentRuns = await db
    .prepare(
      `SELECT id, kind, provider, result_kind, status, first_token_ms, total_ms, error_code, detail, created_at
       FROM run_logs
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .all();

  const activeSessions = await db
    .prepare(
      `SELECT s.id, s.is_demo, s.created_at, s.expires_at,
              (SELECT COUNT(*) FROM cards c WHERE c.owner_session_id = s.id) AS card_count,
              (SELECT COUNT(*) FROM dolls d WHERE d.owner_session_id = s.id) AS personal_doll_count,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
              (SELECT COUNT(*) FROM card_versions cv JOIN cards c ON c.id = cv.card_id WHERE c.owner_session_id = s.id AND cv.status = 'running') AS running_versions,
              (SELECT COUNT(*) FROM output_jobs oj WHERE oj.owner_session_id = s.id AND oj.status = 'running') AS running_jobs
       FROM sessions s
       WHERE s.invalidated = 0
       ORDER BY s.created_at DESC
       LIMIT 20`
    )
    .all();

  const nfcTagRows = await db
    .prepare(
      `SELECT nt.alias, nt.doll_id, nt.label, nt.last_written_at, nt.created_at,
              d.name AS doll_name, d.kind AS doll_kind, p.mbti AS persona_mbti, p.name AS persona_name
       FROM nfc_tags nt
       LEFT JOIN dolls d ON d.id = nt.doll_id
       LEFT JOIN personas p ON p.id = d.persona_id
       ORDER BY nt.created_at ASC`
    )
    .all() as Array<Record<string, unknown>>;

  const allDolls = await db
    .prepare(
      `SELECT d.id, d.name, d.kind, p.mbti AS persona_mbti, p.name AS persona_name
       FROM dolls d
       JOIN personas p ON p.id = d.persona_id
       ORDER BY CASE WHEN d.kind = 'demo' THEN 0 ELSE 1 END, d.created_at DESC
       LIMIT 40`
    )
    .all() as Array<Record<string, unknown>>;

  const allMaterials = await listMaterials(false);

  sendSuccess(res, {
    settings: {
      ...settings,
      effectiveBaseUrl: liveBaseUrl,
      imageModelTierLabel: IMAGE_TIER_LABELS[settings.imageModelTier],
      availableImageModels: IMAGE_MODELS[settings.imageVendor],
      nfcWriteScope: nfcWriteScope(settings.nfcPublicBaseUrl),
      nfcBaseUrlEditable: !config.isVercel && !config.publicAppUrl,
      imageGenerationEnabled: config.imageGenerationEnabled,
    },
    providers: {
      chat: {
        mode: settings.chatProviderMode,
        model: config.chatModel,
        configured: settings.chatProviderMode === 'mock' ? true : isChatCloudConfigured(),
        cloudKeyAvailable: isChatCloudConfigured(),
        viaOpenAICompatible: Boolean(config.chatApiBase),
        firstTokenTimeoutMs: config.chatFirstTokenTimeoutMs,
        firstTokenTargetMs: 3000,
        contextMaxMessages: config.chatContextMaxMessages,
      },
      image: {
        mode: settings.imageProviderMode,
        model: settings.imageModel,
        tier: settings.imageModelTier,
        tierLabel: IMAGE_TIER_LABELS[settings.imageModelTier],
        configured: settings.imageProviderMode === 'mock' || isImageCloudConfigured(settings.imageVendor),
        cloudKeyAvailable: isImageCloudConfigured(settings.imageVendor),
        viaOpenAICompatible: settings.imageVendor === 'openai',
        timeoutMs: config.imageTimeoutMs,
        performanceTargetMs: 40000,
        maxRegenerations: config.maxRegenerations,
        strictMaterialConstraint: settings.strictMaterialConstraint,
      },
      output: {
        mode: config.outputProvider,
        physicalExecutedSupported: false,
      },
    },
    counts: {
      demoDolls: (await db.prepare(`SELECT COUNT(*) AS c FROM dolls WHERE kind = 'demo'`).get() as { c: number }).c,
      personalDolls: (await db.prepare(`SELECT COUNT(*) AS c FROM dolls WHERE kind = 'personal'`).get() as { c: number }).c,
      cards: (await db.prepare(`SELECT COUNT(*) AS c FROM cards`).get() as { c: number }).c,
      personas: (await db.prepare(`SELECT COUNT(*) AS c FROM personas`).get() as { c: number }).c,
      materialsTotal: allMaterials.length,
      materialsInStock: allMaterials.filter((m) => m.inStock).length,
    },
    nfcTags: nfcTagRows.map((t) => ({
      alias: String(t.alias),
      dollId: String(t.doll_id),
      label: String(t.label),
      dollName: t.doll_name ? String(t.doll_name) : String(t.doll_id),
      dollKind: t.doll_kind ? String(t.doll_kind) : 'demo',
      personaMbti: t.persona_mbti ? String(t.persona_mbti) : '',
      personaName: t.persona_name ? String(t.persona_name) : '',
      nfcUrl: `${liveBaseUrl}/nfc/${t.alias}`,
      directUrl: `${liveBaseUrl}/d/${t.doll_id}/chat?entry=nfc`,
      lastWrittenAt: t.last_written_at ? String(t.last_written_at) : null,
      createdAt: String(t.created_at),
    })),
    dollsForNfc: allDolls.map((d) => ({
      id: String(d.id),
      name: String(d.name),
      kind: String(d.kind),
      personaMbti: String(d.persona_mbti),
      personaName: String(d.persona_name),
      directUrl: `${liveBaseUrl}/d/${d.id}/chat?entry=nfc`,
    })),
    metrics: {
      chat: chatStats,
      image: versionStats,
      output: outputStats,
    },
    activeSessions,
    recentErrors,
    recentRuns,
  });
});

router.patch('/demo/settings', requireAdmin, async (req, res) => {
  const body = req.body ?? {};

  if (typeof body.nfcPublicBaseUrl === 'string') {
    const validated = validatePublicBaseUrl(body.nfcPublicBaseUrl);
    if (validated === null) {
      sendError(req, res, 400, 'INVALID_INPUT', '工位访问地址须以 http:// 或 https:// 开头，或留空使用默认地址');
      return;
    }
    await setRuntimeSetting('nfc_public_base_url', validated);
  }

  if (body.imageModelTier !== undefined) {
    const tier = String(body.imageModelTier).trim() as ImageModelTier;
    if (tier !== 'fast' && tier !== 'hd') {
      sendError(req, res, 400, 'INVALID_INPUT', 'imageModelTier 仅支持 fast 或 hd');
      return;
    }
    await setRuntimeSetting('image_model_tier', tier);
  }

  if (body.chatProviderMode !== undefined) {
    const mode = String(body.chatProviderMode).trim() as ProviderMode;
    if (mode !== 'cloud' && mode !== 'mock') {
      sendError(req, res, 400, 'INVALID_INPUT', 'chatProviderMode 仅支持 cloud 或 mock');
      return;
    }
    await setRuntimeSetting('chat_provider_mode', mode);
  }

  if (body.imageVendor !== undefined) {
    if (body.imageVendor !== 'openai' && body.imageVendor !== 'gemini') {
      sendError(req, res, 400, 'INVALID_INPUT', 'imageVendor 仅支持 openai 或 gemini');
      return;
    }
    await setRuntimeSetting('image_vendor', body.imageVendor);
  }

  if (body.imageProviderMode !== undefined) {
    const mode = String(body.imageProviderMode).trim() as ProviderMode;
    if (mode !== 'cloud' && mode !== 'mock') {
      sendError(req, res, 400, 'INVALID_INPUT', 'imageProviderMode 仅支持 cloud 或 mock');
      return;
    }
    await setRuntimeSetting('image_provider_mode', mode);
  }

  if (typeof body.strictMaterialConstraint === 'boolean') {
    await setRuntimeSetting('strict_material_constraint', body.strictMaterialConstraint ? 'true' : 'false');
  }

  const updated = await getRuntimeSettings();
  await recordRunLog({
    id: `log_${crypto.randomBytes(6).toString('hex')}`,
    kind: 'system',
    provider: 'admin',
    status: 'succeeded',
    detail: `settings updated tier=${updated.imageModelTier} chat=${updated.chatProviderMode} img=${updated.imageProviderMode} strictMat=${updated.strictMaterialConstraint}`,
  });

  sendSuccess(res, {
    ...updated,
    effectiveBaseUrl: buildPublicBaseUrl(req, updated.nfcPublicBaseUrl),
    nfcWriteScope: nfcWriteScope(updated.nfcPublicBaseUrl),
    nfcBaseUrlEditable: !config.isVercel && !config.publicAppUrl,
    imageGenerationEnabled: config.imageGenerationEnabled,
    imageModelTierLabel: IMAGE_TIER_LABELS[updated.imageModelTier],
  });
});

// ---- Admin NFC Tag Management ----
router.post('/demo/nfc-tags', requireAdmin, async (req, res) => {
  const alias = typeof req.body?.alias === 'string' ? req.body.alias.trim().toLowerCase() : '';
  const dollId = typeof req.body?.dollId === 'string' ? req.body.dollId.trim() : '';
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';

  if (!/^[a-z0-9_-]{2,32}$/.test(alias)) {
    sendError(req, res, 400, 'INVALID_INPUT', '标签短码需为 2–32 位小写字母、数字、连字符或下划线');
    return;
  }
  const doll = await db.prepare(`SELECT id, name FROM dolls WHERE id = ?`).get(dollId) as
    | { id: string; name: string }
    | undefined;
  if (!doll) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到目标娃娃');
    return;
  }

  const finalLabel = (label || `${doll.name} · NFC 展位签`).slice(0, 60);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO nfc_tags (alias, doll_id, label, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(alias) DO UPDATE SET doll_id = excluded.doll_id, label = excluded.label,
       last_written_at = CASE WHEN nfc_tags.doll_id = excluded.doll_id THEN nfc_tags.last_written_at ELSE NULL END`
  ).run(alias, dollId, finalLabel, now);

  const baseUrl = await getLiveBaseUrl(req);
  sendSuccess(
    res,
    {
      alias,
      dollId,
      label: finalLabel,
      nfcUrl: `${baseUrl}/nfc/${alias}`,
    },
    201
  );
});

router.post('/demo/nfc-tags/:alias/written', requireAdmin, async (req, res) => {
  const alias = String(req.params.alias).trim().toLowerCase();
  const settings = await getRuntimeSettings();
  const scope = nfcWriteScope(settings.nfcPublicBaseUrl);
  const expectedUrl = `${buildPublicBaseUrl(req, settings.nfcPublicBaseUrl)}/nfc/${alias}`;
  if (scope === 'unavailable' || req.body?.scope !== scope || req.body?.url !== expectedUrl) {
    sendError(req, res, 409, 'NFC_RECORD_MISMATCH', '读回的 URL 必须与当前环境下该标签的完整 HTTPS 地址一致');
    return;
  }
  const now = new Date().toISOString();
  const upd = await db
    .prepare(`UPDATE nfc_tags SET last_written_at = ? WHERE LOWER(alias) = ?`)
    .run(now, alias);

  if (upd.changes === 0) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的 NFC 标签映射');
    return;
  }
  sendSuccess(res, { alias, lastWrittenAt: now });
});

// ---- Admin Real Craft Materials Inventory CRUD + JSON Import ----
router.get('/demo/materials', requireAdmin, async (_req, res) => {
  sendSuccess(res, {
    categories: MATERIAL_CATEGORY_LABELS,
    items: await listMaterials(false),
  });
});

router.post('/demo/materials', requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const rawId = typeof body.id === 'string' && body.id.trim()
    ? body.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    : `mat_${crypto.randomBytes(4).toString('hex')}`;
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const category = (typeof body.category === 'string' ? body.category.trim() : 'hardware_charm') as MaterialCategory;
  const material = typeof body.material === 'string' ? body.material.trim() : '';
  const visualHint = typeof body.visualHint === 'string' ? body.visualHint.trim() : '';
  const inStock = body.inStock !== false;
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 50;

  if (!label || label.length > 40) {
    sendError(req, res, 400, 'INVALID_INPUT', '材料名称需在 1–40 字之间');
    return;
  }
  if (!VALID_MATERIAL_CATEGORIES.has(category)) {
    sendError(req, res, 400, 'INVALID_INPUT', '无效的材料分类');
    return;
  }
  if (!material || material.length > 60) {
    sendError(req, res, 400, 'INVALID_INPUT', '材质说明需在 1–60 字之间');
    return;
  }

  const finalVisualHint = (visualHint || `handmade ${material} craft accessory (${label})`).slice(0, 260);
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO materials (id, label, category, material, visual_hint, in_stock, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       category = excluded.category,
       material = excluded.material,
       visual_hint = excluded.visual_hint,
       in_stock = excluded.in_stock,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`
  ).run(rawId, label, category, material, finalVisualHint, inStock ? 1 : 0, sortOrder, now, now);

  sendSuccess(
    res,
    {
      id: rawId,
      label,
      category,
      material,
      visualHint: finalVisualHint,
      inStock,
      sortOrder,
    },
    201
  );
});

router.patch('/demo/materials/:id', requireAdmin, async (req, res) => {
  const matId = req.params.id;
  const existing = await db.prepare(`SELECT * FROM materials WHERE id = ?`).get(matId) as Record<string, unknown> | undefined;
  if (!existing) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的材料条目');
    return;
  }

  const body = req.body ?? {};
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 40) : String(existing.label);
  const category = (typeof body.category === 'string' && VALID_MATERIAL_CATEGORIES.has(body.category as MaterialCategory)
    ? body.category
    : existing.category) as MaterialCategory;
  const material = typeof body.material === 'string' && body.material.trim() ? body.material.trim().slice(0, 60) : String(existing.material);
  const visualHint = typeof body.visualHint === 'string' && body.visualHint.trim() ? body.visualHint.trim().slice(0, 260) : String(existing.visual_hint);
  const inStock = typeof body.inStock === 'boolean' ? (body.inStock ? 1 : 0) : Number(existing.in_stock);
  const now = new Date().toISOString();

  await db.prepare(
    `UPDATE materials
     SET label = ?, category = ?, material = ?, visual_hint = ?, in_stock = ?, updated_at = ?
     WHERE id = ?`
  ).run(label, category, material, visualHint, inStock, now, matId);

  sendSuccess(res, {
    id: matId,
    label,
    category,
    material,
    visualHint,
    inStock: inStock === 1,
  });
});

router.delete('/demo/materials/:id', requireAdmin, async (req, res) => {
  const matId = req.params.id;
  const del = await db.prepare(`DELETE FROM materials WHERE id = ?`).run(matId);
  if (del.changes === 0) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到要删除的材料');
    return;
  }
  res.status(204).end();
});

router.post('/demo/materials/import', requireAdmin, async (req, res) => {
  const mode = req.body?.mode === 'replace' ? 'replace' : 'merge';
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : null;

  if (!rawItems || rawItems.length === 0) {
    sendError(req, res, 400, 'INVALID_INPUT', '请提供非空的材料列表 JSON（items 数组）');
    return;
  }
  if (rawItems.length > 100) {
    sendError(req, res, 400, 'INVALID_INPUT', '单次最多导入 100 条材料记录');
    return;
  }

  const normalized: Array<{
    id: string;
    label: string;
    category: MaterialCategory;
    material: string;
    visualHint: string;
    inStock: number;
    sortOrder: number;
  }> = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i] as Record<string, unknown>;
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    const material = typeof item?.material === 'string' ? item.material.trim() : '';
    if (!label || !material) {
      sendError(req, res, 400, 'INVALID_INPUT', `第 ${i + 1} 条材料缺少必填字段 label 或 material`);
      return;
    }
    const rawCat = typeof item?.category === 'string' ? item.category.trim() : 'hardware_charm';
    const category = VALID_MATERIAL_CATEGORIES.has(rawCat as MaterialCategory)
      ? (rawCat as MaterialCategory)
      : 'hardware_charm';
    const id =
      typeof item?.id === 'string' && item.id.trim()
        ? item.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 48)
        : `mat_imp_${i + 1}_${crypto.randomBytes(3).toString('hex')}`;
    const visualHint =
      typeof item?.visualHint === 'string' && item.visualHint.trim()
        ? item.visualHint.trim().slice(0, 260)
        : `handmade ${material} craft component (${label})`;

    normalized.push({
      id,
      label: label.slice(0, 40),
      category,
      material: material.slice(0, 60),
      visualHint,
      inStock: item?.inStock === false ? 0 : 1,
      sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : (i + 1) * 5,
    });
  }

  const now = new Date().toISOString();
  const tx = db.transaction(async () => {
    if (mode === 'replace') {
      await db.prepare(`DELETE FROM materials`).run();
    }
    const upsert = db.prepare(
      `INSERT INTO materials (id, label, category, material, visual_hint, in_stock, sort_order, created_at, updated_at)
       VALUES (@id, @label, @category, @material, @visualHint, @inStock, @sortOrder, @now, @now)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         category = excluded.category,
         material = excluded.material,
         visual_hint = excluded.visual_hint,
         in_stock = excluded.in_stock,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`
    );
    for (const row of normalized) {
      await upsert.run({ ...row, now });
    }
  });
  await tx();

  sendSuccess(res, {
    mode,
    importedCount: normalized.length,
    totalCount: (await listMaterials(false)).length,
  });
});

router.post('/demo/reset', requireAdmin, async (req, res) => {
  const targetSessionId =
    typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
      ? req.body.sessionId.trim()
      : (await loadExistingSession(req))?.id || '';

  if (!targetSessionId) {
    sendError(req, res, 400, 'INVALID_INPUT', '请提供要重置的演示 sessionId');
    return;
  }

  const sessionRow = await db
    .prepare(`SELECT id, is_demo, invalidated FROM sessions WHERE id = ?`)
    .get(targetSessionId) as { id: string; is_demo: number; invalidated: number } | undefined;

  if (!sessionRow) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到指定的演示会话');
    return;
  }
  if (sessionRow.is_demo !== 1) {
    sendError(req, res, 403, 'INVALID_INPUT', '仅允许重置标记为 isDemo=true 的演示会话');
    return;
  }

  const runningVer = await db
    .prepare(
      `SELECT cv.id
       FROM card_versions cv
       JOIN cards c ON c.id = cv.card_id
       WHERE c.owner_session_id = ? AND cv.status = 'running'
       LIMIT 1`
    )
    .get(targetSessionId);

  const runningJob = await db
    .prepare(`SELECT id FROM output_jobs WHERE owner_session_id = ? AND status = 'running' LIMIT 1`)
    .get(targetSessionId);

  const runningChat = await db.prepare(
    `SELECT 1 FROM messages WHERE session_id = ? AND role = 'assistant'
       AND status IN ('pending', 'streaming') AND created_at > ? LIMIT 1`
  ).get(targetSessionId, new Date(Date.now() - 75_000).toISOString());

  if (runningVer || runningJob || runningChat) {
    sendError(
      req,
      res,
      409,
      'TASK_ALREADY_RUNNING',
      '该演示会话仍有运行中的生成、出图或对话任务，已拒绝重置以保护执行器状态，请稍后再试'
    );
    return;
  }

  const filesToDelete: MediaKey[] = [];
  const cards = await db
    .prepare(`SELECT id, photo_ref FROM cards WHERE owner_session_id = ?`)
    .all(targetSessionId) as Array<{ id: string; photo_ref: string }>;

  for (const c of cards) {
    filesToDelete.push(`photos/${c.photo_ref}`);
    const vers = await db
      .prepare(`SELECT result_url, result_kind FROM card_versions WHERE card_id = ?`)
      .all(c.id) as Array<{ result_url: string | null; result_kind: string }>;
    for (const v of vers) {
      if (v.result_url && v.result_url.startsWith('/api/assets/generated/')) {
        const fname = path.basename(v.result_url);
        filesToDelete.push(`generated/${fname}`);
      }
    }
  }

  const resetTx = db.transaction(async () => {
    await db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(targetSessionId);
    await db.prepare(`DELETE FROM memories WHERE session_id = ?`).run(targetSessionId);
    await db.prepare(`DELETE FROM output_jobs WHERE owner_session_id = ?`).run(targetSessionId);
    await db.prepare(`DELETE FROM dolls WHERE kind = 'personal' AND owner_session_id = ?`).run(targetSessionId);
    await db.prepare(`DELETE FROM cards WHERE owner_session_id = ?`).run(targetSessionId);
    await db.prepare(`DELETE FROM idempotency_keys WHERE session_id = ?`).run(targetSessionId);
    await db.prepare(`DELETE FROM session_claim_codes WHERE session_id = ?`).run(targetSessionId);
    await db.prepare(`UPDATE sessions SET invalidated = 1 WHERE id = ?`).run(targetSessionId);
  });
  await resetTx();

  for (const key of filesToDelete) {
    await deleteMedia(key).catch((error) => {
      console.error('[media] reset cleanup failed', key, (error as { code?: string }).code);
    });
  }

  const callerSession = await loadExistingSession(req);
  if (callerSession?.id === targetSessionId) {
    clearSessionCookie(req, res);
  }

  sendSuccess(res, {
    resetSessionId: targetSessionId,
    invalidated: true,
    preservedDemoDolls: true,
  });
});

export default router;
