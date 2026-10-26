// Equal squads, human vs AI (hard / normal / easy). Three kinds of human manager.
import { readFileSync } from 'node:fs';
const { simulate, aiPlan, counterShare } = await import('../lib/engine.ts');
const { PRESETS, FORMATIONS, LINE, stripDesc, tacticFit } = await import('../lib/game.ts');
const { rng } = await import('../lib/rng.ts');
const all = JSON.parse(readFileSync('data/players.json', 'utf8')).players;
const toE = (p: any) => ({ id: p.id, name: p.name, pos: p.position, ovr: p.overall, fitness: 100, a: { ...p.attributes, ...p.goalkeeping, ...p.hidden } });
const r = rng(77);
const squad = (lvl = 80) => { const used = new Set(); return FORMATIONS['4-3-3'].slots.map((s: string) => { const c = all.filter((p: any) => LINE[p.position] === s && !used.has(p.id) && Math.abs(p.overall - lvl) <= 2); const p = c[Math.floor(r.next() * c.length)]; used.add(p.id); return toE(p); }); };
const names = Object.keys(PRESETS);
const side = (xi: any, t: any, i: number, home: boolean) => ({ clubId: i, name: 'T', xi, bench: [], tactic: t, assistant: { tired: true, injured: true, winning: true, losing: true }, pens: [], homeBoost: home ? 0 : -1.5 });
const P = (t: string) => ({ preset: t, formation: '4-3-3', ...stripDesc(PRESETS[t]) });
for (const level of [2, 1, 0]) {
  const res: Record<string, { pts: number; n: number }> = { 'same plan every match': { pts: 0, n: 0 }, 'random plan': { pts: 0, n: 0 }, 'smart (reads the AI, suits squad)': { pts: 0, n: 0 } };
  for (const kind of Object.keys(res)) {
    const humanXi = squad(), hist: string[] = [];
    let last = 'Wing play';
    for (let k = 0; k < 400; k++) {
      const botXi = squad();
      let mine: string;
      if (kind.startsWith('same')) mine = 'Wing play';
      else if (kind.startsWith('random')) mine = names[Math.floor(r.next() * names.length)];
      else {
        // the AI will counter my recent plans; pick what beats its likely answer, weighted by what suits my players
        const theyFear = names.map((n) => ({ n, v: hist.length ? counterShare(n, hist[0]) : 0.5 })).sort((a, b) => b.v - a.v)[0].n;
        mine = names.map((n) => ({ n, v: counterShare(n, theyFear) + tacticFit(humanXi.map((p: any, i: number) => ({ ...p, slot: FORMATIONS['4-3-3'].slots[i] })), stripDesc(PRESETS[n])).fit * 0.06 })).sort((a, b) => b.v - a.v)[0].n;
      }
      const bot = aiPlan({ level, oppHistory: hist, own: botXi, opp: humanXi, seed: k * 31 + level, formation: '4-3-3' });
      const home = k % 2 === 0;
      const hs = side(humanXi, P(mine), 0, true), bs = side(botXi, bot, 1, false);
      const rep = home ? simulate(hs, bs, k * 7919 + level) : simulate({ ...bs, clubId: 0 }, { ...hs, clubId: 1 }, k * 7919 + level);
      const [a, b] = home ? rep.score : [rep.score[1], rep.score[0]];
      res[kind].pts += a > b ? 3 : a === b ? 1 : 0; res[kind].n++;
      hist.unshift(mine); hist.length = Math.min(hist.length, 4); last = mine;
    }
  }
  console.log(`AI ${['easy', 'normal', 'hard'][level]}: ` + Object.entries(res).map(([k, v]) => `${k} ${(v.pts / v.n).toFixed(2)} pts/match`).join(' · '));
}
process.exit(0);
