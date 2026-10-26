// The season clock: schedule, AI clubs, live matches, finishing matches, cup draws,
// the matchday paper, Team of the Week and Player of the Month.
//
// A fixture goes: scheduled -> (kick-off time) live for LIVE_SECONDS -> done.
// While live, both managers can change tactics or make subs; the match is re-simulated from that
// minute with the same seed, so everything before the change stays exactly the same.
import { batch, counter, q, one, writes, type Row } from './db.ts';
import { fail } from './errors.ts';
import {
  AI_COLORS, AI_NAMES_BY_POOL, FORMATIONS, colorDist, conditionsFor, stripDesc, traitOf, CLUB_TYPES, CUP_NAMES, DEFAULT_TACTIC, LINE, LIVE_SECONDS, PAPER_NAMES, PRESETS, SPONSORS,
  shortName, type ClubTypeKey, type SponsorKey, type Tactic,
  windowFromDays, WINDOW_DAYS,
} from './game.ts';
import { aiPlan, aiTactic, counterShare, nearestPreset, simulate, type Change, type EPlayer, type ESide, type Report } from './engine.ts';
import { hashSeed, rng } from './rng.ts';
import { AI_SQUAD, botListings, checkSquads, cleanTactic, getLeague, myClub, news, pickXI, squadOf, standings } from './league.ts';
import { staffLevels } from './club.ts';
import { moraleAfterMatch, randomEvents } from './people.ts';
import { endSeason, startNextSeason } from './career.ts';
import { botBids, botShopping } from './offers.ts';
import { notify, notifyMany } from './push.ts';

export const PER_REQUEST = Number(process.env.MATCHES_PER_REQUEST || 0) || 1000;
const LIVE_MS = LIVE_SECONDS * 1000;
const LIVE_GRACE_MS = 15_000;

// ---------------------------------------------------------------- season start
export async function startSeason(uid: number, leagueId: number) {
  const l = await getLeague(leagueId);
  if (l.owner_id !== uid) fail(403, 'Only the league creator can start it.');
  if (l.status !== 'setup') fail(400, 'Already started.');
  const humans = await checkSquads(leagueId);
  const claim = await q(`UPDATE leagues SET status='starting' WHERE id=$1 AND status='setup' RETURNING id`, [leagueId]);
  if (!claim[0]) fail(400, 'Already starting.');
  try {
    await fillWithBots(l, humans);
    await makeSchedule(l);
    await botShopping(l, 0); // AI clubs may snap up players managers listed in pre-season
  } catch (e) {
    // undo a half-made season so the creator can simply try again
    await batch(['fixtures', 'days', 'papers'].map((t) => ({ text: `DELETE FROM ${t} WHERE league_id=$1`, params: [leagueId] })).concat([
      { text: `DELETE FROM squad WHERE league_id=$1 AND club_id IN (SELECT id FROM clubs WHERE league_id=$1 AND user_id IS NULL)`, params: [leagueId] },
      { text: `DELETE FROM clubs WHERE league_id=$1 AND user_id IS NULL`, params: [leagueId] },
      { text: `UPDATE leagues SET status='setup' WHERE id=$1`, params: [leagueId] },
    ]));
    throw e;
  }
  await q(`UPDATE leagues SET status='running' WHERE id=$1`, [leagueId]);
  await news(leagueId, null, 'season', `The season kicks off! ${l.max_clubs} clubs, home and away, plus ${CUP_NAMES[l.pool]}.`);
  await batch([
    { text: `INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,NULL,'round',$2)`, params: [leagueId, '🏁 The first round has started! Every team plays every other team once.'] },
    { text: `INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,NULL,'window',$2)`, params: [leagueId, `🔓 The transfer window stays OPEN for the first ${WINDOW_DAYS} days of the round, then it shuts.`] },
  ]);
  return { ok: true };
}

// Bots build their squads the way a manager does with packs: a few stars, a solid core and depth,
// drawn from the same percentile bands of the pool. Harder bots get a little more quality.
async function fillWithBots(l: Row, humanCount: number) {
  const D = l.divisions || 1;
  const humanDiv = l.start_division === 'top' ? 1 : D;
  await q('UPDATE clubs SET division=$2 WHERE league_id=$1 AND user_id IS NOT NULL', [l.id, humanDiv]);
  const need = l.max_clubs * D - humanCount;
  if (need <= 0) return;
  // which division each bot plays in: top flight first, so stronger bots draft first
  const botDiv: number[] = [];
  for (let d = 1; d <= D; d++) for (let k = 0; k < l.max_clubs - (d === humanDiv ? humanCount : 0); k++) botDiv.push(d);
  const all = await q(`SELECT p.id, p.pos, p.ovr, EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id) AS taken FROM players p WHERE pool=$1 ORDER BY ovr DESC, id`, [l.pool, l.id]);
  const r = rng(hashSeed('bots', l.id));
  const n = all.length;
  const bandOf = (i: number) => (i < n * 0.035 ? 'L' : i < n * 0.28 ? 'G' : i < n * 0.6 ? 'S' : 'B');
  const free: Record<string, Record<string, Row[]>> = {};
  all.forEach((p, i) => {
    if (p.taken) return;
    const line = LINE[p.pos] || 'MID', band = bandOf(i);
    ((free[line] ||= {})[band] ||= []).push(p);
  });
  const plan: Record<number, string[]> = {
    0: ['G', 'G', 'G', 'G', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'B', 'B', 'B', 'B', 'B', 'B', 'B'],
    1: ['L', 'G', 'G', 'G', 'G', 'G', 'S', 'S', 'S', 'S', 'S', 'S', 'B', 'B', 'B', 'B', 'B', 'B'],
    2: ['L', 'G', 'G', 'G', 'G', 'G', 'G', 'G', 'S', 'S', 'S', 'S', 'S', 'S', 'B', 'B', 'B', 'B'],
  };
  const lines = ['GK', 'GK', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD', 'FWD'];
  const taken = new Set((await q('SELECT lower(name) AS n FROM clubs WHERE league_id=$1', [l.id])).map((x) => x.n));
  const names = [...(AI_NAMES_BY_POOL[l.pool] || AI_NAMES_BY_POOL.EGY)].sort(() => r.next() - 0.5).filter((n) => !taken.has(n.toLowerCase()));
  const bots = Array.from({ length: need }, (_, i) => {
    const name = names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : '');
    const type = (['fan', 'invest', 'academy', 'commercial', 'historic'] as ClubTypeKey[])[i % 5];
    const color = AI_COLORS[i % AI_COLORS.length];
    return {
      name, short: shortName(name), color1: color, color2: botTrim(color, i), shape: i % 4, emblem: i % 6, stadium: `${name.split(' ').slice(-1)[0]} Stadium`,
      club_type: type, money: CLUB_TYPES[type].money, tactic: aiTactic(0, [], hashSeed(l.id, i)),
      fans: (18000 + Math.floor(r.next() * 14000)) >> (botDiv[i] - 1), division: botDiv[i], pattern: i % 3 === 0 ? 1 : 0,
    };
  });
  // all bot clubs in one request
  const made = await q(
    `INSERT INTO clubs (league_id, user_id, name, short, color1, color2, shape, emblem, stadium, club_type, coins, money, tactic, fans, division, away1, away2, pattern)
     SELECT $1, NULL, x.name, x.short, x.color1, x.color2, x.shape, x.emblem, x.stadium, x.club_type, 0, x.money, x.tactic, x.fans, x.division, '#F3EEFF', '#151018', x.pattern
       FROM jsonb_to_recordset($2::jsonb) AS x(name text, short text, color1 text, color2 text, shape int, emblem int, stadium text, club_type text, money numeric, tactic jsonb, fans int, division int, pattern int)
     RETURNING id, name`,
    [l.id, JSON.stringify(bots)],
  );
  const idOf = new Map(made.map((c) => [c.name, c.id]));
  const botIds: number[] = bots.map((b) => idOf.get(b.name));
  const rows: [string, number][] = [];
  const order = ['L', 'G', 'S', 'B'];
  const take = (line: string, band: string) => {
    // the wanted band first, then the nearest bands, then any line
    const tries = [band, ...order.filter((b) => b !== band).sort((x, y) => Math.abs(order.indexOf(x) - order.indexOf(band)) - Math.abs(order.indexOf(y) - order.indexOf(band)))];
    for (const b of tries) {
      const list = free[line]?.[b];
      if (list?.length) return list.splice(Math.floor(r.next() * list.length), 1)[0];
    }
    for (const ln of ['MID', 'DEF', 'FWD']) for (const b of tries) { const list = free[ln]?.[b]; if (list?.length && line !== 'GK') return list.splice(Math.floor(r.next() * list.length), 1)[0]; }
    return null;
  };
  // each bot shuffles its bands over its 18 places; places are filled in rounds so bots stay even
  const shuffled = botIds.map((_, bi) => {
    // lower divisions draft one band lower per step down
    const shift = botDiv[bi] - 1;
    const bands = [...plan[l.ai_level] || plan[2]].map((b) => order[Math.min(3, order.indexOf(b) + shift)]).sort(() => r.next() - 0.5);
    // a keeper never gets the single star pick
    const li = bands.indexOf('L');
    if (li >= 0 && li < 2) { const j = 2 + Math.floor(r.next() * 16); [bands[li], bands[j]] = [bands[j], bands[li]]; }
    return bands;
  });
  for (let slot = 0; slot < lines.length; slot++) {
    botIds.forEach((id, bi) => {
      const p = take(lines[slot], shuffled[bi][slot]);
      if (p) rows.push([p.id, id]);
    });
  }
  void AI_SQUAD;
  if (rows.length) await q(`INSERT INTO squad (league_id, player_id, club_id) SELECT $1, x->>0, (x->>1)::int FROM jsonb_array_elements($2::jsonb) AS x ON CONFLICT DO NOTHING`, [l.id, JSON.stringify(rows)]);
}

// A second colour for an AI club that stands out against its main colour.
function botTrim(c1: string, i: number) {
  const opts = ['#F3EEFF', '#151018', '#F2C14E', '#7FE9F7', '#F3EEFF'];
  for (let k = 0; k < opts.length; k++) { const c = opts[(i + k) % opts.length]; if (colorDist(c, c1) > 150) return c; }
  return '#F3EEFF';
}

// First kick-off: the next time the clock shows the league's match time, at least 30 minutes away.
export function firstKick(kickUtcMin: number, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, kickUtcMin));
  if (d.getTime() <= from.getTime() + 30 * 60_000) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const roundName = (teams: number, prelim: boolean) =>
  prelim ? 'Preliminary round' : teams === 2 ? 'Final' : teams === 4 ? 'Semi-final' : teams === 8 ? 'Quarter-final' : `Round of ${teams}`;

// One match day per calendar day: league matchdays, a free day at the halfway break (transfer window),
// and cup rounds spread through the season.
async function makeSchedule(l: Row) {
  const all = await q('SELECT id, division FROM clubs WHERE league_id=$1 ORDER BY id', [l.id]);
  const clubs = all.map((c) => c.id as number);
  const r = rng(hashSeed('fixtures', l.id, l.season || 1));
  // a double round robin per division; every division has the same number of clubs
  const roundRobin = (members: number[]) => {
    const ids: (number | null)[] = [...members].sort(() => r.next() - 0.5);
    if (ids.length % 2) ids.push(null);
    const n = ids.length;
    const rounds: [number, number][][] = [];
    for (let rd = 0; rd < n - 1; rd++) {
      const games: [number, number][] = [];
      for (let i = 0; i < n / 2; i++) {
        const a = ids[i], b = ids[n - 1 - i];
        if (a != null && b != null) games.push(rd % 2 === 0 ? [a, b] : [b, a]);
      }
      rounds.push(games);
      ids.splice(1, 0, ids.pop()!);
    }
    return [...rounds, ...rounds.map((g) => g.map(([a, b]) => [b, a] as [number, number]))];
  };
  const divs = [...new Set(all.map((c) => c.division as number))].sort();
  const perDiv = divs.map((d) => ({ d, rounds: roundRobin(all.filter((c) => c.division === d).map((c) => c.id)) }));
  const league = perDiv[0].rounds.map((_, i) => perDiv.flatMap((x) => (x.rounds[i] || []).map(([h, a]) => [h, a, x.d] as [number, number, number])));
  const L = league.length, half = L / 2;

  // cup rounds
  const N = clubs.length;
  const P = 2 ** Math.floor(Math.log2(N));
  const cupRounds: { name: string; teams: number }[] = [];
  if (N > P) cupRounds.push({ name: roundName(2 * (N - P), true), teams: 2 * (N - P) });
  for (let t = P; t >= 2; t /= 2) cupRounds.push({ name: roundName(t, false), teams: t });
  const R = cupRounds.length;
  const cupAfter = cupRounds.map((_, i) => {
    let md = Math.max(1, Math.round(((i + 1) * L) / (R + 1)));
    if (md === half) md += 1;
    return Math.min(L - 1, md);
  });
  for (let i = 1; i < R; i++) if (cupAfter[i] <= cupAfter[i - 1]) cupAfter[i] = Math.min(L - 1, cupAfter[i - 1] + 1);

  const plan: { kind: string; md?: number; round?: number }[] = [];
  for (let md = 1; md <= L; md++) {
    plan.push({ kind: 'league', md });
    if (md === half) plan.push({ kind: 'break' });
    cupAfter.forEach((after, i) => { if (after === md) plan.push({ kind: 'cup', round: i + 1 }); });
  }
  const start = firstKick(l.kickoff_utc_min);
  const dayRows = plan.map((p, i) => ({ day: i + 1, kind: p.kind, md: p.md ?? null, round: p.round ?? null, at: new Date(start.getTime() + i * 86_400_000).toISOString() }));
  await q(
    `INSERT INTO days (league_id, day, kind, matchday, round, kickoff_at)
     SELECT $1, x.day, x.kind, x.md, x.round, x.at::timestamptz FROM jsonb_to_recordset($2::jsonb) AS x(day int, kind text, md int, round int, at text)
     ON CONFLICT DO NOTHING`,
    [l.id, JSON.stringify(dayRows)],
  );
  const fx = league.flatMap((games, i) => {
    const d = dayRows.find((x) => x.kind === 'league' && x.md === i + 1)!;
    return games.map(([h, a, dv]) => ({ md: i + 1, h, a, dv, day: d.day, at: d.at }));
  });
  await q(
    `INSERT INTO fixtures (league_id, matchday, home_id, away_id, kickoff_at, day, comp, division)
     SELECT $1, x.md, x.h, x.a, x.at::timestamptz, x.day, 'league', x.dv FROM jsonb_to_recordset($2::jsonb) AS x(md int, h int, a int, day int, at text, dv int)`,
    [l.id, JSON.stringify(fx)],
  );
  await q(
    `INSERT INTO papers (league_id, day, kind, data) VALUES ($1, 0, 'cup', $2::jsonb) ON CONFLICT (league_id, day, kind) DO UPDATE SET data=EXCLUDED.data`,
    [l.id, JSON.stringify({ name: CUP_NAMES[l.pool] || 'The Cup', rounds: cupRounds.map((c, i) => ({ ...c, day: dayRows.find((x) => x.kind === 'cup' && x.round === i + 1)!.day, pairs: [], byes: [], drawn: false })) })],
  );
  await drawCup(l, 1);
}

// ---------------------------------------------------------------- cup
export async function cupState(leagueId: number) {
  const r = await one(`SELECT data FROM papers WHERE league_id=$1 AND day=0 AND kind='cup'`, [leagueId]);
  return r?.data as { name: string; rounds: { name: string; teams: number; day: number; pairs: [number, number][]; byes: number[]; drawn: boolean; drawnAt?: string }[]; winner?: number } | undefined;
}

async function drawCup(l: Row, round: number) {
  const cup = await cupState(l.id);
  if (!cup || !cup.rounds[round - 1] || cup.rounds[round - 1].drawn) return;
  const rd = cup.rounds[round - 1];
  let entrants: number[];
  if (round === 1) {
    entrants = (await q('SELECT id FROM clubs WHERE league_id=$1', [l.id])).map((c) => c.id);
  } else {
    const prev = cup.rounds[round - 2];
    const winners = (await q(`SELECT winner_id FROM fixtures WHERE league_id=$1 AND comp='cup' AND round=$2 AND status='done'`, [l.id, round - 1])).map((x) => x.winner_id);
    entrants = [...winners, ...prev.byes];
  }
  const r = rng(hashSeed('cup', l.id, round));
  const pot = [...entrants].sort(() => r.next() - 0.5);
  const playing = pot.slice(0, rd.teams);
  rd.byes = pot.slice(rd.teams);
  rd.pairs = [];
  for (let i = 0; i + 1 < playing.length; i += 2) rd.pairs.push([playing[i], playing[i + 1]]);
  rd.drawn = true;
  rd.drawnAt = new Date().toISOString();
  const day = (await one('SELECT * FROM days WHERE league_id=$1 AND day=$2', [l.id, rd.day]))!;
  await q(
    `INSERT INTO fixtures (league_id, matchday, home_id, away_id, kickoff_at, day, comp, round)
     SELECT $1, 0, x.h, x.a, $2::timestamptz, $3, 'cup', $4 FROM jsonb_to_recordset($5::jsonb) AS x(h int, a int)`,
    [l.id, day.kickoff_at, rd.day, round, JSON.stringify(rd.pairs.map(([h, a]) => ({ h, a })))],
  );
  await q(`UPDATE papers SET data=$2::jsonb WHERE league_id=$1 AND day=0 AND kind='cup'`, [l.id, JSON.stringify(cup)]);
  await news(l.id, null, 'cup', `${cup.name}: the ${rd.name} draw is out!`);
}

// ---------------------------------------------------------------- the runner
// Called by page loads and the 1-minute timer. Finishes live matches whose time is up,
// kicks off due matches and processes finished days. Each unit of work counts toward `max`.
export async function runDue(leagueId?: number, opts: { max?: number; prefer?: number; light?: boolean } = {}) {
  const max = opts.max ?? PER_REQUEST;
  let work = 0;
  const t0 = Date.now();
  const lf = leagueId ? ' AND league_id=$1' : '';
  const lp = leagueId ? [leagueId] : [];
  await q(`UPDATE fixtures SET status='scheduled' WHERE status='playing' AND claimed_at < now() - interval '2 minutes'${lf}`, lp);
  await q(`UPDATE fixtures SET status='live' WHERE status='finalizing' AND claimed_at < now() - interval '2 minutes'${lf}`, lp);
  while (work < max && Date.now() - t0 < 40_000) {
    // 1) a live match whose time is up
    const fin = await one(
      `UPDATE fixtures SET status='finalizing', claimed_at=now() WHERE id = (
         SELECT id FROM fixtures WHERE status='live' AND live_until <= now()${lf} ORDER BY live_until, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
      lp,
    );
    if (fin) {
      const c0 = counter.n;
      try { await finalizeFixture(fin); if (counter.n - c0 > 25) console.warn(`[queries] finish match ${fin.id}: ${counter.n - c0}`); } catch (e) {
        console.error('finalize failed', fin.id, e);
        await q(`UPDATE fixtures SET status='live' WHERE id=$1 AND status='finalizing'`, [fin.id]);
        break;
      }
      work++;
      continue;
    }
    // 2) a match whose kick-off time has come
    const params: unknown[] = [...lp];
    let order = 'kickoff_at, id';
    if (opts.prefer) { params.push(opts.prefer); order = `(id=$${params.length}) DESC, kickoff_at, id`; }
    const f = await one(
      `UPDATE fixtures SET status='playing', claimed_at=now() WHERE id = (
         SELECT id FROM fixtures WHERE status='scheduled' AND kickoff_at <= now()${lf} ORDER BY ${order} LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
      params,
    );
    if (f) {
      const c0 = counter.n;
      try { await kickOff(f); if (counter.n - c0 > 25) console.warn(`[queries] kick-off ${f.id}: ${counter.n - c0}`); } catch (e) {
        console.error('kick-off failed', f.id, e);
        await q(`UPDATE fixtures SET status='scheduled' WHERE id=$1 AND status='playing'`, [f.id]);
        break;
      }
      work++;
      continue;
    }
    // 3) a finished day (paper, Team of the Week, cup draw, window, season end): heavy, so only the timer does it
    if (opts.light) break;
    const d = await one(
      `UPDATE days d SET processed=true WHERE (d.league_id, d.day) = (
         SELECT x.league_id, x.day FROM days x WHERE x.processed=false AND x.kickoff_at <= now()${leagueId ? ' AND x.league_id=$1' : ''}
           AND NOT EXISTS (SELECT 1 FROM fixtures f WHERE f.league_id=x.league_id AND f.day=x.day AND f.status<>'done')
           AND NOT EXISTS (SELECT 1 FROM days y WHERE y.league_id=x.league_id AND y.day<x.day AND y.processed=false)
         ORDER BY x.kickoff_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
      lp,
    );
    if (d) {
      const c0 = counter.n;
      try { await processDay(d); if (counter.n - c0 > 25) console.warn(`[queries] day ${d.day} (${d.kind}${d.matchday ? ' md' + d.matchday : ''}): ${counter.n - c0}`); } catch (e) {
        console.error('day failed', d.league_id, d.day, e);
        await q(`UPDATE days SET processed=false WHERE league_id=$1 AND day=$2`, [d.league_id, d.day]);
        break;
      }
      work++;
      continue;
    }
    break;
  }
  const rest = await one<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM fixtures WHERE ((status='scheduled' AND kickoff_at <= now()) OR (status='live' AND live_until <= now()))${lf})::int
          + ${opts.light ? '0' : `(SELECT COUNT(*) FROM days x WHERE x.processed=false AND x.kickoff_at <= now()${leagueId ? ' AND x.league_id=$1' : ''}
               AND NOT EXISTS (SELECT 1 FROM fixtures f WHERE f.league_id=x.league_id AND f.day=x.day AND f.status<>'done'))::int`} AS n`,
    lp,
  );
  return { played: work, remaining: rest?.n ?? 0 };
}

async function lastDayPlayed(clubId: number, beforeDay: number) {
  const r = await one<{ d: number }>(
    `SELECT MAX(day)::int AS d FROM fixtures WHERE (home_id=$1 OR away_id=$1) AND day < $2 AND status IN ('done','live','finalizing')`,
    [clubId, beforeDay],
  );
  return r?.d ?? null;
}

async function sideFor(club: Row, l: Row, f: Row, opp: Row, home: boolean, tone: string | null): Promise<ESide> {
  const day = f.day as number;
  const players = await squadOf(club.id, day);
  const lv = await staffLevels(club.id);
  // recovery since this club's last match: about 22% a day, more with a good physio
  const prev = await lastDayPlayed(club.id, day);
  const gap = prev == null ? 3 : Math.max(1, day - prev);
  for (const p of players) p.fitness = Math.min(100, (p.fitness ?? 100) + gap * (25 + lv.physio * 3));
  let tactic: Tactic = club.tactic && club.tactic.formation ? club.tactic : DEFAULT_TACTIC;
  if (!club.user_id) {
    // the bot's real plan is chosen at kick-off, once both line-ups are known (planBot)
    const forms = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '5-3-2'];
    tactic = { ...DEFAULT_TACTIC, formation: forms[club.id % forms.length] };
  }
  const { xi, bench } = pickXI(players, tactic.formation, club.user_id ? club.lineup || [] : [], day);
  const toneMod = tone === 'provocative' ? 2 : tone === 'confident' ? 1 : 0;
  const bigGame = f.comp === 'cup' || (home ? isDerby(club, opp) : isDerby(opp, club));
  const toE = (p: Row): EPlayer => ({
    id: p.id, name: p.name, pos: p.pos, ovr: p.ovr, fitness: Math.round(p.fitness), a: p.attrs,
    mod: Math.round(((p.mod || 0) + toneMod + (bigGame && traitOf(p.id) === 'Big-game player' ? 2 : 0)) * 10) / 10,
  });
  const pens = (club.pens || []).filter((id: string) => xi.some((p) => p.id === id));
  let boost = 0;
  if (!club.user_id) {
    const h = await one<{ a: number }>(
      `SELECT AVG(o)::float AS a FROM (SELECT p.ovr AS o, ROW_NUMBER() OVER (PARTITION BY s.club_id ORDER BY p.ovr DESC) AS rn
         FROM squad s JOIN players p ON p.id=s.player_id JOIN clubs c ON c.id=s.club_id WHERE c.league_id=$1 AND c.user_id IS NOT NULL) x WHERE rn<=11`,
      [l.id],
    );
    const mine = xi.reduce((a, p) => a + p.ovr, 0) / Math.max(1, xi.length);
    boost = Math.max(0, (h?.a ?? mine) - mine) * [0.1, 0.45, 0.75][l.ai_level];
  }
  return {
    clubId: club.id, name: club.name, xi: xi.map(toE), bench: bench.map(toE), tactic, boost,
    assistant: club.user_id ? club.assistant : { tired: true, cards: true, winning: true, losing: true },
    pens: pens.length ? pens : xi.filter((p) => p.pos !== 'GK').sort((a, b) => (b.attrs.Finishing + b.attrs.Composure) - (a.attrs.Finishing + a.attrs.Composure)).slice(0, 5).map((p) => p.id),
    homeBoost: home ? (club.club_type === 'fan' ? 1 : 0) + Math.min(1, (club.fans || 20000) / 40000) : 0,
    injuryRisk: 1 - lv.doctor * 0.08,
    ...(club.user_id ? humanRoles(club, xi, tactic.formation) : autoRoles(xi, tactic.formation)),
  };
}

// How well a club knows a formation: 50 for a new shape, up to 100 after many matches in it.
export function familiarityOf(club: Row, formation: string) {
  return Math.max(30, Math.min(100, (club.familiarity || {})[formation] ?? 50));
}

// A manager's own roles and set-piece takers; the assistant fills in anything left unset.
function humanRoles(club: Row, xi: Row[], formation: string) {
  const auto = autoRoles(xi, formation);
  const sp = club.setpieces || {};
  return {
    roles: { ...auto.roles, ...(club.roles || {}) },
    setpieces: { corner: sp.corner || auto.setpieces.corner, fk: sp.fk || auto.setpieces.fk, routine: sp.routine || 'far' },
    familiarity: familiarityOf(club, formation),
  };
}

// Bots pick sensible roles and set-piece takers for their line-up, and know their shape well.
function autoRoles(xi: Row[], formation: string) {
  const slots = (FORMATIONS[formation] || FORMATIONS['4-3-3']).slots;
  const roles: Record<string, string> = {};
  xi.forEach((p, i) => {
    const slot = slots[i], a = p.attrs || {};
    if (slot === 'GK') roles[p.id] = (a.Distribution ?? 0) > (a.Reflexes ?? 0) ? 'Sweeper keeper' : 'Shot stopper';
    else if (slot === 'DEF') roles[p.id] = ['LB', 'RB'].includes(p.pos) ? 'Wing-back' : (a.Passing ?? 0) > (a.Tackling ?? 0) ? 'Ball-playing' : 'Stopper';
    else if (slot === 'MID') roles[p.id] = p.pos === 'DM' ? 'Anchor' : p.pos === 'CAM' || (a.Vision ?? 0) > 78 ? 'Playmaker' : 'Box-to-box';
    else roles[p.id] = p.pos === 'ST' ? ((a.Heading ?? 0) > (a.Finishing ?? 0) ? 'Target man' : 'Poacher') : 'Inside forward';
  });
  const outfield = xi.filter((p) => p.pos !== 'GK');
  const best = (k: string) => [...outfield].sort((x, y) => (y.attrs?.[k] ?? 0) - (x.attrs?.[k] ?? 0))[0]?.id;
  return { roles, setpieces: { corner: best('Crossing'), fk: best('LongShots'), routine: 'far' }, familiarity: 62 };
}

const isDerby = (h: Row, a: Row) => h.club_type === 'fan' && a.club_type === 'fan' && !!h.user_id && !!a.user_id;

async function kickOff(f: Row) {
  const l = await getLeague(f.league_id);
  const home = await one('SELECT * FROM clubs WHERE id=$1', [f.home_id]);
  const away = await one('SELECT * FROM clubs WHERE id=$1', [f.away_id]);
  if (!home || !away) throw new Error('club missing');
  const tones = await q('SELECT club_id, tone FROM comments WHERE league_id=$1 AND day=$2 AND club_id IN ($3,$4)', [l.id, f.day, home.id, away.id]);
  const toneOf = (id: number) => tones.find((t) => t.club_id === id)?.tone ?? null;
  const derby = isDerby(home, away);
  // mind games: pre-match words count whenever two managers meet, not only in derbies
  const rivals = derby || (!!home.user_id && !!away.user_id);
  const hs = await sideFor(home, l, f, away, true, rivals ? toneOf(home.id) : null);
  const as = await sideFor(away, l, f, home, false, rivals ? toneOf(away.id) : null);
  if (!home.user_id) hs.tactic = await planBot(l, f, hs, as, away.id);
  if (!away.user_id) as.tactic = await planBot(l, f, as, hs, home.id);
  const cond = conditionsFor(f.id, l.pool, f.day);
  const rep = simulate(hs, as, hashSeed(f.id, f.league_id), { knockout: f.comp === 'cup', derby, weather: cond.weather, strict: cond.referee.strict });
  for (const c of [home, away]) {
    if (c.user_id) await notify(c.user_id, { title: derby ? '🔥 Derby kick-off!' : '⚽ Kick-off!', body: `${home.name} vs ${away.name} is live. Watch it and change your tactics, or let your assistant handle it.`, url: `/m/${f.id}`, tag: `kick-${f.id}` });
  }
  await q(
    `UPDATE fixtures SET status='live', sides=$2::jsonb, report=$3::jsonb, changes='[]'::jsonb,
       live_from=now(), live_until=now() + make_interval(secs => $4) WHERE id=$1 AND status='playing'`,
    [f.id, JSON.stringify([hs, as]), JSON.stringify(rep), (LIVE_MS + LIVE_GRACE_MS) / 1000],
  );
}

// What the other club has played in its last matches, most recent first (custom plans read as the nearest preset).
async function recentPlans(leagueId: number, clubId: number) {
  const rows = await q(
    `SELECT CASE WHEN home_id=$2 THEN sides->0->'tactic' ELSE sides->1->'tactic' END AS t FROM fixtures
     WHERE league_id=$1 AND status='done' AND (home_id=$2 OR away_id=$2) AND sides IS NOT NULL ORDER BY day DESC LIMIT 4`,
    [leagueId, clubId],
  );
  return rows.map((x) => (x.t ? (x.t.preset && x.t.preset !== 'Custom' && PRESETS[x.t.preset] ? x.t.preset : nearestPreset(x.t)) : null)).filter(Boolean) as string[];
}

// The AI manager picks its plan for this match: beat what you have been playing, suit its own players,
// and go after your weak spots (see aiPlan).
async function planBot(l: Row, f: Row, me: ESide, opp: ESide, oppClubId: number) {
  return aiPlan({ level: l.ai_level, oppHistory: await recentPlans(l.id, oppClubId), own: me.xi, opp: opp.xi, seed: hashSeed(l.id, f.day, me.clubId), formation: me.tactic.formation });
}

// Minute of a live match right now (0..90), from when it went live.
export function liveMinute(f: Row, now = Date.now()) {
  if (!f.live_from) return 0;
  return Math.max(0, Math.min(90, ((now - new Date(f.live_from).getTime()) / LIVE_MS) * 90));
}

export async function changeLive(uid: number, fixtureId: number, b: Record<string, any>) {
  const f = await one('SELECT * FROM fixtures WHERE id=$1', [fixtureId]);
  if (!f) fail(404, 'Match not found.');
  if (f.status !== 'live' || !f.sides) fail(400, 'This match is not live.');
  const club = await myClub(uid, f.league_id);
  const side = club.id === f.home_id ? 0 : club.id === f.away_id ? 1 : -1;
  if (side < 0) fail(403, 'This is not your match.');
  const now = Date.now();
  const minute = Math.floor(liveMinute(f, now)) + 1;
  if (minute >= 90 || now > new Date(f.live_from).getTime() + LIVE_MS) fail(400, 'The match is over.');
  const changes: Change[] = f.changes || [];
  if (changes.filter((c) => c.side === side).length >= 10) fail(400, 'Too many changes.');
  let ch: Change;
  if (b.kind === 'sub') {
    ch = { m: minute, side: side as 0 | 1, kind: 'sub', out: String(b.out), in: String(b.in) };
  } else if (b.plan) {
    const key = String(b.plan).toUpperCase();
    const plan = (club.plans || {})[key] || (key === 'A' ? club.tactic : null);
    if (!plan || !plan.formation) fail(400, `Plan ${key} is empty. Save it in Tactics first.`);
    ch = { m: minute, side: side as 0 | 1, kind: 'tactic', tactic: { ...cleanTactic(plan), plan: key } };
  } else {
    const t: Record<string, unknown> = {};
    if (b.preset && PRESETS[b.preset]) t.preset = b.preset;
    for (const k of ['mentality', 'press', 'line', 'tempo']) if (b[k] !== undefined) t[k] = Math.max(0, Math.min(k === 'press' ? 3 : 2, Math.floor(Number(b[k]))));
    if (!Object.keys(t).length) fail(400, 'Nothing to change.');
    ch = { m: minute, side: side as 0 | 1, kind: 'tactic', tactic: t };
  }
  const all = [...changes, ch];
  const [hs, as] = f.sides as [ESide, ESide];
  // an AI opponent reacts to a change of plan a few minutes later: normal sometimes, hard always
  const l = await getLeague(f.league_id);
  const botSide = (1 - side) as 0 | 1;
  const botClub = await one('SELECT user_id FROM clubs WHERE id=$1', [botSide === 0 ? f.home_id : f.away_id]);
  if (!botClub?.user_id && ch.kind === 'tactic' && l.ai_level > 0) {
    const r = rng(hashSeed('react', f.id, minute));
    if (l.ai_level === 2 || r.next() < 0.5) {
      const mine = side === 0 ? hs : as;
      const theirNow = nearestPreset({ ...mine.tactic, ...changes.filter((c) => c.side === side && c.kind === 'tactic').reduce((t, c) => ({ ...t, ...(c as any).tactic }), {}), ...ch.tactic });
      const best = Object.keys(PRESETS).sort((a, b) => counterShare(b, theirNow) - counterShare(a, theirNow))[0];
      const at = Math.min(88, minute + 4 + Math.floor(r.next() * 5));
      all.push({ m: at, side: botSide, kind: 'tactic', tactic: { preset: best, ...stripDesc(PRESETS[best]) } });
    }
  }
  const derby = !!f.report?.derby;
  const cond = conditionsFor(f.id, (await getLeague(f.league_id)).pool, f.day);
  const rep = simulate(hs, as, hashSeed(f.id, f.league_id), { knockout: f.comp === 'cup', derby, changes: all, weather: cond.weather, strict: cond.referee.strict });
  await q(`UPDATE fixtures SET changes=$2::jsonb, report=$3::jsonb WHERE id=$1 AND status='live'`, [f.id, JSON.stringify(all), JSON.stringify(rep)]);
  return { report: rep, minute };
}

// ---------------------------------------------------------------- finishing a match
async function finalizeFixture(f: Row) {
  const l = await getLeague(f.league_id);
  const rep = f.report as Report;
  const home = await one('SELECT * FROM clubs WHERE id=$1', [f.home_id]);
  const away = await one('SELECT * FROM clubs WHERE id=$1', [f.away_id]);
  if (!home || !away) throw new Error('club missing');
  const [hg, ag] = rep.score;
  const winnerId = rep.winner === 0 ? home.id : rep.winner === 1 ? away.id : null;
  const saved = await q(
    `UPDATE fixtures SET status='done', home_goals=$2, away_goals=$3, winner_id=$4 WHERE id=$1 AND status='finalizing' RETURNING id`,
    [f.id, hg, ag, winnerId],
  );
  if (!saved[0]) return;

  // fitness, injuries and suspensions
  const sides = f.sides as [ESide, ESide];
  const lines = new Map(rep.players.map((p) => [p.id, p]));
  const docs = [await staffLevels(home.id), await staffLevels(away.id)];
  const fitRows = sides.flatMap((s, i) => [...s.xi, ...s.bench].map((p) => {
    const ln = lines.get(p.id);
    let out = 0, reason: string | null = null;
    if (ln?.inj) {
      const base = 1 + Math.floor(rng(hashSeed(p.id, f.id)).next() * 4);
      out = f.day + Math.max(1, base - Math.floor(docs[i].doctor / 2));
      reason = 'Injured';
    } else if (ln?.rc) { out = f.day + 1; reason = 'Suspended'; }
    return { id: p.id, fit: Math.round(ln && ln.mins > 0 ? ln.fitEnd : p.fitness), out, reason };
  }));
  await q(
    `UPDATE squad s SET fitness=x.fit,
       out_until = CASE WHEN x.out > 0 THEN x.out ELSE s.out_until END,
       out_reason = CASE WHEN x.out > 0 THEN x.reason ELSE s.out_reason END
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, fit int, out int, reason text)
     WHERE s.league_id=$2 AND s.player_id=x.id`,
    [JSON.stringify(fitRows), l.id],
  );
  if (f.comp === 'league') {
    const statRows = rep.players.filter((ln) => ln.mins > 0).map((ln) => {
      const conceded = ln.side === 0 ? ag : hg;
      return {
        id: ln.id, club: ln.side === 0 ? home.id : away.id, g: ln.g, a: ln.a, y: ln.yc, r: ln.rc ? 1 : 0,
        cs: conceded === 0 && ln.mins >= 60 && (ln.pos === 'GK' || LINE[ln.pos] === 'DEF') ? 1 : 0,
        m: rep.motm === ln.id ? 1 : 0, rt: ln.r,
      };
    });
    await q(
      `INSERT INTO pstats (league_id, player_id, club_id, apps, goals, assists, yellows, reds, clean_sheets, motm, rating_sum)
       SELECT $2, x.id, x.club, 1, x.g, x.a, x.y, x.r, x.cs, x.m, x.rt
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, club int, g int, a int, y int, r int, cs int, m int, rt numeric)
       ON CONFLICT (league_id, player_id) DO UPDATE SET apps=pstats.apps+1, goals=pstats.goals+EXCLUDED.goals, assists=pstats.assists+EXCLUDED.assists,
         yellows=pstats.yellows+EXCLUDED.yellows, reds=pstats.reds+EXCLUDED.reds, clean_sheets=pstats.clean_sheets+EXCLUDED.clean_sheets,
         motm=pstats.motm+EXCLUDED.motm, rating_sum=pstats.rating_sum+EXCLUDED.rating_sum, club_id=EXCLUDED.club_id`,
      [JSON.stringify(statRows), l.id],
    );
  }
  // money, fans and board confidence
  const derby = !!rep.derby;
  for (const [c, gf, ga, isHome] of [[home, hg, ag, true], [away, ag, hg, false]] as [Row, number, number, boolean][]) {
    const won = winnerId ? winnerId === c.id : gf > ga;
    const lost = winnerId ? winnerId !== c.id : gf < ga;
    const coins = won ? 10 : lost ? 3 : 5;
    const sp = c.sponsor && SPONSORS[c.sponsor as SponsorKey];
    let money = sp ? sp.perMatch + (won ? sp.perWin : 0) + gf * sp.perGoal : 0.2;
    if (c.club_type === 'commercial') money += gf * 0.1;
    if (isHome) money += Math.min(c.capacity || 30000, c.fans || 20000) * 0.00002 * (derby ? 1.5 : 1);
    if (f.comp === 'cup' && won) money += f.round && rep ? 1 : 0;
    const swing = (c.club_type === 'fan' ? 1.6 : 1) * (derby ? 2 : 1);
    const fans = Math.round((won ? 500 : lost ? -650 : 80) * swing);
    const board = Math.round((won ? 3 : lost ? -4 : 0) * (c.club_type === 'invest' ? 2 : 1));
    await q(
      `UPDATE clubs SET coins=coins+$1, money=money+$2, fans=GREATEST(3000, fans+$3), board=LEAST(100, GREATEST(0, board+$4)) WHERE id=$5`,
      [coins, money.toFixed(2), fans, board, c.id],
    );
    if (c.user_id) {
      // manager reputation, squad morale and how well the team knows its shape
      await q('UPDATE users SET reputation=reputation+$1 WHERE id=$2', [won ? 3 : lost ? 0 : 1, c.user_id]);
      const si = isHome ? 0 : 1;
      await moraleAfterMatch(l.id, f.day, c.id, sides[si], rep, won, lost);
      const used = rep.lineups?.[si]?.formation || sides[si].tactic.formation;
      const fam: Record<string, number> = { ...(c.familiarity || {}) };
      for (const k of Object.keys(fam)) if (k !== used) fam[k] = Math.max(40, fam[k] - 2);
      fam[used] = Math.min(100, (fam[used] ?? 50) + (c.club_type === 'historic' ? 12 : 8));
      await q('UPDATE clubs SET familiarity=$2::jsonb WHERE id=$1', [c.id, JSON.stringify(fam)]);
    }
  }
  if (derby) {
    const w = winnerId === home.id || hg > ag ? home.name : winnerId === away.id || ag > hg ? away.name : null;
    await news(l.id, null, 'derby', w ? `DERBY: ${home.name} ${hg}–${ag} ${away.name}. ${w} own the city!` : `DERBY: ${home.name} ${hg}–${ag} ${away.name}. Honours even.`);
  }
  if (f.comp === 'cup' && rep.shootout) {
    await news(l.id, winnerId, 'cup', `${winnerId === home.id ? home.name : away.name} go through on penalties (${rep.shootout.score.join('–')}) after ${hg}–${ag}.`);
  }
}

// ---------------------------------------------------------------- end of a day
async function processDay(d: Row) {
  const l = await getLeague(d.league_id);
  const fx = await q(
    `SELECT f.*, h.name AS home, a.name AS away, h.user_id AS hu, a.user_id AS au, h.club_type AS ht, a.club_type AS at
     FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id WHERE f.league_id=$1 AND f.day=$2`,
    [l.id, d.day],
  );
  const days = await q('SELECT * FROM days WHERE league_id=$1 ORDER BY day', [l.id]);
  const leagueDays = days.filter((x) => x.kind === 'league');
  const totalMd = leagueDays.length;
  const paper: Record<string, any> = { name: PAPER_NAMES[l.pool] || 'The Daily Kickoff', day: d.day, kind: d.kind, matchday: d.matchday, date: d.kickoff_at };

  if (d.kind === 'league' || d.kind === 'cup') {
    paper.results = fx.map((f) => ({
      id: f.id, home: f.home, away: f.away, hg: f.home_goals, ag: f.away_goals, derby: !!f.report?.derby,
      pens: f.report?.shootout?.score ?? null, winner: f.winner_id === f.home_id ? 0 : f.winner_id === f.away_id ? 1 : null,
    }));
    paper.comments = await q(
      `SELECT c.text, c.tone, cl.name AS club, cl.color1, u.username FROM comments c JOIN clubs cl ON cl.id=c.club_id LEFT JOIN users u ON u.id=cl.user_id
       WHERE c.league_id=$1 AND c.day=$2 ORDER BY c.created_at`,
      [l.id, d.day],
    );
    const derbyFx = paper.results.find((r: any) => r.derby);
    const big = [...paper.results].sort((a: any, b: any) => Math.abs(b.hg - b.ag) - Math.abs(a.hg - a.ag) || (b.hg + b.ag) - (a.hg + a.ag))[0];
    if (derbyFx) {
      const w = derbyFx.hg > derbyFx.ag ? derbyFx.home : derbyFx.ag > derbyFx.hg ? derbyFx.away : derbyFx.winner === 0 ? derbyFx.home : derbyFx.winner === 1 ? derbyFx.away : null;
      paper.headline = w ? `${w} rule the city` : 'Derby ends all square';
      paper.sub = `${derbyFx.home} ${derbyFx.hg}–${derbyFx.ag} ${derbyFx.away} in a derby nobody will forget.`;
    } else if (big && Math.abs(big.hg - big.ag) >= 3) {
      const [w, lo, a, b] = big.hg > big.ag ? [big.home, big.away, big.hg, big.ag] : [big.away, big.home, big.ag, big.hg];
      paper.headline = `${w} thrash ${lo}`;
      paper.sub = `A ${a}–${b} statement result.`;
    } else if (big) {
      paper.headline = big.hg === big.ag ? `${big.home} and ${big.away} cancel out` : `${big.hg > big.ag ? big.home : big.away} edge it`;
      paper.sub = `${big.home} ${big.hg}–${big.ag} ${big.away}.`;
    }
  }

  if (d.kind === 'league') {
    await randomEvents(l, d.day);
    paper.label = `Matchday ${d.matchday}`;
    paper.totw = await teamOfTheWeek(l, d, fx);
    const hd = (await one<{ d: number }>('SELECT MIN(division)::int AS d FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL', [l.id]))?.d || 1;
    const table = await standings(l.id, hd);
    paper.top = table.slice(0, 3).map((t) => ({ name: t.name, pts: t.pts, p: t.p }));
    if (!paper.headline) paper.headline = `${table[0]?.name} lead the way`;
    if (d.matchday % 4 === 0) await playerOfTheMonth(l, d);
    if (d.matchday === totalMd / 2) {
      await news(l.id, null, 'round', `🏁 The first round is over! ${table[0]?.name} lead at the halfway mark. The second round starts tomorrow.`);
    }
  }
  if (d.kind === 'cup') {
    const cup = await cupState(l.id);
    const rd = cup?.rounds[d.round - 1];
    paper.label = `${cup?.name} · ${rd?.name}`;
    if (cup && d.round < cup.rounds.length) await drawCup(l, d.round + 1);
    else if (cup && fx[0]?.winner_id) {
      cup.winner = fx[0].winner_id;
      await q(`UPDATE papers SET data=$2::jsonb WHERE league_id=$1 AND day=0 AND kind='cup'`, [l.id, JSON.stringify(cup)]);
      await q('UPDATE clubs SET money=money+8, fans=fans+3000 WHERE id=$1', [cup.winner]);
      const w = fx[0].winner_id === fx[0].home_id ? fx[0].home : fx[0].away;
      await news(l.id, cup.winner!, 'cup', `${w} win ${cup.name}! 8M prize and a trophy for the cabinet.`);
      paper.headline = `${w} lift ${cup.name}`;
    }
  }
  if (d.kind === 'break') {
    paper.label = 'Second round';
    paper.headline = 'THE SECOND ROUND BEGINS';
    paper.sub = `No matches today. The return games start tomorrow, and the transfer window is open for ${WINDOW_DAYS} days.`;
    await botListings(l);
    await botBids(l, d.day);
    await botShopping(l, d.day);
  }
  // transfer window: opens for 5 days at the start of each round; tell everyone when it opens, on its last day and when it shuts
  {
    const at = new Date(d.kickoff_at).getTime();
    const before = windowFromDays('running', days as any, at - 1000), after = windowFromDays('running', days as any, at + 1000);
    const humans = (await q('SELECT user_id FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL', [l.id])).map((h) => h.user_id);
    const w = writes();
    const say = (kind: string, text: string) => w.add(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,NULL,$2,$3)`, [l.id, kind, text]);
    if (after.open && after.round === 2 && before.round !== 2) {
      say('round', '🔁 The second round has started! Every team now plays the return games.');
      say('window', `🔓 The transfer window is OPEN for ${WINDOW_DAYS} days. Buy, sell, loan and swap before it shuts.`);
      await notifyMany(humans, { title: '🔓 Transfer window open', body: `The second round has started. You have ${WINDOW_DAYS} days to do your deals.`, url: `/l/${l.id}?tab=market`, tag: `win-${l.id}` });
    } else if (before.open && !after.open) {
      say('window', `🔒 The transfer window is now CLOSED. ${after.phase === 'between' ? 'It opens again when the second round starts.' : 'It opens again next season.'}`);
    } else if (after.open && after.closesAt && new Date(after.closesAt).getTime() - at <= 86_400_000 + 60_000) {
      say('deadline', '⏰ DEADLINE DAY! The transfer window closes at the next kick-off. Get your offers in.');
      await notifyMany(humans, { title: '⏰ Deadline day', body: 'The transfer window closes at the next kick-off.', url: `/l/${l.id}?tab=market`, tag: `win-${l.id}` });
    }
    await w.flush();
  }
  await q(
    `INSERT INTO papers (league_id, day, kind, data) VALUES ($1,$2,'paper',$3::jsonb) ON CONFLICT (league_id, day, kind) DO UPDATE SET data=EXCLUDED.data`,
    [l.id, d.day, JSON.stringify(paper)],
  );
  // season end
  const left = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM days WHERE league_id=$1 AND processed=false', [l.id]);
  if (left?.n === 0) await endSeason(l);
}

export const nextSeason = (uid: number, leagueId: number) => startNextSeason(uid, leagueId, makeSchedule);

// Best XI of the day (4-3-3) by match rating. Picked players get "In form" (+2) for 2 days.
async function teamOfTheWeek(l: Row, d: Row, fx: Row[]) {
  const all: any[] = [];
  for (const f of fx) {
    for (const p of (f.report?.players || []) as any[]) {
      if (p.mins < 45) continue;
      all.push({ ...p, club: p.side === 0 ? f.home : f.away, clubId: p.side === 0 ? f.home_id : f.away_id, mine: !!(p.side === 0 ? f.hu : f.au) });
    }
  }
  const need: [string, number][] = [['GK', 1], ['DEF', 4], ['MID', 3], ['FWD', 3]];
  const team: any[] = [];
  for (const [line, n] of need) {
    team.push(...all.filter((p) => (LINE[p.pos] || 'MID') === line).sort((a, b) => b.r - a.r || b.g - a.g).slice(0, n).map((p) => ({ ...p, line })));
  }
  const star = [...team].sort((a, b) => b.r - a.r)[0];
  if (team.length) {
    await q(
      `UPDATE squad SET form_mod=2, form_until=$2, form_note='Team of the Week' WHERE league_id=$1 AND player_id IN (SELECT jsonb_array_elements_text($3::jsonb)) AND form_mod <= 2`,
      [l.id, d.day + 2, JSON.stringify(team.map((p) => p.id))],
    );
  }
  return { players: team.map((p) => ({ id: p.id, name: p.name, pos: p.pos, line: p.line, club: p.club, clubId: p.clubId, r: p.r, g: p.g, a: p.a })), star: star?.id ?? null };
}

// Every 4 league matchdays: winner +3 for 4 days, the other nominees sulk (-2 for 2 days).
async function playerOfTheMonth(l: Row, d: Row) {
  const fx = await q(
    `SELECT f.report, f.home_id, f.away_id, h.name AS home, a.name AS away FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id
     WHERE f.league_id=$1 AND f.comp='league' AND f.status='done' AND f.matchday BETWEEN $2 AND $3`,
    [l.id, d.matchday - 3, d.matchday],
  );
  const agg = new Map<string, any>();
  for (const f of fx) {
    const [hg, ag] = f.report.score;
    for (const p of f.report.players as any[]) {
      if (p.mins < 30) continue;
      const won = p.side === 0 ? hg > ag : ag > hg, draw = hg === ag;
      const x = agg.get(p.id) || { id: p.id, name: p.name, pos: p.pos, club: p.side === 0 ? f.home : f.away, clubId: p.side === 0 ? f.home_id : f.away_id, apps: 0, r: 0, g: 0, a: 0, pts: 0 };
      x.apps++; x.r += p.r; x.g += p.g; x.a += p.a; x.pts += won ? 3 : draw ? 1 : 0;
      agg.set(p.id, x);
    }
  }
  const ranked = [...agg.values()].filter((x) => x.apps >= 2).map((x) => ({ ...x, avg: Math.round((x.r / x.apps) * 10) / 10, score: Math.round(((x.r / x.apps) * 10 + x.g * 2 + x.a * 1.5 + x.pts * 0.8) * 10) / 10 }))
    .sort((a, b) => b.score - a.score);
  const nominees = ranked.slice(0, 4);
  if (!nominees.length) return;
  const winner = nominees[0];
  await q(`UPDATE squad SET form_mod=3, form_until=$3, form_note='Player of the Month' WHERE league_id=$1 AND player_id=$2`, [l.id, winner.id, d.day + 4]);
  const losers = nominees.slice(1).map((n) => n.id);
  if (losers.length) {
    await q(
      `UPDATE squad SET form_mod=-2, form_until=$2, form_note='Upset: missed Player of the Month' WHERE league_id=$1 AND player_id IN (SELECT jsonb_array_elements_text($3::jsonb))`,
      [l.id, d.day + 2, JSON.stringify(losers)],
    );
  }
  const ovr = await q(`SELECT id, ovr FROM players WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb))`, [JSON.stringify(nominees.map((n) => n.id))]);
  const month = Math.ceil(d.matchday / 4);
  await q(
    `INSERT INTO papers (league_id, day, kind, data) VALUES ($1,$2,'potm',$3::jsonb) ON CONFLICT (league_id, day, kind) DO UPDATE SET data=EXCLUDED.data`,
    [l.id, d.day, JSON.stringify({ month, from: d.matchday - 3, to: d.matchday, nominees: nominees.map((n) => ({ ...n, ovr: ovr.find((o) => o.id === n.id)?.ovr })), winner: winner.id })],
  );
  await news(l.id, winner.clubId, 'award', `${winner.name} (${winner.club}) is Player of the Month!`);
}

export { isDerby };
