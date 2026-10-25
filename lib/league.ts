// Server-side game logic: leagues, clubs, packs, fixtures, match running, transfers.
import { q, one, type Row } from './db.ts';
import { fail } from './errors.ts';
import {
  AI_COLORS, AI_NAMES, CLUB_TYPES, DEFAULT_TACTIC, FORMATIONS, LINE, MAX_SQUAD, MIN_SQUAD, PACKS, POOLS,
  shortName, windowState, type ClubTypeKey, type PackKey, type Tactic,
} from './game.ts';
import { aiTactic, simulate, type EPlayer, type ESide, type Report } from './engine.ts';
import { hashSeed, rng } from './rng.ts';

export const INTERVALS: Record<number, string> = { 15: 'Every 15 minutes (quick test)', 60: 'Every hour', 1440: 'Once a day' };
export const AI_SQUAD = 18;

// ---------------------------------------------------------------- leagues
export async function poolSize(pool: string) {
  const r = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM players WHERE pool=$1', [pool]);
  return r?.n ?? 0;
}
export async function maxClubsFor(pool: string) {
  return Math.min(30, Math.floor((await poolSize(pool)) / (AI_SQUAD + 1)));
}

function code() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export async function createLeague(uid: number, b: { name: string; pool: string; maxClubs: number; aiLevel: number; interval: number; kickoffUtcMin?: number }) {
  const name = String(b.name || '').trim().slice(0, 40);
  if (name.length < 3) fail(400, 'League name needs at least 3 letters.');
  if (!POOLS[b.pool]) fail(400, 'Pick a league pool.');
  const cap = await maxClubsFor(b.pool);
  const maxClubs = Math.max(4, Math.min(cap, Math.floor(Number(b.maxClubs) || 10)));
  const aiLevel = [0, 1, 2].includes(Number(b.aiLevel)) ? Number(b.aiLevel) : 2;
  const interval = INTERVALS[Number(b.interval)] ? Number(b.interval) : 1440;
  const kick = Math.max(0, Math.min(1439, Math.floor(Number(b.kickoffUtcMin ?? 1080))));
  for (let i = 0; i < 5; i++) {
    const c = code();
    const r = await q(
      `INSERT INTO leagues (name, code, owner_id, pool, max_clubs, ai_level, interval_min, kickoff_utc_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (code) DO NOTHING RETURNING id, code`,
      [name, c, uid, b.pool, maxClubs, aiLevel, interval, kick],
    );
    if (r[0]) return r[0];
  }
  fail(500, 'Could not create a league code. Try again.');
}

export async function leagueByCode(c: string) {
  const l = await one('SELECT * FROM leagues WHERE code=$1', [String(c || '').trim().toUpperCase()]);
  if (!l) fail(404, 'No league with that code.');
  return l;
}

export async function getLeague(id: number) {
  const l = await one('SELECT * FROM leagues WHERE id=$1', [id]);
  if (!l) fail(404, 'League not found.');
  return l;
}

export async function myLeagues(uid: number) {
  return q(
    `SELECT l.id, l.name, l.code, l.pool, l.status, l.max_clubs, c.id AS club_id, c.name AS club_name, c.color1, c.color2, c.short,
       (SELECT COUNT(*)::int FROM clubs x WHERE x.league_id=l.id) AS clubs,
       (SELECT COUNT(*)::int FROM clubs x WHERE x.league_id=l.id AND x.user_id IS NOT NULL) AS humans
     FROM clubs c JOIN leagues l ON l.id=c.league_id WHERE c.user_id=$1 ORDER BY l.created_at DESC`,
    [uid],
  );
}

export async function myClub(uid: number, leagueId: number) {
  const c = await one('SELECT * FROM clubs WHERE league_id=$1 AND user_id=$2', [leagueId, uid]);
  if (!c) fail(403, 'You have no club in this league yet.');
  return c;
}

// ---------------------------------------------------------------- clubs
export async function createClub(uid: number, leagueId: number, b: Record<string, any>) {
  const l = await getLeague(leagueId);
  if (l.status !== 'setup') fail(400, 'This league has already kicked off. New clubs can join next season.');
  const exists = await one('SELECT id FROM clubs WHERE league_id=$1 AND user_id=$2', [leagueId, uid]);
  if (exists) fail(400, 'You already have a club in this league.');
  const [{ n }] = await q<{ n: number }>('SELECT COUNT(*)::int AS n FROM clubs WHERE league_id=$1', [leagueId]);
  if (n >= l.max_clubs) fail(400, 'This league is full.');
  const name = String(b.name || '').trim().slice(0, 28);
  if (name.length < 3) fail(400, 'Club name needs at least 3 letters.');
  const taken = await one('SELECT id FROM clubs WHERE league_id=$1 AND lower(name)=lower($2)', [leagueId, name]);
  if (taken) fail(400, 'Another club in this league already has that name.');
  const type = (CLUB_TYPES[b.type as ClubTypeKey] ? b.type : 'fan') as ClubTypeKey;
  const t = CLUB_TYPES[type];
  const hex = (v: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
  const short = String(b.short || shortName(name)).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || shortName(name);
  const r = await q(
    `INSERT INTO clubs (league_id, user_id, name, short, color1, color2, shape, emblem, stadium, club_type, coins, money, tactic)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING id`,
    [leagueId, uid, name, short, hex(b.color1, '#E8438C'), hex(b.color2, '#7FE9F7'), Number(b.shape) % 4 || 0, Number(b.emblem) % 6 || 0,
      String(b.stadium || `${name} Park`).slice(0, 32), type, t.coins, t.money, JSON.stringify(DEFAULT_TACTIC)],
  );
  await news(leagueId, r[0].id, 'club', `${name} join the league as a ${t.name}.`);
  return r[0];
}

export async function news(leagueId: number, clubId: number | null, kind: string, text: string) {
  await q('INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,$3,$4)', [leagueId, clubId, kind, text]);
}

// ---------------------------------------------------------------- packs
export async function openPack(uid: number, leagueId: number, key: PackKey) {
  const pack = PACKS[key];
  if (!pack) fail(400, 'Unknown pack.');
  const l = await getLeague(leagueId);
  const club = await myClub(uid, leagueId);
  const [{ n }] = await q<{ n: number }>('SELECT COUNT(*)::int AS n FROM squad WHERE club_id=$1', [club.id]);
  if (n + pack.n > MAX_SQUAD) fail(400, `Squad limit is ${MAX_SQUAD} players.`);
  const paid = await q('UPDATE clubs SET coins = coins - $1 WHERE id=$2 AND coins >= $1 RETURNING coins', [pack.price, club.id]);
  if (!paid[0]) fail(400, 'Not enough coins for this pack.');

  // percentile band of the league pool
  const [{ total }] = await q<{ total: number }>('SELECT COUNT(*)::int AS total FROM players WHERE pool=$1', [l.pool]);
  const lo = Math.floor(total * (1 - pack.hi)), hi = Math.ceil(total * (1 - pack.lo));
  const band = await q(
    `SELECT p.* FROM (SELECT * FROM players WHERE pool=$1 ORDER BY ovr DESC, id OFFSET $2 LIMIT $3) p
     WHERE NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$4 AND s.player_id=p.id)`,
    [l.pool, lo, Math.max(1, hi - lo), leagueId],
  );
  let candidates = band;
  if (candidates.length < pack.n) {
    // band exhausted: fall back to the best free players below it
    candidates = await q(
      `SELECT p.* FROM players p WHERE pool=$1 AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id)
       ORDER BY ovr DESC LIMIT 60`,
      [l.pool, leagueId],
    );
  }
  if (candidates.length < pack.n) {
    await q('UPDATE clubs SET coins = coins + $1 WHERE id=$2', [pack.price, club.id]);
    fail(400, 'No players left for this pack in this league.');
  }
  const pick: Row[] = [];
  const pool = [...candidates];
  const take = (pred: (p: Row) => boolean) => {
    const opts = pool.filter(pred);
    if (!opts.length) return;
    const p = opts[Math.floor(Math.random() * opts.length)];
    pool.splice(pool.indexOf(p), 1);
    pick.push(p);
  };
  if ('gk' in pack && pack.gk) {
    if (!pool.some((p) => p.pos === 'GK')) {
      // no keeper left in the band: give the cheapest free keeper outside the star bands
      const gk = await one(
        `SELECT p.* FROM players p WHERE pool=$1 AND pos='GK' AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id)
         ORDER BY ovr ASC LIMIT 1`, [l.pool, leagueId]);
      if (gk) pool.push(gk);
    }
    take((p) => p.pos === 'GK');
  }
  while (pick.length < pack.n && pool.length) take(() => true);
  const got: Row[] = [];
  for (const p of pick) {
    const r = await q('INSERT INTO squad (league_id, player_id, club_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING player_id', [leagueId, p.id, club.id]);
    if (r[0]) got.push(p);
  }
  if (got.length < pick.length) {
    // someone grabbed one of these at the same moment: refund the share
    const refund = Math.round((pack.price * (pick.length - got.length)) / pick.length);
    await q('UPDATE clubs SET coins = coins + $1 WHERE id=$2', [refund, club.id]);
  }
  if (key === 'legend' && got[0]) await news(leagueId, club.id, 'pack', `${club.name} pull a legend: ${got[0].name} (${got[0].ovr})!`);
  return { players: got.map(pub), coins: paid[0].coins };
}

export function pub(p: Row) {
  return { id: p.id, name: p.name, pos: p.pos, ovr: p.ovr, pot: p.pot, age: p.age, nat: p.nat, foot: p.foot, height: p.height, attrs: p.attrs };
}

// ---------------------------------------------------------------- squads & lineups
export async function squadOf(clubId: number) {
  return q(
    `SELECT p.*, s.fitness, s.out_until, s.out_reason FROM squad s JOIN players p ON p.id=s.player_id
     WHERE s.club_id=$1 ORDER BY CASE p.pos WHEN 'GK' THEN 0 WHEN 'CB' THEN 1 WHEN 'LB' THEN 2 WHEN 'RB' THEN 3 WHEN 'DM' THEN 4 WHEN 'CM' THEN 5 WHEN 'CAM' THEN 6 WHEN 'LW' THEN 7 WHEN 'RW' THEN 8 ELSE 9 END, p.ovr DESC`,
    [clubId],
  );
}

// Best XI for a formation from available players. Respects a saved lineup where possible.
export function pickXI(players: Row[], formation: string, saved: string[], matchday: number) {
  const slots = (FORMATIONS[formation] || FORMATIONS['4-3-3']).slots;
  const avail = players.filter((p) => (p.out_until ?? 0) < matchday);
  const used = new Set<string>();
  const xi: (Row | null)[] = slots.map((_, i) => {
    const p = avail.find((x) => x.id === saved[i]);
    if (p && !used.has(p.id)) {
      used.add(p.id);
      return p;
    }
    return null;
  });
  const score = (p: Row, slot: string) => {
    const line = LINE[p.pos] || 'MID';
    const fit = Math.min(1, (p.fitness ?? 100) / 100);
    return p.ovr * (0.55 + 0.45 * fit) - (line === slot ? 0 : slot === 'GK' || line === 'GK' ? 60 : 9);
  };
  // pass 1: natural positions only, pass 2: anyone (with the out-of-position cost)
  for (const strict of [true, false]) {
    slots.forEach((slot, i) => {
      if (xi[i]) return;
      const best = avail
        .filter((p) => !used.has(p.id) && (!strict || (LINE[p.pos] || 'MID') === slot))
        .sort((a, b) => score(b, slot) - score(a, slot))[0];
      if (best) {
        used.add(best.id);
        xi[i] = best;
      }
    });
  }
  const starters = xi.filter(Boolean) as Row[];
  const bench = avail.filter((p) => !used.has(p.id)).sort((a, b) => b.ovr - a.ovr).slice(0, 9);
  return { xi: starters, bench };
}

export async function saveSetup(uid: number, leagueId: number, b: { tactic?: Tactic; lineup?: string[]; pens?: string[]; assistant?: Record<string, boolean> }) {
  const club = await myClub(uid, leagueId);
  const ids = new Set((await q('SELECT player_id FROM squad WHERE club_id=$1', [club.id])).map((r) => r.player_id));
  const clean = (arr: unknown, max: number) => (Array.isArray(arr) ? arr.map(String).filter((x) => ids.has(x)).slice(0, max) : undefined);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (b.tactic) {
    const t = b.tactic;
    const n = (v: unknown, hi: number) => Math.max(0, Math.min(hi, Math.floor(Number(v) || 0)));
    const tactic: Tactic = {
      preset: String(t.preset || 'Custom').slice(0, 20), formation: FORMATIONS[t.formation] ? t.formation : '4-3-3',
      mentality: n(t.mentality, 2), press: n(t.press, 3), line: n(t.line, 2), build: n(t.build, 2), focus: n(t.focus, 3), width: n(t.width, 2), tempo: n(t.tempo, 2),
    };
    params.push(JSON.stringify(tactic));
    sets.push(`tactic=$${params.length}::jsonb`);
  }
  if (b.lineup) {
    if (!Array.isArray(b.lineup) || b.lineup.length > 11) fail(400, 'Bad lineup.');
    params.push(JSON.stringify(b.lineup.map((x) => (x && ids.has(String(x)) ? String(x) : ''))));
    sets.push(`lineup=$${params.length}::jsonb`);
  }
  const pens = clean(b.pens, 5);
  if (pens) {
    params.push(JSON.stringify(pens));
    sets.push(`pens=$${params.length}::jsonb`);
  }
  if (b.assistant) {
    const a = b.assistant;
    params.push(JSON.stringify({ tired: !!a.tired, cards: !!a.cards, winning: !!a.winning, losing: !!a.losing }));
    sets.push(`assistant=$${params.length}::jsonb`);
  }
  if (!sets.length) return { ok: true };
  params.push(club.id);
  await q(`UPDATE clubs SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
  return { ok: true };
}

// ---------------------------------------------------------------- starting a season
export async function startLeague(uid: number, leagueId: number) {
  const l = await getLeague(leagueId);
  if (l.owner_id !== uid) fail(403, 'Only the league creator can start it.');
  if (l.status !== 'setup') fail(400, 'Already started.');
  const humans = await q('SELECT id, name FROM clubs WHERE league_id=$1', [leagueId]);
  for (const c of humans) {
    const sq = await q('SELECT p.pos FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1', [c.id]);
    const gks = sq.filter((p) => p.pos === 'GK').length;
    if (sq.length < MIN_SQUAD || gks < 2) fail(400, `${c.name} needs at least ${MIN_SQUAD} players including 2 goalkeepers (now ${sq.length}, ${gks} GK).`);
  }
  const claim = await q(`UPDATE leagues SET status='starting' WHERE id=$1 AND status='setup' RETURNING id`, [leagueId]);
  if (!claim[0]) fail(400, 'Already starting.');
  await fillWithBots(l, humans.length);
  await makeFixtures(l);
  await q(`UPDATE leagues SET status='running' WHERE id=$1`, [leagueId]);
  await news(leagueId, null, 'season', `The season kicks off! ${l.max_clubs} clubs, home and away.`);
  return { ok: true };
}

// Bots share the players left in the pool. Hard bots take the best of what remains.
async function fillWithBots(l: Row, humanCount: number) {
  const need = l.max_clubs - humanCount;
  if (need <= 0) return;
  const free = await q(
    `SELECT p.id, p.pos, p.ovr FROM players p WHERE pool=$1 AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id) ORDER BY ovr DESC`,
    [l.pool, l.id],
  );
  const r = rng(hashSeed('bots', l.id));
  // easy bots skip the top of the remaining pool
  const skip = l.ai_level === 0 ? Math.floor(free.length * 0.35) : l.ai_level === 1 ? Math.floor(free.length * 0.12) : 0;
  const byLine: Record<string, Row[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  free.slice(skip).forEach((p) => byLine[LINE[p.pos] || 'MID'].push(p));
  const want: Record<string, number> = { GK: 2, DEF: 6, MID: 6, FWD: 4 };
  const names = r.next() < 2 ? [...AI_NAMES].sort(() => r.next() - 0.5) : AI_NAMES;
  const botIds: number[] = [];
  for (let i = 0; i < need; i++) {
    const name = names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : '');
    const color = AI_COLORS[i % AI_COLORS.length];
    const type = (['fan', 'invest', 'academy', 'commercial', 'historic'] as ClubTypeKey[])[i % 5];
    const presets = ['Tiki-taka', 'Gegenpress', 'Low block', 'Wing play', 'Long ball', 'Shoot on sight'];
    const t = aiTactic(0, [], hashSeed(l.id, i, presets[i % 6]));
    const c = await q(
      `INSERT INTO clubs (league_id, user_id, name, short, color1, color2, shape, emblem, stadium, club_type, coins, money, tactic)
       VALUES ($1,NULL,$2,$3,$4,'#F3EEFF',$5,$6,$7,$8,0,$9,$10::jsonb) RETURNING id`,
      [l.id, name, shortName(name), color, i % 4, i % 6, `${name.split(' ')[0]} Arena`, type, CLUB_TYPES[type].money, JSON.stringify(t)],
    );
    botIds.push(c[0].id);
  }
  // snake draft per line so the bots are even with each other
  const rows: [string, number][] = [];
  for (const line of ['GK', 'DEF', 'MID', 'FWD']) {
    const list = byLine[line];
    let k = 0;
    for (let round = 0; round < want[line]; round++) {
      const order = round % 2 === 0 ? botIds : [...botIds].reverse();
      for (const id of order) {
        const p = list[k++];
        if (p) rows.push([p.id, id]);
      }
    }
  }
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const vals = chunk.map((_, k) => `($1,$${k * 2 + 2},$${k * 2 + 3})`).join(',');
    await q(`INSERT INTO squad (league_id, player_id, club_id) VALUES ${vals} ON CONFLICT DO NOTHING`, [l.id, ...chunk.flat()]);
  }
}

function nextKick(l: Row, from: Date) {
  if (l.interval_min >= 1440) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, l.kickoff_utc_min));
    if (d.getTime() <= from.getTime() + 30 * 60_000) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  const step = l.interval_min * 60_000;
  return new Date(Math.ceil((from.getTime() + step) / step) * step);
}

async function makeFixtures(l: Row) {
  const clubs = (await q('SELECT id FROM clubs WHERE league_id=$1 ORDER BY id', [l.id])).map((c) => c.id as number);
  const r = rng(hashSeed('fixtures', l.id));
  const ids: (number | null)[] = [...clubs].sort(() => r.next() - 0.5);
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
  const all = [...rounds, ...rounds.map((g) => g.map(([a, b]) => [b, a] as [number, number]))];
  const step = l.interval_min * 60_000;
  let kick = nextKick(l, new Date());
  const rows: unknown[] = [];
  all.forEach((games, md) => {
    if (md === rounds.length) kick = new Date(kick.getTime() + step); // mid-season break for the window
    games.forEach(([h, a]) => rows.push([md + 1, h, a, kick.toISOString()]));
    kick = new Date(kick.getTime() + step);
  });
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200) as unknown[][];
    const vals = chunk.map((_, k) => `($1,$${k * 4 + 2},$${k * 4 + 3},$${k * 4 + 4},$${k * 4 + 5}::timestamptz)`).join(',');
    await q(`INSERT INTO fixtures (league_id, matchday, home_id, away_id, kickoff_at) VALUES ${vals}`, [l.id, ...chunk.flat()]);
  }
}

// ---------------------------------------------------------------- running matches
let running: Promise<number> | null = null;

// Plays every fixture whose kickoff time has passed. Safe to call from many requests.
export async function runDue(leagueId?: number) {
  if (running) return running;
  running = (async () => {
    let played = 0;
    const t0 = Date.now();
    try {
      for (let guard = 0; guard < 400 && Date.now() - t0 < 40_000; guard++) {
        const f = await one(
          `UPDATE fixtures SET status='playing' WHERE id = (
             SELECT id FROM fixtures WHERE status='scheduled' AND kickoff_at <= now() ${leagueId ? 'AND league_id=$1' : ''}
             ORDER BY kickoff_at, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
          leagueId ? [leagueId] : [],
        );
        if (!f) break;
        try {
          await playFixture(f);
          played++;
        } catch (e) {
          console.error('match failed', f.id, e);
          await q(`UPDATE fixtures SET status='scheduled' WHERE id=$1`, [f.id]);
          break;
        }
      }
      // stuck "playing" rows from a crashed run go back to the queue
      await q(`UPDATE fixtures SET status='scheduled' WHERE status='playing' AND kickoff_at < now() - interval '10 minutes'`);
    } finally {
      running = null;
    }
    return played;
  })();
  return running;
}

async function sideFor(club: Row, l: Row, matchday: number, opp: Row, home: boolean): Promise<ESide> {
  const players = await squadOf(club.id);
  // recovery since the last match
  for (const p of players) p.fitness = Math.min(100, (p.fitness ?? 100) + (l.interval_min >= 1440 ? 26 : 22));
  let tactic: Tactic = club.tactic && club.tactic.formation ? club.tactic : DEFAULT_TACTIC;
  if (!club.user_id) {
    const hist = await q(
      `SELECT report->'tactics' AS t, home_id FROM fixtures WHERE status='done' AND league_id=$1 AND (home_id=$2 OR away_id=$2) ORDER BY matchday DESC LIMIT 5`,
      [l.id, opp.id],
    );
    const oppT = hist.map((h) => (h.t ? h.t[h.home_id === opp.id ? 0 : 1] : null)).filter(Boolean) as string[];
    const forms = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '5-3-2'];
    tactic = aiTactic(l.ai_level, oppT, hashSeed(l.id, matchday, club.id), forms[club.id % forms.length]);
  }
  const { xi, bench } = pickXI(players, tactic.formation, club.user_id ? club.lineup || [] : [], matchday);
  const toE = (p: Row): EPlayer => ({ id: p.id, name: p.name, pos: p.pos, ovr: p.ovr, fitness: p.fitness, a: p.attrs });
  const pens = (club.pens || []).length ? club.pens : xi.filter((p) => p.pos !== 'GK').sort((a, b) => (b.attrs.Finishing + b.attrs.Composure) - (a.attrs.Finishing + a.attrs.Composure)).slice(0, 5).map((p) => p.id);
  // AI clubs are lifted toward the managers' level so thin pools still give hard games
  let boost = 0;
  if (!club.user_id) {
    const h = await one<{ a: number }>(
      `SELECT AVG(o)::float AS a FROM (SELECT p.ovr AS o, s.club_id, ROW_NUMBER() OVER (PARTITION BY s.club_id ORDER BY p.ovr DESC) AS rn
         FROM squad s JOIN players p ON p.id=s.player_id JOIN clubs c ON c.id=s.club_id WHERE c.league_id=$1 AND c.user_id IS NOT NULL) x WHERE rn<=11`,
      [l.id],
    );
    const mine = xi.reduce((a, p) => a + p.ovr, 0) / Math.max(1, xi.length);
    const gap = (h?.a ?? mine) - mine;
    boost = Math.max(0, gap) * [0.2, 0.6, 0.9][l.ai_level] ;
  }
  return {
    clubId: club.id, name: club.name, xi: xi.map(toE), bench: bench.map(toE), tactic, boost,
    assistant: club.user_id ? club.assistant : { tired: true, cards: true, winning: true, losing: true },
    pens, homeBoost: home && club.club_type === 'fan' ? 1 : 0,
  };
}

async function playFixture(f: Row) {
  const l = await getLeague(f.league_id);
  const home = await one('SELECT * FROM clubs WHERE id=$1', [f.home_id]);
  const away = await one('SELECT * FROM clubs WHERE id=$1', [f.away_id]);
  if (!home || !away) throw new Error('club missing');
  const hs = await sideFor(home, l, f.matchday, away, true);
  const as = await sideFor(away, l, f.matchday, home, false);
  const rep: Report & { derby?: boolean; lineups?: unknown } = simulate(hs, as, hashSeed(f.id, f.league_id));
  rep.derby = home.club_type === 'fan' && away.club_type === 'fan' && !!home.user_id && !!away.user_id;
  rep.lineups = [hs, as].map((s) => ({ xi: s.xi.map((p) => p.id), formation: s.tactic.formation, preset: s.tactic.preset }));
  const [hg, ag] = rep.score;
  await q(`UPDATE fixtures SET status='done', home_goals=$2, away_goals=$3, report=$4::jsonb WHERE id=$1`, [f.id, hg, ag, JSON.stringify(rep)]);

  // fitness, injuries and suspensions (one statement)
  const all = [...hs.xi, ...hs.bench, ...as.xi, ...as.bench];
  const lines = new Map(rep.players.map((p) => [p.id, p]));
  const fitRows = all.map((p) => {
    const ln = lines.get(p.id);
    let out = 0, reason: string | null = null;
    if (ln?.inj) { out = f.matchday + 1 + Math.floor(rng(hashSeed(p.id, f.id)).next() * 3); reason = 'Injured'; }
    else if (ln?.rc) { out = f.matchday + 1; reason = 'Suspended'; }
    return { id: p.id, fit: Math.round(ln ? ln.fitEnd : p.fitness), out, reason };
  });
  await q(
    `UPDATE squad s SET fitness=x.fit,
       out_until = CASE WHEN x.out > 0 THEN x.out ELSE s.out_until END,
       out_reason = CASE WHEN x.out > 0 THEN x.reason ELSE s.out_reason END
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, fit int, out int, reason text)
     WHERE s.league_id=$2 AND s.player_id=x.id`,
    [JSON.stringify(fitRows), l.id],
  );
  // stats (one statement)
  const statRows = rep.players.map((ln) => {
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
  // rewards
  for (const [c, gf, ga] of [[home, hg, ag], [away, ag, hg]] as [Row, number, number][]) {
    const coins = gf > ga ? 10 : gf === ga ? 5 : 3;
    const money = (gf > ga ? 0.6 : gf === ga ? 0.3 : 0.1) + (c.club_type === 'commercial' ? gf * 0.1 : 0) + (c.id === home.id ? (home.club_type === 'fan' ? 0.5 : 0.3) : 0);
    await q('UPDATE clubs SET coins=coins+$1, money=money+$2 WHERE id=$3', [coins, money.toFixed(2), c.id]);
  }
  if (rep.derby) await news(l.id, null, 'derby', `DERBY: ${home.name} ${hg}–${ag} ${away.name}`);

  // window and season end
  const left = await one<{ n: number; md: number }>(
    `SELECT COUNT(*) FILTER (WHERE status<>'done')::int AS n, MAX(matchday)::int AS md FROM fixtures WHERE league_id=$1`, [l.id]);
  const mdLeft = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM fixtures WHERE league_id=$1 AND matchday=$2 AND status<>'done'`, [l.id, f.matchday]);
  if (mdLeft?.n === 0 && left && f.matchday === left.md / 2) {
    await botListings(l);
    await news(l.id, null, 'window', 'The mid-season transfer window is open!');
  }
  if (left?.n === 0) {
    await q(`UPDATE leagues SET status='finished' WHERE id=$1`, [l.id]);
    const top = (await standings(l.id))[0];
    if (top) await news(l.id, top.id, 'champion', `${top.name} are the champions!`);
  }
}

// ---------------------------------------------------------------- tables
export async function standings(leagueId: number) {
  const clubs = await q('SELECT id, name, short, color1, color2, user_id, club_type FROM clubs WHERE league_id=$1', [leagueId]);
  const fx = await q(`SELECT home_id, away_id, home_goals, away_goals, matchday FROM fixtures WHERE league_id=$1 AND status='done' ORDER BY matchday`, [leagueId]);
  const t = new Map<number, any>(clubs.map((c) => [c.id, { ...c, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] as string[] }]));
  for (const f of fx) {
    const h = t.get(f.home_id)!, a = t.get(f.away_id)!;
    h.p++; a.p++;
    h.gf += f.home_goals; h.ga += f.away_goals; a.gf += f.away_goals; a.ga += f.home_goals;
    if (f.home_goals > f.away_goals) { h.w++; a.l++; h.pts += 3; h.form.push('W'); a.form.push('L'); }
    else if (f.home_goals < f.away_goals) { a.w++; h.l++; a.pts += 3; a.form.push('W'); h.form.push('L'); }
    else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D'); }
  }
  return [...t.values()]
    .map((c) => ({ ...c, form: c.form.slice(-5) }))
    .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.name.localeCompare(b.name));
}

export async function leaders(leagueId: number) {
  const base = `SELECT s.*, p.name, p.pos, c.name AS club, c.color1 FROM pstats s JOIN players p ON p.id=s.player_id JOIN clubs c ON c.id=s.club_id WHERE s.league_id=$1`;
  const [goals, assists, cs, rating] = await Promise.all([
    q(`${base} AND s.goals>0 ORDER BY s.goals DESC, s.apps LIMIT 10`, [leagueId]),
    q(`${base} AND s.assists>0 ORDER BY s.assists DESC, s.apps LIMIT 10`, [leagueId]),
    q(`${base} AND s.clean_sheets>0 AND p.pos='GK' ORDER BY s.clean_sheets DESC LIMIT 10`, [leagueId]),
    q(`${base} AND s.apps>=3 ORDER BY s.rating_sum/s.apps DESC LIMIT 10`, [leagueId]),
  ]);
  return { goals, assists, cleanSheets: cs, rating };
}

// ---------------------------------------------------------------- transfer market
export async function windowFor(l: Row) {
  const r = await one<{ played: number; total: number }>(
    `SELECT COALESCE(MAX(matchday) FILTER (WHERE md_done),0)::int AS played, COALESCE(MAX(matchday),0)::int AS total FROM (
       SELECT matchday, bool_and(status='done') AS md_done FROM fixtures WHERE league_id=$1 GROUP BY matchday) x`,
    [l.id],
  );
  return windowState(r?.played ?? 0, r?.total ?? 0, l.status);
}

async function botListings(l: Row) {
  const bots = await q('SELECT id FROM clubs WHERE league_id=$1 AND user_id IS NULL', [l.id]);
  for (const b of bots) {
    const sq = await q(`SELECT p.id, p.ovr, p.attrs FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND p.pos<>'GK' ORDER BY p.ovr DESC`, [b.id]);
    const r = rng(hashSeed('list', l.id, b.id, Date.now() >> 20));
    if (sq.length <= 16 || r.next() < 0.4) continue;
    const p = sq[Math.floor(sq.length * (0.3 + r.next() * 0.6))];
    const price = Math.max(0.5, Math.round(((p.attrs.v ?? 3) * (1 + r.next() * 0.3)) * 10) / 10);
    await q('INSERT INTO listings (league_id, player_id, seller_id, price) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [l.id, p.id, b.id, price]);
  }
}

export async function market(leagueId: number) {
  return q(
    `SELECT li.id AS listing_id, li.price, li.created_at, li.seller_id, c.name AS seller, c.user_id IS NULL AS bot, p.*
     FROM listings li JOIN players p ON p.id=li.player_id JOIN clubs c ON c.id=li.seller_id WHERE li.league_id=$1 ORDER BY p.ovr DESC`,
    [leagueId],
  );
}

export async function listPlayer(uid: number, leagueId: number, playerId: string, price: number) {
  const l = await getLeague(leagueId);
  if (!(await windowFor(l)).open) fail(400, 'The transfer window is closed.');
  const club = await myClub(uid, leagueId);
  const own = await one('SELECT 1 FROM squad WHERE club_id=$1 AND player_id=$2', [club.id, playerId]);
  if (!own) fail(400, 'That player is not in your squad.');
  const pr = Math.round(Number(price) * 10) / 10;
  if (!(pr >= 0.1 && pr <= 500)) fail(400, 'Price must be between 0.1M and 500M.');
  await q(
    `INSERT INTO listings (league_id, player_id, seller_id, price) VALUES ($1,$2,$3,$4) ON CONFLICT (league_id, player_id) DO UPDATE SET price=$4`,
    [leagueId, playerId, club.id, pr],
  );
  return { ok: true };
}

export async function unlist(uid: number, leagueId: number, listingId: number) {
  const club = await myClub(uid, leagueId);
  await q('DELETE FROM listings WHERE id=$1 AND seller_id=$2', [listingId, club.id]);
  return { ok: true };
}

export async function buy(uid: number, leagueId: number, listingId: number) {
  const l = await getLeague(leagueId);
  if (!(await windowFor(l)).open) fail(400, 'The transfer window is closed.');
  const club = await myClub(uid, leagueId);
  const li = await one('SELECT * FROM listings WHERE id=$1 AND league_id=$2', [listingId, leagueId]);
  if (!li) fail(404, 'This player was already sold.');
  if (li.seller_id === club.id) fail(400, 'That is your own player.');
  const [{ n }] = await q<{ n: number }>('SELECT COUNT(*)::int AS n FROM squad WHERE club_id=$1', [club.id]);
  if (n >= MAX_SQUAD) fail(400, `Your squad is full (${MAX_SQUAD}).`);
  const seller = await one('SELECT id, user_id FROM clubs WHERE id=$1', [li.seller_id]);
  if (seller && seller.user_id) {
    const [{ m }] = await q<{ m: number }>('SELECT COUNT(*)::int AS m FROM squad WHERE club_id=$1', [li.seller_id]);
    if (m <= MIN_SQUAD) fail(400, 'The seller would drop below the minimum squad, so this sale is blocked.');
  }
  const del = await q('DELETE FROM listings WHERE id=$1 RETURNING id', [listingId]);
  if (!del[0]) fail(404, 'This player was already sold.');
  const paid = await q('UPDATE clubs SET money = money - $1 WHERE id=$2 AND money >= $1 RETURNING money', [li.price, club.id]);
  if (!paid[0]) {
    await q('INSERT INTO listings (league_id, player_id, seller_id, price) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [leagueId, li.player_id, li.seller_id, li.price]);
    fail(400, 'Not enough money.');
  }
  await q('UPDATE clubs SET money = money + $1 WHERE id=$2', [li.price, li.seller_id]);
  await q('UPDATE squad SET club_id=$1, fitness=100 WHERE league_id=$2 AND player_id=$3', [club.id, leagueId, li.player_id]);
  const p = await one('SELECT name FROM players WHERE id=$1', [li.player_id]);
  await news(leagueId, club.id, 'transfer', `${club.name} sign ${p?.name} for ${Number(li.price).toFixed(1)}M.`);
  return { ok: true };
}

// Testing helper for the league owner: bring the next matchday forward to now.
export async function playNow(uid: number, leagueId: number) {
  const l = await getLeague(leagueId);
  if (l.owner_id !== uid) fail(403, 'Only the league creator can do this.');
  if (l.status !== 'running') fail(400, 'The league is not running.');
  const next = await one<{ md: number; at: string }>(`SELECT MIN(matchday)::int AS md, MIN(kickoff_at) AS at FROM fixtures WHERE league_id=$1 AND status='scheduled'`, [leagueId]);
  if (!next?.md) fail(400, 'No matches left.');
  // only this matchday moves to now; the rest keeps the league's schedule
  await q(`UPDATE fixtures SET kickoff_at = now() - interval '1 second' WHERE league_id=$1 AND matchday=$2 AND status='scheduled'`, [leagueId, next.md]);
  await runDue(leagueId);
  return { ok: true, matchday: next.md };
}

// League owner changes the match time (e.g. every day at 18:00). Unplayed matchdays move to the new slots.
export async function updateSchedule(uid: number, leagueId: number, b: { interval?: number; kickoffUtcMin?: number }) {
  const l = await getLeague(leagueId);
  if (l.owner_id !== uid) fail(403, 'Only the league creator can change the schedule.');
  const interval = INTERVALS[Number(b.interval)] ? Number(b.interval) : l.interval_min;
  const kick = b.kickoffUtcMin == null ? l.kickoff_utc_min : Math.max(0, Math.min(1439, Math.floor(Number(b.kickoffUtcMin))));
  await q('UPDATE leagues SET interval_min=$2, kickoff_utc_min=$3 WHERE id=$1', [leagueId, interval, kick]);
  if (l.status !== 'running') return { ok: true };
  const nl = { ...l, interval_min: interval, kickoff_utc_min: kick };
  const mds = await q<{ md: number }>(`SELECT DISTINCT matchday AS md FROM fixtures WHERE league_id=$1 AND status='scheduled' ORDER BY matchday`, [leagueId]);
  const total = await one<{ md: number }>('SELECT MAX(matchday)::int AS md FROM fixtures WHERE league_id=$1', [leagueId]);
  const half = (total?.md ?? 0) / 2;
  const step = interval * 60_000;
  let at = nextKick(nl, new Date());
  for (const { md } of mds) {
    if (md === half + 1 && mds[0].md !== md) at = new Date(at.getTime() + step); // keep the mid-season break
    await q(`UPDATE fixtures SET kickoff_at=$3 WHERE league_id=$1 AND matchday=$2 AND status='scheduled'`, [leagueId, md, at.toISOString()]);
    at = new Date(at.getTime() + step);
  }
  await news(leagueId, null, 'schedule', 'The league creator changed the match schedule.');
  return { ok: true };
}
