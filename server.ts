import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import { config } from './server/config.ts';
import { initDatabase } from './server/db.ts';
import { attachRequestId, sendError } from './server/middleware/session.ts';
import apiRouter from './server/routes/api.ts';
import { resumeQueuedTasksOnBoot, startPhotoCleanupTimer } from './server/workers/taskWorker.ts';

async function startServer() {
  const recovery = initDatabase();
  const resumed = resumeQueuedTasksOnBoot();
  startPhotoCleanupTimer();

  const app = express();
  app.set('trust proxy', 1);

  app.use(attachRequestId);
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Mount business APIs
  app.use('/api', apiRouter);

  // Unknown API routes return consistent JSON error
  app.use('/api', (req, res) => {
    sendError(req, res, 404, 'NOT_FOUND', `接口 ${req.method} ${req.originalUrl} 不存在`);
  });

  // Serve generated studio assets and user-uploaded public/assets cleanly
  const srcAssetsDir = path.resolve(process.cwd(), 'src/assets');
  if (fs.existsSync(srcAssetsDir)) {
    app.use('/src/assets', express.static(srcAssetsDir, { maxAge: '7d' }));
  }
  const publicAssetsDir = path.resolve(process.cwd(), 'public/assets');
  if (fs.existsSync(publicAssetsDir)) {
    app.use('/assets', express.static(publicAssetsDir, { maxAge: '7d' }));
  }

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(
      `[NutShell Bump] listening on http://0.0.0.0:${config.port} | chat=${config.chatProvider} | image=${config.imageProvider} | output=${config.outputProvider} | recovered=(versions:${recovery.recoveredRunningVersions}, jobs:${recovery.recoveredRunningJobs}) | resumed=(versions:${resumed.queuedVersions}, jobs:${resumed.queuedJobs})`
    );
  });
}

startServer().catch((err) => {
  console.error('[NutShell Bump] failed to start server:', err);
  process.exit(1);
});
