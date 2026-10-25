// Goals per game and home win share for every tactic pair (equal random squads).
import { readFileSync } from 'node:fs';
import { simulate, type EPlayer } from '../lib/engine.ts';
import { PRESETS, FORMATIONS, LINE, stripDesc } from '../lib/game.ts';
import { rng } from '../lib/rng.ts';
const data = JSON.parse(readFileSync('data/players.json', 'utf8')).players.filter((p: any) => p.country === 'England');
const toE = (p: any): EPlayer => ({ id: p.id, name: p.name, pos: p.position, ovr: p.overall, fitness: 100, a: { ...p.attributes, ...p.goalkeeping, ...p.hidden } });
const r = rng(11);
const squad = () => { const pool = [...data].sort(() => r.next() - 0.5); return FORMATIONS['4-3-3'].slots.map((s) => toE(pool.splice(pool.findIndex((p) => LINE[p.position] === s), 1)[0])); };
const names = Object.keys(PRESETS);
const out: Record<string, string> = {};
let tot = 0, n = 0;
const pts: Record<string, number[]> = {};
for (const a of names) for (const b of names) {
  let g = 0, w = 0; const N = 250;
  for (let k = 0; k < N; k++) {
    const mk = (t: string, i: number) => ({ clubId: i, name: 'T', xi: squad(), bench: [], tactic: { preset: t, formation: '4-3-3', ...stripDesc(PRESETS[t]) }, assistant: {}, pens: [], homeBoost: -1.5 });
    const rep = simulate(mk(a, 0) as any, mk(b, 1) as any, k * 7 + a.length * 1000 + b.length);
    g += rep.score[0] + rep.score[1]; w += rep.score[0] > rep.score[1] ? 1 : rep.score[0] === rep.score[1] ? 0.5 : 0;
  }
  out[`${a} v ${b}`] = `${(g / N).toFixed(2)} goals, ${(w / N).toFixed(2)}`;
  tot += g; n += N; (pts[a] ||= []).push(w / N);
}
console.table(out);
console.log('overall goals', (tot / n).toFixed(2));
for (const t of names) console.log(t.padEnd(16), (pts[t].reduce((x, y) => x + y) / 6).toFixed(3));
