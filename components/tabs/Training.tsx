'use client';
import { useEffect, useState } from 'react';
import { api, when } from '../../lib/client.ts';
import { LINE } from '../../lib/game.ts';
import { BackHead, Bar, Spinner, Stars } from '../ui.tsx';
import type { TabProps } from './types.ts';

const SKILLS: Record<string, string[]> = {
  GK: ['Reflexes', 'Handling', 'OneOnOne', 'Composure'],
  DEF: ['Tackling', 'Marking', 'Heading', 'Pace', 'Passing', 'Stamina'],
  MID: ['Passing', 'Vision', 'Dribbling', 'Tackling', 'LongShots', 'Stamina'],
  FWD: ['Finishing', 'Pace', 'Dribbling', 'Heading', 'Composure', 'Crossing'],
};

export default function TrainingTab({ lid, toast }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<'attr' | 'pos'>('attr');
  const [target, setTarget] = useState<string | null>(null);
  const load = () => api(`/api/leagues/${lid}/training`).then((r) => { setD(r); setSel((s) => s ?? r.players[0]?.id ?? null); });
  useEffect(() => { load(); }, [lid]);
  if (!d) return <Spinner />;
  const p = d.players.find((x: any) => x.id === sel);
  const activeFor = (id: string) => d.active.find((t: any) => t.player_id === id);
  const line = p ? LINE[p.pos] || 'MID' : 'MID';
  const start = async () => {
    try { await api(`/api/leagues/${lid}/train`, { playerId: p.id, kind: mode, target }); toast.ok(`${p.name} started training`); setTarget(null); load(); } catch (e: any) { toast.bad(e.message); }
  };
  const cancel = async (id: number) => { await api(`/api/leagues/${lid}/untrain`, { id }); load(); };
  const cur = p && target && mode === 'attr' ? p.attrs[target] ?? 50 : 0;
  const gain = cur < 70 ? 3 : 2;
  const busy = p && activeFor(p.id);
  const sorted = [...d.players].sort((a: any, b: any) => Number(!!activeFor(b.id)) - Number(!!activeFor(a.id)) || b.ovr - a.ovr);
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Training" sub="Each player trains one thing: a skill or a new position" right={<span className="small muted" style={{ fontWeight: 700 }}>{d.active.length}/{d.slots} slots busy · Coach <Stars n={d.coach} /></span>} />
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 250px) minmax(0, 1fr)', gap: 12 }}>
        <section className="panel cut" style={{ padding: 6, gap: 2, maxHeight: 330, overflowY: 'auto' }}>
          {sorted.map((x: any) => {
            const t = activeFor(x.id);
            return (
              <button key={x.id} className={`row-item ${sel === x.id ? 'sel' : ''}`} style={{ textAlign: 'left' }} onClick={() => { setSel(x.id); setTarget(null); }}>
                <span className="col grow" style={{ gap: 0, minWidth: 0 }}><b className="small ellipsis">{x.name}</b><span className="tiny muted">{x.pos} · {x.age} yrs · {x.ovr}</span></span>
                {t && <span className="tag" style={{ height: 20, fontSize: 11, background: t.kind === 'pos' ? 'rgba(127,233,247,0.2)' : 'rgba(124,227,161,0.2)', color: t.kind === 'pos' ? '#7FE9F7' : '#7CE3A1' }}><span>{t.kind === 'pos' ? `Learning ${t.target}` : `${t.target} +${t.amount}`}</span></span>}
              </button>
            );
          })}
        </section>
        {p && (
          <section className="panel cut" style={{ gap: 10 }}>
            <div className="row between"><span className="lz" style={{ fontSize: 24 }}>{p.name}</span><span className="small muted" style={{ fontWeight: 800 }}>{p.pos}{p.natPos !== p.pos ? ` (natural ${p.natPos})` : ''} · Age {p.age} · Potential {p.pot}</span></div>
            {busy ? (
              <div className="col" style={{ gap: 8 }}>
                <div className="row-item sel" style={{ minHeight: 48 }}>
                  <span className="grow"><b>{busy.kind === 'pos' ? `Learning to play ${busy.target}` : `Improving ${busy.target} (+${busy.amount})`}</b><br /><span className="tiny muted">Ready {when(busy.ends_at)}</span></span>
                  <button className="seg" onClick={() => cancel(busy.id)}><span>Stop</span></button>
                </div>
                <Bar v={Math.min(100, ((Date.now() - new Date(busy.started_at).getTime()) / (new Date(busy.ends_at).getTime() - new Date(busy.started_at).getTime())) * 100)} color="#7CE3A1" h={8} />
              </div>
            ) : (
              <>
                <div className="segrow">
                  <button className={`seg ${mode === 'attr' ? 'on' : ''}`} style={{ minHeight: 40 }} onClick={() => { setMode('attr'); setTarget(null); }}><span>Improve a skill</span></button>
                  <button className={`seg ${mode === 'pos' ? 'on' : ''}`} style={{ minHeight: 40 }} onClick={() => { setMode('pos'); setTarget(null); }}><span>Learn a new position</span></button>
                </div>
                {mode === 'attr' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {SKILLS[line].map((k) => (
                      <button key={k} onClick={() => setTarget(k)} style={{ textAlign: 'left', padding: '6px 10px', background: target === k ? 'rgba(124,227,161,0.15)' : 'rgba(255,255,255,0.07)', boxShadow: target === k ? 'inset 0 0 0 2px #7CE3A1' : undefined }}>
                        <div className="tiny" style={{ fontWeight: 800 }}>{k}{p.boost?.[k] ? <span style={{ color: '#7CE3A1' }}> +{p.boost[k]}</span> : null}</div>
                        <div className="lz" style={{ fontSize: 22 }}>{p.attrs[k] ?? '–'}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="row wrap" style={{ gap: 6 }}>
                    {d.positions.filter((x: string) => x !== p.pos && (x === 'GK') === (p.natPos === 'GK')).map((x: string) => (
                      <button key={x} className={`seg ${target === x ? 'on' : ''}`} style={{ minWidth: 56 }} onClick={() => setTarget(x)}><span>{x}</span></button>
                    ))}
                  </div>
                )}
                {target && (
                  <div className="panel" style={{ background: 'rgba(10,4,30,0.35)', gap: 6 }}>
                    <div className="row between"><b>{mode === 'attr' ? target : `New position: ${target}`}</b>{mode === 'attr' && <span className="lz" style={{ fontSize: 22 }}>{cur} → <span style={{ color: '#7CE3A1' }}>{Math.min(99, cur + gain)}</span></span>}</div>
                    <span className="tiny muted">{mode === 'attr' ? `About ${Math.round(36 * (1 - d.coach * 0.1))} hours for +1 or +2. Up to +6 per skill each season.` : `About ${Math.round(72 * (1 - d.coach * 0.1))} hours. He then plays ${target} without the out-of-position penalty.`}</span>
                    <button className="cta small" onClick={start} disabled={d.active.length >= d.slots}><span>{d.active.length >= d.slots ? 'All slots busy' : 'Start training'}</span></button>
                  </div>
                )}
              </>
            )}
            {d.recent.length > 0 && <div className="tiny muted">Recently done: {d.recent.slice(0, 4).map((t: any) => `${d.players.find((x: any) => x.id === t.player_id)?.name?.split(' ').slice(-1)[0] ?? '?'} ${t.kind === 'pos' ? `→ ${t.target}` : `${t.target} +${t.amount}`}`).join(' · ')}</div>}
          </section>
        )}
      </div>
    </div>
  );
}
