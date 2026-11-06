import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, type Session } from './auth.ts';

import { HttpError, fail } from './errors.ts';
import { migrate } from './migrate.ts';
import { counter, q } from './db.ts';
export { HttpError, fail };

// when each manager last opened the game (written at most every few minutes per server instance)
const seen = new Map<number, number>();
const langs = new Map<number, string>();
export async function requireUser(): Promise<Session> {
  const s = await getSession();
  if (!s) fail(401, 'Please log in first.');
  const now = Date.now();
  // the language they play in (the EN/ع switch sets a cookie), so their phone notifications match
  let lang = 'en';
  try { lang = (await cookies()).get('vamos-lang')?.value === 'ar' ? 'ar' : 'en'; } catch {}
  const langChanged = langs.has(s.uid) ? langs.get(s.uid) !== lang : lang === 'ar';
  if ((seen.get(s.uid) ?? 0) < now - 3 * 60_000 || langChanged) {
    seen.set(s.uid, now);
    langs.set(s.uid, lang);
    try { await q('UPDATE users SET last_seen=now(), lang=$2 WHERE id=$1', [s.uid, lang]); } catch {}
  }
  return s;
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    const start = counter.n;
    try {
      await migrate();
      const data = await fn(...args);
      const used = counter.n - start;
      if (used > 25) console.warn(`[queries] ${used} database requests in one visit${typeof (args[0] as any)?.url === 'string' ? ` (${new URL((args[0] as any).url).pathname})` : ''}`);
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: 'Something went wrong on the server. Try again.' }, { status: 500 });
    }
  };
}

export async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    fail(400, 'Bad request.');
  }
}
