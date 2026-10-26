import { NextResponse } from 'next/server';
import { getSession, type Session } from './auth.ts';

import { HttpError, fail } from './errors.ts';
import { migrate } from './migrate.ts';
import { counter } from './db.ts';
export { HttpError, fail };

export async function requireUser(): Promise<Session> {
  const s = await getSession();
  if (!s) fail(401, 'Please log in first.');
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
