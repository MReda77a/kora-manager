// Neutral-venue tactic matrix on equal squads (no home advantage), sides swapped to cancel noise.
import { readFileSync } from 'node:fs';
const { simulate } = await import(process.env.ENGINE || '../lib/engine.ts');
const { PRESETS, FORMATIONS, LINE, stripDesc } = await import('../lib/game.ts');
const { rng } = await import('../lib/rng.ts');
const all = JSON.parse(readFileSync('data/players.json', 'utf8')).players;
const toE = (p: any) => ({ id: p.id, name: p.name, pos: p.position, ovr: p.overall, fitness: 100, a: { ...p.attributes, ...p.goalkeeping, ...p.hidden } });
const r = rng(21);
const squad = () => { const used = new Set(); const xi = FORMATIONS['4-3-3'].slots.map((s: string) => { const c = all.filter((p: any) => LINE[p.position] === s && !used.has(p.id) && Math.abs(p.overall - 80) <= 2); const p = c[Math.floor(r.next() * c.length)]; used.add(p.id); return toE(p); }); return { xi, bench: [] }; };
const side = (s: any, t: string, i: number) => ({ clubId: i, name: 'T', ...s, tactic: { preset: t, formation: '4-3-3', ...stripDesc(PRESETS[t]) }, assistant: { tired: true, injured: true }, pens: [], homeBoost: -1.5 });
const names = Object.keys(PRESETS);
const pairs = Array.from({ length: 24 }, () => [squad(), squad()]);
const M: any = {}; const avg: any = {};
let G = 0, N = 0;
for (const a of names) { M[a] = {}; for (const b of names) {
  let s = 0, n = 0;
  pairs.forEach(([X, Y], i) => { for (let j = 0; j < 6; j++) for (const [p, q] of [[X, Y], [Y, X]]) {
    const rep = simulate(side(p, a, 0), side(q, b, 1), i * 1000 + j * 17 + (p === X ? 0 : 5) + a.length * 31 + b.length);
    s += rep.score[0] > rep.score[1] ? 1 : rep.score[0] === rep.score[1] ? 0.5 : 0; n++; G += rep.score[0] + rep.score[1]; N++;
  } });
  M[a][b] = Math.round(s / n * 100);
} avg[a] = Math.round(names.reduce((t, b) => t + M[a][b], 0) / names.length); }
console.table(M);
console.log('average win share per tactic:', JSON.stringify(avg), 'goals', (G / N).toFixed(2));
process.exit(0);
