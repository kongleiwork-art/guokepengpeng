import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import {
  buildPublicBaseUrl,
  config,
  isChatCloudConfigured,
  isImageCloudConfigured,
} from '../config.ts';
import {
  ACCESSORY_OPTIONS,
  FALLBACK_TEMPLATES,
  getAccessoryLabels,
} from '../data/seed.ts';
import { db, recordRunLog } from '../db.ts';
import {
  clearSessionCookie,
  createNewSession,
  ensureSession,
  loadExistingSession,
  requireAdmin,
  sendError,
  sendSuccess,
  setSessionCookie,
} from '../middleware/session.ts';
import { getChatProvider } from '../providers/chatProvider.ts';
import { validateImageBuffer } from '../utils/imageValidation.ts';
import {
  enqueueImageVersion,
  enqueueOutputJob,
  markJobSimulateFail,
  markVersionSimulateFail,
} from '../workers/taskWorker.ts';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // Accept up to 5MB in multer so our validator returns clean IMAGE_TOO_LARGE (>2MB)
  },
});

const inFlightChats = new Set<string>();

function hashObject(obj: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function checkIdempotency(
  sessionId: string,
  operation: string,
  key: string | undefined,
  requestHash: string
):
  | { hit: false }
  | { hit: true; conflict: true }
  | { hit: true; conflict: false; status: number; body: unknown } {
  if (!key || !key.trim()) return { hit: false };
  const row = db
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

function saveIdempotency(
  sessionId: string,
  operation: string,
  key: string | undefined,
  requestHash: string,
  status: number,
  body: unknown
): void {
  if (!key || !key.trim()) return;
  db.prepare(
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
// 1. Health & Session
// ============================================================
router.get('/health', (_req, res) => {
  sendSuccess(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

router.post('/session', (req, res) => {
  let session = loadExistingSession(req);
  if (!session) {
    session = createNewSession();
  }
  setSessionCookie(req, res, session);
  sendSuccess(res, {
    sessionId: session.id,
    isDemo: session.isDemo,
    expiresAt: session.expiresAt,
  });
});

// ============================================================
// 2. Personas, Accessories & Templates (public fields only)
// ============================================================
router.get('/personas', ensureSession, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, mbti, tagline, material_hint, opening_line, featured
       FROM personas
       ORDER BY featured DESC, mbti ASC`
    )
    .all() as Array<{
    id: string;
    name: string;
    mbti: string;
    tagline: string;
    material_hint: string;
    opening_line: string;
    featured: number;
  }>;

  sendSuccess(
    res,
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      mbti: r.mbti,
      tagline: r.tagline,
      materialHint: r.material_hint,
      openingLine: r.opening_line,
      featured: r.featured === 1,
    }))
  );
});

router.get('/accessories', ensureSession, (_req, res) => {
  sendSuccess(res, ACCESSORY_OPTIONS);
});

router.get('/templates', ensureSession, (_req, res) => {
  sendSuccess(res, FALLBACK_TEMPLATES);
});

// ============================================================
// 3. Dolls (Demo + Session Personal)
// ============================================================
router.get('/dolls', ensureSession, (req, res) => {
  const sessionId = req.session!.id;
  const baseUrl = buildPublicBaseUrl(req);

  const rows = db
    .prepare(
      `SELECT d.id, d.kind, d.name, d.avatar_url, d.card_id, d.card_version_id, d.created_at,
              p.id AS persona_id, p.name AS persona_name, p.mbti AS persona_mbti,
              p.tagline AS persona_tagline, p.material_hint AS persona_material_hint,
              p.opening_line AS persona_opening_line
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
      createdAt: r.created_at,
      persona: {
        id: r.persona_id,
        name: r.persona_name,
        mbti: r.persona_mbti,
        tagline: r.persona_tagline,
        materialHint: r.persona_material_hint,
        openingLine: r.persona_opening_line,
      },
    }))
  );
});

router.get('/dolls/:id', ensureSession, async (req, res) => {
  const dollId = req.params.id;
  const baseUrl = buildPublicBaseUrl(req);

  const row = db
    .prepare(
      `SELECT d.id, d.kind, d.owner_session_id, d.name, d.avatar_url, d.card_id, d.card_version_id, d.created_at,
              p.id AS persona_id, p.name AS persona_name, p.mbti AS persona_mbti,
              p.tagline AS persona_tagline, p.material_hint AS persona_material_hint,
              p.opening_line AS persona_opening_line
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
  const isOwner = row.kind === 'personal' && row.owner_session_id === req.session!.id;
  const qrSvg = await generateQrSvg(dollUrl);

  // Public doll profile NEVER exposes raw photoRef or other visitors' private data
  sendSuccess(res, {
    id: row.id,
    kind: row.kind,
    name: row.name,
    avatarUrl: row.avatar_url,
    dollUrl,
    qrData: dollUrl,
    qrSvg,
    isOwner,
    cardUrl: isOwner && row.card_id ? `${baseUrl}/card/${row.card_id}` : null,
    cardId: isOwner ? row.card_id : null,
    createdAt: row.created_at,
    persona: {
      id: row.persona_id,
      name: row.persona_name,
      mbti: row.persona_mbti,
      tagline: row.persona_tagline,
      materialHint: row.persona_material_hint,
      openingLine: row.persona_opening_line,
    },
  });
});

router.patch('/dolls/:id', ensureSession, (req, res) => {
  const dollId = req.params.id;
  const sessionId = req.session!.id;
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

  if (!rawName || rawName.length > 32) {
    sendError(req, res, 400, 'VALIDATION_ERROR', '名称长度需在 1 到 32 个字符之间');
    return;
  }

  const row = db
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

  const now = new Date().toISOString();
  db.prepare(`UPDATE dolls SET name = ? WHERE id = ?`).run(rawName, dollId);
  db.prepare(
    `UPDATE memories
     SET value = ?, updated_at = ?
     WHERE doll_id = ? AND session_id = ? AND type = 'doll_name'`
  ).run(rawName, now, dollId, sessionId);

  sendSuccess(res, { id: dollId, name: rawName });
});

// ============================================================
// 4. Messages & Streaming Chat (SSE)
// ============================================================
router.get('/dolls/:id/messages', ensureSession, (req, res) => {
  const dollId = req.params.id;
  const sessionId = req.session!.id;

  const dollExists = db.prepare(`SELECT id FROM dolls WHERE id = ?`).get(dollId);
  if (!dollExists) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的娃娃');
    return;
  }

  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim() ? req.query.cursor.trim() : null;

  let rows: Array<Record<string, unknown>>;
  if (cursor) {
    rows = db
      .prepare(
        `SELECT id, client_message_id, reply_attempt, role, content, status, provider, first_token_ms, total_ms, error_code, created_at
         FROM messages
         WHERE session_id = ? AND doll_id = ? AND created_at < ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(sessionId, dollId, cursor, limit) as Array<Record<string, unknown>>;
  } else {
    rows = db
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

  const dollRow = db
    .prepare(
      `SELECT d.id, d.kind, d.name,
              p.id AS persona_id, p.name AS persona_name, p.mbti AS persona_mbti,
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
        persona_prompt: string;
        persona_opening_line: string;
      }
    | undefined;

  if (!dollRow) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的娃娃');
    return;
  }

  const chatKey = `${sessionId}:${dollId}:${clientMessageId}`;
  if (inFlightChats.has(chatKey)) {
    sendError(req, res, 409, 'TASK_ALREADY_RUNNING', '该消息正在生成回复中，请勿重复发送');
    return;
  }

  // Check if an assistant reply for this clientMessageId is already completed (idempotent replay)
  const completedReply = db
    .prepare(
      `SELECT id, content, provider, status
       FROM messages
       WHERE session_id = ? AND doll_id = ? AND client_message_id = ? AND role = 'assistant' AND status = 'completed'
       ORDER BY reply_attempt DESC
       LIMIT 1`
    )
    .get(sessionId, dollId, clientMessageId) as
    | { id: string; content: string; provider: string; status: string }
    | undefined;

  if (completedReply) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    writeSseEvent(res, 'meta', {
      requestId: req.requestId,
      clientMessageId,
      provider: completedReply.provider || config.chatProvider,
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

  // Check provider configuration BEFORE opening SSE stream (Section 10)
  const providerMode = config.chatProvider;
  if (providerMode === 'cloud' && !isChatCloudConfigured()) {
    sendError(
      req,
      res,
      503,
      'PROVIDER_NOT_CONFIGURED',
      '当前 CHAT_PROVIDER=cloud，但服务端未配置有效的 GEMINI_API_KEY 或 CHAT_API_KEY（本系统不静默回退为 mock）'
    );
    return;
  }

  // Persist user message BEFORE calling model (deduplicated by sessionId + dollId + clientMessageId)
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO messages (id, session_id, doll_id, client_message_id, reply_attempt, role, content, status, created_at)
     VALUES (?, ?, ?, ?, 0, 'user', ?, 'completed', ?)`
  ).run(`msg_${crypto.randomBytes(8).toString('hex')}`, sessionId, dollId, clientMessageId, text, now);

  // Explicit memory write (rememberText field OR explicit prefix "记住：" / "记住:")
  let savedMemoryId: string | null = null;
  let rememberToSave = explicitRemember;
  if (!rememberToSave) {
    const match = text.match(/^记住[：:]\s*(.+)$/);
    if (match && match[1].trim()) {
      rememberToSave = match[1].trim();
    }
  }
  if (rememberToSave) {
    const existingMem = db
      .prepare(
        `SELECT id FROM memories WHERE session_id = ? AND doll_id = ? AND type = 'fact' AND value = ? LIMIT 1`
      )
      .get(sessionId, dollId, rememberToSave) as { id: string } | undefined;

    if (!existingMem) {
      savedMemoryId = `mem_${crypto.randomBytes(8).toString('hex')}`;
      db.prepare(
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

  // Compute reply_attempt for this clientMessageId
  const lastAttemptRow = db
    .prepare(
      `SELECT MAX(reply_attempt) AS max_attempt
       FROM messages
       WHERE session_id = ? AND doll_id = ? AND client_message_id = ? AND role = 'assistant'`
    )
    .get(sessionId, dollId, clientMessageId) as { max_attempt: number | null };
  const replyAttempt = (lastAttemptRow?.max_attempt ?? 0) + 1;

  // Fetch explicit memories for (sessionId, dollId)
  const memories = db
    .prepare(
      `SELECT type, value, source
       FROM memories
       WHERE session_id = ? AND doll_id = ?
       ORDER BY created_at ASC`
    )
    .all(sessionId, dollId) as Array<{ type: string; value: string; source: string }>;

  // Fetch recent completed history messages (exclude current user message and failed/incomplete assistant messages)
  const historyRows = db
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

  // Create pending assistant message row
  const assistantMessageId = `reply_${crypto.randomBytes(8).toString('hex')}`;
  const replyCreatedAt = new Date(Date.now() + 2).toISOString();
  db.prepare(
    `INSERT INTO messages (id, session_id, doll_id, client_message_id, reply_attempt, role, content, status, provider, created_at)
     VALUES (?, ?, ?, ?, ?, 'assistant', '', 'streaming', ?, ?)`
  ).run(assistantMessageId, sessionId, dollId, clientMessageId, replyAttempt, providerMode, replyCreatedAt);

  // Open SSE stream
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  inFlightChats.add(chatKey);
  const abortController = new AbortController();
  let clientClosed = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientClosed = true;
      abortController.abort();
    }
  });

  writeSseEvent(res, 'meta', {
    requestId: req.requestId,
    clientMessageId,
    assistantMessageId,
    provider: providerMode,
    savedMemoryId,
  });

  const startedAt = Date.now();
  let firstTokenMs: number | null = null;
  let accumulated = '';
  let endedWithEvent = false;

  try {
    const provider = getChatProvider(providerMode);
    for await (const event of provider.streamChat({
      dollName: dollRow.name,
      dollKind: dollRow.kind,
      persona: {
        id: dollRow.persona_id,
        name: dollRow.persona_name,
        mbti: dollRow.persona_mbti,
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
        db.prepare(
          `UPDATE messages
           SET content = ?, status = 'completed', provider_request_id = ?, first_token_ms = ?, total_ms = ?
           WHERE id = ?`
        ).run(accumulated, event.providerRequestId ?? null, firstTokenMs, totalMs, assistantMessageId);

        recordRunLog({
          id: `log_${crypto.randomBytes(6).toString('hex')}`,
          kind: 'chat',
          provider: providerMode,
          resultKind: providerMode === 'cloud' ? 'generated' : 'mock',
          status: 'succeeded',
          firstTokenMs,
          totalMs,
          requestId: event.providerRequestId ?? req.requestId,
          detail: `doll=${dollId} attempt=${replyAttempt}`,
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
        db.prepare(
          `UPDATE messages
           SET content = ?, status = ?, error_code = ?, first_token_ms = ?, total_ms = ?
           WHERE id = ?`
        ).run(accumulated, failStatus, event.code, firstTokenMs, totalMs, assistantMessageId);

        recordRunLog({
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
      db.prepare(
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
    const message = err instanceof Error ? err.message : '对话执行发生未知错误';
    db.prepare(
      `UPDATE messages
       SET content = ?, status = 'failed', error_code = 'PROVIDER_ERROR', first_token_ms = ?, total_ms = ?
       WHERE id = ?`
    ).run(accumulated, firstTokenMs, totalMs, assistantMessageId);

    if (!clientClosed && !res.writableEnded) {
      writeSseEvent(res, 'error', {
        code: 'PROVIDER_ERROR',
        message,
        requestId: req.requestId,
      });
    }
  } finally {
    inFlightChats.delete(chatKey);
    if (!res.writableEnded) {
      res.end();
    }
  }
});

// ============================================================
// 5. Explicit Memory CRUD (scoped by sessionId + dollId)
// ============================================================
router.get('/dolls/:id/memory', ensureSession, (req, res) => {
  const dollId = req.params.id;
  const sessionId = req.session!.id;

  const dollExists = db.prepare(`SELECT id FROM dolls WHERE id = ?`).get(dollId);
  if (!dollExists) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的娃娃');
    return;
  }

  const rows = db
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

router.post('/dolls/:id/memory', ensureSession, (req, res) => {
  const dollId = req.params.id;
  const sessionId = req.session!.id;

  const dollExists = db.prepare(`SELECT id FROM dolls WHERE id = ?`).get(dollId);
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
  // For single-value fields like user_nickname, replace previous entry cleanly
  if (type === 'user_nickname') {
    db.prepare(
      `DELETE FROM memories WHERE session_id = ? AND doll_id = ? AND type = 'user_nickname'`
    ).run(sessionId, dollId);
  }

  const memoryId = `mem_${crypto.randomBytes(8).toString('hex')}`;
  db.prepare(
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

router.delete('/dolls/:id/memory/:memoryId', ensureSession, (req, res) => {
  const dollId = req.params.id;
  const memoryId = req.params.memoryId;
  const sessionId = req.session!.id;

  const del = db
    .prepare(`DELETE FROM memories WHERE id = ? AND doll_id = ? AND session_id = ?`)
    .run(memoryId, dollId, sessionId);

  if (del.changes === 0) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到可删除的记忆记录');
    return;
  }
  res.status(204).end();
});

// ============================================================
// 6. Cards, Versions, Redraw, Cancel, Fallback & Bind
// ============================================================
router.get('/cards', ensureSession, (req, res) => {
  const sessionId = req.session!.id;
  const baseUrl = buildPublicBaseUrl(req);
  const maxAttempts = 1 + config.maxRegenerations;

  const cards = db
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
    cards.map((c) => {
      const versions = (versionsStmt.all(c.id) as Array<Record<string, unknown>>).map(formatCardVersion);
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
    })
  );
});

router.post('/cards', ensureSession, (req, res) => {
  upload.single('photo')(req, res, (multerErr) => {
    if (multerErr) {
      const isSizeErr = multerErr instanceof multer.MulterError && multerErr.code === 'LIMIT_FILE_SIZE';
      sendError(
        req,
        res,
        isSizeErr ? 413 : 400,
        isSizeErr ? 'IMAGE_TOO_LARGE' : 'INVALID_INPUT',
        isSizeErr ? '图片体积超过限制（最大 2 MB）' : multerErr.message
      );
      return;
    }

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
        accessoryIds = Array.isArray(parsed) ? parsed.map(String) : req.body.accessoryIds.split(',').map((s: string) => s.trim()).filter(Boolean);
      } catch {
        accessoryIds = req.body.accessoryIds.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }
    const validAccessorySet = new Set(ACCESSORY_OPTIONS.map((a) => a.id));
    accessoryIds = accessoryIds.filter((id) => validAccessorySet.has(id));

    if (!req.file?.buffer) {
      sendError(req, res, 400, 'INVALID_INPUT', '请上传一张 JPEG、PNG 或 WebP 照片');
      return;
    }
    if (!userNickname || userNickname.length > 32) {
      sendError(req, res, 400, 'INVALID_INPUT', '请填写 1–32 字的你的称呼');
      return;
    }
    const personaExists = db.prepare(`SELECT id FROM personas WHERE id = ?`).get(personaId);
    if (!personaExists) {
      sendError(req, res, 400, 'INVALID_INPUT', '请选择有效的人格设定');
      return;
    }

    // Validate image binary content & 2MB limit
    let validatedImage;
    try {
      validatedImage = validateImageBuffer(req.file.buffer);
    } catch (err: unknown) {
      const e = err as { status?: number; code?: string; message?: string };
      sendError(req, res, e.status || 400, e.code || 'UNSUPPORTED_IMAGE', e.message || '图片校验失败');
      return;
    }

    // Check idempotency before creating card
    const photoHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const requestHash = hashObject({ userNickname, personaId, accessoryIds, photoHash });
    const idem = checkIdempotency(sessionId, 'create_card', idempotencyKey, requestHash);
    if (idem.hit) {
      if (idem.conflict) {
        sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', '相同幂等键提交了不同的创作参数');
        return;
      }
      res.status(idem.status).json(idem.body);
      return;
    }

    // Check cloud image configuration before creating task
    const providerMode = config.imageProvider;
    if (providerMode === 'cloud' && !isImageCloudConfigured()) {
      sendError(
        req,
        res,
        503,
        'PROVIDER_NOT_CONFIGURED',
        '当前 IMAGE_PROVIDER=cloud，但服务端未配置有效的 IMAGE_API_KEY 或 GEMINI_API_KEY（不静默回退为 mock）'
      );
      return;
    }

    const cardId = `card_${crypto.randomBytes(8).toString('hex')}`;
    const versionId = `ver_${crypto.randomBytes(8).toString('hex')}`;
    const photoFilename = `${cardId}.${validatedImage.ext}`;
    const photoAbsPath = path.join(config.storagePath, 'photos', photoFilename);
    fs.writeFileSync(photoAbsPath, req.file.buffer);

    const now = new Date();
    const photoExpiresAt = new Date(now.getTime() + config.photoTtlHours * 3600 * 1000).toISOString();
    const nowIso = now.toISOString();
    const resultKind = providerMode === 'cloud' ? 'generated' : 'mock';

    const createTx = db.transaction(() => {
      db.prepare(
        `INSERT INTO cards (id, owner_session_id, photo_ref, photo_mime, photo_expires_at, user_nickname, persona_id, accessory_ids, active_version_id, bound_doll_id, generation_attempts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`
      ).run(
        cardId,
        sessionId,
        photoFilename,
        validatedImage.mimeType,
        photoExpiresAt,
        userNickname,
        personaId,
        JSON.stringify(accessoryIds),
        versionId,
        nowIso
      );

      db.prepare(
        `INSERT INTO card_versions (id, card_id, version_number, status, provider, result_kind, created_at)
         VALUES (?, ?, 1, 'queued', ?, ?, ?)`
      ).run(versionId, cardId, providerMode, resultKind, nowIso);
    });
    createTx();

    if (req.get('x-mock-fail') === 'true' && providerMode === 'mock') {
      markVersionSimulateFail(versionId);
    }

    const baseUrl = buildPublicBaseUrl(req);
    const responsePayload = {
      data: {
        cardId,
        versionId,
        status: 'queued',
        provider: providerMode,
        cardUrl: `${baseUrl}/card/${cardId}`,
        processingUrl: `${baseUrl}/create/processing?cardId=${cardId}`,
      },
    };
    saveIdempotency(sessionId, 'create_card', idempotencyKey, requestHash, 202, responsePayload);
    enqueueImageVersion(versionId);

    res.status(202).json(responsePayload);
  });
});

router.get('/cards/:id', ensureSession, async (req, res) => {
  const cardId = req.params.id;
  const sessionId = req.session!.id;
  const baseUrl = buildPublicBaseUrl(req);

  const card = db
    .prepare(
      `SELECT c.*, p.name AS persona_name, p.mbti AS persona_mbti, p.tagline AS persona_tagline, p.material_hint AS persona_material_hint
       FROM cards c
       JOIN personas p ON p.id = c.persona_id
       WHERE c.id = ? AND c.owner_session_id = ?`
    )
    .get(cardId, sessionId) as Record<string, unknown> | undefined;

  if (!card) {
    // Unowned private resources always return 404
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的创作卡片');
    return;
  }

  const versionRows = db
    .prepare(`SELECT * FROM card_versions WHERE card_id = ? ORDER BY version_number ASC`)
    .all(cardId) as Array<Record<string, unknown>>;

  const maxAttempts = 1 + config.maxRegenerations;
  const attempts = Number(card.generation_attempts || 0);
  const photoPath = path.join(config.storagePath, 'photos', String(card.photo_ref));
  const photoExpired =
    !fs.existsSync(photoPath) || new Date(String(card.photo_expires_at)).getTime() < Date.now();

  const cardUrl = `${baseUrl}/card/${cardId}`;
  const dollUrl = card.bound_doll_id ? `${baseUrl}/d/${card.bound_doll_id}` : null;
  const qrSvg = dollUrl ? await generateQrSvg(dollUrl) : null;

  let boundDoll = null;
  if (card.bound_doll_id) {
    const dRow = db
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
    accessoryIds: JSON.parse(String(card.accessory_ids || '[]')),
    accessoryLabels: getAccessoryLabels(JSON.parse(String(card.accessory_ids || '[]'))),
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

router.get('/cards/:id/photo', ensureSession, (req, res) => {
  const cardId = req.params.id;
  const sessionId = req.session!.id;

  const card = db
    .prepare(`SELECT photo_ref, photo_mime, photo_expires_at FROM cards WHERE id = ? AND owner_session_id = ?`)
    .get(cardId, sessionId) as
    | { photo_ref: string; photo_mime: string; photo_expires_at: string }
    | undefined;

  if (!card) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到原始照片');
    return;
  }

  const photoPath = path.join(config.storagePath, 'photos', card.photo_ref);
  if (!fs.existsSync(photoPath) || new Date(card.photo_expires_at).getTime() < Date.now()) {
    sendError(req, res, 410, 'PHOTO_EXPIRED', '原始照片已过期清理');
    return;
  }

  res.setHeader('Content-Type', card.photo_mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  fs.createReadStream(photoPath).pipe(res);
});

router.get('/card-versions/:id', ensureSession, (req, res) => {
  const versionId = req.params.id;
  const sessionId = req.session!.id;

  const row = db
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

  sendSuccess(res, formatCardVersion(row));
});

router.post('/cards/:id/redraw', ensureSession, (req, res) => {
  const cardId = req.params.id;
  const sessionId = req.session!.id;
  const idempotencyKey = extractIdempotencyKey(req);
  const simulateFail = req.get('x-mock-fail') === 'true' || req.body?.simulateFail === true;
  const requestHash = hashObject({ cardId, action: 'redraw', simulateFail });

  const idem = checkIdempotency(sessionId, `redraw:${cardId}`, idempotencyKey, requestHash);
  if (idem.hit) {
    if (idem.conflict) {
      sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', '相同幂等键提交了不同的重生成参数');
      return;
    }
    res.status(idem.status).json(idem.body);
    return;
  }

  const providerMode = config.imageProvider;
  if (providerMode === 'cloud' && !isImageCloudConfigured()) {
    sendError(
      req,
      res,
      503,
      'PROVIDER_NOT_CONFIGURED',
      '当前 IMAGE_PROVIDER=cloud，但服务端未配置有效的生图密钥'
    );
    return;
  }

  const maxAttempts = 1 + config.maxRegenerations;
  let newVersionId = '';
  let versionNumber = 0;

  try {
    const redrawTx = db.transaction(() => {
      const card = db
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

      const activeTask = db
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

      const photoPath = path.join(config.storagePath, 'photos', String(card.photo_ref));
      if (!fs.existsSync(photoPath) || new Date(String(card.photo_expires_at)).getTime() < Date.now()) {
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

      const maxVerRow = db
        .prepare(`SELECT MAX(version_number) AS max_v FROM card_versions WHERE card_id = ?`)
        .get(cardId) as { max_v: number | null };

      versionNumber = (maxVerRow?.max_v ?? 0) + 1;
      newVersionId = `ver_${crypto.randomBytes(8).toString('hex')}`;
      const resultKind = providerMode === 'cloud' ? 'generated' : 'mock';
      const nowIso = new Date().toISOString();

      db.prepare(
        `INSERT INTO card_versions (id, card_id, version_number, status, provider, result_kind, created_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?)`
      ).run(newVersionId, cardId, versionNumber, providerMode, resultKind, nowIso);

      db.prepare(
        `UPDATE cards SET generation_attempts = generation_attempts + 1, active_version_id = ? WHERE id = ?`
      ).run(newVersionId, cardId);
    });
    redrawTx();
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    sendError(req, res, e.status || 400, e.code || 'INVALID_INPUT', e.message || '无法发起重生成');
    return;
  }

  if (simulateFail && providerMode === 'mock') {
    markVersionSimulateFail(newVersionId);
  }

  const payload = {
    data: {
      cardId,
      versionId: newVersionId,
      versionNumber,
      status: 'queued',
      provider: providerMode,
    },
  };
  saveIdempotency(sessionId, `redraw:${cardId}`, idempotencyKey, requestHash, 202, payload);
  enqueueImageVersion(newVersionId);
  res.status(202).json(payload);
});

router.post('/card-versions/:id/cancel', ensureSession, (req, res) => {
  const versionId = req.params.id;
  const sessionId = req.session!.id;
  const idempotencyKey = extractIdempotencyKey(req);
  const requestHash = hashObject({ versionId, action: 'cancel' });

  const idem = checkIdempotency(sessionId, `cancel:${versionId}`, idempotencyKey, requestHash);
  if (idem.hit) {
    if (idem.conflict) {
      sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', '幂等键冲突');
      return;
    }
    res.status(idem.status).json(idem.body);
    return;
  }

  const row = db
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
    saveIdempotency(sessionId, `cancel:${versionId}`, idempotencyKey, requestHash, 200, payload);
    res.status(200).json(payload);
    return;
  }

  if (row.status !== 'queued') {
    sendError(req, res, 409, 'INVALID_CARD_VERSION', `当前任务状态为 ${row.status}，无法取消`);
    return;
  }

  const updated = db
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

  recordRunLog({
    id: `log_${crypto.randomBytes(6).toString('hex')}`,
    kind: 'image',
    provider: row.provider,
    resultKind: row.provider === 'cloud' ? 'generated' : 'mock',
    status: 'cancelled',
    detail: `cancelled queued version ${versionId}`,
  });

  const payload = { data: { versionId, status: 'cancelled' } };
  saveIdempotency(sessionId, `cancel:${versionId}`, idempotencyKey, requestHash, 200, payload);
  res.status(200).json(payload);
});

router.post('/cards/:id/fallback', ensureSession, (req, res) => {
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
  const idem = checkIdempotency(sessionId, `fallback:${cardId}`, idempotencyKey, requestHash);
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
    const tx = db.transaction(() => {
      const card = db
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

      const running = db
        .prepare(`SELECT id FROM card_versions WHERE card_id = ? AND status IN ('queued', 'running') LIMIT 1`)
        .get(cardId);
      if (running) {
        throw Object.assign(new Error('当前存在运行或排队中的生成任务，请等待结束后再启用模板兜底'), {
          status: 409,
          code: 'TASK_ALREADY_RUNNING',
        });
      }

      // Max 1 template fallback version per card (Section 3.4); does NOT consume generation_attempts
      const existingTpl = db
        .prepare(`SELECT * FROM card_versions WHERE card_id = ? AND result_kind = 'template' LIMIT 1`)
        .get(cardId) as Record<string, unknown> | undefined;

      if (existingTpl) {
        // Update chosen template image cleanly while keeping single template version constraint
        db.prepare(`UPDATE card_versions SET result_url = ?, suggested_name = ? WHERE id = ?`).run(
          template.imageUrl,
          template.name.replace(' · 预设版', ''),
          existingTpl.id
        );
        db.prepare(`UPDATE cards SET active_version_id = ? WHERE id = ?`).run(existingTpl.id, cardId);
        versionRecord = db.prepare(`SELECT * FROM card_versions WHERE id = ?`).get(existingTpl.id) as Record<string, unknown>;
        statusCode = 201;
        return;
      }

      const maxVer = db
        .prepare(`SELECT MAX(version_number) AS max_v FROM card_versions WHERE card_id = ?`)
        .get(cardId) as { max_v: number | null };
      const versionNumber = (maxVer?.max_v ?? 0) + 1;
      const versionId = `ver_tpl_${crypto.randomBytes(6).toString('hex')}`;
      const nowIso = new Date().toISOString();

      db.prepare(
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

      db.prepare(`UPDATE cards SET active_version_id = ? WHERE id = ?`).run(versionId, cardId);
      versionRecord = db.prepare(`SELECT * FROM card_versions WHERE id = ?`).get(versionId) as Record<string, unknown>;

      recordRunLog({
        id: `log_${crypto.randomBytes(6).toString('hex')}`,
        kind: 'image',
        provider: 'template',
        resultKind: 'template',
        status: 'succeeded',
        totalMs: 0,
        detail: `card=${cardId} template=${template.id}`,
      });
    });
    tx();
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    sendError(req, res, e.status || 400, e.code || 'INVALID_INPUT', e.message || '启用模板兜底失败');
    return;
  }

  const payload = { data: formatCardVersion(versionRecord!) };
  saveIdempotency(sessionId, `fallback:${cardId}`, idempotencyKey, requestHash, statusCode, payload);
  res.status(statusCode).json(payload);
});

router.post('/cards/:id/bind', ensureSession, (req, res) => {
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
  const idem = checkIdempotency(sessionId, `bind:${cardId}`, idempotencyKey, requestHash);
  if (idem.hit) {
    if (idem.conflict) {
      sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', '相同幂等键提交了不同的绑定版本或娃娃名称');
      return;
    }
    res.status(idem.status).json(idem.body);
    return;
  }

  const baseUrl = buildPublicBaseUrl(req);
  let resultStatus = 201;
  let resultDollId = '';

  try {
    const bindTx = db.transaction(() => {
      const card = db
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

      const version = db
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

      // Already bound handling (Section 10)
      if (card.bound_doll_id) {
        const existingDoll = db
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

      db.prepare(
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

      db.prepare(`UPDATE cards SET bound_doll_id = ?, active_version_id = ? WHERE id = ?`).run(
        dollId,
        versionId,
        cardId
      );

      // Write explicit creation facts into memories for (sessionId, dollId)
      const insertMem = db.prepare(
        `INSERT INTO memories (id, session_id, doll_id, type, value, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'creation_form', ?)`
      );

      insertMem.run(
        `mem_${crypto.randomBytes(6).toString('hex')}`,
        sessionId,
        dollId,
        'user_nickname',
        String(card.user_nickname),
        nowIso
      );
      insertMem.run(
        `mem_${crypto.randomBytes(6).toString('hex')}`,
        sessionId,
        dollId,
        'doll_name',
        dollName,
        nowIso
      );
      insertMem.run(
        `mem_${crypto.randomBytes(6).toString('hex')}`,
        sessionId,
        dollId,
        'persona',
        `${card.persona_mbti} · ${card.persona_name}`,
        nowIso
      );

      const accessoryLabels = getAccessoryLabels(JSON.parse(String(card.accessory_ids || '[]')));
      if (accessoryLabels.length > 0) {
        insertMem.run(
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
    bindTx();
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
  saveIdempotency(sessionId, `bind:${cardId}`, idempotencyKey, requestHash, resultStatus, responsePayload);
  res.status(resultStatus).json(responsePayload);
});

// ============================================================
// 7. Mock Output Jobs (Plot / Print Simulation)
// ============================================================
const ALLOWED_PAPER_SIZES = new Set(['A6', 'A5', 'SQUARE_100']);

router.post('/plot/jobs', ensureSession, (req, res) => {
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
  const idem = checkIdempotency(sessionId, 'create_plot_job', idempotencyKey, requestHash);
  if (idem.hit) {
    if (idem.conflict) {
      sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', '相同幂等键提交了不同的出图参数');
      return;
    }
    res.status(idem.status).json(idem.body);
    return;
  }

  const verRow = db
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
    sendError(req, res, 404, 'NOT_FOUND', '未找到属于当前会话的生成版本');
    return;
  }
  if (verRow.status !== 'succeeded' || !verRow.result_url) {
    sendError(req, res, 400, 'INVALID_CARD_VERSION', '仅支持对已成功且结果图可访问的版本提交模拟出图');
    return;
  }

  const jobId = `job_${crypto.randomBytes(8).toString('hex')}`;
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO output_jobs (id, owner_session_id, card_id, card_version_id, paper_size, status, mode, physical_executed, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 'mock', 0, ?, ?)`
  ).run(jobId, sessionId, verRow.card_id, cardVersionId, paperSize, idempotencyKey ?? null, nowIso);

  if (simulateFail) {
    markJobSimulateFail(jobId);
  }

  const payload = {
    data: {
      jobId,
      cardId: verRow.card_id,
      cardVersionId,
      paperSize,
      status: 'queued',
      mode: 'mock',
      physicalExecuted: false,
      createdAt: nowIso,
    },
  };
  saveIdempotency(sessionId, 'create_plot_job', idempotencyKey, requestHash, 202, payload);
  enqueueOutputJob(jobId);
  res.status(202).json(payload);
});

router.get('/plot/jobs', ensureSession, (req, res) => {
  const sessionId = req.session!.id;
  const cardId = typeof req.query.cardId === 'string' ? req.query.cardId.trim() : '';

  const rows = cardId
    ? (db
        .prepare(
          `SELECT * FROM output_jobs WHERE owner_session_id = ? AND card_id = ? ORDER BY created_at DESC`
        )
        .all(sessionId, cardId) as Array<Record<string, unknown>>)
    : (db
        .prepare(`SELECT * FROM output_jobs WHERE owner_session_id = ? ORDER BY created_at DESC LIMIT 30`)
        .all(sessionId) as Array<Record<string, unknown>>);

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

router.get('/plot/jobs/:id', ensureSession, (req, res) => {
  const jobId = req.params.id;
  const sessionId = req.session!.id;

  const r = db
    .prepare(`SELECT * FROM output_jobs WHERE id = ? AND owner_session_id = ?`)
    .get(jobId, sessionId) as Record<string, unknown> | undefined;

  if (!r) {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应的模拟出图任务');
    return;
  }

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
// 8. Persistent Generated Asset Serving & Download
// ============================================================
router.get('/assets/generated/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  const absPath = path.join(config.storagePath, 'generated', safeName);

  if (!fs.existsSync(absPath)) {
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
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="nutshell_${safeName}"`);
  }
  fs.createReadStream(absPath).pipe(res);
});

// ============================================================
// 9. Protected Demo Admin Endpoints (/api/demo/status, /api/demo/reset)
// ============================================================
router.get('/demo/status', requireAdmin, (_req, res) => {
  const versionStats = db
    .prepare(
      `SELECT provider, result_kind, status, COUNT(*) AS cnt, AVG(latency_ms) AS avg_ms
       FROM card_versions
       GROUP BY provider, result_kind, status`
    )
    .all();

  const chatStats = db
    .prepare(
      `SELECT provider, status, COUNT(*) AS cnt, AVG(first_token_ms) AS avg_ttft_ms, AVG(total_ms) AS avg_total_ms
       FROM messages
       WHERE role = 'assistant'
       GROUP BY provider, status`
    )
    .all();

  const outputStats = db
    .prepare(
      `SELECT mode, status, COUNT(*) AS cnt, SUM(physical_executed) AS physical_count
       FROM output_jobs
       GROUP BY mode, status`
    )
    .all();

  const recentErrors = db
    .prepare(
      `SELECT id, kind, provider, result_kind, error_code, detail, request_id, created_at
       FROM run_logs
       WHERE status = 'failed'
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all();

  const recentRuns = db
    .prepare(
      `SELECT id, kind, provider, result_kind, status, first_token_ms, total_ms, error_code, detail, created_at
       FROM run_logs
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .all();

  const activeSessions = db
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

  sendSuccess(res, {
    providers: {
      chat: {
        mode: config.chatProvider,
        model: config.chatModel,
        configured: config.chatProvider === 'mock' ? true : isChatCloudConfigured(),
        viaOpenAICompatible: Boolean(config.chatApiBase),
        firstTokenTimeoutMs: config.chatFirstTokenTimeoutMs,
        firstTokenTargetMs: 3000,
        contextMaxMessages: config.chatContextMaxMessages,
      },
      image: {
        mode: config.imageProvider,
        model: config.imageModel,
        configured: config.imageProvider === 'mock' ? true : isImageCloudConfigured(),
        viaOpenAICompatible: Boolean(config.imageApiBase),
        timeoutMs: config.imageTimeoutMs,
        performanceTargetMs: 40000,
        maxRegenerations: config.maxRegenerations,
      },
      output: {
        mode: config.outputProvider,
        physicalExecutedSupported: false,
      },
    },
    counts: {
      demoDolls: (db.prepare(`SELECT COUNT(*) AS c FROM dolls WHERE kind = 'demo'`).get() as { c: number }).c,
      personalDolls: (db.prepare(`SELECT COUNT(*) AS c FROM dolls WHERE kind = 'personal'`).get() as { c: number }).c,
      cards: (db.prepare(`SELECT COUNT(*) AS c FROM cards`).get() as { c: number }).c,
      personas: (db.prepare(`SELECT COUNT(*) AS c FROM personas`).get() as { c: number }).c,
    },
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

router.post('/demo/reset', requireAdmin, (req, res) => {
  const targetSessionId =
    typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
      ? req.body.sessionId.trim()
      : loadExistingSession(req)?.id || '';

  if (!targetSessionId) {
    sendError(req, res, 400, 'INVALID_INPUT', '请提供要重置的演示 sessionId');
    return;
  }

  const sessionRow = db
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

  // Reject reset if there are running tasks in this session (Section 4 Flow D)
  const runningVer = db
    .prepare(
      `SELECT cv.id
       FROM card_versions cv
       JOIN cards c ON c.id = cv.card_id
       WHERE c.owner_session_id = ? AND cv.status = 'running'
       LIMIT 1`
    )
    .get(targetSessionId);

  const runningJob = db
    .prepare(`SELECT id FROM output_jobs WHERE owner_session_id = ? AND status = 'running' LIMIT 1`)
    .get(targetSessionId);

  const runningChat = Array.from(inFlightChats).some((k) => k.startsWith(`${targetSessionId}:`));

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

  // Gather files to delete after transaction commits
  const filesToDelete: string[] = [];
  const cards = db
    .prepare(`SELECT id, photo_ref FROM cards WHERE owner_session_id = ?`)
    .all(targetSessionId) as Array<{ id: string; photo_ref: string }>;

  for (const c of cards) {
    filesToDelete.push(path.join(config.storagePath, 'photos', c.photo_ref));
    const vers = db
      .prepare(`SELECT result_url, result_kind FROM card_versions WHERE card_id = ?`)
      .all(c.id) as Array<{ result_url: string | null; result_kind: string }>;
    for (const v of vers) {
      if (v.result_url && v.result_url.startsWith('/api/assets/generated/')) {
        const fname = path.basename(v.result_url);
        filesToDelete.push(path.join(config.storagePath, 'generated', fname));
      }
    }
  }

  const resetTx = db.transaction(() => {
    db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(targetSessionId);
    db.prepare(`DELETE FROM memories WHERE session_id = ?`).run(targetSessionId);
    db.prepare(`DELETE FROM output_jobs WHERE owner_session_id = ?`).run(targetSessionId);
    db.prepare(`DELETE FROM dolls WHERE kind = 'personal' AND owner_session_id = ?`).run(targetSessionId);
    db.prepare(`DELETE FROM cards WHERE owner_session_id = ?`).run(targetSessionId);
    db.prepare(`DELETE FROM idempotency_keys WHERE session_id = ?`).run(targetSessionId);
    db.prepare(`UPDATE sessions SET invalidated = 1 WHERE id = ?`).run(targetSessionId);
  });
  resetTx();

  for (const fp of filesToDelete) {
    if (fs.existsSync(fp)) {
      try {
        fs.unlinkSync(fp);
      } catch {
        // Best-effort file removal
      }
    }
  }

  // If resetting caller's own session, clear cookie so next action starts fresh
  const callerSession = loadExistingSession(req);
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
