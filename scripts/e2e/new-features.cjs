// New features end to end: divisions, kit clash, plans, roles, live plan switch, VAR/conditions,
// press conference, shot map, offers, deadline day, season end, next season, history, ranking.
const { chromium } = require('playwright');
const S = process.env.S, B = 'http://localhost:8787';
const sql = async (query, params = []) => (await (await fetch('http://localhost:4444/sql', { method: 'POST', body: JSON.stringify({ query, params }) })).json());
const cron = async (n = 16) => { for (let i = 0; i < n; i++) { const r = await (await fetch(`${B}/api/cron?key=cronkey`)).json(); if (!r.remaining) break; } };
let lid;
const advance = async (d) => {
  await sql(`UPDATE days SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, d]);
  await sql(`UPDATE fixtures SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, d]);
  await cron(20);
  await sql(`UPDATE fixtures SET live_until=now()-interval '1 second' WHERE league_id=$1 AND status='live'`, [lid]);
  await cron(24);
};
const tab = async (p, t) => { await p.goto(`${B}/l/${lid}?tab=${t}`); await p.waitForTimeout(1500); const sk = p.locator('.overlay button:has-text("Skip")'); if (await sk.count()) { await sk.click(); await p.waitForTimeout(300); } const later = p.locator('.overlay button:has-text("Later")'); if (await later.count()) await later.click(); };
(async () => {
  const br = await chromium.launch();
  const mk = async () => { const c = await br.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true }); return [c, await c.newPage()]; };
  const errs = [];
  const shot = (p, n) => p.screenshot({ path: `${S}/shots4/${n}.png` });
  const [, p1] = await mk(); p1.on('pageerror', (e) => errs.push('p1 ' + e.message));
  const [, p2] = await mk(); p2.on('pageerror', (e) => errs.push('p2 ' + e.message));
  for (const [p, u] of [[p1, 'reda'], [p2, 'friend']]) {
    await p.goto(B); await p.waitForTimeout(600);
    await p.fill('input[autocomplete=username]', u); await p.fill('input[type=password]', 'secret1');
    await p.click('button.cta'); await p.waitForTimeout(1200);
  }
  await p1.click('text=+ Create league'); await p1.fill('input[placeholder="Friday Night League"]', 'Two Tiers');
  await p1.click('button:has-text("English")'); await p1.click('button:has-text("2 divisions")'); await p1.click('button:has-text("8 clubs")');
  await shot(p1, '01-create-divisions');
  await p1.click('button.cta:has-text("Create league")'); await p1.waitForURL(/\/l\/\d+/); await p1.waitForTimeout(800);
  lid = Number(p1.url().match(/\/l\/(\d+)/)[1]);
  // both clubs in red: the friend's away kit is blue
  await p1.fill('input[placeholder="Red Eagles"]', 'Nile Kings');
  await p1.click('button[aria-label="#C93A4A"] >> nth=0');
  await p1.click('button:has-text("Stripes")');
  await shot(p1, '02-create-club-kits');
  await p1.click('button:has-text("Next: club type")'); await p1.click('button.cta:has-text("Create Nile Kings")'); await p1.waitForTimeout(1200);
  const code = (await p1.textContent('.lz[style*="letter-spacing: 6"]')).trim();
  await p2.click('text=Join with code'); await p2.fill('input[maxlength="6"]', code); await p2.click('button.cta:has-text("Find league")'); await p2.waitForTimeout(700);
  await p2.click('text=Create my club here'); await p2.waitForTimeout(1000);
  await p2.fill('input[placeholder="Red Eagles"]', 'Delta Rebels');
  await p2.click('button[aria-label="#C93A4A"] >> nth=0');
  await p2.click('button[aria-label="#3651C9"] >> nth=2');
  await p2.click('button:has-text("Next: club type")'); await p2.click('button.cta:has-text("Create Delta Rebels")'); await p2.waitForTimeout(1200);
  for (const p of [p1, p2]) {
    await tab(p, 'store'); await p.waitForTimeout(700);
    for (const k of ['Bronze', 'Bronze', 'Bronze', 'Silver', 'Silver', 'Gold', 'Gold', 'Legend']) {
      await p.locator('.panel', { hasText: k }).filter({ has: p.locator('button.cta') }).first().locator('button.cta').click();
      await p.waitForTimeout(k === 'Gold' ? 1600 : 700);
      await p.click('.overlay'); await p.waitForTimeout(250);
    }
  }
  const shape = await sql(`SELECT c.name, SUM((p.pos='GK')::int), SUM((p.pos IN ('CB','LB','RB'))::int), SUM((p.pos IN ('DM','CM','CAM'))::int), SUM((p.pos IN ('LW','RW','ST'))::int), COUNT(*) FROM squad s JOIN players p ON p.id=s.player_id JOIN clubs c ON c.id=s.club_id WHERE c.league_id=$1 GROUP BY c.name`, [lid]);
  console.log('squad shapes GK/DEF/MID/FWD/total', JSON.stringify(shape.rows));
  // Plan B and roles
  await tab(p1, 'tactics'); await p1.waitForTimeout(1200);
  await p1.click('button:has-text("Plan B")'); await p1.click('button:has-text("Create Plan B from Plan A")'); await p1.waitForTimeout(300);
  await p1.click('button.seg:has-text("5-3-2")'); await p1.locator('.row-item:has-text("Low block")').click();
  await shot(p1, '03-plan-b');
  await p1.click('button:has-text("Plan A")'); await p1.click('button.seg:has-text("Roles")'); await p1.waitForTimeout(300);
  const sels = p1.locator('.panel select'); const n = await sels.count();
  for (let i = 0; i < n; i++) { const opts = await sels.nth(i).locator('option').allTextContents(); if (opts[1]) await sels.nth(i).selectOption({ label: opts[1] }); }
  await shot(p1, '04-roles');
  await p1.click('button.seg:has-text("Set pieces")'); await p1.waitForTimeout(300); await p1.click('button.seg:has-text("Near post")'); await shot(p1, '05-setpieces');
  await p1.click('button:has-text("Save tactic")'); await p1.waitForTimeout(900);
  const saved = await sql(`SELECT plans->'B'->>'formation', jsonb_object_keys(roles) FROM clubs WHERE league_id=$1 AND name='Nile Kings' LIMIT 1`, [lid]);
  console.log('saved plan B / a role', JSON.stringify(saved.rows));
  await tab(p1, 'home'); await p1.waitForTimeout(800);
  await p1.click('button:has-text("Start the season")'); await p1.waitForTimeout(4000);
  await p1.reload(); await p1.waitForTimeout(1500); await shot(p1, '06-home-div2');
  await tab(p1, 'table'); await p1.waitForTimeout(1200); await shot(p1, '07-table-div2');
  await p1.click('button.seg:has-text("Premier")'); await p1.waitForTimeout(1200); await shot(p1, '08-table-premier');
  // first human-vs-human match: play earlier days quickly, then watch it live
  const fx = (await sql(`SELECT f.id, f.day FROM fixtures f JOIN clubs h ON h.id=f.home_id JOIN clubs a ON a.id=f.away_id WHERE f.league_id=$1 AND h.user_id IS NOT NULL AND a.user_id IS NOT NULL ORDER BY day LIMIT 1`, [lid])).rows[0];
  const [fid, fday] = [Number(fx[0]), Number(fx[1])];
  for (let d = 1; d < fday; d++) await advance(d);
  await p1.goto(`${B}/m/${fid}`); await p1.waitForTimeout(1500); await shot(p1, '09-prematch-conditions-kits');
  await sql(`UPDATE days SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, fday]);
  await sql(`UPDATE fixtures SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, fday]);
  await p1.goto(`${B}/l/${lid}`); await p1.waitForTimeout(4000);
  await p1.goto(`${B}/m/${fid}`); await p1.waitForTimeout(5000); await shot(p1, '10-live-kits');
  await p1.click('button:has-text("Plan B")'); await p1.waitForTimeout(1200); await shot(p1, '11-live-plan-b');
  // jump to near full time
  await sql(`UPDATE fixtures SET live_from=now()-interval '104 seconds' WHERE id=$1`, [fid]);
  await p1.goto(`${B}/m/${fid}`); await p1.waitForTimeout(12000);
  await sql(`UPDATE fixtures SET live_until=now()-interval '1 second' WHERE league_id=$1 AND status='live'`, [lid]);
  await cron(24);
  await p1.goto(`${B}/m/${fid}?skip=1`); await p1.waitForTimeout(1500); await shot(p1, '12-fulltime');
  await p1.evaluate(() => window.scrollTo(0, 2000)); await p1.waitForTimeout(300); await shot(p1, '13-fulltime-shotmap');
  await p1.click('button:has-text("Praise the players")'); await p1.waitForTimeout(900); await shot(p1, '14-press');
  await p1.setViewportSize({ width: 667, height: 375 }); await p1.reload(); await p1.waitForTimeout(1500); await shot(p1, '14b-small-fulltime'); await p1.setViewportSize({ width: 844, height: 390 });
  const ev = await sql(`SELECT report->'events' FROM fixtures WHERE id=$1`, [fid]);
  console.log('plan B event', JSON.stringify((typeof ev.rows[0][0] === 'string' ? JSON.parse(ev.rows[0][0]) : ev.rows[0][0]).filter((e) => e.type === 'tactic').map((e) => e.text)));
  // VAR anywhere so far?
  const vars = await sql(`SELECT COUNT(*) FROM fixtures f, jsonb_array_elements(f.report->'events') e WHERE f.league_id=$1 AND e->>'type'='var'`, [lid]);
  console.log('VAR events so far', JSON.stringify(vars.rows));
  // advance to the mid-season window
  const half = Number((await sql(`SELECT MAX(matchday)/2 FROM fixtures WHERE league_id=$1 AND comp='league'`, [lid])).rows[0][0]);
  const brk = Number((await sql(`SELECT day FROM days WHERE league_id=$1 AND kind='break'`, [lid])).rows[0][0]);
  for (let d = fday; d <= brk; d++) await advance(d);
  await p1.goto(`${B}/l/${lid}`); await p1.waitForTimeout(1800); await shot(p1, '15-home-window');
  await tab(p1, 'market'); await p1.waitForTimeout(1200);
  await p1.click('button.seg:has-text("Make an offer")'); await p1.waitForTimeout(1500);
  await p1.fill('input[placeholder="Player or club…"]', 'Delta'); await p1.waitForTimeout(300);
  await p1.locator('.row-item').nth(3).click(); await p1.click('button.seg:has-text("Swap")');
  const opt = await p1.locator('aside select option').nth(5).getAttribute('value'); await p1.selectOption('aside select', opt);
  await p1.fill("aside input[type=number]", "0.5"); await shot(p1, "16-make-offer");
  await p1.click('button:has-text("Send offer")'); await p1.waitForTimeout(1200);
  await p2.goto(`${B}/l/${lid}`); await p2.waitForTimeout(1800); await shot(p2, '17-friend-home-offer');
  await tab(p2, 'market'); await p2.waitForTimeout(1500); await shot(p2, '18-friend-offers');
  await p2.fill('input[placeholder="Your price"]', '3'); await p2.click('button.seg:has-text("Counter")'); await p2.waitForTimeout(1000);
  await p1.click('button.seg:has-text("Offers")'); await p1.waitForTimeout(1200); await shot(p1, '19-my-offers-countered');
  const pay = p1.locator('button:has-text("Pay 3.0M")'); if (await pay.count()) { await pay.click(); await p1.waitForTimeout(1200); }
  await shot(p1, '20-deal-done');
  // squad: morale + talk
  await tab(p1, 'players'); await p1.waitForTimeout(1200);
  await p1.click('button:has-text("Have a talk")'); await p1.waitForTimeout(900); await shot(p1, '21-squad-morale');
  await tab(p1, 'office'); await p1.waitForTimeout(1200); await shot(p1, '22-office-inbox-kits');
  // finish the season
  const rest = (await sql(`SELECT day FROM days WHERE league_id=$1 AND processed=false ORDER BY day`, [lid])).rows.map((r) => Number(r[0]));
  for (const d of rest) await advance(d);
  await cron(10);
  console.log('status', JSON.stringify((await sql(`SELECT status, season FROM leagues WHERE id=$1`, [lid])).rows));
  await p1.goto(`${B}/l/${lid}`); await p1.waitForTimeout(1800); await shot(p1, '23-season-over');
  await tab(p1, 'history'); await p1.waitForTimeout(1500); await shot(p1, '24-history');
  await tab(p1, 'home'); await p1.waitForTimeout(800);
  await p1.click('button:has-text("Start season 2")'); await p1.waitForTimeout(5000);
  await p1.reload(); await p1.waitForTimeout(1800); await shot(p1, '25-season-2-home');
  console.log('after rollover', JSON.stringify((await sql(`SELECT status, season FROM leagues WHERE id=$1`, [lid])).rows), JSON.stringify((await sql(`SELECT name, division FROM clubs WHERE league_id=$1 AND user_id IS NOT NULL`, [lid])).rows));
  await tab(p1, 'players'); await p1.waitForTimeout(1300); await shot(p1, '26-season-2-squad');
  await p1.goto(B); await p1.waitForTimeout(1200); await p1.click('button:has-text("Manager ranking")'); await p1.waitForTimeout(400); await shot(p1, '27-ranking');
  // phone portrait-ish small landscape
  console.log('lid', lid, 'errors', errs);
  await br.close();
})();
