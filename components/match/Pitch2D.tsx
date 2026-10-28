'use client';
// A top-down 2D pitch for the live match. Every move the engine logged is played out with the real
// line-ups: the ball is passed from player to player up the pitch (dashed arrows), the man on the
// ball wears a ring and his name, both teams slide as a block with the play, a lost ball goes to the
// opponent nearest to it, a shot flies at goal from where the engine took it and the real scorer
// scores. Each move starts exactly where the previous one ended, so nothing jumps.
import { useMemo } from 'react';
import { FORMATIONS } from '../../lib/game.ts';
import { shirt } from '../../lib/client.ts';
import { lastName } from '../ui.tsx';

export type Ev = { m: number; type: string; side: 0 | 1; text: string; pid?: string; pid2?: string };
export type Shot = { m: number; side: 0 | 1; x: number; y: number; xg: number; goal: boolean; kind: string; pid?: string; on?: boolean };
type Flow = [number, 0 | 1, number, number];

// match minute -> time on the clock of the watched match (stoppage time is squeezed in)
export const tm = (m: number) => (m <= 90 ? m : 90 + (m - 90) * 0.08);
export const evAt = (e: Ev) => (e.type === 'ft' || e.type === 'pens' ? 90.5 : e.type === 'ht' ? 45.01 : tm(e.m));

const L = 105, W = 68; // pitch size in metres: the SVG works in these units
const hash = (n: number) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const c01 = (u: number) => Math.max(0, Math.min(1, u));
// the ball drifts across the pitch with the play: one smooth curve for the whole match
const wave = (t: number) => 50 + Math.sin(t * 1.1) * 20 + Math.cos(t * 0.53) * 8;
// how far up the pitch (% from the attacking team's goal) a move gets
const DEPTH = [26, 50, 72, 86];

type Outcome = 'lost' | 'goal' | 'saved' | 'wide';
type Plan = {
  t0: number; t1: number; s: 0 | 1; r: number; sh: number; i: number;
  startX: number; targetX: number; // absolute % along the pitch (0 = home goal, 100 = away goal)
  chain: number[]; // slots of the attacking side, in passing order
  out: Outcome; win: number | null; // the defender who wins a lost ball
  restart: 'kickoff' | 'keeper' | null;
};

type Occ = { at: number; side: 0 | 1; out: string | null; inn: string | null }[];

export function usePlan(rep: any, events: Ev[]) {
  return useMemo(() => {
    const shots: Shot[] = rep.shots || [];
    const flow: Flow[] = rep.flow || [];
    const F = [0, 1].map((s) => FORMATIONS[rep.lineups?.[s]?.formation || '4-3-3'] || FORMATIONS['4-3-3']);
    const xi = [0, 1].map((s) => [...(rep.lineups?.[s]?.xi || [])] as (string | null)[]);
    const changes: Occ = events.filter((e) => (e.type === 'sub' && e.pid && e.pid2) || (e.type === 'red' && e.pid)).map((e) => ({ at: evAt(e), side: e.side, out: e.type === 'sub' ? e.pid2! : e.pid!, inn: e.type === 'sub' ? e.pid! : null }));
    // one move per minute: the one that mattered most; two quiet minutes in a row of the same team merge
    const groups = new Map<number, Flow[]>();
    for (const f of flow) { const g = groups.get(f[0]) || []; g.push(f); groups.set(f[0], g); }
    const raw: { t0: number; t1: number; s: 0 | 1; r: number; sh: number; merged?: boolean }[] = [];
    for (const [m, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      const rank = (f: Flow) => (f[3] >= 0 ? (shots[f[3]]?.goal ? 100 : 50 + shots[f[3]].xg * 10) : f[2]);
      const main = g.reduce((a, f) => (rank(f) >= rank(a) ? f : a), g[0]);
      const B = tm(m), A = m <= 1 ? 0.2 : tm(m - 1);
      const last = raw[raw.length - 1];
      if (main[3] < 0 && last && last.sh < 0 && !last.merged && last.s === main[1] && Math.abs(last.t1 - A) < 1e-6 && m !== 46) {
        last.t1 = B; last.merged = true; if (main[2] > last.r) last.r = main[2]; continue;
      }
      raw.push({ t0: A, t1: B, s: main[1], r: main[2], sh: main[3] });
    }
    const occAt = (side: 0 | 1, t: number) => {
      const ids = [...xi[side]];
      for (const c of changes) if (c.side === side && c.at <= t) { const k = ids.indexOf(c.out); if (k >= 0) ids[k] = c.inn; }
      return ids;
    };
    const absBase = (side: 0 | 1, k: number): [number, number] => {
      const [fx, fy] = F[side].xy[k];
      const dd = F[side].slots[k] === 'GK' ? 3 : 12 + fx * 0.62;
      return side === 0 ? [dd, fy] : [100 - dd, 100 - fy];
    };
    const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.65);
    const plans: Plan[] = [];
    let endX = 50, endHolder: { side: 0 | 1; k: number } | null = null;
    raw.forEach((p, i) => {
      const s = p.s, o = (1 - s) as 0 | 1;
      const shot = p.sh >= 0 ? shots[p.sh] : null;
      const out: Outcome = !shot ? 'lost' : shot.goal ? 'goal' : shot.on ? 'saved' : 'wide';
      const prev = plans[i - 1];
      const ht = prev && p.t0 >= 45 && prev.t1 <= 45.01;
      let restart: Plan['restart'] = null;
      let startX = endX;
      if (!prev || ht || prev.out === 'goal') { restart = 'kickoff'; startX = 50; }
      else if (prev.out === 'saved' || prev.out === 'wide') { if (prev.s !== s) restart = 'keeper'; }
      const depth = (x: number) => (s === 0 ? x : 100 - x);
      const targetX = s === 0 ? DEPTH[Math.min(3, p.r)] : 100 - DEPTH[Math.min(3, p.r)];
      // the passing chain: start with the player who has the ball, then forward, one teammate at a time
      const ids = occAt(s, p.t0);
      const slots = F[s].slots;
      const live = slots.map((_, k) => k).filter((k) => ids[k]);
      const baseDepth = (k: number) => (slots[k] === 'GK' ? 2 : 12 + F[s].xy[k][0] * 0.62);
      let first: number;
      if (restart === 'keeper') first = slots.indexOf('GK');
      else if (restart === 'kickoff') first = live.filter((k) => slots[k] === 'MID').sort((a, b) => Math.abs(F[s].xy[a][1] - 50) - Math.abs(F[s].xy[b][1] - 50))[0] ?? live[1];
      else if (endHolder && endHolder.side === s && ids[endHolder.k]) first = endHolder.k;
      else if (endHolder && endHolder.side !== s) {
        // won straight back: our player nearest the man who had just won it
        const ex = absBase(endHolder.side, endHolder.k);
        first = live.filter((k) => slots[k] !== 'GK').sort((a, b) => dist(absBase(s, a), ex) - dist(absBase(s, b), ex))[0] ?? live[0];
      } else {
        // won back near where the ball was: the nearest of our players to that spot
        const d0 = depth(startX);
        first = live.filter((k) => slots[k] !== 'GK').sort((a, b) => Math.abs(baseDepth(a) + (d0 - 50) * 0.5 - d0) - Math.abs(baseDepth(b) + (d0 - 50) * 0.5 - d0))[0] ?? live[0];
      }
      const chain = [first];
      const want = depth(targetX) - 4;
      // enough time on the ball for each pass to be followed (about 0.45 s each at normal speed)
      const maxN = Math.max(2, Math.min(5, Math.floor(((p.t1 - p.t0) * 0.74 * 1.22) / 0.45) + 1)) - (shot ? 1 : 0);
      for (let n = 0; n < maxN - 1; n++) {
        const cur = chain[chain.length - 1];
        const curD = baseDepth(cur) + (Math.min(want, depth(startX)) - 50) * 0.5;
        if (curD >= want && n > 0) break;
        const ahead = live.filter((k) => slots[k] !== 'GK' && !chain.includes(k) && baseDepth(k) > baseDepth(cur) + 3)
          .sort((a, b) => Math.abs(F[s].xy[a][1] - F[s].xy[cur][1]) - Math.abs(F[s].xy[b][1] - F[s].xy[cur][1]));
        if (!ahead.length) break;
        chain.push(ahead[hash(i * 13 + n) % Math.min(3, ahead.length)]);
      }
      if (shot) {
        const scorer = shot.pid ? ids.indexOf(shot.pid) : -1;
        const finisher = scorer >= 0 ? scorer : chain[chain.length - 1];
        if (chain[chain.length - 1] !== finisher) chain.push(finisher);
      }
      // who wins a lost ball: the opponent nearest the last man
      let win: number | null = null;
      if (out === 'lost') {
        const last = chain[chain.length - 1];
        const lx = F[s].xy[last], oids = occAt(o, p.t1);
        const ex = depth(targetX), ey = lx[1];
        win = F[o].slots.map((_, k) => k).filter((k) => oids[k] && F[o].slots[k] !== 'GK')
          .sort((a, b) => {
            const da = (100 - (12 + F[o].xy[a][0] * 0.62)) - ex, db = (100 - (12 + F[o].xy[b][0] * 0.62)) - ex;
            return Math.hypot(da, (100 - F[o].xy[a][1]) - ey) - Math.hypot(db, (100 - F[o].xy[b][1]) - ey);
          })[0] ?? null;
      }
      plans.push({ ...p, i, startX, targetX, chain, out, win, restart });
      endX = out === 'lost' ? targetX : out === 'goal' ? 50 : s === 0 ? 96 : 4;
      endHolder = out === 'lost' && win !== null ? { side: o, k: win } : null;
    });
    return { plans, F, occAt, shots };
  }, [rep, events]);
}

export function Pitch2D({ d, t, plan, mineSide }: { d: any; t: number; plan: ReturnType<typeof usePlan>; mineSide: number }) {
  const { plans, F, occAt, shots } = plan;
  // the move now
  let k = -1;
  { let lo = 0, hi = plans.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (plans[mid].t1 <= t) lo = mid + 1; else hi = mid - 1; } k = plans[lo] && plans[lo].t0 <= t ? lo : -1; }
  const p = k >= 0 ? plans[k] : null;
  const u = p ? c01((t - p.t0) / (p.t1 - p.t0)) : 0;
  const wy = wave(t);
  const team = (s: number) => (s === 0 ? d.home : d.away);
  const chainEndOf = (q: typeof p) => (q ? (q.sh >= 0 ? 0.74 : q.out === 'lost' ? 0.72 : 0.8) : 1);
  const phaseOf = (q: NonNullable<typeof p>, v: number) => lerp(q.startX, q.targetX, ease(c01(v / chainEndOf(q))));

  // where each player stands, given where the play is
  const posP = (phaseX: number, att: 0 | 1 | null) => (side: 0 | 1, k: number): [number, number] => {
    const [fx, fy] = F[side].xy[k];
    const ballD = side === 0 ? phaseX : 100 - phaseX; // how far up the pitch the ball is, seen by this team
    let depth: number;
    if (F[side].slots[k] === 'GK') depth = 3 + Math.max(0, ballD - 50) * 0.08;
    else depth = 12 + fx * 0.62 * (att === side ? 1 : 0.86) + (ballD - 50) * 0.55;
    depth = Math.max(3, Math.min(97, depth + Math.sin(t * 1.4 + k * 1.9 + side) * 0.7));
    const y0 = side === 0 ? fy : 100 - fy;
    const y = y0 + (wy - y0) * (F[side].slots[k] === 'GK' ? 0.12 : 0.16) + Math.cos(t * 1.2 + k * 2.3) * 0.8;
    const x = side === 0 ? depth : 100 - depth;
    return [x / 100 * L, (6 + y * 0.88) / 100 * W];
  };

  type Line = { from: [number, number]; to: [number, number]; side: 0 | 1 };
  type St = { ball: [number, number]; holder: { side: 0 | 1; k: number } | null; pass: Line | null; lastPass: Line | null; shotLine: Line | null; banner: string; bannerSide: 0 | 1; chance: { side: 0 | 1; xg: number; label: string } | null };
  // everything on the pitch for move q at progress v (0..1)
  const stateAt = (q: NonNullable<typeof p>, v: number): St => {
    const pos = posP(phaseOf(q, v), q.s);
    const s = q.s, n = q.chain.length, ce = chainEndOf(q);
    const slotAt = (x: number) => q.chain[Math.min(n - 1, Math.max(0, x))];
    const goalX = s === 0 ? L : 0;
    const st: St = { ball: [L / 2, W / 2], holder: null, pass: null, lastPass: null, shotLine: null, banner: '', bannerSide: s, chance: null };
    const kind = q.sh >= 0 ? shots[q.sh].kind : '';
    if (q.sh >= 0 && v > ce * 0.55) st.chance = { side: s, xg: shots[q.sh].xg, label: kind === 'penalty' ? 'Penalty' : shots[q.sh].xg >= 0.25 ? 'Big chance' : 'Goal chance' };
    if (v < ce) {
      const x = (v / ce) * (n - 0.4); // n holds and n-1 passes; a pass takes 60% of its slot
      const j = Math.floor(x), seg = x - j;
      const a = pos(s, slotAt(j)), b = pos(s, slotAt(j + 1));
      const dir = s === 0 ? 1 : -1;
      if (seg < 0.4 || j >= n - 1) { st.ball = [a[0] + dir * 0.9, a[1] + 0.5]; st.holder = { side: s, k: slotAt(j) }; }
      else { const w = ease((seg - 0.4) / 0.6); st.ball = [lerp(a[0], b[0], w), lerp(a[1], b[1], w)]; st.pass = { from: a, to: b, side: s }; }
      if (j >= 1 && !st.pass) st.lastPass = { from: pos(s, slotAt(j - 1)), to: a, side: s };
      st.banner = q.restart === 'kickoff' && v < 0.12 ? 'KICK-OFF' : q.restart === 'keeper' && v < 0.15 ? 'Goal kick' : q.r === 0 ? 'Ball safe' : q.r === 1 ? 'Attack' : 'Dangerous attack';
      if (kind === 'counter' && v < 0.5) st.banner = 'Counter attack';
      if (kind === 'corner' && v > ce * 0.55) st.banner = 'Corner';
      if (kind === 'free kick' && v > ce * 0.55) st.banner = 'Free kick';
      if (kind === 'penalty' && v > ce * 0.45) st.banner = 'PENALTY!';
      return st;
    }
    const last = pos(s, slotAt(n - 1));
    const w = c01((v - ce) / 0.1);
    if (q.out === 'lost') {
      const o = (1 - s) as 0 | 1;
      const win = q.win !== null ? pos(o, q.win) : last;
      st.ball = [lerp(last[0], win[0], ease(w)), lerp(last[1], win[1], ease(w))];
      if (w >= 1) st.holder = { side: o, k: q.win ?? 0 }; else st.pass = { from: last, to: win, side: o };
      st.banner = 'Ball won back'; st.bannerSide = o;
      return st;
    }
    // the shot: on target to the keeper, wide past the post, or into the net
    const o = (1 - s) as 0 | 1;
    const gk = F[o].slots.indexOf('GK');
    const keeper = gk >= 0 ? pos(o, gk) : [goalX, W / 2] as [number, number];
    const endY = q.out === 'wide' ? (hash(q.i) % 2 ? W / 2 - 6.5 : W / 2 + 6.5) : W / 2 + ((hash(q.i) % 7) - 3) * 0.5;
    const end: [number, number] = q.out === 'saved' ? keeper : q.out === 'wide' ? [goalX + (s === 0 ? 2 : -2), endY] : [goalX + (s === 0 ? 0.8 : -0.8), endY];
    st.ball = [lerp(last[0], end[0], ease(w)), lerp(last[1], end[1], ease(w))];
    st.shotLine = { from: last, to: end, side: s };
    st.holder = w < 0.15 ? { side: s, k: slotAt(n - 1) } : null;
    st.banner = w < 1 ? 'SHOT!' : q.out === 'goal' ? 'GOAL!' : q.out === 'saved' ? 'Saved!' : 'Off target';
    if (w >= 1 && q.out === 'saved' && gk >= 0) { st.holder = { side: o, k: gk }; st.shotLine = null; }
    // a shot that went wide: the keeper fetches it for the goal kick
    if (q.out === 'wide' && v > ce + 0.3) { const r2 = ease(c01((v - ce - 0.3) / 0.4)); st.ball = [lerp(end[0], keeper[0], r2), lerp(end[1], keeper[1], r2)]; st.shotLine = null; if (r2 >= 1 && gk >= 0) st.holder = { side: o, k: gk }; }
    return st;
  };

  let S: St = { ball: [L / 2, W / 2], holder: null, pass: null, lastPass: null, shotLine: null, banner: '', bannerSide: 0, chance: null };
  let pos = posP(50, null);
  if (p) {
    pos = posP(phaseOf(p, u), p.s);
    S = stateAt(p, u);
    // each move starts where the last one ended: the ball runs (or is played) to the first man
    const prev = plans[k - 1];
    if (prev && p.restart !== 'kickoff' && u < 0.12) {
      const from = stateAt(prev, 1).ball;
      const w = ease(u / 0.12);
      S = { ...S, ball: [lerp(from[0], S.ball[0], w), lerp(from[1], S.ball[1], w)], holder: w > 0.9 ? S.holder : null, pass: null, lastPass: null };
    }
  } else {
    S.banner = t < 0.2 ? 'KICK-OFF' : t > 45 && t < 46 ? 'HALF-TIME' : t >= 90 ? 'FULL TIME' : '';
  }
  const { ball, holder, pass, lastPass, shotLine, banner, bannerSide, chance } = S;
  const chainEnd = chainEndOf(p);
  const ids = [occAt(0, t), occAt(1, t)];
  const ink = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt((hex || '#000000').slice(i, i + 2), 16) || 0); return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#151018' : '#fff'; };
  const holderId = holder ? ids[holder.side][holder.k] : null;
  const holderPos = holder ? pos(holder.side, holder.k) : null;
  const hName = holderId ? lastName(d.names[holderId]?.name || '') : '';
  const hNum = holderId ? d.names[holderId]?.num ?? '' : '';
  const capOf = (side: number) => d.report.lineups?.[side]?.captain;
  const arrow = (a: { from: [number, number]; to: [number, number]; side: 0 | 1 }, key: string, op = 1) => (
    <line key={key} x1={a.from[0]} y1={a.from[1]} x2={a.to[0]} y2={a.to[1]} stroke="#9FF3FF" strokeWidth={0.45} strokeDasharray="1.4 1" markerEnd="url(#arr)" opacity={op} />
  );
  return (
    <div className="p2d">
      <svg viewBox={`-2 -2 ${L + 4} ${W + 4}`} preserveAspectRatio="xMidYMid meet" className="p2d-svg" role="img" aria-label="Live pitch">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#9FF3FF" /></marker>
          <marker id="arrS" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#FFE48A" /></marker>
        </defs>
        {/* grass and markings */}
        <rect x={-2} y={-2} width={L + 4} height={W + 4} fill="#1F6B45" />
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={i * L / 10} y={0} width={L / 10} height={W} fill={i % 2 ? '#22744B' : '#1E6842'} />)}
        <g fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={0.3}>
          <rect x={0} y={0} width={L} height={W} />
          <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
          <circle cx={L / 2} cy={W / 2} r={9.15} />
          <rect x={0} y={W / 2 - 20.16} width={16.5} height={40.32} />
          <rect x={L - 16.5} y={W / 2 - 20.16} width={16.5} height={40.32} />
          <rect x={0} y={W / 2 - 9.16} width={5.5} height={18.32} />
          <rect x={L - 5.5} y={W / 2 - 9.16} width={5.5} height={18.32} />
          <path d={`M16.5 ${W / 2 - 7.3} A9.15 9.15 0 0 1 16.5 ${W / 2 + 7.3}`} />
          <path d={`M${L - 16.5} ${W / 2 - 7.3} A9.15 9.15 0 0 0 ${L - 16.5} ${W / 2 + 7.3}`} />
          <rect x={-1.6} y={W / 2 - 3.66} width={1.6} height={7.32} />
          <rect x={L} y={W / 2 - 3.66} width={1.6} height={7.32} />
        </g>
        <circle cx={L / 2} cy={W / 2} r={0.4} fill="rgba(255,255,255,0.6)" />
        {p && p.out === 'goal' && u > chainEnd + 0.1 && <rect x={p.s === 0 ? L : -1.6} y={W / 2 - 3.66} width={1.6} height={7.32} fill="#FFE48A" opacity={0.85}><animate attributeName="opacity" values="1;0.3;1" dur="0.4s" repeatCount="indefinite" /></rect>}
        {/* passes and the shot */}
        {lastPass && arrow(lastPass, 'lp', 0.45)}
        {pass && arrow(pass, 'p')}
        {shotLine && <line x1={shotLine.from[0]} y1={shotLine.from[1]} x2={shotLine.to[0]} y2={shotLine.to[1]} stroke="#FFE48A" strokeWidth={0.6} strokeDasharray="1.6 0.9" markerEnd="url(#arrS)" />}
        {/* players */}
        {[0, 1].map((side) => F[side].xy.map((_: number[], k: number) => {
          const id = ids[side][k];
          if (!id) return null;
          const [x, y] = holder && holder.side === side && holder.k === k && holderPos ? holderPos : pos(side as 0 | 1, k);
          const c = side === 0 ? d.home : d.away;
          const num = d.names[id]?.num ?? shirt(id, d.names[id]?.pos || 'CM');
          const has = holder && holder.side === side && holder.k === k;
          return (
            <g key={`${side}-${k}`} transform={`translate(${x} ${y})`}>
              {has && <circle r={3} fill="none" stroke="#7FE9F7" strokeWidth={0.5}><animate attributeName="r" values="2.6;3.4;2.6" dur="0.9s" repeatCount="indefinite" /></circle>}
              <circle r={1.85} fill={c.color1} stroke={c.kit2 || (side ? '#151018' : '#F3EEFF')} strokeWidth={0.42} />
              <text y={0.62} textAnchor="middle" fontSize={1.7} fontWeight={900} fill={ink(c.color1)}>{num}</text>
              {id === capOf(side) && <g transform="translate(1.55 -1.55)"><circle r={0.7} fill="#F2C14E" /><text y={0.3} textAnchor="middle" fontSize={0.9} fontWeight={900} fill="#1B1048">C</text></g>}
            </g>
          );
        }))}
        {/* the name of the man on the ball */}
        {holderPos && hName && (
          <g transform={`translate(${Math.max(8, Math.min(L - 8, holderPos[0]))} ${Math.max(4, holderPos[1] - 4.2)})`}>
            <rect x={-((hName.length + String(hNum).length + 1) * 0.95 + 1.6) / 2} y={-1.8} width={(hName.length + String(hNum).length + 1) * 0.95 + 1.6} height={3.1} rx={0.4} fill="rgba(10,6,30,0.88)" />
            <text y={0.55} textAnchor="middle" fontSize={1.8} fontWeight={800} fill="#F3EEFF">{hNum ? `${hNum} ` : ''}{hName}</text>
          </g>
        )}
        <circle cx={ball[0]} cy={ball[1]} r={0.9} fill="#fff" stroke="rgba(0,0,0,0.4)" strokeWidth={0.18} />
      </svg>
      {chance && (
        <div className="p2d-chance">
          <span className="p2d-chance-ico">⚽</span>
          <span className="col" style={{ gap: 0 }}>
            <b style={{ color: '#7CE3A1' }}>{chance.label}</b>
            <span>{team(chance.side).name}</span>
            <span className="muted">xG {chance.xg.toFixed(2)}</span>
          </span>
        </div>
      )}
      {banner && <div className={`p2d-banner ${banner === 'GOAL!' || banner === 'PENALTY!' ? 'big' : ''}`} style={{ borderColor: team(bannerSide).color1 }}><b style={{ background: team(bannerSide).color1, color: ink(team(bannerSide).color1) }}>{team(bannerSide).short}</b><span>{banner}</span></div>}
    </div>
  );
}
