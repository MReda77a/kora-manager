// Node only: creates the tables and loads the players. Run with `npm run seed`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { db } from './db.ts';
import { SCHEMA } from './schema.ts';
import { academyFor, type RawPlayer } from './academy.ts';

export async function ensureSeeded() {
  const impl = await db();
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await impl.q(stmt);
  // leagues started with the first test version (no day schedule) cannot run on the new season clock
  await impl.q(`DELETE FROM leagues WHERE status <> 'setup' AND NOT EXISTS (SELECT 1 FROM days d WHERE d.league_id = leagues.id)`);
  const [{ n }] = await impl.q('SELECT COUNT(*)::int AS n FROM players');
  if (n > 0) return n as number;
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
    await impl.q(
      `INSERT INTO players (id, name, pool, nat, pos, foot, age, height, ovr, pot, attrs)
       SELECT id, name, pool, nat, pos, foot, age, height, ovr, pot, attrs
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, pool text, nat text, pos text, foot text, age int, height int, ovr int, pot int, attrs jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(all.slice(i, i + 400))],
    );
  }
  return all.length;
}
