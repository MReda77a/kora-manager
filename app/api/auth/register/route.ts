import { q, one } from '../../../../lib/db.ts';
import { createSession } from '../../../../lib/auth.ts';
import { body, fail, handle } from '../../../../lib/http.ts';
import { hashPassword } from '../../../../lib/password.ts';

export const POST = handle(async (req: Request) => {
  const b = await body<{ username: string; password: string }>(req);
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) fail(400, 'Username: 3-20 letters, numbers, _ or .');
  if (password.length < 6) fail(400, 'Password needs at least 6 characters.');
  if (await one('SELECT id FROM users WHERE lower(username)=lower($1)', [username])) fail(400, 'That username is taken.');
  const hash = await hashPassword(password);
  const [u] = await q('INSERT INTO users (username, pass_hash) VALUES ($1,$2) RETURNING id, username', [username, hash]);
  await createSession({ uid: u.id, name: u.username });
  return { user: { id: u.id, name: u.username } };
});
