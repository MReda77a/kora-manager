// Kora Manager match engine.
// A match is a chain of possession phases: build-up -> progression -> chance -> shot.
// Every step is a duel between one side's tactic and players and the other side's.
// Ported from the Python prototype that was balanced over 50,000+ simulated matches.
import { rng as makeRng, type Rng } from './rng.ts';
import { FORMATIONS, LINE, PRESETS, ROLES, stripDesc, tacticFit, type Tactic } from './game.ts';

export type EPlayer = {
  id: string; name: string; pos: string; ovr: number; fitness: number;
  a: Record<string, number>;
  num?: number; // shirt number
  mod?: number; // form: team of the week, player of the month, upset nominees
};
export type ESide = {
  clubId: number; name: string; xi: EPlayer[]; bench: EPlayer[]; tactic: Tactic;
  assistant: Record<string, boolean>; pens: string[]; homeBoost: number; boost?: number;
  injuryRisk?: number; // 1 = normal, lower with a good doctor
  roles?: Record<string, string>; // player id -> role
  setpieces?: { corner?: string; fk?: string; routine?: string };
  familiarity?: number; // 0..100 with the formation
  chem?: { DEF: number; MID: number; FWD: number }; // 0..100 per line, 50 = neutral
  captain?: string; vice?: string; // player ids: whoever of them is on the pitch wears the armband
  leaders?: Record<string, number>; // leadership 0..1 of the captain and vice
  cardMul?: number; // how harshly the referee treats this side (press conference), 1 = normal
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
  stats: { poss: [number, number]; shots: [number, number]; onTarget: [number, number]; xg: [number, number]; corners: [number, number]; yellows: [number, number]; reds: [number, number]; offsides?: [number, number] };
  players: PlayerLine[];
  motm: string | null;
  tactics: [string, string];
  lineups: { formation: string; preset: string; xi: string[]; bench: string[]; captain?: string }[];
  shootout?: Shootout;
  winner?: 0 | 1;
  derby?: boolean;
  shots?: Shot[];
  weather?: string;
  // the flow of play for the match screen: [minute, side, how far the move got (0 own half, 1 midfield,
  // 2 final third, 3 shot), index into shots or -1]. Logged only: it never changes the result.
  flow?: [number, 0 | 1, number, number][];
};

const sig = (x: number) => 1 / (1 + Math.exp(-x));
// how much a well-suited plan helps: fit runs about -1.5..+1.5, so up to about ±3 on every duel
export const FIT_WEIGHT = 2.6;
// the most goals one team can score in a match
export const MAX_GOALS = 6;

type OnPitch = { p: EPlayer; slot: 'GK' | 'DEF' | 'MID' | 'FWD'; tired: number; yc: number; on: number; line: PlayerLine };

class Side {
  s: ESide;
  pitch: OnPitch[] = [];
  bench: EPlayer[];
  subsLeft = 5;
  form: number;
  tactic: Tactic;
  agg: Record<string, number> = {};
  capBonus = 0; // the captain driving the team on (worked out every minute)
  armband: string | null = null;
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
  fit = 0;
  fitKey = '';
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
      // stepping up together for an offside trap, and timing a run against one
      trap: avg(D.length ? D : M, (o) => (this.val(o, 'Positioning') + this.val(o, 'Decisions') + this.val(o, 'Marking')) / 3, base) - avg(D, (o) => o.tired, 0) * 8,
      runs: avg(F.length ? F : M, (o) => (this.val(o, 'Positioning') + this.val(o, 'Decisions') + this.val(o, 'Pace')) / 3, base),
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
    // the shape itself: more defenders shut the door but blunt the attack, more forwards the other way round,
    // a crowded midfield keeps the ball, wide players feed crosses, a narrow shape plays through the middle
    {
      const F0 = FORMATIONS[this.tactic.formation] || FORMATIONS['4-3-3'];
      const n = (s: string) => F0.slots.filter((x) => x === s).length;
      const nD = n('DEF'), nM = n('MID'), nF = n('FWD');
      const holding = F0.slots.filter((s, i) => s === 'MID' && F0.xy[i][0] <= 36).length;
      const advanced = F0.slots.filter((s, i) => s === 'MID' && F0.xy[i][0] >= 55).length;
      const wide = F0.slots.filter((s, i) => (s === 'MID' || s === 'FWD') && (F0.xy[i][1] <= 20 || F0.xy[i][1] >= 80)).length;
      const A = this.agg;
      const block = (nD - 4) * 2.4 + holding * 1.0 - (nF - 2) * 1.0;
      const attack = (nF - 2) * 2.4 + advanced * 0.6 - (nD - 4) * 1.2;
      A.tackling += block; A.aerial_def += block * 0.8; A.pace_def += block * 0.4;
      A.finishing += attack; A.pace_att += attack * 0.5; A.aerial_att += attack * 0.4;
      A.passing += (nM - 3) * 0.5;
      if (wide >= 2) this.flags.crossB += 0.004 * (wide - 1); else this.flags.through += 0.004;
    }
    if (this.tactic.trap && this.tactic.line >= 1) this.agg.aerial_def -= 0.8;
        // chemistry: team-mates who know each other play better together (-2.5 .. +2.5 per line)
    if (this.s.chem) {
      const c = (v: number) => ((v ?? 50) - 50) / 50 * 2.5;
      const A = this.agg, ch = this.s.chem;
      A.tackling += c(ch.DEF) * 0.7 + c(ch.MID) * 0.3; A.aerial_def += c(ch.DEF); A.pace_def += c(ch.DEF) * 0.5; A.keeper += c(ch.DEF) * 0.4;
      A.passing += c(ch.MID);
      A.finishing += c(ch.FWD); A.pace_att += c(ch.FWD) * 0.5; A.aerial_att += c(ch.FWD) * 0.5;
    }
    if (this.weather === 'rain') this.agg.passing -= 1.5;
    if (this.weather === 'snow') { this.agg.pace_att -= 4; this.agg.pace_def -= 4; }
    const fam = ((this.s.familiarity ?? 60) - 60) / 40;
    // a plan that suits these players is carried out better (see tacticFit); worked out again only when the plan or players change
    const key = `${this.tactic.press}${this.tactic.line}${this.tactic.build}${this.tactic.focus}${this.tactic.width}${this.tactic.tempo}${this.tactic.mentality}|${all.map((o) => o.p.id + o.slot).join(',')}`;
    if (key !== this.fitKey) {
      this.fitKey = key;
      this.fit = tacticFit(all.map((o) => ({ pos: o.p.pos, slot: o.slot, ovr: o.p.ovr, a: o.p.a })), this.tactic).fit;
    }
    for (const k of Object.keys(this.agg)) this.agg[k] += fam + this.fit * FIT_WEIGHT;
    const tired = avg(all, (o) => o.tired, 0);
    const short = (11 - all.length) * 4;
    const pen = Math.min(9, Math.max(0, tired - 0.55) * 10) + short - this.form - homeAdv - (this.s.boost || 0) - this.capBonus;
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
  const flow: [number, 0 | 1, number, number][] = [];
  const reach = (side: 0 | 1, r: number) => {
    const f = flow[flow.length - 1];
    if (!f || f[1] !== side || f[0] !== minute || f[3] >= 0) flow.push([minute, side, r, -1]);
    else if (r > f[2]) f[2] = r;
  };
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
    const outfield = S[side].pitch.filter((o) => o.slot !== 'GK');
    const pool = outfield.length ? outfield : S[side].pitch; // never leave a goal without a scorer
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
    reach(a, 3); flow[flow.length - 1][3] = shotsList.length;
    let q = 0.73 * baseXg * (1 + (A(a, "finishing") - A(b, "keeper")) * 0.015);
    q = Math.min(0.75, Math.max(0.01, q));
    // a team well ahead takes its foot off the gas, and nobody scores more than six
    const lead = goals[a] - goals[b];
    if (lead >= 3) q *= lead >= 4 ? 0.55 : 0.75;
    if (goals[a] >= MAX_GOALS) q = 0;
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

  const tk = (i: number) => T(i).tackle ?? 1; // 0 stay on feet, 1 normal, 2 get stuck in
  // the captain on the pitch keeps heads cool: fewer cards. The referee may also have it in for a side.
  const lead = (i: number) => (S[i].armband ? S[i].s.leaders?.[S[i].armband!] ?? 0.5 : 0);
  const calm = (i: number) => (1 - lead(i) * 0.22) * (S[i].s.cardMul ?? 1);
  const offsides: [number, number] = [0, 0];
  // the defending side steps up to catch a run offside: it works if the defence is in tune
  // (positioning, decisions, chemistry, fresh legs), otherwise the runner is clean through
  const trap = (a: 0 | 1): 'off' | 'beaten' | null => {
    const b = (1 - a) as 0 | 1;
    if (!T(b).trap || T(b).line < 1 || r.next() > 0.6) return null;
    const chem = ((S[b].s.chem?.DEF ?? 50) - 50) / 50 * 4;
    const edge = A(b, 'trap') - A(a, 'runs') + chem;
    if (r.next() < sig(0.15 + edge * 0.13)) {
      offsides[a]++;
      log('offside', a, `Offside! ${S[b].s.name}'s trap catches the run.`);
      return 'off';
    }
    log('trap', a, `The trap is beaten! ${S[a].s.name} are clean through...`);
    return 'beaten';
  };

  const counter = (a: 0 | 1) => {
    const b = 1 - a;
    const tr = trap(a);
    if (tr === 'off') return;
    if (tr === 'beaten') return shot(a, 0.3 + (A(a, 'pace_att') - A(b, 'pace_def')) * 0.004, 'counter');
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
      q = 0.075 + (A(a, 'aerial_att') - A(b, 'aerial_def')) * 0.005 + (ta.width === 2 ? 0.02 : ta.width === 0 ? -0.015 : 0) + (tb.width === 0 ? 0.01 : 0) + (tb.line === 0 ? 0.015 : 0)
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
    if (f === 1) {
      const tr = trap(a);
      if (tr === 'off') return;
      if (tr === 'beaten') q += 0.22;
    }
    // a small share of attacks in the box end with a foul and a penalty (more against wild tackling)
    if (f !== 3 && r.next() < 0.017 * penMul * [0.75, 1, 1.45][tk(b)]) return penalty(a);
    const n = r.next() < two ? 2 : 1;
    for (let i = 0; i < n; i++) shot(a, q, ['cross', 'through ball', 'build-up', 'long shot'][f]);
  };

  const penalty = (a: 0 | 1) => {
    const b = (1 - a) as 0 | 1;
    reach(a, 2);
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
    const p = goals[a] >= MAX_GOALS ? 0 : Math.min(0.92, Math.max(0.55, 0.76 + (skill - 78) * 0.006 - (A(b, 'keeper') - 78) * 0.003));
    shots[a]++;
    xg[a] += 0.76;
    reach(a, 3); flow[flow.length - 1][3] = shotsList.length;
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
    // the assistant calms things down when a defender is one tackle away from a red
    if (tk(side) === 2 && o.slot === 'DEF' && S[side].s.assistant?.cards) {
      S[side].tactic = { ...S[side].tactic, tackle: 1 };
      log('tactic', side, `${S[side].s.name} ease off the tackles: ${o.p.name} is on a yellow.`);
    }
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
      // "switch to" marks a manager's own decision (the full-time screen tells it apart from the assistant)
      const what = plan ? `Plan ${plan} (${sd.tactic.formation})`
        : preset && PRESETS[preset] ? preset
        : rest.mentality === 2 ? 'all-out attack' : rest.mentality === 0 && rest.line === 0 ? 'parking the bus' : rest.press === 3 ? 'a high press' : 'a new plan';
      log('tactic', c.side, `${sd.s.name} switch to ${what}`);
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
    flow.push([minute, a, 0, -1]);
    const risk = ta.build === 0 ? (weather === 'rain' ? 1.55 : 1.35) : ta.build === 2 ? 0.5 : 1.0;
    const pLose = 0.08 + tb.press * 0.045 * risk - (A(a, 'passing') - A(b, 'tackling')) * 0.004 + [-0.035, 0, 0.07][tk(b)] + (tk(b) === 2 && ta.build === 0 ? 0.035 : 0); // hard tackling hurts short-passing sides most
    if (r.next() < Math.max(0.03, pLose)) {
      // tackles can bring fouls and cards, many more when the team gets stuck in
      if (r.next() < (0.2 + (tb.press >= 2 ? 0.08 : 0)) * [0.55, 1, 1.6][tk(b)]) {
        const f = r.weighted(S[b].pitch.filter((o) => o.slot !== 'GK'), (o) => (o.p.a.Aggression || 50) * (o.slot === 'FWD' ? 0.5 : 1));
        if (f && r.next() < (0.33 + ((f.p.a.Aggression || 50) - 60) * 0.006) * (derby ? 1.5 : 1) * cardMul * calm(b) * [0.7, 1, 1.15][tk(b)]) card(b, f, tk(b) === 2 ? 0.05 : 0);
      }
      if (tb.press >= 2 && ta.build !== 2 && r.next() < (tb.press === 3 ? 0.25 : 0.2)) shot(b, tb.press === 3 ? 0.15 : 0.13, 'high turnover');
      else if (tb.mentality <= 1 && r.next() < 0.09 + 0.05 * (2 - tb.mentality)) counter(b);
      return;
    }
    reach(a, 1);
    // fouls in shooting range give free kicks
    if (r.next() < (0.012 + (tb.press >= 2 ? 0.004 : 0)) * [0.6, 1, 1.6][tk(b)]) {
      const f = r.weighted(S[b].pitch.filter((o) => o.slot !== 'GK'), (o) => o.p.a.Aggression || 50);
      if (f && r.next() < 0.35 * cardMul * calm(b) * [0.75, 1, 1.25][tk(b)]) card(b, f);
      return freeKick(a);
    }
    if (ta.build === 2 && r.next() < 0.5) {
      const duel = (A(a, 'aerial_att') - A(b, 'aerial_def')) * 0.04 + (tb.line === 2 ? 0.15 : tb.line === 0 ? -0.2 : 0) - (tb.press === 1 ? 0.35 : 0)
        + S[a].flags.holdup - (weather === 'wind' || weather === 'rain' ? 0.3 : 0);
      if (r.next() < sig(duel - 1.45)) { reach(a, 2); create(a, tb.line === 2 ? 0.02 : 0); }
      else if (tb.mentality === 0 && r.next() < 0.06) counter(b);
      return;
    }
    let prog = (A(a, 'passing') - A(b, 'tackling')) * 0.03 + ta.mentality * 0.15 - tb.mentality * 0.12;
    prog += tb.line === 0 ? (ta.focus === 0 && ta.width >= 1 ? -0.08 : -0.24) : tb.line === 2 ? 0.12 : 0; // wide crossing teams go around a deep block
    // game state: a team chasing the game late on throws bodies forward, more so when told to attack
    const behind = goals[b] - goals[a];
    if (behind > 0 && minute >= 55) prog += 0.16 + (ta.mentality === 2 ? 0.22 : ta.mentality === 0 ? -0.1 : 0);
    prog += ta.tempo === 2 ? 0.1 : ta.tempo === 0 ? -0.08 : 0;
    prog += [0.08, 0, -0.1][tk(b)]; // soft tacklers let them through, hard ones stop them in their tracks
    if (r.next() < sig(prog - 1.55)) { reach(a, 2); create(a); }
    else if (tb.mentality <= 1 && r.next() < (ta.mentality === 2 ? 0.07 : 0.035)) counter(b);
  };

  const possShare = () => {
    const t0 = T(0), t1 = T(1);
    let x = (A(0, 'passing') - A(1, 'passing')) * 0.035;
    const bv = (t: Tactic) => (t.build === 0 ? 0.35 : t.build === 2 ? -0.2 : 0);
    x += bv(t0) - bv(t1) + (t0.press - t1.press) * 0.08;
    x += (S[0].pitch.length - S[1].pitch.length) * 0.15;
    // late on, the team that is behind has more of the ball (the leader sits deeper)
    if (minute >= 55 && goals[0] !== goals[1]) x += (goals[0] < goals[1] ? 1 : -1) * (0.25 + (T(goals[0] < goals[1] ? 0 : 1).mentality === 2 ? 0.2 : 0));
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
      // the armband: the captain, or the vice-captain when he is off the pitch
      const sd = S[i];
      const holder = [sd.s.captain, sd.s.vice].find((id) => id && sd.pitch.some((o) => o.p.id === id)) || null;
      if (holder !== sd.armband) {
        if (sd.armband && holder) log('captain', i, `${sd.pitch.find((o) => o.p.id === holder)!.p.name} takes the armband.`, holder);
        sd.armband = holder;
      }
      // a leader lifts the team a little, and drives it on when it is behind
      const behind = goals[i] < goals[1 - i];
      sd.capBonus = holder ? (sd.s.leaders?.[holder] ?? 0.5) * (behind ? (minute >= 46 ? 1.6 : 1.0) : 0.4) : 0;
      sd.refresh(i === 0 ? homeAdv : 0);
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
    stats: { poss: [p0, 100 - p0], shots, onTarget: onT, xg: [Math.round(xg[0] * 100) / 100, Math.round(xg[1] * 100) / 100], corners, yellows: yel, reds: red, offsides },
    players: lines,
    motm: motm ? motm.id : null,
    tactics: [home.tactic.preset, away.tactic.preset],
    lineups: [home, away].map((sd) => ({ formation: sd.tactic.formation, preset: sd.tactic.preset, xi: sd.xi.map((p) => p.id), bench: sd.bench.map((p) => p.id), captain: sd.captain })),
    shootout, winner, derby, shots: shotsList, weather, flow,
  };
}

// ---------------------------------------------------------------- AI manager
// Win share of the row tactic against the column tactic on a neutral pitch with equal squads
// (measured with this engine: scripts/tactics-study.ts). Every tactic has at least one clear counter.
const M = {
  'Tiki-taka': { 'Tiki-taka': 50, Gegenpress: 44, 'Low block': 35, 'Wing play': 58, 'Long ball': 47, 'Shoot on sight': 61 },
  Gegenpress: { 'Tiki-taka': 56, Gegenpress: 50, 'Low block': 31, 'Wing play': 57, 'Long ball': 45, 'Shoot on sight': 62 },
  'Low block': { 'Tiki-taka': 65, Gegenpress: 69, 'Low block': 50, 'Wing play': 49, 'Long ball': 55, 'Shoot on sight': 41 },
  'Wing play': { 'Tiki-taka': 42, Gegenpress: 43, 'Low block': 51, 'Wing play': 50, 'Long ball': 54, 'Shoot on sight': 54 },
  'Long ball': { 'Tiki-taka': 53, Gegenpress: 55, 'Low block': 45, 'Wing play': 46, 'Long ball': 50, 'Shoot on sight': 37 },
  'Shoot on sight': { 'Tiki-taka': 39, Gegenpress: 38, 'Low block': 59, 'Wing play': 46, 'Long ball': 63, 'Shoot on sight': 50 },
} as Record<string, Record<string, number>>;
export const counterShare = (mine: string, theirs: string) => (M[mine]?.[theirs] ?? 50) / 100;

// The preset closest to any tactic, so custom tactics can be read and countered too.
export function nearestPreset(t: Partial<Tactic>) {
  let best = 'Wing play', bd = 1e9;
  for (const [n, p] of Object.entries(PRESETS)) {
    const d = (['mentality', 'press', 'line', 'build', 'focus', 'width', 'tempo'] as const).reduce((s, k) => s + Math.abs((p[k] as number) - ((t[k] as number) ?? 1)) * (k === 'focus' || k === 'press' ? 1.5 : 1), 0);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

type PlanPlayer = { pos: string; ovr: number; a: Record<string, number> };
const lineAvg = (xi: PlanPlayer[], line: string, keys: string[]) => {
  const ps = xi.filter((p) => (LINE[p.pos] || 'MID') === line);
  if (!ps.length) return 60;
  return ps.reduce((s, p) => s + keys.reduce((k, key) => k + (p.a[key] ?? 50), 0) / keys.length, 0) / ps.length;
};

// The AI manager. It reads what the other manager has played lately (the latest match counts most),
// picks a plan that beats it AND suits its own players, then aims at the other side's weak spots.
// level 0 easy (random), 1 normal (decent but readable), 2 hard (sharp).
export function aiPlan(o: { level: number; oppHistory: string[]; own: PlanPlayer[]; opp: PlanPlayer[]; seed: number; formation: string }): Tactic {
  const r = makeRng(o.seed);
  const names = Object.keys(PRESETS);
  const slots = (FORMATIONS[o.formation] || FORMATIONS['4-3-3']).slots;
  const own = o.own.map((p, i) => ({ ...p, slot: slots[i] }));
  let pick = r.pick(names);
  if (o.level > 0) {
    const scored = names.map((n) => {
      let c = 0, w = 0;
      o.oppHistory.slice(0, 4).forEach((h, i) => { const wt = [1, 0.55, 0.3, 0.2][i]; c += counterShare(n, h) * wt; w += wt; });
      const counter = w ? c / w : 0.5;
      const fit = tacticFit(own, stripDesc(PRESETS[n])).fit;
      return { n, v: counter + fit * 0.06 + (r.next() - 0.5) * (o.level === 2 ? 0.02 : 0.08) };
    }).sort((x, y) => y.v - x.v);
    pick = scored[o.level === 2 ? (r.next() < 0.85 ? 0 : 1) : Math.floor(r.next() * 3)].n;
  }
  const t: Tactic = { preset: pick, formation: o.formation, ...stripDesc(PRESETS[pick]) } as Tactic;
  if (o.level === 0) return t;
  // aim at weak spots (hard always, normal half the time)
  if (o.level === 2 || r.next() < 0.5) {
    const paceGap = lineAvg(o.own, 'FWD', ['Pace']) - lineAvg(o.opp, 'DEF', ['Pace']);
    const airGap = lineAvg(o.own, 'FWD', ['Heading', 'Jumping', 'Strength']) - lineAvg(o.opp, 'DEF', ['Heading', 'Jumping', 'Strength']);
    const theirKeeper = lineAvg(o.opp, 'GK', ['Reflexes', 'Handling']);
    const theirRunners = lineAvg(o.opp, 'FWD', ['Pace']) - lineAvg(o.own, 'DEF', ['Pace']);
    const edges = [
      { v: paceGap - 4, set: () => { t.focus = 1; t.tempo = Math.max(t.tempo, 1); } },
      { v: airGap - 4, set: () => { t.focus = 0; t.width = 2; } },
      { v: 74 - theirKeeper, set: () => { t.focus = 3; } },
    ].filter((e) => e.v > 0).sort((a, b) => b.v - a.v);
    if (edges[0]) { edges[0].set(); t.preset = 'Custom'; }
    if (theirRunners > 4 && t.line === 2) { t.line = 1; t.preset = 'Custom'; } // never a high line against fast strikers
    // a sharp back line plays an offside trap; some managers like their teams to get stuck in
    const sharp = lineAvg(o.own, 'DEF', ['Positioning', 'Decisions', 'Marking']) - lineAvg(o.opp, 'FWD', ['Positioning', 'Decisions', 'Pace']);
    if (sharp >= 3 && t.line >= 1) t.trap = 1;
    if (r.next() < 0.2) t.tackle = 2;
  }
  return t;
}

// Kept for clubs being created: a plain random preset.
export function aiTactic(_level: number, _oppHistory: string[], seed: number, formation = '4-3-3'): Tactic {
  const r = makeRng(seed);
  const pick = r.pick(Object.keys(PRESETS));
  return { preset: pick, formation, ...stripDesc(PRESETS[pick]) } as Tactic;
}
