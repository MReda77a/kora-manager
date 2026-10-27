'use client';
// The live pitch, driven by what really happened in the match. The engine logs every move (which
// side had the ball, how far it got, whether it ended in a shot); here each move is played out:
// the ball goes from player to player up the pitch, then it is lost, or it is shot at goal from
// the spot the engine chose, and goals go in exactly when the GOAL appears.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMATIONS } from '../lib/game.ts';
import { shirt } from '../lib/client.ts';
import { lastName } from './ui.tsx';

type Ev = { m: number; type: string; side: 0 | 1; text: string; pid?: string; pid2?: string };
type Shot = { m: number; side: 0 | 1; x: number; y: number; xg: number; goal: boolean; kind: string; pid?: string };
type Play = { t0: number; t1: number; s: 0 | 1; r: number; sh: number; i: number; merged?: boolean };

// match minute -> time on the clock of the watched match (stoppage time is squeezed in)
export const tm = (m: number) => (m <= 90 ? m : 90 + (m - 90) * 0.08);

export function buildPlays(flow: [number, 0 | 1, number, number][], shots: Shot[]): Play[] {
  const groups = new Map<number, [number, 0 | 1, number, number][]>();
  for (const f of flow) { const g = groups.get(f[0]) || []; g.push(f); groups.set(f[0], g); }
  const out: Play[] = [];
  let i = 0;
  for (const [m, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    // one move a minute on screen, the one that mattered most: a goal, else a shot, else the move that got furthest.
    // It ends as the minute ends, so a goal goes in exactly when the GOAL appears.
    const rank = (f: [number, 0 | 1, number, number]) => (f[3] >= 0 ? (shots[f[3]]?.goal ? 100 : 50 + shots[f[3]].xg * 10) : f[2]);
    const main = g.reduce((a, f) => (rank(f) >= rank(a) ? f : a), g[0]);
    const B = tm(m), A = m <= 1 ? 0.15 : tm(m - 1);
    // two quiet minutes in a row become one slower move, so the passing can be followed
    const last = out[out.length - 1];
    if (main[3] < 0 && last && last.sh < 0 && !last.merged && Math.abs(last.t1 - A) < 1e-6 && m !== 46) {
      last.t1 = B; last.merged = true;
      if (main[2] > last.r) { last.r = main[2]; last.s = main[1]; }
      continue;
    }
    out.push({ t0: A, t1: B, s: main[1], r: main[2], sh: main[3], i: i++ });
  }
  return out;
}

const hash = (n: number) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

export function LivePitch({ d, gm, rate, events, revealed, contrastInk }: { d: any; gm: number; rate: number; events: Ev[]; revealed: number; contrastInk: (h: string) => string }) {
  const rep = d.report;
  const shots: Shot[] = rep.shots || [];
  const plays = useMemo(() => buildPlays(rep.flow || [], shots), [rep.flow, shots]);
  // smooth time between the clock's ticks
  const [t, setT] = useState(gm);
  const tick = useRef({ gm, at: performance.now() });
  useEffect(() => { tick.current = { gm, at: performance.now() }; }, [gm]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const k = tick.current;
      setT(Math.min(k.gm + 0.3, k.gm + ((performance.now() - k.at) / 1000) * rate));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rate]);

  // who stands in each slot now (substitutes take their man's place, a red card leaves a gap)
  const slots = useMemo(() => [0, 1].map((side) => {
    const ids: (string | null)[] = [...(rep.lineups?.[side]?.xi || [])];
    for (const e of events.slice(0, revealed)) {
      if (e.side !== side) continue;
      if (e.type === 'sub' && e.pid && e.pid2) { const k = ids.indexOf(e.pid2); if (k >= 0) ids[k] = e.pid; }
      if (e.type === 'red' && e.pid) { const k = ids.indexOf(e.pid); if (k >= 0) ids[k] = null; }
    }
    return ids;
  }), [events, revealed, rep.lineups]);

  const F = [FORMATIONS[rep.lineups?.[0]?.formation || '4-3-3'] || FORMATIONS['4-3-3'], FORMATIONS[rep.lineups?.[1]?.formation || '4-3-3'] || FORMATIONS['4-3-3']];
  // base spots in screen % (home attacks to the right)
  const base = (side: 0 | 1, k: number): [number, number] => {
    const [x, y] = F[side].xy[k];
    return side === 0 ? [x * 0.9 + 3, y] : [100 - (x * 0.9 + 3), 100 - y];
  };
  const dir = (side: 0 | 1) => (side === 0 ? 1 : -1);
  // where a move that was lost ended, and which opponent won the ball there
  const interceptor = (q: Play): number | null => {
    const s = q.s, o = (1 - s) as 0 | 1, h = hash(q.i + 7);
    const lineK = (line: string) => F[s].slots.map((sl, k) => ({ sl, k })).filter((x) => x.sl === line).map((x) => x.k);
    const ks = q.r <= 0 ? lineK('DEF') : q.r === 1 ? lineK('MID') : lineK('FWD').length ? lineK('FWD') : lineK('MID');
    if (!ks.length) return null;
    const end = base(s, ks[hash(h + (q.r <= 0 ? 2 : q.r === 1 ? 2 : 3)) % ks.length]);
    let best: number | null = null, bd = 1e9;
    F[o].xy.forEach((_, k) => { if (F[o].slots[k] === 'GK') return; const b = base(o, k); const dd = (b[0] - end[0]) ** 2 + (b[1] - end[1]) ** 2; if (dd < bd) { bd = dd; best = k; } });
    return best;
  };
  const clampY = (y: number) => Math.max(14, Math.min(86, y));

  // the move being played now
  let p: Play | null = null;
  { let lo = 0, hi = plays.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (plays[mid].t1 <= t) lo = mid + 1; else hi = mid - 1; } p = plays[lo] && plays[lo].t0 <= t ? plays[lo] : null; }
  const u = p ? Math.max(0, Math.min(1, (t - p.t0) / (p.t1 - p.t0))) : 0;

  // the path of the ball: players of the attacking side by line, then the outcome
  type Way = { side: 0 | 1; k: number | null; at: [number, number]; label?: string };
  let path: Way[] = [];
  let outcome: 'lost' | 'goal' | 'saved' | 'wide' | null = null;
  let stage = 0;
  let shooterK: number | null = null;
  let shotSpot: [number, number] | null = null;
  if (p) {
    const s = p.s, o = (1 - s) as 0 | 1, h = hash(p.i + 7);
    const idsS = slots[s];
    const byLine = (line: string) => F[s].slots.map((sl, k) => ({ sl, k })).filter((x) => x.sl === line && idsS[x.k]).map((x) => x.k);
    const pick = (ks: number[], salt: number) => (ks.length ? ks[hash(h + salt) % ks.length] : null);
    const D = byLine('DEF'), M = byLine('MID'), W = byLine('FWD'), G = byLine('GK');
    const shot = p.sh >= 0 ? shots[p.sh] : null;
    let ks: (number | null)[] = [];
    if (p.r === 0) ks = [pick(D, 1), pick(D, 2) ?? pick(M, 2)];
    else if (p.r === 1) ks = [pick(D, 1), pick(M, 2)];
    else if (p.r === 2) ks = [pick(M, 2), pick(W, 3) ?? pick(M, 4)];
    else {
      const scorer = shot?.pid ? idsS.indexOf(shot.pid) : -1;
      shooterK = scorer >= 0 ? scorer : (pick(W, 5) ?? pick(M, 5));
      ks = [pick(M, 2), shooterK];
    }
    // the move starts where the last one ended: the man who won the ball, or the keeper after a shot
    const prev = plays[p.i - 1];
    if (prev && prev.s !== s) {
      if (prev.sh >= 0) { if (G.length) ks.unshift(G[0]); }
      else { const k = interceptor(prev); if (k !== null && idsS[k]) ks.unshift(k); }
    }
    ks = ks.filter((k, j) => k !== null && k !== ks[j - 1]);
    if (shot) shotSpot = [Math.max(4, Math.min(96, shot.x)), clampY(shot.y)];
    // how far up the pitch the move is (the teams follow it)
    stage = Math.min(ks.length - 1, Math.floor(u * (ks.length + 0.4)));
    path = ks.map((k) => ({ side: s, k, at: [0, 0] as [number, number] }));
    if (shot) outcome = shot.goal ? 'goal' : (h % 2 === 0 ? 'saved' : 'wide');
    else outcome = 'lost';
    void o;
  }

  // team shapes slide with the move: the attacking side pushes up, the other drops off
  const push = p ? [-6, 2, 9, 14][Math.min(3, p.r === 3 ? 2 + (stage >= 1 ? 1 : 0) : Math.min(p.r, stage + 1))] * (0.5 + 0.5 * Math.min(1, u * 2)) : 0;
  const pos = (side: 0 | 1, k: number): [number, number] => {
    const [x, y] = base(side, k);
    const isGK = F[side].slots[k] === 'GK';
    const wob = Math.sin(t * 2.1 + k * 1.7 + side) * 0.9;
    // the attacking side pushes toward the other goal; the defending side drops back toward its own
    const dx = p && !isGK ? (p.s === side ? push * dir(side) : -push * 0.7 * dir(side)) : 0;
    return [Math.max(3, Math.min(97, x + dx + wob * 0.4)), clampY(y + wob)];
  };
  for (const w of path) w.at = w.k !== null ? pos(w.side, w.k) : [50, 50];
  if (shooterK !== null && shotSpot && path.length) path[path.length - 1].at = shotSpot;

  // where the ball is
  let ball: [number, number] = [50, 50];
  let holder: { side: 0 | 1; k: number } | null = null;
  let note = '';
  if (p && path.length) {
    const n = path.length;
    const span = n + 0.8; // n holds/passes, then the ending
    const x = u * span;
    if (x < n - 1 + 0.5) {
      const seg = x - Math.floor(x);
      const from = Math.min(n - 1, Math.floor(x)), to = Math.min(n - 1, from + 1);
      if (seg < 0.55 || from === to) { ball = path[from].at; holder = { side: path[from].side, k: path[from].k! }; }
      else { const v = ease((seg - 0.55) / 0.45); ball = [lerp(path[from].at[0], path[to].at[0], v), lerp(path[from].at[1], path[to].at[1], v)]; }
    } else {
      // the ending
      const last = path[n - 1].at;
      const v = Math.min(1, (x - (n - 0.5)) / 1.1);
      const s = path[n - 1].side;
      const goalX = s === 0 ? 100.5 : -0.5;
      if (outcome === 'lost') {
        // an opponent nips in
        // the same opponent who then starts the next move
        const opp = (1 - s) as 0 | 1;
        const bk = interceptor(p!) ?? 0;
        const best = pos(opp, bk);
        ball = [lerp(last[0], best[0], ease(v)), lerp(last[1], best[1], ease(v))];
        if (v > 0.6) holder = { side: opp, k: bk };
        note = v > 0.35 && v < 0.95 ? 'Won it' : '';
      } else if (outcome === 'goal') {
        ball = [lerp(last[0], goalX, ease(v)), lerp(last[1], 47 + (hash(p!.i) % 7), ease(v))];
        note = 'Shot!';
      } else if (outcome === 'saved') {
        const gk = F[(1 - s) as 0 | 1].slots.indexOf('GK');
        const gp = gk >= 0 ? pos((1 - s) as 0 | 1, gk) : [goalX, 50];
        ball = [lerp(last[0], gp[0], ease(v)), lerp(last[1], gp[1], ease(v))];
        note = v > 0.7 ? 'Saved!' : 'Shot!';
      } else {
        const side = hash(p!.i) % 2 ? 36 : 64;
        ball = [lerp(last[0], goalX + (s === 0 ? 2 : -2), ease(v)), lerp(last[1], side, ease(v))];
        note = v > 0.7 ? 'Wide!' : 'Shot!';
      }
    }
  }
  const carrierName = holder ? lastName(d.names[slots[holder.side][holder.k] || '']?.name || '') : '';

  const dots: { side: 0 | 1; k: number; id: string; at: [number, number] }[] = [];
  for (const side of [0, 1] as const) {
    F[side].xy.forEach((_, k) => {
      const id = slots[side][k];
      if (!id) return;
      let at = pos(side, k);
      // the man on the ball is where the ball is; the shooter runs to his spot
      if (holder && holder.side === side && holder.k === k) at = [ball[0] - dir(side) * 1.6, ball[1] + 1.2];
      if (p && side === p.s && k === shooterK && shotSpot) { const v = Math.min(1, u * 1.8); at = [lerp(at[0], shotSpot[0], v), lerp(at[1], shotSpot[1], v)]; }
      // defenders close down the ball
      if (p && side !== p.s && F[side].slots[k] !== 'GK') {
        const dd = Math.hypot(at[0] - ball[0], at[1] - ball[1]);
        if (dd < 22) at = [lerp(at[0], ball[0], 0.18), lerp(at[1], ball[1], 0.18)];
      }
      dots.push({ side, k, id, at });
    });
  }

  return (
    <>
      {dots.map((x) => {
        const team = x.side === 0 ? d.home : d.away;
        const no = d.names[x.id]?.num ?? shirt(x.id, d.names[x.id]?.pos || 'CM');
        const has = holder && holder.side === x.side && holder.k === x.k;
        return (
          <span key={`${x.side}-${x.k}`} style={{ position: 'absolute', left: `${x.at[0]}%`, top: `${x.at[1]}%`, width: 17, height: 17, marginLeft: -8.5, marginTop: -8.5, borderRadius: '50%', background: team.color1, boxShadow: `0 0 0 2px ${team.kit2 || (x.side ? '#151018' : '#F3EEFF')}${has ? ', 0 0 0 4px rgba(255,255,255,0.55)' : ''}`, zIndex: has ? 3 : 2, display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 900, color: contrastInk(team.color1) }}>
            {no}
            {x.id === rep.lineups?.[x.side]?.captain && <i aria-label="Captain" style={{ position: 'absolute', right: -6, top: -6, width: 10, height: 10, borderRadius: '50%', background: '#F2C14E', color: '#1B1048', fontSize: 7, fontStyle: 'normal', display: 'grid', placeItems: 'center', fontWeight: 900 }}>C</i>}
          </span>
        );
      })}
      {carrierName && holder && (
        <span className="tiny" style={{ position: 'absolute', left: `${Math.max(8, Math.min(92, ball[0]))}%`, top: `calc(${ball[1]}% - 24px)`, transform: 'translateX(-50%)', zIndex: 4, padding: '0 6px', background: holder.side === 0 ? d.home.color1 : d.away.color1, color: contrastInk(holder.side === 0 ? d.home.color1 : d.away.color1), fontWeight: 900, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{carrierName}</span>
      )}
      {note && (
        <span className="lz" style={{ position: 'absolute', left: `${Math.max(7, Math.min(93, ball[0]))}%`, top: `calc(${ball[1]}% + 12px)`, transform: 'translateX(-50%)', zIndex: 4, fontSize: 15, color: '#FFE48A', textShadow: '0 2px 0 rgba(0,0,0,0.6)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{note}</span>
      )}
      <span style={{ position: 'absolute', left: `${ball[0]}%`, top: `${ball[1]}%`, width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5, borderRadius: '50%', background: '#fff', boxShadow: '0 0 8px #fff, 0 2px 3px rgba(0,0,0,0.5)', zIndex: 5 }} />
    </>
  );
}
