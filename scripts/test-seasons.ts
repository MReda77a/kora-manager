// Two full seasons with two divisions on an in-memory database: promotion and relegation, awards,
// aging, youth intake, morale, offers, press conferences and plans. Time is faked.
export {};
process.env.PGLITE_DIR ||= 'memory';
const { q, one } = await import('../lib/db.ts');
await (await import('../lib/seed.ts')).ensureSeeded();
const L = await import('../lib/league.ts');
const S = await import('../lib/season.ts');
const P = await import('../lib/people.ts');
const O = await import('../lib/offers.ts');
const K = await import('../lib/career.ts');
const pool = process.argv[2] || 'ENG', size = Number(process.argv[3] || 8), divs = Number(process.argv[4] || 2);
const t0 = Date.now();
const [u1] = await q(`INSERT INTO users (username, pass_hash) VALUES ('reda','x') RETURNING id`);
const [u2] = await q(`INSERT INTO users (username, pass_hash) VALUES ('friend','x') RETURNING id`);
const lg = await L.createLeague(u1.id, { name: 'Test', pool, maxClubs: size, aiLevel: 2, kickoffUtcMin: 15 * 60, divisions: divs, startDivision: 'bottom' });
await L.createClub(u1.id, lg.id, { name: 'Nile Kings', type: 'fan', color1: '#D62828', color2: '#FFFFFF' });
await L.createClub(u2.id, lg.id, { name: 'Delta Rebels', type: 'academy', color1: '#C81D25', color2: '#111111', away1: '#1D4ED8', away2: '#FFFFFF' });
for (const u of [u1, u2]) {
  for (const k of ['legend', 'gold', 'gold', 'silver', 'silver', 'bronze', 'bronze', 'bronze'] as const) await L.openPack(u.id, lg.id, k).catch((e: any) => console.log(e.message));
  const c = await L.myClub(u.id, lg.id);
  const sq = await q(`SELECT p.pos FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1`, [c.id]);
  const by = (ln: string) => sq.filter((p) => (L as any).LINE?.[p.pos] === ln).length;
  void by;
  const lines: Record<string, number> = {};
  for (const p of sq) { const ln = p.pos === 'GK' ? 'GK' : ['CB', 'LB', 'RB'].includes(p.pos) ? 'DEF' : ['DM', 'CM', 'CAM'].includes(p.pos) ? 'MID' : 'FWD'; lines[ln] = (lines[ln] || 0) + 1; }
  console.log('pack squad', c.name, sq.length, JSON.stringify(lines));
}
const { matchKits } = await import('../lib/game.ts');
const [c1, c2] = [await L.myClub(u1.id, lg.id), await L.myClub(u2.id, lg.id)];
console.log('kits red v red:', matchKits(c1, c2).map((k) => `${k.label} ${k.c1}`).join(' | '));

async function playSeason(n: number) {
  const days = await q('SELECT day, kind, matchday, round FROM days WHERE league_id=$1 ORDER BY day', [lg.id]);
  console.log(`\n=== season ${n}: ${days.length} days`, days.map((d) => d.kind[0] + (d.matchday ?? d.round ?? '')).join(' '));
  let pressed = false, offered = false;
  for (const d of days) {
    await q(`UPDATE days SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lg.id, d.day]);
    await q(`UPDATE fixtures SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lg.id, d.day]);
    await S.runDue(lg.id);
    // a live plan switch for user 1 (plan B = 5-3-2)
    const lf = await one(`SELECT * FROM fixtures WHERE league_id=$1 AND status='live' AND (home_id=$2 OR away_id=$2) LIMIT 1`, [lg.id, c1.id]);
    if (lf && d.day === 3) {
      await q(`UPDATE fixtures SET live_from = now() - interval '60 seconds' WHERE id=$1`, [lf.id]);
      const r = await S.changeLive(u1.id, lf.id, { plan: 'B' });
      console.log('plan B live at', r.minute, r.report.events.filter((e: any) => e.type === 'tactic').map((e: any) => e.text).slice(-1)[0]);
    }
    await q(`UPDATE fixtures SET live_until=now()-interval '1 second' WHERE league_id=$1 AND status='live'`, [lg.id]);
    let r = await S.runDue(lg.id);
    while (r.remaining) r = await S.runDue(lg.id);
    if (!pressed) {
      const f = await one(`SELECT id FROM fixtures WHERE league_id=$1 AND status='done' AND (home_id=$2 OR away_id=$2) LIMIT 1`, [lg.id, c1.id]);
      if (f) { console.log('press', await P.pressConference(u1.id, f.id, 'praise')); pressed = true; }
    }
    // the mid-season window: offers
    const win = await L.windowFor(await L.getLeague(lg.id));
    if (win.open && win.label.startsWith('Mid') && !offered) {
      offered = true;
      const target = await one(`SELECT s.player_id, p.name, p.attrs FROM squad s JOIN players p ON p.id=s.player_id JOIN clubs c ON c.id=s.club_id WHERE c.league_id=$1 AND c.user_id IS NULL ORDER BY p.ovr DESC LIMIT 1 OFFSET 30`, [lg.id]);
      const low = await O.makeOffer(u1.id, lg.id, { kind: 'buy', playerId: target.player_id, amount: Math.round(target.attrs.v * 0.8 * 10) / 10 }).catch((e: any) => ({ text: 'ERR ' + e.message }));
      console.log('offer to bot:', low.text);
      const ov = await O.offersView(u1.id, lg.id);
      const counter = ov.outgoing.find((o: any) => o.status === 'countered');
      if (counter) console.log('accept counter:', (await O.respondOffer(u1.id, lg.id, counter.id, 'accept').catch((e: any) => ({ text: 'ERR ' + e.message }))).text);
      const theirs = await one(`SELECT s.player_id FROM squad s WHERE s.club_id=$1 LIMIT 1 OFFSET 12`, [c2.id]);
      const mine = await one(`SELECT s.player_id FROM squad s WHERE s.club_id=$1 LIMIT 1 OFFSET 12`, [c1.id]);
      console.log('swap to human:', (await O.makeOffer(u1.id, lg.id, { kind: 'swap', playerId: theirs.player_id, swapPlayer: mine.player_id, amount: 0.5 })).text);
      const inc = (await O.offersView(u2.id, lg.id)).incoming.find((o: any) => o.status === 'pending' && o.kind === 'swap');
      console.log('human counters:', (await O.respondOffer(u2.id, lg.id, inc.id, 'counter', 2)).text);
      const out = (await O.offersView(u1.id, lg.id)).outgoing.find((o: any) => o.id === inc.id);
      console.log('accept human counter:', (await O.respondOffer(u1.id, lg.id, out.id, 'accept').catch((e: any) => ({ text: 'ERR ' + e.message }))).text);
      const loanT = await one(`SELECT s.player_id FROM squad s JOIN clubs c ON c.id=s.club_id WHERE c.league_id=$1 AND c.user_id IS NULL ORDER BY s.player_id DESC LIMIT 1`, [lg.id]);
      console.log('loan:', (await O.makeOffer(u2.id, lg.id, { kind: 'loan', playerId: loanT.player_id, amount: 1 }).catch((e: any) => ({ text: 'ERR ' + e.message }))).text);
      console.log('deadline flag:', (await O.offersView(u1.id, lg.id)).deadline, 'bot bids for humans:', (await q(`SELECT COUNT(*)::int AS n FROM offers o JOIN clubs c ON c.id=o.from_club WHERE o.league_id=$1 AND c.user_id IS NULL`, [lg.id]))[0].n);
    }
  }
  const l = await L.getLeague(lg.id);
  console.log('status', l.status, 'season', l.season, 'time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  for (let dv = 1; dv <= divs; dv++) {
    const table = await L.standings(lg.id, dv);
    console.log(`-- ${K.divisionName(dv)}`);
    table.forEach((t, i) => console.log(String(i + 1).padStart(2), (t.user_id ? '*' : ' ') + t.name.padEnd(24), t.p, t.w, t.d, t.l, `${t.gf}-${t.ga}`, t.pts));
  }
  const h = await K.historyView(lg.id);
  console.log('awards', h.seasons[0]?.awards.map((a: any) => `${a.title}: ${a.name} (${a.value})`));
  console.log('trophies', h.trophies.filter((t: any) => t.season === n).map((t: any) => `${t.club}: ${t.label}`));
  console.log('rep', (await K.rankingView()).map((r: any) => `${r.username} ${r.reputation}`).join(', '));
  const mor = await q(`SELECT AVG(morale)::int AS m, MIN(morale) AS lo, COUNT(*) FILTER (WHERE request)::int AS req FROM squad WHERE club_id=$1`, [c1.id]);
  console.log('morale', mor[0], 'inbox', (await P.inboxOf(lg.id, c1.id)).slice(0, 6).map((x: any) => x.text));
}

await L.saveSetup(u1.id, lg.id, { plans: { B: { preset: 'Park the bus', formation: '5-3-2', mentality: 0, press: 0, line: 0, build: 1, focus: 1, width: 1, tempo: 0 } as any } });
await S.startSeason(u1.id, lg.id);
const t = await P.talkTo(u1.id, lg.id, (await one(`SELECT player_id FROM squad WHERE club_id=$1 LIMIT 1`, [c1.id])).player_id, 'talk');
console.log('talk:', t.text);
await playSeason(1);
const before = await q(`SELECT s.player_id, p.age + s.age_add AS age, p.ovr + s.ovr_delta AS ovr FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 ORDER BY p.id`, [c1.id]);
await S.nextSeason(u1.id, lg.id);
const after = await q(`SELECT s.player_id, p.age + s.age_add AS age, p.ovr + s.ovr_delta AS ovr, p.name FROM squad s JOIN players p ON p.id=s.player_id WHERE s.club_id=$1 ORDER BY p.id`, [c1.id]);
console.log('aging sample', after.slice(0, 6).map((a) => { const b = before.find((x) => x.player_id === a.player_id); return b ? `${a.name} ${b.age}->${a.age} ${b.ovr}->${a.ovr}` : `${a.name} NEW ${a.age} ${a.ovr}`; }));
console.log('retired', (await q('SELECT COUNT(*)::int AS n FROM retired WHERE league_id=$1', [lg.id]))[0].n, 'youth', (await q(`SELECT COUNT(*)::int AS n FROM squad WHERE league_id=$1 AND player_id LIKE 'Y%'`, [lg.id]))[0].n);
console.log('divisions now', (await q('SELECT name, division FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL', [lg.id])).map((c) => `${c.name}:${c.division}`));
const bots = await q(`SELECT c.name, COUNT(s.*)::int AS n FROM clubs c LEFT JOIN squad s ON s.club_id=c.id WHERE c.league_id=$1 GROUP BY c.name ORDER BY n LIMIT 3`, [lg.id]);
console.log('smallest squads', bots);
await playSeason(2);
console.log('history seasons', (await K.historyView(lg.id)).seasons.length, 'legends', (await K.historyView(lg.id)).legends.slice(0, 3).map((x: any) => `${x.name} ${x.goals}g ${x.apps}a`));
process.exit(0);
