import {
  MAX_STEP_PLAN_RELAY_BYTES,
  postStepPlan,
  readRelaySignature,
  STEP_PLAN_RELAY_RESPONSE,
  verifyRelaySignature,
} from '../server/providers/stepPlanTransport.ts';

export async function POST(request: Request): Promise<Response> {
  const auth = readRelaySignature(request);
  if (!auth) return new Response(null, { status: 401 });
  if (Number(request.headers.get('content-length')) > MAX_STEP_PLAN_RELAY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > MAX_STEP_PLAN_RELAY_BYTES) return new Response(null, { status: 413 });
  if (!verifyRelaySignature(body, auth)) return new Response(null, { status: 401 });

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(43_000)]);
  const relayHeaders = { [STEP_PLAN_RELAY_RESPONSE]: '1', 'Cache-Control': 'no-store' };
  try {
    const upstream = await postStepPlan(body, signal);
    console.info('[stepfun] relay response', process.env.VERCEL_REGION, upstream.status);
    const headers = new Headers(upstream.headers);
    for (const [name, value] of Object.entries(relayHeaders)) headers.set(name, value);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    const code = (error as { code?: string }).code;
    console.warn('[stepfun] relay connection failed', process.env.VERCEL_REGION, code);
    const timedOut = signal.aborted || code === 'STEP_PLAN_CONNECT_TIMEOUT' || code === 'ETIMEDOUT';
    return new Response(null, { status: timedOut ? 504 : 502, headers: relayHeaders });
  }
}
