import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { config } from './server/config.ts';
import { initDatabase } from './server/db.ts';
import { createApiApp } from './server/app.ts';
import { resumeQueuedTasksOnBoot, startPhotoCleanupTimer } from './server/workers/taskWorker.ts';

async function startServer() {
  const recovery = await initDatabase();
  const resumed = await resumeQueuedTasksOnBoot();
  startPhotoCleanupTimer();

  const app = createApiApp();

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
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    console.log(
      `[NutShell Bump] listening on http://${config.host}:${port} | chat=${config.chatProvider} | image=${config.imageProvider} | output=${config.outputProvider} | recovered=(versions:${recovery.recoveredRunningVersions}, jobs:${recovery.recoveredRunningJobs}) | resumed=(versions:${resumed.queuedVersions}, jobs:${resumed.queuedJobs})`
    );
  });
}

startServer().catch((err) => {
  console.error('[NutShell Bump] failed to start server:', err);
  process.exit(1);
});
