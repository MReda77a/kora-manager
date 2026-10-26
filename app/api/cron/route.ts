import { NextResponse } from 'next/server';
import { runDue } from '../../../lib/season.ts';
import { migrate } from '../../../lib/migrate.ts';
import { counter, one } from '../../../lib/db.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Called by the Cloudflare timer (worker.ts) every minute. Plays due matches and says how many are left.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key') || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const start = counter.n;
  await migrate();
  const r = await runDue();
  // when the timer next needs to come back: a kick-off, a live match ending, a day to wrap up
  const next = await one<{ t: string | null }>(
    `SELECT LEAST(
       (SELECT MIN(kickoff_at) FROM fixtures WHERE status='scheduled'),
       (SELECT MIN(live_until) FROM fixtures WHERE status='live'),
       (SELECT MIN(claimed_at) + interval '2 minutes' FROM fixtures WHERE status IN ('playing','finalizing')),
       (SELECT MIN(kickoff_at) FROM days WHERE processed=false)) AS t`,
  );
  const used = counter.n - start;
  if (used > 25) console.warn(`[queries] ${used} database requests in one cron visit (played ${r.played})`);
  return NextResponse.json({ ...r, queries: used, nextDue: next?.t ? new Date(next.t).getTime() : null });
}
