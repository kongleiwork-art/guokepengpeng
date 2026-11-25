import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { config, isPhotoMbtiEnabled } from './config.ts';
import { initDatabase } from './db.ts';
import { hasRemoteDatabase } from './databaseClient.ts';
import { findNfcTarget, findSeedNfcTarget, nfcChatPath } from './nfc.ts';
import { attachRequestId, sendError, sendSuccess } from './middleware/session.ts';
import apiRouter from './routes/api.ts';

const requireCreationOpen: RequestHandler = (req, res, next) => {
  if (config.imageGenerationEnabled) return next();
  sendError(req, res, 403, 'CREATION_CLOSED', '照片定制和生图暂未开放');
};

const requirePhotoMbtiForMultipart: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data') || isPhotoMbtiEnabled()) return next();
  sendError(req, res, 409, 'PHOTO_MBTI_UNAVAILABLE', '照片推荐暂未开放，请使用 4 题快测');
};

const ensureDatabase: RequestHandler = async (req, res, next) => {
  try {
    await initDatabase();
    next();
  } catch (error) {
    console.error('[database] initialization failed', (error as { code?: string }).code || 'DB_UNAVAILABLE');
    sendError(req, res, 503, 'DB_UNAVAILABLE', '展馆数据库连接暂不可用');
  }
};

const handleError: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const isClientError = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
  const isKnownServiceError = Boolean(error.status && error.code) && error.status < 600;
  if (!isClientError && !isKnownServiceError) {
    console.error('[api] request failed', req.requestId, (error as { code?: string }).code || 'INTERNAL_ERROR');
  }
  const expose = isClientError || isKnownServiceError;
  sendError(req, res, expose ? error.status : 500, expose ? error.code || 'INVALID_INPUT' : 'INTERNAL_ERROR',
    expose ? error.message : '展馆服务暂时出错，请稍后重试');
};

export function createApiApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(attachRequestId);

  // The NFC entry has no cookies or session lookup. It works with HEAD as well as GET.
  const previewAwaitingDatabase = config.isPreview && !hasRemoteDatabase;
  const resolveTag = async (alias: string) =>
    previewAwaitingDatabase ? findSeedNfcTarget(alias) : findNfcTarget(alias);
  const nfcHandler: RequestHandler = async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const target = await resolveTag(String(req.params.alias));
    if (target) res.redirect(302, nfcChatPath(target.dollId, target.alias));
    else res.status(404).type('html').send(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NFC 标签未绑定</title><main><h1>NFC 标签未绑定</h1><p>请核对贴纸链接。</p><a href="/">返回果壳展馆</a></main></html>',
    );
  };
  if (previewAwaitingDatabase) app.get('/nfc/:alias', nfcHandler);
  else app.get('/nfc/:alias', ensureDatabase, nfcHandler);

  app.get('/api/capabilities', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    sendSuccess(res, {
      imageGenerationEnabled: config.imageGenerationEnabled,
      photoMbtiEnabled: isPhotoMbtiEnabled(),
    });
  });

  app.post(['/api/cards', '/api/cards/:id/redraw'], requireCreationOpen);
  app.post('/api/mbti/recommend', requirePhotoMbtiForMultipart);
  app.use('/api', ensureDatabase, cookieParser(), express.json({ limit: '2mb' }), apiRouter);
  app.use('/api', (req, res) => {
    sendError(req, res, 404, 'NOT_FOUND', '未找到对应接口');
  });
  app.use(handleError);
  return app;
}
