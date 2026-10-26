import { q, one } from '../../../../../lib/db.ts';
import { body, fail, handle, requireUser } from '../../../../../lib/http.ts';
import * as L from '../../../../../lib/league.ts';
import * as S from '../../../../../lib/season.ts';
import * as C from '../../../../../lib/club.ts';
import * as P from '../../../../../lib/people.ts';
import * as O from '../../../../../lib/offers.ts';
import * as K from '../../../../../lib/career.ts';
import { CLUB_TYPES, CUP_NAMES, PACKS, POOLS, traitOf, type ClubTypeKey } from '../../../../../lib/game.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; action: string }> };

const FX_SELECT = `SELECT f.id, f.matchday, f.day, f.comp, f.round, f.division, f.kickoff_at, f.status, f.home_goals, f.away_goals, f.home_id, f.away_id, f.winner_id, f.live_from,
  h.name AS home, h.short AS hs, h.color1 AS hc, h.color2 AS hc2, h.shape AS hsh, h.emblem AS hem, h.club_type AS ht, h.user_id AS hu,
  a.name AS away, a.short AS as_, a.color1 AS ac, a.color2 AS ac2, a.shape AS ash, a.emblem AS aem, a.club_type AS at, a.user_id AS au
  FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id`;

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const s = await requireUser();
  const { id, action } = await ctx.params;
  const lid = Number(id);
  const l = await L.getLeague(lid);
  const club = await one('SELECT * FROM clubs WHERE league_id=$1 AND user_id=$2', [lid, s.uid]);
  const mustClub = () => { if (!club) fail(403, 'Create your club first.'); return club!; };

  if (action === 'overview') {
    const run = l.status === 'running' ? await S.runDue(lid, { light: true }) : { remaining: 0 };
    await C.applyTrainings(lid);
    const fresh = await L.getLeague(lid);
    const divParam = Number(new URL(req.url).searchParams.get('div')) || 0;
    const myDiv = club?.division || 1;
    const division = divParam >= 1 && divParam <= (fresh.divisions || 1) ? divParam : myDiv;
    const table = fresh.status === 'setup' ? [] : await L.standings(lid, division);
    const myTable = division === myDiv ? table : fresh.status === 'setup' ? [] : await L.standings(lid, myDiv);
    const win = await L.windowFor(fresh);
    const mine = club ? await q(`${FX_SELECT} WHERE f.league_id=$1 AND (f.home_id=$2 OR f.away_id=$2) ORDER BY f.day`, [lid, club.id]) : [];
    const newsRows = await q(`SELECT kind, text, created_at FROM news WHERE league_id=$1 AND kind<>'inbox' ORDER BY id DESC LIMIT 20`, [lid]);
    const md = await one<{ played: number; total: number }>(
      `SELECT COUNT(DISTINCT matchday) FILTER (WHERE status='done')::int AS played, COUNT(DISTINCT matchday)::int AS total FROM fixtures WHERE league_id=$1 AND comp='league'`, [lid]);
    let extra: Record<string, unknown> = {};
    if (club) {
      const day = await C.nextDay(lid, club.id);
      const sq = await L.squadOf(club.id, day);
      const xiFit = sq.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 11);
      const star = sq.slice().sort((a, b) => (b.ovr + (b.mod || 0)) - (a.ovr + (a.mod || 0)))[0];
      const stats = star ? await one('SELECT goals, assists, apps FROM pstats WHERE league_id=$1 AND player_id=$2', [lid, star.id]) : null;
      extra = {
        squadSize: sq.length, gks: sq.filter((p) => p.nat_pos === 'GK').length,
        strength: Math.round(xiFit.reduce((a, p) => a + p.ovr, 0) / Math.max(1, xiFit.length)),
        fitness: Math.round(xiFit.reduce((a, p) => a + Math.min(100, p.fitness + 22), 0) / Math.max(1, xiFit.length)),
        morale: Math.round(sq.reduce((a, p) => a + (p.morale ?? 70), 0) / Math.max(1, sq.length)),
        unhappy: sq.filter((p) => (p.morale ?? 70) < 40).length,
        requests: sq.filter((p) => p.request).length,
        inbox: await P.inboxOf(lid, club.id),
        offers: (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM offers WHERE to_club=$1 AND status='pending'`, [club.id]))?.n ?? 0,
        reputation: (await one<{ r: number }>('SELECT reputation AS r FROM users WHERE id=$1', [s.uid]))?.r ?? 0,
        tutorialDone: (await one<{ t: boolean }>('SELECT tutorial_done AS t FROM users WHERE id=$1', [s.uid]))?.t ?? true,
        star: star ? { ...L.pub(star), goals: stats?.goals ?? 0, assists: stats?.assists ?? 0 } : null,
        staff: await C.staffLevels(club.id),
      };
    }
    const pos = club ? myTable.findIndex((t) => t.id === club.id) + 1 : 0;
    const live = mine.filter((f) => f.status === 'live');
    return {
      league: { id: fresh.id, name: fresh.name, code: fresh.code, pool: fresh.pool, poolName: POOLS[fresh.pool], cupName: CUP_NAMES[fresh.pool], status: fresh.status, kickoffUtcMin: fresh.kickoff_utc_min, maxClubs: fresh.max_clubs, aiLevel: fresh.ai_level, isOwner: fresh.owner_id === s.uid,
        season: fresh.season, divisions: fresh.divisions || 1, divisionNames: Array.from({ length: fresh.divisions || 1 }, (_, i) => K.divisionName(i + 1)), movers: K.movers(fresh.max_clubs), startDivision: fresh.start_division },
      club: club ? { ...club, money: Number(club.money), type: CLUB_TYPES[club.club_type as ClubTypeKey], pos, targetPos: (club.division || 1) > 1 ? K.movers(fresh.max_clubs) : CLUB_TYPES[club.club_type as ClubTypeKey].targetPos(fresh.max_clubs), ...extra } : null,
      table, division, window: win, fixtures: mine, live, news: newsRows, matchdays: md, pending: run.remaining, now: new Date().toISOString(),
    };
  }
  if (action === 'squad') {
    const c = mustClub();
    await C.applyTrainings(lid);
    const day = await C.nextDay(lid, c.id);
    const players = await L.squadOf(c.id, day);
    const stats = await q('SELECT * FROM pstats WHERE league_id=$1 AND club_id=$2', [lid, c.id]);
    const listed = await q('SELECT player_id, id, price FROM listings WHERE seller_id=$1', [c.id]);
    const st = new Map(stats.map((x) => [x.player_id, x]));
    const li = new Map(listed.map((x) => [x.player_id, x]));
    const next = await one(`${FX_SELECT} WHERE f.league_id=$1 AND f.status='scheduled' AND (f.home_id=$2 OR f.away_id=$2) ORDER BY f.day LIMIT 1`, [lid, c.id]);
    return {
      club: {
        id: c.id, name: c.name, short: c.short, color1: c.color1, color2: c.color2, tactic: c.tactic, lineup: c.lineup, pens: c.pens, assistant: c.assistant, coins: c.coins, money: Number(c.money),
        plans: c.plans || {}, roles: c.roles || {}, setpieces: c.setpieces || {}, familiarity: c.familiarity || {},
      },
      nextDay: day, next,
      players: players.map((p) => ({ ...L.pub(p), fitness: Math.round(p.fitness), outUntil: p.out_until, outReason: p.out_reason, form: p.form, formNote: p.form ? p.form_note : null, stats: st.get(p.id) || null, listing: li.get(p.id) || null,
        morale: p.morale ?? 70, trait: traitOf(p.id), request: !!p.request, loan: !!p.loan_from, promised: !!p.promise_day, ovrDelta: p.ovr_delta || 0 })),
    };
  }
  if (action === 'offers') return O.offersView(s.uid, lid);
  if (action === 'history') return { ...(await K.historyView(lid)), season: l.season, myClub: club?.id ?? null };
  if (action === 'players') {
    // every club's players, for making offers
    const rows = await q(
      `SELECT p.id, p.name, p.pos, p.age + s.age_add AS age, p.ovr + s.ovr_delta AS ovr, p.attrs->>'v' AS v, s.request, s.loan_from IS NOT NULL AS loan,
         c.id AS club_id, c.name AS club, c.color1, c.user_id IS NOT NULL AS human
       FROM squad s JOIN players p ON p.id=s.player_id JOIN clubs c ON c.id=s.club_id WHERE s.league_id=$1 AND c.id<>$2 ORDER BY p.ovr + s.ovr_delta DESC`,
      [lid, club?.id ?? 0],
    );
    return rows.map((r) => ({ ...r, v: Number(r.v) || 1 }));
  }
  if (action === 'fixtures') return q(`${FX_SELECT} WHERE f.league_id=$1 ORDER BY f.day, f.id`, [lid]);
  if (action === 'stats') return L.leaders(lid);
  if (action === 'market') {
    const list = await L.market(lid);
    return { window: await L.windowFor(l), money: club ? Number(club.money) : 0, myClub: club?.id ?? null, listings: list.map((p) => ({ ...L.pub(p), listingId: p.listing_id, price: Number(p.price), seller: p.seller, sellerId: p.seller_id, bot: p.bot, listedAt: p.created_at })) };
  }
  if (action === 'clubs') {
    return q(`SELECT c.id, c.name, c.short, c.color1, c.color2, c.shape, c.emblem, c.club_type, c.user_id IS NOT NULL AS human, u.username,
      (SELECT COUNT(*)::int FROM squad s WHERE s.club_id=c.id) AS players FROM clubs c LEFT JOIN users u ON u.id=c.user_id WHERE c.league_id=$1 ORDER BY c.id`, [lid]);
  }
  if (action === 'scout') {
    const c = mustClub();
    const next = await one(`SELECT * FROM fixtures WHERE league_id=$1 AND status='scheduled' AND (home_id=$2 OR away_id=$2) ORDER BY day LIMIT 1`, [lid, c.id]);
    if (!next) return { opponent: null };
    const oppId = next.home_id === c.id ? next.away_id : next.home_id;
    const opp = await one('SELECT id, name, user_id, tactic FROM clubs WHERE id=$1', [oppId]);
    const hist = await q(`SELECT report->'tactics' AS t, home_id FROM fixtures WHERE league_id=$1 AND status='done' AND (home_id=$2 OR away_id=$2) ORDER BY day DESC LIMIT 3`, [lid, oppId]);
    const recent = hist.map((h) => (h.t ? h.t[h.home_id === oppId ? 0 : 1] : null)).filter(Boolean);
    const sq = await L.squadOf(oppId, next.day);
    const avg = (arr: any[], k: string) => Math.round(arr.reduce((a, p) => a + (p.attrs[k] ?? 60), 0) / Math.max(1, arr.length));
    const top = (line: string, n: number) => sq.filter((p) => (p.pos === 'GK' ? 'GK' : ['CB', 'LB', 'RB'].includes(p.pos) ? 'DEF' : ['DM', 'CM', 'CAM'].includes(p.pos) ? 'MID' : 'FWD') === line).sort((a, b) => b.ovr - a.ovr).slice(0, n);
    const fw = top('FWD', 3), df = top('DEF', 4), gk = top('GK', 1);
    const mineHist = await q(`SELECT report->'tactics' AS t, home_id FROM fixtures WHERE league_id=$1 AND status='done' AND (home_id=$2 OR away_id=$2) ORDER BY day DESC LIMIT 3`, [lid, c.id]);
    const myRecent = mineHist.map((h) => (h.t ? h.t[h.home_id === c.id ? 0 : 1] : null)).filter(Boolean);
    return {
      myRecent,
      opponent: { id: opp!.id, name: opp!.name, human: !!opp!.user_id, recent, ai: !opp!.user_id },
      stats: { fwdPace: avg(fw, 'Pace'), fwdAir: avg(fw, 'Heading'), defPace: avg(df, 'Pace'), defAir: avg(df, 'Heading'), keeper: avg(gk, 'Reflexes'), strength: Math.round(sq.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 11).reduce((a, p) => a + p.ovr, 0) / 11) },
    };
  }
  if (action === 'training') return C.trainingView(s.uid, lid);
  if (action === 'condition') return C.conditionView(s.uid, lid);
  if (action === 'office') return C.officeView(s.uid, lid);
  if (action === 'paper') return C.paperView(lid, s.uid);
  if (action === 'cup') {
    const cup = await S.cupState(lid);
    const clubs = await q('SELECT id, name, short, color1, color2, shape, emblem, user_id FROM clubs WHERE league_id=$1', [lid]);
    const fx = await q(`${FX_SELECT} WHERE f.league_id=$1 AND f.comp='cup' ORDER BY f.round, f.id`, [lid]);
    return { cup, clubs, fixtures: fx, myClub: club?.id ?? null };
  }
  if (action === 'awards') {
    const totw = await q(`SELECT day, data->'totw' AS totw, data->>'label' AS label FROM papers WHERE league_id=$1 AND kind='paper' AND data ? 'totw' ORDER BY day DESC LIMIT 6`, [lid]);
    const potm = await q(`SELECT day, data FROM papers WHERE league_id=$1 AND kind='potm' ORDER BY day DESC LIMIT 6`, [lid]);
    return { totw, potm: potm.map((p) => ({ day: p.day, ...p.data })), myClub: club?.id ?? null };
  }
  fail(404, 'Unknown action.');
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const s = await requireUser();
  const { id, action } = await ctx.params;
  const lid = Number(id);
  const b = await body<any>(req).catch(() => ({}));
  switch (action) {
    case 'club': return L.createClub(s.uid, lid, b);
    case 'start': return S.startSeason(s.uid, lid);
    case 'schedule': return L.updateSchedule(s.uid, lid, b);
    case 'pack': {
      const l = await L.getLeague(lid);
      if (l.status !== 'setup' && !(await L.windowFor(l)).open) fail(400, 'Packs open in pre-season and in the mid-season window.');
      if (b.pack === 'staff') return L.openStaffPack(s.uid, lid);
      if (!(b.pack in PACKS)) fail(400, 'Unknown pack.');
      return L.openPack(s.uid, lid, b.pack);
    }
    case 'setup': return L.saveSetup(s.uid, lid, b);
    case 'list': return L.listPlayer(s.uid, lid, String(b.playerId), Number(b.price));
    case 'unlist': return L.unlist(s.uid, lid, Number(b.listingId));
    case 'buy': return L.buy(s.uid, lid, Number(b.listingId));
    case 'train': return C.startTraining(s.uid, lid, b);
    case 'untrain': return C.cancelTraining(s.uid, lid, Number(b.id));
    case 'sponsor': return C.chooseSponsor(s.uid, lid, String(b.key));
    case 'stadium': return C.renameStadium(s.uid, lid, String(b.name));
    case 'expand': return C.expandStadium(s.uid, lid);
    case 'comment': return C.postComment(s.uid, lid, b);
    case 'nextseason': return S.nextSeason(s.uid, lid);
    case 'tutorial': await q('UPDATE users SET tutorial_done=true WHERE id=$1', [s.uid]); return { ok: true };
    case 'offer': return O.makeOffer(s.uid, lid, b);
    case 'respond': return O.respondOffer(s.uid, lid, Number(b.id), String(b.action), Number(b.amount));
    case 'talk': return P.talkTo(s.uid, lid, String(b.playerId), String(b.kind));
  }
  fail(404, 'Unknown action.');
});
