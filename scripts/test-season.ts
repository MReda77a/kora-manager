// Full season on an in-memory database. Time is faked by moving kick-offs into the past.
export {};
process.env.PGLITE_DIR ||= 'memory';
const { q, one } = await import('../lib/db.ts');
await (await import('../lib/seed.ts')).ensureSeeded();
const L = await import('../lib/league.ts');
const S = await import('../lib/season.ts');
const C = await import('../lib/club.ts');
const pool = process.argv[2] || 'ENG', size = Number(process.argv[3] || 10);
const t0 = Date.now();
const [u1] = await q(`INSERT INTO users (username, pass_hash) VALUES ('reda','x') RETURNING id`);
const [u2] = await q(`INSERT INTO users (username, pass_hash) VALUES ('friend','x') RETURNING id`);
const lg = await L.createLeague(u1.id, { name: 'Test', pool, maxClubs: size, aiLevel: 2, kickoffUtcMin: 15 * 60 });
await L.createClub(u1.id, lg.id, { name: 'Nile Kings', type: 'fan' });
await L.createClub(u2.id, lg.id, { name: 'Delta Rebels', type: 'fan' });
for (const u of [u1, u2]) {
  for (const k of ['legend', 'gold', 'gold', 'silver', 'silver', 'bronze', 'bronze', 'bronze'] as const) await L.openPack(u.id, lg.id, k).catch((e: any) => console.log(e.message));
  const st = await L.openStaffPack(u.id, lg.id);
  console.log('staff', st.staff.role, st.staff.level);
}
await S.startSeason(u1.id, lg.id);
const days = await q('SELECT day, kind, matchday, round, kickoff_at FROM days WHERE league_id=$1 ORDER BY day', [lg.id]);
console.log('days', days.length, days.map((d) => d.kind[0] + (d.matchday ?? d.round ?? '')).join(' '));
console.log('first kickoff', days[0].kickoff_at);
const cup0 = await S.cupState(lg.id);
console.log('cup', cup0?.name, cup0?.rounds.map((r) => `${r.name}(${r.teams})`).join(' > '), 'R1 pairs', cup0?.rounds[0].pairs.length, 'byes', cup0?.rounds[0].byes.length);
await C.chooseSponsor(u1.id, lg.id, 'bonus');
if (process.env.T1) await L.saveSetup(u1.id, lg.id, { tactic: { preset: process.env.T1, formation: '4-4-2', ...(await import('../lib/game.ts')).stripDesc((await import('../lib/game.ts')).PRESETS[process.env.T1]) } as any });
const c1 = await L.myClub(u1.id, lg.id);
await C.postComment(u1.id, lg.id, { text: 'We are ready for anything.', tone: 'confident' });

let changed = false;
for (const d of days) {
  await q(`UPDATE days SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lg.id, d.day]);
  await q(`UPDATE fixtures SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lg.id, d.day]);
  await S.runDue(lg.id);
  // during the live window: a manager change for user 1
  if (!changed) {
    const lf = await one(`SELECT * FROM fixtures WHERE league_id=$1 AND status='live' AND (home_id=$2 OR away_id=$2) LIMIT 1`, [lg.id, c1.id]);
    if (lf) {
      await q(`UPDATE fixtures SET live_from = now() - interval '60 seconds' WHERE id=$1`, [lf.id]);
      const before = lf.report.events.filter((e: any) => e.m < 50).map((e: any) => e.text).join('|');
      const side = lf.home_id === c1.id ? 0 : 1;
      const r1 = await S.changeLive(u1.id, lf.id, { preset: 'Gegenpress', mentality: 2 });
      const benchId = r1.report.lineups[side].bench[0];
      const onPitch = r1.report.lineups[side].xi[9];
      const r2 = await S.changeLive(u1.id, lf.id, { kind: 'sub', out: onPitch, in: benchId });
      const after = r2.report.events.filter((e: any) => e.m < 50).map((e: any) => e.text).join('|');
      console.log('live change at minute', r1.minute, '| events before identical:', before === after, '| sub logged:', r2.report.events.some((e: any) => e.text.startsWith("Manager's change")));
      changed = true;
    }
  }
  await q(`UPDATE fixtures SET live_until=now()-interval '1 second' WHERE league_id=$1 AND status='live'`, [lg.id]);
  await q(`UPDATE training SET ends_at=now()-interval '1 second' WHERE league_id=$1 AND done=false`, [lg.id]);
  let r = await S.runDue(lg.id);
  while (r.remaining) r = await S.runDue(lg.id);
  if (d.day === 2) {
    const sq = await L.squadOf(c1.id, 3);
    await C.startTraining(u1.id, lg.id, { playerId: sq[5].id, kind: 'attr', target: 'Finishing' });
    await C.startTraining(u1.id, lg.id, { playerId: sq.filter((p) => p.pos !== 'GK')[3].id, kind: 'pos', target: 'CAM' });
  }
}
await C.applyTrainings(lg.id);
const l = await L.getLeague(lg.id);
console.log('status', l.status, 'time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
const table = await L.standings(lg.id);
table.forEach((t, i) => console.log(String(i + 1).padStart(2), (t.user_id ? '*' : ' ') + t.name.padEnd(24), t.p, t.w, t.d, t.l, `${t.gf}-${t.ga}`, t.pts));
const cup = await S.cupState(lg.id);
const cupFx = await q(`SELECT round, home_goals, away_goals, winner_id, report->'shootout' AS so FROM fixtures WHERE league_id=$1 AND comp='cup' ORDER BY round`, [lg.id]);
console.log('cup fixtures', cupFx.length, 'shootouts', cupFx.filter((x) => x.so).length, 'winner', cup?.winner);
const papers = await q(`SELECT day, kind, data->>'headline' AS h, jsonb_array_length(COALESCE(data->'totw'->'players','[]'::jsonb)) AS totw FROM papers WHERE league_id=$1 ORDER BY day LIMIT 6`, [lg.id]);
console.log(papers);
const potm = await q(`SELECT day, data->'nominees'->0->>'name' AS w FROM papers WHERE league_id=$1 AND kind='potm'`, [lg.id]);
console.log('potm', potm);
const tr = await q(`SELECT kind, target, done FROM training WHERE league_id=$1`, [lg.id]);
console.log('training', tr, (await q(`SELECT pos_override, boost FROM squad WHERE league_id=$1 AND (pos_override IS NOT NULL OR boost<>'{}'::jsonb)`, [lg.id])));
const office = await C.officeView(u1.id, lg.id);
console.log('office', office.club, office.objectives.map((o) => `${o.area}: ${o.status}`));
console.log((await q('SELECT text FROM news WHERE league_id=$1 ORDER BY id DESC LIMIT 6', [lg.id])).map((n) => n.text));
process.exit(0);
