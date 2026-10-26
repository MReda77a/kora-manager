// Leagues, clubs, packs, squads, line-ups, tables and the transfer market.
// The season clock (fixtures, live matches, cup, papers) lives in season.ts.
import { q, one, type Row } from './db.ts';
import { fail } from './errors.ts';
import {
  CLUB_TYPES, CORNER_ROUTINES, DEFAULT_TACTIC, FORMATIONS, LINE, MAX_SQUAD, MIN_SQUAD, PACKS, PATTERNS, POOLS, ROLES, STAFF_PACK,
  shortName, type ClubTypeKey, type PackKey, type Tactic,
  windowFromDays,
} from './game.ts';
import { rng, hashSeed } from './rng.ts';

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

export async function createLeague(uid: number, b: { name: string; pool: string; maxClubs: number; aiLevel: number; kickoffUtcMin?: number; divisions?: number; startDivision?: string }) {
  const name = String(b.name || '').trim().slice(0, 40);
  if (name.length < 3) fail(400, 'League name needs at least 3 letters.');
  if (!POOLS[b.pool]) fail(400, 'Pick a league pool.');
  const cap = await maxClubsFor(b.pool);
  const divisions = Math.max(1, Math.min(3, Math.floor(Number(b.divisions) || 1)));
  const maxClubs = Math.max(4, Math.min(Math.floor(cap / divisions), Math.floor(Number(b.maxClubs) || 10)));
  if (divisions > 1 && Math.floor(cap / divisions) < 6) fail(400, `This pool is too small for ${divisions} divisions. Try fewer divisions.`);
  const startDivision = b.startDivision === 'top' ? 'top' : 'bottom';
  const aiLevel = [0, 1, 2].includes(Number(b.aiLevel)) ? Number(b.aiLevel) : 2;
  const kick = Math.max(0, Math.min(1439, Math.floor(Number(b.kickoffUtcMin ?? 900))));
  for (let i = 0; i < 5; i++) {
    const r = await q(
      `INSERT INTO leagues (name, code, owner_id, pool, max_clubs, ai_level, interval_min, kickoff_utc_min, divisions, start_division)
       VALUES ($1,$2,$3,$4,$5,$6,1440,$7,$8,$9) ON CONFLICT (code) DO NOTHING RETURNING id, code`,
      [name, code(), uid, b.pool, maxClubs, aiLevel, kick, divisions, startDivision],
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
  // leagues with my club, plus leagues I created but have not made a club in yet
  return q(
    `SELECT l.id, l.name, l.code, l.pool, l.status, l.season, l.divisions, l.max_clubs * l.divisions AS max_clubs, l.owner_id = $1 AS owner,
       c.id AS club_id, c.name AS club_name, c.color1, c.color2, c.short, c.shape, c.emblem, c.division,
       (SELECT COUNT(*)::int FROM clubs x WHERE x.league_id=l.id) AS clubs,
       (SELECT COUNT(*)::int FROM clubs x WHERE x.league_id=l.id AND x.user_id IS NOT NULL) AS humans
     FROM leagues l LEFT JOIN clubs c ON c.league_id=l.id AND c.user_id=$1
     WHERE c.id IS NOT NULL OR l.owner_id=$1 ORDER BY l.created_at DESC`,
    [uid],
  );
}

export async function myClub(uid: number, leagueId: number) {
  const c = await one('SELECT * FROM clubs WHERE league_id=$1 AND user_id=$2', [leagueId, uid]);
  if (!c) fail(403, 'You have no club in this league yet.');
  return c;
}

// The schedule time can change before or during the season; unplayed days move to the new time.
export async function updateSchedule(uid: number, leagueId: number, b: { kickoffUtcMin?: number }) {
  const l = await getLeague(leagueId);
  if (l.owner_id !== uid) fail(403, 'Only the league creator can change the match time.');
  const kick = Math.max(0, Math.min(1439, Math.floor(Number(b.kickoffUtcMin))));
  if (!Number.isFinite(kick)) fail(400, 'Pick a time.');
  await q('UPDATE leagues SET kickoff_utc_min=$2 WHERE id=$1', [leagueId, kick]);
  if (l.status === 'running') {
    // move each future day to the new time of day, keeping its date
    await q(
      `UPDATE days SET kickoff_at = date_trunc('day', kickoff_at) + make_interval(mins => $2)
       WHERE league_id=$1 AND kickoff_at > now() + interval '5 minutes'`,
      [leagueId, kick],
    );
    await q(
      `UPDATE fixtures f SET kickoff_at = d.kickoff_at FROM days d
       WHERE f.league_id=$1 AND d.league_id=f.league_id AND d.day=f.day AND f.status='scheduled'`,
      [leagueId],
    );
    await news(leagueId, null, 'schedule', 'The league creator changed the match time.');
  }
  return { ok: true };
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
  const fans = type === 'fan' ? 36000 : type === 'historic' ? 30000 : 22000;
  const r = await q(
    `INSERT INTO clubs (league_id, user_id, name, short, color1, color2, shape, emblem, stadium, club_type, coins, money, tactic, fans, capacity, away1, away2, pattern)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18) RETURNING id`,
    [leagueId, uid, name, short, hex(b.color1, '#E8438C'), hex(b.color2, '#7FE9F7'), Number(b.shape) % 4 || 0, Number(b.emblem) % 6 || 0,
      String(b.stadium || `${name} Park`).trim().slice(0, 32) || `${name} Park`, type, t.coins, t.money, JSON.stringify(DEFAULT_TACTIC), fans, type === 'fan' ? 40000 : 30000,
      hex(b.away1, '#F3EEFF'), hex(b.away2, hex(b.color1, '#E8438C')), Math.abs(Number(b.pattern) || 0) % PATTERNS.length],
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
  let candidates = await q(
    `SELECT p.* FROM (SELECT * FROM players WHERE pool=$1 ORDER BY ovr DESC, id OFFSET $2 LIMIT $3) p
     WHERE NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$4 AND s.player_id=p.id)
       AND NOT EXISTS (SELECT 1 FROM retired r WHERE r.league_id=$4 AND r.player_id=p.id)`,
    [l.pool, lo, Math.max(1, hi - lo), leagueId],
  );
  if (candidates.length < pack.n) {
    candidates = await q(
      `SELECT p.* FROM players p WHERE pool=$1 AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id)
         AND NOT EXISTS (SELECT 1 FROM retired r WHERE r.league_id=$2 AND r.player_id=p.id)
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
  // Squad shape from packs: keepers stop at 2, and until the club has 4 defenders, 3 midfielders
  // and 3 forwards, packs fill those gaps first (from the pack's own band when possible).
  // Gold packs stay fully random (apart from the 2-keeper limit).
  const have = await q<{ line: string; n: number }>(
    `SELECT CASE WHEN p.pos='GK' THEN 'GK' WHEN p.pos IN ('CB','LB','RB') THEN 'DEF' WHEN p.pos IN ('DM','CM','CAM') THEN 'MID' ELSE 'FWD' END AS line, COUNT(*)::int AS n
     FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 GROUP BY 1`, [club.id]);
  const count: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const h of have) count[h.line] = h.n;
  const MIN: Record<string, number> = { GK: 2, DEF: 4, MID: 3, FWD: 3 };
  const lineOf = (p: Row) => LINE[p.pos] || 'MID';
  const avgOvr = Math.round(candidates.reduce((a, p) => a + p.ovr, 0) / Math.max(1, candidates.length));
  const ensureLine = async (line: string) => {
    if (pool.some((p) => lineOf(p) === line)) return;
    const pos = line === 'GK' ? ['GK'] : line === 'DEF' ? ['CB', 'LB', 'RB'] : line === 'MID' ? ['DM', 'CM', 'CAM'] : ['LW', 'RW', 'ST'];
    const near = await one(
      `SELECT p.* FROM players p WHERE pool=$1 AND pos IN (SELECT jsonb_array_elements_text($3::jsonb)) AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id)
         AND NOT EXISTS (SELECT 1 FROM retired r WHERE r.league_id=$2 AND r.player_id=p.id)
       ORDER BY ABS(p.ovr - $4) ASC LIMIT 1`, [l.pool, leagueId, JSON.stringify(pos), avgOvr]);
    if (near) pool.push(near);
  };
  const takeLine = (line: string) => {
    const before = pick.length;
    take((p) => lineOf(p) === line);
    if (pick.length > before) count[line]++;
  };
  if (key !== 'gold') {
    for (const line of ['GK', 'DEF', 'MID', 'FWD']) {
      while (count[line] < MIN[line] && pick.length < pack.n) {
        await ensureLine(line);
        const before = pick.length;
        takeLine(line);
        if (pick.length === before) break;
      }
    }
  }
  // the rest is random, never a third keeper
  while (pick.length < pack.n && pool.length) {
    const before = pick.length;
    take((p) => lineOf(p) !== 'GK' || count.GK < 2);
    if (pick.length === before) break;
    if (lineOf(pick[pick.length - 1]) === 'GK') count.GK++;
  }
  if (pick.length < pack.n) {
    // band ran dry of outfield players: top up from the nearest outfield players
    const extra = await q(
      `SELECT p.* FROM players p WHERE pool=$1 AND pos<>'GK' AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id)
       AND NOT EXISTS (SELECT 1 FROM retired r WHERE r.league_id=$2 AND r.player_id=p.id)
       AND NOT (p.id = ANY(SELECT jsonb_array_elements_text($4::jsonb))) ORDER BY ABS(p.ovr - $3) ASC LIMIT $5`,
      [l.pool, leagueId, avgOvr, JSON.stringify(pick.map((p) => p.id)), pack.n - pick.length]);
    pick.push(...extra);
  }
  const got: Row[] = [];
  for (const p of pick) {
    const r = await q('INSERT INTO squad (league_id, player_id, club_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING player_id', [leagueId, p.id, club.id]);
    if (r[0]) got.push(p);
  }
  if (got.length < pick.length) {
    const refund = Math.round((pack.price * (pick.length - got.length)) / pick.length);
    await q('UPDATE clubs SET coins = coins + $1 WHERE id=$2', [refund, club.id]);
  }
  if (key === 'legend' && got[0]) await news(leagueId, club.id, 'pack', `${club.name} pull a legend: ${got[0].name} (${got[0].ovr})!`);
  return { players: got.map(pub), coins: paid[0].coins };
}

const STAFF_FIRST = ['Omar', 'Karim', 'Hany', 'Sami', 'Nabil', 'Tarek', 'Mark', 'Luis', 'Paolo', 'Jens', 'Pierre', 'Faisal', 'Ryan', 'Diego', 'Hassan'];
const STAFF_LAST = ['Fouad', 'Mansour', 'Reyes', 'Bauer', 'Moreau', 'Rossi', 'Collins', 'Haddad', 'Lopez', 'Weber', 'Saleh', 'Nasser', 'Brennan', 'Costa', 'Yilmaz'];

export async function openStaffPack(uid: number, leagueId: number) {
  const club = await myClub(uid, leagueId);
  const paid = await q('UPDATE clubs SET coins = coins - $1 WHERE id=$2 AND coins >= $1 RETURNING coins', [STAFF_PACK.price, club.id]);
  if (!paid[0]) fail(400, 'Not enough coins for this pack.');
  const roll = Math.random();
  const level = roll < 0.3 ? 1 : roll < 0.6 ? 2 : roll < 0.82 ? 3 : roll < 0.95 ? 4 : 5;
  const roles = ['doctor', 'physio', 'coach'];
  const role = roles[Math.floor(Math.random() * roles.length)];
  const name = `${STAFF_FIRST[Math.floor(Math.random() * STAFF_FIRST.length)]} ${STAFF_LAST[Math.floor(Math.random() * STAFF_LAST.length)]}`;
  const [s] = await q('INSERT INTO staff (league_id, club_id, role, name, level) VALUES ($1,$2,$3,$4,$5) RETURNING *', [leagueId, club.id, role, name, level]);
  if (level >= 4) await news(leagueId, club.id, 'pack', `${club.name} hire a ${level}-star ${role}: ${name}.`);
  return { staff: s, coins: paid[0].coins };
}

export function pub(p: Row) {
  return { id: p.id, name: p.name, pos: p.pos, natPos: p.nat_pos ?? p.pos, ovr: p.ovr, pot: p.pot, age: p.age, nat: p.nat, foot: p.foot, height: p.height, attrs: p.attrs, academy: !!p.attrs?.Academy };
}

// ---------------------------------------------------------------- squads & line-ups
// Players with this league's changes applied: trained skills, new positions and form.
export async function squadOf(clubId: number, day = 0) {
  const rows = await q(
    `SELECT p.*, s.fitness, s.out_until, s.out_reason, s.pos_override, s.boost, s.form_mod, s.form_until, s.form_note,
       s.morale, s.ovr_delta, s.age_add, s.loan_from, s.request, s.talk_day, s.promise_day
     FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1`,
    [clubId],
  );
  return rows.map((p) => applyMods(p, day)).sort(byPosition);
}

const NO_GROW = new Set(['v', 'Academy', 'Youth', 'Consistency', 'BigMatch', 'InjuryProne']);
// Morale moves a player's level a little: 70 is neutral, 100 is +1.5, 0 is -3.5.
export const moraleMod = (m: number) => Math.round(((m ?? 70) - 70) / 20 * 10) / 10;

export function applyMods(p: Row, day: number): Row {
  const attrs = { ...p.attrs };
  const delta = p.ovr_delta || 0; // growth or decline across seasons
  if (delta) for (const k of Object.keys(attrs)) if (typeof attrs[k] === 'number' && !NO_GROW.has(k)) attrs[k] = Math.max(1, Math.min(99, attrs[k] + delta));
  for (const [k, v] of Object.entries((p.boost || {}) as Record<string, number>)) attrs[k] = Math.min(99, (attrs[k] ?? 50) + v);
  const gain = Object.values((p.boost || {}) as Record<string, number>).reduce((a, b) => a + b, 0);
  return {
    ...p, attrs, nat_pos: p.pos, pos: p.pos_override || p.pos,
    age: (p.age || 0) + (p.age_add || 0),
    ovr: Math.max(30, Math.min(99, p.ovr + delta + Math.floor(gain / 4))),
    form: (p.form_until ?? 0) >= day ? p.form_mod || 0 : 0, // awards and press: whole points, shown on cards
    mod: ((p.form_until ?? 0) >= day ? p.form_mod || 0 : 0) + moraleMod(p.morale),
  };
}

const ORDER: Record<string, number> = { GK: 0, CB: 1, LB: 2, RB: 3, DM: 4, CM: 5, CAM: 6, LW: 7, RW: 8, ST: 9 };
const byPosition = (a: Row, b: Row) => (ORDER[a.pos] ?? 9) - (ORDER[b.pos] ?? 9) || b.ovr - a.ovr;

// Best XI for a formation from available players. Respects a saved line-up where possible.
export function pickXI(players: Row[], formation: string, saved: string[], day: number) {
  const slots = (FORMATIONS[formation] || FORMATIONS['4-3-3']).slots;
  const avail = players.filter((p) => (p.out_until ?? 0) < day);
  const used = new Set<string>();
  const xi: (Row | null)[] = slots.map((slot, i) => {
    const p = avail.find((x) => x.id === saved[i]);
    // safety: a keeper never starts outfield and an outfield player never starts in goal
    if (p && (p.pos === 'GK') !== (slot === 'GK')) return null;
    if (p && !used.has(p.id)) {
      used.add(p.id);
      return p;
    }
    return null;
  });
  const score = (p: Row, slot: string) => {
    const line = LINE[p.pos] || 'MID';
    const fit = Math.min(1, (p.fitness ?? 100) / 100);
    return (p.ovr + (p.mod || 0)) * (0.55 + 0.45 * fit) - (line === slot ? 0 : slot === 'GK' || line === 'GK' ? 60 : 9);
  };
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

export async function saveSetup(uid: number, leagueId: number, b: {
  tactic?: Tactic; lineup?: string[]; pens?: string[]; assistant?: Record<string, boolean>;
  plans?: Record<string, Tactic | null>; roles?: Record<string, string>; setpieces?: Record<string, string>;
  kit?: { away1?: string; away2?: string; pattern?: number };
}) {
  const club = await myClub(uid, leagueId);
  const ids = new Set((await q('SELECT player_id FROM squad WHERE club_id=$1', [club.id])).map((r) => r.player_id));
  const sets: string[] = [];
  const params: unknown[] = [];
  if (b.tactic) {
    params.push(JSON.stringify(cleanTactic(b.tactic)));
    sets.push(`tactic=$${params.length}::jsonb`);
  }
  if (b.lineup) {
    if (!Array.isArray(b.lineup) || b.lineup.length > 11) fail(400, 'Bad line-up.');
    params.push(JSON.stringify(b.lineup.map((x) => (x && ids.has(String(x)) ? String(x) : ''))));
    sets.push(`lineup=$${params.length}::jsonb`);
  }
  if (Array.isArray(b.pens)) {
    params.push(JSON.stringify(b.pens.map(String).filter((x) => ids.has(x)).slice(0, 5)));
    sets.push(`pens=$${params.length}::jsonb`);
  }
  if (b.assistant) {
    const a = b.assistant;
    params.push(JSON.stringify({ tired: !!a.tired, cards: !!a.cards, winning: !!a.winning, losing: !!a.losing, injured: a.injured !== false }));
    sets.push(`assistant=$${params.length}::jsonb`);
  }
  if (b.tactic || b.plans) {
    // Plan A is always the starting tactic; B and C are switched to during a match
    const plans: Record<string, Tactic> = { ...(club.plans || {}) };
    if (b.tactic) plans.A = cleanTactic(b.tactic);
    for (const k of ['B', 'C']) {
      if (b.plans && k in b.plans) {
        const t = b.plans[k];
        if (t) plans[k] = cleanTactic(t);
        else delete plans[k];
      }
    }
    params.push(JSON.stringify(plans));
    sets.push(`plans=$${params.length}::jsonb`);
  }
  if (b.roles && typeof b.roles === 'object') {
    const clean: Record<string, string> = {};
    for (const [pid, r] of Object.entries(b.roles)) if (ids.has(pid) && ROLES[r]) clean[pid] = r;
    params.push(JSON.stringify(clean));
    sets.push(`roles=$${params.length}::jsonb`);
  }
  if (b.setpieces && typeof b.setpieces === 'object') {
    const sp = b.setpieces;
    params.push(JSON.stringify({
      corner: ids.has(String(sp.corner)) ? String(sp.corner) : undefined,
      fk: ids.has(String(sp.fk)) ? String(sp.fk) : undefined,
      routine: CORNER_ROUTINES[String(sp.routine)] ? String(sp.routine) : 'far',
    }));
    sets.push(`setpieces=$${params.length}::jsonb`);
  }
  if (b.kit) {
    const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
    if (hex(b.kit.away1)) { params.push(hex(b.kit.away1)); sets.push(`away1=$${params.length}`); }
    if (hex(b.kit.away2)) { params.push(hex(b.kit.away2)); sets.push(`away2=$${params.length}`); }
    if (b.kit.pattern !== undefined) { params.push(Math.abs(Math.floor(Number(b.kit.pattern) || 0)) % PATTERNS.length); sets.push(`pattern=$${params.length}`); }
  }
  if (!sets.length) return { ok: true };
  params.push(club.id);
  await q(`UPDATE clubs SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
  return { ok: true };
}

export function cleanTactic(t: Partial<Tactic>): Tactic {
  const n = (v: unknown, hi: number) => Math.max(0, Math.min(hi, Math.floor(Number(v) || 0)));
  return {
    preset: String(t.preset || 'Custom').slice(0, 20), formation: t.formation && FORMATIONS[t.formation] ? t.formation : '4-3-3',
    mentality: n(t.mentality, 2), press: n(t.press, 3), line: n(t.line, 2), build: n(t.build, 2), focus: n(t.focus, 3), width: n(t.width, 2), tempo: n(t.tempo, 2),
  };
}

export async function checkSquads(leagueId: number) {
  const clubs = await q('SELECT id, name FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL', [leagueId]);
  for (const c of clubs) {
    const sq = await q('SELECT p.pos FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1', [c.id]);
    const gks = sq.filter((p) => p.pos === 'GK').length;
    if (sq.length < MIN_SQUAD || gks < 2) fail(400, `${c.name} needs at least ${MIN_SQUAD} players including 2 goalkeepers (now ${sq.length}, ${gks} GK).`);
  }
  return clubs.length;
}

// ---------------------------------------------------------------- tables
// One division's table (division 1 is the top flight).
export async function standings(leagueId: number, division = 1) {
  const clubs = await q('SELECT id, name, short, color1, color2, shape, emblem, user_id, club_type, division FROM clubs WHERE league_id=$1 AND division=$2', [leagueId, division]);
  const fx = await q(`SELECT home_id, away_id, home_goals, away_goals, matchday FROM fixtures WHERE league_id=$1 AND status='done' AND comp='league' AND division=$2 ORDER BY matchday`, [leagueId, division]);
  const t = new Map<number, any>(clubs.map((c) => [c.id, { ...c, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] as string[] }]));
  for (const f of fx) {
    const h = t.get(f.home_id), a = t.get(f.away_id);
    if (!h || !a) continue;
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
  const base = `SELECT s.*, p.name, p.pos, c.name AS club, c.color1, c.user_id FROM pstats s JOIN players p ON p.id=s.player_id JOIN clubs c ON c.id=s.club_id WHERE s.league_id=$1`;
  const [goals, assists, cs, rating] = await Promise.all([
    q(`${base} AND s.goals>0 ORDER BY s.goals DESC, s.apps LIMIT 10`, [leagueId]),
    q(`${base} AND s.assists>0 ORDER BY s.assists DESC, s.apps LIMIT 10`, [leagueId]),
    q(`${base} AND s.clean_sheets>0 AND p.pos='GK' ORDER BY s.clean_sheets DESC LIMIT 10`, [leagueId]),
    q(`${base} AND s.apps>=3 ORDER BY s.rating_sum/s.apps DESC LIMIT 10`, [leagueId]),
  ]);
  return { goals, assists, cleanSheets: cs, rating };
}

// ---------------------------------------------------------------- transfer market
// Open in pre-season and for 5 days at the start of each round (see windowFromDays).
export async function windowFor(l: Row) {
  if (l.status !== 'running') return windowFromDays(l.status, [], Date.now());
  const days = await q('SELECT day, kind, kickoff_at FROM days WHERE league_id=$1 ORDER BY day', [l.id]);
  return windowFromDays(l.status, days as any, Date.now());
}

// AI clubs put a few squad players up for sale. Two database requests in all (Cloudflare limits requests per visit).
export async function botListings(l: Row) {
  const rows = await q(
    `SELECT s.club_id, p.id, p.ovr, p.attrs->>'v' AS v FROM squad s JOIN players p ON p.id=s.player_id JOIN clubs c ON c.id=s.club_id
     WHERE c.league_id=$1 AND c.user_id IS NULL AND p.pos<>'GK' ORDER BY s.club_id, p.ovr DESC`,
    [l.id],
  );
  const byClub = new Map<number, Row[]>();
  for (const r of rows) (byClub.get(r.club_id) || byClub.set(r.club_id, []).get(r.club_id)!).push(r);
  const add: { p: string; c: number; price: number }[] = [];
  for (const [club, sq] of byClub) {
    const r = rng(hashSeed('list', l.id, club, Date.now() >> 20));
    if (sq.length <= 14 || r.next() < 0.35) continue; // outfield players only
    const p = sq[Math.floor(sq.length * (0.3 + r.next() * 0.6))];
    add.push({ p: p.id, c: club, price: Math.max(0.5, Math.round(((Number(p.v) || 3) * (1 + r.next() * 0.3)) * 10) / 10) });
  }
  if (add.length) {
    await q(
      `INSERT INTO listings (league_id, player_id, seller_id, price) SELECT $1, x.p, x.c, x.price FROM jsonb_to_recordset($2::jsonb) AS x(p text, c int, price numeric) ON CONFLICT DO NOTHING`,
      [l.id, JSON.stringify(add)],
    );
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
  const own = await one('SELECT loan_from FROM squad WHERE club_id=$1 AND player_id=$2', [club.id, playerId]);
  if (!own) fail(400, 'That player is not in your squad.');
  if (own.loan_from) fail(400, 'He is only here on loan.');
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
  await q('UPDATE clubs SET money = money + $1, sales = sales + $1 WHERE id=$2', [li.price, li.seller_id]);
  await q(`UPDATE squad SET club_id=$1, fitness=100 WHERE league_id=$2 AND player_id=$3`, [club.id, leagueId, li.player_id]);
  await q(`DELETE FROM training WHERE league_id=$1 AND player_id=$2 AND done=false`, [leagueId, li.player_id]);
  const p = await one('SELECT name FROM players WHERE id=$1', [li.player_id]);
  await news(leagueId, club.id, 'transfer', `${club.name} sign ${p?.name} for ${Number(li.price).toFixed(1)}M.`);
  return { ok: true };
}
