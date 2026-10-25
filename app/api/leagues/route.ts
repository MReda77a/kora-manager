import { body, handle, requireUser } from '../../../lib/http.ts';
import { createLeague, maxClubsFor } from '../../../lib/league.ts';
import { POOLS } from '../../../lib/game.ts';

export const dynamic = 'force-dynamic';
export const GET = handle(async () => {
  const caps: Record<string, number> = {};
  for (const k of Object.keys(POOLS)) caps[k] = await maxClubsFor(k);
  return { pools: POOLS, caps };
});
export const POST = handle(async (req: Request) => {
  const s = await requireUser();
  return createLeague(s.uid, await body(req));
});
