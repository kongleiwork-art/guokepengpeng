import { QueueClient } from '@vercel/queue';
import { initDatabase } from '../server/db.ts';
import { processTask } from '../server/workers/taskWorker.ts';
import { verifyTask } from '../server/workers/taskQueue.ts';

const queue = new QueueClient();

export default queue.handleNodeCallback(async (envelope) => {
  const task = verifyTask(envelope);
  await initDatabase();
  await processTask(task);
}, {
  visibilityTimeoutSeconds: 150,
});
