import type {
  AccessoryOption,
  CardDetail,
  CardSummary,
  CardVersion,
  ChatMessage,
  DemoStatusPayload,
  DollDetail,
  DollSummary,
  FallbackTemplate,
  ImageModelTier,
  ImageVendor,
  NfcWriteScope,
  MaterialCategory,
  MaterialRecord,
  MbtiGuideHistoryItem,
  MbtiGuideTurnResponse,
  MbtiQuizAnswers,
  MbtiRecommendation,
  CognitiveFunctionScores,
  MemoryItem,
  OutputJob,
  PersonaPublic,
  ProviderMode,
  RuntimeSettings,
  SessionInfo,
} from './types';
import { isVisitorKey } from './visitorKey.ts';

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const VISITOR_KEY_STORAGE = 'nutshell_visitor_key_v1';
let temporaryVisitorKey: string | undefined;

function getOrCreateVisitorKey(): string | undefined {
  try {
    const existing = localStorage.getItem(VISITOR_KEY_STORAGE);
    if (existing && isVisitorKey(existing)) return existing;
  } catch {
    // Use a separate in-memory key when the browser blocks persistent storage.
  }
  if (!globalThis.crypto?.getRandomValues) return undefined;
  if (!temporaryVisitorKey) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    temporaryVisitorKey = 'vk_' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  try {
    localStorage.setItem(VISITOR_KEY_STORAGE, temporaryVisitorKey);
  } catch {
    // The signed cookie can preserve the session after reload.
  }
  return temporaryVisitorKey;
}

export function generateIdempotencyKey(prefix = 'idem'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('X-Visitor-Key')) {
    const visitorKey = getOrCreateVisitorKey();
    if (visitorKey) headers.set('X-Visitor-Key', visitorKey);
  }

  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code || 'REQUEST_FAILED',
      err?.message || `请求失败 (HTTP ${res.status})`,
      err?.requestId
    );
  }
  return body.data as T;
}

export const api = {
  capabilities() {
    return requestJson<{ imageGenerationEnabled: boolean; photoMbtiEnabled: boolean }>('/api/capabilities');
  },

  initSession(signal?: AbortSignal): Promise<SessionInfo> {
    return requestJson<SessionInfo>('/api/session', { method: 'POST', signal });
  },

  createSessionClaimCode(): Promise<{ code: string; expiresAt: string; sessionId: string }> {
    return requestJson('/api/session/claim-code', { method: 'POST' });
  },

  claimSessionByCode(code: string): Promise<{ sessionId: string; expiresAt: string; synced: boolean }> {
    return requestJson('/api/session/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  },

  resolveNfcAlias(alias: string): Promise<{ alias: string; dollId: string; label: string }> {
    return requestJson(`/api/nfc/resolve/${encodeURIComponent(alias)}`);
  },

  listPersonas(): Promise<PersonaPublic[]> {
    return requestJson<PersonaPublic[]>('/api/personas');
  },

  listAccessories(): Promise<AccessoryOption[]> {
    return requestJson<AccessoryOption[]>('/api/accessories');
  },

  listTemplates(signal?: AbortSignal): Promise<FallbackTemplate[]> {
    return requestJson<FallbackTemplate[]>('/api/templates', { signal });
  },

  recommendMbti(input: { photo?: File | null; quizAnswers?: MbtiQuizAnswers }): Promise<MbtiRecommendation> {
    if (!input.photo) {
      return requestJson('/api/mbti/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizAnswers: input.quizAnswers }),
      });
    }
    const formData = new FormData();
    if (input.photo) {
      formData.append('photo', input.photo);
    }
    if (input.quizAnswers) {
      formData.append('quizAnswers', JSON.stringify(input.quizAnswers));
    }
    return requestJson<MbtiRecommendation>('/api/mbti/recommend', {
      method: 'POST',
      body: formData,
    });
  },

  mbtiGuideTurn(input: {
    history: MbtiGuideHistoryItem[];
    rawScores?: Partial<CognitiveFunctionScores>;
    maxRounds?: number;
    forceConclude?: boolean;
  }): Promise<MbtiGuideTurnResponse> {
    return requestJson<MbtiGuideTurnResponse>('/api/mbti/guide/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  listDolls(): Promise<DollSummary[]> {
    return requestJson<DollSummary[]>('/api/dolls');
  },

  getDoll(dollId: string): Promise<DollDetail> {
    return requestJson<DollDetail>(`/api/dolls/${encodeURIComponent(dollId)}`);
  },

  renameDoll(dollId: string, name: string): Promise<{ id: string; name: string }> {
    return requestJson<{ id: string; name: string }>(`/api/dolls/${encodeURIComponent(dollId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  },

  getMessages(dollId: string, limit = 50): Promise<{ items: ChatMessage[]; nextCursor: string | null }> {
    return requestJson(`/api/dolls/${encodeURIComponent(dollId)}/messages?limit=${limit}`);
  },

  getMemories(dollId: string): Promise<MemoryItem[]> {
    return requestJson<MemoryItem[]>(`/api/dolls/${encodeURIComponent(dollId)}/memory`);
  },

  addMemory(dollId: string, type: string, value: string): Promise<MemoryItem & { memoryId: string }> {
    return requestJson(`/api/dolls/${encodeURIComponent(dollId)}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, value }),
    });
  },

  deleteMemory(dollId: string, memoryId: string): Promise<void> {
    return requestJson(`/api/dolls/${encodeURIComponent(dollId)}/memory/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
    });
  },

  listCards(): Promise<CardSummary[]> {
    return requestJson<CardSummary[]>('/api/cards');
  },

  getCard(cardId: string, signal?: AbortSignal): Promise<CardDetail> {
    return requestJson<CardDetail>(`/api/cards/${encodeURIComponent(cardId)}`, { signal });
  },

  getCardVersion(versionId: string): Promise<CardVersion> {
    return requestJson<CardVersion>(`/api/card-versions/${encodeURIComponent(versionId)}`);
  },

  createCard(
    formData: FormData,
    idempotencyKey: string,
    options?: { simulateFail?: boolean }
  ): Promise<{
    cardId: string;
    versionId: string;
    status: string;
    provider: string;
    cardUrl: string;
    processingUrl: string;
  }> {
    const headers: Record<string, string> = {
      'Idempotency-Key': idempotencyKey,
    };
    if (options?.simulateFail) {
      headers['X-Mock-Fail'] = 'true';
    }
    return requestJson('/api/cards', {
      method: 'POST',
      headers,
      body: formData,
    });
  },

  redrawCard(
    cardId: string,
    idempotencyKey: string,
    options?: { simulateFail?: boolean; reviewedUnknown?: boolean }
  ): Promise<{ cardId: string; versionId: string; versionNumber: number; status: string; provider: string }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    };
    if (options?.simulateFail) {
      headers['X-Mock-Fail'] = 'true';
    }
    return requestJson(`/api/cards/${encodeURIComponent(cardId)}/redraw`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ simulateFail: Boolean(options?.simulateFail), reviewedUnknown: options?.reviewedUnknown }),
    });
  },

  cancelVersion(versionId: string, idempotencyKey: string): Promise<{ versionId: string; status: string }> {
    return requestJson(`/api/card-versions/${encodeURIComponent(versionId)}/cancel`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  applyFallback(cardId: string, templateId: string, idempotencyKey: string): Promise<CardVersion> {
    return requestJson(`/api/cards/${encodeURIComponent(cardId)}/fallback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ templateId }),
    });
  },

  bindCard(
    cardId: string,
    versionId: string,
    dollName: string,
    idempotencyKey: string
  ): Promise<{ dollId: string; dollUrl: string; cardUrl: string; cardVersionId: string }> {
    return requestJson(`/api/cards/${encodeURIComponent(cardId)}/bind`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ versionId, dollName }),
    });
  },

  createPlotJob(
    cardVersionId: string,
    paperSize: string,
    idempotencyKey: string,
    simulateFail = false
  ): Promise<OutputJob> {
    return requestJson('/api/plot/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ cardVersionId, paperSize, simulateFail }),
    });
  },

  listPlotJobs(cardId?: string, signal?: AbortSignal): Promise<OutputJob[]> {
    const q = cardId ? `?cardId=${encodeURIComponent(cardId)}` : '';
    return requestJson<OutputJob[]>(`/api/plot/jobs${q}`, { signal });
  },

  getPlotJob(jobId: string): Promise<OutputJob> {
    return requestJson<OutputJob>(`/api/plot/jobs/${encodeURIComponent(jobId)}`);
  },

  // ---- Admin APIs ----
  getDemoStatus(adminToken: string): Promise<DemoStatusPayload> {
    return requestJson<DemoStatusPayload>('/api/demo/status', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },

  updateDemoSettings(
    adminToken: string,
    patch: Partial<{
      nfcPublicBaseUrl: string;
      imageModelTier: ImageModelTier;
      imageVendor: ImageVendor;
      chatProviderMode: ProviderMode;
      imageProviderMode: ProviderMode;
      strictMaterialConstraint: boolean;
    }>
  ): Promise<RuntimeSettings> {
    return requestJson<RuntimeSettings>('/api/demo/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(patch),
    });
  },

  upsertNfcTag(
    adminToken: string,
    payload: { alias: string; dollId: string; label?: string }
  ): Promise<{ alias: string; dollId: string; label: string; nfcUrl: string }> {
    return requestJson('/api/demo/nfc-tags', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });
  },

  markNfcTagWritten(adminToken: string, alias: string, url: string, scope: NfcWriteScope): Promise<{ alias: string; lastWrittenAt: string }> {
    return requestJson(`/api/demo/nfc-tags/${encodeURIComponent(alias)}/written`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, scope }),
    });
  },

  listAdminMaterials(
    adminToken: string
  ): Promise<{ categories: Record<MaterialCategory, string>; items: MaterialRecord[] }> {
    return requestJson('/api/demo/materials', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },

  upsertMaterial(
    adminToken: string,
    payload: {
      id?: string;
      label: string;
      category: MaterialCategory;
      material: string;
      visualHint?: string;
      inStock?: boolean;
      sortOrder?: number;
    }
  ): Promise<MaterialRecord> {
    return requestJson('/api/demo/materials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });
  },

  updateMaterial(
    adminToken: string,
    id: string,
    patch: Partial<{
      label: string;
      category: MaterialCategory;
      material: string;
      visualHint: string;
      inStock: boolean;
    }>
  ): Promise<MaterialRecord> {
    return requestJson(`/api/demo/materials/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(patch),
    });
  },

  deleteMaterial(adminToken: string, id: string): Promise<void> {
    return requestJson(`/api/demo/materials/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },

  importMaterialsJson(
    adminToken: string,
    items: Array<Record<string, unknown>>,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<{ mode: string; importedCount: number; totalCount: number }> {
    return requestJson('/api/demo/materials/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ mode, items }),
    });
  },

  resetDemoSession(
    adminToken: string,
    sessionId: string
  ): Promise<{ resetSessionId: string; invalidated: boolean; preservedDemoDolls: boolean }> {
    return requestJson('/api/demo/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ sessionId }),
    });
  },
};

export interface StreamChatCallbacks {
  onMeta?: (meta: {
    requestId: string;
    clientMessageId: string;
    assistantMessageId?: string;
    provider: string;
    replayed?: boolean;
    savedMemoryId?: string | null;
  }) => void;
  onDelta: (text: string) => void;
  onDone: (done: {
    assistantMessageId: string;
    status: string;
    firstTokenMs?: number | null;
    totalMs?: number | null;
    savedMemoryId?: string | null;
  }) => void;
  onError: (err: { code: string; message: string; requestId?: string }) => void;
}

export async function streamDollChat(
  dollId: string,
  payload: { text: string; clientMessageId: string; rememberText?: string },
  callbacks: StreamChatCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
  const visitorKey = getOrCreateVisitorKey();
  if (visitorKey) headers.set('X-Visitor-Key', visitorKey);
  const res = await fetch(`/api/dolls/${encodeURIComponent(dollId)}/chat`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = body?.error;
    callbacks.onError({
      code: err?.code || 'REQUEST_FAILED',
      message: err?.message || `请求失败 (HTTP ${res.status})`,
      requestId: err?.requestId,
    });
    return;
  }

  if (!res.body) {
    callbacks.onError({ code: 'PROVIDER_ERROR', message: '浏览器未能读取响应流' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (event === 'meta') callbacks.onMeta?.(parsed);
        if (event === 'delta') callbacks.onDelta(parsed.text || '');
        if (event === 'done' || event === 'error') {
          if (event === 'done') callbacks.onDone(parsed);
          else callbacks.onError(parsed);
          await reader.cancel().catch(() => {});
          return;
        }
      }
    }
    if (!signal?.aborted) callbacks.onError({ code: 'CHAT_INTERRUPTED', message: '回复连接已中断，可以重试这条消息' });
  } finally {
    reader.releaseLock();
  }
}

/**
 * Compress & EXIF-normalize a photo on the client canvas so it stays <= 2 MB and upright.
 */
export async function compressImageForUpload(file: Blob): Promise<File> {
  const bitmap = typeof createImageBitmap === 'function'
    ? await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
    : null;
  const image = bitmap ? null : new Image();
  const sourceUrl = image ? URL.createObjectURL(file) : null;
  const canvas = document.createElement('canvas');
  try {
    if (image && sourceUrl) {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('浏览器无法读取这张照片'));
        image.src = sourceUrl;
      });
    }
    const width = bitmap?.width ?? image!.naturalWidth;
    const height = bitmap?.height ?? image!.naturalHeight;
    const scale = Math.min(1, 1280 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器画布初始化失败');
    ctx.drawImage(bitmap ?? image!, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap?.close();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }

  const qualities = [0.86, 0.72, 0.58];
  for (const q of qualities) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', q)
    );
    if (blob && blob.size <= 1.9 * 1024 * 1024) {
      return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    }
  }

  const fallbackBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.45)
  );
  if (!fallbackBlob) {
    throw new Error('图片压缩失败，请尝试换一张照片');
  }
  return new File([fallbackBlob], 'photo.jpg', { type: 'image/jpeg' });
}
