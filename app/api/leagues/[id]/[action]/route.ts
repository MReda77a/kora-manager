import { q, one } from '../../../../../lib/db.ts';
import { body, fail, handle, requireUser } from '../../../../../lib/http.ts';
import * as L from '../../../../../lib/league.ts';
import { CLUB_TYPES, PACKS, POOLS, type ClubTypeKey } from '../../../../../lib/game.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; action: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const s = await requireUser();
  const { id, action } = await ctx.params;
  const lid = Number(id);
  const l = await L.getLeague(lid);
  const club = await one('SELECT * FROM clubs WHERE league_id=$1 AND user_id=$2', [lid, s.uid]);

  if (action === 'overview') {
    const run = l.status === 'running' ? await L.runDue(lid) : { remaining: 0 };
    const fresh = await L.getLeague(lid);
    const table = await L.standings(lid);
    const win = await L.windowFor(fresh);
    const mine = club
      ? await q(
          `SELECT f.id, f.matchday, f.kickoff_at, f.status, f.home_goals, f.away_goals, f.home_id, f.away_id,
             h.name AS home, h.short AS hs, h.color1 AS hc, h.club_type AS ht, h.user_id AS hu,
             a.name AS away, a.short AS as_, a.color1 AS ac, a.club_type AS at, a.user_id AS au
           FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id
           WHERE f.league_id=$1 AND (f.home_id=$2 OR f.away_id=$2) ORDER BY f.matchday`,
          [lid, club.id],
        )
      : [];
    const news = await q('SELECT kind, text, created_at FROM news WHERE league_id=$1 ORDER BY id DESC LIMIT 20', [lid]);
    const md = await one<{ played: number; total: number }>(
      `SELECT COUNT(DISTINCT matchday) FILTER (WHERE status='done')::int AS played, COUNT(DISTINCT matchday)::int AS total FROM fixtures WHERE league_id=$1`, [lid]);
    let squadSize = 0, gks = 0;
    if (club) {
      const r = await one<{ n: number; g: number }>(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE p.pos='GK')::int g FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1`, [club.id]);
      squadSize = r?.n ?? 0;
      gks = r?.g ?? 0;
    }
    const pos = club ? table.findIndex((t) => t.id === club.id) + 1 : 0;
    return {
      league: { id: fresh.id, name: fresh.name, code: fresh.code, pool: fresh.pool, poolName: POOLS[fresh.pool], status: fresh.status, kickoffUtcMin: fresh.kickoff_utc_min, maxClubs: fresh.max_clubs, aiLevel: fresh.ai_level, interval: fresh.interval_min, intervalLabel: L.INTERVALS[fresh.interval_min], isOwner: fresh.owner_id === s.uid },
      club: club ? { ...club, type: CLUB_TYPES[club.club_type as ClubTypeKey], squadSize, gks, pos, targetPos: CLUB_TYPES[club.club_type as ClubTypeKey].targetPos(fresh.max_clubs) } : null,
      table, window: win, fixtures: mine, news, matchdays: md, pending: run.remaining, now: new Date().toISOString(),
    };
  }
  if (action === 'squad') {
    if (!club) fail(403, 'Create your club first.');
    const players = await L.squadOf(club.id);
    const stats = await q('SELECT * FROM pstats WHERE league_id=$1 AND club_id=$2', [lid, club.id]);
    const listed = await q('SELECT player_id, id, price FROM listings WHERE seller_id=$1', [club.id]);
    const st = new Map(stats.map((x) => [x.player_id, x]));
    const li = new Map(listed.map((x) => [x.player_id, x]));
    const md = await one<{ md: number }>(`SELECT COALESCE(MIN(matchday), 999)::int AS md FROM fixtures WHERE league_id=$1 AND status<>'done'`, [lid]);
    return {
      club: { id: club.id, name: club.name, short: club.short, color1: club.color1, color2: club.color2, tactic: club.tactic, lineup: club.lineup, pens: club.pens, assistant: club.assistant, coins: club.coins, money: Number(club.money) },
      nextMatchday: md?.md ?? 999,
      players: players.map((p) => ({ ...L.pub(p), fitness: p.fitness, outUntil: p.out_until, outReason: p.out_reason, stats: st.get(p.id) || null, listing: li.get(p.id) || null })),
    };
  }
  if (action === 'fixtures') {
    return q(
      `SELECT f.id, f.matchday, f.kickoff_at, f.status, f.home_goals, f.away_goals, f.home_id, f.away_id,
         h.name AS home, h.short AS hs, h.color1 AS hc, a.name AS away, a.short AS as_, a.color1 AS ac
       FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id WHERE f.league_id=$1 ORDER BY f.matchday, f.id`,
      [lid],
    );
  }
  if (action === 'stats') return L.leaders(lid);
  if (action === 'market') {
    const list = await L.market(lid);
    return { window: await L.windowFor(l), money: club ? Number(club.money) : 0, myClub: club?.id ?? null, listings: list.map((p) => ({ ...L.pub(p), listingId: p.listing_id, price: Number(p.price), seller: p.seller, sellerId: p.seller_id, bot: p.bot, listedAt: p.created_at })) };
  }
  if (action === 'clubs') {
    return q(`SELECT c.id, c.name, c.short, c.color1, c.color2, c.club_type, c.user_id IS NOT NULL AS human, u.username,
      (SELECT COUNT(*)::int FROM squad s WHERE s.club_id=c.id) AS players FROM clubs c LEFT JOIN users u ON u.id=c.user_id WHERE c.league_id=$1 ORDER BY c.id`, [lid]);
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
    case 'start': return L.startLeague(s.uid, lid);
    case 'playnow': return L.playNow(s.uid, lid);
    case 'schedule': return L.updateSchedule(s.uid, lid, b);
    case 'pack': {
      if (!(b.pack in PACKS)) fail(400, 'Unknown pack.');
      const l = await L.getLeague(lid);
      if (l.status !== 'setup' && !(await L.windowFor(l)).open) fail(400, 'Packs open in pre-season and in the mid-season window.');
      return L.openPack(s.uid, lid, b.pack);
    }
    case 'setup': return L.saveSetup(s.uid, lid, b);
    case 'list': return L.listPlayer(s.uid, lid, String(b.playerId), Number(b.price));
    case 'unlist': return L.unlist(s.uid, lid, Number(b.listingId));
    case 'buy': return L.buy(s.uid, lid, Number(b.listingId));
  }
  fail(404, 'Unknown action.');
});
