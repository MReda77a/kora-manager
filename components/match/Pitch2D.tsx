'use client';
// A top-down 2D pitch for the live match. Every move the engine logged is played out with the real
// line-ups: the ball is passed from player to player up the pitch (dashed arrows), the man on the
// ball wears a ring and his name, both teams slide as a block with the play, a lost ball goes to the
// opponent nearest to it, a shot flies at goal from where the engine took it and the real scorer
// scores. Each move starts exactly where the previous one ended, so nothing jumps.
import { useMemo, useRef } from 'react';
import { FORMATIONS, PRESETS, ROLES } from '../../lib/game.ts';
import { shirt } from '../../lib/client.ts';
import { lastName } from '../ui.tsx';
import { moveTimes, minuteTime, tm, type Move } from '../../lib/pitchtime.ts';
export { tm };

export type Ev = { m: number; type: string; side: 0 | 1; text: string; pid?: string; pid2?: string };
export type Shot = { m: number; side: 0 | 1; x: number; y: number; xg: number; goal: boolean; kind: string; pid?: string; on?: boolean; ghost?: boolean };

// when an event shows: on the pitch's own clock. A penalty or a dangerous free kick is given at the foul,
// a little before the kick that ends the move on the event's minute
export const evAt = (e: Ev) => (e.type === 'ft' || e.type === 'pens' ? 90.5 : e.type === 'ht' ? 45 : e.type === 'penalty' ? Math.max(0, tm(e.m) - 1.3) : e.type === 'freekick' ? Math.max(0, tm(e.m) - 0.75) : tm(e.m));

// how much more often the ball is played to a man in this role
const PASS_TO: Record<string, number> = { Playmaker: 6, 'Deep-lying playmaker': 5, Regista: 6, 'False 9': 4, 'Ball carrier': 3, 'Target man': 3, 'Wide winger': 2, Overlap: 2, 'Wing back': 2, 'Early crosser': 2 };
const L = 105, W = 68; // pitch size in metres: the SVG works in these units
const hash = (n: number) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const c01 = (u: number) => Math.max(0, Math.min(1, u));
// the ball drifts across the pitch with the play: one smooth curve for the whole match
const wave = (t: number) => 50 + Math.sin(t * 1.1) * 20 + Math.cos(t * 0.53) * 8;
// how far up the pitch (% from the attacking team's goal) a move gets
const DEPTH = [26, 50, 72, 86];
// how much of a set-piece move is the attack that wins it (the rest: the foul, the ball on the spot, the kick)
const SET = (kind: string) => (kind === 'penalty' ? 0.4 : kind === 'free kick' ? 0.5 : 0);

type Outcome = 'lost' | 'kept' | 'goal' | 'saved' | 'wide';
type Plan = {
  t0: number; t1: number; s: 0 | 1; r: number; sh: number; i: number;
  off?: boolean; offEv?: Ev; // the move ends with the runner flagged offside (the defenders take the free kick)
  startX: number; targetX: number; // absolute % along the pitch (0 = home goal, 100 = away goal)
  chain: number[]; // slots of the attacking side, in passing order
  out: Outcome; win: number | null; // the defender who wins a lost ball
  restart: 'kickoff' | 'keeper' | 'corner' | 'clear' | null;
  label?: string; // what the team is doing, from its tactic (patient build-up, direct ball, counter)
  parry?: boolean;
  pre?: number; // the first part of the move that finishes the last one: celebration, keeper's ball, ball out for the corner
  kind: string; // the shot's kind ('' when there is no shot) // a save pushed out for the corner that follows
  spot?: [number, number]; // where the shot is taken from (% of the pitch, absolute)
  m0: number; // the first match minute this move plays
  m1: number; // the last match minute this move plays out (a live change only touches later minutes)
  foul?: { v: number; w: number; side: 0 | 1; evs: Ev[] };
  holds?: number[]; // the share of each turn spent on the ball before the pass
  cum?: number[]; // where each man's turn on the ball starts (share of the passing); a long ball gets longer
  fouler?: number; // the defender who brings him down (the one booked, if anyone is)
  koSide?: 0 | 1; koMan?: number; // a kick-off: the team that takes it (it may lose it at once) and its man on the spot
  setTaker?: number; // a penalty or free kick: who takes it (the man fouled is the last of the chain) // a booked foul in open play: the ball stops (inner time v to v+w)
};

type Occ = { at: number; side: 0 | 1; out: string | null; inn: string | null }[];
const markMemo = new WeakMap<object, Map<number, number>>();

// who marks whom: each outfield man of the side without the ball picks up the nearest attacker (from
// where both stand in their formations: a fixed choice for the move, so nobody swaps men in the middle of
// it). Pairs go nearest first; a man with nobody near (over 34 m) holds his zone.
export function markOf(F: { slots: string[]; xy: number[][] }[], occ: (string | null)[][], att: 0 | 1) {
  const def = (1 - att) as 0 | 1;
  const at = (side: 0 | 1, k: number): [number, number] => { const [fx, fy] = F[side].xy[k]; const dd = 12 + fx * 0.62; return side === 0 ? [dd, fy] : [100 - dd, 100 - fy]; };
  const A = F[att].slots.map((_, k) => k).filter((k) => F[att].slots[k] !== 'GK' && occ[att][k]);
  const D = F[def].slots.map((_, k) => k).filter((k) => F[def].slots[k] !== 'GK' && occ[def][k]);
  const pairs: [number, number, number][] = [];
  for (const a of A) for (const d of D) { const pa = at(att, a), pd = at(def, d); pairs.push([Math.hypot(pa[0] - pd[0], (pa[1] - pd[1]) * 0.68), a, d]); }
  pairs.sort((x, y) => x[0] - y[0]);
  const out = new Map<number, number>(), usedD = new Set<number>();
  for (const [dd, a, d] of pairs) { if (dd > 34 || out.has(a) || usedD.has(d)) continue; out.set(a, d); usedD.add(d); }
  return out; // attacker slot -> his marker's slot
}

export function usePlan(rep: any, events: Ev[], now?: number) {
  // during a live match the report is worked out again after every change (and polled every few seconds);
  // the moves already under way stay as they were and the new match carries on from the end of the
  // current move, so nothing teleports and no goal is squeezed into a split second
  const last = useRef<{ rep: any; plan: ReturnType<typeof buildPlan> } | null>(null);
  return useMemo(() => {
    const fresh = buildPlan(rep, events);
    const old = last.current;
    // the layout never depends on results, so a plain refresh lays out the very same moves: only a change of
    // tactic or a sub (which changes the match from then on) needs the stitch
    const same = !!old && old.plan.plans.length === fresh.plans.length && old.plan.plans.every((q, i) => q.t0 === fresh.plans[i].t0 && q.t1 === fresh.plans[i].t1 && q.sh === fresh.plans[i].sh && q.s === fresh.plans[i].s);
    const out = old && old.rep !== rep && !same && now != null && now > 0.5 ? stitch(old.plan, fresh, now) : fresh;
    last.current = { rep, plan: out };
    return out;
  }, [rep, events]);
}

/** the match minute the pitch is playing at time t: the clock, stats and tips follow what is on screen
 * (a busy spell runs the clock a little slower, a quiet one a little faster; the whistles stay put) */
export const pitchMinute = (plan: { plans: Plan[] }, t: number) => {
  const ps = plan.plans;
  let lo = 0, hi = ps.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ps[mid].t1 <= t) lo = mid + 1; else hi = mid - 1; }
  const q = ps[lo];
  if (!q || q.t0 > t) return lo > 0 ? ps[lo - 1].m1 : t;
  const span = q.m1 - q.m0 + 1;
  if (span <= 0) return q.m1;
  return q.m0 - 1 + Math.max(0, Math.min(1, (t - q.t0) / (q.t1 - q.t0))) * span;
};

/** the last match minute the pitch has already shown or is showing now: a live change must start after it */
export const shownUpTo = (plan: { plans: Plan[] }, now: number) => plan.plans.reduce((m, q) => (q.t0 <= now + 1e-6 ? Math.max(m, q.m1) : m), 0);

const sameShot = (a?: Shot, b?: Shot) => !!a && !!b && a.m === b.m && a.side === b.side && a.x === b.x && a.y === b.y && a.kind === b.kind;

/** the old moves up to the end of the one under way, then the new report's moves, each given the time it needs */
export function stitch(old: ReturnType<typeof buildPlan>, fresh: ReturnType<typeof buildPlan>, now: number) {
  const cur = old.plans.find((q) => q.t0 <= now && q.t1 > now);
  const cut = cur ? cur.t1 : now;
  const shots = [...fresh.shots];
  // a move already on screen keeps its shot; if a change means that shot no longer happens, it stays a
  // harmless effort (no goal) instead of borrowing a different shot of the new report
  const keep = old.plans.filter((q) => q.t1 <= cut + 1e-6).map((q) => {
    if (q.sh < 0 || sameShot(old.shots[q.sh], fresh.shots[q.sh])) return q;
    const was = old.shots[q.sh];
    if (!was) return { ...q, sh: -1 };
    shots.push({ ...was, goal: false, on: false, ghost: true });
    return { ...q, sh: shots.length - 1, out: q.out === 'goal' ? 'wide' : q.out };
  });
  // the new moves after the cut: none shorter than it takes to see it (an attack with a shot needs longer);
  // a squeezed move pushes the next ones on until the pitch is back on the match clock
  let at = cut;
  const next: Plan[] = [];
  const shown = new Set(keep.map((q) => q.sh).filter((k) => k >= 0));
  for (const q of fresh.plans) {
    if (q.sh >= 0 ? shown.has(q.sh) : q.t1 <= cut + 1e-6) continue; // already on screen
    // a move keeps most of its own length (its passes were laid out for it), so the ball never races
    const need = Math.max(q.sh >= 0 ? (q.kind === 'penalty' || q.kind === 'free kick' ? 1.1 : 0.9) : 0.4, (q.t1 - q.t0) * 0.7);
    // no gap after the cut either (the move on screen may end later in the new report): it starts right away
    const t0 = at, t1 = Math.max(q.t1, t0 + need);
    next.push(t0 === q.t0 && t1 === q.t1 ? q : { ...q, t0, t1, pre: q.pre && t0 !== q.t0 ? Math.min(0.6, (q.pre * (q.t1 - q.t0)) / (t1 - t0)) : q.pre });
    at = t1;
  }
  const plans = [...keep, ...next].map((q, i) => (q.i === i ? q : { ...q, i }));
  return { ...fresh, plans, shots, timeOf: fresh.timing(plans, shots) };
}

export function buildPlan(rep: any, events: Ev[]) {
  {
    const shots: Shot[] = rep.shots || [];
        const F = [0, 1].map((s) => FORMATIONS[rep.lineups?.[s]?.formation || '4-3-3'] || FORMATIONS['4-3-3']);
    const xi = [0, 1].map((s) => [...(rep.lineups?.[s]?.xi || [])] as (string | null)[]);
    // when each move plays: the same layout the server uses, from what is known in advance (never a result)
    const raw: Move[] = moveTimes(rep.flow || [], shots);
    // anything timed by its minute (a sub, a card, a tactic change) shows inside the move playing that minute
    const atMin = (e: Ev) => (e.type === 'ft' || e.type === 'pens' ? 90.5 : e.type === 'ht' ? 45 : minuteTime(raw, e.m) ?? evAt(e));
    const changes: Occ = events.filter((e) => (e.type === 'sub' && e.pid && e.pid2) || (e.type === 'red' && e.pid)).map((e) => ({ at: atMin(e), side: e.side, out: e.type === 'sub' ? e.pid2! : e.pid!, inn: e.type === 'sub' ? e.pid! : null }));
    // the side's set-up at time t: its tactic at kick-off, then every change (live or by the assistant)
    type Style = { mentality: number; press: number; line: number; build: number; width: number; tempo: number; preset?: string };
    const styleAt = (side: 0 | 1, t: number): Style => {
      let cur: Style | null = null;
      for (const x of rep.styles || []) if (x.side === side && tm(x.m) <= t + 1e-6) cur = x;
      if (cur) return cur;
      const pr = PRESETS[rep.lineups?.[side]?.preset];
      return pr ? { ...pr, preset: rep.lineups[side].preset } : { mentality: 1, press: 1, line: 1, build: 1, width: 1, tempo: 1 };
    };
    const roleIn = (side: 0 | 1, id: string | null | undefined) => (id ? rep.lineups?.[side]?.roles?.[id] || '' : '');
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
      // a quiet spell only ends with the ball lost when the other team has the next move; otherwise we keep it
      const out: Outcome = !shot && p.off ? 'lost' : !shot ? (raw[i + 1] && raw[i + 1].s === s && !(p.t1 <= 45.01 && raw[i + 1].t0 >= 45) ? 'kept' : 'lost') : shot.goal ? 'goal' : shot.on ? 'saved' : 'wide';
      const prev = plans[i - 1];
      const ht = !!prev && p.t0 >= 45 - 1e-6 && prev.t0 < 45 - 1e-6;
      let restart: Plan['restart'] = null;
      let startX = endX;
      // who kicks off: the first team at the start, the other one after half-time, the team that conceded
      // after a goal. If the next attack is the other side's, they win it straight from the kick-off
      let koSide: 0 | 1 | undefined;
      if (!prev || ht || prev.out === 'goal') {
        restart = 'kickoff'; startX = 50;
        koSide = !prev ? s : ht ? ((1 - (plans[0].koSide ?? plans[0].s)) as 0 | 1) : ((1 - prev.s) as 0 | 1);
      }
      else if (prev.out === 'saved' || prev.out === 'wide') {
        if (prev.s !== s) restart = 'keeper';
        // the same team goes again: from the corner the save gave away, or from the keeper's clearance
        else if (shot?.kind === 'corner') { restart = 'corner'; startX = s === 0 ? 99 : 1; if (prev.out === 'saved') prev.parry = true; }
        else { restart = 'clear'; startX = s === 0 ? 55 : 45; }
      }
      const depth = (x: number) => (s === 0 ? x : 100 - x);
      let targetX = s === 0 ? DEPTH[Math.min(3, p.r)] : 100 - DEPTH[Math.min(3, p.r)];
      { const sp = p.sh >= 0 ? shots[p.sh] : null; if (sp && (sp.kind === 'penalty' || sp.kind === 'free kick')) targetX = s === 0 ? Math.max(targetX, sp.x - 8) : Math.min(targetX, sp.x + 8); }
      // the passing chain: start with the player who has the ball, then forward, one teammate at a time
      const ids = occAt(s, p.t0);
      const slots = F[s].slots;
      const live = slots.map((_, k) => k).filter((k) => ids[k]);
      const baseDepth = (k: number) => (slots[k] === 'GK' ? 2 : 12 + F[s].xy[k][0] * 0.62);
      let first: number;
      const outfield = live.filter((k) => slots[k] !== 'GK');
      const yOf = (k: number) => F[s].xy[k][1];
      if (restart === 'keeper') first = slots.indexOf('GK');
      else if (restart === 'kickoff') first = [...outfield].sort((a, b) => Math.abs(baseDepth(a) - 50) + Math.abs(yOf(a) - 50) * 0.5 - (Math.abs(baseDepth(b) - 50) + Math.abs(yOf(b) - 50) * 0.5))[0] ?? live[1];
      else if (restart === 'corner') {
        // the corner is taken by the attacker nearest that flag (he has the shortest way to it)
        const sh0 = shots[p.sh], flagAbs: [number, number] = [s === 0 ? 100 : 0, sh0 && sh0.y > 50 ? 100 : 0];
        first = outfield.filter((k) => slots[k] !== 'DEF').sort((a, b) => dist(absBase(s, a), flagAbs) - dist(absBase(s, b), flagAbs))[0] ?? outfield[0];
      }
      else if (restart === 'clear') first = outfield.filter((k) => slots[k] === 'MID').sort((a, b) => Math.abs(yOf(a) - 50) - Math.abs(yOf(b) - 50))[0] ?? outfield[0];
      else if (endHolder && endHolder.side === s && ids[endHolder.k]) first = endHolder.k;
      else if (endHolder && endHolder.side !== s) {
        // won straight back: our player nearest the man who had just won it
        const ex = absBase(endHolder.side, endHolder.k);
        first = outfield.sort((a, b) => dist(absBase(s, a), ex) - dist(absBase(s, b), ex))[0] ?? live[0];
      } else {
        // won back near where the ball was: the nearest of our players to that spot
        const d0 = depth(startX);
        first = outfield.sort((a, b) => Math.abs(baseDepth(a) + (d0 - 50) * 0.5 - d0) - Math.abs(baseDepth(b) + (d0 - 50) * 0.5 - d0))[0] ?? live[0];
      }
      // the passing: about one pass every 0.33 match minutes (1.1 s live) for the whole spell, short and
      // sideways while the team keeps the ball, working forward step by step toward where the move gets to
      // the tactic sets the rhythm: short build-up (tiki-taka) passes often, direct play goes long and forward
      const sty = styleAt(s, p.t0);
      const every = 0.33 * ([0.75, 1, 1.4][sty.build] ?? 1) * ([1.15, 1, 0.85][sty.tempo] ?? 1);
      // the time left for passing once the last move is finished off (keeper's ball, celebration, corner)
      const preMin = !prev ? 0 : restart === 'kickoff' && prev.out === 'goal' ? 0.95 : restart === 'clear' ? 0.9 : restart === 'corner' ? 0.6 : restart === 'keeper' ? (prev.out === 'wide' ? 0.5 : 0.4) : 0;
      const effDur = (p.t1 - p.t0) - Math.min(0.6 * (p.t1 - p.t0), preMin);
      const runFrac = shot ? (SET(shot.kind) || 0.84) : out === 'lost' ? 0.72 : 1;
      const N = Math.max(2, Math.min(16, Math.floor((effDur * runFrac) / every) + 1) - (shot ? 1 : 0)); // a shot always has a pass before it
      const counter = !restart && prev && prev.s !== s && prev.out === 'lost' && (sty.mentality === 0 || sty.build === 2) && p.r >= 2;
      const chain = [first];
      const d0 = restart === 'corner' ? 70 : depth(startX), dWant = depth(targetX) - 4;
      for (let n = 1; n < N; n++) {
        const cur = chain[chain.length - 1], before = chain.length > 1 ? chain[chain.length - 2] : -1;
        const goalD = d0 + (dWant - d0) * (n / Math.max(1, N - 1));
        const eff = (k: number) => baseDepth(k) + (goalD - 50) * 0.5;
        const gap = (k: number) => Math.hypot(baseDepth(k) - baseDepth(cur), yOf(k) - yOf(cur));
        let pool = (p.r === 0 && goalD < 35 ? live : outfield).filter((k) => k !== cur && k !== before);
        // short passing: only the nearest men; direct play: skip the nearest and go forward
        if (sty.build === 0 && !counter) pool = pool.sort((a, b) => gap(a) - gap(b)).slice(0, 4);
        else if (sty.build === 2 || counter) { const fwd = pool.filter((k) => baseDepth(k) > baseDepth(cur) + 10); if (fwd.length) pool = fwd; }
        if (!pool.length) break;
        const score = (k: number) => Math.abs(eff(k) - goalD) + Math.abs(yOf(k) - yOf(cur)) * 0.35 + (hash(i * 31 + n * 7 + k) % 10) * 0.9
          + (sty.build === 0 ? Math.hypot(baseDepth(k) - baseDepth(cur), yOf(k) - yOf(cur)) * 0.25 : 0) // short passes to the nearest men
          - ((sty.build === 2 || counter) && slots[k] === 'FWD' && goalD > 55 ? 8 : 0) // go long to the strikers
          + (sty.width === 2 ? (50 - Math.abs(yOf(k) - 50)) * 0.12 : sty.width === 0 ? Math.abs(yOf(k) - 50) * 0.12 : 0) // wide or through the middle
          - (PASS_TO[roleIn(s, ids[k])] ?? 0) // play goes through playmakers, crossers and the target man
          - (roleIn(s, ids[cur]) === 'Long passer' && slots[k] === 'FWD' ? 10 : 0); // the long passer looks for the strikers
        chain.push(pool.sort((a, b) => score(a) - score(b))[0]);
      }
      let setTaker: number | undefined, fouler: number | undefined;
      if (shot) {
        // the man who shoots (he may have come on during the move); never the keeper by default
        let scorer = shot.pid ? ids.indexOf(shot.pid) : -1;
        if (scorer < 0 && shot.pid) { const k1 = occAt(s, p.t1).indexOf(shot.pid); if (k1 >= 0) scorer = k1; }
        if (scorer < 0) scorer = [...outfield].sort((a, b) => depth(absBase(s, b)[0]) - depth(absBase(s, a)[0]))[0] ?? -1;
        if (shot.kind === 'penalty' || shot.kind === 'free kick') {
          // a set piece is won by a foul: the ball goes to the attacker nearest where it happens (in the
          // box for a penalty), he is brought down there, and then the taker comes up to the ball
          const at: [number, number] = [shot.x, shot.y];
          const fouled = [...outfield].sort((a, b) => dist(absBase(s, a), at) - dist(absBase(s, b), at))[0] ?? chain[chain.length - 1];
          if (chain[chain.length - 1] !== fouled) chain.push(fouled);
          setTaker = scorer >= 0 ? scorer : fouled;
          const booked = events.find((e) => (e.type === 'yellow' || e.type === 'red') && e.side === o && e.pid && Math.abs(e.m - shot.m) <= 1);
          const oid = occAt(o, p.t0), bk = booked ? oid.indexOf(booked.pid!) : -1;
          fouler = bk >= 0 ? bk : F[o].slots.map((_, k) => k).filter((k) => oid[k] && F[o].slots[k] !== 'GK').sort((a, b) => dist(absBase(o, a), at) - dist(absBase(o, b), at))[0];
        } else {
          const finisher = scorer >= 0 ? scorer : chain[chain.length - 1];
          if (chain[chain.length - 1] !== finisher) chain.push(finisher);
        }
      }
      // an offside: the last ball is played in behind to the most advanced forward
      if (p.off && !shot) {
        const fw = outfield.filter((k) => slots[k] === 'FWD' && ids[k]).sort((a, b) => baseDepth(b) - baseDepth(a) + (hash(i * 13 + a) % 3) - (hash(i * 13 + b) % 3));
        const runner = fw[0] ?? outfield.filter((k) => ids[k]).sort((a, b) => baseDepth(b) - baseDepth(a))[0];
        if (runner !== undefined && chain[chain.length - 1] !== runner) { if (chain.length >= 3 && chain[chain.length - 1] !== chain[0]) chain[chain.length - 1] = runner; else chain.push(runner); }
        if (chain.length >= 2 && chain[chain.length - 2] === chain[chain.length - 1]) chain.splice(chain.length - 2, 1);
      }
      // who wins a lost ball: the man marking the last one (see markOf), else the opponent nearest him
      let win: number | null = null;
      if (out === 'lost') {
        const last = chain[chain.length - 1];
        const mk = markOf(F, [occAt(0, p.t1), occAt(1, p.t1)], s).get(last);
        const lx = F[s].xy[last], oids = occAt(o, p.t1);
        const ex = depth(targetX), ey = lx[1];
        win = mk ?? F[o].slots.map((_, k) => k).filter((k) => oids[k] && F[o].slots[k] !== 'GK')
          .sort((a, b) => {
            const da = (100 - (12 + F[o].xy[a][0] * 0.62)) - ex, db = (100 - (12 + F[o].xy[b][0] * 0.62)) - ex;
            return Math.hypot(da, (100 - F[o].xy[a][1]) - ey) - Math.hypot(db, (100 - F[o].xy[b][1]) - ey);
          })[0] ?? null;
      }
      const label = counter ? 'Counter attack' : sty.build === 0 && sty.tempo === 0 ? 'Tiki-taka' : sty.build === 0 ? 'Patient build-up' : sty.build === 2 ? 'Direct ball' : undefined;
      // each man's turn on the ball: a moment on it, then the pass, which takes as long as its distance needs
      // (the ball travels at an even pace: a long ball is in the air longer, a short one is quick)
      const cum: number[] = [0]; let holds: number[] = [];
      {
        const flagAbs: [number, number] = [s === 0 ? 100 : 0, (shot && shot.y > 50) ? 100 : 0]; // a corner is crossed from the flag
        const wts = chain.slice(0, -1).map((k, j) => { const a = j === 0 && restart === 'corner' ? flagAbs : absBase(s, k), b2 = absBase(s, chain[j + 1]); return 0.3 + Math.hypot((a[0] - b2[0]) * 1.05, (a[1] - b2[1]) * 0.68) / 35; });
        holds = wts.map((w2) => 0.3 / w2);
        // a kick-off: a longer first turn (the kick-off itself, and the ball being won if the other side took it)
        if (restart === 'kickoff' && wts.length > 1) { const extra = koSide !== undefined && koSide !== s ? 1.1 : 0.5; wts[0] += extra; holds[0] = (0.3 + extra) / wts[0]; }
        wts.push(0.4); holds.push(1); // the last man holds it
        const tot = wts.reduce((x, y) => x + y, 0);
        let acc = 0; for (const w2 of wts) { acc += w2 / tot; cum.push(acc); }
      }
      plans.push({ ...p, i, startX, targetX, chain, cum, holds, out, win, restart, label, spot: shot ? [shot.x, shot.y] : undefined, kind: shot?.kind || '', setTaker, fouler, koSide, koMan: koSide !== undefined && koSide !== s ? (F[koSide].slots.map((_, k) => k).filter((k) => F[koSide!].slots[k] === 'MID' && occAt(koSide!, p.t0)[k]).sort((a, b) => Math.abs(F[koSide!].xy[a][1] - 50) - Math.abs(F[koSide!].xy[b][1] - 50))[0] ?? undefined) : undefined });
      endX = out === 'lost' || out === 'kept' ? targetX : out === 'goal' ? 50 : s === 0 ? 96 : 4;
      endHolder = out === 'lost' && win !== null ? { side: o, k: win } : out === 'kept' ? { side: s, k: chain[chain.length - 1] } : null;
    });
    // the start of each move first finishes what the last one began, so a shot's outcome lands on the
    // event's minute (in sync with the big animations) and nothing restarts out of nowhere
    plans.forEach((q, i) => {
      const prev = plans[i - 1];
      if (!prev) return;
      const P = q.restart === 'kickoff' && prev.out === 'goal' ? 0.95 : q.restart === 'clear' ? 0.9 : q.restart === 'corner' ? 0.6 : q.restart === 'keeper' ? (prev.out === 'wide' ? 0.5 : 0.4) : 0;
      if (P) q.pre = Math.min(0.6, P / Math.max(0.01, q.t1 - q.t0));
    });
    // a booking in open play is a foul you can see: the referee stops the move for a moment, shows the card,
    // and the free kick is taken where it happened (a card for a foul that gave a free kick or a penalty
    // comes with that set piece instead)
    events.forEach((e, i) => {
      if (e.type !== 'yellow' && e.type !== 'red') return;
      const isKick = (x: Ev) => x.m === e.m && x.side !== e.side && (x.type === 'freekick' || x.type === 'penalty');
      if (events.slice(Math.max(0, i - 3), i + 4).some(isKick)) return;
      const T = atMin(e), at = plans.findIndex((x) => x.t0 <= T && T < x.t1);
      if (at < 0) return;
      // the move it happened in, or (if that one is too short to stop) the one after it (never one before: a
      // live pitch may already be showing it before the card is known)
      for (const qi of [at, at + 1]) {
        const q = plans[qi];
        if (!q || Math.abs((qi === at ? T : qi > at ? q.t0 : q.t1) - T) > 0.7) continue;
        if (q.foul) { q.foul.evs.push(e); return; }
        const dur = (q.t1 - q.t0) * (1 - (q.pre || 0)), ce = setPieceOf(q) || (q.sh >= 0 ? 0.84 : q.out === 'lost' ? 0.72 : q.out === 'kept' ? 1 : 0.8);
        // about a second (less in a short move, never more than a third of its passing)
        const w = Math.min(0.3, dur * ce * 0.25) / Math.max(0.01, dur);
        if (w * dur < 0.075) continue;
        const Tq = qi === at ? T : qi > at ? q.t0 : q.t1;
        const v = ((Tq - q.t0) / (q.t1 - q.t0) - (q.pre || 0)) / (1 - (q.pre || 0));
        // the whistle goes while a man has the ball at his feet (never with a pass in the air), as close as
        // possible to when it happened
        // after the stop there is at least as much play left as the stop took, so nothing races to catch up
        const vMin = q.restart ? 0.2 : 0.04, vMax = ce - 2 * w - 0.01;
        let fv = -1;
        if (q.cum && q.holds) {
          for (let j = 0; j < q.chain.length; j++) {
            const lo = Math.max(vMin, q.cum[j] * ce), hi = Math.min(vMax, (q.cum[j] + q.holds[j] * (q.cum[j + 1] - q.cum[j])) * ce - 0.005);
            if (lo > hi) continue;
            const c = Math.max(lo, Math.min(hi, v));
            if (fv < 0 || Math.abs(c - v) < Math.abs(fv - v)) fv = c;
          }
        }
        if (fv >= 0) { q.foul = { v: fv, w, side: e.side, evs: [e] }; return; }
      }
    });
    // each offside belongs to the move it ends (the flag goes up when the ball reaches the runner)
    for (const e of events) {
      if (e.type !== 'offside') continue;
      const q = plans.find((x) => x.off && !x.offEv && x.s === e.side && x.m0 <= e.m && e.m <= x.m1);
      if (q) q.offEv = e;
    }
    const timeOf = timing(plans, shots);
    return { plans, F, occAt, shots, styleAt, timeOf, roleIn, timing };
  }
  /** when each event shows on the pitch's clock, from the moves as they are shown */
  function setPieceOf(q: Plan) { return SET(q.kind); }
  function timing(plans: Plan[], shots: Shot[]) {
    // anything timed by its minute shows inside the move playing that minute (as shown, after any stitch)
    const atMin = (e: Ev) => (e.type === 'ft' || e.type === 'pens' ? 90.5 : e.type === 'ht' ? 45 : minuteTime(plans as unknown as Move[], e.m) ?? evAt(e));
    // when each shot lands on the pitch (and when its foul was given), so events and animations show then
    const shotAt = new Map<number, { land: number; foul: number }>();
    for (const q of plans) if (q.sh >= 0) {
      const dur = q.t1 - q.t0, pre = q.pre || 0, sp = SET(q.kind);
      shotAt.set(q.sh, { land: q.t1, foul: q.t0 + (pre + (1 - pre) * sp) * dur });
    }
    const linked: Record<string, (x: Shot, e: Ev) => boolean> = {
      goal: (x, e) => x.goal && x.side === e.side, var: (x, e) => x.side === e.side, miss: (x, e) => !x.goal && x.side === e.side,
      penmiss: (x, e) => !x.goal && x.side === e.side && x.kind === 'penalty', save: (x, e) => !x.goal && x.side !== e.side,
      penalty: (x, e) => x.kind === 'penalty' && x.side === e.side, freekick: (x, e) => x.kind === 'free kick' && x.side === e.side,
    };
    // each event belongs to its own shot: two goals in the same minute are two shots, not the first one twice
    const shotOf = new Map<Ev, number>();
    {
      const used: Record<string, Set<number>> = {};
      for (const e of events) {
        const f = linked[e.type];
        if (!f) continue;
        const u = (used[e.type] ||= new Set());
        let k = shots.findIndex((x, j) => !x.ghost && x.m === e.m && f(x, e) && shotAt.has(j) && !u.has(j));
        if (k < 0) k = shots.findIndex((x, j) => !x.ghost && x.m === e.m && f(x, e) && shotAt.has(j));
        if (k >= 0) { u.add(k); shotOf.set(e, k); }
      }
    }
    /** when an event shows on the pitch's clock */
    const rawTime = (e: Ev): number => {
      const k = shotOf.get(e) ?? (linked[e.type] ? shots.findIndex((x, j) => !x.ghost && x.m === e.m && linked[e.type](x, e) && shotAt.has(j)) : -1);
      if (k >= 0) { const s2 = shotAt.get(k)!; return e.type === 'penalty' || e.type === 'freekick' ? s2.foul : s2.land; }
      if (e.type === 'yellow' || e.type === 'red') return cardAt(e);
      if (e.type === 'offside') {
        const oq = plans.find((p) => p.offEv === e);
        if (oq) { const pre = oq.pre || 0; return oq.t0 + (oq.t1 - oq.t0) * (pre + (1 - pre) * (0.72 + 0.28 * 0.12)); }
        // a flag in a minute shown by a chance: just after what came before it in that minute
        const i = events.indexOf(e), before = events.slice(0, i).filter((x) => x.m === e.m && x.type !== 'offside' && x.type !== 'yellow' && x.type !== 'red');
        return Math.max(atMin(e), ...before.map((x) => rawTime(x) + 0.02));
      }
      return atMin(e);
    };
    /** a card is shown when the referee blows for the foul: with the free kick or penalty it gave, or else
     * when the passage of play it happened in stops, never in the middle of a move */
    const cardAt = (e: Ev): number => {
      const i = events.indexOf(e);
      const isKick = (x: Ev) => x.m === e.m && x.side !== e.side && (x.type === 'freekick' || x.type === 'penalty');
      const kick = events.find((x, j) => j > i && isKick(x)) ?? [...events.slice(Math.max(0, i - 3), i)].reverse().find(isKick);
      if (kick) return rawTime(kick);
      const fq = plans.find((p) => p.foul?.evs.includes(e));
      if (fq && fq.foul) { const pre = fq.pre || 0; return fq.t0 + (fq.t1 - fq.t0) * (pre + (1 - pre) * (fq.foul.v + fq.foul.w * 0.3)); }
      const at = atMin(e), q = plans.find((p) => p.t0 <= at && at < p.t1);
      // ...but never after whatever comes next (a goal, the half-time whistle): nothing waits behind a card
      let nextT = Infinity;
      for (let j = i + 1; j < events.length; j++) if (events[j].type !== 'yellow' && events[j].type !== 'red') { nextT = rawTime(events[j]); break; }
      return Math.min(q ? Math.max(at, q.t1 - 0.05) : at, nextT - 0.01);
    };
    // the page reveals events in order, so a sub, a tactic change or a card timed by the minute must never
    // come later than the chance after it (the pitch can run a little ahead of the minute): those show a
    // moment earlier instead, and no goal is ever held back behind them
    const final = new Map<Ev, number>();
    let after = Infinity;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i], t = rawTime(e);
      const byShot = shotOf.has(e) || e.type === 'ft' || e.type === 'ht' || e.type === 'pens';
      const v = byShot ? t : Math.min(t, after);
      final.set(e, v);
      after = Math.min(after, v);
    }
    const timeOf = (e: Ev) => final.get(e) ?? rawTime(e);
    return timeOf;
  }
}

export function Pitch2D({ d, t, plan, mineSide, seen = [], fitOf }: { d: any; t: number; plan: ReturnType<typeof usePlan>; mineSide: number; seen?: Ev[]; fitOf?: (id: string) => number | null }) {
  // where each man was drawn last frame: nobody is ever drawn moving faster than a sprint
  const drawn = useRef<{ t: number; at: Map<string, [number, number]> }>({ t: -1, at: new Map() });
  const { plans, F, occAt, shots, styleAt, timeOf, roleIn } = plan;
  const idsNow = [occAt(0, t), occAt(1, t)];
  // a man who comes on takes over his slot's job (where he stands), so a substitution never moves anybody
  const idsStart = [occAt(0, -1), occAt(1, -1)];
  const roleAt = (side: 0 | 1, k: number) => roleIn(side, idsStart[side][k]) || roleIn(side, idsNow[side][k]);
  // which flank a full-back bombs forward on (for the flank cover)
  const overlapY = [0, 1].map((side) => { const k = F[side].slots.findIndex((s2: string, kk: number) => s2 === 'DEF' && ['Overlap', 'Wing back'].includes(roleAt(side as 0 | 1, kk))); return k >= 0 ? F[side].xy[k][1] : null; });
  // a change of set-up is walked into over about 5 seconds (the players get the message and drop or push
  // up together), never snapped
  const SHIFT = 1.5;
  const styleSmooth = (side: 0 | 1) => {
    const now = styleAt(side, t), before = styleAt(side, t - SHIFT);
    if (now === before) return now;
    let tc = t;
    for (let x = t - SHIFT; x <= t; x += 0.05) if (styleAt(side, x) === now) { tc = x; break; }
    const w = ease(c01((t - tc) / SHIFT));
    const mix: any = { ...now };
    for (const k of ['mentality', 'press', 'line', 'build', 'width', 'tempo'] as const) mix[k] = lerp((before as any)[k], (now as any)[k], w);
    return mix as typeof now;
  };
  const sty = [styleSmooth(0), styleSmooth(1)];
  // the move now
  let k = -1;
  { let lo = 0, hi = plans.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (plans[mid].t1 <= t) lo = mid + 1; else hi = mid - 1; } k = plans[lo] && plans[lo].t0 <= t ? lo : -1; }
  const p = k >= 0 ? plans[k] : null;
  const u = p ? c01((t - p.t0) / (p.t1 - p.t0)) : 0;
  const wy = wave(t);
  const team = (s: number) => (s === 0 ? d.home : d.away);
  // a move's own time (after the part that finishes the last move) and where its passing ends
  const inner = (q: NonNullable<typeof p>, v: number) => (q.pre ? c01((v - q.pre) / (1 - q.pre)) : v);
  const setPiece = (q: typeof p) => (q ? SET(q.kind) : 0);
  const chainEndOf = (q: typeof p) => (q ? (setPiece(q) || (q.sh >= 0 ? 0.84 : q.out === 'lost' ? 0.72 : q.out === 'kept' ? 1 : 0.8)) : 1);
  // a foul stops the play for a moment: the passing waits, then carries on to the same end
  const play = (q: NonNullable<typeof p>, v: number) => {
    const f = q.foul;
    if (!f) return v;
    const ce = chainEndOf(q);
    if (v < f.v || v >= ce) return v;
    if (v < f.v + f.w) return f.v;
    return f.v + ((v - f.v - f.w) * (ce - f.v)) / (ce - f.v - f.w);
  };
  // where along the chain the play is at passing progress f (0..1): whose turn (j), how far through it (seg),
  // and the share of his turn he keeps the ball before passing (hold)
  const chainAt = (q: NonNullable<typeof p>, f: number) => {
    const n = q.chain.length, cum = q.cum;
    if (!cum || cum.length !== n + 1 || !q.holds) { const x = c01(f) * (n - 0.4), j2 = Math.min(n - 1, Math.floor(x)); return { j: j2, seg: x - j2, hold: 0.4, x }; }
    const ff = c01(f);
    let j2 = 0; while (j2 < n - 1 && cum[j2 + 1] <= ff) j2++;
    const seg = c01((ff - cum[j2]) / Math.max(1e-6, cum[j2 + 1] - cum[j2]));
    return { j: j2, seg, hold: q.holds[j2], x: j2 + seg };
  };
  // the team moves up (or back) with the play at an even pace, starting while the last move is finished off
  const smooth3 = (u: number) => u * u * (3 - 2 * u);
  // ...and only as far as it has time for: a short move moves the block a few strides, not the whole pitch
  const reachX = (q: NonNullable<typeof p>) => { const inD = (q.t1 - q.t0) * (1 - (q.pre || 0)) * chainEndOf(q) + (q.t1 - q.t0) * (q.pre || 0) * 0.15, dist = Math.abs(q.targetX - q.startX) * 1.05; return q.startX + (q.targetX - q.startX) * Math.min(1, (40 * inD) / Math.max(1, dist)); };
  const phaseOf = (q: NonNullable<typeof p>, v: number) => { const pre = q.pre || 0, u = pre ? (v < pre ? 0.15 * (v / pre) : 0.15 + 0.85 * c01(play(q, inner(q, v)) / chainEndOf(q))) : c01(play(q, inner(q, v)) / chainEndOf(q)); return lerp(q.startX, reachX(q), smooth3(c01(u))); };

  // where each player stands, given where the play is
  const posP = (phaseX: number, att: 0 | 1 | null) => (side: 0 | 1, k: number): [number, number] => {
    const [fx, fy] = F[side].xy[k];
    const ballD = side === 0 ? phaseX : 100 - phaseX; // how far up the pitch the ball is, seen by this team
    const st = sty[side];
    let depth: number;
    if (F[side].slots[k] === 'GK') depth = 3 + Math.max(0, ballD - 50) * 0.08 + (st.line - 1) * 1.5;
    else {
      depth = 12 + fx * 0.62 * (att === side ? 1 : 0.86) + (ballD - 50) * 0.55;
      // the set-up shows: an attacking side and a high line play higher, a low block sits deep and tight,
      // a pressing side pushes up onto the ball when the other team has it in its own half
      depth += (st.mentality - 1) * 4 + (st.line - 1) * (F[side].slots[k] === 'DEF' ? 4 : 2);
      if (att !== side) depth += (st.press - 1) * 3.5 * c01((ballD - 35) / 40);
      // a parked bus (no press, defensive) squeezes into its own third; it grows in step with the change
      if (att !== side) depth = 12 + (depth - 12) * (1 - 0.2 * c01(1 - st.press) * c01(1 - st.mentality));
    }
    // the role shows in how he moves: in possession (a) and out of it
    const role = roleAt(side, k), a = att === side, hot = c01((ballD - 45) / 35);
    let yPull = 0, yTo = 50; // pull him toward yTo (seen from his own team, like fy) by yPull (0..1)
    const wyOwn = side === 0 ? wy : 100 - wy;
    const edge = fy < 50 ? 6 : 94;
    switch (role) {
      case 'Sweeper keeper': depth += a ? 9 : 4; break;
      case 'Shot stopper': depth -= 1; break;
      case 'Overlap': if (a) { depth += 15 * hot + 4; yPull = 0.5; yTo = edge; } break;
      case 'Wing back': depth += a ? 17 * hot + 5 : 2; yPull = 0.6; yTo = edge; break;
      case 'Inverted': if (a) { depth += F[side].slots[k] === 'DEF' ? 7 : 4; yPull = F[side].slots[k] === 'DEF' ? 0.55 : 0.4; } break;
      case 'Stopper': if (!a) depth += 5; break;
      case 'Sweeper': depth -= 5; break;
      case 'Supporting CDM': if (a) { depth += 12; yPull = 0.4; } break;
      case '2nd striker': if (F[side].slots[k] === 'DEF') { if (a) depth += 22 * c01((ballD - 75) / 15); } else if (a) { depth += 9 * hot; yPull = 0.4; } break;
      case 'Anchor': depth -= (ballD - 50) * 0.22; yPull = 0.5; break;
      case 'Marker': if (!a) { yPull = 0.3; yTo = wyOwn; depth -= 3; } break;
      case 'Deep-lying playmaker': if (a) { depth -= 9 * (1 - hot); yPull = 0.6; } break;
      case 'Flank cover': yPull = 0.5; yTo = overlapY[side] != null ? (overlapY[side]! < 50 ? 18 : 82) : edge < 50 ? 18 : 82; break;
      case 'Regista': if (a) { yPull = 0.35; yTo = wyOwn; depth += 2; } break;
      case 'Box to box': depth += a ? 9 * hot : -5; break;
      case 'Ball carrier': if (a) depth += 5; break;
      case 'Playmaker': if (a) { yPull = 0.4; depth += 3; } break;
      case 'Long shooter': if (a) depth += 6 * hot; break;
      case 'Supporting wing': if (a) { yPull = 0.45; yTo = edge; } break;
      case 'Drift wide': if (a) { yPull = 0.6; yTo = fy <= 50 ? 12 : 88; } break;
      case 'Early crosser': if (a) { depth -= 4; yPull = 0.6; yTo = edge; } break;
      case 'Inside winger': if (a) { yPull = 0.45; depth += 4 * hot; } break;
      case 'Wide winger': if (a) { yPull = 0.75; yTo = edge; } break;
      case 'Shadow striker': if (a) { yPull = 0.5; depth += 9 * hot; } break;
      case 'Line breaker': depth += a ? 10 * hot + 3 : 6; break;
      case 'Poacher': depth += a ? 6 : 4; yPull = 0.5; break;
      case 'Target man': if (a) { yPull = 0.6; depth += 4; } break;
      case 'False 9': if (a) depth -= 14; break;
    }
    depth = Math.max(3, Math.min(97, depth + Math.sin(t * 0.9 + k * 1.9 + side) * 1.6 + Math.sin(t * 2.3 + k) * 0.5));
    const spread = att === side ? 0.82 + st.width * 0.12 : 0.86 - 0.08 * c01(1 - st.press);
    let fy2 = 50 + (fy - 50) * spread;
    if (yPull) fy2 = lerp(fy2, yTo, yPull);
    const y0 = side === 0 ? fy2 : 100 - fy2;
    const y = y0 + (wy - y0) * (F[side].slots[k] === 'GK' ? 0.12 : 0.24) + Math.cos(t * 0.8 + k * 2.3) * 1.8;
    const x = side === 0 ? depth : 100 - depth;
    return [x / 100 * L, (6 + y * 0.88) / 100 * W];
  };

  type Line = { from: [number, number]; to: [number, number]; side: 0 | 1 };
  type St = { ball: [number, number]; holder: { side: 0 | 1; k: number } | null; pass: Line | null; lastPass: Line | null; shotLine: Line | null; banner: string; bannerSide: 0 | 1; chance: { side: 0 | 1; xg: number; label: string } | null };
  // where the players are during move q: the formation shape, plus the shooter's run into the spot he
  // shoots from and the corner taker at the flag
  const toPitch = (xy: [number, number]): [number, number] => [xy[0] / 100 * L, (6 + xy[1] * 0.88) / 100 * W];
  const marksOf = (q: NonNullable<typeof p>) => {
    let m = markMemo.get(q);
    if (!m) { const a = markOf(F, [occAt(0, q.t0), occAt(1, q.t0)], q.s); m = new Map([...a].map(([x, y]) => [y, x])); markMemo.set(q, m); }
    return m; // defender slot -> the attacker he marks
  };
  const posQ = (q: NonNullable<typeof p>, vRaw: number, blend = true): ((side: 0 | 1, k: number) => [number, number]) => {
    const v = inner(q, vRaw);
    const base = posP(phaseOf(q, vRaw), q.s);
    const ce = chainEndOf(q), n = q.chain.length, sp0 = setPiece(q);
    const fin = q.sh >= 0 ? (sp0 && q.setTaker != null ? q.setTaker : q.chain[n - 1]) : -1, taker = q.restart === 'corner' ? q.chain[0] : -1;
    const fouled = sp0 ? q.chain[n - 1] : -1;
    const flag: [number, number] = [q.s === 0 ? L - 0.6 : 0.6, (q.spot ? q.spot[1] : 50) > 50 ? W - 0.6 : 0.6];
    const firstPass = q.cum && q.cum.length > 1 ? q.cum[1] * ce : ce / (n - 0.4); // the end of the first man's turn
    // off the ball: the next man to get it moves into space, the strikers make runs in a real attack,
    // the full-backs overlap in a team that plays wide (all smooth in v, so nobody jumps)
    const xNow = chainAt(q, v / ce).x, dir = q.s === 0 ? 1 : -1, stA = sty[q.s];
    const bump = (u: number) => Math.sin(Math.PI * c01(u));
    const goalX = q.s === 0 ? L : 0;
    // a run to a spot that ends at vEnd: it starts early enough that nobody goes faster than a sprint
    // (about 45 m a match minute, 13 m/s)
    const inDur = Math.max(0.05, (q.t1 - q.t0) * (1 - (q.pre || 0)));
    // (worked out on the move's whole clock, so a run can start while the last move is finished off)
    const preQ = q.pre || 0, durQ = Math.max(0.05, q.t1 - q.t0);
    const runTo = (from: [number, number], to: [number, number], vEnd: number, minLen: number): [number, number] => {
      const endR = preQ + (1 - preQ) * vEnd, lenR = Math.max(minLen * (1 - preQ), Math.hypot(to[0] - from[0], to[1] - from[1]) / 45 / durQ), vs = Math.max(0, endR - lenR);
      const w = ease(c01((vRaw - vs) / Math.max(1e-3, endR - vs)));
      return [lerp(from[0], to[0], w), lerp(from[1], to[1], w)];
    };
    const spot: [number, number] | null = q.spot ? (q.kind === 'penalty' ? [q.s === 0 ? L - 11 : 11, W / 2] : toPitch(q.spot)) : null;
    // set piece: everyone else clears the box for a penalty; for a free kick three men form the wall
    const setW = sp0 ? ease(c01((v - sp0 + 0.05) / 0.3)) : 0;
    // the wall: the three nearest the ball when the foul is given (chosen once, so nobody jumps in later)
    // (from where they stand in the formation: a fixed choice, so nobody walks in or out of it later)
    const dSide = (1 - q.s) as 0 | 1;
    const formAt = (k: number): [number, number] => { const [fx, fy] = F[dSide].xy[k]; const dd = 12 + fx * 0.62; return dSide === 0 ? [dd / 100 * L, fy / 100 * W] : [(100 - dd) / 100 * L, (100 - fy) / 100 * W]; };
    const wallK = q.kind === 'free kick' && spot ? F[dSide].slots.map((sl, k) => k).filter((k) => F[dSide].slots[k] !== 'GK' && k !== q.fouler)
      .sort((a, b) => Math.hypot(formAt(a)[0] - spot[0], formAt(a)[1] - spot[1]) - Math.hypot(formAt(b)[0] - spot[0], formAt(b)[1] - spot[1])).slice(0, 3) : [];
    // a kick-off: everyone in his own half until the ball is played, the man taking it on the centre spot
    const koEnd = q.restart === 'kickoff' ? (q.cum && q.holds ? q.cum[1] * ce * q.holds[0] * (q.koSide !== undefined && q.koSide !== q.s ? 0.35 : 1) : 0.1) : 0;
    const koW = q.restart === 'kickoff' ? 1 - ease(c01((v - koEnd) / 0.25)) : 0;
    const ownHalf = (side: 0 | 1, xy: [number, number]): [number, number] => (koW > 0 ? [lerp(xy[0], side === 0 ? Math.min(xy[0], L / 2 - 1.2) : Math.max(xy[0], L / 2 + 1.2), koW), xy[1]] : xy);
    const own = (side: 0 | 1, k: number): [number, number] => { const r0 = ownRaw(side, k); return koW > 0 && !(side === q.koSide && k === (q.koSide === q.s ? q.chain[0] : q.koMan)) ? ownHalf(side, r0) : r0; };
    const ownRaw = (side: 0 | 1, k: number): [number, number] => {
      let b = base(side, k);
      if (q.restart === 'kickoff' && q.koSide !== undefined && q.koSide !== q.s && side === q.koSide && k === q.koMan) {
        const c0: [number, number] = [L / 2 + (side === 0 ? -0.9 : 0.9), W / 2 - 0.5], len = Math.max(0.25, Math.hypot(b[0] - c0[0], b[1] - c0[1]) / 30 / inDur), w = 1 - ease(c01((v - koEnd) / len));
        b = [lerp(b[0], c0[0], w), lerp(b[1], c0[1], w)];
        if (!(q.out === 'lost' && k === q.win)) return b;
      }
      // the keeper on his line for a penalty
      if (setW && side !== q.s && F[side].slots[k] === 'GK' && q.kind === 'penalty') return [lerp(b[0], goalX + (q.s === 0 ? -0.8 : 0.8), setW), lerp(b[1], W / 2, setW)];
      if (setW && side !== q.s && wallK.includes(k) && spot) {
        const gx = goalX - spot[0], gy = W / 2 - spot[1], gl = Math.hypot(gx, gy) || 1, j = wallK.indexOf(k) - 1;
        const wx = spot[0] + (gx / gl) * 9.15 - (gy / gl) * j * 1.1, wy = spot[1] + (gy / gl) * 9.15 + (gx / gl) * j * 1.1;
        return [lerp(b[0], wx, setW), lerp(b[1], wy, setW)];
      }
      if (side !== q.s && q.out === 'lost' && k === q.win) {
        // the ball is won by a tackle: he closes the man on the ball down and takes it off him
        const lk = q.chain[n - 1], tgt = ownRaw(q.s, lk), contact = ce + (1 - ce) * 0.45;
        const to: [number, number] = [tgt[0] + (q.s === 0 ? 1.6 : -1.6), tgt[1] + 0.6];
        return runTo(b, to, contact, 0.3);
      }
      if (side !== q.s && sp0 && spot && k === q.fouler) {
        const fp: [number, number] = q.kind === 'penalty' ? [goalX - dir * 13.8, W / 2 + (hash(q.i) % 2 ? 4.3 : -2.7)] : [spot[0] + dir * 0.6, spot[1] - 0.6];
        const p0 = runTo(b, fp, sp0, 0.2);
        if (q.kind === 'penalty') { const edge = q.s === 0 ? L - 17.5 : 17.5; return [lerp(p0[0], q.s === 0 ? Math.min(p0[0], edge) : Math.max(p0[0], edge), setW), p0[1]]; }
        return [lerp(p0[0], b[0], setW), lerp(p0[1], b[1], setW)];
      }
      if (side !== q.s) {
        // the team without the ball moves as a unit with its tactic: across to the side the attack is on
        // (further and tighter when it presses), stepping up with a high line, sitting off in a low block.
        // It follows the attack's direction (who has it now and who gets it next), so it glides with play
        const shapeOn = (1 - setW) * (q.restart === 'kickoff' ? c01((v - koEnd) / 0.3) : 1);
        if (shapeOn > 0) {
          const ca = chainAt(q, v / ce), k1 = q.chain[Math.min(n - 1, ca.j)], k2 = q.chain[Math.min(n - 1, ca.j + 1)];
          const fyA = (kk: number) => { const y = F[q.s].xy[kk][1]; return (q.s === 0 ? y : 100 - y) / 100 * W; };
          const cy = lerp(fyA(k1), fyA(k2), ca.j >= n - 1 ? 0 : smooth3(c01((ca.seg - ca.hold) / (1 - ca.hold))));
          const stD = sty[side], gk = F[side].slots[k] === 'GK';
          const across = (cy - W / 2) * (gk ? 0.12 : 0.26 + stD.press * 0.06) * shapeOn;
          const step = (gk ? 0 : (stD.line - 1) * 2.5 + stD.press * 0.8) * (side === 0 ? 1 : -1) * shapeOn;
          const squeeze = gk ? 1 : 1 - 0.06 * stD.press * shapeOn; // a pressing side narrows round the ball
          b = [b[0] + step, W / 2 + (b[1] - W / 2) * squeeze + across];
          // ...and each man also picks up his own attacker: goal-side of him, tighter the nearer he gets to
          // goal and the more the side presses (a man marker, not a wall moving as one)
          const mm = gk ? undefined : marksOf(q).get(k);
          if (mm !== undefined) {
            const man = ownRaw(q.s, mm), ownGoal = side === 0 ? 0 : L;
            const tgt: [number, number] = [man[0] + (side === 0 ? -2.2 : 2.2), man[1] + (W / 2 - man[1]) * 0.1];
            const near = c01(1 - Math.abs(man[0] - ownGoal) / (L * 0.75));
            const wM = Math.min(0.75, (0.26 + 0.1 * stD.press + (F[side].slots[k] === 'DEF' ? 0.08 : 0)) * (0.55 + 0.65 * near)) * shapeOn;
            b = [lerp(b[0], tgt[0], wM), lerp(b[1], tgt[1], wM)];
          }
        }
        if (setW && q.kind === 'penalty' && F[side].slots[k] !== 'GK') { const edge = q.s === 0 ? L - 17.5 : 17.5; return [lerp(b[0], q.s === 0 ? Math.min(b[0], edge) : Math.max(b[0], edge), setW), b[1]]; }
        return b;
      }
      let fwd = 0;
      for (let c = 1; c < n; c++) if (q.chain[c] === k) fwd = Math.max(fwd, 3.2 * c01(1 - Math.abs(xNow - (c - 0.35)) / 1.1));
      const slot = F[side].slots[k], fy = F[side].xy[k][1];
      // runs forward last as long as the move does: a short move only has time for a few strides
      if (slot === 'FWD' && q.r >= 2) fwd += Math.min(4.5, 30 * inDur * ce) * bump(v / ce);
      if (slot === 'DEF' && Math.abs(fy - 50) > 28 && stA.width > 0 && q.r >= 1) fwd += Math.min(9 * c01(stA.width) + 6 * c01(stA.width - 1), 16 * inDur) * bump((v - 0.12) / 0.7);
      const bb: [number, number] = [b[0] + dir * fwd, b[1]];
      if (sp0 && spot && (k === fouled || k === fin)) {
        // the man fouled carries it to where he is brought down (in the box for a penalty); the taker then
        // goes to the ball, a few steps back, and runs up
        const foulPt: [number, number] = q.kind === 'penalty' ? [goalX - dir * 13, W / 2 + (hash(q.i) % 2 ? 3.5 : -3.5)] : [spot[0] - dir * 0.6, spot[1] + 0.8];
        let p0 = bb;
        if (k === fouled) p0 = runTo(bb, foulPt, sp0, 0.2);
        if (k === fin) {
          const behind: [number, number] = [spot[0] - dir * 2.4, spot[1] + 1];
          const runUp = ease(c01((v - 0.8) / 0.04));
          const at: [number, number] = [lerp(behind[0], spot[0] - dir * 0.8, runUp), lerp(behind[1], spot[1], runUp)];
          return [lerp(p0[0], at[0], setW), lerp(p0[1], at[1], setW)];
        }
        if (q.kind === 'penalty') { const edge = q.s === 0 ? L - 17.5 : 17.5; return [lerp(p0[0], q.s === 0 ? Math.min(p0[0], edge) : Math.max(p0[0], edge), setW), p0[1]]; }
        return [lerp(p0[0], p0[0] + dir * 3, setW), lerp(p0[1], p0[1] + 3, setW)];
      }
      if (k === fin && spot && fin !== taker) {
        if (sp0) {
          // the taker: to the ball after the foul, a few steps back, then the run-up
          const behind: [number, number] = [spot[0] - dir * 2.4, spot[1] + 1];
          const runUp = ease(c01((v - 0.8) / 0.04));
          const at: [number, number] = [lerp(behind[0], spot[0] - dir * 0.8, runUp), lerp(behind[1], spot[1], runUp)];
          return [lerp(bb[0], at[0], setW), lerp(bb[1], at[1], setW)];
        }
        return runTo(bb, spot, ce * 0.95, ce * 0.5);
      }
      if (setW && q.kind === 'penalty' && F[side].slots[k] !== 'GK') { const edge = q.s === 0 ? L - 17.5 : 17.5; return [lerp(bb[0], q.s === 0 ? Math.min(bb[0], edge) : Math.max(bb[0], edge), setW), bb[1]]; }
      if (k === taker) { const len = Math.max(0.2, Math.hypot(bb[0] - flag[0], bb[1] - flag[1]) / 30 / inDur), w = 1 - ease(c01((v - firstPass) / len)); return [lerp(bb[0], flag[0], w), lerp(bb[1], flag[1], w)]; }
      // the kick-off: the first man stands over the ball on the centre spot
      if (q.restart === 'kickoff' && (q.koSide === undefined || q.koSide === q.s) && k === q.chain[0]) { const c0: [number, number] = [L / 2 - dir * 0.9, W / 2 - 0.5], len = Math.max(0.25, Math.hypot(bb[0] - c0[0], bb[1] - c0[1]) / 30 / inDur), w = 1 - ease(c01((v - firstPass * 0.4) / len)); return [lerp(bb[0], c0[0], w), lerp(bb[1], c0[1], w)]; }
      return bb;
    };
    // the players walk on from where the last move left them (about 1 s live), nobody snaps into place
    const prevQ = blend && q.i > 0 && !(q.t0 >= 45 - 1e-6 && plans[q.i - 1].t0 < 45 - 1e-6) ? plans[q.i - 1] : null; // after half-time everybody comes out in place
    if (!prevQ) return own;
    const dur = Math.max(0.01, q.t1 - q.t0);
    // a long way back (after an attack at the other end) takes longer to run than a few steps
    const was0 = posQ(prevQ, 1, false), own0 = own;
    let far = 0;
    for (const sd of [0, 1] as const) for (let kk = 0; kk < F[sd].xy.length; kk++) { const p0 = was0(sd, kk), p1 = own0(sd, kk); far = Math.max(far, Math.hypot(p0[0] - p1[0], p0[1] - p1[1])); }
    const need = Math.max((q.pre || 0) * dur, 0.4, far / 25); // about 7.5 m a second at most
    const bw = ease(c01(vRaw / Math.min(0.95, need / dur)));
    if (bw >= 1) return own;
    const was = was0;
    // the corner taker runs to the flag while the ball goes out, so he is there when it is taken
    const tw = (q.restart === 'corner' || q.restart === 'kickoff') && q.pre ? ease(c01(vRaw / q.pre)) : -1;
    // ...and so does the man who takes the kick-off: he is on the centre spot when the celebration ends
    const koTaker = q.restart === 'kickoff' ? (q.koSide !== undefined && q.koSide !== q.s ? { side: q.koSide, k: q.koMan } : { side: q.s, k: q.chain[0] }) : null;
    const blended = (side: 0 | 1, k: number): [number, number] => {
      const a = was(side, k), b = own(side, k);
      const lead = tw >= 0 && ((q.restart === 'corner' && side === q.s && k === q.chain[0]) || (koTaker && side === koTaker.side && k === koTaker.k));
      const w = lead ? tw : bw;
      return [lerp(a[0], b[0], w), lerp(a[1], b[1], w)];
    };
    // the tackler gets to the man on the ball wherever he really is, even while the others still walk on
    const contactV = ce + (1 - ce) * 0.45;
    return (side, k) => {
      const r = blended(side, k);
      if (q.off && side === q.s && k === q.chain[n - 1]) {
        // the runner goes too early: by the time the ball reaches him he is past the last defender
        const w = ease(c01((v - ce * 0.78) / (ce * 0.22)));
        if (w <= 0) return r;
        const od = occAt(dSide, q.t0);
        const xs = F[dSide].slots.map((sl, kk) => (sl !== 'GK' && od[kk] ? blended(dSide, kk)[0] : null)).filter((x): x is number => x !== null);
        if (!xs.length) return r;
        const line = q.s === 0 ? Math.max(...xs) : Math.min(...xs), tx = line + dir * 2.2;
        const x = q.s === 0 ? Math.max(r[0], tx) : Math.min(r[0], tx);
        return [lerp(r[0], x, w), r[1]];
      }
      if (q.out !== 'lost' || side === q.s || k !== q.win) return r;
      const ap = blended(q.s, q.chain[n - 1]), tgt: [number, number] = [ap[0] + (q.s === 0 ? 1.6 : -1.6), ap[1] + 0.6];
      const w = ease(c01((v - (contactV - 0.2)) / 0.2));
      return [lerp(r[0], tgt[0], w), lerp(r[1], tgt[1], w)];
    };
  };
  // the defending side closes the ball down: the nearer a man is to the ball, the harder he presses
  // (a pressing tactic pushes more of them onto it); it only follows the ball, so it is smooth too
  const pressed = (pos: (side: 0 | 1, k: number) => [number, number], att: 0 | 1, ball: [number, number], skip: { side: 0 | 1; k: number } | null, fade: number, calm = 1) => (side: 0 | 1, k: number): [number, number] => {
    const b0 = pos(side, k);
    if (F[side].slots[k] === 'GK' || (skip && skip.side === side && skip.k === k)) return b0;
    // everyone keeps moving a little (a step, a jog), nobody stands frozen
    const ph = hash(side * 31 + k * 7) % 628 / 100;
    const jig: [number, number] = [Math.sin(t * 5.1 + ph) * 0.5 * calm, Math.cos(t * 4.3 + ph * 1.3) * 0.6 * calm];
    // the team on the ball moves with its own move (runs, passes); the men with a job in this move (the
    // tackler, the man who fouls) go where that job takes them
    if (side === att || (p && ((p.out === 'lost' && k === p.win) || k === p.fouler))) return b0;
    const b: [number, number] = [b0[0] + jig[0], b0[1] + jig[1]];
    const dx = ball[0] - b[0], dy = ball[1] - b[1], dd = Math.hypot(dx, dy);
    // the nearest men step up to the ball, not across the pitch: when it is played away they drop back
    // at a run, never a sprint across the field
    const reach = 8 + sty[side].press * 3;
    const w = c01(1 - dd / reach) ** 1.5 * (0.35 + sty[side].press * 0.1) * fade * calm;
    const go = Math.max(0, dd - 2.4) * w;
    return dd > 0 ? [b[0] + (dx / dd) * go, b[1] + (dy / dd) * go] : b;
  };
  // everything on the pitch for move q at progress v (0..1)
  const stateAt = (q: NonNullable<typeof p>, vRaw: number): St => {
    const pos = posQ(q, vRaw);
    const s = q.s, o = (1 - s) as 0 | 1, n = q.chain.length, ce = chainEndOf(q);
    const slotAt = (x: number) => q.chain[Math.min(n - 1, Math.max(0, x))];
    const goalX = s === 0 ? L : 0;
    const st: St = { ball: [L / 2, W / 2], holder: null, pass: null, lastPass: null, shotLine: null, banner: '', bannerSide: s, chance: null };
    const prev = q.i > 0 ? plans[q.i - 1] : null;
    const from = (): [number, number] => (prev ? stateAt(prev, 1).ball : [L / 2, W / 2]);
    // 1) finishing the last move: the celebration, the keeper's ball, the ball going out for a corner
    if (q.pre && vRaw < q.pre && prev) {
      const w = vRaw / q.pre, f = from();
      st.bannerSide = prev.s;
      if (q.restart === 'kickoff') {
        st.ball = w < 0.35 ? f : w < 0.85 ? [lerp(f[0], L / 2, ease((w - 0.35) / 0.5)), lerp(f[1], W / 2, ease((w - 0.35) / 0.5))] : [L / 2, W / 2];
        st.banner = w < 0.6 ? 'GOAL!' : 'Back to the centre';
        return st;
      }
      const ko = (1 - s) as 0 | 1, gkO = F[ko].slots.indexOf('GK');
      const keeperO = gkO >= 0 ? pos(ko, gkO) : [s === 0 ? L - 2 : 2, W / 2] as [number, number];
      if (q.restart === 'keeper') {
        // the keeper (of the team that now has it) gathers it
        const gk = F[s].slots.indexOf('GK'), kp = gk >= 0 ? pos(s, gk) : f;
        st.ball = [lerp(f[0], kp[0], ease(w)), lerp(f[1], kp[1], ease(w))];
        if (w > 0.8 && gk >= 0) st.holder = { side: s, k: gk };
        st.banner = prev.out === 'saved' ? 'Saved!' : w < 0.4 ? 'Off target' : 'Goal kick';
        return st;
      }
      if (q.restart === 'corner') {
        const off: [number, number] = [goalX + (s === 0 ? 1.2 : -1.2), (q.spot ? q.spot[1] : 50) > 50 ? W - 3 : 3];
        const flagP: [number, number] = [s === 0 ? L - 0.6 : 0.6, off[1] > W / 2 ? W - 0.6 : 0.6];
        st.ball = w < 0.5 ? [lerp(f[0], off[0], ease(w / 0.5)), lerp(f[1], off[1], ease(w / 0.5))] : [lerp(off[0], flagP[0], ease((w - 0.5) / 0.5)), lerp(off[1], flagP[1], ease((w - 0.5) / 0.5))];
        st.banner = w < 0.5 ? 'Saved! Corner' : 'Corner';
        return st;
      }
      // a clearance: their keeper holds it, then kicks it long and we win the second ball
      const first = pos(s, q.chain[0]);
      if (w < 0.45) { st.ball = [lerp(f[0], keeperO[0], ease(w / 0.45)), lerp(f[1], keeperO[1], ease(w / 0.45))]; if (w > 0.3 && gkO >= 0) st.holder = { side: ko, k: gkO }; st.banner = prev.out === 'saved' ? 'Saved!' : 'Goal kick'; st.bannerSide = ko; return st; }
      const k2 = ease((w - 0.45) / 0.55);
      st.ball = [lerp(keeperO[0], first[0], k2), lerp(keeperO[1], first[1], k2)];
      st.pass = { from: keeperO, to: first, side: ko };
      st.banner = 'Keeper clears'; st.bannerSide = ko;
      return st;
    }
    const vIn = inner(q, vRaw);
    const v = play(q, vIn);
    const stopped = !!q.foul && vIn >= q.foul.v && vIn < q.foul.v + q.foul.w;
    const sp0 = setPiece(q);
    if (q.sh >= 0 && v > ce * 0.55) st.chance = { side: s, xg: shots[q.sh].xg, label: q.kind === 'penalty' ? 'Penalty' : q.kind === 'free kick' ? 'Free kick' : shots[q.sh].xg >= 0.25 ? 'Big chance' : 'Goal chance' };
    // 2) the passing
    if (v < ce) {
      const { j, seg, hold: hold0 } = chainAt(q, v / ce); // each man: a moment on the ball, then the pass
      // a corner is taken from the flag
      const flagAt: [number, number] = [s === 0 ? L - 0.6 : 0.6, (q.spot ? q.spot[1] : 50) > 50 ? W - 0.6 : 0.6];
      const a: [number, number] = q.restart === 'corner' && j === 0 ? [flagAt[0] - (s === 0 ? 0.9 : -0.9), flagAt[1] - 0.5] : pos(s, slotAt(j)), b = pos(s, slotAt(j + 1));
      const dir = s === 0 ? 1 : -1;
      // the pass leaves the foot early enough for its real length (the men have moved since it was planned):
      // never faster than a hard-hit ball, about 35 m/s (117 m a match minute)
      let hold = hold0;
      if (j < n - 1 && q.cum && !(q.restart === 'kickoff' && j === 0)) {
        const turn = Math.max(1e-3, (q.cum[j + 1] - q.cum[j]) * ce * (q.t1 - q.t0) * (1 - (q.pre || 0)));
        const need = Math.hypot(b[0] - a[0], b[1] - a[1]) / 117 / turn;
        hold = Math.max(0.03, Math.min(hold0, 1 - Math.min(0.97, need)));
      }
      const koOther = q.restart === 'kickoff' && q.koSide !== undefined && q.koSide !== s && q.koMan !== undefined && j === 0 && seg < hold0;
      if (koOther && seg < hold0 * 0.35) { const km = pos(q.koSide!, q.koMan!); st.ball = [km[0] + (q.koSide === 0 ? 0.9 : -0.9), km[1] + 0.5]; st.holder = { side: q.koSide!, k: q.koMan! }; }
      else if (koOther) { const km = pos(q.koSide!, q.koMan!), f0: [number, number] = [km[0] + (q.koSide === 0 ? 0.9 : -0.9), km[1] + 0.5], u3 = ease(c01((seg - hold0 * 0.35) / (hold0 * 0.65))); st.ball = [lerp(f0[0], a[0] + dir * 0.9, u3), lerp(f0[1], a[1] + 0.5, u3)]; if (u3 >= 1) st.holder = { side: s, k: slotAt(0) }; }
      else if (seg < hold || j >= n - 1) { st.ball = [a[0] + dir * 0.9, a[1] + 0.5]; st.holder = { side: s, k: slotAt(j) }; }
      else { const u2 = c01((seg - hold) / (1 - hold)), w = u2 * u2 * (3 - 2 * u2); st.ball = [lerp(a[0], b[0], w), lerp(a[1], b[1], w)]; st.pass = { from: a, to: b, side: s }; } // an even flight
      if (j >= 1 && !st.pass) st.lastPass = { from: pos(s, slotAt(j - 1)), to: a, side: s };
      st.banner = koOther ? (seg < hold0 * 0.35 ? 'KICK-OFF' : 'Ball won back') : q.restart === 'kickoff' && v < 0.12 && (q.koSide === undefined || q.koSide === s) ? 'KICK-OFF' : q.restart === 'keeper' && v < 0.15 ? 'Goal kick' : q.restart === 'clear' && v < 0.18 ? 'Second ball'
        : q.restart === 'corner' && v < 0.25 ? 'Corner' : q.label && v < 0.45 ? q.label : q.r === 0 || v < 0.3 ? 'Building up' : q.r === 1 ? 'Attack' : v > 0.5 ? 'Dangerous attack' : 'Attack';
      if (koOther && seg < hold0 * 0.35) st.bannerSide = q.koSide!;
      if (q.kind === 'counter' && v < 0.5) st.banner = 'Counter attack';
      if (q.kind === 'corner' && v > ce * 0.55) st.banner = 'Corner';
      if (stopped) { st.pass = null; st.ball = [a[0] + dir * 0.9, a[1] + 0.5]; st.holder = { side: s, k: slotAt(j) }; st.banner = q.foul!.evs.some((x) => x.type === 'red') ? 'Foul! Red card' : 'Foul! Yellow card'; st.bannerSide = q.foul!.side; }
      return st;
    }
    const last = pos(s, slotAt(n - 1));
    const name = (k: number) => lastName(d.names[occAt(s, q.t0)[k] || '']?.name || '');
    // 3) a set piece: the foul, the ball on the spot, the taker steps up
    if (sp0 && v < 0.84 && q.spot) {
      const spot: [number, number] = q.kind === 'penalty' ? [s === 0 ? L - 11 : 11, W / 2] : toPitch(q.spot);
      const w = ease(c01((v - sp0) / 0.1));
      const end = pos(s, slotAt(n - 1)), tk = q.setTaker ?? slotAt(n - 1);
      st.ball = [lerp(end[0], spot[0], w), lerp(end[1], spot[1], w)];
      st.holder = w >= 1 ? { side: s, k: tk } : null;
      st.banner = q.kind === 'penalty' ? (v < sp0 + 0.22 ? 'PENALTY!' : `${name(tk)} steps up…`) : v < sp0 + 0.15 ? 'Foul · free kick' : `${name(tk)} over the ball…`;
      return st;
    }
    if (q.out === 'kept') { st.ball = [last[0] + (s === 0 ? 0.9 : -0.9), last[1] + 0.5]; st.holder = { side: s, k: slotAt(n - 1) }; st.banner = 'Keeping the ball'; return st; }
    if (q.out === 'lost') {
      // closed down: he keeps it until the defender gets to him, then loses it in the tackle
      const contact = ce + (1 - ce) * 0.45;
      const win = q.win !== null ? pos(o, q.win) : last;
      if (q.off && v < contact) { st.ball = [last[0] + (s === 0 ? 0.9 : -0.9), last[1] + 0.5]; st.holder = { side: s, k: slotAt(n - 1) }; st.banner = v < ce + (1 - ce) * 0.1 ? 'Through ball' : 'Offside!'; st.bannerSide = v < ce + (1 - ce) * 0.1 ? s : o; return st; }
      if (q.off) {
        const w = ease(c01((v - contact) / ((1 - contact) * 0.4)));
        const from: [number, number] = [last[0] + (s === 0 ? 0.9 : -0.9), last[1] + 0.5];
        st.ball = [lerp(from[0], win[0] + (o === 0 ? 0.9 : -0.9), w), lerp(from[1], win[1] + 0.5, w)];
        if (w >= 1 && q.win !== null) st.holder = { side: o, k: q.win };
        st.banner = 'Free kick'; st.bannerSide = o;
        return st;
      }
      if (v < contact) { st.ball = [last[0] + (s === 0 ? 0.9 : -0.9), last[1] + 0.5]; st.holder = { side: s, k: slotAt(n - 1) }; st.banner = v < ce + (1 - ce) * 0.25 ? 'Under pressure' : 'Tackle!'; st.bannerSide = v < ce + (1 - ce) * 0.25 ? s : o; return st; }
      const w = ease(c01((v - contact) / ((1 - contact) * 0.4)));
      const from: [number, number] = [last[0] + (s === 0 ? 0.9 : -0.9), last[1] + 0.5];
      st.ball = [lerp(from[0], win[0] + (o === 0 ? 0.9 : -0.9), w), lerp(from[1], win[1] + 0.5, w)];
      if (w >= 1 && q.win !== null) st.holder = { side: o, k: q.win };
      st.banner = w < 1 ? 'Tackle!' : 'Ball won back'; st.bannerSide = o;
      return st;
    }
    // 4) the shot: it reaches the keeper, the post or the net exactly at the end of the move (the event's minute)
    const gk = F[o].slots.indexOf('GK');
    const keeper = gk >= 0 ? pos(o, gk) : [goalX, W / 2] as [number, number];
    const from0: [number, number] = sp0 && q.spot ? (q.kind === 'penalty' ? [s === 0 ? L - 11 : 11, W / 2] : toPitch(q.spot)) : last;
    const endY = q.out === 'wide' ? (hash(q.i) % 2 ? W / 2 - 6.5 : W / 2 + 6.5) : W / 2 + ((hash(q.i) % 7) - 3) * 0.5;
    const end: [number, number] = q.out === 'saved' ? keeper : q.out === 'wide' ? [goalX + (s === 0 ? 2 : -2), endY] : [goalX + (s === 0 ? 0.8 : -0.8), endY];
    const w = c01((v - 0.84) / 0.16);
    st.ball = [lerp(from0[0], end[0], ease(w)), lerp(from0[1], end[1], ease(w))];
    st.shotLine = { from: from0, to: end, side: s };
    st.holder = w < 0.1 ? { side: s, k: sp0 && q.setTaker != null ? q.setTaker : slotAt(n - 1) } : null;
    st.banner = q.kind === 'penalty' ? 'PENALTY…' : 'SHOT!';
    if (w >= 1) { st.banner = q.out === 'goal' ? 'GOAL!' : q.out === 'saved' ? 'Saved!' : 'Off target'; if (q.out === 'saved' && gk >= 0) { st.holder = { side: o, k: gk }; st.shotLine = null; } }
    return st;
  };

  let S: St = { ball: [L / 2, W / 2], holder: null, pass: null, lastPass: null, shotLine: null, banner: '', bannerSide: 0, chance: null };
  let pos = posP(50, null);
  if (p) {
    pos = posQ(p, u);
    S = stateAt(p, u);
    // each move starts where the last one ended: the ball runs (or is played) to the first man
    const prev = plans[k - 1];
    // the hand-over takes about 0.3 match minutes (1 s live) however short the move is
    const tr = Math.min(0.35, 0.3 / Math.max(0.01, p.t1 - p.t0));
    if (prev && p.restart !== 'kickoff' && !p.pre && u < tr) {
      const from = stateAt(prev, 1).ball;
      const w = ease(u / tr);
      S = { ...S, ball: [lerp(from[0], S.ball[0], w), lerp(from[1], S.ball[1], w)], holder: w > 0.9 ? S.holder : null, pass: null, lastPass: null };
    }
    // pressing fades in and out with each move, so nobody snaps when the ball changes hands
    const fade = Math.min(c01(u / Math.max(tr, 0.05)), c01((1 - u) / 0.1));
    // before a kick-off everybody waits in his own half; the shape comes in as the ball is played
    const vIn = (u - (p.pre || 0)) / Math.max(0.01, 1 - (p.pre || 0)), sp = setPiece(p);
    // ...and at a set piece the wall and the marking stand where the referee wants them
    const calm = (p.restart === 'kickoff' ? c01((u - (p.pre || 0) - 0.06) / 0.2) : 1) * (sp ? c01((sp - 0.05 - vIn) / 0.15) : 1);
    pos = pressed(pos, p.s, S.ball, S.holder, fade, calm);
  } else {
    S.banner = t < 0.2 ? 'KICK-OFF' : t > 45 && t < 46 ? 'HALF-TIME' : t >= 90 ? 'FULL TIME' : '';
  }
  // the break: the clock waits on the second half's first moment
  if (p && p.restart === 'kickoff' && p.t0 >= 45 - 1e-6 && t - p.t0 < 0.06) S.banner = 'HALF-TIME';
  const { ball, holder, pass, lastPass, shotLine, banner, bannerSide, chance } = S;
  const nextDrawn = new Map<string, [number, number]>();
  // the teams change ends at half-time: the second half is drawn turned round (text stays upright)
  const flip = p ? p.t0 >= 45 - 1e-6 : t >= 45;
  const up = flip ? 'rotate(180)' : undefined;
  // the referee's moments, drawn where they happened for a few seconds: a foul and the free kick, a card
  // over the player, a penalty on the spot, the offside line with the flag
  const planAt = (time: number) => { let lo = 0, hi = plans.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (plans[mid].t1 <= time) lo = mid + 1; else hi = mid - 1; } return plans[lo] && plans[lo].t0 <= time ? plans[lo] : null; };
  const marks = seen.filter((e) => ['freekick', 'yellow', 'red', 'offside', 'penalty'].includes(e.type) && t - timeOf(e) >= 0 && t - timeOf(e) < 1.1).slice(-2).map((e) => {
    const at = timeOf(e), q = planAt(at);
    const qpos = q ? posQ(q, c01((at - q.t0) / (q.t1 - q.t0))) : posP(50, null);
    let spot: [number, number] = q ? stateAt(q, c01((at - q.t0) / (q.t1 - q.t0))).ball : [L / 2, W / 2];
    if ((e.type === 'yellow' || e.type === 'red') && e.pid) { const kk = occAt(e.side, at).indexOf(e.pid); if (kk >= 0) spot = pos(e.side, kk); }
    if (e.type === 'penalty') spot = [e.side === 0 ? L - 11 : 11, W / 2];
    let line: number | null = null;
    if (e.type === 'offside') {
      const dside = (1 - e.side) as 0 | 1, ids2 = occAt(dside, at);
      const xs = F[dside].slots.map((sl, kk) => (sl !== 'GK' && ids2[kk] ? qpos(dside, kk)[0] : null)).filter((x): x is number => x !== null);
      if (xs.length) line = dside === 0 ? Math.min(...xs) : Math.max(...xs);
      if (line !== null) spot = [line, spot[1]];
    }
    return { e, spot, line, age: t - at };
  });
  const chainEnd = chainEndOf(p);
  const ids = [occAt(0, t), occAt(1, t)];
  const ink = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt((hex || '#000000').slice(i, i + 2), 16) || 0); return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#151018' : '#fff'; };
  const holderId = holder ? ids[holder.side][holder.k] : null;
  const holderPos = holder ? pos(holder.side, holder.k) : null;
  const hRole = holderId && holder ? roleIn(holder.side, holderId) : '';
  const hName = holderId ? `${lastName(d.names[holderId]?.name || '')}${hRole ? ` · ${ROLES[hRole]?.short || hRole}` : ''}` : '';
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
        <g transform={flip ? `rotate(180 ${L / 2} ${W / 2})` : undefined}>
        {p && p.out === 'goal' && u > chainEnd + 0.1 && <rect x={p.s === 0 ? L : -1.6} y={W / 2 - 3.66} width={1.6} height={7.32} fill="#FFE48A" opacity={0.85}><animate attributeName="opacity" values="1;0.3;1" dur="0.4s" repeatCount="indefinite" /></rect>}
        {/* passes and the shot */}
        {lastPass && arrow(lastPass, 'lp', 0.45)}
        {pass && arrow(pass, 'p')}
        {shotLine && <line x1={shotLine.from[0]} y1={shotLine.from[1]} x2={shotLine.to[0]} y2={shotLine.to[1]} stroke="#FFE48A" strokeWidth={0.6} strokeDasharray="1.6 0.9" markerEnd="url(#arrS)" />}
        {/* players */}
        {(() => { nextDrawn.clear(); return null; })()}
        {[0, 1].map((side) => F[side].xy.map((_: number[], k: number) => {
          const id = ids[side][k];
          if (!id) return null;
          const isHolder = !!(holder && holder.side === side && holder.k === k && holderPos);
          let [x, y] = isHolder ? holderPos! : pos(side as 0 | 1, k);
          {
            // a sprint is about 18 m/s (60 m a match minute): faster than that and he is drawn catching up;
            // the man on the ball, half-time and a jump in the replay are exempt
            const key = `${side}-${k}`, was = drawn.current.at.get(key), dt = t - drawn.current.t;
            if (was && !isHolder && dt === 0) { x = was[0]; y = was[1]; } // the same moment drawn again
            else if (was && !isHolder && dt > 0 && dt < 0.5 && !(drawn.current.t < 45 && t >= 45)) {
              const cap = 60 * dt + 0.25, dx = x - was[0], dy = y - was[1], dd = Math.hypot(dx, dy);
              if (dd > cap) { x = was[0] + (dx / dd) * cap; y = was[1] + (dy / dd) * cap; }
            }
            nextDrawn.set(key, [x, y]);
          }
          const c = side === 0 ? d.home : d.away;
          const num = d.names[id]?.num ?? shirt(id, d.names[id]?.pos || 'CM');
          const has = holder && holder.side === side && holder.k === k;
          return (
            <g key={`${side}-${k}`} transform={`translate(${x} ${y})`}><g transform={up}>
              {has && <circle r={3} fill="none" stroke="#5FD3F3" strokeWidth={0.5}><animate attributeName="r" values="2.6;3.4;2.6" dur="0.9s" repeatCount="indefinite" /></circle>}
              <circle r={1.85} fill={c.color1} stroke={c.kit2 || (side ? '#151018' : '#E8F1FA')} strokeWidth={0.42} />
              <text y={0.62} textAnchor="middle" fontSize={1.7} fontWeight={900} fill={ink(c.color1)}>{num}</text>
              {fitOf && (mineSide < 0 || side === mineSide) && (() => { const f = fitOf(id); if (f == null) return null; const c = f >= 70 ? '#2EE6A0' : f >= 52 ? '#F2C14E' : '#FF5C6C'; return <g transform="translate(-1.9 2.35)"><rect width={3.8} height={0.55} rx={0.2} fill="rgba(0,0,0,0.55)" /><rect width={3.8 * Math.max(0.05, f / 100)} height={0.55} rx={0.2} fill={c} />{f < 52 && <circle cx={1.9} cy={-2.35} r={2.25} fill="none" stroke="#FF5C6C" strokeWidth={0.25}><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" /></circle>}</g>; })()}
              {id === capOf(side) && <g transform="translate(1.55 -1.55)"><circle r={0.7} fill="#F2C14E" /><text y={0.3} textAnchor="middle" fontSize={0.9} fontWeight={900} fill="#06121F">C</text></g>}
            </g></g>
          );
        }))}
        {/* the referee's moments */}
        {marks.map(({ e, spot, line, age }, i) => (
          <g key={`m${i}`} opacity={age > 0.85 ? (1.1 - age) / 0.25 : 1}>
            {line !== null && <line x1={line} y1={0} x2={line} y2={W} stroke="#FFE86B" strokeWidth={0.35} strokeDasharray="1.2 0.8" />}
            <circle cx={spot[0]} cy={spot[1]} r={3.6} fill="none" stroke={e.type === 'red' ? '#FF4A5E' : '#FFE86B'} strokeWidth={0.35}><animate attributeName="r" values="2.6;4.2;2.6" dur="0.8s" repeatCount="indefinite" /></circle>
            <g transform={`translate(${Math.max(9, Math.min(L - 9, spot[0]))} ${flip ? Math.min(W - 5, spot[1] + 5.2) : Math.max(5, spot[1] - 5.2)})${flip ? ' rotate(180)' : ''}`}>
              <rect x={-8.5} y={-1.9} width={17} height={3.3} rx={0.5} fill="rgba(6, 14, 26,0.9)" stroke={e.type === 'red' ? '#FF4A5E' : '#FFE86B'} strokeWidth={0.2} />
              <text y={0.6} textAnchor="middle" fontSize={1.8} fontWeight={900} fill="#FFE86B">{e.type === 'freekick' ? '📣 Foul · free kick' : e.type === 'yellow' ? '📣 Foul · 🟨 Yellow' : e.type === 'red' ? '📣 Foul · 🟥 Sent off' : e.type === 'penalty' ? '📣 PENALTY' : '🚩 Offside'}</text>
            </g>
          </g>
        ))}
        {/* the name of the man on the ball */}
        {holderPos && hName && (
          <g transform={`translate(${Math.max(8, Math.min(L - 8, holderPos[0]))} ${flip ? Math.min(W - 4, holderPos[1] + 4.2) : Math.max(4, holderPos[1] - 4.2)})${flip ? ' rotate(180)' : ''}`}>
            <rect x={-((hName.length + String(hNum).length + 1) * 0.95 + 1.6) / 2} y={-1.8} width={(hName.length + String(hNum).length + 1) * 0.95 + 1.6} height={3.1} rx={0.4} fill="rgba(6, 14, 26,0.88)" />
            <text y={0.55} textAnchor="middle" fontSize={1.8} fontWeight={800} fill="#E8F1FA">{hNum ? `${hNum} ` : ''}{hName}</text>
          </g>
        )}
        <circle cx={ball[0]} cy={ball[1]} r={0.9} fill="#fff" stroke="rgba(0,0,0,0.4)" strokeWidth={0.18} />
        {(() => { if (t !== drawn.current.t) drawn.current = { t, at: nextDrawn }; return null; })()}
        </g>
      </svg>
      {chance && (
        <div className="p2d-chance">
          <span className="p2d-chance-ico">⚽</span>
          <span className="col" style={{ gap: 0 }}>
            <b style={{ color: 'var(--mint)' }}>{chance.label}</b>
            <span>{team(chance.side).name}</span>
            <span className="muted">xG {chance.xg.toFixed(2)}</span>
          </span>
        </div>
      )}
      {banner && <div className={`p2d-banner ${banner === 'GOAL!' || banner === 'PENALTY!' ? 'big' : ''}`} style={{ borderColor: team(bannerSide).color1 }}><b style={{ background: team(bannerSide).color1, color: ink(team(bannerSide).color1) }}>{team(bannerSide).short}</b><span>{banner}</span></div>}
    </div>
  );
}
