'use client';
// The panels around the live pitch: line-ups with live ratings, live match stats, key events,
// the current formation and the live commentary. Everything is worked out from what has been
// shown so far (no spoilers from later in the match).
import { useEffect, useRef, useState } from 'react';
import { FORMATIONS } from '../../lib/game.ts';
import { Crest, lastName } from '../ui.tsx';
import { evAt, tm, type Ev, type Shot } from './Pitch2D.tsx';

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
        <div key={shown.length - i} className="row small" style={{ gap: 8, alignItems: 'flex-start', animation: i === 0 ? 'slidein .4s both' : undefined, fontWeight: e.type === 'goal' ? 900 : 700, color: e.type === 'goal' ? '#F3EEFF' : 'var(--soft)' }}>
          <b style={{ width: 34, flex: 'none', color: 'var(--cyan)' }}>{fmtMin(e.m)}</b>
          <span>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

export { evAt };
