import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE = 'kora_session';

function key() {
  const s = process.env.SESSION_SECRET || 'local-dev-secret-change-me-please-0123456789';
  return new TextEncoder().encode(s);
}

export type Session = { uid: number; name: string };

export async function createSession(s: Session) {
  const token = await new SignJWT({ uid: s.uid, name: s.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('60d')
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 60,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return { uid: Number(payload.uid), name: String(payload.name) };
  } catch {
    return null;
  }
}
