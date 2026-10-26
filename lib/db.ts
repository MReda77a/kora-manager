// Database access.
// - DATABASE_URL set (Neon): queries go over HTTPS with the Neon serverless driver.
//   This works on Cloudflare Workers, Vercel and plain Node, and keeps no open connections.
// - No DATABASE_URL: an embedded Postgres (PGlite) stored in ./.data, for playing on your computer.
// Tables and players are created by `npm run seed` (lib/seed.ts), never inside a web request.
import { neon, neonConfig } from '@neondatabase/serverless';

export type Row = Record<string, any>;
export type Stmt = string | { text: string; params?: unknown[] };
export type Impl = { q: (text: string, params?: unknown[]) => Promise<Row[]>; batch: (stmts: Stmt[]) => Promise<void> };
const norm = (s: Stmt) => (typeof s === 'string' ? { text: s, params: [] as unknown[] } : { text: s.text, params: s.params || [] });

const g = globalThis as unknown as { __kora_db?: Promise<Impl> };

async function open(): Promise<Impl> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // testing only: point the driver at a local stand-in for Neon's HTTP endpoint
    if (process.env.NEON_LOCAL_ENDPOINT) neonConfig.fetchEndpoint = () => process.env.NEON_LOCAL_ENDPOINT!;
    const sql = neon(url);
    return {
      q: async (t, p = []) => (await sql.query(t, p as any[])) as Row[],
      // many statements in ONE request (Cloudflare allows only 50 outgoing requests per visit on the free plan)
      batch: async (ts) => { if (ts.length) await sql.transaction(ts.map(norm).map((x) => sql.query(x.text, x.params as any[]))); },
    };
  }
  // Local only. The module name is hidden from the bundler so it never ships to Cloudflare.
  const name = '@electric-sql/pglite';
  const { PGlite } = await import(/* webpackIgnore: true */ name);
  const dir = process.env.PGLITE_DIR || `${process.cwd()}/.data/pglite`;
  const pg = new PGlite(dir === 'memory' ? undefined : dir);
  return {
    q: async (t, p = []) => (await pg.query(t, p as any[])).rows as Row[],
    batch: async (ts) => { for (const x of ts.map(norm)) await pg.query(x.text, x.params as any[]); },
  };
}

export function db(): Promise<Impl> {
  if (!g.__kora_db) g.__kora_db = open();
  return g.__kora_db;
}

// Every query is one outgoing request on Cloudflare; count them so heavy requests show up in the logs.
export const counter = { n: 0 };
export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  counter.n++;
  return (await (await db()).q(text, params)) as T[];
}

export async function batch(stmts: Stmt[]) {
  if (!stmts.length) return;
  counter.n++;
  await (await db()).batch(stmts);
}

// Collects writes and sends them together in one request (one transaction).
export function writes() {
  const list: Stmt[] = [];
  return { add: (text: string, params: unknown[] = []) => { list.push({ text, params }); }, flush: async () => { const l = list.splice(0); await batch(l); }, get size() { return list.length; } };
}

export async function one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const r = await q<T>(text, params);
  return r[0] ?? null;
}
