import { request as httpsRequest } from 'node:https';
import { config } from './config.ts';

const cn = 'https://api.stepfun.com/step_plan/v1/models';
const global = 'https://api.stepfun.ai/step_plan/v1/models';

async function checkFetch(url: string) {
  const start = Date.now();
  try {
    const result = await fetch(url, {
      headers: { Authorization: 'Bearer ' + config.chatApiKey },
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
    });
    await result.body?.cancel().catch(() => {});
    return { status: result.status, ms: Date.now() - start };
  } catch (error) {
    const err = error as { name?: string; cause?: { code?: string } };
    return { name: err.name, code: err.cause?.code, ms: Date.now() - start };
  }
}

function checkHttps() {
  const start = Date.now();
  return new Promise(resolve => {
    const request = httpsRequest(cn, {
      headers: { Authorization: 'Bearer ' + config.chatApiKey },
      family: 4,
    }, response => {
      response.resume();
      resolve({ status: response.statusCode, ms: Date.now() - start });
    });
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('Timed out'), { code:'TIMEOUT' })), 9000);
    request.once('close', () => clearTimeout(timer));
    request.once('error', error => resolve({
      code: (error as NodeJS.ErrnoException).code, ms: Date.now() - start,
    }));
    request.end();
  });
}

export default async function handler(_request: unknown, res: { status(code: number): { json(body: unknown): void } }) {
  if (!config.isPreview) { res.status(404).json({}); return; }
  const [chinaFetch, chinaHttps, overseasFetch] = await Promise.all([
    checkFetch(cn), checkHttps(), checkFetch(global),
  ]);
  res.status(200).json({ region: process.env.VERCEL_REGION, configured: Boolean(config.chatApiKey), chinaFetch, chinaHttps, overseasFetch });
}
