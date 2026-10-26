import { body, handle, requireUser } from '../../../lib/http.ts';
import { removeSubscription, saveSubscription, vapidKeys } from '../../../lib/push.ts';

export const dynamic = 'force-dynamic';

// The public key the browser needs to subscribe.
export const GET = handle(async () => ({ publicKey: (await vapidKeys()).publicKey }));

// { subscription } to turn notifications on for this device, { unsubscribe: endpoint } to turn them off.
export const POST = handle(async (req: Request) => {
  const s = await requireUser();
  const b = await body<any>(req);
  if (b.unsubscribe) await removeSubscription(s.uid, String(b.unsubscribe));
  else await saveSubscription(s.uid, b.subscription);
  return { ok: true };
});
