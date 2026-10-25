import { handle, requireUser } from '../../../../lib/http.ts';
import { leagueByCode } from '../../../../lib/league.ts';
import { q } from '../../../../lib/db.ts';
import { POOLS } from '../../../../lib/game.ts';

export const dynamic = 'force-dynamic';
export const GET = handle(async (req: Request) => {
  await requireUser();
  const l = await leagueByCode(new URL(req.url).searchParams.get('code') || '');
  const [{ n }] = await q('SELECT COUNT(*)::int AS n FROM clubs WHERE league_id=$1', [l.id]);
  return { id: l.id, name: l.name, pool: POOLS[l.pool], status: l.status, clubs: n, max: l.max_clubs };
});
