import { one, q } from '../../../../lib/db.ts';
import { fail, handle, requireUser } from '../../../../lib/http.ts';
import { runDue, cupState } from '../../../../lib/season.ts';
import { LIVE_SECONDS, WEATHER, conditionsFor, matchKits } from '../../../../lib/game.ts';
import { PRESS } from '../../../../lib/people.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ fid: string }> }) => {
  const s = await requireUser();
  const { fid } = await ctx.params;
  let f = await one('SELECT * FROM fixtures WHERE id=$1', [Number(fid)]);
  if (!f) fail(404, 'Match not found.');
  const member = await one('SELECT id FROM clubs WHERE league_id=$1 AND user_id=$2', [f.league_id, s.uid]);
  if (!member) fail(403, 'You are not in this league.');
  const due = (f.status === 'scheduled' && new Date(f.kickoff_at).getTime() <= Date.now()) || (f.status === 'live' && new Date(f.live_until).getTime() <= Date.now());
  if (due) {
    await runDue(f.league_id, { prefer: f.id, light: true });
    f = await one('SELECT * FROM fixtures WHERE id=$1', [Number(fid)]);
  }
  const clubs = await q('SELECT id, name, short, color1, color2, away1, away2, pattern, shape, emblem, club_type, user_id, stadium, fans, capacity, pens, assistant, plans, league_id FROM clubs WHERE id IN ($1,$2)', [f!.home_id, f!.away_id]);
  const home = clubs.find((c) => c.id === f!.home_id)!, away = clubs.find((c) => c.id === f!.away_id)!;
  const users = await q('SELECT id, username FROM users WHERE id IN ($1,$2)', [home.user_id || 0, away.user_id || 0]);
  const uname = (id: number | null) => users.find((u) => u.id === id)?.username ?? null;
  let names: Record<string, { name: string; pos: string; ovr: number }> = {};
  const rep = f!.status === 'live' || f!.status === 'finalizing' || f!.status === 'done' ? f!.report : null;
  if (rep) {
    const ids = [...new Set([...rep.players.map((p: any) => p.id), ...rep.lineups.flatMap((x: any) => [...x.xi, ...x.bench])])];
    const rows = await q('SELECT id, name, pos, ovr FROM players WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb))', [JSON.stringify(ids)]);
    names = Object.fromEntries(rows.map((r) => [r.id, { name: r.name, pos: r.pos, ovr: r.ovr }]));
  }
  const comments = await q(
    `SELECT c.text, c.tone, c.club_id, cl.name AS club FROM comments c JOIN clubs cl ON cl.id=c.club_id WHERE c.league_id=$1 AND c.day=$2 AND c.club_id IN ($3,$4)`,
    [f!.league_id, f!.day, home.id, away.id],
  );
  let roundName: string | null = null;
  if (f!.comp === 'cup') {
    const cup = await cupState(f!.league_id);
    roundName = cup ? `${cup.name} · ${cup.rounds[f!.round - 1]?.name}` : 'Cup';
  }
  const lg = await one('SELECT pool FROM leagues WHERE id=$1', [f!.league_id]);
  const cond = conditionsFor(f!.id, lg!.pool, f!.day);
  const kits = matchKits(home, away);
  const mineSide = home.user_id === s.uid ? 0 : away.user_id === s.uid ? 1 : null;
  const myPlans = mineSide == null ? [] : Object.keys({ A: 1, ...((mineSide === 0 ? home : away).plans || {}) }).sort();
  const pub = (c: any) => ({ id: c.id, name: c.name, short: c.short, color1: c.color1, color2: c.color2, shape: c.shape, emblem: c.emblem, club_type: c.club_type, stadium: c.stadium, fans: c.fans, capacity: c.capacity, human: !!c.user_id, mine: c.user_id === s.uid, manager: uname(c.user_id) });
  return {
    fixture: {
      id: f!.id, leagueId: f!.league_id, matchday: f!.matchday, day: f!.day, comp: f!.comp, round: f!.round, roundName,
      kickoff: f!.kickoff_at, status: f!.status, liveFrom: f!.live_from, liveUntil: f!.live_until, score: [f!.home_goals, f!.away_goals],
      changes: f!.changes || [],
    },
    home: pub(home), away: pub(away),
    derby: home.club_type === 'fan' && away.club_type === 'fan' && !!home.user_id && !!away.user_id,
    kits, conditions: { ...cond, weatherInfo: WEATHER[cond.weather] }, plans: myPlans,
    press: { done: mineSide != null && String(mineSide) in (f!.press || {}), choice: mineSide != null ? (f!.press || {})[String(mineSide)] ?? null : null, options: Object.entries(PRESS).map(([k, v]) => ({ key: k, label: v.label })) },
    report: rep, names, comments, liveSeconds: LIVE_SECONDS, now: new Date().toISOString(),
  };
});
