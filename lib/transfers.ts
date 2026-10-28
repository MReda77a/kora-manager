// The living transfer market while the window is open:
//  - players from abroad: free players from the pool, offered by (fictional) foreign clubs each window
//  - every day of the window, players that managers listed may be bought by an AI club of the league
//    or by a club from abroad. Nobody can tell when: the chance depends on the price, the player
//    (age, potential, form) and the market's mood that day.
//  - AI clubs also shop abroad to fill their weak spots.
// Every function reads a few rows and writes once (Cloudflare counts requests per visit).
import { q, one, writes, type Row } from './db.ts';
import { transferStmt } from './history.ts';
import { LINE, MAX_SQUAD, MIN_SQUAD, marketValue } from './game.ts';
import { getLeague, myClub, news, windowFor } from './league.ts';
import { fail } from './errors.ts';
import { notifyEach } from './push.ts';
import { hashSeed, rng } from './rng.ts';

// invented clubs (no real club names)
export const FOREIGN_CLUBS = [
  '🇪🇸 Atlético Ribera', '🇪🇸 Real Costa Azul', '🇮🇹 Sporting Lavena', '🇮🇹 AC Monteverde', '🇩🇪 FC Rheinstadt', '🇩🇪 SV Talheim',
  '🇫🇷 Olympique Belmare', '🇫🇷 Stade Varenne', '🇵🇹 Sporting Douro', '🇵🇹 Académica Serrana', '🇳🇱 Vitesse Lindhoven', '🇹🇷 Bosphorus SK',
  '🇹🇷 Karadeniz Spor', '🇸🇦 Al-Nakheel', '🇸🇦 Al-Wadi Club', '🇦🇪 Al-Sahil', '🇶🇦 Doha Stars', '🇺🇸 Bay City FC', '🇧🇷 Esporte Vila Nova',
  '🇦🇷 Atlético Pampa', '🇲🇦 Étoile de l\'Atlas', '🇬🇷 Olympos FC', '🇯🇵 Kaze United', '🇲🇽 Club Sierra Madre',
];

const lineOf = (pos: string) => LINE[pos] || 'MID';
const round1 = (x: number) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------- players from abroad
/** clubs abroad ask a lot: about 7M for an 80, 25M for an 86, 40M for an 88, 60M for a 90, 90M+ for a 92,
 *  more for young players with room to grow, much less for veterans */
export function abroadPrice(ovr: number, age: number, pot: number, rand: number) {
  const p = marketValue(ovr, age, pot) * (0.95 + rand * 0.2); // clubs abroad ask the going rate, sometimes a bit more
  return Math.max(0.5, p >= 10 ? Math.round(p) : Math.round(p * 10) / 10);
}

/** a fresh list of players from abroad for this window (the old list goes) */
export async function abroadMarket(l: Row, round: number) {
  const seed = hashSeed('abroad', l.id, l.season, round);
  const [free, lv] = await Promise.all([
    q(
      `SELECT p.id, p.pos, p.ovr, p.pot, p.age, p.attrs->>'v' AS v FROM players p
       WHERE p.pool=$1 AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=$2 AND s.player_id=p.id)
         AND NOT EXISTS (SELECT 1 FROM retired r WHERE r.league_id=$2 AND r.player_id=p.id)
       ORDER BY md5(p.id || $3) LIMIT 400`,
      [l.pool, l.id, String(seed)],
    ),
    one<{ a: number }>('SELECT AVG(p.ovr + s.ovr_delta)::float AS a FROM squad s JOIN players p ON p.id=s.player_id WHERE s.league_id=$1', [l.id]),
  ]);
  const avg = lv?.a || 75;
  const r = rng(seed);
  const pick = (list: Row[], n: number) => list.sort(() => r.next() - 0.5).slice(0, n);
  const stars = pick(free.filter((p) => p.ovr >= avg + 6), 2 + Math.floor(r.next() * 2));
  const solid = pick(free.filter((p) => Math.abs(p.ovr - avg) < 6), 10 + Math.floor(r.next() * 5));
  const cheap = pick(free.filter((p) => p.ovr <= avg - 6).sort((a, b) => a.age - b.age).slice(0, 40), 4 + Math.floor(r.next() * 4));
  const rows = [...stars, ...solid, ...cheap].map((p) => ({ p: p.id, price: abroadPrice(p.ovr, p.age, p.pot, r.next()), club: FOREIGN_CLUBS[Math.floor(r.next() * FOREIGN_CLUBS.length)] }));
  const w = writes();
  w.add('DELETE FROM abroad WHERE league_id=$1', [l.id]);
  if (rows.length) {
    w.add(`INSERT INTO abroad (league_id, player_id, price, club) SELECT $1, x.p, x.price, x.club FROM jsonb_to_recordset($2::jsonb) AS x(p text, price numeric, club text) ON CONFLICT DO NOTHING`, [l.id, JSON.stringify(rows)]);
    w.add(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,NULL,'window',$2)`, [l.id, `🌍 ${rows.length} players from clubs abroad are on the market this window. Find them in Transfers.`]);
  }
  await w.flush();
}

export async function clearAbroad(leagueId: number) {
  await q('DELETE FROM abroad WHERE league_id=$1', [leagueId]);
}

export async function abroadListings(leagueId: number) {
  return q(
    `SELECT a.id AS abroad_id, a.price, a.club AS seller, a.created_at, p.* FROM abroad a JOIN players p ON p.id=a.player_id
     WHERE a.league_id=$1 AND NOT EXISTS (SELECT 1 FROM squad s WHERE s.league_id=a.league_id AND s.player_id=a.player_id) ORDER BY p.ovr DESC`,
    [leagueId],
  );
}

export async function buyAbroad(uid: number, leagueId: number, abroadId: number) {
  const l = await getLeague(leagueId);
  if (!(await windowFor(l)).open) fail(400, 'The transfer window is closed.');
  const club = await myClub(uid, leagueId);
  const [{ n }] = await q<{ n: number }>('SELECT COUNT(*)::int AS n FROM squad WHERE club_id=$1', [club.id]);
  if (n >= MAX_SQUAD) fail(400, `Your squad is full (${MAX_SQUAD}).`);
  const a = await one('DELETE FROM abroad WHERE id=$1 AND league_id=$2 RETURNING *', [abroadId, leagueId]);
  if (!a) fail(404, 'This player has already signed for someone else.');
  const paid = await q('UPDATE clubs SET money = money - $1 WHERE id=$2 AND money >= $1 RETURNING money', [a.price, club.id]);
  if (!paid[0]) {
    await q('INSERT INTO abroad (league_id, player_id, price, club) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [leagueId, a.player_id, a.price, a.club]);
    fail(400, 'Not enough money.');
  }
  const ins = await q('INSERT INTO squad (league_id, player_id, club_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING player_id', [leagueId, a.player_id, club.id]);
  if (!ins[0]) {
    await q('UPDATE clubs SET money = money + $1 WHERE id=$2', [a.price, club.id]);
    fail(400, 'He has just signed for another club.');
  }
  const p = await one('SELECT name FROM players WHERE id=$1', [a.player_id]);
  await news(leagueId, club.id, 'transfer', `${club.name} sign ${p?.name} from ${a.club} for ${Number(a.price).toFixed(1)}M.`);
  { const t = transferStmt({ league: leagueId, player: a.player_id, name: p?.name || '?', from: null, fromName: a.club, to: club.id, toName: club.name, fee: Number(a.price), kind: 'abroad' }); await q(t.text, t.params); }
  return { ok: true };
}

// ---------------------------------------------------------------- one day of the window
/** chance (0..1) that a listed player is bought today */
export function saleChance(x: { price: number; v: number; age: number; ovr: number; pot: number; rating: number | null; fresh: boolean }, mood: number, deadline: boolean) {
  const ratio = x.price / Math.max(0.3, x.v);
  const priceF = ratio <= 0.8 ? 2.2 : ratio <= 1 ? 1.6 : ratio <= 1.25 ? 1.15 : ratio <= 1.5 ? 0.75 : ratio <= 1.75 ? 0.4 : ratio <= 3 ? 0.31 : 0.1;
  let appeal = 1;
  if (x.age <= 21) appeal += 0.5; else if (x.age <= 24) appeal += 0.25; else if (x.age >= 31) appeal -= 0.25;
  appeal += Math.max(0, x.pot - x.ovr) / 25;
  if (x.rating !== null) appeal += x.rating >= 7.2 ? 0.35 : x.rating < 6.3 ? -0.2 : 0;
  // deadline day: clubs abroad rush to get their deals done
  const p = 0.32 * priceF * appeal * mood * (deadline ? 2.2 : 1) * (x.fresh && !deadline ? 0.75 : 1);
  return Math.max(deadline ? 0.06 : 0.01, Math.min(deadline ? 0.85 : 0.65, p));
}

/** how likely a listing is to sell on an ordinary day, in words, so the manager knows when the price is too high */
export function saleOdds(price: number, v: number, squad: number, open = true) {
  if (!open) return { level: 'none', text: 'The transfer window is closed: nobody can buy him until it opens again.' };
  if (squad <= MIN_SQUAD) return { level: 'none', text: `Nobody can buy him while you have only ${squad} players (minimum ${MIN_SQUAD}).` };
  const ratio = price / Math.max(0.3, v);
  const p = saleChance({ price, v, age: 26, ovr: 75, pot: 75, rating: null, fresh: false }, 1, false);
  const level = p >= 0.3 ? 'high' : p >= 0.15 ? 'fair' : p >= 0.06 ? 'low' : 'very low';
  const why = ratio > 1.25 ? ` You asked ${ratio.toFixed(1)}× his value (${v}M).` : '';
  return { level, text: `Chance to sell each day: ${level}.${why}` };
}

export async function marketDay(l: Row, day: number, deadline: boolean) {
  const [listed, abroad, botRows] = await Promise.all([
    q(
      `SELECT li.id, li.price, li.created_at, li.seller_id, c.name AS seller, c.user_id AS seller_user, p.id AS pid, p.name, p.pos, p.pot, p.attrs->>'v' AS v,
         p.ovr + s.ovr_delta AS ovr, p.age + s.age_add AS age, s.loan_from,
         (SELECT COUNT(*)::int FROM squad x WHERE x.club_id=li.seller_id) AS squad,
         (SELECT CASE WHEN ps.apps > 0 THEN ps.rating_sum / ps.apps END FROM pstats ps WHERE ps.league_id=li.league_id AND ps.player_id=li.player_id) AS rating
       FROM listings li JOIN clubs c ON c.id=li.seller_id JOIN players p ON p.id=li.player_id JOIN squad s ON s.league_id=li.league_id AND s.player_id=li.player_id
       WHERE li.league_id=$1 AND c.user_id IS NOT NULL`,
      [l.id],
    ),
    abroadListings(l.id),
    q(`SELECT c.id, c.name, c.money, p.pos, p.ovr + s.ovr_delta AS ovr FROM clubs c JOIN squad s ON s.club_id=c.id JOIN players p ON p.id=s.player_id WHERE c.league_id=$1 AND c.user_id IS NULL`, [l.id]),
  ]);
  const r = rng(hashSeed('market', l.id, l.season, day));
  const mood = 0.6 + r.next() * 0.8; // some days the market is busy, some days it is quiet
  const bots = new Map<number, { id: number; name: string; money: number; sq: { pos: string; ovr: number }[] }>();
  for (const b of botRows) { const x = bots.get(b.id) || { id: b.id, name: b.name, money: Number(b.money), sq: [] as { pos: string; ovr: number }[] }; x.sq.push({ pos: b.pos, ovr: b.ovr }); bots.set(b.id, x); }
  const weakness = (b: { sq: { pos: string; ovr: number }[] }, line: string) => {
    const n = line === 'GK' ? 1 : line === 'FWD' ? 3 : 4;
    const v = b.sq.filter((p) => lineOf(p.pos) === line).map((p) => p.ovr).sort((x, y) => y - x).slice(0, n);
    return v.length < n ? 0 : v.reduce((a, x) => a + x, 0) / v.length;
  };
  const w = writes();
  const alerts: { uid: number; msg: { title: string; body: string; url: string } }[] = [];
  let sales = 0;
  // 1) players the managers listed
  for (const li of listed.sort(() => r.next() - 0.5)) {
    if (sales >= (deadline ? 10 : 6)) break;
    if (li.loan_from || li.squad <= MIN_SQUAD) continue;
    const fresh = Date.now() - new Date(li.created_at).getTime() < 20 * 3_600_000;
    // what he is worth now (training and age move it), the same value the manager sees
    const p = saleChance({ price: Number(li.price), v: marketValue(li.ovr, li.age, li.pot), age: li.age, ovr: li.ovr, pot: li.pot, rating: li.rating === null ? null : Number(li.rating), fresh }, mood, deadline);
    if (r.next() >= p) continue;
    const price = Number(li.price);
    // an AI club of the league that needs him and can pay, otherwise a club from abroad
    const keen = [...bots.values()].filter((b) => b.money >= price && b.sq.length < 26 && li.ovr > weakness(b, lineOf(li.pos)) + 1);
    // on deadline day most of the buyers are clubs from abroad
    const bot = keen.length && r.next() < (deadline ? 0.2 : 0.55) ? keen[Math.floor(r.next() * keen.length)] : null;
    const buyer = bot ? bot.name : FOREIGN_CLUBS[Math.floor(r.next() * FOREIGN_CLUBS.length)];
    w.add('DELETE FROM listings WHERE id=$1', [li.id]);
    w.add('UPDATE clubs SET money=money+$1, sales=sales+$1 WHERE id=$2', [price, li.seller_id]);
    w.add('DELETE FROM training WHERE league_id=$1 AND player_id=$2 AND done=false', [l.id, li.pid]);
    if (bot) {
      w.add('UPDATE clubs SET money=money-$1 WHERE id=$2', [price, bot.id]);
      w.add('UPDATE squad SET club_id=$1, fitness=100 WHERE league_id=$2 AND player_id=$3', [bot.id, l.id, li.pid]);
      bot.money -= price; bot.sq.push({ pos: li.pos, ovr: li.ovr });
    } else {
      w.add('DELETE FROM squad WHERE league_id=$1 AND player_id=$2', [l.id, li.pid]); // he leaves the league
    }
    w.add(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,'transfer',$3)`, [l.id, bot?.id ?? null, `${li.name} joins ${buyer} from ${li.seller} for ${price.toFixed(1)}M.`]);
    { const t = transferStmt({ league: l.id, player: li.pid, name: li.name, from: li.seller_id, fromName: li.seller, to: bot?.id ?? null, toName: buyer, fee: price, kind: bot ? 'buy' : 'sold abroad' }); w.add(t.text, t.params); }
    w.add(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,'inbox',$3)`, [l.id, li.seller_id, `💰 ${buyer} bought ${li.name} for ${price.toFixed(1)}M.`]);
    alerts.push({ uid: li.seller_user, msg: { title: '💰 Player sold', body: `${buyer} bought ${li.name} for ${price.toFixed(1)}M.`, url: `/l/${l.id}` } });
    sales++;
  }
  // 2) AI clubs shop abroad for their weak spots
  let signed = 0;
  const taken = new Set<string>();
  for (const b of [...bots.values()].sort(() => r.next() - 0.5)) {
    if (signed >= 2) break;
    if (b.sq.length >= 26 || r.next() > (deadline ? 0.2 : 0.12)) continue;
    const lines = ['GK', 'DEF', 'MID', 'FWD'].map((ln) => [ln, weakness(b, ln)] as [string, number]).sort((x, y) => x[1] - y[1]);
    const [ln, level] = lines[0];
    const a = abroad.find((x) => !taken.has(x.id) && lineOf(x.pos) === ln && x.ovr > level + 1 && Number(x.price) <= b.money * 0.5);
    if (!a) continue;
    taken.add(a.id); signed++;
    b.money -= Number(a.price);
    w.add('DELETE FROM abroad WHERE id=$1', [a.abroad_id]);
    w.add('UPDATE clubs SET money=money-$1 WHERE id=$2', [Number(a.price), b.id]);
    w.add('INSERT INTO squad (league_id, player_id, club_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [l.id, a.id, b.id]);
    w.add(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,'transfer',$3)`, [l.id, b.id, `${b.name} sign ${a.name} from ${a.seller} for ${Number(a.price).toFixed(1)}M.`]);
    { const t = transferStmt({ league: l.id, player: a.id, name: a.name, from: null, fromName: a.seller, to: b.id, toName: b.name, fee: Number(a.price), kind: 'abroad' }); w.add(t.text, t.params); }
  }
  await w.flush();
  await notifyEach(alerts);
  return { sales, signed };
}
