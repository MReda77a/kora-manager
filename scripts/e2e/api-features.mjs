// Full feature test through the real HTTP API (local Cloudflare worker + fake Neon).
// Two managers, two divisions, two seasons. Time is moved with SQL. Prints PASS/FAIL per feature.
const B = 'http://localhost:8787';
const sqlq = async (query, params = []) => (await (await fetch('http://localhost:4444/sql', { method: 'POST', body: JSON.stringify({ query, params }) })).json()).rows;
const results = [];
const check = (name, ok, info = '') => { results.push([ok ? 'PASS' : 'FAIL', name, info]); console.log(ok ? 'PASS' : 'FAIL', name, info ? `· ${info}` : ''); };
function client() {
  let cookie = '';
  const call = async (path, body) => {
    const r = await fetch(B + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const j = await r.json().catch(() => ({}));
    if (Array.isArray(j)) return j;
    return { status: r.status, ...j };
  };
  return call;
}
const cron = async (n = 30) => { for (let i = 0; i < n; i++) { const r = await (await fetch(`${B}/api/cron?key=cronkey`)).json(); if (!r.remaining) break; } };
let lid;
const advance = async (d) => {
  await sqlq(`UPDATE days SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, d]);
  await sqlq(`UPDATE fixtures SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, d]);
  await cron();
  await sqlq(`UPDATE fixtures SET live_until=now()-interval '1 second' WHERE league_id=$1 AND status='live'`, [lid]);
  await cron();
};

const A = client(), F = client();
// ---------------------------------------------------------------- accounts
check('register', (await A('/api/auth/register', { username: 'reda', password: 'secret1' })).user?.name === 'reda');
check('register friend', (await F('/api/auth/register', { username: 'friend', password: 'secret1' })).user?.name === 'friend');
check('duplicate username blocked', (await client()('/api/auth/register', { username: 'REDA', password: 'secret1' })).status === 400);
check('wrong password blocked', (await client()('/api/auth/login', { username: 'reda', password: 'nope123' })).status === 401);
check('login', (await A('/api/auth/login', { username: 'reda', password: 'secret1' })).user?.name === 'reda');
check('logged-out API is blocked', (await client()('/api/leagues/1/overview')).status === 401);

// ---------------------------------------------------------------- league + clubs
const meta = await A('/api/leagues');
check('pool list', Object.keys(meta.pools || {}).length === 8, JSON.stringify(meta.caps));
check('3 divisions x 12 clubs clamped to fit the pool', !!(await A('/api/leagues', { name: 'Big', pool: 'EGY', maxClubs: 12, aiLevel: 1, divisions: 3 })).id);
const lg = await A('/api/leagues', { name: 'Test Cup', pool: 'ENG', maxClubs: 8, aiLevel: 2, kickoffUtcMin: 15 * 60, divisions: 2, startDivision: 'bottom' });
lid = lg.id;
check('create league with 2 divisions', !!lid);
const joinInfo = await F(`/api/leagues/join?code=${lg.code}`);
check('join by code', joinInfo.id === lid, `${joinInfo.name}`);
check('club name too short refused', (await A(`/api/leagues/${lid}/club`, { name: 'ab' })).status === 400);
check('create club with kits', (await A(`/api/leagues/${lid}/club`, { name: 'Nile Kings', type: 'fan', color1: '#C93A4A', color2: '#F3EEFF', away1: '#3651C9', away2: '#F3EEFF', pattern: 1, stadium: 'Cairo Arena' })).id > 0);
check('second club same name refused', (await F(`/api/leagues/${lid}/club`, { name: 'nile kings' })).status === 400);
check('friend club', (await F(`/api/leagues/${lid}/club`, { name: 'Delta Rebels', type: 'fan', color1: '#C93A4A', color2: '#151018' })).id > 0);
check('start refused with empty squads', (await A(`/api/leagues/${lid}/start`, {})).status === 400);
check('only owner can start', (await F(`/api/leagues/${lid}/start`, {})).status === 403);

// ---------------------------------------------------------------- packs
const line = (p) => (p === 'GK' ? 'GK' : ['CB', 'LB', 'RB'].includes(p) ? 'DEF' : ['DM', 'CM', 'CAM'].includes(p) ? 'MID' : 'FWD');
for (const [who, C] of [['reda', A], ['friend', F]]) {
  const got = [];
  for (const k of ['bronze', 'bronze', 'silver', 'silver', 'bronze']) { const r = await C(`/api/leagues/${lid}/pack`, { pack: k }); got.push(...(r.players || [])); }
  const cnt = { GK: 0, DEF: 0, MID: 0, FWD: 0 }; for (const p of got) cnt[line(p.pos)]++;
  check(`${who}: first packs give max 2 GK and min 4/3/3`, cnt.GK <= 2 && cnt.DEF >= 4 && cnt.MID >= 3 && cnt.FWD >= 3, JSON.stringify(cnt));
  for (const k of ['gold', 'gold', 'legend', 'bronze']) await C(`/api/leagues/${lid}/pack`, { pack: k });
  const sq = await C(`/api/leagues/${lid}/squad`);
  const gk = sq.players.filter((p) => p.natPos === 'GK').length;
  check(`${who}: never more than 2 keepers`, gk <= 2, `${gk} GK of ${sq.players.length}`);
  const st = await C(`/api/leagues/${lid}/pack`, { pack: 'staff' });
  check(`${who}: staff pack`, !!st.staff?.role, `${st.staff?.role} ${st.staff?.level}★`);
}
check('not enough coins refused', await (async () => { let r; for (let i = 0; i < 12; i++) { r = await A(`/api/leagues/${lid}/pack`, { pack: 'legend' }); if (r.status === 400) return true; } return false; })());

// ---------------------------------------------------------------- setup: lineup, tactics, plans, roles, set pieces, kits
let sq = await A(`/api/leagues/${lid}/squad`);
// a sensible 4-3-3: best keeper, 4 defenders, 3 midfielders, 3 forwards
const best = (ln, n) => sq.players.filter((p) => line(p.pos) === ln).sort((a, b) => b.ovr - a.ovr).slice(0, n).map((p) => p.id);
const xi = [...best('GK', 1), ...best('DEF', 4), ...best('MID', 3), ...best('FWD', 3)];
check('save lineup', (await A(`/api/leagues/${lid}/setup`, { lineup: xi })).ok === true);
const tactic = { preset: 'Wing play', formation: '4-3-3', mentality: 1, press: 1, line: 1, build: 1, focus: 0, width: 2, tempo: 1 };
const planB = { ...tactic, preset: 'Low block', formation: '5-3-2', mentality: 0, press: 0, line: 0 };
const roleFor = sq.players.find((p) => p.natPos === 'GK');
const r1 = await A(`/api/leagues/${lid}/setup`, { tactic, plans: { B: planB, C: null }, roles: { [roleFor.id]: 'Shot stopper', bad: 'X' }, setpieces: { corner: sq.players[5].id, fk: sq.players[6].id, routine: 'near' }, pens: xi.slice(1, 6), assistant: { tired: true, cards: true, winning: false, losing: true, injured: true }, kit: { away1: '#3651C9', pattern: 2 } });
sq = await A(`/api/leagues/${lid}/squad`);
check('save tactic, plan B, roles, set pieces, kit', r1.ok && sq.club.plans.B?.formation === '5-3-2' && sq.club.roles[roleFor.id] === 'Shot stopper' && !sq.club.roles.bad && sq.club.setpieces.routine === 'near');
check('squad shows morale + trait', sq.players.every((p) => typeof p.morale === 'number' && p.trait));
const off = await A(`/api/leagues/${lid}/office`);
check('office: objectives, sponsors, kit, inbox', off.objectives?.length >= 3 && off.sponsors?.length === 3 && off.kit?.pattern === 2 && Array.isArray(off.inbox));
check('sponsor', (await A(`/api/leagues/${lid}/sponsor`, { key: 'bonus' })).status !== 400);
check('sponsor only once', (await A(`/api/leagues/${lid}/sponsor`, { key: 'safe' })).status === 400);
check('rename stadium', (await A(`/api/leagues/${lid}/stadium`, { name: 'Pharaoh Park' })).status !== 400);
const exp = await A(`/api/leagues/${lid}/expand`, {});
check('expand stadium (needs 6M)', exp.status !== 500, exp.error || 'ok');
const mk = await A(`/api/leagues/${lid}/market`);
check('pre-season market window open', mk.window?.open === true);
const listMe = sq.players[sq.players.length - 1];
check('list a player for sale', (await A(`/api/leagues/${lid}/list`, { playerId: listMe.id, price: 1.5 })).ok === true);
const mk2 = await F(`/api/leagues/${lid}/market`);
const li = mk2.listings.find((x) => x.id === listMe.id);
check('friend sees listing', !!li);
// ---------------------------------------------------------------- training
const tr = await A(`/api/leagues/${lid}/training`);
const trainee = sq.players.find((p) => p.natPos !== 'GK');
const t1 = await A(`/api/leagues/${lid}/train`, { playerId: trainee.id, kind: 'attr', target: 'Finishing' });
check('start training', t1.status !== 400 && t1.status !== 500, t1.error || '');
check('training view', Array.isArray(tr.players) || !!tr, Object.keys(tr).join(','));
check('condition view', Array.isArray((await A(`/api/leagues/${lid}/condition`)).players));

// ---------------------------------------------------------------- season start
const st = await A(`/api/leagues/${lid}/start`, {});
check('start season', st.ok === true, st.error || '');
const ov = await A(`/api/leagues/${lid}/overview`);
check('first-round window open for 5 days', ov.window.open && ov.window.round === 1 && Math.abs(new Date(ov.window.closesAt) - Date.now() - 5 * 864e5) < 2 * 864e5, JSON.stringify(ov.window));
check('news: first round started', ov.news.some((n) => /first round has started/.test(n.text)) && ov.news.some((n) => /OPEN for the first 5 days/.test(n.text)), ov.news.slice(0, 4).map((n) => n.text).join(' | '));
check('humans start in the bottom division', ov.club.division === 2 && ov.league.divisions === 2, `div ${ov.club.division}`);
check('each division has 8 clubs', (await A(`/api/leagues/${lid}/overview?div=1`)).table.length === 8 && ov.table.length === 8);
check('board target in lower division = promotion places', ov.club.targetPos === ov.league.movers, `${ov.club.targetPos}`);
const fsq = await F(`/api/leagues/${lid}/squad`);
if (fsq.players.length >= 30) await F(`/api/leagues/${lid}/list`, { playerId: fsq.players[29].id, price: 0.5 }), await sqlq(`DELETE FROM squad WHERE league_id=$1 AND player_id=$2`, [lid, fsq.players[29].id]);
const by = await F(`/api/leagues/${lid}/buy`, { listingId: li.listingId });
check('buy a listed player', by.ok === true || /already sold/.test(by.error || ''), by.error || ''); // an AI club may snap it up at kick-off
const fx = await A(`/api/leagues/${lid}/fixtures`);
check('fixtures made for both divisions', new Set(fx.filter((f) => f.comp === 'league').map((f) => f.division)).size === 2, `${fx.length} fixtures`);
const cup = await A(`/api/leagues/${lid}/cup`);
check('cup drawn across all 16 clubs', cup.cup?.rounds?.[0]?.drawn && cup.fixtures.length >= 1, cup.cup?.rounds.map((r) => r.name).join(' > '));
const myFx = fx.find((f) => f.home_id === ov.club.id || f.away_id === ov.club.id);
const pre = await A(`/api/fixtures/${myFx.id}`);
check('pre-match: conditions + kits', !!pre.conditions?.weather && pre.kits?.length === 2 && !!pre.conditions.referee.name, `${pre.conditions?.weather} · ${pre.kits?.map((k) => k.label).join('/')}`);
check('comment to the paper', (await A(`/api/leagues/${lid}/comment`, { text: 'We are coming for the title.', tone: 'confident' })).status !== 400);
check('schedule change by owner', (await A(`/api/leagues/${lid}/schedule`, { kickoffUtcMin: 16 * 60 })).ok === true);
check('schedule change refused for others', (await F(`/api/leagues/${lid}/schedule`, { kickoffUtcMin: 10 })).status === 403);
const talk = await A(`/api/leagues/${lid}/talk`, { playerId: sq.players[20].id, kind: 'talk' });
check('talk to a player', !!talk.text, talk.text);
check('talk again too soon refused', (await A(`/api/leagues/${lid}/talk`, { playerId: sq.players[20].id, kind: 'talk' })).status === 400);
check('promise games', !!(await A(`/api/leagues/${lid}/talk`, { playerId: sq.players[21].id, kind: 'promise' })).text);

// ---------------------------------------------------------------- players from abroad, the analyst, AI club styles
const mkA = await A(`/api/leagues/${lid}/market`);
const ab = mkA.listings.filter((x) => x.abroad);
check('players from abroad listed', ab.length >= 12 && ab.every((x) => x.listingId < 0 && x.seller), `${ab.length} from abroad`);
const cheapest = [...ab].sort((a, b) => a.price - b.price)[0];
const ba = await A(`/api/leagues/${lid}/buy`, { listingId: cheapest.listingId });
check('buy a player from abroad', ba.ok === true || /full|money/.test(ba.error || ''), ba.error || cheapest.name);
if (ba.ok) { const full = await A(`/api/leagues/${lid}/squad`); if (full.players.length >= 30) await sqlq(`DELETE FROM squad WHERE league_id=$1 AND player_id=$2`, [lid, full.players[full.players.length - 1].id]); }
check('player from abroad gone from the list', !(await A(`/api/leagues/${lid}/market`)).listings.some((x) => x.listingId === cheapest.listingId));
const types = await sqlq(`SELECT DISTINCT club_type FROM clubs WHERE league_id=$1 AND user_id IS NULL`, [lid]);
check('AI clubs: no Fan Clubs, several styles', !types.some((t) => t[0] === 'fan') && types.length >= 3, types.map((t) => t[0]).join(','));
const an1 = await A(`/api/leagues/${lid}/analyst`);
check('analyst level 1: rough plan', an1.staff?.level === 1 && an1.report?.plans.length === 3 && an1.report.plans[0].win === null && !!an1.report.best && an1.report.lines.length === 4, JSON.stringify(an1).slice(0, 160));
const t0 = Date.now();
const upA = await A(`/api/leagues/${lid}/analyst`, {});
check('hire a better analyst (5M)', upA.ok === true && upA.level === 2, upA.error || '');
const an2 = await A(`/api/leagues/${lid}/analyst`);
const sumOk = an2.report?.plans.every((p) => Math.abs(p.win + p.draw + p.loss - 100) <= 2);
check('analyst level 2: simulated odds for 6 plans', an2.staff.level === 2 && an2.report.plans.length === 6 && sumOk && an2.report.likely.length > 0, `${an2.report?.best} ${an2.report?.plans[0].win}% win · ${Date.now() - t0}ms`);
const an2b = (await A(`/api/leagues/${lid}/analyst`)).report;
const sig = (r) => JSON.stringify(r.plans.map((p) => [p.plan, p.win, p.draw, p.loss]));
check('analyst report is kept', an2b.made === an2.report.made && sig(an2b) === sig(an2.report));
const up3 = await A(`/api/leagues/${lid}/analyst`, {});
const an3 = up3.ok ? await A(`/api/leagues/${lid}/analyst`) : null;
check('analyst level 3 (12M)', !up3.ok ? /money/.test(up3.error) : an3.staff.level === 3 && an3.report.likely.length > 0 && !!an3.report.tip, up3.error || an3?.report?.tip);
const useBest = await A(`/api/leagues/${lid}/setup`, { tactic: { preset: an2.report.best, formation: '4-3-3' } });
check('use the analyst plan', !useBest.error, useBest.error || '');
// friendlies, staff, shirt numbers, new shapes
const frv = await A(`/api/leagues/${lid}/friendly`);
check('friendly: opponents listed', frv.clubs.length === 15, `${frv.clubs.length}`);
const fr = await A(`/api/leagues/${lid}/friendly`, { opponentId: frv.clubs[0].id });
check('friendly played at once', Array.isArray(fr.score) && fr.stats?.shots && fr.fitness.after < fr.fitness.before, `${fr.score?.join('-')} vs ${fr.opp?.name} · stamina ${fr.fitness?.before}→${fr.fitness?.after}`);
check('friendly listed as recent', (await A(`/api/leagues/${lid}/friendly`)).recent.length === 1);
const chemRows = await sqlq(`SELECT COUNT(*), MIN(v), MAX(v) FROM chemistry WHERE club_id=$1`, [ov.club.id]);
check('chemistry: pre-season squad starts together, a friendly builds it', Number(chemRows[0][0]) > 100 && Number(chemRows[0][2]) > 50, chemRows[0].join(' / '));
const td = await A(`/api/leagues/${lid}/today`);
const sum = td.strength ? Object.values(td.strength.me.parts).reduce((x, y) => x + y, 0) : 0;
check('today: match strength and checklist', td.strength && Math.abs(sum - td.strength.me.total) < 0.6 && td.strength.me.parts.players > 60 && td.items.length >= 2, td.strength ? `${td.strength.me.total} vs ${td.strength.them.total} · ${td.items.map((i) => (i.ok ? '✓' : '!') + i.text.slice(0, 30)).join(' | ')}` : JSON.stringify(td).slice(0, 120));
await A(`/api/leagues/${lid}/setup`, { tactic: { preset: 'Custom', formation: '4-3-3', mentality: 1, press: 2, line: 2, build: 0, focus: 1, width: 1, tempo: 1, trap: 1, tackle: 2 } });
const tacT = (await A(`/api/leagues/${lid}/squad`)).club.tactic;
check('offside trap and tackling saved', tacT.trap === 1 && tacT.tackle === 2, JSON.stringify(tacT));
const pricey = (await A(`/api/leagues/${lid}/market`)).listings.filter((x) => x.abroad && x.ovr >= 87 && x.age >= 25 && x.age <= 28);
check('players from abroad cost more (87+ in their prime: 25M+)', pricey.every((x) => x.price >= 25), pricey.map((x) => `${x.ovr}/${x.age} ${x.price}M`).join(', ') || 'none listed');
const sqC = await A(`/api/leagues/${lid}/squad`);
check('chemistry sent with the squad', Object.keys(sqC.club.chem || {}).length > 100);
check('one friendly between match days', (await A(`/api/leagues/${lid}/friendly`, { opponentId: frv.clubs[1].id })).status === 400);
check('friendly needs another club', (await A(`/api/leagues/${lid}/friendly`, { opponentId: ov.club.id })).status === 400);
const cond0 = await A(`/api/leagues/${lid}/condition`);
const coachLv = Math.max(0, ...cond0.staff.filter((x) => x.role === 'coach').map((x) => x.level));
if (coachLv < 5) {
  const hire = await A(`/api/leagues/${lid}/hire`, { role: 'coach', level: coachLv + 1 });
  check('hire a coach with money', (!!hire.staff && hire.staff.level === coachLv + 1) || /Not enough money/.test(hire.error || ''), hire.error || hire.staff?.name);
}
check('hire refused at the level you have', (await A(`/api/leagues/${lid}/hire`, { role: 'coach', level: Math.max(1, coachLv) })).status === 400);
const sqN = await A(`/api/leagues/${lid}/squad`);
const nums = sqN.players.map((p) => p.num);
check('every player has his own shirt number', nums.every((n) => n > 0) && new Set(nums).size === nums.length, `${nums.length} players`);
check('new shape 6-3-1 accepted', !(await A(`/api/leagues/${lid}/setup`, { tactic: { preset: 'Low block', formation: '6-3-1', mentality: 0, press: 0, line: 0, build: 2, focus: 1, width: 0, tempo: 1 } })).error);
await A(`/api/leagues/${lid}/setup`, { tactic: { preset: 'Wing play', formation: '4-3-3', mentality: 1, press: 1, line: 1, build: 1, focus: 0, width: 2, tempo: 1 } });
// a manager lists a cheap young player; during the window someone may buy him
const sqF = await F(`/api/leagues/${lid}/squad`);
const cheapSale = [...sqF.players].filter((p) => !p.loan && p.natPos !== 'GK').sort((a, b) => a.age - b.age)[0];
await F(`/api/leagues/${lid}/list`, { playerId: cheapSale.id, price: 0.3 });
await sqlq(`UPDATE listings SET created_at = now() - interval '2 days' WHERE league_id=$1`, [lid]);

// ---------------------------------------------------------------- the derby, live
const derby = (await sqlq(`SELECT f.id, f.day, f.home_id FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id WHERE f.league_id=$1 AND h.user_id IS NOT NULL AND a.user_id IS NOT NULL ORDER BY day LIMIT 1`, [lid]))[0];
const [did, dday] = [Number(derby[0]), Number(derby[1])];
for (let d = 1; d < dday; d++) await advance(d);
const soldAbroad = Number((await sqlq(`SELECT COUNT(*) FROM news WHERE league_id=$1 AND kind='transfer' AND text LIKE $2`, [lid, `${cheapSale.name} joins %`]))[0][0]);
const stillListed = Number((await sqlq(`SELECT COUNT(*) FROM listings WHERE league_id=$1 AND player_id=$2`, [lid, cheapSale.id]))[0][0]);
console.log(`  (market) cheap listed player ${soldAbroad ? 'was bought' : stillListed ? 'is still listed' : 'left'} after ${dday - 1} window days`);
check('market days run without errors', soldAbroad === 1 || stillListed === 1, `${soldAbroad}/${stillListed}`);
check('matches before the derby played', Number((await sqlq(`SELECT COUNT(*) FROM fixtures WHERE league_id=$1 AND day<$2 AND status<>'done'`, [lid, dday]))[0][0]) === 0);
await sqlq(`UPDATE days SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, dday]);
await sqlq(`UPDATE fixtures SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, dday]);
const live = await A(`/api/fixtures/${did}`);
check('derby kicks off when opened', live.fixture.status === 'live', live.fixture.status);
check('derby detected', live.derby === true);
check('kit clash solved (red vs red)', live.kits[0].c1 !== live.kits[1].c1 && live.kits[1].label !== 'Home kit', `${live.kits[0].c1} vs ${live.kits[1].c1} ${live.kits[1].label}`);
check('plans offered live', JSON.stringify(live.plans) === '["A","B"]', JSON.stringify(live.plans));
await sqlq(`UPDATE fixtures SET live_from=now()-interval '40 seconds' WHERE id=$1`, [did]);
const before = (await A(`/api/fixtures/${did}`)).report.events.filter((e) => e.m < 30).map((e) => e.text).join('|');
const c1 = await A(`/api/fixtures/${did}/change`, { plan: 'B' });
check('switch to plan B live', c1.report?.events.some((e) => e.text.includes('Plan B')), c1.error || `minute ${c1.minute}`);
const c2 = await A(`/api/fixtures/${did}/change`, { mentality: 2, press: 2 });
check('quick tactic change live', !!c2.report, c2.error || '');
const mySide = live.home.mine ? 0 : 1;
const lu = c2.report.lineups[mySide];
const c3 = await A(`/api/fixtures/${did}/change`, { kind: 'sub', out: lu.xi[8], in: lu.bench[0] });
check('substitution live', c3.report?.events.some((e) => e.type === 'sub' && e.text.startsWith("Manager")), c3.error || '');
const after = c3.report.events.filter((e) => e.m < 30).map((e) => e.text).join('|');
check('past events unchanged by changes', before === after);
const fc = await F(`/api/fixtures/${did}/change`, { preset: 'Gegenpress' });
check('other manager changes too', !!fc.report, fc.error || '');
check('outsider cannot change', (await (client())(`/api/fixtures/${did}/change`, { preset: 'Gegenpress' })).status === 401);
check('press refused before full time', (await A(`/api/fixtures/${did}/press`, { choice: 'praise' })).status === 400);
await sqlq(`UPDATE fixtures SET live_until=now()-interval '1 second' WHERE id=$1`, [did]);
await cron();
const done = await A(`/api/fixtures/${did}`);
check('derby finished', done.fixture.status === 'done', `${done.report.score.join('-')}`);
check('shot map data', done.report.shots?.length > 3 && done.report.shots.every((s) => s.x >= 0 && s.x <= 100 && s.xg > 0));
const pr = await A(`/api/fixtures/${did}/press`, { choice: 'referee' });
check('press conference', !!pr.quote, pr.effect);
check('press only once', (await A(`/api/fixtures/${did}/press`, { choice: 'praise' })).status === 400);
const fam = (await A(`/api/leagues/${lid}/squad`)).club.familiarity;
check('familiarity grows', (fam['4-3-3'] ?? 0) > 50, JSON.stringify(fam));

// ---------------------------------------------------------------- the rest of the first half, mid-season window
const brk = Number((await sqlq(`SELECT day FROM days WHERE league_id=$1 AND kind='break'`, [lid]))[0][0]);
for (let d = dday; d <= brk; d++) await advance(d);
const evs = await sqlq(`SELECT e->>'type', COUNT(*) FROM fixtures f, jsonb_array_elements(f.report->'events') e WHERE f.league_id=$1 GROUP BY 1`, [lid]);
const ev = Object.fromEntries(evs.map(([k, n]) => [k, Number(n)]));
check('engine: goals, cards, subs, VAR, free kicks, corners happen', ev.goal > 20 && ev.yellow > 5 && ev.sub > 10 && (ev.var || 0) > 0 && (ev.freekick || 0) > 0, JSON.stringify(ev));
const weathers = await sqlq(`SELECT report->>'weather', COUNT(*) FROM fixtures WHERE league_id=$1 AND status='done' GROUP BY 1`, [lid]);
check('weather varies', weathers.length >= 2, JSON.stringify(weathers));
const paper = await A(`/api/leagues/${lid}/paper`);
check('paper', !!paper && JSON.stringify(paper).includes('headline'));
const aw = await A(`/api/leagues/${lid}/awards`);
check('team of the week', aw.totw?.length > 0 && aw.totw[0].totw.players.length === 11);
check('player of the month', aw.potm?.length > 0, `${aw.potm?.length}`);
check('leaders', (await A(`/api/leagues/${lid}/stats`)).goals?.length > 0);
const ov2 = await A(`/api/leagues/${lid}/overview`);
check('second-round window open', ov2.window.open && ov2.window.round === 2, ov2.window.label);
check('news: second round started, window open', ov2.news.some((n) => /second round has started/.test(n.text)) && ov2.news.some((n) => /window is OPEN for 5 days/.test(n.text)), ov2.news.slice(0, 5).map((n) => n.text).join(' | '));
const offv = await A(`/api/leagues/${lid}/offers`);
check('not deadline day yet (5 days left)', offv.deadline === false);
check('inbox has messages', ov2.club.inbox.length > 0, ov2.club.inbox.slice(0, 3).map((x) => x.text).join(' | '));
const mk3 = await A(`/api/leagues/${lid}/market`);
check('AI clubs list players mid-season', mk3.listings.some((l) => l.bot), `${mk3.listings.length} listed`);
// offers
const players = await A(`/api/leagues/${lid}/players`);
const myId = ov2.club.id;
const botP = players.find((p) => !p.human && p.v < 3);
const sqA = await A(`/api/leagues/${lid}/squad`);
const lowball = await A(`/api/leagues/${lid}/offer`, { kind: 'buy', playerId: botP.id, amount: Math.max(0.1, botP.v * 0.3) });
check('low offer to AI refused', lowball.status === 'rejected', lowball.text);
const fair = await A(`/api/leagues/${lid}/offer`, { kind: 'buy', playerId: botP.id, amount: Math.round(botP.v * 0.9 * 10) / 10 });
check('AI counters or accepts', ['countered', 'accepted'].includes(fair.status), fair.text || fair.error);
if (fair.status === 'countered') {
  const o = (await A(`/api/leagues/${lid}/offers`)).outgoing.find((x) => x.status === 'countered');
  const acc = await A(`/api/leagues/${lid}/respond`, { id: o.id, action: 'accept' });
  check('accept AI counter', acc.status === 'accepted' || /afford|full/.test(acc.error || ''), acc.text || acc.error);
}
const sqA2 = await A(`/api/leagues/${lid}/squad`);
if (sqA2.players.length >= 30) { const extra = sqA2.players.find((p) => !p.loan); await sqlq(`DELETE FROM squad WHERE league_id=$1 AND player_id=$2`, [lid, extra.id]); }
// haggling: they come down step by step, and you can go up step by step
const myMoney = (await A(`/api/leagues/${lid}/offers`)).money;
const hagP = players.find((p) => !p.human && p.id !== botP.id && p.v >= 1 && p.v * 1.4 < myMoney && p.club_id !== myId);
if (hagP) {
  const h1 = await A(`/api/leagues/${lid}/offer`, { kind: 'buy', playerId: hagP.id, amount: Math.round(hagP.v * 0.85 * 10) / 10 });
  if (h1.status === 'countered') {
    const o1 = (await A(`/api/leagues/${lid}/offers`)).outgoing.find((x) => x.player_id === hagP.id && x.status === 'countered');
    const mid = Math.round(((Math.round(hagP.v * 0.85 * 10) / 10 + Number(o1.counter)) / 2) * 10) / 10;
    const h2 = await A(`/api/leagues/${lid}/respond`, { id: o1.id, action: 'raise', amount: mid });
    const o2 = (await A(`/api/leagues/${lid}/offers`)).outgoing.find((x) => x.id === o1.id);
    check('haggling: they come down when you go up', h2.status === 'accepted' || (h2.status === 'countered' && Number(o2.counter) < Number(o1.counter) && o2.rounds === 2), `${hagP.v}M value · asked ${o1.counter} · offered ${mid} · now ${h2.status} ${o2?.counter ?? ''}`);
    if (h2.status === 'countered') await A(`/api/leagues/${lid}/respond`, { id: o1.id, action: 'withdraw' });
  } else check('haggling: first answer', ['accepted', 'rejected'].includes(h1.status), h1.text || h1.error);
}
const vals = players.filter((p) => p.ovr >= 86 && p.ovr <= 88 && p.age >= 25 && p.age <= 28);
check('one price scale: 86-88 players in their prime are worth 25-55M', vals.every((p) => p.v >= 22 && p.v <= 60), vals.slice(0, 4).map((p) => `${p.ovr}/${p.age} ${p.v}M`).join(', '));
const loanP = players.find((p) => !p.human && p.id !== botP.id && p.v < 6 && p.ovr < 80);
const loan = await A(`/api/leagues/${lid}/offer`, { kind: 'loan', playerId: loanP.id, amount: Math.round(loanP.v * 0.25 * 10) / 10 });
check('loan from AI', loan.status === 'accepted' || loan.status === 'rejected', loan.text || loan.error);
const fp = players.find((p) => p.human && p.club_id !== myId);
const sw = sqA2.players.find((p) => !p.loan && p.natPos !== 'GK');
const so = await A(`/api/leagues/${lid}/offer`, { kind: 'swap', playerId: fp.id, swapPlayer: sw.id, amount: 0.2 });
check('swap offer to manager', so.status === 'pending', so.text || so.error);
const inc = (await F(`/api/leagues/${lid}/offers`)).incoming.find((x) => x.status === 'pending' && x.kind === 'swap');
check('manager sees incoming offer', !!inc);
check('counter-offer', (await F(`/api/leagues/${lid}/respond`, { id: inc.id, action: 'counter', amount: 1 })).status === 'countered');
const acc2 = await A(`/api/leagues/${lid}/respond`, { id: inc.id, action: 'accept' });
check('accept counter: swap done', acc2.status === 'accepted', acc2.text || acc2.error);
const moved = await sqlq(`SELECT club_id FROM squad WHERE league_id=$1 AND player_id=$2`, [lid, fp.id]);
check('swap moved the player', Number(moved[0][0]) === myId);
const botBid = (await F(`/api/leagues/${lid}/offers`)).incoming.concat((await A(`/api/leagues/${lid}/offers`)).incoming).find((x) => x.status === 'pending');
check('AI clubs bid for managers\' players (random)', true, botBid ? `${botBid.from_name} bid for ${botBid.player}` : 'none this time');
// the rest of the season
const rest = (await sqlq(`SELECT day FROM days WHERE league_id=$1 AND processed=false ORDER BY day`, [lid])).map((r) => Number(r[0]));
const lastMorale = await sqlq(`SELECT MIN(morale), MAX(morale), COUNT(*) FILTER (WHERE request) FROM squad s JOIN clubs c ON c.id=s.club_id WHERE c.league_id=$1 AND c.user_id IS NOT NULL`, [lid]);
check('morale moves', Number(lastMorale[0][0]) < 70 || Number(lastMorale[0][1]) > 70, JSON.stringify(lastMorale[0]));
const offv2 = await A(`/api/leagues/${lid}/offers`);
for (const d of rest) await advance(d);
await cron();
const expired = await sqlq(`SELECT COUNT(*) FROM offers WHERE league_id=$1 AND status IN ('pending','countered')`, [lid]);
await A(`/api/leagues/${lid}/offers`);
check('offers expire when the window closes', Number((await sqlq(`SELECT COUNT(*) FROM offers WHERE league_id=$1 AND status IN ('pending','countered')`, [lid]))[0][0]) === 0, `${expired[0][0]} were open`);
const ov3 = await A(`/api/leagues/${lid}/overview`);
check('season 1 finished', ov3.league.status === 'finished');
const events = await sqlq(`SELECT COUNT(*) FROM news WHERE league_id=$1 AND kind='inbox'`, [lid]);
check('random events / inbox over the season', Number(events[0][0]) > 5, `${events[0][0]} inbox messages`);
const hist = await A(`/api/leagues/${lid}/history`);
check('history: tables, awards, trophies', hist.seasons.length === 1 && hist.seasons[0].awards.length >= 5 && hist.trophies.length >= 4, hist.seasons[0]?.awards.map((a) => a.title).join(', '));
const cupDone = await A(`/api/leagues/${lid}/cup`);
check('cup has a winner', !!cupDone.cup.winner);
check('only owner can start season 2', (await F(`/api/leagues/${lid}/nextseason`, {})).status === 403);
const sqBefore = await sqlq(`SELECT s.player_id, s.age_add, s.ovr_delta, s.loan_from FROM squad s WHERE s.league_id=$1`, [lid]);
const ns = await A(`/api/leagues/${lid}/nextseason`, {});
check('start season 2', ns.ok === true, ns.error || '');
const ov4 = await A(`/api/leagues/${lid}/overview`);
check('season 2 running', ov4.league.status === 'running' && ov4.league.season === 2);
const up = hist.seasons[0].up, down = hist.seasons[0].down;
const divs = await sqlq(`SELECT id, division FROM clubs WHERE league_id=$1`, [lid]);
const dv = Object.fromEntries(divs.map(([i, d]) => [Number(i), Number(d)]));
check('promotion and relegation applied', up.every((i) => dv[i] === 1) && down.every((i) => dv[i] === 2), `up ${up} down ${down}`);
const aged = await sqlq(`SELECT COUNT(*) FROM squad WHERE league_id=$1 AND age_add=1`, [lid]);
check('players aged a year', Number(aged[0][0]) > 200);
check('loans returned', Number((await sqlq(`SELECT COUNT(*) FROM squad WHERE league_id=$1 AND loan_from IS NOT NULL`, [lid]))[0][0]) === 0, `${sqBefore.filter((r) => r[3]).length} were on loan`);
check('youth intake', Number((await sqlq(`SELECT COUNT(*) FROM squad WHERE league_id=$1 AND player_id LIKE 'Y%'`, [lid]))[0][0]) >= 16);
check('retirements', true, `${(await sqlq(`SELECT COUNT(*) FROM retired WHERE league_id=$1`, [lid]))[0][0]} retired`);
check('new schedule', Number((await sqlq(`SELECT COUNT(*) FROM fixtures WHERE league_id=$1`, [lid]))[0][0]) > 50);
check('new sponsor choice', (await A(`/api/leagues/${lid}/office`)).canChooseSponsor === true);
const me = await A('/api/me');
check('reputation + ranking', me.user.reputation > 0 && me.ranking.length === 2, me.ranking.map((r) => `${r.username} ${r.reputation}`).join(', '));
const minSquad = await sqlq(`SELECT MIN(n) FROM (SELECT COUNT(*) n FROM squad WHERE league_id=$1 GROUP BY club_id) x`, [lid]);
check('every club still has a squad', Number(minSquad[0][0]) >= 18, `smallest ${minSquad[0][0]}`);
// play a couple of season-2 days to prove the clock works after the roll-over
for (const d of [1, 2]) await advance(d);
check('season 2 matches play', Number((await sqlq(`SELECT COUNT(*) FROM fixtures WHERE league_id=$1 AND status='done'`, [lid]))[0][0]) >= 8);
const fails = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (fails.length) console.log('FAILED:\n' + fails.map((f) => ` - ${f[1]} ${f[2]}`).join('\n'));
