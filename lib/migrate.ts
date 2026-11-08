// Keeps the live database's tables in step with the code. Every statement in SCHEMA is safe to re-run
// (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), so a deploy only needs to run it once.
// A short fingerprint of the schema is stored, so each server instance pays one quick query.
import { batch, q } from './db.ts';
import { SCHEMA } from './schema.ts';
import { wideMidOf } from './game.ts';

/** once: wingers with a midfielder's profile become LM / RM (a position the database did not have).
 * Only the player's natural position changes; a position a club trained him in stays as it is */
async function wideMids() {
  const done = await q<{ v: string }>(`SELECT v FROM meta WHERE k='lmrm'`);
  if (done.length) return;
  const rows = await q<{ id: string; pos: string; attrs: any }>(`SELECT id, pos, attrs FROM players WHERE pos IN ('LW','RW')`);
  const lm = rows.filter((p) => wideMidOf(p.pos, typeof p.attrs === 'string' ? JSON.parse(p.attrs) : p.attrs || {}) === 'LM').map((p) => p.id);
  const rm = rows.filter((p) => wideMidOf(p.pos, typeof p.attrs === 'string' ? JSON.parse(p.attrs) : p.attrs || {}) === 'RM').map((p) => p.id);
  if (lm.length) await q(`UPDATE players SET pos='LM' WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb))`, [JSON.stringify(lm)]);
  if (rm.length) await q(`UPDATE players SET pos='RM' WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb))`, [JSON.stringify(rm)]);
  await q(`INSERT INTO meta (k, v) VALUES ('lmrm', $1) ON CONFLICT (k) DO NOTHING`, [String(lm.length + rm.length)]);
}

const VERSION = (() => { let h = 0; for (const c of SCHEMA) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); })();
let done: Promise<void> | null = null;

export function migrate() {
  done ||= (async () => {
    await q('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    const r = await q<{ v: string }>(`SELECT v FROM meta WHERE k='schema'`);
    await wideMids();
    if (r[0]?.v === VERSION) return;
    // all statements in one round trip: a visit may only make 50 outgoing requests on the free plan
    await batch(SCHEMA.split(';').map((s) => s.trim()).filter(Boolean));
    await q(`INSERT INTO meta (k, v) VALUES ('schema', $1) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v`, [VERSION]);
  })().catch((e) => { done = null; throw e; });
  return done;
}
