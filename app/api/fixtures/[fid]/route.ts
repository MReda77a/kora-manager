import { one } from '../../../../lib/db.ts';
import { fail, handle, requireUser } from '../../../../lib/http.ts';
import { runDue } from '../../../../lib/league.ts';
import { q } from '../../../../lib/db.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ fid: string }> }) => {
  const s = await requireUser();
  const { fid } = await ctx.params;
  let f = await one('SELECT * FROM fixtures WHERE id=$1', [Number(fid)]);
  if (!f) fail(404, 'Match not found.');
  if (f.status !== 'done' && new Date(f.kickoff_at).getTime() <= Date.now()) {
    await runDue(f.league_id, { prefer: f.id });
    f = await one('SELECT * FROM fixtures WHERE id=$1', [Number(fid)]);
  }
  const clubs = await q('SELECT id, name, short, color1, color2, shape, emblem, club_type, user_id, stadium FROM clubs WHERE id IN ($1,$2)', [f!.home_id, f!.away_id]);
  const member = await one('SELECT id FROM clubs WHERE league_id=$1 AND user_id=$2', [f!.league_id, s.uid]);
  if (!member) fail(403, 'You are not in this league.');
  const home = clubs.find((c) => c.id === f!.home_id)!, away = clubs.find((c) => c.id === f!.away_id)!;
  let names: Record<string, { name: string; pos: string; ovr: number }> = {};
  if (f!.report) {
    const ids = f!.report.players.map((p: any) => p.id);
    const rows = await q('SELECT id, name, pos, ovr FROM players WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb))', [JSON.stringify(ids)]);
    names = Object.fromEntries(rows.map((r) => [r.id, { name: r.name, pos: r.pos, ovr: r.ovr }]));
  }
  return {
    fixture: { id: f!.id, leagueId: f!.league_id, matchday: f!.matchday, kickoff: f!.kickoff_at, status: f!.status, score: [f!.home_goals, f!.away_goals] },
    home: { ...home, human: !!home.user_id, mine: home.user_id === s.uid },
    away: { ...away, human: !!away.user_id, mine: away.user_id === s.uid },
    derby: home.club_type === 'fan' && away.club_type === 'fan' && !!home.user_id && !!away.user_id,
    report: f!.report, names, now: new Date().toISOString(),
  };
});
