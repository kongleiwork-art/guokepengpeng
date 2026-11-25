import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { buffer } from 'node:stream/consumers';
import { BlobNotFoundError, del, get, head, put } from '@vercel/blob';
import { config } from './config.ts';

export type MediaKey = `photos/${string}` | `generated/${string}`;

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof BlobNotFoundError;
}

export async function writeMedia(key: MediaKey, data: Buffer, contentType: string): Promise<void> {
  if (config.isVercel) {
    await put(key, data, { access: 'private', contentType, addRandomSuffix: false });
    return;
  }
  const file = path.join(config.storagePath, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

export async function mediaExists(key: MediaKey): Promise<boolean> {
  try {
    if (config.isVercel) await head(key);
    else await fs.access(path.join(config.storagePath, key));
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

export async function openMedia(key: MediaKey): Promise<Readable | null> {
  try {
    if (config.isVercel) {
      const result = await get(key, { access: 'private', useCache: false });
      return result?.statusCode === 200 ? Readable.fromWeb(result.stream as unknown as NodeReadableStream<Uint8Array>) : null;
    }
    const file = await fs.open(path.join(config.storagePath, key), 'r');
    return file.createReadStream();
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

export async function readMedia(key: MediaKey): Promise<Buffer | null> {
  const stream = await openMedia(key);
  return stream ? buffer(stream) : null;
}

export async function deleteMedia(key: MediaKey): Promise<void> {
  if (config.isVercel) await del(key);
  else await fs.rm(path.join(config.storagePath, key), { force: true });
}
