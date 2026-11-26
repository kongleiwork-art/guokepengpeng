import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { setTimeout as wait } from 'node:timers/promises';
import { config } from '../config.ts';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' } };

type Message = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };
type StepFunRequest = {
  model?: string;
  messages: Message[];
  stream?: boolean;
  max_tokens: number;
  response_format?: { type: 'json_object' };
  reasoning_effort?: 'low';
};

export function requestStepFun(
  body: StepFunRequest,
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

function requestStepFunOverIpv4(body: StepFunRequest, signal: AbortSignal): Promise<Response> {
  const serialized = JSON.stringify({ model: config.chatModel, ...body });
  return new Promise((resolve, reject) => {
    const request = httpsRequest(config.chatApiBase + '/chat/completions', {
      method: 'POST', family: 4, signal,
      headers: {
        Authorization: 'Bearer ' + config.chatApiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(serialized),
        'Accept-Encoding': 'identity',
      },
    }, message => {
      const status = message.statusCode ?? 502;
      if (status === 204 || status === 205 || status === 304) {
        message.resume();
        resolve(new Response(null, { status }));
        return;
      }
      resolve(new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, { status }));
    });
    request.once('error', reject);
    request.end(serialized);
  });
}

export function stepFunError(status: number) {
  if (status === 401 || status === 403) {
    return Object.assign(new Error('阶跃星辰的服务权限异常，请联系工坊'), { code: 'PROVIDER_ACCESS_DENIED', status: 503 });
  }
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

function transportCode(error: unknown): string {
  const failure = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = failure?.cause?.code ?? failure?.code;
  return typeof code === 'string' ? code : error instanceof Error ? error.name : 'unknown';
}

export async function requestStepFunJson<T>(
  system: string,
  user: Message['content'],
  model?: string,
  options?: { maxTokens: number; attemptTimeoutsMs: readonly [number, number] },
): Promise<T> {
  const hasImage = Array.isArray(user);
  const useLowEffort = hasImage && (model === 'step-3.7-flash' || model === 'step-5-preview');
  const body: StepFunRequest = {
    ...(model ? { model } : {}),
    ...(useLowEffort ? { reasoning_effort: 'low' as const } : {}),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    max_tokens: options?.maxTokens ?? (hasImage ? 3600 : 2300),
  };
  const deadline = options ? undefined : AbortSignal.timeout(hasImage ? 38_000 : 25_000);
  const canUseIpv4 = config.isVercel && config.chatApiBase === 'https://api.stepfun.com/step_plan/v1';
  let transport = requestStepFun;
  let payload: { choices?: Array<{ message?: { content?: unknown } }> };
  for (let attempt = 0; ; attempt++) {
    const signal = options ? AbortSignal.timeout(options.attemptTimeoutsMs[attempt]) : deadline!;
    let response: Response | undefined;
    try {
      response = await transport(body, signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw stepFunError(response.status);
      }
      payload = await response.json();
      break;
    } catch (error) {
      const timedOut = signal.aborted || Boolean(options && response?.status === 504);
      const connectionFailed = error instanceof TypeError && (!response || Boolean(options && response.ok));
      const gatewayFailed = [502, 503, 504].includes(response?.status ?? 0);
      if (attempt === 0 && !deadline?.aborted && (timedOut || connectionFailed || gatewayFailed)) {
        console.warn('[stepfun] retrying analysis', process.env.VERCEL_REGION,
          timedOut ? 'PROVIDER_TIMEOUT' : response?.status ?? transportCode(error));
        if (canUseIpv4 && (connectionFailed || timedOut)) transport = requestStepFunOverIpv4;
        await wait(250);
        continue;
      }
      if (!timedOut && typeof (error as { status?: unknown })?.status === 'number') throw error;
      console.warn('[stepfun] analysis request failed', process.env.VERCEL_REGION, transportCode(error));
      const message = timedOut
        ? (options ? '照片分析重试后仍超时，可以稍后重试' : '阶跃星辰分析超时，请重试')
        : '暂时无法连接阶跃星辰，请重试';
      throw Object.assign(new Error(message), { code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', status: timedOut ? 504 : 502 });
    }
  }

  const text = payload?.choices?.[0]?.message?.content;
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
