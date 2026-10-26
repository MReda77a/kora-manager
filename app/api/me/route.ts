import { getSession } from '../../../lib/auth.ts';
import { handle } from '../../../lib/http.ts';
import { myLeagues } from '../../../lib/league.ts';
import { rankingView } from '../../../lib/career.ts';
import { one } from '../../../lib/db.ts';

export const dynamic = 'force-dynamic';
export const GET = handle(async () => {
  const s = await getSession();
  if (!s) return { user: null };
  const me = await one<{ reputation: number }>('SELECT reputation FROM users WHERE id=$1', [s.uid]);
  return { user: { id: s.uid, name: s.name, reputation: me?.reputation ?? 0 }, leagues: await myLeagues(s.uid), ranking: await rankingView() };
});
