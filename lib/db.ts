// Database access. Uses Postgres (Neon) when DATABASE_URL is set,
// otherwise an embedded Postgres (PGlite) stored in ./.data for local play.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema.ts';
import { academyFor, type RawPlayer } from './academy.ts';

export type Row = Record<string, any>;
type Impl = { q: (text: string, params?: unknown[]) => Promise<Row[]> };

const g = globalThis as unknown as { __kora_db?: Promise<Impl> };

async function open(): Promise<Impl> {
  let impl: Impl;
  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, {
      ssl: process.env.DATABASE_SSL === 'false' ? false : 'require',
      max: 5,
      prepare: false,
      idle_timeout: 20,
    });
    impl = { q: async (t, p = []) => (await sql.unsafe(t, p as any[])) as unknown as Row[] };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(process.cwd(), '.data', 'pglite');
    const db = new PGlite(dir === 'memory' ? undefined : dir);
    impl = { q: async (t, p = []) => (await db.query(t, p as any[])).rows as Row[] };
  }
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await impl.q(stmt);
  }
  await seedPlayers(impl);
  return impl;
}

async function seedPlayers(impl: Impl) {
  const [{ n }] = await impl.q('SELECT COUNT(*)::int AS n FROM players');
  if (n > 0) return;
  const file = path.join(process.cwd(), 'data', 'players.json');
  const data = JSON.parse(readFileSync(file, 'utf8')).players as any[];
  const POOL: Record<string, string> = {
    England: 'ENG', Spain: 'ESP', Italy: 'ITA', Germany: 'GER', France: 'FRA', 'Saudi Arabia': 'KSA', USA: 'USA', Egypt: 'EGY',
  };
  const real: RawPlayer[] = data.map((p) => ({
    id: p.id, name: p.name, pool: POOL[p.country] || 'ENG', nat: p.nationality || '', pos: p.position, foot: p.foot === 'Left' ? 'L' : 'R',
    age: p.age, height: p.heightCm, ovr: p.overall, pot: p.potential,
    attrs: { v: p.valueM, ...p.attributes, ...p.goalkeeping, ...p.hidden },
  }));
  const all = [...real];
  for (const pool of Object.values(POOL)) all.push(...academyFor(pool, real.filter((p) => p.pool === pool)));
  for (let i = 0; i < all.length; i += 400) {
    const chunk = all.slice(i, i + 400);
    await impl.q(
      `INSERT INTO players (id, name, pool, nat, pos, foot, age, height, ovr, pot, attrs)
       SELECT id, name, pool, nat, pos, foot, age, height, ovr, pot, attrs
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, pool text, nat text, pos text, foot text, age int, height int, ovr int, pot int, attrs jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(chunk)],
    );
  }
}

export function db(): Promise<Impl> {
  if (!g.__kora_db) g.__kora_db = open();
  return g.__kora_db;
}

export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await (await db()).q(text, params)) as T[];
}

export async function one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const r = await q<T>(text, params);
  return r[0] ?? null;
}
