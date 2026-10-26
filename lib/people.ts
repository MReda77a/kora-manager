// The human side of the game: morale, personalities, complaints and transfer requests,
// team talks and promises, random club events, press conferences and the manager's inbox.
import { q, one, type Row } from './db.ts';
import { fail } from './errors.ts';
import { traitOf } from './game.ts';
import type { ESide, Report } from './engine.ts';
import { myClub, news } from './league.ts';
import { nextDay } from './club.ts';
import { hashSeed, rng } from './rng.ts';

// A private message for one club's manager. Other managers never see these.
export async function inbox(leagueId: number, clubId: number, text: string) {
  await q(`INSERT INTO news (league_id, club_id, kind, text) VALUES ($1,$2,'inbox',$3)`, [leagueId, clubId, text]);
}

export async function inboxOf(leagueId: number, clubId: number) {
  return q(`SELECT id, text, created_at FROM news WHERE league_id=$1 AND club_id=$2 AND kind='inbox' ORDER BY id DESC LIMIT 30`, [leagueId, clubId]);
}

// After every match of a human club: playing time, results and promises move morale.
export async function moraleAfterMatch(leagueId: number, day: number, clubId: number, side: ESide, rep: Report, won: boolean, lost: boolean) {
  const squad = await q(
    `SELECT s.player_id, s.morale, s.request, s.promise_day, p.name FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1
     ORDER BY p.ovr + s.ovr_delta DESC`,
    [clubId],
  );
  const club = await one('SELECT club_type FROM clubs WHERE id=$1', [clubId]);
  const lines = new Map(rep.players.map((p) => [p.id, p]));
  const rows: { id: string; m: number; req: boolean; pd: number }[] = [];
  for (const [rank, sp] of squad.entries()) {
    const trait = traitOf(sp.player_id);
    const ln = lines.get(sp.player_id);
    const played = !!ln && ln.mins > 0;
    let d = 0;
    if (played) d += 2 + (won ? 3 : lost ? -1 : 0) + (ln!.r >= 8 ? 2 : 0) + (rep.motm === sp.player_id ? 2 : 0);
    // the best players expect to play; squad players accept some bench time; reserves rarely mind
    else if (trait === 'Ambitious' && rank < 20) d -= 5;
    else if (rank < 13) d -= 4;
    else if (rank < 20) d -= 2;
    else if (sp.morale > 55) d -= 1;
    if (!played && won) d += 1;
    if (d < 0 && trait === 'Loyal') d = Math.ceil(d / 2);
    if (trait === 'Temperamental') d = Math.round(d * 1.5);
    if (trait === 'Professional' && sp.morale < 60) d += 1;
    if (club?.club_type === 'historic' && d < 0) d = Math.ceil(d * 0.7); // steady dressing room
    let pd = sp.promise_day || 0;
    if (pd) {
      if (played) pd = 0;
      else if (day >= pd) {
        d -= 25;
        pd = 0;
        await inbox(leagueId, clubId, `${sp.name} is furious: you promised him games and he hasn't played.`);
      }
    }
    const m = Math.max(0, Math.min(100, sp.morale + d));
    let req = sp.request;
    if (m < 40 && sp.morale >= 40) await inbox(leagueId, clubId, `${sp.name} is unhappy with his playing time. Have a talk with him in Players.`);
    if (m < 25 && !req) {
      req = true;
      await inbox(leagueId, clubId, `${sp.name} has handed in a transfer request.`);
      await news(leagueId, clubId, 'rumour', `RUMOUR: ${sp.name} wants out. Clubs are said to be watching.`);
    }
    if (m >= 55 && req) {
      req = false;
      await inbox(leagueId, clubId, `${sp.name} has withdrawn his transfer request. He is happy again.`);
    }
    rows.push({ id: sp.player_id, m, req, pd });
  }
  await q(
    `UPDATE squad s SET morale=x.m, request=x.req, promise_day=x.pd FROM jsonb_to_recordset($1::jsonb) AS x(id text, m int, req boolean, pd int)
     WHERE s.club_id=$2 AND s.player_id=x.id`,
    [JSON.stringify(rows), clubId],
  );
}

// Talk to a player (once every 3 days) or promise him games (he must play within 3 matchdays).
export async function talkTo(uid: number, leagueId: number, playerId: string, kind: string) {
  const club = await myClub(uid, leagueId);
  const sp = await one(`SELECT s.*, p.name FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND s.player_id=$2`, [club.id, playerId]);
  if (!sp) fail(404, 'That player is not in your squad.');
  const day = await nextDay(leagueId);
  const trait = traitOf(playerId);
  if (kind === 'promise') {
    if (sp.promise_day) fail(400, `You already promised ${sp.name} games.`);
    const m = Math.min(100, sp.morale + 20);
    await q('UPDATE squad SET morale=$3, promise_day=$4, request=CASE WHEN $3 >= 55 THEN false ELSE request END WHERE club_id=$1 AND player_id=$2', [club.id, playerId, m, day + 3]);
    return { ok: true, morale: m, text: `${sp.name}: "Thank you, boss. I'll be ready." (He must play in the next 3 days.)` };
  }
  if (sp.talk_day && day - sp.talk_day < 3) fail(400, `You spoke to ${sp.name} recently. Give it ${3 - (day - sp.talk_day)} more day(s).`);
  const leader = (await q('SELECT player_id FROM squad WHERE club_id=$1', [club.id])).some((x) => traitOf(x.player_id) === 'Leader');
  const r = rng(hashSeed('talk', playerId, day)).next();
  const chance = 0.55 + (trait === 'Professional' ? 0.2 : trait === 'Loyal' ? 0.15 : trait === 'Temperamental' ? -0.2 : 0) + (leader ? 0.1 : 0);
  const good = r < chance;
  const gain = good ? (trait === 'Leader' ? 24 : 12) : trait === 'Temperamental' ? -8 : -3;
  const m = Math.max(0, Math.min(100, sp.morale + gain));
  await q('UPDATE squad SET morale=$3, talk_day=$4, request=CASE WHEN $3 >= 55 THEN false ELSE request END WHERE club_id=$1 AND player_id=$2', [club.id, playerId, m, day]);
  return {
    ok: true, morale: m,
    text: good ? `${sp.name} appreciated the chat. Morale up.` : trait === 'Temperamental' ? `${sp.name} stormed out of your office.` : `${sp.name} didn't seem convinced.`,
  };
}

// ~25% of the time per human club per matchday, something happens at the club.
export async function randomEvents(l: Row, day: number) {
  const clubs = await q('SELECT * FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL', [l.id]);
  for (const c of clubs) {
    const r = rng(hashSeed('event', l.id, day, c.id));
    if (r.next() > 0.25) continue;
    const kind = r.pick(['tv', 'sponsor', 'injury', 'protest', 'youth', 'conflict', 'donation', 'injury', 'tv']);
    if (kind === 'tv') {
      const m = 0.5 + Math.round(r.next() * 10) / 10;
      await q('UPDATE clubs SET money=money+$1 WHERE id=$2', [m, c.id]);
      await inbox(l.id, c.id, `📺 A TV channel paid ${m.toFixed(1)}M to film behind the scenes at ${c.name}.`);
    } else if (kind === 'sponsor' && c.sponsor) {
      await q('UPDATE clubs SET money=GREATEST(0, money-0.6) WHERE id=$1', [c.id]);
      await inbox(l.id, c.id, `💼 Your sponsor cut this month's payment after a bad press story: −0.6M.`);
    } else if (kind === 'injury') {
      const p = await one(`SELECT s.player_id, p.name FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND s.out_until < $2 ORDER BY random() LIMIT 1`, [c.id, day]);
      if (!p) continue;
      await q(`UPDATE squad SET out_until=$3, out_reason='Injured in training' WHERE club_id=$1 AND player_id=$2`, [c.id, p.player_id, day + 1 + Math.floor(r.next() * 2)]);
      await inbox(l.id, c.id, `🩹 ${p.name} picked up a knock in training and will miss the next match.`);
    } else if (kind === 'protest') {
      if ((c.board ?? 60) > 55) continue;
      await q('UPDATE clubs SET fans=GREATEST(3000, fans-1200), board=GREATEST(0, board-3) WHERE id=$1', [c.id]);
      await inbox(l.id, c.id, `📢 Fans protested outside ${c.stadium}. Attendance and board confidence drop.`);
      await news(l.id, c.id, 'protest', `Fans protest outside ${c.stadium} as pressure grows on ${c.name}.`);
    } else if (kind === 'youth') {
      const p = await one(`SELECT s.player_id, p.name FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND p.age + s.age_add <= 21 ORDER BY random() LIMIT 1`, [c.id]);
      if (!p) continue;
      await q('UPDATE squad SET ovr_delta=ovr_delta+2, morale=LEAST(100, morale+10) WHERE club_id=$1 AND player_id=$2', [c.id, p.player_id]);
      await inbox(l.id, c.id, `🌱 Breakthrough! ${p.name} has made a big jump in training: +2 overall.`);
    } else if (kind === 'conflict') {
      const ps = await q(`SELECT s.player_id, p.name FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 ORDER BY random() LIMIT 2`, [c.id]);
      if (ps.length < 2) continue;
      await q('UPDATE squad SET morale=GREATEST(0, morale-10) WHERE club_id=$1 AND player_id IN ($2,$3)', [c.id, ps[0].player_id, ps[1].player_id]);
      await inbox(l.id, c.id, `🥊 ${ps[0].name} and ${ps[1].name} clashed in training. Both are sulking (morale −10).`);
    } else if (kind === 'donation') {
      await q('UPDATE clubs SET money=money+1, fans=fans+400 WHERE id=$1', [c.id]);
      await inbox(l.id, c.id, `🎁 A wealthy supporter donated 1M to ${c.name}.`);
    }
  }
}

// Post-match press conference: one answer per manager per match.
export const PRESS: Record<string, { label: string; quote: (club: string, won: boolean) => string }> = {
  praise: { label: 'Praise the players', quote: (c, w) => (w ? `"Every one of them was magnificent today."` : `"I'm proud of the effort. Results will come."`) },
  criticize: { label: 'Demand more', quote: (c, w) => (w ? `"We won, but that was not good enough for ${c}."` : `"That was unacceptable. Some players must look in the mirror."`) },
  referee: { label: 'Blame the referee', quote: () => `"The referee decided this match. Everyone saw it."` },
};
export async function pressConference(uid: number, fixtureId: number, choice: string) {
  if (!PRESS[choice]) fail(400, 'Pick an answer.');
  const f = await one('SELECT * FROM fixtures WHERE id=$1', [fixtureId]);
  if (!f || f.status !== 'done') fail(400, 'The press conference opens after full time.');
  const club = await myClub(uid, f.league_id);
  const side = club.id === f.home_id ? 0 : club.id === f.away_id ? 1 : -1;
  if (side < 0) fail(403, 'This was not your match.');
  const done = await q(`UPDATE fixtures SET press = press || jsonb_build_object($2::text, $3::text) WHERE id=$1 AND NOT (press ? $2::text) RETURNING id`, [f.id, String(side), choice]);
  if (!done[0]) fail(400, 'You already spoke to the press.');
  const [gf, ga] = side === 0 ? [f.home_goals, f.away_goals] : [f.away_goals, f.home_goals];
  const won = f.winner_id ? f.winner_id === club.id : gf > ga;
  const ids = ((f.report?.players || []) as any[]).filter((p) => p.side === side && p.mins > 0).map((p) => p.id);
  const day = await nextDay(f.league_id);
  let effect = '';
  if (choice === 'praise') {
    await q(`UPDATE squad SET morale=LEAST(100, morale+4) WHERE club_id=$1 AND player_id IN (SELECT jsonb_array_elements_text($2::jsonb))`, [club.id, JSON.stringify(ids)]);
    effect = 'Players who played: morale +4.';
  } else if (choice === 'criticize') {
    await q(
      `UPDATE squad SET morale=GREATEST(0, morale-4), form_mod=GREATEST(form_mod, 1), form_until=GREATEST(form_until, $3), form_note='Fired up after criticism'
       WHERE club_id=$1 AND player_id IN (SELECT jsonb_array_elements_text($2::jsonb))`,
      [club.id, JSON.stringify(ids), day],
    );
    effect = 'Morale −4, but they are fired up for the next match (+1).';
  } else {
    await q('UPDATE clubs SET money=GREATEST(0, money-0.3), fans=fans+300 WHERE id=$1', [club.id]);
    effect = 'Fined 0.3M by the league. The fans loved it (+300).';
  }
  const quote = PRESS[choice].quote(club.name, won);
  await news(f.league_id, club.id, 'press', `${club.name} manager: ${quote}`);
  return { ok: true, quote, effect };
}
