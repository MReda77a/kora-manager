import { one, q } from '../../../../lib/db.ts';
import { fail, handle, requireUser } from '../../../../lib/http.ts';
import { runDue, cupState } from '../../../../lib/season.ts';
import { LIVE_SECONDS, HT_SECONDS, WEATHER, conditionsFor, matchKits, minuteAt } from '../../../../lib/game.ts';
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
  let names: Record<string, { name: string; pos: string; ovr: number; num?: number; fit?: number }> = {};
  const full = f!.status === 'live' || f!.status === 'finalizing' || f!.status === 'done' ? f!.report : null;
  // while a match is live nobody gets more than what has happened (plus a few seconds for the pitch to
  // animate): the rest can still change when either manager makes a change, and it must not be read early
  const liveNow = f!.status === 'live' && f!.live_from && new Date(f!.live_until).getTime() > Date.now();
  const cut = liveNow ? minuteAt((Date.now() - new Date(f!.live_from).getTime()) / 1000, HT_SECONDS, LIVE_SECONDS) + 2.5 : 99;
  if (full) {
    const ids = [...new Set([...full.players.map((p: any) => p.id), ...full.lineups.flatMap((x: any) => [...x.xi, ...x.bench])])];
    const rows = await q('SELECT id, name, pos, ovr FROM players WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb))', [JSON.stringify(ids)]);
    const nums: Record<string, number> = {}, fits: Record<string, number> = {};
    for (const side of (f!.sides || []) as any[]) for (const p of [...(side.xi || []), ...(side.bench || [])]) { if (p.num) nums[p.id] = p.num; if (p.fitness != null) fits[p.id] = Math.round(p.fitness); }
    names = Object.fromEntries(rows.map((r) => [r.id, { name: r.name, pos: r.pos, ovr: r.ovr, num: nums[r.id], fit: fits[r.id] }]));
  }
  const rep = full && liveNow ? soFar(full, cut, fits0(f!.sides)) : full;
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
      kickoff: f!.kickoff_at, status: f!.status, liveFrom: f!.live_from, liveUntil: f!.live_until, score: liveNow ? null : [f!.home_goals, f!.away_goals],
      changes: f!.changes || [],
    },
    home: pub(home), away: pub(away),
    derby: home.club_type === 'fan' && away.club_type === 'fan' && !!home.user_id && !!away.user_id,
    kits, conditions: { ...cond, weatherInfo: WEATHER[cond.weather] }, plans: myPlans,
    press: { done: mineSide != null && String(mineSide) in (f!.press || {}), choice: mineSide != null ? (f!.press || {})[String(mineSide)] ?? null : null, options: Object.entries(PRESS).map(([k, v]) => ({ key: k, label: v.label })) },
    report: rep, names, comments, liveSeconds: LIVE_SECONDS, htSeconds: HT_SECONDS, now: new Date().toISOString(),
  };
});

const fits0 = (sides: any[]) => {
  const out: Record<string, number> = {};
  for (const side of (sides || []) as any[]) for (const p of [...(side.xi || []), ...(side.bench || [])]) if (p.fitness != null) out[p.id] = p.fitness;
  return out;
};

// The match up to minute `cut`: events, shots, momentum and plans so far, ratings and fitness as they stand.
// No final score, stats, winner or man of the match.
function soFar(rep: any, cut: number, fit0: Record<string, number>) {
  const events = rep.events.filter((e: any) => e.m <= cut);
  const on = new Map<string, number>();
  for (const e of events) if (e.type === 'sub' && e.pid) on.set(e.pid, e.m);
  const starters = new Set<string>(rep.lineups.flatMap((x: any) => x.xi));
  const rating = (id: string) => {
    let r = 6;
    for (const e of events) {
      if (e.type === 'goal' && e.pid === id) r += 1;
      if (e.type === 'goal' && e.pid2 === id) r += 0.6;
      if (e.type === 'save' && e.pid === id) r += 0.3;
      if (e.type === 'yellow' && e.pid === id) r -= 0.4;
      if (e.type === 'red' && e.pid === id) r -= 1.5;
    }
    return Math.round(Math.max(3, Math.min(10, r)) * 10) / 10;
  };
  const players = rep.players.map((p: any) => {
    const from = on.has(p.id) ? on.get(p.id)! : starters.has(p.id) ? 0 : null;
    if (from == null) return { ...p, mins: 0, r: 6, fitEnd: fit0[p.id] ?? p.fitEnd, goals: 0, assists: 0 };
    const played = Math.max(0, Math.min(p.mins, cut - from));
    const f0 = fit0[p.id] ?? p.fitEnd;
    return { ...p, mins: Math.max(1, played), fitEnd: Math.round(f0 + (p.fitEnd - f0) * (played / Math.max(1, p.mins))), r: rating(p.id), goals: undefined, assists: undefined };
  });
  return {
    partial: true, events, players, lineups: rep.lineups,
    shots: (rep.shots || []).filter((s: any) => s.m <= cut),
    flow: rep.flow ? rep.flow.filter((x: any) => x[0] <= cut) : undefined,
    styles: rep.styles ? rep.styles.filter((x: any) => x.m <= cut) : undefined,
  };
}
