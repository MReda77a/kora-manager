// Seasons that follow each other: the end-of-season ceremony (titles, promotion and relegation,
// awards, reputation, history) and the roll-over into a new season (aging, retirement,
// youth intake, loans returning, prize money and a fresh schedule).
import { q, one, type Row } from './db.ts';
import { fail } from './errors.ts';
import { CLUB_TYPES, LINE, MAX_SQUAD, SPONSORS, type ClubTypeKey } from './game.ts';
import { getLeague, news, standings } from './league.ts';
import { youthPlayer, type RawPlayer } from './academy.ts';
import { hashSeed, rng } from './rng.ts';
import { inbox } from './people.ts';

export const DIVISION_NAMES = ['Premier Division', 'First Division', 'Second Division'];
export const divisionName = (d: number) => DIVISION_NAMES[d - 1] || `Division ${d}`;
// how many clubs go up and down between two divisions
export const movers = (clubsPerDivision: number) => (clubsPerDivision >= 12 ? 3 : clubsPerDivision >= 8 ? 2 : 1);

const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

async function trophy(l: Row, clubId: number, userId: number | null, kind: string, label: string) {
  await q('INSERT INTO trophies (league_id, club_id, user_id, season, kind, label) VALUES ($1,$2,$3,$4,$5,$6)', [l.id, clubId, userId, l.season, kind, label]);
}
async function rep(userId: number | null, n: number) {
  if (userId) await q('UPDATE users SET reputation=GREATEST(0, reputation+$1) WHERE id=$2', [n, userId]);
}

// ---------------------------------------------------------------- season end
export async function endSeason(l: Row) {
  const done = await q(`UPDATE leagues SET status='finished' WHERE id=$1 AND status='running' RETURNING id`, [l.id]);
  if (!done[0]) return;
  const D = l.divisions || 1;
  const P = movers(l.max_clubs);
  const tables: { d: number; name: string; table: any[] }[] = [];
  const up: number[] = [], down: number[] = [];
  for (let d = 1; d <= D; d++) {
    const table = await standings(l.id, d);
    tables.push({ d, name: divisionName(d), table: table.map((t, i) => ({ pos: i + 1, id: t.id, name: t.name, user: !!t.user_id, color1: t.color1, p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga, pts: t.pts })) });
    const champ = table[0];
    if (champ) {
      if (d === 1) {
        await trophy(l, champ.id, champ.user_id, 'league', `${l.name} champions`);
        await rep(champ.user_id, 50);
        await news(l.id, champ.id, 'champion', `${champ.name} are the champions of ${l.name}!`);
      } else {
        await trophy(l, champ.id, champ.user_id, 'division', `${divisionName(d)} winners`);
        await rep(champ.user_id, 25);
        await news(l.id, champ.id, 'champion', `${champ.name} win the ${divisionName(d)}!`);
      }
    }
    if (d > 1) for (const t of table.slice(0, P)) {
      up.push(t.id);
      await trophy(l, t.id, t.user_id, 'promotion', `Promoted from the ${divisionName(d)}`);
      await rep(t.user_id, 30);
      await news(l.id, t.id, 'promotion', `${t.name} are promoted to the ${divisionName(d - 1)}!`);
    }
    if (d < D) for (const t of table.slice(-P)) {
      down.push(t.id);
      await rep(t.user_id, -20);
      await news(l.id, t.id, 'relegation', `${t.name} are relegated to the ${divisionName(d + 1)}.`);
    }
    // board verdicts and sponsor targets, judged on the club's own division
    for (const [i, c] of table.entries()) {
      await q('UPDATE clubs SET prev_pos=$2 WHERE id=$1', [c.id, i + 1]);
      if (!c.user_id) continue;
      const club = await one('SELECT * FROM clubs WHERE id=$1', [c.id]);
      const target = CLUB_TYPES[club!.club_type as ClubTypeKey].targetPos(table.length);
      if (club!.sponsor === 'target' && i + 1 <= target) {
        await q('UPDATE clubs SET money=money+$1 WHERE id=$2', [SPONSORS.target.bonus, c.id]);
        await inbox(l.id, c.id, `💼 You hit the sponsor target: +${SPONSORS.target.bonus}M bonus.`);
      }
      await inbox(l.id, c.id, i + 1 <= target ? `🏛️ The board is delighted: ${ord(i + 1)} place met the target (top ${target}).` : `🏛️ The board expected top ${target}. You finished ${ord(i + 1)}.`);
    }
  }
  const cupRow = await one(`SELECT data FROM papers WHERE league_id=$1 AND day=0 AND kind='cup'`, [l.id]);
  const cup = cupRow?.data as { name: string; winner?: number } | undefined;
  if (cup?.winner) {
    const w = await one('SELECT id, user_id, name FROM clubs WHERE id=$1', [cup.winner]);
    if (w) { await trophy(l, w.id, w.user_id, 'cup', `${cup.name} winners`); await rep(w.user_id, 30); }
  }
  const awards = await seasonAwards(l, tables);
  for (const a of awards) if (a.clubId) await trophy(l, a.clubId, a.userId ?? null, 'award', `${a.title}: ${a.name}`);
  const cupWinner = cup?.winner ? (await one('SELECT name FROM clubs WHERE id=$1', [cup.winner]))?.name : null;
  await q(
    `INSERT INTO history (league_id, season, data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (league_id, season) DO UPDATE SET data=EXCLUDED.data`,
    [l.id, l.season, JSON.stringify({ season: l.season, divisions: tables, cup: cup ? { name: cup.name, winner: cupWinner } : null, awards, up, down })],
  );
  await news(l.id, null, 'season', `Season ${l.season} is over! The league creator can start season ${l.season + 1} from the Home tab.`);
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
    await rep(u?.id ?? null, 20);
  }
  return out;
}

// ---------------------------------------------------------------- the next season
export async function startNextSeason(uid: number, leagueId: number, schedule: (l: Row) => Promise<void>) {
  const l = await getLeague(leagueId);
  if (l.owner_id !== uid) fail(403, 'Only the league creator can start the next season.');
  if (l.status !== 'finished') fail(400, 'The season is not over yet.');
  const claim = await q(`UPDATE leagues SET status='rolling' WHERE id=$1 AND status='finished' RETURNING id`, [leagueId]);
  if (!claim[0]) fail(400, 'The new season is already being prepared.');
  try {
    const hist = await one('SELECT data FROM history WHERE league_id=$1 AND season=$2', [l.id, l.season]);
    const moves = hist?.data || { up: [], down: [] };
    if (moves.up?.length) await q('UPDATE clubs SET division=division-1 WHERE league_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb)::int)', [l.id, JSON.stringify(moves.up)]);
    if (moves.down?.length) await q('UPDATE clubs SET division=division+1 WHERE league_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb)::int)', [l.id, JSON.stringify(moves.down)]);

    // club records: this season's stats join each player's career at the club
    await q(
      `INSERT INTO career (league_id, club_id, player_id, apps, goals, assists, seasons)
       SELECT league_id, club_id, player_id, apps, goals, assists, 1 FROM pstats WHERE league_id=$1
       ON CONFLICT (league_id, club_id, player_id) DO UPDATE SET apps=career.apps+EXCLUDED.apps, goals=career.goals+EXCLUDED.goals,
         assists=career.assists+EXCLUDED.assists, seasons=career.seasons+1`,
      [l.id],
    );
    await q('DELETE FROM pstats WHERE league_id=$1', [l.id]);

    // loans end
    const loans = await q(`UPDATE squad SET club_id=loan_from, loan_from=NULL WHERE league_id=$1 AND loan_from IS NOT NULL RETURNING player_id, club_id`, [l.id]);
    for (const x of loans) {
      const p = await one('SELECT name FROM players WHERE id=$1', [x.player_id]);
      await inbox(l.id, x.club_id, `🔁 ${p?.name} is back from his loan.`);
    }

    await ageAndRetire(l);
    await youthIntake(l);
    await refillBots(l);

    // money: prize by final position, a fresh sponsor choice, board patience restored
    const clubs = await q('SELECT * FROM clubs WHERE league_id=$1', [l.id]);
    for (const c of clubs) {
      const pos = c.prev_pos || l.max_clubs;
      const prize = Math.max(1, (l.max_clubs - pos + 1) * (c.division === 1 ? 0.8 : c.division === 2 ? 0.5 : 0.3));
      await q(`UPDATE clubs SET money=money+$2, coins=coins+300, sponsor=NULL, board=60 WHERE id=$1`, [c.id, prize.toFixed(2)]);
      if (c.user_id) await inbox(l.id, c.id, `💰 Season ${l.season} prize money: ${prize.toFixed(1)}M, plus 300 coins for the new season.`);
    }
    await q(`UPDATE squad SET fitness=100, out_until=0, out_reason=NULL, form_mod=0, form_until=0, form_note=NULL,
               morale=70 + (morale-70)/2, promise_day=0, talk_day=0 WHERE league_id=$1`, [l.id]);
    for (const t of ['fixtures', 'days', 'papers', 'comments', 'listings']) await q(`DELETE FROM ${t} WHERE league_id=$1`, [l.id]);
    await q(`UPDATE offers SET status='expired', updated_at=now() WHERE league_id=$1 AND status IN ('pending','countered')`, [l.id]);

    const next = { ...l, season: l.season + 1 };
    await schedule(next);
    await q(`UPDATE leagues SET status='running', season=season+1 WHERE id=$1`, [l.id]);
  } catch (e) {
    await q(`UPDATE leagues SET status='finished' WHERE id=$1 AND status='rolling'`, [l.id]);
    throw e;
  }
  await news(l.id, null, 'season', `Season ${l.season + 1} begins! The pre-season window is open until the first kick-off.`);
  return { ok: true };
}

// Young players grow, players past 30 decline, and the oldest hang up their boots.
async function ageAndRetire(l: Row) {
  const rows = await q(
    `SELECT s.player_id, s.club_id, s.ovr_delta, s.age_add, p.age, p.ovr, p.pot, p.name, c.user_id, c.club_type
     FROM squad s JOIN players p ON p.id=s.player_id JOIN clubs c ON c.id=s.club_id WHERE s.league_id=$1`,
    [l.id],
  );
  const upd: { id: string; d: number; a: number }[] = [];
  const gone: Row[] = [];
  for (const x of rows) {
    const r = rng(hashSeed('age', l.id, l.season, x.player_id));
    const age = x.age + x.age_add + 1;
    const now = x.ovr + x.ovr_delta;
    let d = 0;
    if (age <= 23) d = Math.round((1 + r.next() * 3) * (x.club_type === 'academy' ? 1.5 : 1));
    else if (age <= 27) d = r.next() < 0.5 ? 1 : 0;
    else if (age <= 30) d = 0;
    else if (age <= 32) d = -Math.round(r.next() * 2);
    else d = -(1 + Math.round(r.next() * 2));
    if (d > 0) d = Math.max(0, Math.min(d, x.pot - now));
    const retireChance = age >= 37 ? 1 : age >= 35 ? 0.5 : age >= 34 ? 0.15 : 0;
    if (r.next() < retireChance) { gone.push({ ...x, age }); continue; }
    upd.push({ id: x.player_id, d: x.ovr_delta + d, a: x.age_add + 1 });
  }
  if (upd.length) {
    await q(
      `UPDATE squad s SET ovr_delta=x.d, age_add=x.a FROM jsonb_to_recordset($1::jsonb) AS x(id text, d int, a int) WHERE s.league_id=$2 AND s.player_id=x.id`,
      [JSON.stringify(upd), l.id],
    );
  }
  for (const g of gone) {
    await q('DELETE FROM squad WHERE league_id=$1 AND player_id=$2', [l.id, g.player_id]);
    await q('DELETE FROM training WHERE league_id=$1 AND player_id=$2', [l.id, g.player_id]);
    await q('INSERT INTO retired (league_id, player_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [l.id, g.player_id]);
    if (g.user_id) await inbox(l.id, g.club_id, `👋 ${g.name} (${g.age}) has retired. Thank you for everything.`);
    if (g.ovr + g.ovr_delta >= 80) await news(l.id, g.club_id, 'retire', `End of an era: ${g.name} retires at ${g.age}.`);
  }
}

// Every club gets 2 academy graduates (3 for Academy clubs), in the line where the squad is thinnest.
async function youthIntake(l: Row) {
  const clubs = await q('SELECT * FROM clubs WHERE league_id=$1', [l.id]);
  const tpl = (await q(`SELECT * FROM players WHERE pool=$1 AND ovr BETWEEN 62 AND 78`, [l.pool])) as RawPlayer[];
  const want: Record<string, number> = { GK: 2.5, DEF: 7, MID: 7, FWD: 4.5 };
  for (const c of clubs) {
    const sq = await q('SELECT p.pos FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1', [c.id]);
    const n = c.club_type === 'academy' ? 3 : 2;
    const room = MAX_SQUAD - sq.length;
    if (room <= 0) {
      if (c.user_id) await inbox(l.id, c.id, `🎓 Your squad is full (${MAX_SQUAD}), so this year's academy graduates joined other clubs.`);
      continue;
    }
    const count: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of sq) count[LINE[p.pos] || 'MID']++;
    const names: string[] = [];
    for (let k = 0; k < Math.min(n, room); k++) {
      const line = Object.keys(want).sort((a, b) => count[a] / want[a] - count[b] / want[b])[0];
      count[line]++;
      const pool = tpl.filter((p) => (LINE[p.pos] || 'MID') === line);
      const id = `Y${l.id}-${l.season + 1}-${c.id}-${k + 1}`;
      const y = youthPlayer(l.pool, id, hashSeed('youth', id), line, pool.length ? pool : tpl, c.club_type === 'academy' ? 4 : 0);
      await q(
        `INSERT INTO players (id, name, pool, nat, pos, foot, age, height, ovr, pot, attrs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT (id) DO NOTHING`,
        [y.id, y.name, `Y${l.id}`, y.nat, y.pos, y.foot, y.age, y.height, y.ovr, y.pot, JSON.stringify(y.attrs)],
      );
      await q('INSERT INTO squad (league_id, player_id, club_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [l.id, y.id, c.id]);
      names.push(`${y.name} (${y.pos}, ${y.ovr}, potential ${y.pot})`);
    }
    if (c.user_id && names.length) await inbox(l.id, c.id, `🎓 Youth intake: ${names.join(', ')} join from the academy.`);
  }
}

// Bots that lost players to retirement sign free agents of a similar level to stay at 18+.
async function refillBots(l: Row) {
  const bots = await q('SELECT id FROM clubs WHERE league_id=$1 AND user_id IS NULL', [l.id]);
  for (const b of bots) {
    const sq = await q('SELECT p.pos, p.ovr + s.ovr_delta AS ovr FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1', [b.id]);
    const need = 18 - sq.length;
    if (need <= 0) continue;
    const avg = sq.reduce((a, p) => a + p.ovr, 0) / Math.max(1, sq.length);
    const gks = sq.filter((p) => p.pos === 'GK').length;
    const free = await q(
      `SELECT p.id, p.pos FROM players p WHERE p.pool=$1 AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id)
         AND NOT EXISTS (SELECT 1 FROM retired r WHERE r.league_id=$2 AND r.player_id=p.id) ORDER BY ABS(p.ovr - $3), p.id LIMIT 40`,
      [l.pool, l.id, Math.round(avg)],
    );
    let added = 0, g = gks;
    for (const p of free) {
      if (added >= need) break;
      if (p.pos === 'GK' && g >= 2) continue;
      if (p.pos !== 'GK' && g < 2 && need - added <= 2 - g) continue;
      await q('INSERT INTO squad (league_id, player_id, club_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [l.id, p.id, b.id]);
      if (p.pos === 'GK') g++;
      added++;
    }
  }
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
