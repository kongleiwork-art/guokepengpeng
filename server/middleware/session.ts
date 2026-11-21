import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.ts';
import { db } from '../db.ts';

export interface SessionRecord {
  id: string;
  isDemo: boolean;
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

function isRequestHttps(req: Request): boolean {
  const proto = req.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  return req.secure || req.protocol === 'https';
}

export function setSessionCookie(req: Request, res: Response, session: SessionRecord): void {
  const https = isRequestHttps(req);
  res.cookie(config.sessionCookieName, signSessionId(session.id), {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    path: '/',
    expires: new Date(session.expiresAt),
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  const https = isRequestHttps(req);
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    path: '/',
  });
}

export function loadExistingSession(req: Request): SessionRecord | null {
  const raw = req.cookies?.[config.sessionCookieName];
  const sid = verifySignedSessionCookie(raw);
  if (!sid) return null;

  const row = db
    .prepare(
      `SELECT id, is_demo, invalidated, created_at, expires_at
       FROM sessions
       WHERE id = ?`
    )
    .get(sid) as
    | { id: string; is_demo: number; invalidated: number; created_at: string; expires_at: string }
    | undefined;

  if (!row || row.invalidated === 1) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  return {
    id: row.id,
    isDemo: row.is_demo === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createNewSession(): SessionRecord {
  const id = `sess_${crypto.randomBytes(12).toString('hex')}`;
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  const record: SessionRecord = {
    id,
    isDemo: true,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  db.prepare(
    `INSERT INTO sessions (id, is_demo, invalidated, created_at, expires_at)
     VALUES (?, 1, 0, ?, ?)`
  ).run(record.id, record.createdAt, record.expiresAt);

  return record;
}

export function ensureSession(req: Request, res: Response, next: NextFunction): void {
  let session = loadExistingSession(req);
  if (!session) {
    session = createNewSession();
    setSessionCookie(req, res, session);
  }
  req.session = session;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
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
