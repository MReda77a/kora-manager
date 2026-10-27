// "Today": what a manager should look at before the next match, and how strong the team will be.
// The strength uses the same pieces the match engine adds up, so the numbers mean what they say.
import { q, one } from './db.ts';
import { FIT_WEIGHT, type ESide } from './engine.ts';
import { CLUB_TYPES, FORMATIONS, LINE, offPositionCost, tacticFit, type ClubTypeKey } from './game.ts';
import { getLeague, myClub, windowFor } from './league.ts';
import { previewSides, recentPlans } from './season.ts';

const r1 = (x: number) => Math.round(x * 10) / 10;

/** the pieces of a side's strength, in the engine's own points */
export function strengthOf(s: ESide, home: boolean) {
  const slots = (FORMATIONS[s.tactic.formation] || FORMATIONS['4-3-3']).slots;
  const xi = s.xi;
  const n = Math.max(1, xi.length);
  const players = xi.reduce((a, p) => a + p.ovr, 0) / n;
  const position = -xi.reduce((a, p, i) => a + offPositionCost(LINE[p.pos] || 'MID', slots[i]), 0) / n;
  const form = xi.reduce((a, p) => a + (p.mod || 0), 0) / n;
  const fit = tacticFit(xi.map((p, i) => ({ pos: p.pos, slot: slots[i], ovr: p.ovr, a: p.a })), s.tactic).fit * FIT_WEIGHT;
  const familiarity = ((s.familiarity ?? 60) - 60) / 40;
  const c = (v: number) => ((v ?? 50) - 50) / 50 * 2.5;
  const chemistry = s.chem ? (c(s.chem.DEF) + c(s.chem.MID) + c(s.chem.FWD)) / 3 : 0;
  const tired = xi.reduce((a, p) => a + (100 - p.fitness) / 45, 0) / n;
  const fitness = -Math.min(9, Math.max(0, tired - 0.55) * 10) - (11 - xi.length) * 4;
  const venue = home ? 1.5 + (s.homeBoost || 0) : 0;
  const boost = s.boost || 0;
  const parts = { players, position, form, fit, familiarity, chemistry, fitness, venue, boost };
  const total = Object.values(parts).reduce((a, x) => a + x, 0);
  return { total: r1(total), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r1(v)])) as Record<keyof typeof parts, number> };
}

export async function todayView(uid: number, leagueId: number) {
  const l = await getLeague(leagueId);
  const club = await myClub(uid, leagueId);
  const items: { ok: boolean; text: string; tab: string }[] = [];
  const f = l.status === 'running'
    ? await one(`SELECT * FROM fixtures WHERE league_id=$1 AND status='scheduled' AND (home_id=$2 OR away_id=$2) ORDER BY day, id LIMIT 1`, [leagueId, club.id])
    : null;
  let strength: any = null;
  if (f) {
    const { home, away, hs, as } = await previewSides(l, f);
    const meHome = home.id === club.id;
    const me = meHome ? hs : as, them = meHome ? as : hs, opp = meHome ? away : home;
    const mine = strengthOf(me, meHome), theirs = strengthOf(them, !meHome);
    strength = { me: mine, them: { total: theirs.total }, opp: { id: opp.id, name: opp.name, human: !!opp.user_id, type: opp.user_id ? null : CLUB_TYPES[opp.club_type as ClubTypeKey]?.name }, home: meHome, kickoff: f.kickoff_at, comp: f.comp };

    // the line-up
    const saved: string[] = club.lineup || [];
    const out = await q(`SELECT p.name FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 AND s.out_until >= $2 AND s.player_id IN (SELECT jsonb_array_elements_text($3::jsonb))`, [club.id, f.day, JSON.stringify(saved)]);
    if (saved.length !== 11) items.push({ ok: false, text: 'Pick your line-up for the next match (your assistant picks one otherwise).', tab: 'lineup' });
    else if (out.length) items.push({ ok: false, text: `${out.map((x) => x.name.split(' ').slice(-1)[0]).join(', ')} cannot play: change your line-up.`, tab: 'lineup' });
    else items.push({ ok: true, text: 'Line-up ready.', tab: 'lineup' });
    const tired = me.xi.filter((p) => p.fitness < 70);
    if (tired.length) items.push({ ok: false, text: `${tired.length} tired starter${tired.length > 1 ? 's' : ''} (${tired.map((p) => `${p.name.split(' ').slice(-1)[0]} ${p.fitness}%`).join(', ')}): rest ${tired.length > 1 ? 'them' : 'him'}?`, tab: 'lineup' });
    if (mine.parts.position < -0.3) items.push({ ok: false, text: 'Someone plays out of position: he loses power.', tab: 'lineup' });
    // the plan
    const hist = await recentPlans(leagueId, club.id);
    const now = club.tactic?.preset;
    if (!opp.user_id && hist.length >= 2 && hist.slice(0, 2).every((p) => p === now)) items.push({ ok: false, text: `You played ${now} twice in a row: ${opp.name} will be ready for it.`, tab: 'analyst' });
    else items.push({ ok: true, text: `See how to beat ${opp.name} in the analyst report.`, tab: 'analyst' });
  }
  // the market and the club
  const win = await windowFor(l);
  const [offers, requests, sponsor] = await Promise.all([
    one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM offers WHERE to_club=$1 AND status IN ('pending','countered')`, [club.id]),
    one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM squad WHERE club_id=$1 AND request`, [club.id]),
    Promise.resolve(club.sponsor),
  ]);
  if (offers?.n) items.push({ ok: false, text: `${offers.n} offer${offers.n > 1 ? 's' : ''} for your players are waiting for an answer.`, tab: 'market' });
  if (win.open && win.closesAt) {
    const h = Math.max(0, Math.floor((new Date(win.closesAt).getTime() - Date.now()) / 3_600_000));
    items.push({ ok: true, text: `The transfer window is open: ${h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`} left.`, tab: 'market' });
  }
  if (!sponsor && l.status === 'running') items.push({ ok: false, text: 'Choose a sponsor: no sponsor means less money for every win.', tab: 'office' });
  if (requests?.n) items.push({ ok: false, text: `${requests.n} player${requests.n > 1 ? 's want' : ' wants'} to leave: talk to ${requests.n > 1 ? 'them' : 'him'}.`, tab: 'players' });
  return { strength, items };
}
