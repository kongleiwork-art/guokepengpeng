import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { isVisitorKey } from '../../src/lib/visitorKey.ts';

export interface SessionRecord {
  id: string;
  isDemo: boolean;
  visitorKey: string | null;
  createdAt: string;
  expiresAt: string;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      session?: SessionRecord;
    }
  }
}

export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const id = `req_${crypto.randomBytes(8).toString('hex')}`;
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}

export function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string
): void {
  res.status(status).json({
    error: {
      code,
      message,
      requestId: req.requestId || `req_${crypto.randomBytes(6).toString('hex')}`,
    },
  });
}

function signSessionId(sessionId: string): string {
  const sig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(sessionId)
    .digest('base64url');
  return `${sessionId}.${sig}`;
}

function verifySignedSessionCookie(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const sid = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(sid)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  return sid;
}

export function extractVisitorKey(req: Request): string | null {
  const raw = (req.get('x-visitor-key') || '').trim();
  return isVisitorKey(raw) ? raw : null;
}

function isRequestHttps(req: Request): boolean {
  const proto = req.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  return req.secure || req.protocol === 'https';
}

export function setSessionCookie(req: Request, res: Response, session: SessionRecord): void {
  const https = isRequestHttps(req);
  res.cookie(config.sessionCookieName, signSessionId(session.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: https,
    path: '/',
    expires: new Date(session.expiresAt),
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  const https = isRequestHttps(req);
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: https,
    path: '/',
  });
}

function mapSessionRow(row: {
  id: string;
  is_demo: number;
  invalidated: number;
  visitor_key?: string | null;
  created_at: string;
  expires_at: string;
} | undefined): SessionRecord | null {
  if (!row || row.invalidated === 1) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return {
    id: row.id,
    isDemo: row.is_demo === 1,
    visitorKey: row.visitor_key ?? null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function loadSessionById(sessionId: string): Promise<SessionRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, is_demo, invalidated, visitor_key, created_at, expires_at
       FROM sessions
       WHERE id = ?`
    )
    .get(sessionId) as
    | {
        id: string;
        is_demo: number;
        invalidated: number;
        visitor_key: string | null;
        created_at: string;
        expires_at: string;
      }
    | undefined;
  return mapSessionRow(row);
}

async function loadSessionByVisitorKey(visitorKey: string): Promise<SessionRecord | null> {
  const row = await db.prepare(`
    SELECT s.id, s.is_demo, s.invalidated, s.visitor_key, s.created_at, s.expires_at
    FROM session_browser_keys b JOIN sessions s ON s.id = b.session_id
    WHERE b.visitor_key = ?
  `).get(visitorKey) as Parameters<typeof mapSessionRow>[0];
  return mapSessionRow(row);
}

export async function bindVisitorKey(visitorKey: string, sessionId: string, replace = false): Promise<void> {
  await db.prepare(`
    INSERT INTO session_browser_keys (visitor_key, session_id) VALUES (?, ?)
    ON CONFLICT (visitor_key) ${replace ? 'DO UPDATE SET session_id = excluded.session_id' : 'DO NOTHING'}
  `).run(visitorKey, sessionId);
}

export async function loadExistingSession(req: Request): Promise<SessionRecord | null> {
  const raw = req.cookies?.[config.sessionCookieName];
  const sid = verifySignedSessionCookie(raw);
  const visitorKey = extractVisitorKey(req);

  if (sid) {
    const cookieSess = await loadSessionById(sid);
    if (cookieSess) return cookieSess;
  }
  return visitorKey ? loadSessionByVisitorKey(visitorKey) : null;
}

export async function createNewSession(visitorKey?: string | null): Promise<SessionRecord> {
  const id = `sess_${crypto.randomBytes(12).toString('hex')}`;
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  const record: SessionRecord = {
    id,
    isDemo: true,
    visitorKey: visitorKey ?? null,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  const create = db.transaction(async () => {
    if (visitorKey) {
      const restored = await loadSessionByVisitorKey(visitorKey);
      if (restored) return restored;
    }
    await db.prepare(
      `INSERT INTO sessions (id, is_demo, invalidated, visitor_key, created_at, expires_at)
       VALUES (?, 1, 0, ?, ?, ?)`
    ).run(record.id, record.visitorKey, record.createdAt, record.expiresAt);
    if (visitorKey) await bindVisitorKey(visitorKey, record.id, true);
    return record;
  });

  return create();
}

export async function ensureSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const visitorKey = extractVisitorKey(req);
  const session = await loadExistingSession(req) ?? await createNewSession(visitorKey);
  if (verifySignedSessionCookie(req.cookies?.[config.sessionCookieName]) !== session.id) {
    setSessionCookie(req, res, session);
  }
  req.session = session;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!config.demoAdminToken) {
    sendError(req, res, 503, 'ADMIN_NOT_CONFIGURED', '请在服务端设置 DEMO_ADMIN_TOKEN 后启用管理功能');
    return;
  }
  const authHeader = req.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const headerToken = (req.get('x-admin-token') || '').trim();
  const provided = bearer || headerToken;

  if (!provided || provided !== config.demoAdminToken) {
    sendError(req, res, 401, 'UNAUTHORIZED', '管理操作需要有效的 DEMO_ADMIN_TOKEN 授权');
    return;
  }
  next();
}
