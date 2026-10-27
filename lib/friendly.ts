// Friendlies: pick any club in the league and play at once. No live match and no replay:
// just the result and the stats. Your players get tired and can get injured, so it is a real
// test with a real cost. The other club's players are not affected.
import { batch, q, one, type Row } from './db.ts';
import { aiTactic, simulate } from './engine.ts';
import { conditionsFor, LINE } from './game.ts';
import { getLeague, myClub } from './league.ts';
import { nextDay, staffLevels } from './club.ts';
import { fail } from './errors.ts';
import { hashSeed, rng } from './rng.ts';
import { sideFor } from './season.ts';
import { chemAfterMatch } from './chemistry.ts';

export async function playFriendly(uid: number, leagueId: number, oppId: number) {
  const l = await getLeague(leagueId);
  if (!['setup', 'running'].includes(l.status)) fail(400, 'Friendlies are played during the season and pre-season.');
  const club = await myClub(uid, leagueId);
  const opp = await one('SELECT * FROM clubs WHERE id=$1 AND league_id=$2', [oppId, leagueId]);
  if (!opp || opp.id === club.id) fail(400, 'Pick another club from your league.');
  const live = await one(`SELECT 1 FROM fixtures WHERE league_id=$1 AND status IN ('playing','live','finalizing') AND (home_id=$2 OR away_id=$2)`, [leagueId, club.id]);
  if (live) fail(400, 'Your team is playing a match right now.');
  const [mine, theirs] = await q<{ c: number; n: number }>(`SELECT club_id AS c, COUNT(*)::int AS n FROM squad WHERE club_id IN ($1,$2) GROUP BY club_id ORDER BY (club_id=$1) DESC`, [club.id, opp.id]);
  if ((mine?.c === club.id ? mine.n : 0) < 11) fail(400, 'You need at least 11 players.');
  void theirs;
  // "today" sits just before your next match day: a friendly the day before a match leaves the legs heavy
  const day = Math.max(1, (await nextDay(leagueId, club.id)) - 1);
  const n = Number((await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM friendlies WHERE club_id=$1', [club.id]))?.n || 0);
  // one friendly between two match days: enough to test something, not a way to farm chemistry
  const already = await one('SELECT 1 FROM friendlies WHERE club_id=$1 AND day=$2', [club.id, day]);
  if (already) fail(400, 'You already played a friendly before this match day. Try again after your next match.');
  const fx = { id: hashSeed('friendly', club.id, opp.id, n), league_id: leagueId, day, comp: 'friendly' };
  const me = await sideFor(club, l, fx, opp, true, null);
  const them = await sideFor(opp, l, fx, club, false, null);
  // a friendly is played at lower intensity: far fewer injuries than in a real match
  me.injuryRisk = (me.injuryRisk ?? 1) * 0.3;
  if (!opp.user_id) them.tactic = aiTactic(l.ai_level, [], hashSeed('fr-plan', fx.id), them.tactic.formation);
  const cond = conditionsFor(fx.id, l.pool, day);
  const rep = simulate(me, them, hashSeed(fx.id, leagueId), { weather: cond.weather, strict: cond.referee.strict });

  // tiredness and injuries for your players
  const lines = new Map(rep.players.map((p) => [p.id, p]));
  const doc = (await staffLevels(club.id)).doctor;
  const injured: string[] = [];
  const before = Math.round(me.xi.reduce((a, p) => a + p.fitness, 0) / me.xi.length);
  const rows = [...me.xi, ...me.bench].map((p) => {
    const ln = lines.get(p.id);
    let out = 0, knock = false;
    if (ln?.inj) {
      // most friendly injuries are knocks: sore legs, no match missed. A good doctor helps.
      const r = rng(hashSeed(p.id, fx.id)).next() + doc * 0.05;
      if (r < 0.65) knock = true;
      else out = r < 0.95 ? day + 1 : day + 2;
      injured.push(knock ? `${p.name} (a knock, he can play)` : `${p.name} (misses ${out - day} match${out - day > 1 ? 'es' : ''})`);
    }
    const fit = Math.round(ln && ln.mins > 0 ? ln.fitEnd : p.fitness) - (knock ? 12 : 0);
    return { id: p.id, fit: Math.max(20, fit), out };
  });
  await q(
    `UPDATE squad s SET fitness=x.fit,
       out_until = CASE WHEN x.out > 0 THEN GREATEST(s.out_until, x.out) ELSE s.out_until END,
       out_reason = CASE WHEN x.out > 0 THEN 'Injured (friendly)' ELSE s.out_reason END
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, fit int, out int) WHERE s.club_id=$2 AND s.player_id=x.id`,
    [JSON.stringify(rows), club.id],
  );
  const chem = chemAfterMatch(club.id, rep.players.filter((p) => p.side === 0).map((p) => ({ id: p.id, pos: p.pos, mins: p.mins })), rep.score[0] > rep.score[1] ? 'W' : rep.score[0] < rep.score[1] ? 'L' : 'D');
  if (chem) await batch([chem]);
  const chemBefore = me.chem;
  const after = Math.round(me.xi.reduce((a, p) => a + (lines.get(p.id)?.fitEnd ?? p.fitness), 0) / me.xi.length);
  const name = new Map([...me.xi, ...me.bench, ...them.xi, ...them.bench].map((p) => [p.id, p.name]));
  const data = {
    opp: { id: opp.id, name: opp.name, color1: opp.color1, color2: opp.color2, short: opp.short, human: !!opp.user_id },
    score: rep.score, stats: rep.stats, tactics: rep.tactics,
    goals: rep.events.filter((e) => e.type === 'goal').map((e) => ({ m: e.m, side: e.side, name: e.pid ? name.get(e.pid) : '' })),
    cards: rep.events.filter((e) => e.type === 'yellow' || e.type === 'red').map((e) => ({ m: e.m, side: e.side, type: e.type, name: e.pid ? name.get(e.pid) : '' })),
    motm: rep.motm ? name.get(rep.motm) : null,
    fitness: { before, after }, injured, chem: chemBefore,
    ratings: rep.players.filter((p) => p.side === 0 && p.mins > 0).map((p) => ({ name: p.name, pos: p.pos, r: Math.round(p.r * 10) / 10, g: p.g })).sort((a, b) => b.r - a.r),
  };
  await q('INSERT INTO friendlies (league_id, club_id, opp_id, day, data) VALUES ($1,$2,$3,$4,$5::jsonb)', [leagueId, club.id, opp.id, day, JSON.stringify(data)]);
  void LINE;
  return data;
}

export async function friendlyView(uid: number, leagueId: number) {
  const club = await myClub(uid, leagueId);
  const [clubs, recent] = await Promise.all([
    q(`SELECT c.id, c.name, c.short, c.color1, c.color2, c.shape, c.emblem, c.user_id IS NOT NULL AS human, c.division,
         (SELECT ROUND(AVG(o))::int FROM (SELECT p.ovr + s.ovr_delta AS o FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=c.id ORDER BY 1 DESC LIMIT 11) t) AS strength
       FROM clubs c WHERE c.league_id=$1 AND c.id<>$2 ORDER BY c.division, c.name`, [leagueId, club.id]),
    q('SELECT data, created_at FROM friendlies WHERE club_id=$1 ORDER BY id DESC LIMIT 5', [club.id]),
  ]);
  return { clubs, recent: recent.map((r) => ({ ...r.data, at: r.created_at })) };
}
