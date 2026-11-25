import { createHmac, timingSafeEqual } from 'node:crypto';
import { send } from '@vercel/queue';
import { config } from '../config.ts';

export const TASK_TOPIC = 'nutshell-tasks';
export const TASK_VISIBILITY_TIMEOUT_SECONDS = 210;
export type Task = { kind: 'image' | 'output' | 'expire-photo'; id: string };
type Envelope = { task: Task; signature: string };

function signTask(task: Task): Buffer {
  if (!config.sessionSecret) throw new Error('Queue signing secret is missing');
  return createHmac('sha256', config.sessionSecret).update(`queue:${task.kind}:${task.id}`).digest();
}

export function publishTask(task: Task, delaySeconds = 0) {
  const envelope: Envelope = { task, signature: signTask(task).toString('base64url') };
  return send(TASK_TOPIC, envelope, {
    idempotencyKey: task.kind + ':' + task.id,
    delaySeconds,
    retentionSeconds: delaySeconds + 24 * 60 * 60,
  });
}

export function verifyTask(envelope: unknown): Task {
  const { task, signature } = (envelope || {}) as Partial<Envelope>;
  if (!task || !['image', 'output', 'expire-photo'].includes(task.kind) ||
      typeof task.id !== 'string' || !/^[a-z0-9_.-]{1,80}$/.test(task.id) ||
      typeof signature !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(signature)) {
    throw new Error('Invalid queue message');
  }
  if (!timingSafeEqual(Buffer.from(signature, 'base64url'), signTask(task))) {
    throw new Error('Invalid queue signature');
  }
  return task;
}
