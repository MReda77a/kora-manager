'use client';
// What your first eleven is made of, against the other clubs in your division. Every bar is a measure
// the match engine uses, so the weak ones here are the ones opponents go at.
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { BackHead, Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

const ord = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;
const TONE: Record<string, string> = { weak: '#FF7A6B', strong: '#2EF2B0', level: '#8FA6C4' };

export default function ProfileTab({ lid, d, go }: TabProps) {
  const [p, setP] = useState<any>(null);
  useEffect(() => { api(`/api/leagues/${lid}/profile`).then(setP).catch(() => setP({ measures: [], weak: [], strong: [] })); }, [lid, d.club.lineup]);
  if (!p) return <Spinner />;
  return (
    <div className="col" style={{ gap: 10 }}>
      <BackHead title="Team profile" sub={<span className="small muted">{`Your first eleven against the ${p.clubs} clubs in your division`}</span>} />
      <div className="prof-top">
        <section className="panel cut col" style={{ gap: 8 }}>
          <span className="tag" style={{ background: 'rgba(255,122,107,0.18)', color: '#FF7A6B' }}><span>Where they will go at you</span></span>
          {p.weak.length ? p.weak.slice(0, 3).map((m: any) => (
            <div key={m.key} className="col" style={{ gap: 2 }}>
              <b className="small row" style={{ gap: 8 }}><span>{m.name}</span><span style={{ color: TONE.weak }}>{m.diff}</span><span className="tiny muted">{`${ord(m.rank)} / ${m.of}`}</span></b>
              <span className="small muted">{m.note}</span>
              {m.low && <span className="tiny muted">{`Lowest: ${m.low.name} ${m.low.v}`}</span>}
            </div>
          )) : <span className="small muted">No line of this team is clearly below the division. Nobody has an easy way at you.</span>}
        </section>
        <section className="panel cut col" style={{ gap: 8 }}>
          <span className="tag cyan"><span>What to build your plan on</span></span>
          {p.strong.length ? p.strong.slice(0, 3).map((m: any) => (
            <div key={m.key} className="col" style={{ gap: 2 }}>
              <b className="small row" style={{ gap: 8 }}><span>{m.name}</span><span style={{ color: TONE.strong }}>{`+${m.diff}`}</span><span className="tiny muted">{`${ord(m.rank)} / ${m.of}`}</span></b>
              <span className="small muted">{m.note}</span>
              {m.high && <span className="tiny muted">{`Best: ${m.high.name} ${m.high.v}`}</span>}
            </div>
          )) : <span className="small muted">Nothing stands out above the division yet. Pick the plan that hides your weak lines.</span>}
        </section>
      </div>
      <section className="panel cut col" style={{ gap: 8 }}>
        <div className="row between"><span className="tag"><span>Measure by measure</span></span><span className="tiny muted">bar = you · line = division average</span></div>
        {p.measures.map((m: any) => (
          <div key={m.key} className="prof-row">
            <span className="small" style={{ fontWeight: 800 }}>{m.name}</span>
            <span className="prof-bar"><i style={{ width: `${Math.max(4, Math.min(100, (m.mine - 40) * 1.8))}%`, background: TONE[m.tone] }} /><em style={{ left: `${Math.max(0, Math.min(100, (m.avg - 40) * 1.8))}%` }} /></span>
            <b className="num lz" style={{ fontSize: 18, color: TONE[m.tone] }}>{m.mine}</b>
            <span className="tiny muted num">{`${m.diff > 0 ? '+' : ''}${m.diff} · ${ord(m.rank)}`}</span>
          </div>
        ))}
        <div className="row" style={{ gap: 8 }}>
          <button className="ghost small" onClick={() => go('lineup')}><span>Match plan</span></button>
          <button className="ghost small" onClick={() => go('market')}><span>Transfer market</span></button>
        </div>
      </section>
    </div>
  );
}
