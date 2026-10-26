// The match analyst: a report on the next opponent and a plan to beat them.
// It plays the match in secret with the real engine, your plan against their likely plans,
// and counts what works. A better analyst plays more matches (fewer mistakes) and knows more
// about what the other side will do. Level 1 is free; levels 2 and 3 cost club money.
import { q, one, type Row } from './db.ts';
import { aiPlan, counterShare, nearestPreset, simulate, type ESide } from './engine.ts';
import { conditionsFor, FORMATIONS, LINE, PRESETS, stripDesc, tacticFit, type Tactic } from './game.ts';
import { getLeague, myClub, standings } from './league.ts';
import { fail } from './errors.ts';
import { hashSeed, rng } from './rng.ts';
import { previewSides, recentPlans } from './season.ts';

export const ANALYST_LEVELS = {
  1: { name: 'Part-time analyst', price: 0, sims: 0, text: 'Spots their weak points and gives a rough plan. Can be wrong.' },
  2: { name: 'Match analyst', price: 5, sims: 12, text: 'Plays the match through hundreds of times. Knows their habits.' },
  3: { name: 'Head of analysis', price: 12, sims: 30, text: 'The sharpest advice, and what their manager is likely to pick.' },
} as const;
type Lvl = 1 | 2 | 3;

export const analystLevel = (c: Row): Lvl => Math.max(Number(c.analyst) || 1, c.club_type === 'academy' ? 2 : 1) as Lvl;

export async function upgradeAnalyst(uid: number, leagueId: number) {
  const club = await myClub(uid, leagueId);
  const now = analystLevel(club);
  if (now >= 3) fail(400, 'You already have the best analyst.');
  const next = (now + 1) as Lvl;
  const price = ANALYST_LEVELS[next].price;
  const paid = await q('UPDATE clubs SET money = money - $1, analyst = $2 WHERE id=$3 AND money >= $1 RETURNING money', [price, next, club.id]);
  if (!paid[0]) fail(400, `Not enough money: the ${ANALYST_LEVELS[next].name} costs ${price}M.`);
  await q('DELETE FROM analyst_reports WHERE club_id=$1', [club.id]);
  return { ok: true, level: next };
}

const PLANS = Object.keys(PRESETS);
const asTactic = (name: string, formation: string): Tactic => ({ preset: name, formation, ...stripDesc(PRESETS[name]) } as Tactic);
const presetOf = (t: any) => (t?.preset && PRESETS[t.preset] ? t.preset : nearestPreset(t));
const pct = (x: number) => Math.round(x * 100);

export async function analystReport(uid: number, leagueId: number, refresh = false) {
  const l = await getLeague(leagueId);
  const club = await myClub(uid, leagueId);
  const level = analystLevel(club);
  const staff = { level, ...ANALYST_LEVELS[level], next: level < 3 ? { level: level + 1, ...ANALYST_LEVELS[(level + 1) as Lvl] } : null };
  const f = await one(`SELECT * FROM fixtures WHERE league_id=$1 AND status='scheduled' AND (home_id=$2 OR away_id=$2) ORDER BY day, id LIMIT 1`, [leagueId, club.id]);
  if (!f) return { staff, report: null };
  // the report is kept until your plan, shape or line-up changes
  const key = String(hashSeed(level, JSON.stringify(club.tactic || {}), JSON.stringify(club.lineup || [])));
  if (!refresh) {
    const c = await one('SELECT data FROM analyst_reports WHERE club_id=$1 AND fixture_id=$2 AND key=$3', [club.id, f.id, key]);
    if (c) return { staff, report: c.data };
  }

  const { home, away, hs, as, derby } = await previewSides(l, f);
  const meHome = home.id === club.id;
  const me: ESide = meHome ? hs : as, them: ESide = meHome ? as : hs;
  const opp = meHome ? away : home;
  const formation = me.tactic.formation;

  // ---- who they are
  const [table, scorers, theirGames, myHistory, theirHistory] = await Promise.all([
    standings(leagueId, opp.division || 1),
    q(`SELECT player_id, goals FROM pstats WHERE league_id=$1 AND club_id=$2 AND goals > 0 ORDER BY goals DESC LIMIT 3`, [leagueId, opp.id]),
    q(`SELECT home_id, report->'shots' AS shots FROM fixtures WHERE league_id=$1 AND status='done' AND (home_id=$2 OR away_id=$2) ORDER BY day DESC LIMIT 6`, [leagueId, opp.id]),
    recentPlans(leagueId, club.id),
    recentPlans(leagueId, opp.id),
  ]);
  const row = table.find((t) => t.id === opp.id);
  const lineAvg = (s: ESide, ln: string, keys?: string[]) => {
    const ps = s.xi.filter((p) => (p.pos === 'GK' ? 'GK' : LINE[p.pos] || 'MID') === ln);
    if (!ps.length) return 0;
    return Math.round(ps.reduce((a, p) => a + (keys ? keys.reduce((b, k) => b + (p.a?.[k] ?? 60), 0) / keys.length : p.ovr), 0) / ps.length);
  };
  const lines = ['GK', 'DEF', 'MID', 'FWD'].map((ln) => ({ line: ln, mine: lineAvg(me, ln), theirs: lineAvg(them, ln) }));
  const goalsIn: Record<string, number> = {};
  for (const g of theirGames) for (const s of (g.shots || []) as any[]) {
    const theirSide = g.home_id === opp.id ? 0 : 1;
    if (s.goal && s.side !== theirSide) goalsIn[s.kind] = (goalsIn[s.kind] || 0) + 1;
  }
  const weak: string[] = [];
  const st = { defPace: lineAvg(them, 'DEF', ['Pace']), defAir: lineAvg(them, 'DEF', ['Heading', 'Jumping', 'Strength']), keeper: lineAvg(them, 'GK', ['Reflexes', 'Handling']), fwdPace: lineAvg(them, 'FWD', ['Pace']) };
  const myFwdPace = lineAvg(me, 'FWD', ['Pace']), myFwdAir = lineAvg(me, 'FWD', ['Heading', 'Jumping', 'Strength']);
  if (myFwdPace - st.defPace >= 5) weak.push(`Their defenders are slower than your forwards (pace ${st.defPace} vs ${myFwdPace}): through balls and a quick tempo.`);
  if (myFwdAir - st.defAir >= 5) weak.push(`You are stronger in the air (${myFwdAir} vs ${st.defAir}): play wide and cross.`);
  if (st.keeper <= 72) weak.push(`Their keeper is shaky (${st.keeper}): shoot from distance.`);
  const leaks = Object.entries(goalsIn).sort((a, b) => b[1] - a[1]);
  if (leaks[0] && leaks[0][1] >= 2) weak.push(`They have let in ${leaks[0][1]} goals from ${leaks[0][0] === 'through ball' ? 'through balls' : leaks[0][0] === 'cross' ? 'crosses' : leaks[0][0] === 'counter' ? 'counter-attacks' : leaks[0][0] + 's'} lately.`);
  const danger: string[] = [];
  if (st.fwdPace >= 80) danger.push(`Fast forwards (pace ${st.fwdPace}): do not play a high line.`);
  const star = [...them.xi].sort((a, b) => b.ovr - a.ovr)[0];
  const topScorer = scorers[0] ? them.xi.find((p) => p.id === scorers[0].player_id) : null;
  if (topScorer) danger.push(`${topScorer.name} has ${scorers[0].goals} goals this season.`);
  else if (star) danger.push(`Their best player is ${star.name} (${star.ovr}).`);

  // ---- what they will probably play
  let likely: { plan: string; p: number }[];
  let likelyNote: string;
  if (level === 1) {
    likely = PLANS.map((p) => ({ plan: p, p: 1 / PLANS.length }));
    likelyNote = 'Your part-time analyst cannot read their plans. A better analyst can.';
  } else if (!opp.user_id) {
    // AI managers react to what you have been playing; sample how they would decide
    const counts: Record<string, number> = {};
    const n = level === 3 ? 24 : 10;
    for (let k = 0; k < n; k++) {
      const t = aiPlan({ level: level === 3 ? l.ai_level : Math.max(1, l.ai_level - 1), oppHistory: myHistory, own: them.xi, opp: me.xi, seed: hashSeed('analyst', f.id, k), formation: them.tactic.formation });
      const p = presetOf(t);
      counts[p] = (counts[p] || 0) + 1;
    }
    likely = Object.entries(counts).map(([plan, c]) => ({ plan, p: c / n })).sort((a, b) => b.p - a.p);
    likelyNote = myHistory.length ? `AI managers study your last plans (last time you played ${myHistory[0]}).` : 'They will pick a plan that suits their players.';
  } else {
    const w: Record<string, number> = {};
    theirHistory.forEach((p, i) => { w[p] = (w[p] || 0) + [1, 0.6, 0.35, 0.2][i]; });
    const tot = Object.values(w).reduce((a, x) => a + x, 0);
    likely = tot ? Object.entries(w).map(([plan, x]) => ({ plan, p: x / tot })).sort((a, b) => b.p - a.p) : PLANS.map((p) => ({ plan: p, p: 1 / PLANS.length }));
    likelyNote = theirHistory.length ? `From their last ${theirHistory.length} matches. A friend can always surprise you.` : 'No matches to study yet.';
  }
  const top = likely.slice(0, 3);
  const tw = top.reduce((a, x) => a + x.p, 0);

  // ---- which plan works best
  const cond = conditionsFor(f.id, l.pool, f.day);
  const r = rng(hashSeed('analyst-noise', f.id, club.id));
  const slots = (FORMATIONS[formation] || FORMATIONS['4-3-3']).slots;
  const fitXi = me.xi.map((p, i) => ({ pos: p.pos, slot: slots[i], ovr: p.ovr, a: p.a || {} }));
  const results = PLANS.map((plan) => {
    let w = 0, d = 0, lo = 0;
    if (level === 1) {
      // no simulations: a rule of thumb (which plan beats what) plus a guess, so it can be wrong
      const counter = likely.reduce((a, x) => a + counterShare(plan, x.plan) * x.p, 0);
      const fit = tacticFit(fitXi as any, stripDesc(PRESETS[plan])).fit;
      const v = counter + fit * 0.05 + (r.next() - 0.5) * 0.12;
      return { plan, score: v, win: null as number | null, draw: null as number | null, loss: null as number | null };
    }
    const sims = ANALYST_LEVELS[level].sims;
    for (const t of top) {
      const myT = { ...me.tactic, ...asTactic(plan, formation) };
      const theirT = asTactic(t.plan, them.tactic.formation);
      const a = { ...me, tactic: myT }, b = { ...them, tactic: theirT };
      for (let k = 0; k < sims; k++) {
        const rep = meHome ? simulate(a, b, hashSeed('an', f.id, plan, t.plan, k), { knockout: f.comp === 'cup', derby, weather: cond.weather, strict: cond.referee.strict })
          : simulate(b, a, hashSeed('an', f.id, plan, t.plan, k), { knockout: f.comp === 'cup', derby, weather: cond.weather, strict: cond.referee.strict });
        const [x, y] = meHome ? rep.score : [rep.score[1], rep.score[0]];
        const wt = t.p / tw / sims;
        const winnerMine = rep.winner !== undefined ? rep.winner === (meHome ? 0 : 1) : null;
        if (winnerMine === true || (winnerMine === null && x > y)) w += wt; else if (winnerMine === false || (winnerMine === null && x < y)) lo += wt; else d += wt;
      }
    }
    return { plan, score: 3 * w + d, win: pct(w), draw: pct(d), loss: pct(lo) };
  }).sort((a, b) => b.score - a.score);

  const best = results[0], second = results[1], worst = results[results.length - 1];
  const gap = best.score - second.score;
  const confidence = level === 1 ? 'Low' : level === 2 ? (gap > 0.15 ? 'Medium' : 'Low') : gap > 0.12 ? 'High' : 'Medium';
  const main = likely[0]?.plan;
  const chase = level >= 2 && main ? PLANS.filter((p) => p !== main).sort((a, b) => counterShare(b, main) - counterShare(a, main))[0] : null;
  const report = {
    fixture: { id: f.id, day: f.day, home: home.name, away: away.name, comp: f.comp, kickoff: f.kickoff_at },
    opponent: { id: opp.id, name: opp.name, human: !!opp.user_id, pos: row ? table.indexOf(row) + 1 : null, form: row?.form || [], pts: row?.pts ?? 0 },
    lines, weak: weak.slice(0, 3), danger: danger.slice(0, 2),
    likely: level === 1 ? [] : likely.slice(0, 3).map((x) => ({ plan: x.plan, p: pct(x.p) })), likelyNote,
    plans: (level === 1 ? results.slice(0, 3) : results).map((x) => ({ plan: x.plan, win: x.win, draw: x.draw, loss: x.loss })),
    best: best.plan, avoid: worst.plan, confidence,
    tip: chase ? `If you need a goal late on, switch to ${chase}: it is the best answer to ${main}.` : null,
    myLast: myHistory[0] || null,
    made: new Date().toISOString(),
  };
  await q(
    `INSERT INTO analyst_reports (club_id, fixture_id, key, data) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (club_id, fixture_id) DO UPDATE SET key=EXCLUDED.key, data=EXCLUDED.data, created_at=now()`,
    [club.id, f.id, key, JSON.stringify(report)],
  );
  return { staff, report };
}
