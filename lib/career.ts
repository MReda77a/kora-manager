// Seasons that follow each other: the end-of-season ceremony (titles, promotion and relegation,
// awards, reputation, history) and the roll-over into a new season (aging, retirement,
// youth intake, loans returning, prize money and a fresh schedule).
import { batch, q, one, writes, type Row } from './db.ts';
import { notify, notifyMany } from './push.ts';
import { wakeTimer } from './wake.ts';
import { abroadMarket } from './transfers.ts';
import { fail } from './errors.ts';
import { CLUB_TYPES, LINE, MAX_SQUAD, SPONSORS, WINDOW_DAYS, type ClubTypeKey } from './game.ts';
import { getLeague, news, standings } from './league.ts';
import { youthPlayer, type RawPlayer } from './academy.ts';
import { hashSeed, rng } from './rng.ts';
import { inbox } from './people.ts';

export const DIVISION_NAMES = ['Premier Division', 'First Division', 'Second Division'];
export const divisionName = (d: number) => DIVISION_NAMES[d - 1] || `Division ${d}`;
// how many clubs go up and down between two divisions
export const movers = (clubsPerDivision: number) => (clubsPerDivision >= 12 ? 3 : clubsPerDivision >= 8 ? 2 : 1);

const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

// ---------------------------------------------------------------- season end
// Every write is collected and sent in one request: Cloudflare allows about 50 outgoing requests per visit.
export async function endSeason(l: Row) {
  const done = await q(`UPDATE leagues SET status='finished' WHERE id=$1 AND status='running' RETURNING id`, [l.id]);
  if (!done[0]) return;
  const w = writes();
  const trophy = (clubId: number, userId: number | null, kind: string, label: string) =>
    w.add('INSERT INTO trophies (league_id, club_id, user_id, season, kind, label) VALUES ($1,$2,$3,$4,$5,$6)', [l.id, clubId, userId, l.season, kind, label]);
  const rep = (userId: number | null, n: number) => { if (userId) w.add('UPDATE users SET reputation=GREATEST(0, reputation+$1) WHERE id=$2', [n, userId]); };
  const say = (clubId: number | null, kind: string, text: string) => w.add('INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,$3,$4)', [l.id, clubId, kind, text]);
  const D = l.divisions || 1;
  const P = movers(l.max_clubs);
  const tables: { d: number; name: string; table: any[] }[] = [];
  const up: number[] = [], down: number[] = [];
  const humans = new Map((await q('SELECT id, club_type, sponsor, user_id FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL', [l.id])).map((c) => [c.id, c]));
  const positions: { id: number; pos: number }[] = [];
  for (let d = 1; d <= D; d++) {
    const table = await standings(l.id, d);
    tables.push({ d, name: divisionName(d), table: table.map((t, i) => ({ pos: i + 1, id: t.id, name: t.name, user: !!t.user_id, color1: t.color1, p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga, pts: t.pts })) });
    const champ = table[0];
    if (champ) {
      if (d === 1) { trophy(champ.id, champ.user_id, 'league', `${l.name} champions`); rep(champ.user_id, 50); say(champ.id, 'champion', `${champ.name} are the champions of ${l.name}!`); }
      else { trophy(champ.id, champ.user_id, 'division', `${divisionName(d)} winners`); rep(champ.user_id, 25); say(champ.id, 'champion', `${champ.name} win the ${divisionName(d)}!`); }
    }
    if (d > 1) for (const t of table.slice(0, P)) {
      up.push(t.id); trophy(t.id, t.user_id, 'promotion', `Promoted from the ${divisionName(d)}`); rep(t.user_id, 30);
      say(t.id, 'promotion', `${t.name} are promoted to the ${divisionName(d - 1)}!`);
    }
    if (d < D) for (const t of table.slice(-P)) {
      down.push(t.id); rep(t.user_id, -20); say(t.id, 'relegation', `${t.name} are relegated to the ${divisionName(d + 1)}.`);
    }
    // board verdicts and sponsor targets, judged on the club's own division
    for (const [i, c] of table.entries()) {
      positions.push({ id: c.id, pos: i + 1 });
      const club = humans.get(c.id);
      if (!club) continue;
      const target = CLUB_TYPES[club.club_type as ClubTypeKey].targetPos(table.length);
      if (club.sponsor === 'target' && i + 1 <= target) {
        w.add('UPDATE clubs SET money=money+$1 WHERE id=$2', [SPONSORS.target.bonus, c.id]);
        say(c.id, 'inbox', `💼 You hit the sponsor target: +${SPONSORS.target.bonus}M bonus.`);
      }
      say(c.id, 'inbox', i + 1 <= target ? `🏛️ The board is delighted: ${ord(i + 1)} place met the target (top ${target}).` : `🏛️ The board expected top ${target}. You finished ${ord(i + 1)}.`);
    }
  }
  w.add(`UPDATE clubs c SET prev_pos=x.pos FROM jsonb_to_recordset($1::jsonb) AS x(id int, pos int) WHERE c.id=x.id`, [JSON.stringify(positions)]);
  const cupRow = await one(`SELECT data FROM papers WHERE league_id=$1 AND day=0 AND kind='cup'`, [l.id]);
  const cup = cupRow?.data as { name: string; winner?: number } | undefined;
  const cupClub = cup?.winner ? await one('SELECT id, user_id, name FROM clubs WHERE id=$1', [cup.winner]) : null;
  if (cupClub) { trophy(cupClub.id, cupClub.user_id, 'cup', `${cup!.name} winners`); rep(cupClub.user_id, 30); }
  const awards = await seasonAwards(l, tables);
  for (const a of awards) if (a.clubId) trophy(a.clubId, a.userId ?? null, 'award', `${a.title}: ${a.name}`);
  const mgr = awards.find((a) => a.title === 'Manager of the Season');
  if (mgr) rep(mgr.userId ?? null, 20);
  w.add(
    `INSERT INTO history (league_id, season, data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (league_id, season) DO UPDATE SET data=EXCLUDED.data`,
    [l.id, l.season, JSON.stringify({ season: l.season, divisions: tables, cup: cup ? { name: cup.name, winner: cupClub?.name ?? null } : null, awards, up, down })],
  );
  say(null, 'season', `Season ${l.season} is over! The league creator can start season ${l.season + 1} from the Home tab.`);
  await w.flush();
  for (const c of humans.values()) await notify(c.user_id, { title: '🏁 Season over', body: `Season ${l.season} is over. See where you finished, the awards and your trophy cabinet.`, url: `/l/${l.id}?tab=history` });
}

async function seasonAwards(l: Row, tables: { d: number; table: any[] }[]) {
  const base = `SELECT s.*, p.name, p.pos, p.age + COALESCE(sq.age_add, 0) AS age, c.name AS club, c.user_id FROM pstats s JOIN players p ON p.id=s.player_id
    JOIN clubs c ON c.id=s.club_id LEFT JOIN squad sq ON sq.league_id=s.league_id AND sq.player_id=s.player_id WHERE s.league_id=$1`;
  const minApps = Math.max(3, Math.floor((l.max_clubs - 1) * 0.6));
  const [boot, best, young, gk, assists] = await Promise.all([
    one(`${base} AND s.goals>0 ORDER BY s.goals DESC, s.apps LIMIT 1`, [l.id]),
    one(`${base} AND s.apps>=$2 ORDER BY s.rating_sum/s.apps DESC LIMIT 1`, [l.id, minApps]),
    one(`${base} AND s.apps>=$2 AND p.age + COALESCE(sq.age_add, 0) <= 21 ORDER BY s.rating_sum/s.apps DESC LIMIT 1`, [l.id, minApps]),
    one(`${base} AND p.pos='GK' ORDER BY s.clean_sheets DESC, s.rating_sum/GREATEST(1,s.apps) DESC LIMIT 1`, [l.id]),
    one(`${base} AND s.assists>0 ORDER BY s.assists DESC, s.apps LIMIT 1`, [l.id]),
  ]);
  const out: { title: string; name: string; club: string; clubId: number; userId?: number | null; value: string }[] = [];
  const add = (title: string, p: Row | null, value: (p: Row) => string) => {
    if (p) out.push({ title, name: p.name, club: p.club, clubId: p.club_id, userId: p.user_id, value: value(p) });
  };
  add('Golden Boot', boot, (p) => `${p.goals} goals`);
  add('Player of the Season', best, (p) => `${(p.rating_sum / p.apps).toFixed(2)} avg rating`);
  add('Young Player of the Season', young, (p) => `${(p.rating_sum / p.apps).toFixed(2)} avg rating, age ${p.age}`);
  add('Golden Glove', gk, (p) => `${p.clean_sheets} clean sheets`);
  add('Playmaker Award', assists, (p) => `${p.assists} assists`);
  // manager of the season: the human manager with the best points per game (top flight counts 25% more)
  let mgr: any = null;
  for (const t of tables) for (const c of t.table) {
    if (!c.user || !c.p) continue;
    const score = (c.pts / c.p) * (t.d === 1 ? 1.25 : 1);
    if (!mgr || score > mgr.score) mgr = { ...c, score };
  }
  if (mgr) {
    const u = await one('SELECT u.id, u.username FROM clubs c JOIN users u ON u.id=c.user_id WHERE c.id=$1', [mgr.id]);
    out.push({ title: 'Manager of the Season', name: u?.username || 'Manager', club: mgr.name, clubId: mgr.id, userId: u?.id, value: `${mgr.pts} pts in ${mgr.p} games` });
  }
  return out;
}

// ---------------------------------------------------------------- the next season
export async function startNextSeason(uid: number, leagueId: number, schedule: (l: Row) => Promise<void>) {
  const l = await getLeague(leagueId);
  if (l.owner_id !== uid) fail(403, 'Only the league creator can start the next season.');
  // 'scheduling': the club changes are done but the fixtures could not be made last time; just make them
  if (l.status === 'scheduling') return finishRollover(l, schedule);
  if (l.status !== 'finished') fail(400, 'The season is not over yet.');
  const claim = await q(`UPDATE leagues SET status='rolling' WHERE id=$1 AND status='finished' RETURNING id`, [leagueId]);
  if (!claim[0]) fail(400, 'The new season is already being prepared.');
  try {
    await rollClubs(l);
  } catch (e) {
    await q(`UPDATE leagues SET status='finished' WHERE id=$1 AND status='rolling'`, [l.id]);
    throw e;
  }
  return finishRollover(l, schedule);
}

async function finishRollover(l: Row, schedule: (l: Row) => Promise<void>) {
  const fresh = await getLeague(l.id);
  const next = { ...fresh, season: fresh.season + 1 };
  await batch([`DELETE FROM fixtures WHERE league_id=${Number(l.id)}`, `DELETE FROM days WHERE league_id=${Number(l.id)}`, `DELETE FROM papers WHERE league_id=${Number(l.id)}`]);
  await schedule(next);
  await wakeTimer();
  await abroadMarket({ ...next, status: 'running' }, 1);
  await batch([
    { text: `UPDATE leagues SET status='running', season=season+1 WHERE id=$1`, params: [l.id] },
    { text: `INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,NULL,'season',$2)`, params: [l.id, `Season ${next.season} begins!`] },
    { text: `INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,NULL,'round',$2)`, params: [l.id, '🏁 The first round has started! Every team plays every other team once.'] },
    { text: `INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,NULL,'window',$2)`, params: [l.id, `🔓 The transfer window is OPEN for ${WINDOW_DAYS} days, then it shuts.`] },
  ]);
  const humans = await q('SELECT user_id FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL', [l.id]);
  await notifyMany(humans.map((h) => h.user_id), { title: `⚽ Season ${next.season} is here`, body: `The first round starts. The transfer window is open for ${WINDOW_DAYS} days.`, url: `/l/${l.id}` });
  return { ok: true };
}

// Everything that changes between seasons, worked out in memory and written in ONE request:
// promotion and relegation, club records, loans ending, aging, retirements, youth intake,
// AI clubs topping up, prize money and a fresh sponsor choice.
async function rollClubs(l: Row) {
  const [hist, clubs, rows, tpl] = await Promise.all([
    one('SELECT data FROM history WHERE league_id=$1 AND season=$2', [l.id, l.season]),
    q('SELECT * FROM clubs WHERE league_id=$1', [l.id]),
    q(`SELECT s.player_id, s.club_id, s.ovr_delta, s.age_add, s.loan_from, p.age, p.ovr, p.pot, p.pos, p.name FROM squad s JOIN players p ON p.id=s.player_id WHERE s.league_id=$1`, [l.id]),
    q(`SELECT * FROM players WHERE pool=$1 AND ovr BETWEEN 62 AND 78`, [l.pool]),
  ]);
  const club = new Map(clubs.map((c) => [c.id, c]));
  const w = writes();
  const inboxMsg = (clubId: number, text: string) => { if (club.get(clubId)?.user_id) w.add(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,'inbox',$3)`, [l.id, clubId, text]); };
  const moves = hist?.data || { up: [], down: [] };
  if (moves.up?.length) w.add('UPDATE clubs SET division=division-1 WHERE league_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb)::int)', [l.id, JSON.stringify(moves.up)]);
  if (moves.down?.length) w.add('UPDATE clubs SET division=division+1 WHERE league_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb)::int)', [l.id, JSON.stringify(moves.down)]);
  // club records: this season's stats join each player's career at the club
  w.add(
    `INSERT INTO career (league_id, club_id, player_id, apps, goals, assists, seasons)
     SELECT league_id, club_id, player_id, apps, goals, assists, 1 FROM pstats WHERE league_id=$1
     ON CONFLICT (league_id, club_id, player_id) DO UPDATE SET apps=career.apps+EXCLUDED.apps, goals=career.goals+EXCLUDED.goals,
       assists=career.assists+EXCLUDED.assists, seasons=career.seasons+1`,
    [l.id],
  );
  w.add('DELETE FROM pstats WHERE league_id=$1', [l.id]);
  // loans end
  for (const x of rows.filter((r) => r.loan_from)) { inboxMsg(x.loan_from, `🔁 ${x.name} is back from his loan.`); x.club_id = x.loan_from; }
  w.add(`UPDATE squad SET club_id=loan_from, loan_from=NULL WHERE league_id=$1 AND loan_from IS NOT NULL`, [l.id]);

  // aging and retirement
  const upd: { id: string; d: number; a: number }[] = [];
  const gone: string[] = [];
  const keep: Row[] = [];
  for (const x of rows) {
    const r = rng(hashSeed('age', l.id, l.season, x.player_id));
    const age = x.age + x.age_add + 1;
    const now = x.ovr + x.ovr_delta;
    let d = 0;
    if (age <= 23) d = Math.round((1 + r.next() * 3) * (club.get(x.club_id)?.club_type === 'academy' ? 1.5 : 1));
    else if (age <= 27) d = r.next() < 0.5 ? 1 : 0;
    else if (age <= 30) d = 0;
    else if (age <= 32) d = -Math.round(r.next() * 2);
    else d = -(1 + Math.round(r.next() * 2));
    if (d > 0) d = Math.max(0, Math.min(d, x.pot - now));
    const retireChance = age >= 37 ? 1 : age >= 35 ? 0.5 : age >= 34 ? 0.15 : 0;
    if (r.next() < retireChance) {
      gone.push(x.player_id);
      inboxMsg(x.club_id, `👋 ${x.name} (${age}) has retired. Thank you for everything.`);
      if (now >= 80) w.add(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,'retire',$3)`, [l.id, x.club_id, `End of an era: ${x.name} retires at ${age}.`]);
      continue;
    }
    upd.push({ id: x.player_id, d: x.ovr_delta + d, a: x.age_add + 1 });
    keep.push({ ...x, ovr: now + d });
  }
  if (upd.length) w.add(`UPDATE squad s SET ovr_delta=x.d, age_add=x.a FROM jsonb_to_recordset($1::jsonb) AS x(id text, d int, a int) WHERE s.league_id=$2 AND s.player_id=x.id`, [JSON.stringify(upd), l.id]);
  if (gone.length) {
    const ids = JSON.stringify(gone);
    w.add('DELETE FROM squad WHERE league_id=$1 AND player_id IN (SELECT jsonb_array_elements_text($2::jsonb))', [l.id, ids]);
    w.add('DELETE FROM training WHERE league_id=$1 AND player_id IN (SELECT jsonb_array_elements_text($2::jsonb))', [l.id, ids]);
    w.add('INSERT INTO retired (league_id, player_id) SELECT $1, jsonb_array_elements_text($2::jsonb) ON CONFLICT DO NOTHING', [l.id, ids]);
  }

  // youth intake: 2 graduates (3 at Academy clubs) where each squad is thinnest
  const bySquad = new Map<number, Row[]>();
  for (const x of keep) (bySquad.get(x.club_id) || bySquad.set(x.club_id, []).get(x.club_id)!).push(x);
  const want: Record<string, number> = { GK: 2.5, DEF: 7, MID: 7, FWD: 4.5 };
  const youth: Row[] = [], joins: { p: string; c: number }[] = [];
  for (const c of clubs) {
    const sq = bySquad.get(c.id) || [];
    const room = MAX_SQUAD - sq.length;
    if (room <= 0) { inboxMsg(c.id, `🎓 Your squad is full (${MAX_SQUAD}), so this year's academy graduates joined other clubs.`); continue; }
    const count: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of sq) count[LINE[p.pos] || 'MID']++;
    const names: string[] = [];
    for (let k = 0; k < Math.min(c.club_type === 'academy' ? 3 : 2, room); k++) {
      const line = Object.keys(want).sort((a, b) => count[a] / want[a] - count[b] / want[b])[0];
      count[line]++;
      const pool = (tpl as RawPlayer[]).filter((p) => (LINE[p.pos] || 'MID') === line);
      const id = `Y${l.id}-${l.season + 1}-${c.id}-${k + 1}`;
      const y = youthPlayer(l.pool, id, hashSeed('youth', id), line, pool.length ? pool : (tpl as RawPlayer[]), c.club_type === 'academy' ? 4 : 0);
      youth.push({ ...y, pool: `Y${l.id}` });
      joins.push({ p: y.id, c: c.id });
      sq.push({ pos: y.pos, ovr: y.ovr });
      names.push(`${y.name} (${y.pos}, ${y.ovr}, potential ${y.pot})`);
    }
    bySquad.set(c.id, sq);
    if (names.length) inboxMsg(c.id, `🎓 Youth intake: ${names.join(', ')} join from the academy.`);
  }

  // AI clubs that lost players sign free agents of a similar level to stay at 18+
  const taken = new Set([...keep.map((x) => x.player_id), ...youth.map((y) => y.id)]);
  const needy = clubs.filter((c) => !c.user_id && (bySquad.get(c.id)?.length || 0) < 18);
  if (needy.length) {
    const free = await q(
      `SELECT p.id, p.pos, p.ovr FROM players p WHERE p.pool=$1 AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id)
         AND NOT EXISTS (SELECT 1 FROM retired r WHERE r.league_id=$2 AND r.player_id=p.id) ORDER BY p.ovr DESC`,
      [l.pool, l.id],
    );
    for (const c of needy) {
      const sq = bySquad.get(c.id) || [];
      const avg = sq.reduce((a, p) => a + p.ovr, 0) / Math.max(1, sq.length);
      let g = sq.filter((p) => p.pos === 'GK').length, need = 18 - sq.length;
      for (const p of [...free].sort((a, b) => Math.abs(a.ovr - avg) - Math.abs(b.ovr - avg))) {
        if (need <= 0) break;
        if (taken.has(p.id) || (p.pos === 'GK' && g >= 2) || (p.pos !== 'GK' && g < 2 && need <= 2 - g)) continue;
        taken.add(p.id); joins.push({ p: p.id, c: c.id }); need--;
        if (p.pos === 'GK') g++;
      }
    }
  }
  if (youth.length) {
    w.add(
      `INSERT INTO players (id, name, pool, nat, pos, foot, age, height, ovr, pot, attrs)
       SELECT x.id, x.name, x.pool, x.nat, x.pos, x.foot, x.age, x.height, x.ovr, x.pot, x.attrs FROM jsonb_to_recordset($1::jsonb)
         AS x(id text, name text, pool text, nat text, pos text, foot text, age int, height int, ovr int, pot int, attrs jsonb) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(youth)],
    );
  }
  if (joins.length) w.add(`INSERT INTO squad (league_id, player_id, club_id) SELECT $1, x.p, x.c FROM jsonb_to_recordset($2::jsonb) AS x(p text, c int) ON CONFLICT DO NOTHING`, [l.id, JSON.stringify(joins)]);

  // prize money by final position, 300 coins, a fresh sponsor choice, board patience restored
  const prizes = clubs.map((c) => {
    const pos = c.prev_pos || l.max_clubs;
    const prize = Math.max(1, (l.max_clubs - pos + 1) * (c.division === 1 ? 0.8 : c.division === 2 ? 0.5 : 0.3));
    inboxMsg(c.id, `💰 Season ${l.season} prize money: ${prize.toFixed(1)}M, plus 300 coins for the new season.`);
    return { id: c.id, prize: Math.round(prize * 100) / 100 };
  });
  w.add(`UPDATE clubs c SET money=c.money+x.prize, coins=c.coins+300, sponsor=NULL, board=60 FROM jsonb_to_recordset($1::jsonb) AS x(id int, prize numeric) WHERE c.id=x.id`, [JSON.stringify(prizes)]);
  w.add(`UPDATE squad SET fitness=100, out_until=0, out_reason=NULL, form_mod=0, form_until=0, form_note=NULL,
           morale=70 + (morale-70)/2, promise_day=0, talk_day=0 WHERE league_id=$1`, [l.id]);
  for (const t of ['comments', 'listings']) w.add(`DELETE FROM ${t} WHERE league_id=$1`, [l.id]);
  w.add(`UPDATE offers SET status='expired', updated_at=now() WHERE league_id=$1 AND status IN ('pending','countered')`, [l.id]);
  // from here on only the new fixtures are missing
  w.add(`UPDATE leagues SET status='scheduling' WHERE id=$1`, [l.id]);
  await w.flush();
}

// ---------------------------------------------------------------- views
export async function historyView(leagueId: number) {
  const seasons = await q('SELECT season, data FROM history WHERE league_id=$1 ORDER BY season DESC', [leagueId]);
  const trophies = await q(
    `SELECT t.*, c.name AS club, c.color1, u.username FROM trophies t JOIN clubs c ON c.id=t.club_id LEFT JOIN users u ON u.id=t.user_id
     WHERE t.league_id=$1 ORDER BY t.season DESC, t.id`,
    [leagueId],
  );
  // legends: the best club careers in this league
  const legends = await q(
    `SELECT k.*, p.name, p.pos, c.name AS club, c.color1, EXISTS (SELECT 1 FROM retired r WHERE r.league_id=k.league_id AND r.player_id=k.player_id) AS retired
     FROM career k JOIN players p ON p.id=k.player_id JOIN clubs c ON c.id=k.club_id
     WHERE k.league_id=$1 ORDER BY (k.goals * 2 + k.assists + k.apps * 0.5) DESC LIMIT 12`,
    [leagueId],
  );
  return { seasons: seasons.map((s) => s.data), trophies, legends };
}

export async function rankingView() {
  return q(
    `SELECT u.username, u.reputation,
       (SELECT COUNT(*)::int FROM trophies t WHERE t.user_id=u.id AND t.kind IN ('league','division','cup')) AS titles
     FROM users u ORDER BY u.reputation DESC, u.id LIMIT 50`,
  );
}
