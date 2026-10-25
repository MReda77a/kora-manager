import { getSession } from '../../../lib/auth.ts';
import { handle } from '../../../lib/http.ts';
import { myLeagues } from '../../../lib/league.ts';

export const dynamic = 'force-dynamic';
export const GET = handle(async () => {
  const s = await getSession();
  if (!s) return { user: null };
  return { user: { id: s.uid, name: s.name }, leagues: await myLeagues(s.uid) };
});
