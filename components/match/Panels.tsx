'use client';
// The panels around the live pitch: line-ups with live ratings, live match stats, key events,
// the current formation and the live commentary. Everything is worked out from what has been
// shown so far (no spoilers from later in the match).
import { useEffect, useRef, useState } from 'react';
import { FORMATIONS } from '../../lib/game.ts';
import { Crest, lastName } from '../ui.tsx';
import { evAt, tm, type Ev, type Shot } from './Pitch2D.tsx';
import { counterShare } from '../../lib/engine.ts';
import { PRESETS } from '../../lib/game.ts';

const fmtMin = (m: number) => (m > 90 ? `90+${m - 90}'` : `${m}'`);
const c01 = (u: number) => Math.max(0, Math.min(1, u));

export function useSmoothClock(gm: number, rate: number) {
  // a smooth clock between the page's ticks that never runs backwards (so nothing jumps back)
  const [t, setT] = useState(gm);
  const tick = useRef({ gm, at: 0 });
  const tRef = useRef(gm);
  useEffect(() => { tick.current = { gm, at: performance.now() }; }, [gm]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const k = tick.current;
      let v = Math.min(k.gm + 0.35, k.gm + ((performance.now() - k.at) / 1000) * rate);
      if (v < tRef.current && tRef.current - v < 1.5) v = tRef.current;
      tRef.current = v;
      setT(v);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rate]);
  return t;
}

export function Lineups({ d, gm, shown }: { d: any; gm: number; shown: Ev[] }) {
  const rep = d.report;
  const lines = new Map<string, any>(rep.players.map((p: any) => [p.id, p]));
  const goals = new Map<string, number>(), cards = new Map<string, string>(), off = new Set<string>(), on = new Set<string>();
  for (const e of shown) {
    if (e.type === 'goal' && e.pid) goals.set(e.pid, (goals.get(e.pid) || 0) + 1);
    if (e.type === 'yellow' && e.pid) cards.set(e.pid, cards.get(e.pid) === 'y' ? 'r' : 'y');
    if (e.type === 'red' && e.pid) cards.set(e.pid, 'r');
    if (e.type === 'sub' && e.pid && e.pid2) { off.add(e.pid2); on.add(e.pid); }
  }
  // the rating builds up as the match goes on, toward the one he finishes with
  const rating = (id: string) => { const l = lines.get(id); if (!l) return null; return Math.round((6 + (l.r - 6) * c01(gm / 90)) * 10) / 10; };
  const side = (s: 0 | 1) => {
    const c = s === 0 ? d.home : d.away;
    const xi: string[] = rep.lineups[s].xi, bench: string[] = rep.lineups[s].bench.filter((id: string) => on.has(id));
    return (
      <div className="col" style={{ gap: 1 }}>
        <div className="row mc-teamhead"><Crest c1={c.color1} c2={c.color2} shape={c.shape} emblem={c.human ? c.emblem : -1} short={c.short} size={18} /><b className="ellipsis">{c.name}</b><span className="tiny muted">{rep.lineups[s].formation}</span></div>
        {[...xi, ...bench].map((id) => {
          const n = d.names[id] || {};
          const r = rating(id);
          return (
            <div key={id} className="row mc-pl" style={{ opacity: off.has(id) || cards.get(id) === 'r' ? 0.45 : 1 }}>
              <span className="mc-num">{n.num ?? ''}</span>
              <span className="grow ellipsis">{lastName(n.name || '?')}{id === rep.lineups[s].captain ? ' ©' : ''}</span>
              {goals.get(id) ? <span title="Goal">{'⚽'.repeat(Math.min(3, goals.get(id)!))}</span> : null}
              {cards.get(id) && <i className="mc-card" style={{ background: cards.get(id) === 'r' ? '#FF4A5E' : '#FFE86B' }} />}
              {on.has(id) && <span className="mc-in" title="Came on">▲</span>}
              {off.has(id) && <span className="mc-out" title="Went off">▼</span>}
              {r !== null && <b className="mc-rt" style={{ background: r >= 7.5 ? '#2FA36B' : r >= 6.8 ? '#3B7A5A' : r < 6 ? '#8A3A4A' : 'rgba(255,255,255,0.1)' }}>{r.toFixed(1)}</b>}
            </div>
          );
        })}
      </div>
    );
  };
  return <div className="col mc-lineups" style={{ gap: 10 }}>{side(0)}{side(1)}</div>;
}

export function LiveStats({ d, gm, shown, shots, flow }: { d: any; gm: number; shown: Ev[]; shots: Shot[]; flow: [number, 0 | 1, number, number][] }) {
  const sh = shots.filter((s) => tm(s.m) <= gm);
  const fl = flow.filter((f) => tm(f[0]) <= gm);
  const poss0 = fl.length ? Math.round((fl.filter((f) => f[1] === 0).length / fl.length) * 100) : 50;
  const cnt = (type: string, s: number) => shown.filter((e) => e.type === type && e.side === s).length;
  const rows: [string, number | string, number | string, number, number][] = [
    ['Possession', `${poss0}%`, `${100 - poss0}%`, poss0, 100 - poss0],
    ['Shots', sh.filter((s) => s.side === 0).length, sh.filter((s) => s.side === 1).length, 0, 0],
    ['Shots on target', sh.filter((s) => s.side === 0 && s.on).length, sh.filter((s) => s.side === 1 && s.on).length, 0, 0],
    ['xG', sh.filter((s) => s.side === 0).reduce((a, s) => a + s.xg, 0).toFixed(2), sh.filter((s) => s.side === 1).reduce((a, s) => a + s.xg, 0).toFixed(2), 0, 0],
    ['Corners', sh.filter((s) => s.side === 0 && s.kind === 'corner').length, sh.filter((s) => s.side === 1 && s.kind === 'corner').length, 0, 0],
    ['Offsides', cnt('offside', 0), cnt('offside', 1), 0, 0],
    ['Yellow cards', cnt('yellow', 0), cnt('yellow', 1), 0, 0],
  ];
  return (
    <div className="col" style={{ gap: 6 }}>
      {rows.map(([label, a, b, pa, pb]) => {
        const na = typeof a === 'number' ? a : parseFloat(a), nb = typeof b === 'number' ? b : parseFloat(b);
        const wa = pa || (na + nb ? (na / (na + nb)) * 100 : 50), wb = pb || (na + nb ? (nb / (na + nb)) * 100 : 50);
        return (
          <div key={label} className="mc-stat">
            <b>{a}</b>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="tiny muted" style={{ textAlign: 'center', fontWeight: 800 }}>{label}</span>
              <div className="row" style={{ gap: 3 }}>
                <div className="mc-bar" style={{ justifyContent: 'flex-end' }}><i style={{ width: `${wa}%`, background: d.home.color1 }} /></div>
                <div className="mc-bar"><i style={{ width: `${wb}%`, background: d.away.color1 }} /></div>
              </div>
            </div>
            <b style={{ textAlign: 'right' }}>{b}</b>
          </div>
        );
      })}
    </div>
  );
}

export function KeyEvents({ d, shown }: { d: any; shown: Ev[] }) {
  const ev = shown.filter((e) => ['goal', 'red', 'yellow', 'sub', 'penmiss', 'var'].includes(e.type)).slice().reverse();
  let h = 0, a = 0;
  const score = new Map<Ev, string>();
  for (const e of shown) if (e.type === 'goal') { if (e.side === 0) h++; else a++; score.set(e, `${h}–${a}`); }
  const who = (id?: string) => (id ? lastName(d.names[id]?.name || '') : '');
  if (!ev.length) return <span className="small muted">Nothing yet.</span>;
  return (
    <div className="col" style={{ gap: 4 }}>
      {ev.map((e, i) => (
        <div key={i} className="row small mc-ev" style={{ borderLeft: `3px solid ${(e.side === 0 ? d.home : d.away).color1}` }}>
          <b className="mc-min">{fmtMin(e.m)}</b>
          <span className="mc-ico">{e.type === 'goal' ? '⚽' : e.type === 'red' ? '🟥' : e.type === 'yellow' ? '🟨' : e.type === 'sub' ? '🔁' : e.type === 'var' ? '📺' : '❌'}</span>
          <span className="grow ellipsis" style={{ fontWeight: 800 }}>
            {e.type === 'goal' ? <>{score.get(e)} {who(e.pid)}{e.pid2 ? <span className="muted"> ({who(e.pid2)})</span> : null}</>
              : e.type === 'sub' ? <>{who(e.pid)} <span className="muted">for {who(e.pid2)}</span></>
              : e.type === 'var' ? 'Goal ruled out (VAR)' : e.type === 'penmiss' ? `${who(e.pid)} misses a penalty` : who(e.pid)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Formation({ d, side, shown }: { d: any; side: 0 | 1; shown: Ev[] }) {
  const rep = d.report;
  const F = FORMATIONS[rep.lineups?.[side]?.formation || '4-3-3'] || FORMATIONS['4-3-3'];
  const ids: (string | null)[] = [...rep.lineups[side].xi];
  for (const e of shown) {
    if (e.side !== side) continue;
    if (e.type === 'sub' && e.pid && e.pid2) { const k = ids.indexOf(e.pid2); if (k >= 0) ids[k] = e.pid; }
    if (e.type === 'red' && e.pid) { const k = ids.indexOf(e.pid); if (k >= 0) ids[k] = null; }
  }
  const c = side === 0 ? d.home : d.away;
  return (
    <div className="mc-form">
      <div className="mc-form-pitch">
        {F.xy.map(([x, y]: number[], k: number) => {
          const id = ids[k];
          if (!id) return null;
          return (
            <span key={k} className="mc-form-pl" style={{ left: `${y}%`, bottom: `${4 + (x - 4) * 1.15}%` }}>
              <i style={{ background: c.color1 }}>{d.names[id]?.num ?? ''}</i>
              <small>{lastName(d.names[id]?.name || '')}</small>
            </span>
          );
        })}
      </div>
      <span className="tiny muted" style={{ textAlign: 'center' }}>{c.name} · {rep.lineups[side].formation}</span>
    </div>
  );
}

export function Commentary({ shown }: { shown: Ev[] }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      {shown.slice().reverse().map((e, i) => (
        <div key={shown.length - i} className="row small" style={{ gap: 8, alignItems: 'flex-start', animation: i === 0 ? 'slidein .4s both' : undefined, fontWeight: e.type === 'goal' ? 900 : 700, color: e.type === 'goal' ? '#E8F1FA' : 'var(--soft)' }}>
          <b style={{ width: 34, flex: 'none', color: 'var(--cyan)' }}>{fmtMin(e.m)}</b>
          <span>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

/** a player's fitness right now: from what he started with toward what he ends on, over the minutes he plays */
export function liveFit(d: any, id: string, gm: number, shown: Ev[]) {
  const l = d.report.players.find((p: any) => p.id === id);
  const f0 = d.names[id]?.fit;
  if (!l || f0 == null) return null;
  const on = shown.find((e) => e.type === 'sub' && e.pid === id);
  if (!on && !d.report.lineups.some((x: any) => x.xi.includes(id))) return null;
  const from = on ? tm(on.m) : 0;
  const played = Math.max(0, Math.min(Math.max(1, l.mins), gm - from));
  return Math.round(f0 + (l.fitEnd - f0) * (played / Math.max(1, l.mins)));
}

/** who is on top, minute by minute (above the line the home side, below the away side) */
export function Momentum({ d, gm, flow, shots }: { d: any; gm: number; flow: [number, 0 | 1, number, number][]; shots: Shot[] }) {
  const upTo = Math.min(90, Math.floor(gm));
  const per = new Array(91).fill(0);
  for (const f of flow) { if (f[0] > 90 || f[0] > upTo) continue; const sh = f[3] >= 0 ? shots[f[3]] : null; per[f[0]] += (f[1] === 0 ? 1 : -1) * (0.6 + f[2] * 0.7 + (sh ? 2 + sh.xg * 6 : 0)); }
  const sm = per.map((_, m) => (m > upTo || m === 0 ? 0 : (per[m - 1] * 0.25 + per[m] * 0.5 + (per[m + 1] ?? 0) * 0.25)));
  const max = Math.max(4, ...sm.map(Math.abs));
  const goals = shots.filter((x) => x.goal && x.m <= upTo);
  return (
    <svg className="mc-mom" viewBox="0 0 91 20" preserveAspectRatio="none" aria-label="Momentum">
      <line x1={0} y1={10} x2={91} y2={10} stroke="rgba(255,255,255,0.18)" strokeWidth={0.2} />
      <line x1={45.5} y1={1} x2={45.5} y2={19} stroke="rgba(255,255,255,0.12)" strokeWidth={0.2} />
      {sm.map((v, m) => (m && v ? <rect key={m} x={m - 0.45} width={0.9} y={v > 0 ? 10 - (v / max) * 9 : 10} height={(Math.abs(v) / max) * 9} fill={v > 0 ? d.home.color1 : d.away.color1} opacity={0.9} /> : null))}
      {goals.map((g, i) => <circle key={i} cx={Math.min(90, g.m)} cy={g.side === 0 ? 1.4 : 18.6} r={1.1} fill="#fff" />)}
    </svg>
  );
}

export type Tip = { key: string; text: string; ico: string; act?: { label: string; body?: Record<string, unknown>; sub?: string } };
/** what the assistant would tell you right now (your side only), most urgent first */
export function assistantTips(d: any, gm: number, shown: Ev[], mine: 0 | 1, onPitch: string[]): Tip[] {
  const rep = d.report, M = Math.floor(gm), them = (1 - mine) as 0 | 1;
  const nm = (id: string) => lastName(d.names[id]?.name || '?');
  const tips: Tip[] = [];
  const score = [0, 0];
  for (const e of shown) if (e.type === 'goal') score[e.side]++;
  const diff = score[mine] - score[them];
  // they changed their set-up: name a counter
  const theirs = (rep.styles || []).filter((x: any) => x.side === them && x.m > 0 && tm(x.m) <= gm);
  const lastChange = theirs[theirs.length - 1];
  const bestVs = (p: string) => Object.keys(PRESETS).sort((a, b) => counterShare(b, p) - counterShare(a, p))[0];
  if (lastChange?.preset && gm - tm(lastChange.m) < 6) {
    const best = bestVs(lastChange.preset);
    tips.push({ key: `opp-${lastChange.m}`, ico: '🧠', text: `They have switched to ${lastChange.preset}. ${best} works well against it.`, act: { label: `Play ${best}`, body: { preset: best } } });
  }
  if (shown.some((e) => e.type === 'red' && e.side === mine && gm - tm(e.m) < 4)) tips.push({ key: 'red', ico: '🟥', text: 'Down to ten men. Sitting deeper keeps it tight.', act: { label: 'Park the bus', body: { mentality: 0, line: 0, press: 0 } } });
  // tired legs
  if (gm >= 50) {
    const tired = onPitch.map((id) => ({ id, f: liveFit(d, id, gm, shown) })).filter((x) => x.f != null && x.f < 55 && d.names[x.id]?.pos !== 'GK').sort((a, b) => a.f! - b.f!)[0];
    if (tired) tips.push({ key: `tired-${tired.id}`, ico: '🔋', text: `${nm(tired.id)} is running out of legs (${tired.f}% fit).`, act: { label: 'Sub him', sub: tired.id } });
  }
  // a booked defender
  if (gm >= 35) {
    const booked = onPitch.find((id) => ['CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CDM'].includes(d.names[id]?.pos) && shown.some((e) => e.type === 'yellow' && e.pid === id));
    if (booked) tips.push({ key: `yel-${booked}`, ico: '🟨', text: `${nm(booked)} is on a yellow. One more tackle and he is off.`, act: { label: 'Sub him', sub: booked } });
  }
  // they are all over us
  const recent = (rep.flow || []).filter((f: any) => f[0] <= M && f[0] > M - 10);
  const theirShare = recent.length ? recent.filter((f: any) => f[1] === them).length / recent.length : 0;
  const theirShots = (rep.shots || []).filter((x: Shot) => x.side === them && x.m <= M && x.m > M - 10).length;
  if (M >= 15 && theirShare >= 0.62 && theirShots >= 2) {
    const theirPreset = theirs.length ? theirs[theirs.length - 1].preset : rep.lineups?.[them]?.preset;
    const best = theirPreset ? bestVs(theirPreset) : 'Low block';
    tips.push({ key: `dom-${Math.floor(M / 12)}`, ico: '⚠️', text: `They are all over us: ${Math.round(theirShare * 100)}% of the ball and ${theirShots} shots in ten minutes.`, act: { label: `Try ${best}`, body: { preset: best } } });
  }
  // where their chances come from
  const theirAll = (rep.shots || []).filter((x: Shot) => x.side === them && x.m <= M && x.m > M - 20 && x.kind !== 'penalty');
  if (theirAll.length >= 3) {
    const leftOfMe = theirAll.filter((x: Shot) => (mine === 0 ? x.y > 55 : x.y < 45)).length, rightOfMe = theirAll.filter((x: Shot) => (mine === 0 ? x.y < 45 : x.y > 55)).length;
    if (Math.max(leftOfMe, rightOfMe) >= theirAll.length * 0.7) tips.push({ key: `wing-${Math.floor(M / 20)}`, ico: '🧭', text: `Most of their chances come down our ${leftOfMe > rightOfMe ? 'left' : 'right'} side. A fresh full-back there would help.` });
  }
  if (M >= 65 && diff < 0 && diff >= -2) tips.push({ key: `behind-${score.join('-')}`, ico: '⏱', text: `We are ${-diff} down with ${90 - M} minutes left. Time to go for it.`, act: { label: 'All-out attack', body: { mentality: 2, press: 2 } } });
  if (M >= 78 && diff === 1) tips.push({ key: `lead-${score.join('-')}`, ico: '🛡', text: `One goal up with ${90 - M} minutes to go. Protect it.`, act: { label: 'Park the bus', body: { mentality: 0, line: 0, press: 0 } } });
  return tips;
}

export { evAt };
