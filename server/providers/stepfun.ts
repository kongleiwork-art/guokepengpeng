import { setTimeout as wait } from 'node:timers/promises';
import { config } from '../config.ts';
import { canRelayStepPlan, postStepPlan, postStepPlanViaRelay, useStepPlanTransport } from './stepPlanTransport.ts';

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

type StepFunCompletion = {
  choices?: Array<{ finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }>;
};

class InvalidStepFunOutput extends Error {
  readonly code = 'PROVIDER_ERROR';
  readonly status = 502;
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.retryable = retryable;
  }
}

const CONNECTION_TIMEOUT_CODES = new Set(['STEP_PLAN_CONNECT_TIMEOUT', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']);
const CONNECTION_ERROR_CODES = new Set([
  ...CONNECTION_TIMEOUT_CODES, 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'ENOTFOUND',
]);

function postStepFun(body: string, signal: AbortSignal) {
  if (useStepPlanTransport()) return postStepPlan(body, signal);
  return fetch(config.chatApiBase + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + config.chatApiKey,
    },
    body,
    signal,
  });
}

export async function requestStepFun(body: StepFunRequest, signal: AbortSignal) {
  const serialized = JSON.stringify({ model: config.chatModel, ...body });
  try {
    return await postStepFun(serialized, signal);
  } catch (error) {
    const code = transportCode(error);
    if (signal.aborted || !canRelayStepPlan() || !CONNECTION_ERROR_CODES.has(code)) throw error;
    console.warn('[stepfun] retrying connection across regions', process.env.VERCEL_REGION, code);
    return postStepPlanViaRelay(serialized, signal);
  }
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

function readStepFunObject<T>(payload: StepFunCompletion): T {
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
    throw new InvalidStepFunOutput('阶跃星辰未返回可用描述', false);
  }
  if (choice?.finish_reason === 'length') throw new InvalidStepFunOutput('阶跃星辰返回的分析不完整');
  const text = choice?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new InvalidStepFunOutput('阶跃星辰未返回有效分析');
  const json = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidStepFunOutput('阶跃星辰分析格式无效');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidStepFunOutput('阶跃星辰分析格式无效');
  }
  return parsed as T;
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
    model: model || config.chatModel,
    ...(useLowEffort ? { reasoning_effort: 'low' as const } : {}),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    max_tokens: options?.maxTokens ?? (hasImage ? 3600 : 2300),
  };
  const serialized = JSON.stringify(body);
  const deadline = options ? undefined : AbortSignal.timeout(hasImage ? 38_000 : 25_000);
  let post = postStepFun;
  for (let attempt = 0; ; attempt++) {
    const signal = options ? AbortSignal.timeout(options.attemptTimeoutsMs[attempt]) : deadline!;
    let response: Response | undefined;
    try {
      response = await post(serialized, signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw stepFunError(response.status);
      }
      return readStepFunObject<T>(await response.json());
    } catch (error) {
      const code = transportCode(error);
      const timedOut = signal.aborted || response?.status === 504 || (!response && CONNECTION_TIMEOUT_CODES.has(code));
      const connectionFailed = (!response && CONNECTION_ERROR_CODES.has(code)) ||
        (error instanceof TypeError && (!response || Boolean(options && response.ok)));
      const gatewayFailed = [502, 503, 504].includes(response?.status ?? 0);
      const incomplete = options && error instanceof InvalidStepFunOutput && error.retryable;
      if (attempt === 0 && !deadline?.aborted && (timedOut || connectionFailed || gatewayFailed || incomplete)) {
        if (canRelayStepPlan()) post = postStepPlanViaRelay;
        console.warn('[stepfun] retrying analysis', process.env.VERCEL_REGION,
          post === postStepPlanViaRelay ? 'alternate region' : 'same region', incomplete ? 'incomplete output' : response?.status ?? code);
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
}
