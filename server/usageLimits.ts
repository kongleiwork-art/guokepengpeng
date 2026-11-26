import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { config } from './config.ts';
import { db } from './db.ts';

const TEN_MINUTES = 10 * 60_000;
const DAY = 24 * 3600_000;
const CHINA_UTC_OFFSET = 8 * 3600_000;

function ipSubject(req: Request): string {
  return createHmac('sha256', config.sessionSecret)
    .update(req.ip ?? req.socket.remoteAddress ?? 'unknown').digest('base64url');
}

function windowEnd(now: number, duration: number, offset = 0): number {
  return (Math.floor((now + offset) / duration) + 1) * duration - offset;
}

async function useBudget(scope: string, subject: string, end: number, limit: number) {
  return db.prepare(`
    INSERT INTO request_budgets (scope, subject, window_end, used) VALUES (?, ?, ?, 1)
    ON CONFLICT (scope, subject, window_end) DO UPDATE SET used = used + 1 WHERE used < ?
  `).run(scope, subject, end, limit);
}

export async function checkClaimAttempt(req: Request): Promise<void> {
  const now = Date.now();
  const end = windowEnd(now, TEN_MINUTES);
  await db.prepare('DELETE FROM request_budgets WHERE window_end <= ?').run(now);
  if ((await useBudget('claim-ip', ipSubject(req), end, 30)).changes === 0) {
    throw Object.assign(new Error('续聊口令尝试次数较多，请稍后再试'), { status: 429, code: 'CLAIM_RATE_LIMIT' });
  }
}

// Record admissions in the same transaction that creates the version and its idempotency record.
export async function checkImageAdmission(req: Request, sessionId: string, reserve = false): Promise<void> {
  const active = await db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(c.owner_session_id = ?), 0) AS own
    FROM card_versions v JOIN cards c ON c.id = v.card_id
    WHERE v.provider = 'cloud' AND v.status IN ('queued', 'running')
  `).get(sessionId) as { total: number; own: number };
  if (active.own > 0) {
    throw Object.assign(new Error('你已有一个生图任务在排队或运行，请在收藏中查看'), {
      status: 429, code: 'IMAGE_VISITOR_QUEUE_FULL',
    });
  }
  if (active.total >= config.imageQueueLimit) {
    throw Object.assign(new Error('工坊生图队列已满，请稍后重试'), { status: 429, code: 'IMAGE_QUEUE_FULL' });
  }

  const now = Date.now();
  const dayEnd = windowEnd(now, DAY, CHINA_UTC_OFFSET);
  const budgets = [
    { scope: 'image-site', subject: 'site', end: dayEnd, limit: config.imageDailyLimit,
      message: '今天的工坊生图额度已用完，请明天再来' },
    { scope: 'image-session', subject: sessionId, end: dayEnd, limit: config.imageVisitorDailyLimit,
      message: '今天的个人生图额度已用完，请明天再试' },
    { scope: 'image-ip', subject: ipSubject(req), end: windowEnd(now, TEN_MINUTES), limit: config.imageIpTenMinuteLimit,
      message: '当前网络的生图请求较多，请稍后重试' },
  ];

  if (reserve) await db.prepare('DELETE FROM request_budgets WHERE window_end <= ?').run(now);
  for (const { scope, subject, end, limit, message } of budgets) {
    const allowed = reserve
      ? (await useBudget(scope, subject, end, limit)).changes > 0
      : Number((await db.prepare(`
          SELECT used FROM request_budgets WHERE scope = ? AND subject = ? AND window_end = ?
        `).get(scope, subject, end) as { used: number } | undefined)?.used ?? 0) < limit;
    if (!allowed) throw Object.assign(new Error(message), { status: 429, code: 'IMAGE_RATE_LIMIT' });
  }
}
