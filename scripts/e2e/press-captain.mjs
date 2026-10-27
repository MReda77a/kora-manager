// Captain + derby press conference, end to end through the HTTP API (local worker + fake Neon).
const B = 'http://localhost:8787';
const sqlq = async (query, params = []) => (await (await fetch('http://localhost:4444/sql', { method: 'POST', body: JSON.stringify({ query, params }) })).json()).rows;
const results = [];
const check = (name, ok, info = '') => { results.push([ok ? 'PASS' : 'FAIL', name, info]); console.log(ok ? 'PASS' : 'FAIL', name, info ? `· ${info}` : ''); };
function client() {
  let cookie = '';
  return async (path, body) => {
    const r = await fetch(B + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const j = await r.json().catch(() => ({}));
    if (Array.isArray(j)) return j;
    return { status: r.status, ...j };
  };
}
const cron = async (n = 40) => { for (let i = 0; i < n; i++) { const r = await (await fetch(`${B}/api/cron?key=cronkey`)).json(); if (!r.remaining) break; } };
const tag = Date.now().toString(36).slice(-4);
const A = client(), F = client();
await A('/api/auth/register', { username: `capa${tag}`, password: 'secret1' });
await F('/api/auth/register', { username: `capf${tag}`, password: 'secret1' });
const lg = await A('/api/leagues', { name: 'Press Test', pool: 'ENG', maxClubs: 8, aiLevel: 1, kickoffUtcMin: 15 * 60, divisions: 1 });
const lid = lg.id;
await F(`/api/leagues/join?code=${lg.code}`);
await A(`/api/leagues/${lid}/club`, { name: 'Red Lions', type: 'fan', color1: '#C93A4A', color2: '#F3EEFF' });
await F(`/api/leagues/${lid}/club`, { name: 'Blue Hawks', type: 'fan', color1: '#3651C9', color2: '#F3EEFF' });
for (const C of [A, F]) for (const k of ['bronze', 'bronze', 'silver', 'silver', 'bronze', 'gold', 'gold', 'legend']) await C(`/api/leagues/${lid}/pack`, { pack: k });

// ---------------------------------------------------------------- captain
let sq = await A(`/api/leagues/${lid}/squad`);
check('squad shows leadership for every player', sq.players.every((p) => typeof p.lead === 'number' && p.lead >= 0 && p.lead <= 1), sq.players.slice(0, 4).map((p) => `${p.name.split(' ').pop()} ${p.lead}`).join(', '));
const byLead = [...sq.players].sort((a, b) => b.lead - a.lead);
const capId = byLead[0].id, viceId = byLead[1].id;
const s1 = await A(`/api/leagues/${lid}/setup`, { captain: capId, vice: viceId });
sq = await A(`/api/leagues/${lid}/squad`);
check('set captain and vice', s1.ok && sq.club.captain === capId && sq.club.vice === viceId, s1.note || '');
check('new captain is proud (morale up)', sq.players.find((p) => p.id === capId).morale >= 72, `${sq.players.find((p) => p.id === capId).morale}`);
check('same player cannot be both', (await A(`/api/leagues/${lid}/setup`, { captain: capId, vice: capId }), (await A(`/api/leagues/${lid}/squad`)).club.vice === null));
await A(`/api/leagues/${lid}/setup`, { captain: capId, vice: viceId });
check('a player from another club cannot be captain', (await A(`/api/leagues/${lid}/setup`, { captain: 'nope' }), (await A(`/api/leagues/${lid}/squad`)).club.captain === null));
await A(`/api/leagues/${lid}/setup`, { captain: capId, vice: viceId });
// change captain: the old one is hurt
const s2 = await A(`/api/leagues/${lid}/setup`, { captain: viceId, vice: capId });
sq = await A(`/api/leagues/${lid}/squad`);
check('stripping the armband hurts', /hurt/.test(s2.note || '') && sq.players.find((p) => p.id === capId).morale < 72, s2.note);
await A(`/api/leagues/${lid}/setup`, { captain: capId, vice: viceId });

const st = await A(`/api/leagues/${lid}/start`, {});
check('season starts', st.ok === true, st.error || '');
const ov = await A(`/api/leagues/${lid}/overview`);
const myId = ov.club.id;
const fid = (await sqlq(`SELECT id, day FROM fixtures WHERE league_id=$1 AND comp='league' AND ((home_id=$2 AND away_id IN (SELECT id FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL AND id<>$2)) OR (away_id=$2 AND home_id IN (SELECT id FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL AND id<>$2))) ORDER BY day LIMIT 1`, [lid, myId]))[0];
check('there is a derby in the schedule', !!fid, JSON.stringify(fid));
const [derbyId, derbyDay] = [Number(fid[0]), Number(fid[1])];

// press room before the derby is next: not available yet (unless the derby is day 1)
const firstDay = Number((await sqlq(`SELECT MIN(day) FROM fixtures WHERE league_id=$1 AND (home_id=$2 OR away_id=$2)`, [lid, myId]))[0][0]);
if (firstDay !== derbyDay) check('no press conference before a normal match', (await A(`/api/leagues/${lid}/press`)).available === false);
// play days until the derby is next
const advance = async (d) => {
  await sqlq(`UPDATE days SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, d]);
  await sqlq(`UPDATE fixtures SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, d]);
  await cron();
  await sqlq(`UPDATE fixtures SET live_until=now()-interval '1 second' WHERE league_id=$1 AND status='live'`, [lid]);
  await cron();
};
for (let d = 1; d < derbyDay; d++) await advance(d);

// a match day played with the captain: lineups carry him, the engine knows him
const played = (await sqlq(`SELECT report->'lineups' FROM fixtures WHERE league_id=$1 AND status='done' AND (home_id=$2 OR away_id=$2) ORDER BY day LIMIT 1`, [lid, myId]))[0];
if (played) {
  const lu = typeof played[0] === 'string' ? JSON.parse(played[0]) : played[0];
  check('match report knows each side\'s captain', lu.every((x) => !!x.captain), lu.map((x) => x.captain).join(' / '));
}

const pv = await A(`/api/leagues/${lid}/press`);
check('press conference open before the derby', pv.available === true && pv.derby === true && pv.fixtureId === derbyId, JSON.stringify({ a: pv.available, d: pv.derby, f: pv.fixtureId, want: derbyId }));
check('five questions, 3-4 answers each, effects hidden', pv.questions?.length === 5 && pv.questions.every((q) => q.answers.length >= 3 && q.answers.length <= 4 && q.answers.every((a) => !('fx' in a) && a.face && a.text)), pv.questions?.map((q) => q.text.slice(0, 40)).join(' | '));
check('today panel calls me to the press room', (await A(`/api/leagues/${lid}/today`)).items.some((i) => i.tab === 'press'));
check('same questions when I come back', JSON.stringify((await A(`/api/leagues/${lid}/press`)).questions.map((q) => q.text)) === JSON.stringify(pv.questions.map((q) => q.text)));
check('answers must go in order', (await A(`/api/leagues/${lid}/press`, { q: 2, a: 0 })).status === 400);
// answer: fiery wherever possible
let r;
for (let i = 0; i < pv.questions.length; i++) {
  const ai = Math.max(0, pv.questions[i].answers.findIndex((a) => a.tone === 'fiery'));
  r = await A(`/api/leagues/${lid}/press`, { q: i, a: ai });
  if (i === 0) check('each answer gets a reaction and effect chips', !!r.last?.react && Array.isArray(r.last.chips), `${r.last?.react} ${r.last?.chips?.map((c) => c.t).join(', ')}`);
}
check('press conference done with a headline and a summary', r.done && !!r.summary?.headline && r.summary.lines.length > 0, `${r.summary?.headline} · ${r.summary?.lines.map((l) => l.t).join(' / ')}`);
check('cannot answer twice', (await A(`/api/leagues/${lid}/press`, { q: 0, a: 0 })).status === 400);
const nw = await A(`/api/leagues/${lid}/overview`);
check('my words are in the league news', nw.news.some((n) => n.text.startsWith('🎙️')), nw.news.find((n) => n.text.startsWith('🎙️'))?.text);
// the rival: his last question quotes me
const pf = await F(`/api/leagues/${lid}/press`);
check('rival gets a question about what I said', pf.available && pf.questions.some((q) => /said|seen what/.test(q.text) && !/undefined/.test(q.text) && q.text.includes(r.questions.map((x) => x.answers[x.picked]).find((a) => a.tone === 'fiery')?.text.slice(0, 12) || '§')), pf.questions?.at(-1)?.text);
if (process.env.STOP) { console.log(JSON.stringify({ lid, user: `capf${tag}` })); process.exit(0); }
for (let i = 0; i < pf.questions.length; i++) await F(`/api/leagues/${lid}/press`, { q: i, a: Math.max(0, pf.questions[i].answers.findIndex((a) => a.tone === 'calm')) });

// questions differ between managers and fixtures (variety)
check('different managers get different questions', JSON.stringify(pf.questions.map((q) => q.text)) !== JSON.stringify(pv.questions.map((q) => q.text)));

// the derby: effects reach the match engine
await advance(derbyDay);
const fx = (await sqlq(`SELECT sides, status, report->'derby' FROM fixtures WHERE id=$1`, [derbyId]))[0];
const sides = typeof fx[0] === 'string' ? JSON.parse(fx[0]) : fx[0];
const mine = sides.find((s) => s.clubId === myId), theirs = sides.find((s) => s.clubId !== myId);
check('derby played', fx[1] === 'done', fx[1]);
const eff = (await sqlq(`SELECT effects->'total' FROM pressers WHERE fixture_id=$1 AND club_id=$2`, [derbyId, myId]))[0][0];
const tot = typeof eff === 'string' ? JSON.parse(eff) : eff;
check('press effects reach the match: my boost and the referee as I earned them', mine.boost >= tot.morale - 0.01 && Math.abs((mine.cardMul ?? 1) - tot.ref) < 0.01, `boost ${mine.boost} (morale ${tot.morale}) cards ×${mine.cardMul ?? 1} (earned ×${tot.ref}) · theirs boost ${theirs.boost}`);
check('captain and leaders on the sides', !!mine.captain && mine.leaders && Object.keys(mine.leaders).length >= 1, `${mine.captain} ${JSON.stringify(mine.leaders)}`);
const after = await A(`/api/leagues/${lid}/overview`);
const dr = (await sqlq(`SELECT home_goals, away_goals FROM fixtures WHERE id=$1`, [derbyId]))[0];
check('after the derby the papers judge big words (win or loss)', Number(dr[0]) === Number(dr[1]) || tot.stake < 0.7 || after.news.some((n) => /backed up his words|eating those words/.test(n.text)), after.news.slice(0, 6).map((n) => n.text.slice(0, 60)).join(' | '));
check('press room closes after the match', (await A(`/api/leagues/${lid}/press`)).available === false);

const fails = results.filter((x) => x[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (fails.length) console.log('FAILED:\n' + fails.map((f) => ` - ${f[1]} ${f[2]}`).join('\n'));
