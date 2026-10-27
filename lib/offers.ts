// Manager-to-manager transfers: offers to buy, loan or swap players, counter-offers, bidding wars,
// rumours and bot clubs that bid for your players. Only while a transfer window is open.
import { q, one, writes, type Row } from './db.ts';
import { notify } from './push.ts';
import { fail } from './errors.ts';
import { MAX_SQUAD, MIN_SQUAD, marketValue } from './game.ts';
import { getLeague, myClub, news, windowFor } from './league.ts';
import { inbox } from './people.ts';
import { hashSeed, rng } from './rng.ts';

const KINDS = ['buy', 'loan', 'swap'];
const money = (n: number) => `${Number(n).toFixed(1)}M`;

// a player's asking value in this league: base value, adjusted for growth or decline
async function valueOf(leagueId: number, playerId: string) {
  const p = await one(
    `SELECT p.*, s.ovr_delta, s.age_add, s.club_id, s.loan_from, s.request FROM players p JOIN squad s ON s.player_id=p.id AND s.league_id=$1 WHERE p.id=$2`,
    [leagueId, playerId],
  );
  if (!p) fail(404, 'Player not found in this league.');
  // what he is worth now: his level and age in this league, not the day he was signed
  const v = marketValue(p.ovr + (p.ovr_delta || 0), p.age + (p.age_add || 0), p.pot);
  return { p, v };
}

async function isKeyPlayer(clubId: number, playerId: string) {
  const top = await q(`SELECT s.player_id FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 ORDER BY p.ovr + s.ovr_delta DESC LIMIT 11`, [clubId]);
  return top.some((t) => t.player_id === playerId);
}

export async function makeOffer(uid: number, leagueId: number, b: Record<string, any>) {
  const l = await getLeague(leagueId);
  if (!(await windowFor(l)).open) fail(400, 'The transfer window is closed.');
  const me = await myClub(uid, leagueId);
  const kind = String(b.kind);
  if (!KINDS.includes(kind)) fail(400, 'Pick buy, loan or swap.');
  const { p, v } = await valueOf(leagueId, String(b.playerId));
  if (p.club_id === me.id) fail(400, 'He already plays for you.');
  if (p.loan_from) fail(400, `${p.name} is on loan there and can't be moved until the summer.`);
  const amount = Math.round(Math.max(0, Number(b.amount) || 0) * 10) / 10;
  if (amount > 500) fail(400, 'That is too much money.');
  if (kind === 'buy' && amount < 0.1) fail(400, 'Offer at least 0.1M.');
  if (Number(me.money) < amount) fail(400, `You only have ${money(me.money)}.`);
  let swap: Row | null = null;
  if (kind === 'swap') {
    swap = await one(`SELECT s.*, p.name, p.ovr + s.ovr_delta AS ovr, p.age + s.age_add AS age, p.pot, p.attrs FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND s.player_id=$2`, [me.id, String(b.swapPlayer)]);
    if (!swap) fail(400, 'Pick one of your players to swap.');
    if (swap.loan_from) fail(400, 'You can not swap a player you have on loan.');
  } else {
    const [{ n }] = await q<{ n: number }>('SELECT COUNT(*)::int AS n FROM squad WHERE club_id=$1', [me.id]);
    if (n >= MAX_SQUAD) fail(400, `Your squad is full (${MAX_SQUAD}).`);
  }
  const dup = await one(`SELECT id FROM offers WHERE from_club=$1 AND player_id=$2 AND status IN ('pending','countered')`, [me.id, p.id]);
  if (dup) fail(400, 'You already have an open offer for him.');
  const seller = await one('SELECT * FROM clubs WHERE id=$1', [p.club_id]);
  const [o] = await q(
    `INSERT INTO offers (league_id, from_club, to_club, player_id, kind, amount, swap_player) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [leagueId, me.id, seller!.id, p.id, kind, amount, swap?.player_id ?? null],
  );
  // a rival is already in for him: bidding war
  const rivals = await q(`SELECT DISTINCT c.name FROM offers o JOIN clubs c ON c.id=o.from_club WHERE o.player_id=$1 AND o.league_id=$2 AND o.status IN ('pending','countered') AND o.from_club<>$3`, [p.id, leagueId, me.id]);
  if (rivals.length) await news(leagueId, null, 'rumour', `🔥 BIDDING WAR: ${me.name} and ${rivals.map((r) => r.name).join(', ')} are fighting over ${p.name}!`);
  else if (r01(o.id) < 0.5) await news(leagueId, null, 'rumour', `RUMOUR: ${me.name} have made a move for ${seller!.name}'s ${p.name}.`);
  const what = describe(kind, amount, swap?.name);
  if (seller!.user_id) {
    await inbox(leagueId, seller!.id, `📨 ${me.name} offer ${what} for ${p.name}. Answer in Market › Offers.`, { title: 'New offer', url: `/l/${leagueId}?tab=market` });
    return { ok: true, status: 'pending', text: `Offer sent to ${seller!.name}. They will answer soon.` };
  }
  return botAnswer(o, p, v, seller!, swap);
}
const r01 = (n: number) => rng(hashSeed('offer', n)).next();
const describe = (kind: string, amount: number, swapName?: string) =>
  kind === 'buy' ? money(amount) : kind === 'loan' ? `a season loan${amount ? ` (fee ${money(amount)})` : ''}` : `${swapName}${amount ? ` + ${money(amount)}` : ''} in a swap`;

// Bot clubs answer straight away: accept, counter with their price, or refuse.
async function botAnswer(o: Row, p: Row, v: number, seller: Row, swap: Row | null) {
  const key = await isKeyPlayer(seller.id, p.id);
  if (o.kind === 'loan') {
    if (key) return finish(o, 'rejected', `${seller.name}: "He is a key player. Not for loan."`);
    if (Number(o.amount) >= v * 0.15) return complete(o, Number(o.amount));
    const c = Math.round(v * 0.2 * 10) / 10;
    await q(`UPDATE offers SET status='countered', counter=$2, updated_at=now() WHERE id=$1`, [o.id, c]);
    return { ok: true, status: 'countered', counter: c, text: `${seller.name} want a ${money(c)} loan fee.` };
  }
  // buying or swapping: haggle. They have a hidden lowest price and start higher; every round they come
  // down part of the way towards your offer, but they lose patience after a few rounds or a silly bid.
  const reserve = Math.round(v * (key ? 1.3 : 1.0) * (0.95 + r01(o.id) * 0.15) * 10) / 10;
  const ask = Math.round(v * (key ? 1.6 : 1.25) * 10) / 10;
  await q(`UPDATE offers SET reserve=$2, ask=$3 WHERE id=$1`, [o.id, reserve, ask]);
  return haggle({ ...o, reserve, ask }, p, v, seller, swap);
}

async function haggle(o: Row, p: Row, v: number, seller: Row, swap: Row | null) {
  const sv = swap ? Math.max(0.3, marketValue(swap.ovr, swap.age ?? 26, swap.pot ?? swap.ovr)) : 0;
  if (swap && swap.ovr < p.ovr - 8) return finish(o, 'rejected', `${seller.name}: "${swap.name} is not good enough for us."`);
  const x = sv + Number(o.amount); // what the offer is worth to them
  const rounds = (o.rounds || 0) + 1;
  const ask = Number(o.ask), reserve = Number(o.reserve);
  if (x >= ask * 0.99) return complete(o, Number(o.amount));
  if (x < v * 0.5) return finish(o, 'rejected', rounds === 1 ? `${seller.name} laughed at the offer. He is worth far more.` : `${seller.name} ended the talks: "You are not serious."`);
  if (rounds > 5) return finish(o, 'rejected', `${seller.name}: "We are going round in circles. He is not for sale to you."`);
  const newAsk = Math.round(Math.max(reserve, ask - (ask - x) * 0.45) * 10) / 10;
  if (newAsk <= x * 1.03) return complete(o, Number(o.amount)); // close enough: deal
  const c = Math.round(Math.max(0.1, newAsk - sv) * 10) / 10;
  await q(`UPDATE offers SET status='countered', counter=$2, ask=$3, rounds=$4, updated_at=now() WHERE id=$1`, [o.id, c, newAsk, rounds]);
  const floor = rounds > 1 && newAsk >= ask; // they will not go lower than this
  const say = swap ? `would do the swap if you add ${money(c)}${floor ? '. That is our last word.' : ''}` : rounds === 1 ? `say: "${money(c)} and he's yours."` : rounds >= 4 || floor ? `say: "${money(c)}. That is our last word."` : `come down to ${money(c)}.`;
  return { ok: true, status: 'countered', counter: c, rounds, text: `${seller.name} ${say}` };
}

async function finish(o: Row, status: string, text: string) {
  await q(`UPDATE offers SET status=$2, note=$3, updated_at=now() WHERE id=$1`, [o.id, status, text]);
  return { ok: true, status, text };
}

// Move the player(s) and the money. Every check runs again here: things may have changed since.
async function complete(o: Row, price: number) {
  const l = await getLeague(o.league_id);
  if (!(await windowFor(l)).open) { await finish(o, 'expired', 'The window closed.'); fail(400, 'The transfer window is closed.'); }
  const buyer = await one('SELECT * FROM clubs WHERE id=$1', [o.from_club]);
  const seller = await one('SELECT * FROM clubs WHERE id=$1', [o.to_club]);
  const still = await one('SELECT * FROM squad WHERE league_id=$1 AND player_id=$2 AND club_id=$3', [o.league_id, o.player_id, o.to_club]);
  if (!still) { await finish(o, 'expired', 'He has moved on.'); fail(400, 'That player has already moved.'); }
  if (o.kind === 'swap') {
    const sw = await one('SELECT * FROM squad WHERE league_id=$1 AND player_id=$2 AND club_id=$3', [o.league_id, o.swap_player, o.from_club]);
    if (!sw) { await finish(o, 'expired', 'The swap player has gone.'); fail(400, 'The swap player is no longer at the club.'); }
  } else {
    const [{ n }] = await q<{ n: number }>('SELECT COUNT(*)::int AS n FROM squad WHERE club_id=$1', [buyer!.id]);
    if (n >= MAX_SQUAD) fail(400, `${buyer!.name}'s squad is full.`);
    if (seller!.user_id) {
      const [{ m }] = await q<{ m: number }>('SELECT COUNT(*)::int AS m FROM squad WHERE club_id=$1', [seller!.id]);
      if (m <= MIN_SQUAD) fail(400, `${seller!.name} would drop below ${MIN_SQUAD} players.`);
    }
  }
  if (price > 0) {
    const paid = await q('UPDATE clubs SET money=money-$1 WHERE id=$2 AND money >= $1 RETURNING id', [price, buyer!.id]);
    if (!paid[0]) fail(400, `${buyer!.name} can't afford ${money(price)}.`);
    await q('UPDATE clubs SET money=money+$1, sales=sales+$1 WHERE id=$2', [price, seller!.id]);
  }
  const done = await q(`UPDATE offers SET status='accepted', counter=$2, updated_at=now() WHERE id=$1 AND status IN ('pending','countered') RETURNING id`, [o.id, price]);
  if (!done[0]) {
    if (price > 0) { await q('UPDATE clubs SET money=money+$1 WHERE id=$2', [price, buyer!.id]); await q('UPDATE clubs SET money=money-$1, sales=sales-$1 WHERE id=$2', [price, seller!.id]); }
    fail(400, 'This offer was already answered.');
  }
  const move = async (pid: string, to: number, loanFrom: number | null) => {
    await q(`UPDATE squad SET club_id=$3, loan_from=$4, fitness=100, morale=GREATEST(morale, 75), request=false, promise_day=0 WHERE league_id=$1 AND player_id=$2`, [o.league_id, pid, to, loanFrom]);
    await q('DELETE FROM listings WHERE league_id=$1 AND player_id=$2', [o.league_id, pid]);
    await q('DELETE FROM training WHERE league_id=$1 AND player_id=$2 AND done=false', [o.league_id, pid]);
    // take him out of the old club's saved line-up and penalty order
    await q(`UPDATE clubs SET lineup=(SELECT COALESCE(jsonb_agg(CASE WHEN x=to_jsonb($2::text) THEN '""'::jsonb ELSE x END), '[]'::jsonb) FROM jsonb_array_elements(lineup) x),
               pens=(SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(pens) x WHERE x<>to_jsonb($2::text)) WHERE league_id=$1`, [o.league_id, pid]);
  };
  await move(o.player_id, buyer!.id, o.kind === 'loan' ? seller!.id : null);
  if (o.kind === 'swap') await move(o.swap_player, seller!.id, null);
  const names = await q('SELECT id, name FROM players WHERE id IN ($1, $2)', [o.player_id, o.swap_player || o.player_id]);
  const nm = (id: string) => names.find((x) => x.id === id)?.name || 'the player';
  const head = o.kind === 'loan' ? `${buyer!.name} sign ${nm(o.player_id)} on loan from ${seller!.name}${price ? ` (fee ${money(price)})` : ''}.`
    : o.kind === 'swap' ? `SWAP DEAL: ${nm(o.player_id)} joins ${buyer!.name}, ${nm(o.swap_player)} goes to ${seller!.name}${price ? ` (+${money(price)})` : ''}.`
    : `${buyer!.name} sign ${nm(o.player_id)} from ${seller!.name} for ${money(price)}.`;
  await news(o.league_id, buyer!.id, 'transfer', head);
  // other bids for him are dead now
  const others = await q(`UPDATE offers SET status='expired', note='He signed elsewhere.', updated_at=now() WHERE player_id=$1 AND league_id=$2 AND id<>$3 AND status IN ('pending','countered') RETURNING from_club`, [o.player_id, o.league_id, o.id]);
  for (const x of others) await inbox(o.league_id, x.from_club, `❌ ${nm(o.player_id)} signed for ${buyer!.name}. Your offer is off.`, { title: 'Offer off' });
  if (buyer!.user_id) await inbox(o.league_id, buyer!.id, `✅ Done deal: ${head}`, { title: 'Done deal' });
  if (seller!.user_id) await inbox(o.league_id, seller!.id, `✅ Done deal: ${head}`, { title: 'Done deal' });
  return { ok: true, status: 'accepted', text: head };
}

// accept / reject / counter (receiver) or accept / withdraw (sender, after a counter)
export async function respondOffer(uid: number, leagueId: number, offerId: number, action: string, amount?: number) {
  const o = await one('SELECT * FROM offers WHERE id=$1 AND league_id=$2', [offerId, leagueId]);
  if (!o) fail(404, 'Offer not found.');
  const me = await myClub(uid, leagueId);
  const { p, v } = await valueOf(leagueId, o.player_id);
  if (o.to_club === me.id && o.status === 'pending') {
    if (action === 'accept') return complete(o, Number(o.amount));
    if (action === 'reject') {
      await inbox(leagueId, o.from_club, `❌ ${me.name} turned down your offer for ${p.name}.`, { title: 'Offer turned down', url: `/l/${leagueId}?tab=market` });
      return finish(o, 'rejected', 'Rejected.');
    }
    if (action === 'counter') {
      const c = Math.round(Math.max(0, Number(amount) || 0) * 10) / 10;
      if (!(c > 0)) fail(400, 'Name your price.');
      await q(`UPDATE offers SET status='countered', counter=$2, updated_at=now() WHERE id=$1`, [o.id, c]);
      const buyer = await one('SELECT * FROM clubs WHERE id=$1', [o.from_club]);
      if (!buyer!.user_id) {
        // an AI club that bid for your player has a limit it keeps to itself, and meets you part of the way
        const limit = Math.round(v * (0.95 + r01(o.id + 7) * 0.45) * 10) / 10;
        if (c <= limit) return complete({ ...o, status: 'countered' }, c);
        const rounds = (o.rounds || 0) + 1;
        if (rounds > 4 || c > v * 3) return finish(o, 'rejected', `${buyer!.name} walked away: "${money(c)} is too much."`);
        const bid = Math.round(Math.min(limit, Number(o.amount) + (c - Number(o.amount)) * 0.5) * 10) / 10;
        await q(`UPDATE offers SET status='pending', amount=$2, counter=NULL, rounds=$3, updated_at=now() WHERE id=$1`, [o.id, bid, rounds]);
        await inbox(leagueId, me.id, `📨 ${buyer!.name} raise their bid for ${p.name} to ${money(bid)}.`, { title: 'Better offer', url: `/l/${leagueId}?tab=market` });
        return { ok: true, status: 'pending', text: `${buyer!.name} come back with ${money(bid)}.` };
      }
      await inbox(leagueId, o.from_club, `↩️ ${me.name} want ${money(c)} for ${p.name}. Accept or walk away in Market › Offers.`, { title: 'Counter-offer', url: `/l/${leagueId}?tab=market` });
      return { ok: true, status: 'countered', text: 'Counter-offer sent.' };
    }
  }
  if (o.from_club === me.id && o.status === 'countered') {
    if (action === 'accept') return complete(o, Number(o.counter));
    if (action === 'withdraw') return finish(o, 'withdrawn', 'Withdrawn.');
    if (action === 'raise') {
      // a new offer of your own: haggling goes on
      const x = Math.round(Math.max(0, Number(amount) || 0) * 10) / 10;
      if (o.kind !== 'swap' && x < 0.1) fail(400, 'Name your offer.');
      if (Number(me.money) < x) fail(400, `You only have ${money(me.money)}.`);
      const seller = await one('SELECT * FROM clubs WHERE id=$1', [o.to_club]);
      await q(`UPDATE offers SET amount=$2, updated_at=now() WHERE id=$1`, [o.id, x]);
      if (!seller!.user_id) {
        const swap = o.swap_player ? await one(`SELECT s.*, p.name, p.ovr + s.ovr_delta AS ovr, p.age + s.age_add AS age, p.pot FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND s.player_id=$2`, [me.id, o.swap_player]) : null;
        if (o.swap_player && !swap) fail(400, 'Your swap player has gone.');
        return o.kind === 'loan' ? botAnswer({ ...o, amount: x }, p, v, seller!, null) : haggle({ ...o, amount: x }, p, v, seller!, swap);
      }
      const rounds = (o.rounds || 0) + 1;
      await q(`UPDATE offers SET status='pending', counter=NULL, rounds=$2, updated_at=now() WHERE id=$1`, [o.id, rounds]);
      await inbox(leagueId, seller!.id, `📨 ${me.name} come back with ${describe(o.kind, x, undefined)} for ${p.name}. Answer in Market › Offers.`, { title: 'New offer', url: `/l/${leagueId}?tab=market` });
      return { ok: true, status: 'pending', text: `New offer sent to ${seller!.name}.` };
    }
  }
  if (o.from_club === me.id && o.status === 'pending' && action === 'withdraw') return finish(o, 'withdrawn', 'Withdrawn.');
  fail(400, 'You can not do that with this offer.');
}

export async function offersView(uid: number, leagueId: number) {
  const l = await getLeague(leagueId);
  const me = await myClub(uid, leagueId);
  const win = await windowFor(l);
  if (!win.open) await q(`UPDATE offers SET status='expired', note='The window closed.', updated_at=now() WHERE league_id=$1 AND status IN ('pending','countered')`, [leagueId]);
  const base = `SELECT o.*, p.name AS player, p.pos, p.ovr + COALESCE(s.ovr_delta,0) AS ovr, sp.name AS swap_name, f.name AS from_name, t.name AS to_name, f.color1 AS from_color, t.color1 AS to_color
    FROM offers o JOIN players p ON p.id=o.player_id LEFT JOIN squad s ON s.league_id=o.league_id AND s.player_id=o.player_id
    LEFT JOIN players sp ON sp.id=o.swap_player JOIN clubs f ON f.id=o.from_club JOIN clubs t ON t.id=o.to_club WHERE o.league_id=$1`;
  const [incoming, outgoing] = await Promise.all([
    q(`${base} AND o.to_club=$2 ORDER BY (o.status IN ('pending','countered')) DESC, o.id DESC LIMIT 20`, [leagueId, me.id]),
    q(`${base} AND o.from_club=$2 ORDER BY (o.status IN ('pending','countered')) DESC, o.id DESC LIMIT 20`, [leagueId, me.id]),
  ]);
  // the last 24 hours before the window shuts
  const deadline = win.open && !!win.closesAt && new Date(win.closesAt).getTime() - Date.now() < 86_400_000;
  return { window: win, deadline, incoming, outgoing, money: Number(me.money) };
}

// On deadline day, bots bid for some of the humans' players: unsettled ones first.
export async function botBids(l: Row, day: number) {
  const humans = await q('SELECT * FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL', [l.id]);
  const bots = await q('SELECT * FROM clubs WHERE league_id=$1 AND user_id IS NULL ORDER BY money DESC', [l.id]);
  if (!bots.length) return;
  for (const h of humans) {
    const r = rng(hashSeed('botbid', l.id, day, h.id));
    const cands = await q(
      `SELECT s.player_id, s.request, p.name, p.attrs, p.ovr + s.ovr_delta AS ovr FROM squad s JOIN players p ON p.id=s.player_id
       WHERE s.club_id=$1 AND s.loan_from IS NULL ORDER BY s.request DESC, p.ovr DESC LIMIT 15`,
      [h.id],
    );
    const p = cands.find((c) => c.request) || (r.next() < 0.75 ? cands[Math.floor(r.next() * cands.length)] : null);
    if (!p) continue;
    const bot = bots[Math.floor(r.next() * Math.min(5, bots.length))];
    const v = Math.max(0.3, p.attrs?.v ?? 2);
    const amount = Math.round(v * (1.05 + r.next() * 0.4) * 10) / 10;
    await q(`INSERT INTO offers (league_id, from_club, to_club, player_id, kind, amount) VALUES ($1,$2,$3,$4,'buy',$5)`, [l.id, bot.id, h.id, p.player_id, amount]);
    await inbox(l.id, h.id, `📨 ${bot.name} bid ${money(amount)} for ${p.name}${p.request ? ' (he asked to leave)' : ''}. Answer in Market › Offers.`, { title: 'New offer', url: `/l/${l.id}?tab=market` });
    await news(l.id, null, 'rumour', `RUMOUR: ${bot.name} are in for ${h.name}'s ${p.name}.`);
  }
}

// AI clubs shop too: during a window up to three of them buy a listed player who improves their weakest
// line, from AI clubs or from managers. Managers who sell get the money and a message.
// Few database requests: one read for every squad, one per purchase.
export async function botShopping(l: Row, day: number) {
  const listings = await q(
    `SELECT li.id, li.player_id, li.price, li.seller_id, p.name, p.pos, p.ovr + COALESCE(s.ovr_delta,0) AS ovr, p.attrs->>'v' AS v, c.user_id AS seller_user, c.name AS seller
     FROM listings li JOIN players p ON p.id=li.player_id JOIN squad s ON s.league_id=li.league_id AND s.player_id=li.player_id JOIN clubs c ON c.id=li.seller_id
     WHERE li.league_id=$1 ORDER BY p.ovr DESC`,
    [l.id],
  );
  if (!listings.length) return;
  const rows = await q(
    `SELECT c.id, c.name, c.money, p.pos, p.ovr + s.ovr_delta AS ovr FROM clubs c JOIN squad s ON s.club_id=c.id JOIN players p ON p.id=s.player_id
     WHERE c.league_id=$1 AND c.user_id IS NULL`,
    [l.id],
  );
  const bots = new Map<number, { id: number; name: string; money: number; sq: Row[] }>();
  for (const r of rows) { const b = bots.get(r.id) || { id: r.id, name: r.name, money: Number(r.money), sq: [] as Row[] }; b.sq.push(r); bots.set(r.id, b); }
  const lineOf = (pos: string) => (pos === 'GK' ? 'GK' : ['CB', 'LB', 'RB'].includes(pos) ? 'DEF' : ['DM', 'CM', 'CAM'].includes(pos) ? 'MID' : 'FWD');
  const sold = new Set<number>();
  let bought = 0;
  for (const b of [...bots.values()].sort((x, y) => y.money - x.money)) {
    if (bought >= 3) break;
    const r = rng(hashSeed('shop', l.id, day, b.id));
    if (r.next() > 0.45 || b.sq.length >= 26) continue;
    const need: [string, number][] = [['DEF', 4], ['MID', 3], ['FWD', 3], ['GK', 1]];
    const avg = (ln: string, n: number) => { const v = b.sq.filter((p) => lineOf(p.pos) === ln).map((p) => p.ovr).sort((x, y) => y - x).slice(0, n); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0; };
    const [weak] = need.map(([ln, n]) => [ln, avg(ln, n)] as [string, number]).sort((x, y) => x[1] - y[1]);
    const pick = listings.find((li) => !sold.has(li.id) && li.seller_id !== b.id && lineOf(li.pos) === weak[0] && li.ovr > weak[1] + 1
      && Number(li.price) <= b.money * 0.6 && Number(li.price) <= Math.max(0.5, Number(li.v) || 1) * 1.35);
    if (!pick) continue;
    const gone = await q('DELETE FROM listings WHERE id=$1 RETURNING id', [pick.id]);
    if (!gone[0]) continue;
    sold.add(pick.id); bought++;
    const w = writes();
    w.add('UPDATE clubs SET money=money-$1 WHERE id=$2', [pick.price, b.id]);
    w.add('UPDATE clubs SET money=money+$1, sales=sales+$1 WHERE id=$2', [pick.price, pick.seller_id]);
    w.add(`UPDATE squad SET club_id=$1, fitness=100, loan_from=NULL WHERE league_id=$2 AND player_id=$3`, [b.id, l.id, pick.player_id]);
    w.add(`DELETE FROM training WHERE league_id=$1 AND player_id=$2 AND done=false`, [l.id, pick.player_id]);
    w.add(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,'transfer',$3)`, [l.id, b.id, `${b.name} sign ${pick.name} from ${pick.seller} for ${Number(pick.price).toFixed(1)}M.`]);
    if (pick.seller_user) w.add(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,'inbox',$3)`, [l.id, pick.seller_id, `💰 ${b.name} bought ${pick.name} for ${Number(pick.price).toFixed(1)}M.`]);
    await w.flush();
    if (pick.seller_user) await notify(pick.seller_user, { title: 'Player sold', body: `${b.name} bought ${pick.name} for ${Number(pick.price).toFixed(1)}M.`, url: `/l/${l.id}` });
  }
}
