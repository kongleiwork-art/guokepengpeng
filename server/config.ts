import path from 'node:path';
import dotenv from 'dotenv';

if (!process.env.VERCEL) dotenv.config({ quiet: true });

export type ProviderMode = 'mock' | 'cloud';
export type ImageModelTier = 'fast' | 'hd';
export type ImageVendor = 'openai' | 'gemini';
export type NfcWriteScope = 'production' | 'test' | 'unavailable';

const port = Number(process.env.PORT || 3000);
const isVercel = Boolean(process.env.VERCEL);
const isPreview = process.env.VERCEL_ENV === 'preview';
const key = (name: string) => {
  const value = process.env[name]?.trim();
  return value && value !== 'MY_' + name ? value : '';
};
const chatApiKey = key('STEPFUN_API_KEY');
const openaiImageKey = key('OPENAI_API_KEY');
const geminiApiKey = key('GEMINI_API_KEY') || key('IMAGE_API_KEY');
const imageVendor: ImageVendor = process.env.IMAGE_VENDOR === 'gemini' ? 'gemini' : 'openai';
const configuredOrigin = validatePublicBaseUrl(process.env.PUBLIC_APP_URL || '');
const previewOrigin = validatePublicBaseUrl(
  process.env.PREVIEW_APP_URL || (process.env.VERCEL_BRANCH_URL ? 'https://' + process.env.VERCEL_BRANCH_URL : '')
);

function resolveProviderMode(explicit: string | undefined, configured: boolean): ProviderMode {
  if (explicit === 'mock' || explicit === 'cloud') return explicit;
  return configured ? 'cloud' : 'mock';
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

const imageProvider = resolveProviderMode(
  process.env.IMAGE_PROVIDER,
  isVercel || Boolean(imageVendor === 'openai' ? openaiImageKey : geminiApiKey),
);
const imageGenerationEnabled = isVercel
  ? process.env.IMAGE_GENERATION_ENABLED === 'true' &&
    (imageProvider === 'mock' || Boolean(openaiImageKey || geminiApiKey))
  : process.env.IMAGE_GENERATION_ENABLED !== 'false';

export const IMAGE_TIER_LABELS: Record<ImageModelTier, string> = {
  fast: '快速',
  hd: '高清',
};

export const IMAGE_MODELS: Record<ImageVendor, Record<ImageModelTier, string>> = {
  openai: {
    fast: process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2.6-flare',
    hd: process.env.OPENAI_IMAGE_HD_MODEL?.trim() || process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2.6-sunburst',
  },
  gemini: {
    fast: process.env.GEMINI_IMAGE_MODEL?.trim() || process.env.IMAGE_MODEL?.trim() || 'gemini-2.5-flash-image',
    hd: process.env.GEMINI_IMAGE_HD_MODEL?.trim() || 'gemini-3-pro-image-preview',
  },
};

export const config = {
  port,
  host: process.env.HOST || '0.0.0.0',
  isVercel,
  isPreview,
  publicAppUrl: isPreview ? previewOrigin : configuredOrigin,
  appBaseUrl: (process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:' + port).replace(/\/+$/, ''),
  databaseUrl: path.resolve(process.cwd(), process.env.DATABASE_URL || './data/nutshell.sqlite'),
  storagePath: path.resolve(process.cwd(), process.env.STORAGE_PATH || './storage'),
  sessionSecret: process.env.SESSION_SECRET?.trim() || '',
  sessionCookieName: 'nutshell_sid',
  sessionTtlDays: Math.max(1, Number(process.env.SESSION_TTL_DAYS || 30)),
  chatProvider: resolveProviderMode(process.env.CHAT_PROVIDER, Boolean(chatApiKey)),
  chatApiBase: (process.env.STEPFUN_API_BASE || 'https://api.stepfun.com/v1').replace(/\/+$/, ''),
  chatApiKey,
  chatModel: process.env.STEPFUN_CHAT_MODEL?.trim() || 'step-3.5-flash',
  stepfunVisionModel: process.env.STEPFUN_VISION_MODEL?.trim() || '',
  chatFirstTokenTimeoutMs: Math.max(1000, Number(process.env.CHAT_FIRST_TOKEN_TIMEOUT_MS || 15000)),
  chatContextMaxMessages: Math.max(4, Number(process.env.CHAT_CONTEXT_MAX_MESSAGES || 20)),
  imageGenerationEnabled,
  imageVendor,
  imageProvider,
  geminiApiKey,
  geminiImageBaseUrl: process.env.GEMINI_IMAGE_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com',
  openaiImageKey,
  openaiApiBase: (process.env.OPENAI_IMAGE_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  imageTimeoutMs: Math.max(5000, Math.min(115000, Number(process.env.IMAGE_TIMEOUT_MS || 90000))),
  maxRegenerations: Math.max(0, Number(process.env.MAX_REGENERATIONS || 2)),
  imageDailyLimit: positiveInteger(process.env.IMAGE_DAILY_LIMIT, 60),
  imageVisitorDailyLimit: positiveInteger(process.env.IMAGE_VISITOR_DAILY_LIMIT, 10),
  imageIpTenMinuteLimit: positiveInteger(process.env.IMAGE_IP_TEN_MINUTE_LIMIT, 20),
  imageQueueLimit: positiveInteger(process.env.IMAGE_QUEUE_LIMIT, 5),
  outputProvider: 'mock' as const,
  demoAdminToken: process.env.DEMO_ADMIN_TOKEN?.trim() || '',
  photoTtlHours: 24,
};

export function isChatCloudConfigured(): boolean {
  return Boolean(config.chatApiKey);
}

export function isPhotoMbtiEnabled(): boolean {
  return Boolean(config.stepfunVisionModel) && isChatCloudConfigured();
}

export function isImageCloudConfigured(vendor: ImageVendor): boolean {
  return Boolean(vendor === 'openai' ? config.openaiImageKey : config.geminiApiKey);
}

export function validatePublicBaseUrl(raw: string): string | null {
  if (!raw.trim()) return '';
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash ||
      parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local') ||
      !parsed.hostname.includes('.') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname)
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function buildPublicBaseUrl(
  req?: { protocol?: string; get?: (name: string) => string | undefined },
  overrideBaseUrl?: string | null
): string {
  if (config.publicAppUrl) return config.publicAppUrl;
  if (overrideBaseUrl && !config.isVercel) {
    const valid = validatePublicBaseUrl(overrideBaseUrl);
    if (valid) return valid;
  }
  const host = req?.get?.('host');
  return host ? (req?.protocol || 'http') + '://' + host : config.appBaseUrl;
}

export function nfcWriteScope(overrideBaseUrl?: string): NfcWriteScope {
  if (config.isVercel) {
    const origin = config.publicAppUrl;
    if (!origin) return 'unavailable';
    if (config.isPreview) return 'test';
    return new URL(origin).hostname.endsWith('.vercel.app') ? 'unavailable' : 'production';
  }
  return validatePublicBaseUrl(overrideBaseUrl || config.publicAppUrl || config.appBaseUrl) ? 'test' : 'unavailable';
}
