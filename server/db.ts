import {
  config,
  IMAGE_MODELS,
  type ImageVendor,
  type ImageModelTier,
  type ProviderMode,
} from './config.ts';
import {
  DEFAULT_MATERIAL_SEEDS,
  DEMO_DOLL_SEEDS,
  PERSONA_SEEDS,
  type MaterialCategory,
} from './data/seed.ts';

import { db } from './databaseClient.ts';
export { db };

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
  imageVendor: ImageVendor;
  imageModelTier: ImageModelTier;
  imageModel: string;
  chatProviderMode: ProviderMode;
  imageProviderMode: ProviderMode;
  strictMaterialConstraint: boolean;
}

async function ensureColumnExists(table: string, column: string, definition: string): Promise<void> {
  const cols = await db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

let initialization: ReturnType<typeof initialize> | undefined;

export function initDatabase() {
  initialization ??= initialize().catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

async function initialize(): Promise<{ recoveredRunningVersions: number; recoveredRunningJobs: number }> {
  if (config.isVercel && !config.sessionSecret) throw new Error('SESSION_SECRET 未配置');
  const schemaVersion = async () => (await db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const migrate = db.transaction(async () => {
    if (await schemaVersion() >= 1) return;
    await migrateAndSeed();
    await db.exec('PRAGMA user_version = 1');
  });
  if (await schemaVersion() < 1) await migrate();
  if (config.isVercel) return { recoveredRunningVersions: 0, recoveredRunningJobs: 0 };

  const now = new Date().toISOString();
  if (!config.sessionSecret) {
    const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'session_secret'").get() as { value: string } | undefined;
    config.sessionSecret = row?.value || '';
  }
  return recoverInterruptedLocalJobs(now);
}

async function migrateAndSeed(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

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
  await ensureColumnExists('sessions', 'visitor_key', 'TEXT');
  await ensureColumnExists('card_versions', 'image_settings', 'TEXT');
  await ensureColumnExists('card_versions', 'simulate_fail', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumnExists('card_versions', 'dispatched_at', 'TEXT');
  await ensureColumnExists('output_jobs', 'simulate_fail', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumnExists('output_jobs', 'started_at', 'TEXT');
  await ensureColumnExists('output_jobs', 'dispatched_at', 'TEXT');
  await ensureColumnExists('personas', 'mbti_group', "TEXT NOT NULL DEFAULT 'NF'");
  await ensureColumnExists('personas', 'cognitive_axis', "TEXT NOT NULL DEFAULT ''");
  await ensureColumnExists('personas', 'speech_style', "TEXT NOT NULL DEFAULT ''");
  await ensureColumnExists('personas', 'visual_trait', "TEXT NOT NULL DEFAULT ''");
  await ensureColumnExists('personas', 'recommended_materials', "TEXT NOT NULL DEFAULT '[]'");

  await db.exec(`
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
  const seedTx = db.transaction(async () => {
    await db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('session_secret', hex(randomblob(32)))").run();
    for (const persona of PERSONA_SEEDS) {
      await upsertPersona.run({
        ...persona,
        recommendedMaterialsJson: JSON.stringify(persona.recommendedMaterials),
      });
    }
    for (const doll of DEMO_DOLL_SEEDS) {
      await upsertDemoDoll.run({ ...doll, createdAt: now });
      await insertNfcTag.run(doll.nfcAlias, doll.id, `${doll.name} · NFC 展位主签`, now);
    }

    // Seed default materials only when materials table is empty (preserve team edits/imports!)
    const matCount = (await db.prepare(`SELECT COUNT(*) AS c FROM materials`).get() as { c: number }).c;
    if (matCount === 0) {
      const insertMat = db.prepare(`
        INSERT OR IGNORE INTO materials (id, label, category, material, visual_hint, in_stock, sort_order, created_at, updated_at)
        VALUES (@id, @label, @category, @material, @visualHint, @inStock, @sortOrder, @createdAt, @updatedAt)
      `);
      for (const m of DEFAULT_MATERIAL_SEEDS) {
        await insertMat.run({
          ...m,
          inStock: m.inStock ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });
  await seedTx();
}

async function recoverInterruptedLocalJobs(now: string) {
  // Startup recovery: Unknown running tasks transition to failed with WORKER_RESTARTED
  const recoveredVersions = await db
    .prepare(
      `UPDATE card_versions
       SET status = 'failed',
           error_code = CASE WHEN provider = 'cloud' THEN 'GENERATION_STATUS_UNKNOWN' ELSE 'WORKER_RESTARTED' END,
           error_message = CASE WHEN provider = 'cloud' THEN '生图状态未确认，请先核对服务商的结果与费用'
                                ELSE '本地生成任务已中断，请重新提交' END,
           finished_at = ?
       WHERE status = 'running'`
    )
    .run(now);

  const recoveredJobs = await db
    .prepare(
      `UPDATE output_jobs
       SET status = 'failed',
           error_code = 'WORKER_RESTARTED',
           error_message = '服务重启时模拟出图任务中断，请重新提交',
           finished_at = ?
       WHERE status = 'running'`
    )
    .run(now);

  await db.prepare(
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

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const rows = await db
    .prepare(`SELECT key, value FROM system_settings`)
    .all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const tierRaw = map.get('image_model_tier');
  const imageModelTier: ImageModelTier = tierRaw === 'hd' ? 'hd' : 'fast';

  const chatModeRaw = map.get('chat_provider_mode');
  const chatProviderMode: ProviderMode =
    chatModeRaw === 'cloud' || chatModeRaw === 'mock' ? chatModeRaw : config.chatProvider;

  const vendorRaw = map.get('image_vendor');
  const imageVendor = vendorRaw === 'gemini' || vendorRaw === 'openai' ? vendorRaw : config.imageVendor;
  const imageModeRaw = map.get('image_provider_mode');
  const imageProviderMode: ProviderMode =
    imageModeRaw === 'cloud' || imageModeRaw === 'mock' ? imageModeRaw : config.imageProvider;

  const strictRaw = map.get('strict_material_constraint');
  const strictMaterialConstraint = strictRaw === undefined ? true : strictRaw !== 'false';

  return {
    nfcPublicBaseUrl: map.get('nfc_public_base_url') ?? '',
    imageVendor,
    imageModelTier,
    imageModel: IMAGE_MODELS[imageVendor][imageModelTier],
    chatProviderMode,
    imageProviderMode,
    strictMaterialConstraint,
  };
}

export async function setRuntimeSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

export async function listMaterials(onlyInStock = false): Promise<MaterialRecord[]> {
  const rows = (onlyInStock
    ? await db
        .prepare(
          `SELECT * FROM materials WHERE in_stock = 1 ORDER BY sort_order ASC, created_at ASC`
        )
        .all()
    : await db
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

export async function getMaterialsByIds(ids: string[]): Promise<MaterialRecord[]> {
  if (!ids || ids.length === 0) return [];
  const all = await listMaterials(false);
  const byId = new Map(all.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((v): v is MaterialRecord => Boolean(v));
}

export async function recordRunLog(entry: {
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
}): Promise<void> {
  await db.prepare(
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
