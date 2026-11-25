import { config } from '../config.ts';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type Message = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

export function requestStepFun(
  body: { model?: string; messages: Message[]; stream?: boolean; max_tokens: number; response_format?: { type: 'json_object' } },
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
  const response = await requestStepFun({
    ...(model ? { model } : {}),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    max_tokens: 2300,
  }, AbortSignal.timeout(25000));
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
