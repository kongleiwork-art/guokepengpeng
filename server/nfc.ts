import { db } from './db.ts';
import { DEMO_DOLL_SEEDS } from './data/seed.ts';

export async function findNfcTarget(alias: string) {
  if (!/^[a-z0-9_-]{2,64}$/i.test(alias)) return undefined;
  return await db.prepare(
    `SELECT nt.alias, nt.doll_id AS dollId, nt.label
     FROM nfc_tags nt JOIN dolls d ON d.id = nt.doll_id
     WHERE nt.alias = ?
     UNION ALL
     SELECT id, id, name FROM dolls WHERE id = ?
     LIMIT 1`
  ).get(alias.toLowerCase(), alias) as { alias: string; dollId: string; label: string } | undefined;
}

export function findSeedNfcTarget(alias: string) {
  const seed = DEMO_DOLL_SEEDS.find((doll) => doll.nfcAlias === alias.toLowerCase() || doll.id === alias);
  return seed ? { alias: seed.nfcAlias, dollId: seed.id, label: seed.name } : undefined;
}

export function nfcChatPath(dollId: string, alias: string) {
  return `/d/${encodeURIComponent(dollId)}/chat?entry=nfc&alias=${encodeURIComponent(alias)}`;
}
