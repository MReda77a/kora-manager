// Balance check: random squads from the English pool, every tactic vs every tactic.
import { readFileSync } from 'node:fs';
import { simulate, type EPlayer, type ESide } from '../lib/engine.ts';
import { PRESETS, FORMATIONS, LINE, stripDesc } from '../lib/game.ts';
import { rng } from '../lib/rng.ts';

const data = JSON.parse(readFileSync('data/players.json', 'utf8')).players.filter((p: any) => p.country === 'England');
const toE = (p: any): EPlayer => ({ id: p.id, name: p.name, pos: p.position, ovr: p.overall, fitness: 100, a: { ...p.attributes, ...p.goalkeeping, ...p.hidden } });
const r = rng(7);
function squad(): { xi: EPlayer[]; bench: EPlayer[] } {
  const need = FORMATIONS['4-3-3'].slots;
  const pool = [...data].sort(() => r.next() - 0.5);
  const xi: EPlayer[] = [];
  for (const s of need) { const i = pool.findIndex((p) => (LINE[p.position]) === s); xi.push(toE(pool.splice(i, 1)[0])); }
  return { xi, bench: pool.slice(0, 7).map(toE) };
}
const names = Object.keys(PRESETS);
const res: Record<string, number[]> = {};
let g = 0, n = 0, d = 0, cards = 0, inj = 0, pens = 0;
for (let k = 0; k < 6000; k++) {
  const a = names[k % 6], b = names[Math.floor(k / 6) % 6];
  const mk = (t: string, i: number): ESide => ({ clubId: i, name: 'T' + i, ...squad(), tactic: { preset: t, formation: '4-3-3', ...stripDesc(PRESETS[t]) }, assistant: { tired: true, cards: true, winning: true, losing: true }, pens: [], homeBoost: 0 });
  const rep = simulate(mk(a, 0), mk(b, 1), k * 7919);
  g += rep.score[0] + rep.score[1]; n++; if (rep.score[0] === rep.score[1]) d++;
  cards += rep.stats.yellows[0] + rep.stats.yellows[1];
  inj += rep.events.filter((e) => e.type === 'injury').length;
  pens += rep.events.filter((e) => e.type === 'penalty').length;
  const pts = rep.score[0] > rep.score[1] ? 1 : rep.score[0] === rep.score[1] ? 0.5 : 0;
  (res[a] ||= []).push(pts); (res[b] ||= []).push(1 - pts);
}
console.log('goals/game', (g / n).toFixed(2), 'draws', ((d / n) * 100).toFixed(0) + '%', 'yellows', (cards / n).toFixed(1), 'inj', (inj / n).toFixed(2), 'pens', (pens / n).toFixed(2));
for (const t of names) console.log(t.padEnd(16), (res[t].reduce((a, b) => a + b, 0) / res[t].length).toFixed(3));
