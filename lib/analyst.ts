// The match analyst: a report on the next opponent and a plan to beat them.
// It plays the match in secret with the real engine, your plan against their likely plans,
// and counts what works. A better analyst plays more matches (fewer mistakes) and knows more
// about what the other side will do. Level 1 is free; levels 2 and 3 cost club money.
import { q, one, type Row } from './db.ts';
import { aiPlan, counterShare, nearestPreset, simulate, type ESide } from './engine.ts';
import { conditionsFor, FORMATIONS, LINE, PRESETS, stripDesc, tacticFit, type Tactic , roleName } from './game.ts';
import { getLeague, myClub, standings } from './league.ts';
import { fail } from './errors.ts';
import { hashSeed, rng } from './rng.ts';
import { previewSides, recentPlans } from './season.ts';

export const ANALYST_LEVELS = {
  1: { name: 'Part-time analyst', price: 0, sims: 0, text: 'Spots their weak points and gives a rough plan. Can be wrong.' },
  2: { name: 'Match analyst', price: 5, sims: 30, text: 'Plays the match through hundreds of times. Knows their habits.' },
  3: { name: 'Head of analysis', price: 12, sims: 60, text: 'The sharpest advice, and what their manager is likely to pick.' },
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
  const own = analystLevel(club);
  const f = await one(`SELECT * FROM fixtures WHERE league_id=$1 AND status='scheduled' AND (home_id=$2 OR away_id=$2) ORDER BY day, id LIMIT 1`, [leagueId, club.id]);
  // a coin boost lends you the next analyst up for one match
  const boosted = !!f && club.analyst_boost_fx === f.id && own < 3;
  const level = (boosted ? own + 1 : own) as Lvl;
  const staff = { level, own, boosted, ...ANALYST_LEVELS[level], next: own < 3 ? { level: own + 1, ...ANALYST_LEVELS[(own + 1) as Lvl] } : null };
  if (!f) return { staff, report: null };
  // the report is kept until your plan, shape or line-up changes
  const key = String(hashSeed('v4', level, JSON.stringify(club.tactic || {}), JSON.stringify(club.lineup || [])));
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
  const myDefPace = lineAvg(me, 'DEF', ['Pace']);
  if (st.fwdPace - myDefPace >= 3) danger.push(`Fast forwards (pace ${st.fwdPace} vs your defenders' ${myDefPace}): do not play a high line.`);
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
  // ---- the match-up: what each plan asks of the two squads, read from the numbers both sides can see.
  // The part-time analyst ranks plans on this alone; the others play the match through, and this
  // explains in plain words why their pick makes sense.
  const L = Object.fromEntries(lines.map((x) => [x.line, x])) as Record<string, { mine: number; theirs: number }>;
  const avg = (k: 'mine' | 'theirs') => (L.DEF[k] + L.MID[k] + L.FWD[k]) / 3;
  const edge = avg('mine') - avg('theirs');
  const air = myFwdAir - st.defAir, run = myFwdPace - st.defPace, threat = st.fwdPace - myDefPace, mid = L.MID.mine - L.MID.theirs;
  const matchup = (plan: string) => {
    const t = PRESETS[plan];
    const why: { text: string; v: number }[] = [];
    const add = (v: number, text: string) => { if (v) why.push({ v, text }); };
    if (threat >= 3) add(t.line === 0 ? Math.min(0.08, threat * 0.012) : t.line === 2 ? -Math.min(0.09, threat * 0.014) : 0, `Their forwards are quick (pace ${st.fwdPace} vs your defenders' ${myDefPace}): a deep line takes away the space behind you.`);
    if (run >= 3) add(t.focus === 1 ? Math.min(0.09, run * 0.009) : 0, `Your forwards are quicker than their defenders (pace ${myFwdPace} vs ${st.defPace}): balls in behind will hurt them.`);
    if (air >= 3) add(t.focus === 0 ? Math.min(0.08, air * 0.009) : 0, `You are stronger in the air (${myFwdAir} vs ${st.defAir}): crosses suit you.`);
    if (air <= -4) add(t.focus === 0 ? -0.04 : 0, `They win the headers (${st.defAir} vs your forwards' ${myFwdAir}): crossing is a waste.`);
    if (st.keeper <= 72) add(t.focus === 3 ? 0.04 : 0, `Their keeper is shaky (${st.keeper}): shots from distance are worth it.`);
    if (mid >= 2) add(t.build === 0 ? Math.min(0.06, mid * 0.008) : 0, `Your midfield is better (${L.MID.mine} vs ${L.MID.theirs}): you can keep the ball.`);
    if (mid <= -2) add(t.build === 0 ? -0.04 : t.build === 2 ? 0.03 : 0, `Their midfield is better (${L.MID.theirs} vs ${L.MID.mine}): skip it and go direct.`);
    if (edge <= -2) add(t.mentality === 0 ? 0.04 : t.mentality === 2 ? -0.04 : 0, `They are stronger on paper: sitting deep keeps it tight.`);
    if (edge >= 2) add(t.mentality >= 1 && t.press >= 2 ? 0.035 : t.mentality === 0 ? -0.03 : 0, `You are stronger on paper: take the game to them.`);
    const fitScore = tacticFit(fitXi as any, stripDesc(PRESETS[plan])).score;
    const score = why.reduce((a, x) => a + x.v, 0) + (fitScore - 50) * 0.0016;
    return { score, fit: fitScore, why: why.filter((x) => x.v > 0).sort((a, b) => b.v - a.v).map((x) => x.text), against: why.filter((x) => x.v < 0).map((x) => x.text) };
  };
  const mu = Object.fromEntries(PLANS.map((p) => [p, matchup(p)]));
  void r;
  const results = PLANS.map((plan) => {
    let w = 0, d = 0, lo = 0;
    if (level === 1) {
      // no simulations: it reads the two squads and does not know their plan, so it can be wrong
      return { plan, score: mu[plan].score, win: null as number | null, draw: null as number | null, loss: null as number | null };
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
    // a handful of simulated matches can come out 100-0-0; nothing in football is that sure, so the
    // numbers lean a little towards an ordinary match (as if 8 more had ended 35/30/35)
    const n = top.length * sims, k = 8;
    const sm = (x: number, prior: number) => (x * n + prior * k) / (n + k);
    w = sm(w, 0.35); d = sm(d, 0.3); lo = sm(lo, 0.35);
    return { plan, score: 3 * w + d, win: pct(w), draw: pct(d), loss: pct(lo) };
  }).sort((a, b) => b.score - a.score);

  const best = results[0], second = results[1], worst = results[results.length - 1];
  // tackling and the offside trap
  const styleTips: string[] = [];
  const myTrap = lineAvg(me, 'DEF', ['Positioning', 'Decisions', 'Marking']), theirRuns = lineAvg(them, 'FWD', ['Positioning', 'Decisions', 'Pace']);
  const runners = level >= 2 && likely[0] && ['Gegenpress', 'Counter attack'].includes(likely[0].plan);
  if (cond.referee.strict === 2) styleTips.push(`🙂 Strict referee (${cond.referee.name}): tackle with care, cards will fly.`);
  else if (level >= 2 && likely[0]?.plan === 'Tiki-taka') styleTips.push('😠 They pass short: getting stuck in can break up their play (watch the cards).');
  if (myTrap - theirRuns >= 3) styleTips.push(`🚩 Your defenders read the game better than their forwards (${myTrap} vs ${theirRuns})${runners ? ', and they like to run in behind' : ''}: an offside trap could catch them.`);
  else if (theirRuns - myTrap >= 3) styleTips.push(`🚩 Their forwards time their runs well (${theirRuns} vs your back line's ${myTrap}): an offside trap is risky.`);
  // their roles (from level 2): what their key men will do, and how to deal with it
  const COUNTER_TIP: Record<string, string> = {
    'Target man': 'a Stopper at centre-back wins his headers', 'Line breaker': 'a Sweeper behind the line stops his runs', Poacher: 'a Marker in midfield cuts his service',
    Playmaker: 'a Marker can follow him', Regista: 'press high: he gets caught on the ball', 'Wide winger': 'a Flank cover or a Stopper full-back on that side',
    Overlap: 'a winger who stays high pins him back', 'Wing back': 'attack the space behind him', 'False 9': 'an Anchor in front of the defence picks him up',
    'Long shooter': 'a Sweeper keeper is riskier against him', 'Inside winger': 'an Inverted full-back closes the middle',
  };
  const roleList = level >= 2 ? Object.entries(them.roles || {}).map(([id, r]) => {
    const p = them.xi.find((x) => x.id === id); const rn = roleName(r);
    return p && rn ? { name: p.name, role: rn, tip: COUNTER_TIP[rn] || null } : null;
  }).filter(Boolean).slice(0, 6) : [];
  const gap = best.score - second.score;
  // how sure the analyst is of the result: a clear favourite is sure whichever top plan you pick
  const fav = best.win ?? 0;
  const confidence = level === 1 ? (gap > 0.05 ? 'Medium' : 'Low')
    : fav >= 65 || gap > (level === 2 ? 0.15 : 0.12) ? (level === 3 ? 'High' : 'Medium')
    : level === 3 ? 'Medium' : 'Low';
  // why the pick makes sense, in two lines, and how well your players suit it
  const pickWhy = mu[best.plan].why.slice(0, 2);
  if (!pickWhy.length) pickWhy.push(level === 1 ? 'Nothing stands out between the two squads: it suits your players best.' : 'It came out on top when your analyst played the match through.');
  const fitNow = mu[best.plan].fit;
  const fitLine = fitNow >= 60 ? `Your players suit it well (${fitNow}%).` : fitNow >= 45 ? `Your players suit it about as well as any plan (${fitNow}%).` : `Your players are a little below par for it (${fitNow}%), but the match-up matters more.`;
  const main = likely[0]?.plan;
  const chase = level >= 2 && main ? PLANS.filter((p) => p !== main).sort((a, b) => counterShare(b, main) - counterShare(a, main))[0] : null;
  const report = {
    fixture: { id: f.id, day: f.day, home: home.name, away: away.name, comp: f.comp, kickoff: f.kickoff_at },
    opponent: { id: opp.id, name: opp.name, human: !!opp.user_id, pos: row ? table.indexOf(row) + 1 : null, form: row?.form || [], pts: row?.pts ?? 0 },
    lines, weak: weak.slice(0, 3), danger: danger.slice(0, 2),
    likely: level === 1 ? [] : likely.slice(0, 3).map((x) => ({ plan: x.plan, p: pct(x.p) })), likelyNote,
    plans: (level === 1 ? results.slice(0, 3) : results).map((x) => ({ plan: x.plan, win: x.win, draw: x.draw, loss: x.loss })),
    best: best.plan, avoid: worst.plan, confidence, why: pickWhy, fitLine, closeCall: gap < (level === 1 ? 0.02 : 0.08) ? second.plan : null,
    tip: chase ? `If you need a goal late on, switch to ${chase}: it is the best answer to ${main}.` : null,
    style: styleTips, roles: roleList,
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
