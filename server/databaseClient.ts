import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type InArgs, type Transaction } from '@libsql/client';
import { config } from './config.ts';

const remote = process.env.TURSO_DATABASE_URL || process.env.TURSO_DB_URL;
export const hasRemoteDatabase = Boolean(remote);
const transactions = new AsyncLocalStorage<Transaction>();
let connection: ReturnType<typeof createClient>;

function client() {
  if (!connection) {
    if (process.env.VERCEL && !remote) throw new Error('预览数据库尚未连接');
    if (!remote) fs.mkdirSync(path.dirname(config.databaseUrl), { recursive: true });
    connection = createClient({
      url: remote ? remote.replace(/^libsql:\/\//, 'https://') : pathToFileURL(config.databaseUrl).href,
      authToken: remote ? process.env.TURSO_AUTH_TOKEN || process.env.TURSO_DATABASE_AUTH_TOKEN : undefined,
    });
  }
  return connection;
}

export const db = {
  prepare(sql: string) {
    const execute = (...values: unknown[]) => {
      let args = values as InArgs;
      if (values.length === 1 && values[0] && typeof values[0] === 'object' && !ArrayBuffer.isView(values[0])) {
        const bindings = values[0] as Record<string, unknown>;
        args = Object.fromEntries(Array.from(sql.matchAll(/@(\w+)/g), ([, key]) => [key, bindings[key]])) as InArgs;
      }
      return (transactions.getStore() || client()).execute({ sql, args });
    };
    return {
      async get(...args: unknown[]): Promise<unknown> { return (await execute(...args)).rows[0]; },
      async all(...args: unknown[]): Promise<unknown[]> { return (await execute(...args)).rows; },
      async run(...args: unknown[]) { return { changes: (await execute(...args)).rowsAffected }; },
    };
  },
  exec(sql: string) { return (transactions.getStore() || client()).executeMultiple(sql); },
  transaction<T>(fn: () => Promise<T>) {
    return async () => {
      if (transactions.getStore()) return fn();
      const tx = await client().transaction('write');
      try {
        const result = await transactions.run(tx, fn);
        await tx.commit();
        return result;
      } catch (err) {
        if (!tx.closed) await tx.rollback();
        throw err;
      } finally { tx.close(); }
    };
  },
};
