import { createHmac, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { getVercelOidcToken } from '@vercel/oidc';
import { config } from '../config.ts';

const STEP_PLAN_CN = 'https://api.stepfun.com/step_plan/v1';
export const STEP_PLAN_RELAY_PATH = '/internal/step-plan';
export const STEP_PLAN_RELAY_RESPONSE = 'x-step-plan-relay-response';
export const MAX_STEP_PLAN_RELAY_BYTES = 4 * 1024 * 1024;

export function useStepPlanTransport() {
  return config.isVercel && config.chatApiBase === STEP_PLAN_CN;
}

export function canRelayStepPlan() {
  return useStepPlanTransport() && Boolean(config.sessionSecret) &&
    /^[a-z0-9-]+\.vercel\.app$/.test(process.env.VERCEL_URL ?? '');
}

export function postStepPlan(body: string | Buffer, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(STEP_PLAN_CN + '/chat/completions', {
      method: 'POST', family: 4, signal,
      headers: {
        Authorization: 'Bearer ' + config.chatApiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept-Encoding': 'identity',
      },
    }, message => {
      const status = message.statusCode ?? 502;
      const headers = new Headers();
      for (const name of ['content-type', 'x-request-id']) {
        const value = message.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      if ([204, 205, 304].includes(status)) {
        message.resume();
        resolve(new Response(null, { status, headers }));
        return;
      }
      resolve(new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, { status, headers }));
    });
    const timer = setTimeout(() => request.destroy(Object.assign(
      new Error('Step Plan connection timed out'), { code: 'STEP_PLAN_CONNECT_TIMEOUT' }
    )), 5_000);
    timer.unref();
    request.once('socket', socket => {
      if (socket.connecting) socket.once('secureConnect', () => clearTimeout(timer));
      else clearTimeout(timer);
    });
    request.once('close', () => clearTimeout(timer));
    request.once('error', reject);
    request.end(body);
  });
}

function signRelayBody(body: string | Buffer, timestamp: string) {
  return createHmac('sha256', config.sessionSecret)
    .update('step-plan-relay\n' + timestamp + '\n')
    .update(body)
    .digest('base64url');
}

export function readRelaySignature(request: Request) {
  const timestamp = request.headers.get('x-step-plan-timestamp');
  const signature = request.headers.get('x-step-plan-signature');
  if (!useStepPlanTransport() || !config.sessionSecret || !config.chatApiKey ||
      !timestamp || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60_000 ||
      !signature || !/^[a-zA-Z0-9_-]{43}$/.test(signature)) return null;
  return { timestamp, signature };
}

export function verifyRelaySignature(body: Buffer, auth: { timestamp: string; signature: string }) {
  return timingSafeEqual(Buffer.from(auth.signature), Buffer.from(signRelayBody(body, auth.timestamp)));
}

export async function postStepPlanViaRelay(body: string, signal: AbortSignal) {
  if (Buffer.byteLength(body) > MAX_STEP_PLAN_RELAY_BYTES) {
    throw Object.assign(new Error('Step Plan payload exceeds relay limit'), { code: 'STEP_PLAN_RELAY_PAYLOAD_TOO_LARGE' });
  }
  const oidcToken = await getVercelOidcToken();
  const timestamp = String(Date.now());
  const response = await fetch('https://' + process.env.VERCEL_URL + STEP_PLAN_RELAY_PATH, {
    method: 'POST', signal, redirect: 'error', body,
    headers: {
      'Content-Type': 'application/json',
      'x-step-plan-timestamp': timestamp,
      'x-step-plan-signature': signRelayBody(body, timestamp),
      'x-vercel-trusted-oidc-idp-token': oidcToken,
    },
  });
  if (response.headers.get(STEP_PLAN_RELAY_RESPONSE) !== '1') {
    void response.body?.cancel().catch(() => {});
    throw Object.assign(new Error('Step Plan relay unavailable'), { code: 'STEP_PLAN_RELAY_UNAVAILABLE' });
  }
  return response;
}
