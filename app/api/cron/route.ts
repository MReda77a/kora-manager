import { NextResponse } from 'next/server';
import { runDue } from '../../../lib/season.ts';
import { migrate } from '../../../lib/migrate.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Called by the Cloudflare timer (worker.ts) every minute. Plays due matches and says how many are left.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key') || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await migrate();
  return NextResponse.json(await runDue());
}
