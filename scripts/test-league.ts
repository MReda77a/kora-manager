export {};
// End-to-end season test on an in-memory database: 2 humans + bots, a full season.
process.env.PGLITE_DIR ||= 'memory';
const { q, one } = await import('../lib/db.ts');
const L = await import('../lib/league.ts');
const { PACKS } = await import('../lib/game.ts');

const t0 = Date.now();
const [u1] = await q(`INSERT INTO users (username, pass_hash) VALUES ('reda','x') RETURNING id`);
const [u2] = await q(`INSERT INTO users (username, pass_hash) VALUES ('friend','x') RETURNING id`);
const pool = process.argv[2] || 'ENG';
const size = Number(process.argv[3] || 20);
console.log('max clubs for', pool, await L.maxClubsFor(pool));
const lg = await L.createLeague(u1.id, { name: 'Test League', pool, maxClubs: size, aiLevel: 2, interval: 15 });
const l = await L.getLeague(lg.id);
console.log('league', l.code, 'clubs', l.max_clubs);
await L.createClub(u1.id, l.id, { name: 'Nile Kings', type: 'fan', color1: '#E8438C', color2: '#7FE9F7' });
await L.createClub(u2.id, l.id, { name: 'Delta Rebels', type: 'fan' });

async function buyPacks(uid: number, plan: (keyof typeof PACKS)[]) {
  for (const k of plan) {
    try { await L.openPack(uid, l.id, k); } catch (e: any) { console.log('  pack fail', k, e.message); }
  }
  const c = await L.myClub(uid, l.id);
  const sq = await L.squadOf(c.id);
  const gk = sq.filter((p) => p.pos === 'GK').length;
  console.log(` ${c.name}: ${sq.length} players, ${gk} GK, avg ${(sq.reduce((a, p) => a + p.ovr, 0) / sq.length).toFixed(1)}, top ${sq.map((p) => p.ovr).sort((a, b) => b - a).slice(0, 3)}, coins left ${c.coins}`);
}
// 1000 coins: star-heavy vs depth
await buyPacks(u1.id, ['legend', 'legend', 'gold', 'gold', 'bronze', 'bronze', 'silver', 'bronze']);
await buyPacks(u2.id, ['legend', 'gold', 'gold', 'gold', 'silver', 'silver', 'bronze', 'bronze', 'bronze']);
let extra = 0;
for (const u of [u1, u2]) {
  const c = await L.myClub(u.id, l.id);
  let sq = await L.squadOf(c.id);
  while ((sq.length < 16 || sq.filter((p) => p.pos === 'GK').length < 2) && extra < 10) {
    await L.openPack(u.id, l.id, 'bronze').catch((e) => console.log(e.message));
    sq = await L.squadOf(c.id); extra++;
  }
}
// market before season
const c1 = await L.myClub(u1.id, l.id);
const s1 = await L.squadOf(c1.id);
await L.listPlayer(u1.id, l.id, s1[s1.length - 1].id, 2.5);
await L.startLeague(u1.id, l.id);
const clubs = await q('SELECT COUNT(*)::int n FROM clubs WHERE league_id=$1', [l.id]);
const fx = await q('SELECT COUNT(*)::int n, MAX(matchday)::int md FROM fixtures WHERE league_id=$1', [l.id]);
console.log('started: clubs', clubs[0].n, 'fixtures', fx[0].n, 'matchdays', fx[0].md);
console.log('window', await L.windowFor(await L.getLeague(l.id)));

// play the whole season, matchday by matchday
for (let md = 1; md <= fx[0].md; md++) {
  await L.playNow(u1.id, l.id);
  const lgNow = await L.getLeague(l.id);
  if (md === fx[0].md / 2) {
    console.log('after md', md, 'window', await L.windowFor(lgNow), 'listings', (await L.market(l.id)).length);
  }
}
const table = await L.standings(l.id);
console.log('\nFinal table:');
table.forEach((t, i) => console.log(String(i + 1).padStart(2), (t.user_id ? '*' : ' ') + t.name.padEnd(22), t.p, t.w, t.d, t.l, `${t.gf}-${t.ga}`, t.pts));
const done = await q(`SELECT home_goals+away_goals g, (home_goals=away_goals)::int d FROM fixtures WHERE league_id=$1`, [l.id]);
const bb = await q(`SELECT AVG(home_goals+away_goals)::float g, AVG((report->'stats'->'xg'->>0)::float + (report->'stats'->'xg'->>1)::float)::float xg, AVG((report->'stats'->'shots'->>0)::int)::float sh FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id WHERE f.league_id=$1 AND h.user_id IS NULL AND a.user_id IS NULL`, [l.id]);
console.log('bot-vs-bot', bb[0]);
const pairs = await q(`SELECT report->'tactics'->>0 a, report->'tactics'->>1 b, COUNT(*)::int n, AVG(home_goals+away_goals)::float g FROM fixtures WHERE league_id=$1 GROUP BY 1,2 ORDER BY n DESC LIMIT 12`, [l.id]);
console.table(pairs);
const forms = await q(`SELECT report->'lineups'->0->>'formation' f, COUNT(*)::int n, AVG(home_goals)::float gf, AVG(away_goals)::float ga FROM fixtures WHERE league_id=$1 GROUP BY 1`, [l.id]);
console.table(forms);
console.log('goals/game', (done.reduce((a, r) => a + r.g, 0) / done.length).toFixed(2), 'draws', (done.reduce((a, r) => a + r.d, 0) / done.length * 100).toFixed(0) + '%');
const ld = await L.leaders(l.id);
console.log('top scorers', ld.goals.slice(0, 3).map((p) => `${p.name} (${p.club}) ${p.goals}`));
console.log('status', (await L.getLeague(l.id)).status, 'time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
const news = await q('SELECT kind, text FROM news WHERE league_id=$1 ORDER BY id DESC LIMIT 4', [l.id]);
console.log(news.map((n) => n.text));
const rep = await one(`SELECT report FROM fixtures WHERE league_id=$1 AND report IS NOT NULL LIMIT 1`, [l.id]);
console.log('report events', rep.report.events.length, rep.report.events.slice(0, 4));
process.exit(0);
