// Keeps the live database's tables in step with the code. Every statement in SCHEMA is safe to re-run
// (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), so a deploy only needs to run it once.
// A short fingerprint of the schema is stored, so each server instance pays one quick query.
import { q } from './db.ts';
import { SCHEMA } from './schema.ts';

const VERSION = (() => { let h = 0; for (const c of SCHEMA) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); })();
let done: Promise<void> | null = null;

export function migrate() {
  done ||= (async () => {
    await q('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    const r = await q<{ v: string }>(`SELECT v FROM meta WHERE k='schema'`);
    if (r[0]?.v === VERSION) return;
    for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await q(stmt);
    await q(`INSERT INTO meta (k, v) VALUES ('schema', $1) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v`, [VERSION]);
  })().catch((e) => { done = null; throw e; });
  return done;
}
