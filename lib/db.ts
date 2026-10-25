// Database access.
// - DATABASE_URL set (Neon): queries go over HTTPS with the Neon serverless driver.
//   This works on Cloudflare Workers, Vercel and plain Node, and keeps no open connections.
// - No DATABASE_URL: an embedded Postgres (PGlite) stored in ./.data, for playing on your computer.
// Tables and players are created by `npm run seed` (lib/seed.ts), never inside a web request.
import { neon, neonConfig } from '@neondatabase/serverless';

export type Row = Record<string, any>;
export type Impl = { q: (text: string, params?: unknown[]) => Promise<Row[]> };

const g = globalThis as unknown as { __kora_db?: Promise<Impl> };

async function open(): Promise<Impl> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // testing only: point the driver at a local stand-in for Neon's HTTP endpoint
    if (process.env.NEON_LOCAL_ENDPOINT) neonConfig.fetchEndpoint = () => process.env.NEON_LOCAL_ENDPOINT!;
    const sql = neon(url);
    return { q: async (t, p = []) => (await sql.query(t, p as any[])) as Row[] };
  }
  // Local only. The module name is hidden from the bundler so it never ships to Cloudflare.
  const name = '@electric-sql/pglite';
  const { PGlite } = await import(/* webpackIgnore: true */ name);
  const dir = process.env.PGLITE_DIR || `${process.cwd()}/.data/pglite`;
  const pg = new PGlite(dir === 'memory' ? undefined : dir);
  return { q: async (t, p = []) => (await pg.query(t, p as any[])).rows as Row[] };
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
