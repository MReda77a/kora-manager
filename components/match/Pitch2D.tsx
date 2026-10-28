'use client';
// A top-down 2D pitch for the live match. Every move the engine logged is played out with the real
// line-ups: the ball is passed from player to player up the pitch (dashed arrows), the man on the
// ball wears a ring and his name, both teams slide as a block with the play, a lost ball goes to the
// opponent nearest to it, a shot flies at goal from where the engine took it and the real scorer
// scores. Each move starts exactly where the previous one ended, so nothing jumps.
import { useMemo, useRef } from 'react';
import { FORMATIONS, PRESETS } from '../../lib/game.ts';
import { shirt } from '../../lib/client.ts';
import { lastName } from '../ui.tsx';

export type Ev = { m: number; type: string; side: 0 | 1; text: string; pid?: string; pid2?: string };
export type Shot = { m: number; side: 0 | 1; x: number; y: number; xg: number; goal: boolean; kind: string; pid?: string; on?: boolean };
type Flow = [number, 0 | 1, number, number];

// match minute -> time on the clock of the watched match (stoppage time is squeezed in)
export const tm = (m: number) => (m <= 90 ? m : 90 + (m - 90) * 0.08);
// when an event shows: on the pitch's own clock. A penalty or a dangerous free kick is given at the foul,
// a little before the kick that ends the move on the event's minute
export const evAt = (e: Ev) => (e.type === 'ft' || e.type === 'pens' ? 90.5 : e.type === 'ht' ? 45 : e.type === 'penalty' ? Math.max(0, tm(e.m) - 1.3) : e.type === 'freekick' ? Math.max(0, tm(e.m) - 0.75) : tm(e.m));

const L = 105, W = 68; // pitch size in metres: the SVG works in these units
const hash = (n: number) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const c01 = (u: number) => Math.max(0, Math.min(1, u));
// the ball drifts across the pitch with the play: one smooth curve for the whole match
const wave = (t: number) => 50 + Math.sin(t * 1.1) * 20 + Math.cos(t * 0.53) * 8;
// how far up the pitch (% from the attacking team's goal) a move gets
const DEPTH = [26, 50, 72, 86];

type Outcome = 'lost' | 'kept' | 'goal' | 'saved' | 'wide';
type Plan = {
  t0: number; t1: number; s: 0 | 1; r: number; sh: number; i: number;
  startX: number; targetX: number; // absolute % along the pitch (0 = home goal, 100 = away goal)
  chain: number[]; // slots of the attacking side, in passing order
  out: Outcome; win: number | null; // the defender who wins a lost ball
  restart: 'kickoff' | 'keeper' | 'corner' | 'clear' | null;
  label?: string; // what the team is doing, from its tactic (patient build-up, direct ball, counter)
  parry?: boolean;
  pre?: number; // the first part of the move that finishes the last one: celebration, keeper's ball, ball out for the corner
  kind: string; // the shot's kind ('' when there is no shot) // a save pushed out for the corner that follows
  spot?: [number, number]; // where the shot is taken from (% of the pitch, absolute)
};

type Occ = { at: number; side: 0 | 1; out: string | null; inn: string | null }[];

export function usePlan(rep: any, events: Ev[], now?: number) {
  // during a live match the report is worked out again after every change; the moves already under way
  // stay as they were and the new match carries on from the end of the current move, so nothing teleports
  const last = useRef<{ rep: any; plan: ReturnType<typeof buildPlan> } | null>(null);
  return useMemo(() => {
    const fresh = buildPlan(rep, events);
    let out = fresh;
    const old = last.current;
    if (old && old.rep !== rep && now != null && now > 0.5) {
      const cur = old.plan.plans.find((q) => q.t0 <= now && q.t1 > now);
      const cut = cur ? cur.t1 : now;
      const keep = old.plan.plans.filter((q) => q.t1 <= cut + 1e-6);
      const next = fresh.plans.filter((q) => q.t1 > cut + 1e-6).map((q) => (q.t0 < cut ? { ...q, t0: cut } : q));
      out = { ...fresh, plans: [...keep, ...next].map((q, i) => (q.i === i ? q : { ...q, i })) };
    }
    last.current = { rep, plan: out };
    return out;
  }, [rep, events]);
}

export function buildPlan(rep: any, events: Ev[]) {
  {
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
    // possession that makes sense to the eye: a lone quiet minute of the other team between two minutes
    // of ours is our ball all along (no ping-pong), quiet minutes of one team merge into one longer spell
    // (up to three minutes), and the quiet minute before a shot becomes its build-up
    for (let i = 1; i < raw.length - 1; i++) {
      const a = raw[i - 1], b = raw[i], c = raw[i + 1];
      if (b.sh < 0 && b.r <= 1 && a.s === c.s && b.s !== a.s && !(b.t0 < 45 && b.t1 > 45) && Math.abs(b.t0 - 45) > 0.01) b.s = a.s;
    }
    const spells: typeof raw = [];
    for (const m of raw) {
      const last = spells[spells.length - 1];
      const joinable = last && last.s === m.s && Math.abs(last.t1 - m.t0) < 1e-6 && !(last.t1 <= 45.01 && m.t0 >= 45);
      if (joinable && last.sh < 0 && m.sh < 0 && m.t1 - last.t0 <= 3) { last.t1 = m.t1; last.r = Math.max(last.r, m.r); continue; }
      if (joinable && last.sh < 0 && m.sh >= 0 && last.t1 - last.t0 <= 1.01) { last.t1 = m.t1; last.sh = m.sh; last.r = Math.max(last.r, m.r); continue; }
      spells.push({ ...m });
    }
    raw.length = 0; raw.push(...spells);
    // a chance needs a build-up you can see: a one-minute attack that ends in a shot borrows time from
    // the other team's spell before it (the shot itself stays on its minute)
    for (let i = 1; i < raw.length; i++) {
      const a = raw[i - 1], b = raw[i];
      if (b.sh < 0 || a.s === b.s || b.t1 - b.t0 > 1.01 || (a.t1 <= 45.01 && b.t0 >= 45)) continue;
      const give = Math.min(0.8, a.t1 - a.t0 - 0.6);
      if (give > 0.05) { a.t1 -= give; b.t0 -= give; }
    }
    // the side's set-up at time t: its tactic at kick-off, then every change (live or by the assistant)
    type Style = { mentality: number; press: number; line: number; build: number; width: number; tempo: number; preset?: string };
    const styleAt = (side: 0 | 1, t: number): Style => {
      let cur: Style | null = null;
      for (const x of rep.styles || []) if (x.side === side && tm(x.m) <= t + 1e-6) cur = x;
      if (cur) return cur;
      const pr = PRESETS[rep.lineups?.[side]?.preset];
      return pr ? { ...pr, preset: rep.lineups[side].preset } : { mentality: 1, press: 1, line: 1, build: 1, width: 1, tempo: 1 };
    };
    // stoppage time is squeezed into the last moments of the clock: its quiet moves fold into the one before
    for (let i = raw.length - 1; i > 0; i--) if (raw[i].t0 >= 90 - 1e-6 && raw[i].sh < 0) { raw[i - 1].t1 = raw[i].t1; raw.splice(i, 1); }
    // every move gets the time it needs to be followed: an attack that ends in a shot, a penalty, the keeper's
    // ball or the celebration that comes before the next move. A busy spell (chances at both ends) pushes the
    // clock of the pitch a little behind the match minute; the quiet moves after it catch up. Each half keeps
    // its own time, so the half-time whistle and the final whistle stay where they are.
    const needOf = (i: number) => {
      const m = raw[i], pv = raw[i - 1];
      const kind = m.sh >= 0 ? shots[m.sh]?.kind : '';
      let n = m.sh < 0 ? 0.8 : kind === 'penalty' ? 1.9 : kind === 'free kick' ? 1.5 : 1.2;
      if (pv && pv.sh >= 0) n += shots[pv.sh]?.goal ? 1.0 : pv.s === m.s ? 0.9 : 0.5;
      return n;
    };
    for (const [a, b] of [[0.2, 45], [45, 90.45]] as [number, number][]) {
      const idx = raw.map((_, i) => i).filter((i) => raw[i].t0 >= (a < 1 ? -1 : a - 1e-6) && raw[i].t0 < b - 1e-6);
      if (!idx.length) continue;
      let end = a;
      for (const i of idx) { const m = raw[i]; m.t0 = end; m.t1 = Math.max(m.t1, m.t0 + needOf(i)); end = m.t1; }
      let lim = b;
      for (const i of [...idx].reverse()) { const m = raw[i]; m.t1 = Math.min(m.t1, lim); if (m.t1 - m.t0 < needOf(i)) m.t0 = Math.max(a, m.t1 - needOf(i)); lim = m.t0; }
      end = a;
      for (const i of idx) { const m = raw[i]; m.t0 = Math.max(m.t0, end); if (m.t1 < m.t0 + 0.2) m.t1 = Math.min(b, m.t0 + 0.2); end = m.t1; }
      for (let j = 0; j < idx.length - 1; j++) raw[idx[j]].t1 = raw[idx[j + 1]].t0;
      raw[idx[idx.length - 1]].t1 = Math.max(raw[idx[idx.length - 1]].t1, b); // the half's last move runs to its whistle
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
      // a quiet spell only ends with the ball lost when the other team has the next move; otherwise we keep it
      const out: Outcome = !shot ? (raw[i + 1] && raw[i + 1].s === s && !(p.t1 <= 45.01 && raw[i + 1].t0 >= 45) ? 'kept' : 'lost') : shot.goal ? 'goal' : shot.on ? 'saved' : 'wide';
      const prev = plans[i - 1];
      const ht = prev && p.t0 >= 45 && prev.t1 <= 45.01;
      let restart: Plan['restart'] = null;
      let startX = endX;
      if (!prev || ht || prev.out === 'goal') { restart = 'kickoff'; startX = 50; }
      else if (prev.out === 'saved' || prev.out === 'wide') {
        if (prev.s !== s) restart = 'keeper';
        // the same team goes again: from the corner the save gave away, or from the keeper's clearance
        else if (shot?.kind === 'corner') { restart = 'corner'; startX = s === 0 ? 99 : 1; if (prev.out === 'saved') prev.parry = true; }
        else { restart = 'clear'; startX = s === 0 ? 55 : 45; }
      }
      const depth = (x: number) => (s === 0 ? x : 100 - x);
      const targetX = s === 0 ? DEPTH[Math.min(3, p.r)] : 100 - DEPTH[Math.min(3, p.r)];
      // the passing chain: start with the player who has the ball, then forward, one teammate at a time
      const ids = occAt(s, p.t0);
      const slots = F[s].slots;
      const live = slots.map((_, k) => k).filter((k) => ids[k]);
      const baseDepth = (k: number) => (slots[k] === 'GK' ? 2 : 12 + F[s].xy[k][0] * 0.62);
      let first: number;
      const outfield = live.filter((k) => slots[k] !== 'GK');
      const yOf = (k: number) => F[s].xy[k][1];
      if (restart === 'keeper') first = slots.indexOf('GK');
      else if (restart === 'kickoff') first = live.filter((k) => slots[k] === 'MID').sort((a, b) => Math.abs(yOf(a) - 50) - Math.abs(yOf(b) - 50))[0] ?? live[1];
      else if (restart === 'corner') first = outfield.filter((k) => slots[k] !== 'DEF').sort((a, b) => Math.abs(yOf(b) - 50) - Math.abs(yOf(a) - 50))[0] ?? outfield[0];
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
      // the passing: about one pass every 0.4 match minutes (1.3 s live) for the whole spell, short and
      // sideways while the team keeps the ball, working forward step by step toward where the move gets to
      // the tactic sets the rhythm: short build-up (tiki-taka) passes often, direct play goes long and forward
      const sty = styleAt(s, p.t0);
      const every = 0.4 * ([0.68, 1, 1.6][sty.build] ?? 1) * ([1.15, 1, 0.85][sty.tempo] ?? 1);
      // the time left for passing once the last move is finished off (keeper's ball, celebration, corner)
      const preMin = !prev ? 0 : restart === 'kickoff' && prev.out === 'goal' ? 0.95 : restart === 'clear' ? 0.9 : restart === 'corner' ? 0.6 : restart === 'keeper' ? (prev.out === 'wide' ? 0.5 : 0.4) : 0;
      const effDur = (p.t1 - p.t0) - Math.min(0.6 * (p.t1 - p.t0), preMin);
      const runFrac = shot ? (shot.kind === 'penalty' ? 0.3 : shot.kind === 'free kick' ? 0.45 : 0.84) : out === 'lost' ? 0.72 : 1;
      const N = Math.max(2, Math.min(12, Math.floor((effDur * runFrac) / every) + 1)) - (shot ? 1 : 0);
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
          + (sty.width === 2 ? (50 - Math.abs(yOf(k) - 50)) * 0.12 : sty.width === 0 ? Math.abs(yOf(k) - 50) * 0.12 : 0); // wide or through the middle
        chain.push(pool.sort((a, b) => score(a) - score(b))[0]);
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
      const label = counter ? 'Counter attack' : sty.build === 0 && sty.tempo === 0 ? 'Tiki-taka' : sty.build === 0 ? 'Patient build-up' : sty.build === 2 ? 'Direct ball' : undefined;
      plans.push({ ...p, i, startX, targetX, chain, out, win, restart, label, spot: shot ? [shot.x, shot.y] : undefined, kind: shot?.kind || '' });
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
    // when each shot lands on the pitch (and when its foul was given), so events and animations show then
    const shotAt = new Map<number, { land: number; foul: number }>();
    for (const q of plans) if (q.sh >= 0) {
      const dur = q.t1 - q.t0, pre = q.pre || 0, sp = q.kind === 'penalty' ? 0.3 : q.kind === 'free kick' ? 0.45 : 0;
      shotAt.set(q.sh, { land: q.t1, foul: q.t0 + (pre + (1 - pre) * sp) * dur });
    }
    const linked: Record<string, (x: Shot, e: Ev) => boolean> = {
      goal: (x, e) => x.goal && x.side === e.side, var: (x, e) => x.side === e.side, miss: (x, e) => !x.goal && x.side === e.side,
      penmiss: (x, e) => !x.goal && x.side === e.side && x.kind === 'penalty', save: (x, e) => !x.goal && x.side !== e.side,
      penalty: (x, e) => x.kind === 'penalty' && x.side === e.side, freekick: (x, e) => x.kind === 'free kick' && x.side === e.side,
    };
    /** when an event shows on the pitch's clock */
    const timeOf = (e: Ev) => {
      const f = linked[e.type];
      if (f) {
        const k = shots.findIndex((x, j) => x.m === e.m && f(x, e) && shotAt.has(j));
        if (k >= 0) { const s2 = shotAt.get(k)!; return e.type === 'penalty' || e.type === 'freekick' ? s2.foul : s2.land; }
      }
      return evAt(e);
    };
    return { plans, F, occAt, shots, styleAt, timeOf };
  }
}

export function Pitch2D({ d, t, plan, mineSide, seen = [], fitOf }: { d: any; t: number; plan: ReturnType<typeof usePlan>; mineSide: number; seen?: Ev[]; fitOf?: (id: string) => number | null }) {
  const { plans, F, occAt, shots, styleAt, timeOf } = plan;
  const sty = [styleAt(0, t), styleAt(1, t)];
  // the move now
  let k = -1;
  { let lo = 0, hi = plans.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (plans[mid].t1 <= t) lo = mid + 1; else hi = mid - 1; } k = plans[lo] && plans[lo].t0 <= t ? lo : -1; }
  const p = k >= 0 ? plans[k] : null;
  const u = p ? c01((t - p.t0) / (p.t1 - p.t0)) : 0;
  const wy = wave(t);
  const team = (s: number) => (s === 0 ? d.home : d.away);
  // a move's own time (after the part that finishes the last move) and where its passing ends
  const inner = (q: NonNullable<typeof p>, v: number) => (q.pre ? c01((v - q.pre) / (1 - q.pre)) : v);
  const setPiece = (q: typeof p) => (q && (q.kind === 'penalty' || q.kind === 'free kick') ? (q.kind === 'penalty' ? 0.3 : 0.45) : 0);
  const chainEndOf = (q: typeof p) => (q ? (setPiece(q) || (q.sh >= 0 ? 0.84 : q.out === 'lost' ? 0.72 : q.out === 'kept' ? 1 : 0.8)) : 1);
  const phaseOf = (q: NonNullable<typeof p>, v: number) => lerp(q.startX, q.targetX, ease(c01(inner(q, v) / chainEndOf(q))));

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
      if (att !== side && st.press === 0 && st.mentality === 0) depth = 12 + (depth - 12) * 0.8;
    }
    depth = Math.max(3, Math.min(97, depth + Math.sin(t * 0.9 + k * 1.9 + side) * 1.6 + Math.sin(t * 2.3 + k) * 0.5));
    const spread = att === side ? 0.82 + st.width * 0.12 : 0.86 - (st.press === 0 ? 0.08 : 0);
    const fy2 = 50 + (fy - 50) * spread;
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
  const posQ = (q: NonNullable<typeof p>, vRaw: number, blend = true): ((side: 0 | 1, k: number) => [number, number]) => {
    const v = inner(q, vRaw);
    const base = posP(phaseOf(q, vRaw), q.s);
    const ce = chainEndOf(q), n = q.chain.length, sp0 = setPiece(q);
    const fin = q.sh >= 0 ? q.chain[n - 1] : -1, taker = q.restart === 'corner' ? q.chain[0] : -1;
    const flag: [number, number] = [q.s === 0 ? L - 0.6 : 0.6, (q.spot ? q.spot[1] : 50) > 50 ? W - 0.6 : 0.6];
    const firstPass = ce / (n - 0.4); // the taker's slot in the chain
    // off the ball: the next man to get it moves into space, the strikers make runs in a real attack,
    // the full-backs overlap in a team that plays wide (all smooth in v, so nobody jumps)
    const xNow = c01(v / ce) * (n - 0.4), dir = q.s === 0 ? 1 : -1, stA = sty[q.s];
    const bump = (u: number) => Math.sin(Math.PI * c01(u));
    const goalX = q.s === 0 ? L : 0;
    const spot: [number, number] | null = q.spot ? (q.kind === 'penalty' ? [q.s === 0 ? L - 11 : 11, W / 2] : toPitch(q.spot)) : null;
    // set piece: everyone else clears the box for a penalty; for a free kick three men form the wall
    const setW = sp0 ? ease(c01((v - sp0) / 0.12)) : 0;
    const wallK = q.kind === 'free kick' && spot ? F[1 - q.s].slots.map((sl, k) => k).filter((k) => F[1 - q.s].slots[k] !== 'GK')
      .sort((a, b) => Math.hypot(...(base((1 - q.s) as 0 | 1, a).map((x, j) => x - spot[j]) as [number, number])) - Math.hypot(...(base((1 - q.s) as 0 | 1, b).map((x, j) => x - spot[j]) as [number, number]))).slice(0, 3) : [];
    const own = (side: 0 | 1, k: number): [number, number] => {
      const b = base(side, k);
      // the keeper on his line for a penalty
      if (setW && side !== q.s && F[side].slots[k] === 'GK' && q.kind === 'penalty') return [lerp(b[0], goalX + (q.s === 0 ? -0.8 : 0.8), setW), lerp(b[1], W / 2, setW)];
      if (setW && side !== q.s && wallK.includes(k) && spot) {
        const gx = goalX - spot[0], gy = W / 2 - spot[1], gl = Math.hypot(gx, gy) || 1, j = wallK.indexOf(k) - 1;
        const wx = spot[0] + (gx / gl) * 9.15 - (gy / gl) * j * 1.1, wy = spot[1] + (gy / gl) * 9.15 + (gx / gl) * j * 1.1;
        return [lerp(b[0], wx, setW), lerp(b[1], wy, setW)];
      }
      if (side !== q.s) {
        if (setW && q.kind === 'penalty' && F[side].slots[k] !== 'GK') { const edge = q.s === 0 ? L - 17.5 : 17.5; return [lerp(b[0], q.s === 0 ? Math.min(b[0], edge) : Math.max(b[0], edge), setW), b[1]]; }
        return b;
      }
      let fwd = 0;
      for (let c = 1; c < n; c++) if (q.chain[c] === k) fwd = Math.max(fwd, 3.2 * c01(1 - Math.abs(xNow - (c - 0.35)) / 1.1));
      const slot = F[side].slots[k], fy = F[side].xy[k][1];
      if (slot === 'FWD' && q.r >= 2) fwd += 4.5 * bump(v / ce);
      if (slot === 'DEF' && Math.abs(fy - 50) > 28 && stA.width >= 1 && q.r >= 1) fwd += (stA.width === 2 ? 15 : 9) * bump((v - 0.12) / 0.7);
      const bb: [number, number] = [b[0] + dir * fwd, b[1]];
      if (k === fin && spot && fin !== taker) {
        if (sp0) {
          // the taker: to the ball after the foul, a few steps back, then the run-up
          const behind: [number, number] = [spot[0] - dir * 2.4, spot[1] + 1];
          const runUp = ease(c01((v - 0.8) / 0.04));
          const at: [number, number] = [lerp(behind[0], spot[0] - dir * 0.8, runUp), lerp(behind[1], spot[1], runUp)];
          return [lerp(bb[0], at[0], setW), lerp(bb[1], at[1], setW)];
        }
        const w = ease(c01((v - ce * 0.45) / (ce * 0.5)));
        return [lerp(bb[0], spot[0], w), lerp(bb[1], spot[1], w)];
      }
      if (setW && q.kind === 'penalty' && F[side].slots[k] !== 'GK') { const edge = q.s === 0 ? L - 17.5 : 17.5; return [lerp(bb[0], q.s === 0 ? Math.min(bb[0], edge) : Math.max(bb[0], edge), setW), bb[1]]; }
      if (k === taker) { const w = 1 - ease(c01((v - firstPass) / 0.2)); return [lerp(bb[0], flag[0], w), lerp(bb[1], flag[1], w)]; }
      // the kick-off: the first man stands over the ball on the centre spot
      if (q.restart === 'kickoff' && k === q.chain[0]) { const w = 1 - ease(c01((v - firstPass * 0.4) / 0.25)); return [lerp(bb[0], L / 2 - dir * 0.9, w), lerp(bb[1], W / 2 - 0.5, w)]; }
      return bb;
    };
    // the players walk on from where the last move left them (about 1 s live), nobody snaps into place
    const prevQ = blend && q.i > 0 ? plans[q.i - 1] : null;
    if (!prevQ) return own;
    const dur = Math.max(0.01, q.t1 - q.t0);
    const bw = ease(c01(vRaw / Math.min(0.7, Math.max((q.pre || 0) * dur, 0.4) / dur)));
    if (bw >= 1) return own;
    const was = posQ(prevQ, 1, false);
    return (side, k) => { const a = was(side, k), b = own(side, k); return [lerp(a[0], b[0], bw), lerp(a[1], b[1], bw)]; };
  };
  // the defending side closes the ball down: the nearer a man is to the ball, the harder he presses
  // (a pressing tactic pushes more of them onto it); it only follows the ball, so it is smooth too
  const pressed = (pos: (side: 0 | 1, k: number) => [number, number], att: 0 | 1, ball: [number, number], skip: { side: 0 | 1; k: number } | null, fade: number) => (side: 0 | 1, k: number): [number, number] => {
    const b = pos(side, k);
    if (side === att || F[side].slots[k] === 'GK' || (skip && skip.side === side && skip.k === k)) return b;
    const dx = ball[0] - b[0], dy = ball[1] - b[1], dd = Math.hypot(dx, dy);
    const reach = 10 + sty[side].press * 4;
    const w = c01(1 - dd / reach) * (0.45 + sty[side].press * 0.12) * fade;
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
    const v = inner(q, vRaw);
    const sp0 = setPiece(q);
    if (q.sh >= 0 && v > ce * 0.55) st.chance = { side: s, xg: shots[q.sh].xg, label: q.kind === 'penalty' ? 'Penalty' : q.kind === 'free kick' ? 'Free kick' : shots[q.sh].xg >= 0.25 ? 'Big chance' : 'Goal chance' };
    // 2) the passing
    if (v < ce) {
      const x = (v / ce) * (n - 0.4); // n holds and n-1 passes; a pass takes 60% of its slot
      const j = Math.floor(x), seg = x - j;
      const a = pos(s, slotAt(j)), b = pos(s, slotAt(j + 1));
      const dir = s === 0 ? 1 : -1;
      if (seg < 0.4 || j >= n - 1) { st.ball = [a[0] + dir * 0.9, a[1] + 0.5]; st.holder = { side: s, k: slotAt(j) }; }
      else { const w = ease((seg - 0.4) / 0.6); st.ball = [lerp(a[0], b[0], w), lerp(a[1], b[1], w)]; st.pass = { from: a, to: b, side: s }; }
      if (j >= 1 && !st.pass) st.lastPass = { from: pos(s, slotAt(j - 1)), to: a, side: s };
      st.banner = q.restart === 'kickoff' && v < 0.12 ? 'KICK-OFF' : q.restart === 'keeper' && v < 0.15 ? 'Goal kick' : q.restart === 'clear' && v < 0.18 ? 'Second ball'
        : q.restart === 'corner' && v < 0.25 ? 'Corner' : q.label && v < 0.45 ? q.label : q.r === 0 || v < 0.3 ? 'Building up' : q.r === 1 ? 'Attack' : v > 0.5 ? 'Dangerous attack' : 'Attack';
      if (q.kind === 'counter' && v < 0.5) st.banner = 'Counter attack';
      if (q.kind === 'corner' && v > ce * 0.55) st.banner = 'Corner';
      return st;
    }
    const last = pos(s, slotAt(n - 1));
    const name = (k: number) => lastName(d.names[occAt(s, q.t0)[k] || '']?.name || '');
    // 3) a set piece: the foul, the ball on the spot, the taker steps up
    if (sp0 && v < 0.84 && q.spot) {
      const spot: [number, number] = q.kind === 'penalty' ? [s === 0 ? L - 11 : 11, W / 2] : toPitch(q.spot);
      const w = ease(c01((v - sp0) / 0.1));
      const end = pos(s, slotAt(n - 1));
      st.ball = [lerp(end[0], spot[0], w), lerp(end[1], spot[1], w)];
      st.holder = w >= 1 ? { side: s, k: slotAt(n - 1) } : null;
      st.banner = q.kind === 'penalty' ? (v < sp0 + 0.22 ? 'PENALTY!' : `${name(slotAt(n - 1))} steps up…`) : v < sp0 + 0.15 ? 'Foul · free kick' : `${name(slotAt(n - 1))} over the ball…`;
      return st;
    }
    if (q.out === 'kept') { st.ball = [last[0] + (s === 0 ? 0.9 : -0.9), last[1] + 0.5]; st.holder = { side: s, k: slotAt(n - 1) }; st.banner = 'Keeping the ball'; return st; }
    if (q.out === 'lost') {
      const w = c01((v - ce) / Math.min(0.26, 0.3 / Math.max(0.01, (q.t1 - q.t0) * (1 - (q.pre || 0)))));
      const win = q.win !== null ? pos(o, q.win) : last;
      st.ball = [lerp(last[0], win[0], ease(w)), lerp(last[1], win[1], ease(w))];
      if (w >= 1) st.holder = { side: o, k: q.win ?? 0 }; else st.pass = { from: last, to: win, side: o };
      st.banner = 'Ball won back'; st.bannerSide = o;
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
    st.holder = w < 0.1 ? { side: s, k: slotAt(n - 1) } : null;
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
    pos = pressed(pos, p.s, S.ball, S.holder, fade);
  } else {
    S.banner = t < 0.2 ? 'KICK-OFF' : t > 45 && t < 46 ? 'HALF-TIME' : t >= 90 ? 'FULL TIME' : '';
  }
  const { ball, holder, pass, lastPass, shotLine, banner, bannerSide, chance } = S;
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
              {has && <circle r={3} fill="none" stroke="#5FD3F3" strokeWidth={0.5}><animate attributeName="r" values="2.6;3.4;2.6" dur="0.9s" repeatCount="indefinite" /></circle>}
              <circle r={1.85} fill={c.color1} stroke={c.kit2 || (side ? '#151018' : '#E8F1FA')} strokeWidth={0.42} />
              <text y={0.62} textAnchor="middle" fontSize={1.7} fontWeight={900} fill={ink(c.color1)}>{num}</text>
              {fitOf && (mineSide < 0 || side === mineSide) && (() => { const f = fitOf(id); if (f == null) return null; const c = f >= 70 ? '#2EE6A0' : f >= 52 ? '#F2C14E' : '#FF5C6C'; return <g transform="translate(-1.9 2.35)"><rect width={3.8} height={0.55} rx={0.2} fill="rgba(0,0,0,0.55)" /><rect width={3.8 * Math.max(0.05, f / 100)} height={0.55} rx={0.2} fill={c} />{f < 52 && <circle cx={1.9} cy={-2.35} r={2.25} fill="none" stroke="#FF5C6C" strokeWidth={0.25}><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" /></circle>}</g>; })()}
              {id === capOf(side) && <g transform="translate(1.55 -1.55)"><circle r={0.7} fill="#F2C14E" /><text y={0.3} textAnchor="middle" fontSize={0.9} fontWeight={900} fill="#06121F">C</text></g>}
            </g>
          );
        }))}
        {/* the referee's moments */}
        {marks.map(({ e, spot, line, age }, i) => (
          <g key={`m${i}`} opacity={age > 0.85 ? (1.1 - age) / 0.25 : 1}>
            {line !== null && <line x1={line} y1={0} x2={line} y2={W} stroke="#FFE86B" strokeWidth={0.35} strokeDasharray="1.2 0.8" />}
            <circle cx={spot[0]} cy={spot[1]} r={3.6} fill="none" stroke={e.type === 'red' ? '#FF4A5E' : '#FFE86B'} strokeWidth={0.35}><animate attributeName="r" values="2.6;4.2;2.6" dur="0.8s" repeatCount="indefinite" /></circle>
            <g transform={`translate(${Math.max(9, Math.min(L - 9, spot[0]))} ${Math.max(5, spot[1] - 5.2)})`}>
              <rect x={-8.5} y={-1.9} width={17} height={3.3} rx={0.5} fill="rgba(6, 14, 26,0.9)" stroke={e.type === 'red' ? '#FF4A5E' : '#FFE86B'} strokeWidth={0.2} />
              <text y={0.6} textAnchor="middle" fontSize={1.8} fontWeight={900} fill="#FFE86B">{e.type === 'freekick' ? '📣 Foul · free kick' : e.type === 'yellow' ? '🟨 Yellow card' : e.type === 'red' ? '🟥 Sent off' : e.type === 'penalty' ? '📣 PENALTY' : '🚩 Offside'}</text>
            </g>
          </g>
        ))}
        {/* the name of the man on the ball */}
        {holderPos && hName && (
          <g transform={`translate(${Math.max(8, Math.min(L - 8, holderPos[0]))} ${Math.max(4, holderPos[1] - 4.2)})`}>
            <rect x={-((hName.length + String(hNum).length + 1) * 0.95 + 1.6) / 2} y={-1.8} width={(hName.length + String(hNum).length + 1) * 0.95 + 1.6} height={3.1} rx={0.4} fill="rgba(6, 14, 26,0.88)" />
            <text y={0.55} textAnchor="middle" fontSize={1.8} fontWeight={800} fill="#E8F1FA">{hNum ? `${hNum} ` : ''}{hName}</text>
          </g>
        )}
        <circle cx={ball[0]} cy={ball[1]} r={0.9} fill="#fff" stroke="rgba(0,0,0,0.4)" strokeWidth={0.18} />
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
