// Free kick and stadium balance: free kicks, their goals, injuries and fatigue per match.
import { readFileSync } from 'node:fs';
import { simulate, type EPlayer, type ESide } from '../lib/engine.ts';
import { PRESETS, FORMATIONS, LINE, stripDesc } from '../lib/game.ts';
import { rng } from '../lib/rng.ts';

const data = JSON.parse(readFileSync('data/players.json', 'utf8')).players.filter((p: any) => p.country === 'England');
const toE = (p: any): EPlayer => ({ id: p.id, name: p.name, pos: p.position, ovr: p.overall, fitness: 100, a: { ...p.attributes, ...p.goalkeeping, ...p.hidden } });
const names = Object.keys(PRESETS);
export function run(sp0: any, sp1: any, N = 4000, extra0: Partial<ESide> = {}, wx?: string) {
  const r = rng(11);
  const squad = () => {
    const pool = [...data].sort(() => r.next() - 0.5); const xi: EPlayer[] = [];
    for (const s of FORMATIONS['4-3-3'].slots) { const i = pool.findIndex((p) => LINE[p.position] === s); xi.push(toE(pool.splice(i, 1)[0])); }
    return { xi, bench: pool.slice(0, 7).map(toE) };
  };
  let g = 0, fk = 0, fkg = 0, fks = 0, pts = 0, inj = 0, fit = 0, fitN = 0, xgFk = 0, n = 0;
  for (let k = 0; k < N; k++) {
    const t = names[k % names.length];
    const mk = (i: number, sp: any, ex: Partial<ESide>): ESide => ({ clubId: i, name: 'T' + i, ...squad(), tactic: { preset: t, formation: '4-3-3', ...stripDesc(PRESETS[t]) }, assistant: {}, pens: [], homeBoost: 0, setpieces: sp, ...ex });
    const rep = simulate(mk(0, sp0, extra0), mk(1, sp1, {}), k * 7919 + 3, { weather: wx });
    n++; g += rep.score[0] + rep.score[1];
    fk += rep.events.filter((e) => e.type === 'freekick' && e.side === 0).length;
    const s0 = (rep.shots || []).filter((s) => s.side === 0 && (s.kind === 'free kick' || s.kind === 'set piece'));
    fks += s0.length; fkg += s0.filter((s) => s.goal).length; xgFk += s0.reduce((a, s) => a + s.xg, 0);
    pts += rep.score[0] > rep.score[1] ? 3 : rep.score[0] === rep.score[1] ? 1 : 0;
    inj += rep.events.filter((e) => e.type === 'injury' && e.side === 0).length;
    for (const p of rep.players.filter((p) => p.side === 0 && p.mins > 0)) { fit += p.fitEnd; fitN++; }
  }
  return { goals: +(g / n).toFixed(3), fkEvents: +(fk / n).toFixed(3), fkShots: +(fks / n).toFixed(3), fkGoals: +(fkg / n).toFixed(4), fkXg: +(xgFk / n).toFixed(4), ppg: +(pts / n).toFixed(3), inj: +(inj / n).toFixed(3), fitEnd: +(fit / fitN).toFixed(1) };
}
if (process.argv[1]?.endsWith('fk-study.ts')) console.log(run({}, {}));
