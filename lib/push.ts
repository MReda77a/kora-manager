// Phone notifications (Web Push) for kick-offs, offers and club news, even when the game is closed.
// The server's signing keys are made on first use and kept in the database, so there is nothing to set up.
import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push';
import { q, one } from './db.ts';

const b64url = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let cached: { publicKey: string; privateKey: string } | null = null;
export async function vapidKeys() {
  if (cached) return cached;
  const row = await one<{ v: string }>(`SELECT v FROM meta WHERE k='vapid'`);
  if (row) return (cached = JSON.parse(row.v));
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('raw', pair.publicKey);
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const keys = { publicKey: b64url(pub as ArrayBuffer), privateKey: jwk.d as string };
  // if two requests race, the first saved pair wins
  await q(`INSERT INTO meta (k, v) VALUES ('vapid', $1) ON CONFLICT (k) DO NOTHING`, [JSON.stringify(keys)]);
  const saved = await one<{ v: string }>(`SELECT v FROM meta WHERE k='vapid'`);
  return (cached = JSON.parse(saved!.v));
}

export async function saveSubscription(uid: number, sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Bad subscription');
  await q(
    `INSERT INTO push_subs (endpoint, user_id, keys) VALUES ($1,$2,$3::jsonb) ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, keys=EXCLUDED.keys`,
    [sub.endpoint, uid, JSON.stringify({ p256dh: sub.keys.p256dh, auth: sub.keys.auth })],
  );
}

export async function removeSubscription(uid: number, endpoint: string) {
  await q('DELETE FROM push_subs WHERE endpoint=$1 AND user_id=$2', [endpoint, uid]);
}

// Send to every device of a user. Never throws: a notification must not break a match.
export async function notify(userId: number | null | undefined, msg: { title: string; body: string; url?: string; tag?: string }) {
  if (!userId) return;
  try {
    const subs = await q<{ endpoint: string; keys: { p256dh: string; auth: string } }>('SELECT endpoint, keys FROM push_subs WHERE user_id=$1', [userId]);
    if (!subs.length) return;
    const keys = await vapidKeys();
    const vapid = { subject: 'mailto:kora-manager@users.noreply.github.com', publicKey: keys.publicKey, privateKey: keys.privateKey };
    for (const s of subs) {
      const sub: PushSubscription = { endpoint: s.endpoint, expirationTime: null, keys: s.keys };
      try {
        const payload = await buildPushPayload({ data: JSON.stringify(msg), options: { ttl: 3600, urgency: 'high', topic: msg.tag?.slice(0, 32) } }, sub, vapid);
        const res = await fetch(s.endpoint, payload);
        if (res.status === 404 || res.status === 410) await q('DELETE FROM push_subs WHERE endpoint=$1', [s.endpoint]);
      } catch (e) {
        console.error('push failed', e);
      }
    }
  } catch (e) {
    console.error('notify failed', e);
  }
}

// The same message to several managers with one database read (Cloudflare counts every request).
export async function notifyMany(userIds: (number | null | undefined)[], msg: { title: string; body: string; url?: string; tag?: string }) {
  const ids = userIds.filter((x): x is number => !!x);
  if (!ids.length) return;
  try {
    const subs = await q<{ endpoint: string; keys: { p256dh: string; auth: string } }>('SELECT endpoint, keys FROM push_subs WHERE user_id = ANY($1::int[])', [ids]);
    if (!subs.length) return;
    const keys = await vapidKeys();
    const vapid = { subject: 'mailto:kora-manager@users.noreply.github.com', publicKey: keys.publicKey, privateKey: keys.privateKey };
    await Promise.all(subs.map(async (s) => {
      try {
        const sub: PushSubscription = { endpoint: s.endpoint, expirationTime: null, keys: s.keys };
        const payload = await buildPushPayload({ data: JSON.stringify(msg), options: { ttl: 3600, urgency: 'high', topic: msg.tag?.slice(0, 32) } }, sub, vapid);
        await fetch(s.endpoint, payload);
      } catch (e) { console.error('push failed', e); }
    }));
  } catch (e) {
    console.error('notify failed', e);
  }
}
