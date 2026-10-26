// Every screen at several screen sizes: screenshots plus automatic layout checks
// (page wider than the screen, elements sticking out, text cut off without "…").
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.env.S, B = 'http://localhost:8787', lid = Number(process.env.LID || 2);
const sql = async (query, params = []) => (await (await fetch('http://localhost:4444/sql', { method: 'POST', body: JSON.stringify({ query, params }) })).json()).rows;
const SIZES = (process.env.SIZES || '568x320,667x375,844x390,932x430,1024x768,1440x900,390x844').split(',');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const TABS = ['home', 'lineup', 'tactics', 'players', 'training', 'condition', 'office', 'store', 'market', 'table', 'fixtures', 'cup', 'paper', 'awards', 'leaders', 'history'];

function audit() {
  const vw = innerWidth, vh = innerHeight;
  const out = { pageX: document.documentElement.scrollWidth > vw + 1, sticking: [], clipped: [] };
  const clipsX = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.overflowX !== 'visible' || s.overflow !== 'visible') return a; } return null; };
  const label = (el) => (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed' && el.classList.contains('rotate')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if ((r.right > vw + 2 || r.left < -2) && !clipsX(el) && !el.closest('.ticker,.crowd,.conf,.ov,[aria-hidden=true]') && s.position !== 'absolute') out.sticking.push(`${el.tagName.toLowerCase()} "${label(el)}" ${Math.round(r.left)}-${Math.round(r.right)}`);
    // text cut off: a text element whose content is wider than its box, hidden, and not ellipsised
    if (el.closest('svg')) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    // content pushed outside a box that hides overflow (so the player can't see it)
    if ((hasText || ['BUTTON', 'INPUT', 'SELECT', 'A'].includes(el.tagName)) && !el.closest('.ticker,.crowd,.ov,.overlay .conf,[aria-hidden=true]')) {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflowX === 'auto' || as.overflowX === 'scroll') break;
        if (as.overflowX === 'hidden' || as.overflow === 'hidden' || as.clipPath !== 'none' && false) {
          const ar = a.getBoundingClientRect();
          if (r.right > ar.right + 3 || r.left < ar.left - 3) out.clipped.push(`hidden-x ${el.tagName.toLowerCase()} "${label(el)}" ${Math.round(r.left)}-${Math.round(r.right)} in ${Math.round(ar.left)}-${Math.round(ar.right)}`);
          break;
        }
      }
    }
    if (hasText && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && (s.overflowX === 'hidden' || s.overflow === 'hidden') && s.textOverflow !== 'ellipsis' && !el.closest('.ticker')) out.clipped.push(`${el.tagName.toLowerCase()} "${label(el)}" ${el.scrollWidth}>${el.clientWidth}`);
    // text that spills over its parent without wrapping (no overflow handling)
    if (hasText && s.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 2 && s.overflowX === 'visible' && s.textOverflow !== 'ellipsis' && el.clientWidth > 0 && !el.closest('.ticker,.ov')) out.clipped.push(`spill ${el.tagName.toLowerCase()} "${label(el)}" ${el.scrollWidth}>${el.clientWidth}`);
  }
  out.sticking = [...new Set(out.sticking)].slice(0, 8); out.clipped = [...new Set(out.clipped)].slice(0, 8);
  return out;
}

(async () => {
  const br = await chromium.launch();
  const report = {};
  const errs = [];
  // fixtures to show
  const club = (await sql(`SELECT c.id FROM clubs c JOIN users u ON u.id=c.user_id WHERE c.league_id=$1 AND u.username='reda'`, [lid]))[0][0];
  const done = (await sql(`SELECT id FROM fixtures WHERE league_id=$1 AND status='done' AND (home_id=$2 OR away_id=$2) ORDER BY day DESC LIMIT 1`, [lid, club]))[0][0];
  const sched = (await sql(`SELECT id, day FROM fixtures WHERE league_id=$1 AND status='scheduled' AND (home_id=$2 OR away_id=$2) ORDER BY day LIMIT 2`, [lid, club]));
  const pre = sched[1][0];
  // make one of reda's matches live
  const liveDay = sched[0][1];
  await sql(`UPDATE days SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, liveDay]);
  await sql(`UPDATE fixtures SET kickoff_at=now()-interval '1 second' WHERE league_id=$1 AND day=$2`, [lid, liveDay]);
  for (let i = 0; i < 30; i++) { const r = await (await fetch(`${B}/api/cron?key=cronkey`)).json(); if (!r.remaining) break; }
  const live = sched[0][0];
  const setupLeague = (await sql(`SELECT id FROM leagues WHERE status='setup' LIMIT 1`))[0]?.[0];
  for (const size of SIZES) {
    const [w, h] = size.split('x').map(Number);
    const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 1000, isMobile: w < 1000 });
    const p = await ctx.newPage(); p.setDefaultTimeout(5000);
    p.on('pageerror', (e) => errs.push(`${size} ${p.url()} ${e.message}`));
    p.on('response', (r) => { if (r.status() >= 500) errs.push(`${size} ${r.status()} ${r.url()}`); });
    const act = async (what, fn) => { try { await fn(); } catch (e) { errs.push(`${size} ACTION FAILED: ${what} (${String(e.message).split('\n')[0]})`); } };
    const dir = `${S}/ui/${size}`; fs.mkdirSync(dir, { recursive: true });
    const snap = async (name, full = false) => {
      if (ONLY && !ONLY.includes(name)) return;
      await p.waitForTimeout(250);
      report[`${size} ${name}`] = await p.evaluate(audit);
      await p.screenshot({ path: `${dir}/${name}.png`, fullPage: full });
    };
    // logged out
    await p.goto(B); await p.waitForTimeout(900); await snap('auth');
    await act('button.chip:has-text("Log in")', () => p.click('button.chip:has-text("Log in")')); await act('input[autocomplete=username]', () => p.fill('input[autocomplete=username]', 'reda')); await act('input[type=password]', () => p.fill('input[type=password]', 'secret1')); await act('button.cta', () => p.click('button.cta')); await p.waitForTimeout(1300);
    await snap('lobby');
    await act('text=+ Create league', () => p.click('text=+ Create league')); await p.waitForTimeout(800); await snap('lobby-create');
    await act('button:has-text("2 divisions")', () => p.click('button:has-text("2 divisions")')); await p.waitForTimeout(200); await snap('lobby-create-div');
    await act('text=Join with code', () => p.click('text=Join with code')); await p.waitForTimeout(300); await snap('lobby-join');
    await act('button:has-text("Manager ranking")', () => p.click('button:has-text("Manager ranking")')); await p.waitForTimeout(300); await snap('lobby-ranking');
    if (setupLeague) {
      await p.goto(`${B}/l/${setupLeague}`); await p.waitForTimeout(1300); await snap('create-club');
      await act('input[placeholder="Red Eagles"]', () => p.fill('input[placeholder="Red Eagles"]', 'Sphinx United')); await act('button:has-text("Next: club type")', () => p.click('button:has-text("Next: club type")')); await p.waitForTimeout(300); await snap('create-club-type');
    }
    for (const t of TABS) {
      await p.goto(`${B}/l/${lid}?tab=${t}`); await p.waitForTimeout(t === 'awards' ? 3800 : 1500);
      if (await p.locator('.overlay button:has-text("Later")').count()) { if (t === 'home') await snap('live-alert'); await act('.overlay button:has-text("Later")', () => p.click('.overlay button:has-text("Later")')); await p.waitForTimeout(300); }
      await snap(`tab-${t}`);
      if (t === 'tactics') {
        for (const k of ['Roles', 'Set pieces', 'In possession']) { await act(`button.seg:has-text("${k}")`, () => p.click(`button.seg:has-text("${k}")`)); await snap(`tab-tactics-${k.replace(' ', '')}`); }
        await act('button:has-text("Plan C")', () => p.click('button:has-text("Plan C")')); await snap('tab-tactics-planC');
      }
      if (t === 'market') {
        await act('button.seg:has-text("Make an offer")', () => p.click('button.seg:has-text("Make an offer")')); await p.waitForTimeout(1200); await act('offer row', () => p.locator('.row-item').nth(2).click({ timeout: 4000 })); await snap('tab-market-offer');
        await act('button.seg:has-text("Offers")', () => p.click('button.seg:has-text("Offers")')); await p.waitForTimeout(1000); await snap('tab-market-inbox');
      }
      if (t === 'awards') { await act('button.seg:has-text("Player of the Month")', () => p.click('button.seg:has-text("Player of the Month")')); await p.waitForTimeout(600); await snap('tab-awards-potm'); }
      if (t === 'table') { await act('button.seg:has-text("Premier")', () => p.click('button.seg:has-text("Premier")')); await p.waitForTimeout(900); await snap('tab-table-premier'); }
      if (t === 'office') { await act('button.seg:has-text("Edit")', () => p.click('button.seg:has-text("Edit")')); await snap('tab-office-kit', true); }
    }
    await p.goto(`${B}/m/${pre}`); await p.waitForTimeout(1300); await snap('match-pre', true);
    await sql(`UPDATE fixtures SET live_from=now()-interval '30 seconds', live_until=now()+interval '95 seconds' WHERE id=$1`, [live]);
    await p.goto(`${B}/m/${live}`); await p.waitForTimeout(3000); await snap('match-live');
    await act('button:has-text("Substitution")', () => p.click('button:has-text("Substitution")')); await p.waitForTimeout(300); await snap('match-live-sub');
    await p.goto(`${B}/m/${done}`); await p.waitForTimeout(1200); await snap('match-intro');
    await p.goto(`${B}/m/${done}?skip=1`); await p.waitForTimeout(1500); await snap('match-ft', true);
    await ctx.close();
  }
  fs.writeFileSync(`${S}/ui/report.json`, JSON.stringify(report, null, 1));
  const bad = Object.entries(report).filter(([, r]) => r.pageX || r.sticking.length || r.clipped.length);
  console.log('screens', Object.keys(report).length, 'with issues', bad.length);
  for (const [k, r] of bad) console.log(`\n# ${k}${r.pageX ? ' PAGE-SCROLLS-SIDEWAYS' : ''}\n  ${[...r.sticking.map((x) => 'out: ' + x), ...r.clipped.map((x) => 'cut: ' + x)].join('\n  ')}`);
  console.log('\nerrors', errs);
  await br.close();
})();
