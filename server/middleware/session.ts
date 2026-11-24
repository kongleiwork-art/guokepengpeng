import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.ts';
import { db } from '../db.ts';

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
  if (!raw || raw.length < 12 || raw.length > 80) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) return null;
  return raw;
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

export function loadSessionById(sessionId: string): SessionRecord | null {
  const row = db
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

/**
 * Dual-track session resolution for reliable NFC re-taps across Safari / Chrome / WeChat:
 * 1) Signed HttpOnly cookie (primary)
 * 2) Persistent X-Visitor-Key header fallback when mobile browsers isolate cookies between NFC taps
 */
export function loadExistingSession(req: Request): SessionRecord | null {
  const raw = req.cookies?.[config.sessionCookieName];
  const sid = verifySignedSessionCookie(raw);
  const visitorKey = extractVisitorKey(req);

  if (sid) {
    const cookieSess = loadSessionById(sid);
    if (cookieSess) {
      if (visitorKey && !cookieSess.visitorKey) {
        db.prepare(`UPDATE sessions SET visitor_key = ? WHERE id = ?`).run(visitorKey, cookieSess.id);
        cookieSess.visitorKey = visitorKey;
      }
      return cookieSess;
    }
  }

  if (visitorKey) {
    const row = db
      .prepare(
        `SELECT id, is_demo, invalidated, visitor_key, created_at, expires_at
         FROM sessions
         WHERE visitor_key = ? AND invalidated = 0
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(visitorKey) as
      | {
          id: string;
          is_demo: number;
          invalidated: number;
          visitor_key: string | null;
          created_at: string;
          expires_at: string;
        }
      | undefined;
    const restored = mapSessionRow(row);
    if (restored) {
      return restored;
    }
  }

  return null;
}

export function createNewSession(visitorKey?: string | null): SessionRecord {
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

  db.prepare(
    `INSERT INTO sessions (id, is_demo, invalidated, visitor_key, created_at, expires_at)
     VALUES (?, 1, 0, ?, ?, ?)`
  ).run(record.id, record.visitorKey, record.createdAt, record.expiresAt);

  return record;
}

export function ensureSession(req: Request, res: Response, next: NextFunction): void {
  const visitorKey = extractVisitorKey(req);
  let session = loadExistingSession(req);
  if (!session) {
    session = createNewSession(visitorKey);
    setSessionCookie(req, res, session);
  } else if (!req.cookies?.[config.sessionCookieName]) {
    // Re-hydrate HttpOnly cookie if restored via visitor key
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
