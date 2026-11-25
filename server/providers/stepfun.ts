import { config } from '../config.ts';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' } };

type Message = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

export function requestStepFun(
  body: {
    model?: string;
    messages: Message[];
    stream?: boolean;
    max_tokens: number;
    response_format?: { type: 'json_object' };
    reasoning_effort?: 'low';
  },
  signal: AbortSignal,
) {
  return fetch(config.chatApiBase + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + config.chatApiKey,
    },
    body: JSON.stringify({ model: config.chatModel, ...body }),
    signal,
  });
}

export function stepFunError(status: number) {
  if (status === 402 || status === 429) {
    return Object.assign(new Error('阶跃星辰对话额度不足或请求过于频繁，请稍后重试'), {
      code: 'PROVIDER_QUOTA',
      status: 503,
    });
  }
  return Object.assign(new Error('阶跃星辰服务暂时不可用（HTTP ' + status + '）'), {
    code: 'PROVIDER_ERROR',
    status: 502,
  });
}

export async function requestStepFunJson<T>(system: string, user: Message['content'], model?: string): Promise<T> {
  const hasImage = Array.isArray(user);
  const useLowEffort = hasImage && (model === 'step-3.7-flash' || model === 'step-5-preview');
  const response = await requestStepFun({
    ...(model ? { model } : {}),
    ...(useLowEffort ? { reasoning_effort: 'low' as const } : {}),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    max_tokens: hasImage ? 3600 : 2300,
  }, AbortSignal.timeout(hasImage ? 38_000 : 25_000)).catch((error: unknown) => {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw Object.assign(new Error(timedOut ? '阶跃星辰分析超时，请重试' : '暂时无法连接阶跃星辰，请重试'), {
      code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', status: timedOut ? 504 : 502,
    });
  });
  if (!response.ok) throw stepFunError(response.status);

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw Object.assign(new Error('阶跃星辰未返回有效分析'), { code: 'PROVIDER_ERROR', status: 502 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('阶跃星辰分析格式无效'), { code: 'PROVIDER_ERROR', status: 502 });
  }
  return parsed as T;
}
