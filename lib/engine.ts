// Kora Manager match engine.
// A match is a chain of possession phases: build-up -> progression -> chance -> shot.
// Every step is a duel between one side's tactic and players and the other side's.
// Ported from the Python prototype that was balanced over 50,000+ simulated matches.
import { rng as makeRng, type Rng } from './rng.ts';
import { FORMATIONS, LINE, PRESETS, type Tactic } from './game.ts';

export type EPlayer = {
  id: string; name: string; pos: string; ovr: number; fitness: number;
  a: Record<string, number>;
};
export type ESide = {
  clubId: number; name: string; xi: EPlayer[]; bench: EPlayer[]; tactic: Tactic;
  assistant: Record<string, boolean>; pens: string[]; homeBoost: number; boost?: number;
};
export type MatchEvent = { m: number; type: string; side: 0 | 1; text: string; pid?: string; pid2?: string };
export type PlayerLine = { id: string; name: string; side: 0 | 1; pos: string; r: number; g: number; a: number; mins: number; fitEnd: number; yc: number; rc: boolean; inj: boolean };
export type Report = {
  score: [number, number];
  events: MatchEvent[];
  stats: { poss: [number, number]; shots: [number, number]; onTarget: [number, number]; xg: [number, number]; corners: [number, number]; yellows: [number, number]; reds: [number, number] };
  players: PlayerLine[];
  motm: string | null;
  tactics: [string, string];
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
  constructor(s: ESide, r: Rng, idx: 0 | 1, lines: PlayerLine[]) {
    this.s = s;
    this.tactic = { ...s.tactic };
    this.bench = [...s.bench];
    this.form = r.gauss(0, 2.2);
    const slots = (FORMATIONS[s.tactic.formation] || FORMATIONS['4-3-3']).slots;
    s.xi.forEach((p, i) => {
      const line = mkLine(p, idx, 0);
      lines.push(line);
      this.pitch.push({ p, slot: slots[i] || 'MID', tired: (100 - p.fitness) / 45, yc: 0, on: 0, line });
    });
  }
  // attribute of a player in his slot, after tiredness
  val(o: OnPitch, attr: string) {
    let v = o.p.a[attr] ?? o.p.ovr;
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
    const tired = avg(all, (o) => o.tired, 0);
    const short = (11 - all.length) * 4;
    const pen = Math.max(0, tired - 0.55) * 14 + short - this.form - homeAdv - (this.s.boost || 0);
    for (const k of Object.keys(this.agg)) this.agg[k] -= pen;
  }
}

function mkLine(p: EPlayer, side: 0 | 1, onAt: number): PlayerLine {
  return { id: p.id, name: p.name, side, pos: p.pos, r: 6.0, g: 0, a: 0, mins: -onAt, fitEnd: p.fitness, yc: 0, rc: false, inj: false };
}

const last = (n: string) => n.split(' ').slice(-1)[0];

export function simulate(home: ESide, away: ESide, seed: number): Report {
  const r = makeRng(seed);
  const lines: PlayerLine[] = [];
  const S: [Side, Side] = [new Side(home, r, 0, lines), new Side(away, r, 1, lines)];
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
    if (kind === 'cross' && r.next() < 0.35) corners[a]++;
    if (r.next() < q) {
      goals[a]++;
      onT[a]++;
      const sc = pickScorer(a, kind);
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
      const how: Record<string, string> = { cross: 'with a header from a cross', 'through ball': 'running onto a through ball', 'build-up': 'after a patient move', 'long shot': 'from distance', counter: 'on the counter', 'high turnover': 'after winning it high up the pitch', penalty: 'from the spot' };
      log('goal', a, `${txt} ${how[kind] || ''}`.trim(), sc.p.id, as?.p.id);
      S[b].pitch.filter((o) => o.slot === 'DEF' || o.slot === 'GK').forEach((o) => (o.line.r -= 0.25));
    } else if (onTarget) {
      onT[a]++;
      const gk = S[b].pitch.find((o) => o.slot === 'GK');
      if (gk) gk.line.r += 0.15;
      if (q > 0.25 && gk) log('save', b, `Big save by ${gk.p.name}!`, gk.p.id);
    } else if (q > 0.3) {
      log('miss', a, `Huge chance missed for ${S[a].s.name}.`);
    }
  };

  const counter = (a: 0 | 1) => {
    const b = 1 - a;
    const exposed = (T(b).line === 2 ? 0.03 : T(b).line === 1 ? 0.01 : -0.03) + (T(b).mentality === 2 ? 0.02 : 0);
    const gap = (A(a, 'pace_att') - A(b, 'pace_def')) * 0.005;
    shot(a, Math.max(0.03, 0.1 + exposed + gap), 'counter');
  };

  const create = (a: 0 | 1, bonus = 0) => {
    const b = 1 - a;
    const ta = T(a), tb = T(b);
    let q: number, two: number;
    const f = ta.focus;
    if (f === 0) {
      q = 0.075 + (A(a, 'aerial_att') - A(b, 'aerial_def')) * 0.005 + (ta.width === 2 ? 0.02 : ta.width === 0 ? -0.015 : 0) + (tb.width === 0 ? 0.01 : 0) - (tb.line === 0 ? 0.012 : 0);
      two = 0.25;
    } else if (f === 1) {
      q = 0.11 + (A(a, 'pace_att') - A(b, 'pace_def')) * 0.005 + (tb.line === 2 ? 0.05 : tb.line === 0 ? -0.035 : 0);
      two = 0;
    } else if (f === 2) {
      q = 0.1 + (A(a, 'passing') - A(b, 'tackling')) * 0.005 + (tb.line === 0 ? -0.03 : tb.press >= 2 ? 0.015 : 0);
      two = 0.1;
    } else {
      q = 0.07 + (A(a, 'finishing') - A(b, 'keeper')) * 0.003 + (tb.line === 0 ? 0.04 : 0) - (tb.line === 2 ? 0.01 : 0);
      two = 0.55;
    }
    q = Math.max(0.02, q + bonus);
    // a small share of attacks in the box end with a foul and a penalty
    if (f !== 3 && r.next() < 0.017) return penalty(a);
    const n = r.next() < two ? 2 : 1;
    for (let i = 0; i < n; i++) shot(a, q, ['cross', 'through ball', 'build-up', 'long shot'][f]);
  };

  const penalty = (a: 0 | 1) => {
    const b = (1 - a) as 0 | 1;
    const fouler = r.weighted(S[b].pitch.filter((o) => o.slot === 'DEF'), (o) => o.p.a.Aggression || 50) || null;
    log('penalty', a, `PENALTY to ${S[a].s.name}!${fouler ? ` ${fouler.p.name} brings his man down.` : ''}`);
    if (fouler) card(b, fouler, 0.45);
    const takerId = S[a].s.pens.find((id) => S[a].pitch.some((o) => o.p.id === id));
    const taker = S[a].pitch.find((o) => o.p.id === takerId) || pickScorer(a, 'build-up');
    const skill = S[a].val(taker, 'Finishing') * 0.55 + S[a].val(taker, 'Composure') * 0.45;
    const p = Math.min(0.92, Math.max(0.55, 0.76 + (skill - 78) * 0.006 - (A(b, 'keeper') - 78) * 0.003));
    shots[a]++;
    xg[a] += 0.76;
    if (r.next() < p) {
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

  const phase = (a: 0 | 1) => {
    const b = (1 - a) as 0 | 1;
    const ta = T(a), tb = T(b);
    possN[a]++;
    const risk = ta.build === 0 ? 1.35 : ta.build === 2 ? 0.5 : 1.0;
    const pLose = 0.08 + tb.press * 0.045 * risk - (A(a, 'passing') - A(b, 'tackling')) * 0.004;
    if (r.next() < Math.max(0.03, pLose)) {
      // tackles can bring fouls and cards
      if (r.next() < 0.2 + (tb.press >= 2 ? 0.08 : 0)) {
        const f = r.weighted(S[b].pitch.filter((o) => o.slot !== 'GK'), (o) => (o.p.a.Aggression || 50) * (o.slot === 'FWD' ? 0.5 : 1));
        if (f && r.next() < 0.33 + ((f.p.a.Aggression || 50) - 60) * 0.006) card(b, f);
      }
      if (tb.press >= 2 && ta.build !== 2 && r.next() < (tb.press === 3 ? 0.3 : 0.22)) shot(b, tb.press === 3 ? 0.17 : 0.13, 'high turnover');
      else if (tb.mentality <= 1 && r.next() < 0.09 + 0.05 * (2 - tb.mentality)) counter(b);
      return;
    }
    if (ta.build === 2 && r.next() < 0.5) {
      const duel = (A(a, 'aerial_att') - A(b, 'aerial_def')) * 0.04 + (tb.line === 2 ? 0.15 : tb.line === 0 ? -0.4 : 0) - (tb.press === 1 ? 0.35 : 0);
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
    for (const i of [0, 1] as const) {
      const t = S[i].tactic;
      for (const o of S[i].pitch) {
        const stam = o.p.a.Stamina || 70;
        o.tired += Math.max(0.002, (0.0045 + t.press * 0.0016 + t.tempo * 0.0012) * (1 - (stam - 75) * 0.01));
      }
      // injuries: rare, more likely when exhausted
      if (r.next() < 0.0009 * S[i].pitch.length / 11) {
        const v = r.weighted(S[i].pitch, (o) => (o.p.a.InjuryProne || 30) * (1 + o.tired));
        v.line.inj = true;
        log('injury', i, `${v.p.name} is injured`, v.p.id);
        if (!substitute(i, v, 'Injury')) {
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
