import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.ts';
import { DEMO_DOLL_SEEDS, PERSONA_SEEDS } from './data/seed.ts';

// Ensure data & storage directories exist
fs.mkdirSync(path.dirname(config.databaseUrl), { recursive: true });
fs.mkdirSync(path.join(config.storagePath, 'photos'), { recursive: true });
fs.mkdirSync(path.join(config.storagePath, 'generated'), { recursive: true });
fs.mkdirSync(path.join(config.storagePath, 'output'), { recursive: true });

export const db = new Database(config.databaseUrl);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): { recoveredRunningVersions: number; recoveredRunningJobs: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      is_demo INTEGER NOT NULL DEFAULT 1,
      invalidated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mbti TEXT NOT NULL,
      tagline TEXT NOT NULL,
      material_hint TEXT NOT NULL,
      prompt TEXT NOT NULL,
      opening_line TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dolls (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('demo', 'personal')),
      owner_session_id TEXT,
      persona_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      card_id TEXT UNIQUE,
      card_version_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (persona_id) REFERENCES personas(id)
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      owner_session_id TEXT NOT NULL,
      photo_ref TEXT NOT NULL,
      photo_mime TEXT NOT NULL DEFAULT 'image/jpeg',
      photo_expires_at TEXT NOT NULL,
      user_nickname TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      accessory_ids TEXT NOT NULL DEFAULT '[]',
      active_version_id TEXT,
      bound_doll_id TEXT,
      generation_attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (persona_id) REFERENCES personas(id)
    );

    CREATE TABLE IF NOT EXISTS card_versions (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      provider TEXT NOT NULL,
      provider_request_id TEXT,
      result_kind TEXT NOT NULL CHECK(result_kind IN ('generated', 'template', 'mock')),
      result_url TEXT,
      suggested_name TEXT,
      keywords TEXT,
      error_code TEXT,
      error_message TEXT,
      latency_ms INTEGER,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(card_id, version_number),
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      doll_id TEXT NOT NULL,
      client_message_id TEXT NOT NULL,
      reply_attempt INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'streaming', 'completed', 'failed', 'incomplete')),
      provider TEXT,
      provider_request_id TEXT,
      first_token_ms INTEGER,
      total_ms INTEGER,
      error_code TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_user_dedup
      ON messages(session_id, doll_id, client_message_id)
      WHERE role = 'user';

    CREATE INDEX IF NOT EXISTS idx_messages_session_doll
      ON messages(session_id, doll_id, created_at);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      doll_id TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_session_doll
      ON memories(session_id, doll_id, created_at);

    CREATE TABLE IF NOT EXISTS output_jobs (
      id TEXT PRIMARY KEY,
      owner_session_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      card_version_id TEXT NOT NULL,
      paper_size TEXT NOT NULL DEFAULT 'A6',
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
      mode TEXT NOT NULL DEFAULT 'mock',
      physical_executed INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_output_jobs_owner
      ON output_jobs(owner_session_id, created_at);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      session_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, operation, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS run_logs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      provider TEXT NOT NULL,
      result_kind TEXT,
      status TEXT NOT NULL,
      first_token_ms INTEGER,
      total_ms INTEGER,
      error_code TEXT,
      request_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Seed 16 MBTI personas
  const upsertPersona = db.prepare(`
    INSERT INTO personas (id, name, mbti, tagline, material_hint, prompt, opening_line, featured)
    VALUES (@id, @name, @mbti, @tagline, @materialHint, @prompt, @openingLine, @featured)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      mbti = excluded.mbti,
      tagline = excluded.tagline,
      material_hint = excluded.material_hint,
      prompt = excluded.prompt,
      opening_line = excluded.opening_line,
      featured = excluded.featured
  `);

  const upsertDemoDoll = db.prepare(`
    INSERT INTO dolls (id, kind, owner_session_id, persona_id, name, avatar_url, card_id, card_version_id, created_at)
    VALUES (@id, 'demo', NULL, @personaId, @name, @avatarUrl, NULL, NULL, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      persona_id = excluded.persona_id,
      name = excluded.name,
      avatar_url = excluded.avatar_url
    WHERE dolls.kind = 'demo'
  `);

  const now = new Date().toISOString();
  const seedTx = db.transaction(() => {
    for (const persona of PERSONA_SEEDS) {
      upsertPersona.run(persona);
    }
    for (const doll of DEMO_DOLL_SEEDS) {
      upsertDemoDoll.run({ ...doll, createdAt: now });
    }
  });
  seedTx();

  // Startup recovery (Section 6.4):
  // Unknown running tasks transition to failed with WORKER_RESTARTED; never auto-re-bill.
  const recoveredVersions = db
    .prepare(
      `UPDATE card_versions
       SET status = 'failed',
           error_code = 'WORKER_RESTARTED',
           error_message = '服务重启前该任务仍在运行且无法确认远端状态，已标记失败以避免重复计费，请按需重试',
           finished_at = ?
       WHERE status = 'running'`
    )
    .run(now);

  const recoveredJobs = db
    .prepare(
      `UPDATE output_jobs
       SET status = 'failed',
           error_code = 'WORKER_RESTARTED',
           error_message = '服务重启时模拟出图任务中断，请重新提交',
           finished_at = ?
       WHERE status = 'running'`
    )
    .run(now);

  db.prepare(
    `UPDATE messages
     SET status = 'incomplete',
         error_code = 'WORKER_RESTARTED'
     WHERE role = 'assistant' AND status IN ('pending', 'streaming')`
  ).run();

  return {
    recoveredRunningVersions: recoveredVersions.changes,
    recoveredRunningJobs: recoveredJobs.changes,
  };
}

export function recordRunLog(entry: {
  id: string;
  kind: 'chat' | 'image' | 'output' | 'system';
  provider: string;
  resultKind?: string | null;
  status: 'succeeded' | 'failed' | 'cancelled';
  firstTokenMs?: number | null;
  totalMs?: number | null;
  errorCode?: string | null;
  requestId?: string | null;
  detail?: string | null;
}): void {
  db.prepare(
    `INSERT INTO run_logs (id, kind, provider, result_kind, status, first_token_ms, total_ms, error_code, request_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.id,
    entry.kind,
    entry.provider,
    entry.resultKind ?? null,
    entry.status,
    entry.firstTokenMs ?? null,
    entry.totalMs ?? null,
    entry.errorCode ?? null,
    entry.requestId ?? null,
    entry.detail ?? null,
    new Date().toISOString()
  );
}
