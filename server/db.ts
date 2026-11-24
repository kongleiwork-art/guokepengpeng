import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  config,
  IMAGE_MODEL_BY_TIER,
  type ImageModelTier,
  type ProviderMode,
} from './config.ts';
import {
  DEFAULT_MATERIAL_SEEDS,
  DEMO_DOLL_SEEDS,
  PERSONA_SEEDS,
  type MaterialCategory,
} from './data/seed.ts';

// Ensure data & storage directories exist
fs.mkdirSync(path.dirname(config.databaseUrl), { recursive: true });
fs.mkdirSync(path.join(config.storagePath, 'photos'), { recursive: true });
fs.mkdirSync(path.join(config.storagePath, 'generated'), { recursive: true });
fs.mkdirSync(path.join(config.storagePath, 'output'), { recursive: true });

export const db = new Database(config.databaseUrl);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export interface MaterialRecord {
  id: string;
  label: string;
  category: MaterialCategory;
  material: string;
  visualHint: string;
  inStock: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeSettings {
  nfcPublicBaseUrl: string;
  imageModelTier: ImageModelTier;
  imageModel: string;
  chatProviderMode: ProviderMode;
  imageProviderMode: ProviderMode;
  strictMaterialConstraint: boolean;
}

function ensureColumnExists(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initDatabase(): { recoveredRunningVersions: number; recoveredRunningJobs: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      is_demo INTEGER NOT NULL DEFAULT 1,
      invalidated INTEGER NOT NULL DEFAULT 0,
      visitor_key TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mbti TEXT NOT NULL,
      mbti_group TEXT NOT NULL DEFAULT 'NF',
      cognitive_axis TEXT NOT NULL DEFAULT '',
      tagline TEXT NOT NULL,
      material_hint TEXT NOT NULL,
      speech_style TEXT NOT NULL DEFAULT '',
      visual_trait TEXT NOT NULL DEFAULT '',
      recommended_materials TEXT NOT NULL DEFAULT '[]',
      prompt TEXT NOT NULL,
      opening_line TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'hardware_charm',
      material TEXT NOT NULL,
      visual_hint TEXT NOT NULL,
      in_stock INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nfc_tags (
      alias TEXT PRIMARY KEY,
      doll_id TEXT NOT NULL,
      label TEXT NOT NULL,
      last_written_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_claim_codes (
      code TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
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

  // Safe idempotent schema migrations for pre-existing SQLite databases
  ensureColumnExists('sessions', 'visitor_key', 'TEXT');
  ensureColumnExists('personas', 'mbti_group', "TEXT NOT NULL DEFAULT 'NF'");
  ensureColumnExists('personas', 'cognitive_axis', "TEXT NOT NULL DEFAULT ''");
  ensureColumnExists('personas', 'speech_style', "TEXT NOT NULL DEFAULT ''");
  ensureColumnExists('personas', 'visual_trait', "TEXT NOT NULL DEFAULT ''");
  ensureColumnExists('personas', 'recommended_materials', "TEXT NOT NULL DEFAULT '[]'");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_visitor_key
      ON sessions(visitor_key)
      WHERE visitor_key IS NOT NULL;
  `);

  // Seed 16 MBTI personas
  const upsertPersona = db.prepare(`
    INSERT INTO personas (
      id, name, mbti, mbti_group, cognitive_axis, tagline, material_hint,
      speech_style, visual_trait, recommended_materials, prompt, opening_line, featured
    )
    VALUES (
      @id, @name, @mbti, @mbtiGroup, @cognitiveAxis, @tagline, @materialHint,
      @speechStyle, @visualTrait, @recommendedMaterialsJson, @prompt, @openingLine, @featured
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      mbti = excluded.mbti,
      mbti_group = excluded.mbti_group,
      cognitive_axis = excluded.cognitive_axis,
      tagline = excluded.tagline,
      material_hint = excluded.material_hint,
      speech_style = excluded.speech_style,
      visual_trait = excluded.visual_trait,
      recommended_materials = excluded.recommended_materials,
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

  const insertNfcTag = db.prepare(`
    INSERT OR IGNORE INTO nfc_tags (alias, doll_id, label, last_written_at, created_at)
    VALUES (?, ?, ?, NULL, ?)
  `);

  const now = new Date().toISOString();
  const seedTx = db.transaction(() => {
    for (const persona of PERSONA_SEEDS) {
      upsertPersona.run({
        ...persona,
        recommendedMaterialsJson: JSON.stringify(persona.recommendedMaterials),
      });
    }
    for (const doll of DEMO_DOLL_SEEDS) {
      upsertDemoDoll.run({ ...doll, createdAt: now });
      insertNfcTag.run(doll.nfcAlias, doll.id, `${doll.name} · NFC 展位主签`, now);
    }

    // Seed default materials only when materials table is empty (preserve team edits/imports!)
    const matCount = (db.prepare(`SELECT COUNT(*) AS c FROM materials`).get() as { c: number }).c;
    if (matCount === 0) {
      const insertMat = db.prepare(`
        INSERT OR IGNORE INTO materials (id, label, category, material, visual_hint, in_stock, sort_order, created_at, updated_at)
        VALUES (@id, @label, @category, @material, @visualHint, @inStock, @sortOrder, @createdAt, @updatedAt)
      `);
      for (const m of DEFAULT_MATERIAL_SEEDS) {
        insertMat.run({
          ...m,
          inStock: m.inStock ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });
  seedTx();

  // Startup recovery: Unknown running tasks transition to failed with WORKER_RESTARTED
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

export function getRuntimeSettings(): RuntimeSettings {
  const rows = db
    .prepare(`SELECT key, value FROM system_settings`)
    .all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const tierRaw = map.get('image_model_tier');
  const imageModelTier: ImageModelTier = tierRaw === 'hd' ? 'hd' : 'fast';

  const chatModeRaw = map.get('chat_provider_mode');
  const chatProviderMode: ProviderMode =
    chatModeRaw === 'cloud' || chatModeRaw === 'mock' ? chatModeRaw : config.chatProvider;

  const imageModeRaw = map.get('image_provider_mode');
  const imageProviderMode: ProviderMode =
    imageModeRaw === 'cloud' || imageModeRaw === 'mock' ? imageModeRaw : config.imageProvider;

  const strictRaw = map.get('strict_material_constraint');
  const strictMaterialConstraint = strictRaw === undefined ? true : strictRaw !== 'false';

  return {
    nfcPublicBaseUrl: map.get('nfc_public_base_url') ?? '',
    imageModelTier,
    imageModel: IMAGE_MODEL_BY_TIER[imageModelTier],
    chatProviderMode,
    imageProviderMode,
    strictMaterialConstraint,
  };
}

export function setRuntimeSetting(key: string, value: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

export function listMaterials(onlyInStock = false): MaterialRecord[] {
  const rows = (onlyInStock
    ? db
        .prepare(
          `SELECT * FROM materials WHERE in_stock = 1 ORDER BY sort_order ASC, created_at ASC`
        )
        .all()
    : db
        .prepare(`SELECT * FROM materials ORDER BY sort_order ASC, created_at ASC`)
        .all()) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    category: String(r.category) as MaterialCategory,
    material: String(r.material),
    visualHint: String(r.visual_hint),
    inStock: Number(r.in_stock) === 1,
    sortOrder: Number(r.sort_order || 0),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export function getMaterialsByIds(ids: string[]): MaterialRecord[] {
  if (!ids || ids.length === 0) return [];
  const all = listMaterials(false);
  const byId = new Map(all.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((v): v is MaterialRecord => Boolean(v));
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
