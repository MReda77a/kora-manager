import { body, handle, requireUser } from '../../../../../lib/http.ts';
import { pressConference } from '../../../../../lib/people.ts';

export const dynamic = 'force-dynamic';

// The post-match press conference: one answer per manager.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ fid: string }> }) => {
  const s = await requireUser();
  const { fid } = await ctx.params;
  const b = await body<{ choice: string }>(req);
  return pressConference(s.uid, Number(fid), String(b.choice));
});
