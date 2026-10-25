import { clearSession } from '../../../../lib/auth.ts';
import { handle } from '../../../../lib/http.ts';

export const POST = handle(async () => {
  await clearSession();
  return { ok: true };
});
