import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export type ProviderMode = 'mock' | 'cloud';

function resolveProviderMode(
  explicit: string | undefined,
  autoCloudCondition: boolean
): ProviderMode {
  const normalized = (explicit ?? '').trim().toLowerCase();
  if (normalized === 'cloud') return 'cloud';
  if (normalized === 'mock') return 'mock';
  return autoCloudCondition ? 'cloud' : 'mock';
}

const rawChatKey = (process.env.CHAT_API_KEY ?? '').trim();
const rawGeminiKey = (process.env.GEMINI_API_KEY ?? '').trim();
const rawImageKey = (process.env.IMAGE_API_KEY ?? '').trim();
const rawChatBase = (process.env.CHAT_API_BASE ?? '').trim();
const rawImageBase = (process.env.IMAGE_API_BASE ?? '').trim();

const hasValidGeminiKey = Boolean(rawGeminiKey && rawGeminiKey !== 'MY_GEMINI_API_KEY');
const hasValidChatKey = Boolean(rawChatKey && rawChatKey !== 'MY_CHAT_API_KEY');
const hasValidImageKey = Boolean(rawImageKey && rawImageKey !== 'MY_IMAGE_API_KEY');

export const config = {
  port: Number(process.env.PORT || 3000),
  appBaseUrl: (process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  databaseUrl: path.resolve(process.cwd(), process.env.DATABASE_URL || './data/nutshell.sqlite'),
  storagePath: path.resolve(process.cwd(), process.env.STORAGE_PATH || './storage'),
  sessionSecret: process.env.SESSION_SECRET || 'nutshell-bump-demo-session-secret',
  sessionCookieName: 'nutshell_sid',
  sessionTtlDays: Math.max(1, Number(process.env.SESSION_TTL_DAYS || 30)),

  chatProvider: resolveProviderMode(
    process.env.CHAT_PROVIDER,
    hasValidChatKey || hasValidGeminiKey
  ),
  chatApiBase: rawChatBase,
  chatApiKey: hasValidChatKey ? rawChatKey : '',
  geminiApiKey: hasValidGeminiKey ? rawGeminiKey : '',
  chatModel: (process.env.CHAT_MODEL || 'gemini-4-hydrogen').trim(),
  chatFirstTokenTimeoutMs: Math.max(1000, Number(process.env.CHAT_FIRST_TOKEN_TIMEOUT_MS || 10000)),
  chatContextMaxMessages: Math.max(4, Number(process.env.CHAT_CONTEXT_MAX_MESSAGES || 20)),

  imageProvider: resolveProviderMode(
    process.env.IMAGE_PROVIDER,
    hasValidImageKey
  ),
  imageApiBase: rawImageBase,
  imageApiKey: hasValidImageKey ? rawImageKey : '',
  imageModel: (process.env.IMAGE_MODEL || 'gemini-3.1-flash-lite-image').trim(),
  imageTimeoutMs: Math.max(5000, Number(process.env.IMAGE_TIMEOUT_MS || 60000)),
  maxRegenerations: Math.max(0, Number(process.env.MAX_REGENERATIONS || 2)),

  outputProvider: 'mock' as const,
  demoAdminToken: (process.env.DEMO_ADMIN_TOKEN || 'demo-admin-2026').trim(),
  photoTtlHours: Math.max(1, Number(process.env.PHOTO_TTL_HOURS || 24)),
};

export function isChatCloudConfigured(): boolean {
  if (config.chatApiBase) {
    return Boolean(config.chatApiKey);
  }
  return Boolean(config.chatApiKey || config.geminiApiKey);
}

export function isImageCloudConfigured(): boolean {
  if (config.imageApiBase) {
    return Boolean(config.imageApiKey);
  }
  return Boolean(config.imageApiKey || config.geminiApiKey);
}

export function buildPublicBaseUrl(req?: { protocol?: string; get?: (name: string) => string | undefined }): string {
  if (req?.get) {
    const forwardedHost = req.get('x-forwarded-host') || req.get('host');
    const forwardedProto = req.get('x-forwarded-proto') || req.protocol || 'http';
    if (forwardedHost && !forwardedHost.startsWith('127.0.0.1') && !forwardedHost.startsWith('localhost')) {
      return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '');
    }
  }
  return config.appBaseUrl;
}
