import { NextResponse } from 'next/server';
import { runDue } from '../../../lib/league.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Called by the GitHub Actions schedule (and Vercel cron if you add one).
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key') || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const played = await runDue();
  return NextResponse.json({ played });
}
