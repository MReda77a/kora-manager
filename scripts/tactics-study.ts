// How much do tactics matter, and how unpredictable are results?
// Runs thousands of simulated matches with the real engine and real players.
import { readFileSync } from 'node:fs';
import { simulate, type EPlayer, type ESide, type Change } from '../lib/engine.ts';
import { PRESETS, FORMATIONS, LINE, stripDesc, type Tactic } from '../lib/game.ts';
import { rng } from '../lib/rng.ts';

const all = JSON.parse(readFileSync('data/players.json', 'utf8')).players as any[];
const toE = (p: any): EPlayer => ({ id: p.id, name: p.name, pos: p.position, ovr: p.overall, fitness: 100, a: { ...p.attributes, ...p.goalkeeping, ...p.hidden } });
const r = rng(2026);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const preset = (t: string, formation = '4-3-3'): Tactic => ({ preset: t, formation, ...stripDesc(PRESETS[t]) } as Tactic);

// a squad whose players sit around a target rating, optionally favouring an attribute in one line
function squad(target: number, prefer?: { line: string; attr: string; high: boolean }, formation = '4-3-3') {
  const used = new Set<string>();
  const xi: EPlayer[] = [];
  for (const slot of FORMATIONS[formation].slots) {
    let c = all.filter((p) => LINE[p.position] === slot && !used.has(p.id) && Math.abs(p.overall - target) <= 3);
    if (prefer && prefer.line === slot) c = c.sort((a, b) => (prefer.high ? 1 : -1) * ((b.attributes[prefer.attr] ?? 0) - (a.attributes[prefer.attr] ?? 0))).slice(0, 6);
    const p = c[Math.floor(r.next() * c.length)];
    used.add(p.id); xi.push(toE(p));
  }
  const bench = all.filter((p) => !used.has(p.id) && Math.abs(p.overall - target) <= 3).slice(0, 7).map(toE);
  return { xi, bench };
}
const side = (s: { xi: EPlayer[]; bench: EPlayer[] }, t: Tactic, i: number, home = false): ESide => ({
  clubId: i, name: `T${i}`, xi: s.xi, bench: s.bench, tactic: t, assistant: { tired: true, cards: true, injured: true }, pens: [], homeBoost: home ? 1 : 0,
});
const play = (a: ESide, b: ESide, n: number, seed: number, changes?: (k: number) => Change[]) => {
  let w = 0, d = 0, l = 0, g = 0;
  for (let k = 0; k < n; k++) {
    const rep = simulate(a, b, seed + k * 7919, changes ? { changes: changes(k) } : {});
    const [x, y] = rep.score; g += x + y;
    if (x > y) w++; else if (x === y) d++; else l++;
  }
  return { w: w / n, d: d / n, l: l / n, g: g / n };
};

// 1) stronger vs weaker: how often does the underdog win?
console.log('\n1) Team strength gap (same tactic, no home advantage, 2000 matches each)');
for (const gap of [0, 2, 4, 6, 8]) {
  let W = 0, D = 0, L = 0, G = 0;
  for (let t = 0; t < 10; t++) {
    const A = squad(80 + gap / 2), Bq = squad(80 - gap / 2);
    const res = play(side(A, preset('Wing play'), 0), side(Bq, preset('Wing play'), 1), 200, t * 101);
    W += res.w; D += res.d; L += res.l; G += res.g;
  }
  console.log(`  rating gap ${String(gap).padStart(2)}:  stronger wins ${pct(W / 10)} · draw ${pct(D / 10)} · weaker wins ${pct(L / 10)} · ${(G / 10).toFixed(2)} goals/game`);
}

// 2) the tactic matrix on equal squads: what beats what
console.log('\n2) Tactic vs tactic, equal squads (win share for the row, 600 matches per cell)');
const names = Object.keys(PRESETS);
const pairs: Record<string, Record<string, number>> = {};
for (const a of names) {
  pairs[a] = {};
  for (const b of names) {
    let s = 0;
    for (let t = 0; t < 6; t++) {
      const A = squad(80), Bq = squad(80);
      const res = play(side(A, preset(a), 0), side(Bq, preset(b), 1), 100, t * 31 + a.length * 7 + b.length);
      s += res.w + res.d / 2;
    }
    pairs[a][b] = Math.round((s / 6) * 100) / 100;
  }
}
console.table(pairs);
let best = { a: '', b: '', v: 0 };
for (const a of names) for (const b of names) if (pairs[a][b] > best.v) best = { a, b, v: pairs[a][b] };
console.log(`  biggest counter: ${best.a} vs ${best.b} = ${pct(best.v)} win share`);
for (const b of names) {
  const col = names.map((a) => [a, pairs[a][b]] as [string, number]).sort((x, y) => y[1] - x[1]);
  console.log(`  vs ${b.padEnd(15)} best: ${col[0][0].padEnd(15)} ${pct(col[0][1])}   worst: ${col[col.length - 1][0].padEnd(15)} ${pct(col[col.length - 1][1])}`);
}

// 3) using your players' strengths against the opponent's weakness
console.log('\n3) Exploit a weakness (equal ratings, 1500 matches each)');
const exploit = (label: string, A: any, Bq: any, good: Partial<Tactic>, bad: Partial<Tactic>) => {
  const base = preset('Wing play');
  const g = play(side(A, { ...base, ...good, preset: 'Custom' } as Tactic, 0), side(Bq, base, 1), 1500, 5);
  const b = play(side(A, { ...base, ...bad, preset: 'Custom' } as Tactic, 0), side(Bq, base, 1), 1500, 5);
  console.log(`  ${label}: right plan ${pct(g.w)} wins / ${pct(g.l)} losses   wrong plan ${pct(b.w)} wins / ${pct(b.l)} losses`);
};
const fast = squad(80, { line: 'FWD', attr: 'Pace', high: true }), slowDef = squad(80, { line: 'DEF', attr: 'Pace', high: false });
exploit('fast strikers vs slow defenders: through balls + fast tempo vs slow crossing', fast, slowDef, { focus: 1, tempo: 2 }, { focus: 0, tempo: 0 });
const tall = squad(80, { line: 'FWD', attr: 'Heading', high: true }), shortDef = squad(80, { line: 'DEF', attr: 'Heading', high: false });
exploit('strong headers vs weak-in-air defence: crosses vs working it in', tall, shortDef, { focus: 0, width: 2 }, { focus: 2, width: 0 });

// 4) a live change: losing at 60', go all out vs do nothing
console.log('\n4) Losing at 60 minutes: what a live change does (equal squads)');
{
  const A = squad(80), Bq = squad(80);
  const a0 = side(A, preset('Wing play'), 0), b0 = side(Bq, preset('Wing play'), 1);
  let n = 0, stay = { pts: 0 }, push = { pts: 0 }, park = { pts: 0 };
  for (let k = 0; k < 6000 && n < 700; k++) {
    const seed = 900 + k * 7919;
    const rep = simulate(a0, b0, seed);
    const at60 = rep.events.filter((e) => e.type === 'goal' && e.m <= 60);
    const s = [at60.filter((e) => e.side === 0).length, at60.filter((e) => e.side === 1).length];
    if (s[0] >= s[1]) continue;
    n++;
    const ptsOf = (x: { score: [number, number] }) => (x.score[0] > x.score[1] ? 3 : x.score[0] === x.score[1] ? 1 : 0);
    stay.pts += ptsOf(rep);
    push.pts += ptsOf(simulate(a0, b0, seed, { changes: [{ m: 61, side: 0, kind: 'tactic', tactic: { mentality: 2, press: 2, tempo: 2 } }] }));
    park.pts += ptsOf(simulate(a0, b0, seed, { changes: [{ m: 61, side: 0, kind: 'tactic', tactic: { mentality: 0, press: 0, line: 0 } }] }));
  }
  console.log(`  ${n} matches where the team was behind at 60'. Points per match: no change ${(stay.pts / n).toFixed(2)} · all-out attack ${(push.pts / n).toFixed(2)} · park the bus ${(park.pts / n).toFixed(2)}`);
}

// 5) same two teams, many times: how varied are the results?
console.log('\n5) The same match played 2000 times (equal squads, home advantage on)');
{
  const A = squad(80), Bq = squad(80);
  const scores: Record<string, number> = {};
  let hw = 0, dr = 0;
  for (let k = 0; k < 2000; k++) {
    const rep = simulate(side(A, preset('Wing play'), 0, true), side(Bq, preset('Low block'), 1), k * 13 + 1);
    const key = rep.score.join('-'); scores[key] = (scores[key] || 0) + 1;
    if (rep.score[0] > rep.score[1]) hw++; else if (rep.score[0] === rep.score[1]) dr++;
  }
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, c]) => `${s} ${pct(c / 2000)}`);
  const big = Object.entries(scores).filter(([s]) => Math.abs(Number(s.split('-')[0]) - Number(s.split('-')[1])) >= 4).reduce((a, [, c]) => a + c, 0);
  console.log(`  home ${pct(hw / 2000)} · draw ${pct(dr / 2000)} · away ${pct(1 - (hw + dr) / 2000)}`);
  console.log(`  most common scores: ${top.join(', ')}`);
  console.log(`  wins by 4+ goals: ${pct(big / 2000)}`);
}
process.exit(0);
