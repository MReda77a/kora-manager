// Kora Manager match engine.
// A match is a chain of possession phases: build-up -> progression -> chance -> shot.
// Every step is a duel between one side's tactic and players and the other side's.
// Ported from the Python prototype that was balanced over 50,000+ simulated matches.
import { rng as makeRng, type Rng } from './rng.ts';
import { FORMATIONS, LINE, PRESETS, ROLES, stripDesc, type Tactic } from './game.ts';

export type EPlayer = {
  id: string; name: string; pos: string; ovr: number; fitness: number;
  a: Record<string, number>;
  mod?: number; // form: team of the week, player of the month, upset nominees
};
export type ESide = {
  clubId: number; name: string; xi: EPlayer[]; bench: EPlayer[]; tactic: Tactic;
  assistant: Record<string, boolean>; pens: string[]; homeBoost: number; boost?: number;
  injuryRisk?: number; // 1 = normal, lower with a good doctor
  roles?: Record<string, string>; // player id -> role
  setpieces?: { corner?: string; fk?: string; routine?: string };
  familiarity?: number; // 0..100 with the formation
};
// A manager's decision during a live match. It takes effect from minute m on.
export type Change =
  | { m: number; side: 0 | 1; kind: 'tactic'; tactic: Partial<Tactic> & { preset?: string; plan?: string } }
  | { m: number; side: 0 | 1; kind: 'sub'; out: string; in: string };
export type SimOpts = { changes?: Change[]; knockout?: boolean; derby?: boolean; weather?: string; strict?: number };
export type Shot = { m: number; side: 0 | 1; x: number; y: number; xg: number; goal: boolean; kind: string; pid?: string };
export type Shootout = { kicks: { side: 0 | 1; pid: string; scored: boolean }[]; score: [number, number] };
export type MatchEvent = { m: number; type: string; side: 0 | 1; text: string; pid?: string; pid2?: string };
export type PlayerLine = { id: string; name: string; side: 0 | 1; pos: string; r: number; g: number; a: number; mins: number; fitEnd: number; yc: number; rc: boolean; inj: boolean };
export type Report = {
  score: [number, number];
  events: MatchEvent[];
  stats: { poss: [number, number]; shots: [number, number]; onTarget: [number, number]; xg: [number, number]; corners: [number, number]; yellows: [number, number]; reds: [number, number] };
  players: PlayerLine[];
  motm: string | null;
  tactics: [string, string];
  lineups: { formation: string; preset: string; xi: string[]; bench: string[] }[];
  shootout?: Shootout;
  winner?: 0 | 1;
  derby?: boolean;
  shots?: Shot[];
  weather?: string;
};

const sig = (x: number) => 1 / (1 + Math.exp(-x));

type OnPitch = { p: EPlayer; slot: 'GK' | 'DEF' | 'MID' | 'FWD'; tired: number; yc: number; on: number; line: PlayerLine };

class Side {
  s: ESide;
  pitch: OnPitch[] = [];
  bench: EPlayer[];
  subsLeft = 5;
  form: number;
  tactic: Tactic;
  agg: Record<string, number> = {};
  constructor(s: ESide, r: Rng, idx: 0 | 1, lines: PlayerLine[], derbyForm = false) {
    this.s = s;
    this.tactic = { ...s.tactic };
    this.bench = [...s.bench];
    this.form = r.gauss(0, derbyForm ? 3.4 : 2.2);
    const slots = (FORMATIONS[s.tactic.formation] || FORMATIONS['4-3-3']).slots;
    s.xi.forEach((p, i) => {
      const line = mkLine(p, idx, 0);
      lines.push(line);
      this.pitch.push({ p, slot: slots[i] || 'MID', tired: (100 - p.fitness) / 45, yc: 0, on: 0, line });
    });
  }
  // attribute of a player in his slot, after tiredness
  manual = false;
  weather = 'clear';
  flags: Record<string, number> = { through: 0, crossB: 0, longshot: 0, holdup: 0, sweeper: 0, anchor: 0 };
  val(o: OnPitch, attr: string) {
    let v = (o.p.a[attr] ?? o.p.ovr) + (o.p.mod || 0);
    const natural = LINE[o.p.pos] || 'MID';
    if (natural !== o.slot) v -= o.slot === 'GK' || natural === 'GK' ? 30 : 8;
    return v;
  }
  refresh(homeAdv: number) {
    const by = (slot: string) => this.pitch.filter((o) => o.slot === slot);
    const avg = (arr: OnPitch[], f: (o: OnPitch) => number, fb: number) => (arr.length ? arr.reduce((t, o) => t + f(o), 0) / arr.length : fb);
    const D = by('DEF'), M = by('MID'), F = by('FWD'), G = by('GK');
    const all = this.pitch;
    const base = avg(all, (o) => o.p.ovr, 70);
    const passers = [...M, ...M, ...D, ...F];
    this.agg = {
      passing: avg(passers, (o) => this.val(o, 'Passing') * 0.7 + this.val(o, 'Vision') * 0.3, base),
      finishing: avg(F.length ? F : M, (o) => this.val(o, 'Finishing') * 0.8 + this.val(o, 'Composure') * 0.2, base - 8),
      pace_att: avg(F.length ? F : M, (o) => this.val(o, 'Pace'), base),
      aerial_att: avg(F.length ? F : M, (o) => (this.val(o, 'Heading') + this.val(o, 'Jumping') + this.val(o, 'Strength')) / 3, base),
      tackling: avg([...D, ...D, ...M], (o) => this.val(o, 'Tackling') * 0.6 + this.val(o, 'Marking') * 0.4, base),
      pace_def: avg(D.length ? D : M, (o) => this.val(o, 'Pace'), base),
      aerial_def: avg(D.length ? D : M, (o) => (this.val(o, 'Heading') + this.val(o, 'Jumping') + this.val(o, 'Strength')) / 3, base),
      keeper: G.length ? (this.val(G[0], 'Reflexes') + this.val(G[0], 'Handling') + this.val(G[0], 'OneOnOne')) / 3 : 40,
    };
    // roles: each player in a role that fits his slot adds a small, attribute-scaled edge
    this.flags = { through: 0, crossB: 0, longshot: 0, holdup: 0, sweeper: 0, anchor: 0 };
    for (const o of all) {
      const role = this.s.roles?.[o.p.id];
      const def = role ? ROLES[role] : null;
      if (!def || def.line !== o.slot) continue;
      const eff = Math.max(0.6, Math.min(1.2, def.keys.reduce((t, k) => t + (o.p.a[k] ?? 60), 0) / def.keys.length / 80)) * 0.75;
      const A = this.agg, F = this.flags;
      if (role === 'Shot stopper') A.keeper += 2.5 * eff;
      else if (role === 'Sweeper keeper') { A.keeper += 0.5; F.sweeper += eff; }
      else if (role === 'Stopper') { A.tackling += 1.2 * eff; A.aerial_def += 1.2 * eff; A.pace_def -= 0.6; }
      else if (role === 'Ball-playing') A.passing += 1.2 * eff;
      else if (role === 'Wing-back') { F.crossB += 0.006 * eff; A.pace_def -= 0.5; }
      else if (role === 'Anchor') { A.tackling += 1.5 * eff; F.anchor += eff; }
      else if (role === 'Box-to-box') { A.tackling += 0.6 * eff; A.passing += 0.6 * eff; }
      else if (role === 'Playmaker') { A.passing += 1.8 * eff; F.through += 0.006 * eff; }
      else if (role === 'Poacher') A.finishing += 2 * eff;
      else if (role === 'Target man') { A.aerial_att += 3 * eff; F.holdup += 0.1 * eff; }
      else if (role === 'False 9') { A.passing += 1 * eff; A.finishing -= 0.5; F.through += 0.004 * eff; }
      else if (role === 'Inside forward') { A.finishing += 0.8 * eff; F.longshot += 0.006 * eff; }
    }
    if (this.weather === 'rain') this.agg.passing -= 1.5;
    if (this.weather === 'snow') { this.agg.pace_att -= 4; this.agg.pace_def -= 4; }
    const fam = ((this.s.familiarity ?? 60) - 60) / 40;
    for (const k of Object.keys(this.agg)) this.agg[k] += fam;
    const tired = avg(all, (o) => o.tired, 0);
    const short = (11 - all.length) * 4;
    const pen = Math.min(9, Math.max(0, tired - 0.55) * 10) + short - this.form - homeAdv - (this.s.boost || 0);
    for (const k of Object.keys(this.agg)) this.agg[k] -= pen;
  }
}

function mkLine(p: EPlayer, side: 0 | 1, onAt: number): PlayerLine {
  return { id: p.id, name: p.name, side, pos: p.pos, r: 6.0, g: 0, a: 0, mins: -onAt, fitEnd: p.fitness, yc: 0, rc: false, inj: false };
}

const last = (n: string) => n.split(' ').slice(-1)[0];

export function simulate(home: ESide, away: ESide, seed: number, opts: SimOpts = {}): Report {
  const r = makeRng(seed);
  const lines: PlayerLine[] = [];
  const derby = !!opts.derby;
  const S: [Side, Side] = [new Side(home, r, 0, lines, derby), new Side(away, r, 1, lines, derby)];
  const changes = [...(opts.changes || [])].sort((a, b) => a.m - b.m);
  const weather = opts.weather || 'clear';
  S[0].weather = weather; S[1].weather = weather;
  const cardMul = [0.75, 1, 1.35][opts.strict ?? 1];
  const penMul = [0.8, 1, 1.25][opts.strict ?? 1];
  const shotsList: Shot[] = [];
  const spot = (a: 0 | 1, kind: string) => {
    let x: number, y: number;
    if (kind === 'long shot' || kind === 'free kick') { x = 72 + r.next() * 9; y = 22 + r.next() * 56; }
    else if (kind === 'cross' || kind === 'corner') { x = 90 + r.next() * 6; y = 40 + r.next() * 20; }
    else if (kind === 'penalty') { x = 88.5; y = 50; }
    else { x = 82 + r.next() * 10; y = 32 + r.next() * 36; }
    return a === 0 ? [x, y] : [100 - x, 100 - y];
  };
  let nextChange = 0;
  const goals: [number, number] = [0, 0], shots: [number, number] = [0, 0], onT: [number, number] = [0, 0];
  const xg: [number, number] = [0, 0], corners: [number, number] = [0, 0], yel: [number, number] = [0, 0], red: [number, number] = [0, 0];
  const possN: [number, number] = [0, 0];
  const ev: MatchEvent[] = [];
  const homeAdv = 1.5 + (home.homeBoost || 0);
  let minute = 0;
  const T = (i: number) => S[i].tactic;
  const A = (i: number, k: string) => S[i].agg[k];
  const log = (type: string, side: 0 | 1, text: string, pid?: string, pid2?: string) => ev.push({ m: minute, type, side, text, pid, pid2 });

  const pickScorer = (side: 0 | 1, kind: string) => {
    const pool = S[side].pitch.filter((o) => o.slot !== 'GK');
    return r.weighted(pool, (o) => {
      const w = o.slot === 'FWD' ? 5 : o.slot === 'MID' ? 2 : 0.5;
      const skill = kind === 'cross' ? S[side].val(o, 'Heading') : kind === 'long shot' ? S[side].val(o, 'LongShots') : S[side].val(o, 'Finishing');
      return w * Math.pow(Math.max(30, skill) / 70, 4);
    });
  };
  const pickAssist = (side: 0 | 1, scorer: OnPitch, kind: string) => {
    const pool = S[side].pitch.filter((o) => o !== scorer && o.slot !== 'GK');
    return r.weighted(pool, (o) => (o.slot === 'MID' ? 3 : o.slot === 'FWD' ? 2 : 1) * Math.pow(Math.max(30, S[side].val(o, kind === 'cross' ? 'Crossing' : 'Passing')) / 70, 3));
  };

  const shot = (a: 0 | 1, baseXg: number, kind: string) => {
    const b = (1 - a) as 0 | 1;
    let q = 0.73 * baseXg * (1 + (A(a, "finishing") - A(b, "keeper")) * 0.015);
    q = Math.min(0.75, Math.max(0.01, q));
    shots[a]++;
    xg[a] += q;
    const onTarget = r.next() < Math.min(0.95, 0.32 + q * 1.6);
    const [sx, sy] = spot(a, kind);
    if (r.next() < q) {
      const sc = pickScorer(a, kind === 'corner' ? 'cross' : kind === 'free kick' ? 'long shot' : kind);
      // VAR checks every goal; a few are ruled out for offside
      if (kind !== 'free kick' && r.next() < 0.035) {
        shots[a]++; xg[a] += q;
        shotsList.push({ m: minute, side: a, x: sx, y: sy, xg: Math.round(q * 100) / 100, goal: false, kind });
        log('var', a, `VAR check... goal by ${sc.p.name} ruled out for offside!`, sc.p.id);
        return;
      }
      goals[a]++;
      onT[a]++;
      shotsList.push({ m: minute, side: a, x: sx, y: sy, xg: Math.round(q * 100) / 100, goal: true, kind, pid: sc.p.id });
      sc.line.g++;
      sc.line.r += 1.0;
      let txt = `GOAL! ${sc.p.name}`;
      let as: OnPitch | null = null;
      if (kind !== 'penalty' && r.next() < 0.75) {
        as = pickAssist(a, sc, kind);
        as.line.a++;
        as.line.r += 0.6;
        txt += `, assisted by ${last(as.p.name)}`;
      }
      const how: Record<string, string> = { corner: 'with a header from a corner', 'free kick': 'with a stunning free kick', cross: 'with a header from a cross', 'through ball': 'running onto a through ball', 'build-up': 'after a patient move', 'long shot': 'from distance', counter: 'on the counter', 'high turnover': 'after winning it high up the pitch', penalty: 'from the spot' };
      log('goal', a, `${txt} ${how[kind] || ''}`.trim(), sc.p.id, as?.p.id);
      S[b].pitch.filter((o) => o.slot === 'DEF' || o.slot === 'GK').forEach((o) => (o.line.r -= 0.25));
    } else {
      shotsList.push({ m: minute, side: a, x: sx, y: sy, xg: Math.round(q * 100) / 100, goal: false, kind });
      if (onTarget) {
        onT[a]++;
        const gk = S[b].pitch.find((o) => o.slot === 'GK');
        if (gk) gk.line.r += 0.15;
        if (q > 0.25 && gk) log('save', b, `Big save by ${gk.p.name}!`, gk.p.id);
      } else if (q > 0.3) {
        log('miss', a, `Huge chance missed for ${S[a].s.name}.`);
      }
      // saves and blocks give corners
      if (kind !== 'corner' && kind !== 'penalty' && r.next() < (onTarget ? 0.3 : 0.22) + (kind === 'cross' ? 0.1 : 0)) corner(a);
    }
  };

  const taker = (side: 0 | 1, id: string | undefined, attr: string) => {
    const on = S[side].pitch.filter((o) => o.slot !== 'GK');
    return on.find((o) => o.p.id === id) || on.sort((x, y) => S[side].val(y, attr) - S[side].val(x, attr))[0];
  };
  const corner = (a: 0 | 1) => {
    corners[a]++;
    if (r.next() > 0.5) return;
    const b = (1 - a) as 0 | 1;
    const sp = S[a].s.setpieces || {};
    const t = taker(a, sp.corner, 'Crossing');
    const cross = t ? S[a].val(t, 'Crossing') : 65;
    let q = 0.04 + (A(a, 'aerial_att') - A(b, 'aerial_def')) * 0.003 + (cross - 70) * 0.0008;
    if (sp.routine === 'near' && A(b, 'keeper') < 76) q += 0.008;
    if (sp.routine === 'far') q += (A(a, 'aerial_att') - A(b, 'aerial_def')) * 0.002;
    if (sp.routine === 'short') q = 0.038;
    if (weather === 'wind') q -= 0.01;
    shot(a, Math.max(0.015, q), 'corner');
  };
  const freeKick = (a: 0 | 1) => {
    const sp = S[a].s.setpieces || {};
    const t = taker(a, sp.fk, 'LongShots');
    const skill = t ? (S[a].val(t, 'LongShots') + S[a].val(t, 'Composure')) / 2 : 65;
    log('freekick', a, `Free kick in a dangerous position. ${t ? t.p.name : ''} stands over it...`, t?.p.id);
    shot(a, Math.max(0.02, 0.045 + (skill - 70) * 0.002), 'free kick');
  };

  const counter = (a: 0 | 1) => {
    const b = 1 - a;
    const exposed = (T(b).line === 2 ? 0.03 : T(b).line === 1 ? 0.01 : -0.03) + (T(b).mentality === 2 ? 0.02 : 0)
      - (T(b).line === 2 ? S[b].flags.sweeper * 0.02 : 0) - S[b].flags.anchor * 0.012;
    const gap = (A(a, 'pace_att') - A(b, 'pace_def')) * 0.005;
    shot(a, Math.max(0.03, 0.1 + exposed + gap), 'counter');
  };

  const create = (a: 0 | 1, bonus = 0) => {
    const b = 1 - a;
    const ta = T(a), tb = T(b);
    let q: number, two: number;
    const f = ta.focus;
    if (f === 0) {
      q = 0.075 + (A(a, 'aerial_att') - A(b, 'aerial_def')) * 0.005 + (ta.width === 2 ? 0.02 : ta.width === 0 ? -0.015 : 0) + (tb.width === 0 ? 0.01 : 0) - (tb.line === 0 ? 0.012 : 0)
        + (ta.width >= 1 ? S[a].flags.crossB : 0) - (weather === 'wind' ? 0.012 : 0);
      two = 0.25;
    } else if (f === 1) {
      q = 0.11 + (A(a, 'pace_att') - A(b, 'pace_def')) * 0.005 + (tb.line === 2 ? 0.05 - S[b].flags.sweeper * 0.02 : tb.line === 0 ? -0.035 : 0) + S[a].flags.through;
      two = 0;
    } else if (f === 2) {
      q = 0.1 + (A(a, 'passing') - A(b, 'tackling')) * 0.005 + (tb.line === 0 ? -0.03 : tb.press >= 2 ? 0.015 : 0) + S[a].flags.through * 0.5;
      two = 0.1;
    } else {
      q = 0.07 + (A(a, 'finishing') - A(b, 'keeper')) * 0.003 + (tb.line === 0 ? 0.04 : 0) - (tb.line === 2 ? 0.01 : 0) + S[a].flags.longshot;
      two = 0.55;
    }
    q = Math.max(0.02, q + bonus);
    // a small share of attacks in the box end with a foul and a penalty
    if (f !== 3 && r.next() < 0.017 * penMul) return penalty(a);
    const n = r.next() < two ? 2 : 1;
    for (let i = 0; i < n; i++) shot(a, q, ['cross', 'through ball', 'build-up', 'long shot'][f]);
  };

  const penalty = (a: 0 | 1) => {
    const b = (1 - a) as 0 | 1;
    if (r.next() < 0.1) {
      log('var', a, `Penalty to ${S[a].s.name}... VAR overturns it! No penalty.`);
      return;
    }
    const fouler = r.weighted(S[b].pitch.filter((o) => o.slot === 'DEF'), (o) => o.p.a.Aggression || 50) || null;
    log('penalty', a, `PENALTY to ${S[a].s.name}!${fouler ? ` ${fouler.p.name} brings his man down.` : ''}`);
    if (fouler) card(b, fouler, 0.45);
    const takerId = S[a].s.pens.find((id) => S[a].pitch.some((o) => o.p.id === id));
    const taker = S[a].pitch.find((o) => o.p.id === takerId) || pickScorer(a, 'build-up');
    const skill = S[a].val(taker, 'Finishing') * 0.55 + S[a].val(taker, 'Composure') * 0.45;
    const p = Math.min(0.92, Math.max(0.55, 0.76 + (skill - 78) * 0.006 - (A(b, 'keeper') - 78) * 0.003));
    shots[a]++;
    xg[a] += 0.76;
    shotsList.push({ m: minute, side: a, x: a === 0 ? 88.5 : 11.5, y: 50, xg: 0.76, goal: false, kind: 'penalty' });
    if (r.next() < p) {
      shotsList[shotsList.length - 1].goal = true;
      shotsList[shotsList.length - 1].pid = taker.p.id;
      goals[a]++;
      onT[a]++;
      taker.line.g++;
      taker.line.r += 0.8;
      log('goal', a, `GOAL! ${taker.p.name} scores the penalty`, taker.p.id);
    } else {
      const saved = r.next() < 0.6;
      if (saved) onT[a]++;
      taker.line.r -= 0.6;
      log('penmiss', a, saved ? `${taker.p.name}'s penalty is SAVED!` : `${taker.p.name} misses the penalty!`, taker.p.id);
    }
  };

  const card = (side: 0 | 1, o: OnPitch, pRed = 0) => {
    if (r.next() < 0.03 + pRed * 0.1) return sendOff(side, o, true);
    o.yc++;
    o.line.yc++;
    o.line.r -= 0.3;
    yel[side]++;
    if (o.yc >= 2) return sendOff(side, o, false);
    log('yellow', side, `Yellow card: ${o.p.name}`, o.p.id);
  };
  const sendOff = (side: 0 | 1, o: OnPitch, straight: boolean) => {
    red[side]++;
    o.line.rc = true;
    o.line.r -= 1.5;
    o.line.mins += minute;
    o.line.fitEnd = Math.round(100 - o.tired * 45);
    S[side].pitch = S[side].pitch.filter((x) => x !== o);
    log('red', side, straight ? `RED CARD! ${o.p.name} is sent off` : `Second yellow: ${o.p.name} is off`, o.p.id);
  };

  const substitute = (side: 0 | 1, out: OnPitch, reason: string) => {
    const sd = S[side];
    if (sd.subsLeft <= 0) return false;
    const wantLine = out.slot;
    const cand = sd.bench.filter((p) => (LINE[p.pos] || 'MID') === wantLine && p.fitness >= 60);
    const pool = cand.length ? cand : sd.bench.filter((p) => p.pos !== 'GK' && p.fitness >= 60);
    if (!pool.length) return false;
    const inn = pool.sort((x, y) => y.ovr - x.ovr)[0];
    sd.bench = sd.bench.filter((p) => p !== inn);
    sd.subsLeft--;
    out.line.mins += minute;
    out.line.fitEnd = Math.round(100 - out.tired * 45);
    const line = mkLine(inn, side, minute);
    lines.push(line);
    sd.pitch = sd.pitch.map((x) => (x === out ? { p: inn, slot: out.slot, tired: (100 - inn.fitness) / 45, yc: 0, on: minute, line } : x));
    log('sub', side, `${reason}: ${inn.name} on for ${out.p.name}`, inn.id, out.p.id);
    return true;
  };

  const assistant = (side: 0 | 1) => {
    const sd = S[side];
    if (sd.manual) {
      // the manager took charge: the assistant only replaces exhausted players
      return;
    }
    const as = sd.s.assistant || {};
    const diff = goals[side] - goals[1 - side];
    if (as.tired && minute >= 60 && minute % 5 === 0) {
      const t = sd.pitch.filter((o) => o.slot !== 'GK' && o.tired > 0.95).sort((x, y) => y.tired - x.tired)[0];
      if (t) substitute(side, t, 'Tired legs');
    }
    if (as.cards && minute >= 50) {
      const bk = sd.pitch.find((o) => o.yc === 1 && o.slot === 'DEF' && !o.line.inj && (o.p.a.Aggression || 50) > 60);
      if (bk && r.next() < 0.15) substitute(side, bk, 'Protecting a booked player');
    }
    if (as.losing && minute >= 60 && diff < 0 && sd.tactic.mentality < 2 && minute % 5 === 0) {
      sd.tactic = { ...sd.tactic, mentality: 2 };
      log('tactic', side, `${sd.s.name} go all out attack`);
      const d = sd.pitch.filter((o) => o.slot === 'DEF').sort((x, y) => x.p.ovr - y.p.ovr)[0];
      if (d) {
        const fw = sd.bench.filter((p) => LINE[p.pos] === 'FWD' && p.fitness >= 60).sort((x, y) => y.ovr - x.ovr)[0];
        if (fw && sd.subsLeft > 0) {
          sd.bench = sd.bench.filter((p) => p !== fw);
          sd.subsLeft--;
          d.line.mins += minute;
          d.line.fitEnd = Math.round(100 - d.tired * 45);
          const line = mkLine(fw, side, minute);
          lines.push(line);
          sd.pitch = sd.pitch.map((x) => (x === d ? { p: fw, slot: 'FWD' as const, tired: (100 - fw.fitness) / 45, yc: 0, on: minute, line } : x));
          log('sub', side, `Extra striker: ${fw.name} on for ${d.p.name}`, fw.id, d.p.id);
        }
      }
    }
    if (as.winning && minute >= 75 && diff > 0 && sd.tactic.mentality > 0) {
      sd.tactic = { ...sd.tactic, mentality: 0, line: Math.min(sd.tactic.line, 1) };
      log('tactic', side, `${sd.s.name} sit back to protect the lead`);
    }
  };

  const applyChange = (c: Change) => {
    const sd = S[c.side];
    sd.manual = true;
    if (c.kind === 'tactic') {
      const { preset, plan, ...rest } = c.tactic;
      const before = sd.tactic.formation;
      sd.tactic = { ...sd.tactic, ...(preset && PRESETS[preset] ? stripDesc(PRESETS[preset]) : {}), ...rest, preset: preset || sd.tactic.preset };
      if (sd.tactic.formation !== before && FORMATIONS[sd.tactic.formation]) {
        // re-seat the players on the pitch into the new shape, natural positions first
        const slots = [...FORMATIONS[sd.tactic.formation].slots];
        const rest2 = [...sd.pitch];
        const placed: OnPitch[] = [];
        for (const strict of [true, false]) {
          for (let i = 0; i < slots.length; i++) {
            if (!slots[i]) continue;
            const k = rest2.findIndex((o) => !strict || (LINE[o.p.pos] || 'MID') === slots[i]);
            if (k < 0) continue;
            const o = rest2.splice(k, 1)[0];
            placed.push({ ...o, slot: slots[i] as OnPitch['slot'] });
            slots[i] = '' as any;
          }
        }
        sd.pitch = [...placed, ...rest2];
      }
      log('tactic', c.side, plan ? `${sd.s.name} switch to Plan ${plan} (${sd.tactic.formation})` : `${sd.s.name} switch to ${sd.tactic.preset === 'Custom' ? 'a new plan' : sd.tactic.preset}${rest.mentality === 2 ? ', all out attack' : rest.mentality === 0 ? ', shutting up shop' : ''}`);
      return;
    }
    if (sd.subsLeft <= 0) return;
    const out = sd.pitch.find((o) => o.p.id === c.out);
    const inn = sd.bench.find((p) => p.id === c.in);
    if (!out || !inn) return;
    sd.bench = sd.bench.filter((p) => p !== inn);
    sd.subsLeft--;
    out.line.mins += minute;
    out.line.fitEnd = Math.round(100 - out.tired * 45);
    const line = mkLine(inn, c.side, minute);
    lines.push(line);
    sd.pitch = sd.pitch.map((x) => (x === out ? { p: inn, slot: out.slot, tired: (100 - inn.fitness) / 45, yc: 0, on: minute, line } : x));
    log('sub', c.side, `Manager's change: ${inn.name} on for ${out.p.name}`, inn.id, out.p.id);
  };

  const phase = (a: 0 | 1) => {
    const b = (1 - a) as 0 | 1;
    const ta = T(a), tb = T(b);
    possN[a]++;
    const risk = ta.build === 0 ? (weather === 'rain' ? 1.55 : 1.35) : ta.build === 2 ? 0.5 : 1.0;
    const pLose = 0.08 + tb.press * 0.045 * risk - (A(a, 'passing') - A(b, 'tackling')) * 0.004;
    if (r.next() < Math.max(0.03, pLose)) {
      // tackles can bring fouls and cards
      if (r.next() < 0.2 + (tb.press >= 2 ? 0.08 : 0)) {
        const f = r.weighted(S[b].pitch.filter((o) => o.slot !== 'GK'), (o) => (o.p.a.Aggression || 50) * (o.slot === 'FWD' ? 0.5 : 1));
        if (f && r.next() < (0.33 + ((f.p.a.Aggression || 50) - 60) * 0.006) * (derby ? 1.5 : 1) * cardMul) card(b, f);
      }
      if (tb.press >= 2 && ta.build !== 2 && r.next() < (tb.press === 3 ? 0.3 : 0.22)) shot(b, tb.press === 3 ? 0.17 : 0.13, 'high turnover');
      else if (tb.mentality <= 1 && r.next() < 0.09 + 0.05 * (2 - tb.mentality)) counter(b);
      return;
    }
    // fouls in shooting range give free kicks
    if (r.next() < 0.012 + (tb.press >= 2 ? 0.004 : 0)) {
      const f = r.weighted(S[b].pitch.filter((o) => o.slot !== 'GK'), (o) => o.p.a.Aggression || 50);
      if (f && r.next() < 0.35 * cardMul) card(b, f);
      return freeKick(a);
    }
    if (ta.build === 2 && r.next() < 0.5) {
      const duel = (A(a, 'aerial_att') - A(b, 'aerial_def')) * 0.04 + (tb.line === 2 ? 0.15 : tb.line === 0 ? -0.4 : 0) - (tb.press === 1 ? 0.35 : 0)
        + S[a].flags.holdup - (weather === 'wind' || weather === 'rain' ? 0.3 : 0);
      if (r.next() < sig(duel - 1.45)) create(a, tb.line === 2 ? 0.02 : 0);
      else if (tb.mentality === 0 && r.next() < 0.06) counter(b);
      return;
    }
    let prog = (A(a, 'passing') - A(b, 'tackling')) * 0.03 + ta.mentality * 0.15 - tb.mentality * 0.12;
    prog += tb.line === 0 ? -0.3 : tb.line === 2 ? 0.12 : 0;
    prog += ta.tempo === 2 ? 0.1 : ta.tempo === 0 ? -0.08 : 0;
    if (r.next() < sig(prog - 1.55)) create(a);
    else if (tb.mentality <= 1 && r.next() < (ta.mentality === 2 ? 0.07 : 0.035)) counter(b);
  };

  const possShare = () => {
    const t0 = T(0), t1 = T(1);
    let x = (A(0, 'passing') - A(1, 'passing')) * 0.035;
    const bv = (t: Tactic) => (t.build === 0 ? 0.35 : t.build === 2 ? -0.2 : 0);
    x += bv(t0) - bv(t1) + (t0.press - t1.press) * 0.08;
    x += (S[0].pitch.length - S[1].pitch.length) * 0.15;
    return sig(x);
  };

  log('kickoff', 0, `Kick-off! ${home.name} vs ${away.name}`);
  const stoppage1 = 1 + Math.floor(r.next() * 3), stoppage2 = 2 + Math.floor(r.next() * 5);
  const total = 90 + stoppage1 + stoppage2;
  for (let k = 1; k <= total; k++) {
    minute = k <= 45 + stoppage1 ? Math.min(k, 45) : k - stoppage1;
    if (k === 46 + stoppage1) log('ht', 0, `Half-time: ${home.name} ${goals[0]}–${goals[1]} ${away.name}`);
    while (nextChange < changes.length && changes[nextChange].m <= minute && (k > 45 + stoppage1 || changes[nextChange].m <= 45)) {
      applyChange(changes[nextChange++]);
    }
    for (const i of [0, 1] as const) {
      const t = S[i].tactic;
      for (const o of S[i].pitch) {
        const stam = o.p.a.Stamina || 70;
        o.tired += Math.max(0.002, (0.0045 + t.press * 0.0016 + t.tempo * 0.0012) * (1 - (stam - 75) * 0.01)) * (weather === 'heat' ? 1.25 : 1);
      }
      // injuries: rare, more likely when exhausted
      if (r.next() < 0.0009 * (S[i].s.injuryRisk ?? 1) * S[i].pitch.length / 11) {
        const v = r.weighted(S[i].pitch, (o) => (o.p.a.InjuryProne || 30) * (1 + o.tired));
        v.line.inj = true;
        log('injury', i, `${v.p.name} is injured`, v.p.id);
        const autoSub = S[i].manual || (S[i].s.assistant || {}).injured !== false;
        if (!autoSub || !substitute(i, v, 'Injury')) {
          v.line.mins += minute;
          S[i].pitch = S[i].pitch.filter((x) => x !== v);
        }
      }
      if (minute >= 46 && k > 45 + stoppage1) assistant(i);
      S[i].refresh(i === 0 ? homeAdv : 0);
    }
    const phases = 1 + (r.next() < 0.18 + 0.06 * (S[0].tactic.tempo + S[1].tactic.tempo) ? 1 : 0);
    for (let p = 0; p < phases; p++) phase(r.next() < possShare() ? 0 : 1);
  }
  minute = 90;
  log('ft', 0, `Full time: ${home.name} ${goals[0]}–${goals[1]} ${away.name}`);

  // cup ties: a draw goes straight to penalties, taken in the order the managers set
  let shootout: Shootout | undefined;
  let winner: 0 | 1 | undefined = goals[0] > goals[1] ? 0 : goals[1] > goals[0] ? 1 : undefined;
  if (opts.knockout && winner === undefined) {
    const order = (i: 0 | 1) => {
      const on = S[i].pitch;
      const named = S[i].s.pens.map((id) => on.find((o) => o.p.id === id)).filter(Boolean) as OnPitch[];
      const rest = on.filter((o) => !named.includes(o) && o.slot !== 'GK').sort((x, y) => (S[i].val(y, 'Finishing') + S[i].val(y, 'Composure')) - (S[i].val(x, 'Finishing') + S[i].val(x, 'Composure')));
      const gk = on.filter((o) => o.slot === 'GK');
      return [...named, ...rest, ...gk];
    };
    const ord: [OnPitch[], OnPitch[]] = [order(0), order(1)];
    const keeper = (i: 0 | 1) => { const g = S[i].pitch.find((o) => o.slot === 'GK'); return g ? (S[i].val(g, 'Reflexes') + S[i].val(g, 'OneOnOne')) / 2 : 45; };
    const sc: [number, number] = [0, 0];
    const kicks: Shootout['kicks'] = [];
    for (let n = 0; n < 30; n++) {
      for (const i of [0, 1] as const) {
        const t = ord[i][n % Math.max(1, ord[i].length)];
        if (!t) continue;
        const skill = S[i].val(t, 'Finishing') * 0.5 + S[i].val(t, 'Composure') * 0.5 - t.tired * 6;
        const p = Math.min(0.92, Math.max(0.5, 0.75 + (skill - 75) * 0.006 - (keeper((1 - i) as 0 | 1) - 75) * 0.004));
        const ok = r.next() < p;
        if (ok) sc[i]++;
        kicks.push({ side: i, pid: t.p.id, scored: ok });
      }
      const k = n + 1;
      if (k <= 5) {
        const left = 5 - k;
        if (sc[0] > sc[1] + left || sc[1] > sc[0] + left) break;
      } else if (sc[0] !== sc[1]) break;
    }
    shootout = { kicks, score: sc };
    winner = sc[0] > sc[1] ? 0 : 1;
    log('pens', winner, `${S[winner].s.name} win ${Math.max(...sc)}–${Math.min(...sc)} on penalties!`);
  }

  // close player lines
  for (const i of [0, 1] as const) {
    for (const o of S[i].pitch) {
      o.line.mins += 90;
      o.line.fitEnd = Math.round(Math.max(15, 100 - o.tired * 45));
    }
    const res = Math.sign(goals[i] - goals[1 - i]);
    const cs = goals[1 - i] === 0;
    for (const l of lines.filter((x) => x.side === i)) {
      l.r += res * 0.35 + (cs && (LINE[l.pos] === 'DEF' || l.pos === 'GK') && l.mins >= 60 ? 0.6 : 0) + r.gauss(0, 0.35);
      l.r = Math.max(3, Math.min(10, Math.round(l.r * 10) / 10));
    }
  }
  const played = lines.filter((l) => l.mins >= 20);
  const motm = played.sort((x, y) => y.r - x.r)[0];
  const totalPoss = possN[0] + possN[1] || 1;
  const p0 = Math.round((possN[0] / totalPoss) * 100);
  return {
    score: goals,
    events: ev,
    stats: { poss: [p0, 100 - p0], shots, onTarget: onT, xg: [Math.round(xg[0] * 100) / 100, Math.round(xg[1] * 100) / 100], corners, yellows: yel, reds: red },
    players: lines,
    motm: motm ? motm.id : null,
    tactics: [home.tactic.preset, away.tactic.preset],
    lineups: [home, away].map((sd) => ({ formation: sd.tactic.formation, preset: sd.tactic.preset, xi: sd.xi.map((p) => p.id), bench: sd.bench.map((p) => p.id) })),
    shootout, winner, derby, shots: shotsList, weather,
  };
}

// ---------------------------------------------------------------- AI manager
const COUNTER: Record<string, number> = {"Tiki-taka|Tiki-taka":0.5,"Tiki-taka|Gegenpress":0.44,"Tiki-taka|Low block":0.38,"Tiki-taka|Wing play":0.52,"Tiki-taka|Long ball":0.4,"Tiki-taka|Shoot on sight":0.65,"Gegenpress|Tiki-taka":0.56,"Gegenpress|Gegenpress":0.5,"Gegenpress|Low block":0.24,"Gegenpress|Wing play":0.52,"Gegenpress|Long ball":0.28,"Gegenpress|Shoot on sight":0.66,"Low block|Tiki-taka":0.62,"Low block|Gegenpress":0.76,"Low block|Low block":0.5,"Low block|Wing play":0.46,"Low block|Long ball":0.45,"Low block|Shoot on sight":0.41,"Wing play|Tiki-taka":0.48,"Wing play|Gegenpress":0.48,"Wing play|Low block":0.54,"Wing play|Wing play":0.5,"Wing play|Long ball":0.47,"Wing play|Shoot on sight":0.54,"Long ball|Tiki-taka":0.6,"Long ball|Gegenpress":0.72,"Long ball|Low block":0.55,"Long ball|Wing play":0.53,"Long ball|Long ball":0.5,"Long ball|Shoot on sight":0.39,"Shoot on sight|Tiki-taka":0.35,"Shoot on sight|Gegenpress":0.34,"Shoot on sight|Low block":0.58,"Shoot on sight|Wing play":0.46,"Shoot on sight|Long ball":0.61,"Shoot on sight|Shoot on sight":0.5};

// Bots read the opponent's recent tactics and counter them. level 0 easy, 1 normal, 2 hard.
export function aiTactic(level: number, oppHistory: string[], seed: number, formation = '4-3-3'): Tactic {
  const r = makeRng(seed);
  const names = Object.keys(PRESETS);
  let pick = r.pick(names);
  if (level > 0 && oppHistory.length && !(level === 1 && r.next() < 0.5)) {
    const counts: Record<string, number> = {};
    oppHistory.forEach((t) => (counts[t] = (counts[t] || 0) + 1));
    const likely = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const ranked = [...names].sort((a, b) => (COUNTER[`${b}|${likely}`] ?? 0.5) - (COUNTER[`${a}|${likely}`] ?? 0.5));
    // hard bots usually pick the best counter, sometimes the second best, so they stay hard to read
    pick = ranked[r.next() < (level === 2 ? 0.7 : 0.5) ? 0 : 1];
  }
  const { desc, ...rest } = PRESETS[pick];
  void desc;
  return { preset: pick, formation, ...rest };
}
