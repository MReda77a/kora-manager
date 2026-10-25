import { one } from '../../../../lib/db.ts';
import { createSession } from '../../../../lib/auth.ts';
import { body, fail, handle } from '../../../../lib/http.ts';
import { checkPassword } from '../../../../lib/password.ts';

export const POST = handle(async (req: Request) => {
  const b = await body<{ username: string; password: string }>(req);
  const u = await one('SELECT * FROM users WHERE lower(username)=lower($1)', [String(b.username || '').trim()]);
  if (!u || !(await checkPassword(String(b.password || ''), u.pass_hash))) fail(401, 'Wrong username or password.');
  await createSession({ uid: u.id, name: u.username });
  return { user: { id: u.id, name: u.username } };
});
