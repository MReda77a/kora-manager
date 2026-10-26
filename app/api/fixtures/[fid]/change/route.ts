import { body, handle, requireUser } from '../../../../../lib/http.ts';
import { changeLive } from '../../../../../lib/season.ts';

export const dynamic = 'force-dynamic';

// A manager changes tactics or makes a sub during a live match.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ fid: string }> }) => {
  const s = await requireUser();
  const { fid } = await ctx.params;
  return changeLive(s.uid, Number(fid), await body(req));
});
