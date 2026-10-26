'use client';
import { useEffect, useState } from 'react';
import { api, clock } from '../../lib/client.ts';
import { BackHead, Spinner, Stars } from '../ui.tsx';
import type { TabProps } from './types.ts';

export default function ConditionTab({ lid, go }: TabProps) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api(`/api/leagues/${lid}/condition`).then(setD); }, [lid]);
  if (!d) return <Spinner />;
  const injured = d.players.filter((p: any) => p.out);
  const fitColor = (v: number) => (v >= 85 ? '#7CE3A1' : v >= 70 ? '#F2C14E' : '#FF6B7A');
  const best = (role: string) => d.staff.find((s: any) => s.role === role);
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Squad Condition" sub={d.next ? `next: ${d.next.home ? 'vs' : 'at'} ${d.next.opponent} · ${clock(d.next.kickoff)}` : 'no match scheduled'} right={<span className="small" style={{ color: '#7CE3A1', fontWeight: 800 }}>{injured.length} out · recovery {d.recoveryPerDay}%/day</span>} />
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(170px, 250px)', gap: 12 }}>
        <section className="panel cut" style={{ padding: 8, gap: 0 }}>
          <div className="row tiny" style={{ color: '#B4A8E0', fontWeight: 900, padding: '0 8px 6px', gap: 8 }}>
            <span className="grow" style={{ minWidth: 80 }}>PLAYER</span><span className="hide-sm" style={{ width: 36 }}>POS</span><span style={{ width: 30 }}>OVR</span><span style={{ width: 76 }}>NOW</span><span style={{ width: 44 }}>MATCH</span><span style={{ width: 74 }}>STATUS</span>
          </div>
          <div className="col" style={{ gap: 2, maxHeight: 320, overflowY: 'auto' }}>
            {d.players.map((p: any) => (
              <div key={p.id} className="row small" style={{ gap: 8, padding: '4px 8px', background: p.out ? 'rgba(255,107,122,0.1)' : 'rgba(255,255,255,0.04)', fontWeight: 700 }}>
                <span className="grow ellipsis" style={{ minWidth: 80 }}><b>{p.name}</b></span>
                <span style={{ width: 36 }} className="muted hide-sm">{p.pos}</span>
                <span className="lz" style={{ width: 30, fontSize: 17 }}>{p.ovr + (p.form || 0)}</span>
                <span className="row" style={{ width: 76, gap: 4 }}>
                  <span className="bar" style={{ height: 6 }}><i style={{ width: `${p.fitness}%`, background: fitColor(p.fitness) }} /></span>
                  <b style={{ width: 34, textAlign: 'right', color: fitColor(p.fitness) }}>{p.fitness}%</b>
                </span>
                <b style={{ width: 44, color: fitColor(p.expected) }}>{p.out ? '—' : `${p.expected}%`}</b>
                <span style={{ width: 74 }}>
                  {p.out ? <span className="status bad" title={p.out.reason}>{p.out.reason === 'Suspended' ? 'BANNED' : `INJ ${p.out.days}d`}</span>
                    : p.form > 0 ? <span className="status ok">FORM +{p.form}</span>
                    : p.form < 0 ? <span className="status bad">UPSET {p.form}</span>
                    : p.expected < 75 ? <span className="status risk">TIRED</span> : <span className="status ok">OK</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="col" style={{ gap: 10 }}>
          <div className="panel cut" style={{ gap: 8 }}>
            <span className="kicker">Medical & coaching staff</span>
            {(['doctor', 'physio', 'coach'] as const).map((r) => {
              const s = best(r);
              return (
                <div key={r} className="row-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 2 }}>
                  <div className="row between" style={{ width: '100%' }}><b>{r === 'doctor' ? 'Club Doctor' : r === 'physio' ? 'Physio' : 'Coach'}</b>{s ? <Stars n={s.level} /> : <span className="tiny dim">none</span>}</div>
                  <span className="tiny muted">{s ? `${s.name} · ${s.effect}` : r === 'doctor' ? 'More injuries, longer layoffs' : r === 'physio' ? 'Slower recovery between matches' : 'Slower training, 2 slots'}</span>
                </div>
              );
            })}
            <button className="cta small" onClick={() => go('store')}><span>Staff pack · 80 coins</span></button>
          </div>
          <div className="tiny muted" style={{ lineHeight: 1.5 }}>Fitness drops in every match, more with high pressing and fast tempo. Players recover about {d.recoveryPerDay}% a day. Starting tired players lowers the whole team, so rotate. Injury risk rises with tiredness and injury-prone players.</div>
        </section>
      </div>
    </div>
  );
}
