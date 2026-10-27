'use client';
// The match analyst's report on the next opponent, and the plan to beat them.
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { PRESETS } from '../../lib/game.ts';
import { BackHead, Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

const formColor = (r: string) => (r === 'W' ? '#7CE3A1' : r === 'L' ? '#FF8A80' : '#C9C0EC');

export default function AnalystTab({ lid, d, reload, toast, go }: TabProps) {
  const [a, setA] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = (refresh = false) => api(`/api/leagues/${lid}/analyst${refresh ? '?refresh=1' : ''}`).then(setA).catch((e) => toast.bad(e.message));
  useEffect(() => { load(); }, [lid]);
  if (!a) return <div className="col center" style={{ gap: 10, padding: 30 }}><Spinner /><span className="small muted">Your analyst is studying the opponent…</span></div>;
  const s = a.staff, r = a.report;
  const upgrade = async () => {
    setBusy(true);
    try { await api(`/api/leagues/${lid}/analyst`, {}); toast.ok('New analyst hired!'); setA(null); await load(true); reload(); } catch (e: any) { toast.bad(e.message); }
    setBusy(false);
  };
  const use = async (plan: string) => {
    const formation = d.club.tactic?.formation || '4-3-3';
    const { desc, ...vals } = PRESETS[plan] as any;
    void desc;
    try { await api(`/api/leagues/${lid}/setup`, { tactic: { ...d.club.tactic, preset: plan, formation, ...vals } }); toast.ok(`${plan} is your plan for the match`); reload(); load(); } catch (e: any) { toast.bad(e.message); }
  };
  const staffBox = (
    <div className="row wrap" style={{ gap: 8 }}>
      <span className="tag cyan"><span>Level {s.level} · {s.name}</span></span>
      {s.next && <button className="ghost small" disabled={busy} onClick={upgrade}><span>Hire {s.next.name} · {s.next.price}M</span></button>}
    </div>
  );
  if (!r) return <div className="col" style={{ gap: 10 }}><BackHead title="Match Analyst" right={staffBox} /><div className="panel cut small muted">No match coming up. Your analyst will be ready for the next one.</div></div>;
  const o = r.opponent;
  const numbers = r.plans[0]?.win !== null;
  return (
    <div className="col" style={{ gap: 10 }}>
      <BackHead title="Match Analyst" sub={<span className="small muted">vs <b style={{ color: '#F3EEFF' }}>{o.name}</b>{o.pos ? ` · ${o.pos}${['st', 'nd', 'rd'][o.pos - 1] || 'th'} in the table` : ''}{o.human ? ' · a manager' : ' · AI club'}</span>} right={staffBox} />
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: 12 }}>
        <section className="panel cut col" style={{ gap: 10 }}>
          <div className="row between">
            <span className="tag"><span>The opponent</span></span>
            <span className="row" style={{ gap: 3 }}>{(o.form || []).map((x: string, i: number) => <b key={i} className="tiny" style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', background: formColor(x), color: '#1B1048' }}>{x}</b>)}</span>
          </div>
          <div className="col" style={{ gap: 5 }}>
            <div className="row tiny muted" style={{ fontWeight: 900 }}><span style={{ width: 36 }} /><span className="grow">YOU</span><span>THEM</span></div>
            {r.lines.map((x: any) => {
              const diff = x.mine - x.theirs;
              return (
                <div key={x.line} className="row small" style={{ gap: 8, fontWeight: 800 }}>
                  <span style={{ width: 36 }} className="muted">{x.line}</span>
                  <b style={{ width: 24, color: diff >= 2 ? '#7CE3A1' : undefined }}>{x.mine}</b>
                  <div className="grow" style={{ display: 'flex', height: 8, background: 'rgba(255,255,255,0.08)' }}>
                    <i style={{ width: `${(x.mine / (x.mine + x.theirs || 1)) * 100}%`, background: diff >= 0 ? '#7FE9F7' : 'rgba(127,233,247,0.45)' }} />
                    <i style={{ flex: 1, background: diff < 0 ? '#FF8A80' : 'rgba(255,138,128,0.45)' }} />
                  </div>
                  <b style={{ width: 24, textAlign: 'right', color: diff <= -2 ? '#FF8A80' : undefined }}>{x.theirs}</b>
                </div>
              );
            })}
          </div>
          {r.weak.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="tiny" style={{ color: '#7CE3A1', fontWeight: 900 }}>WHERE THEY ARE WEAK</span>
              {r.weak.map((t: string, i: number) => <span key={i} className="small" style={{ fontWeight: 700 }}>✓ {t}</span>)}
            </div>
          )}
          {r.danger.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="tiny" style={{ color: '#FF8A80', fontWeight: 900 }}>WATCH OUT</span>
              {r.danger.map((t: string, i: number) => <span key={i} className="small" style={{ fontWeight: 700 }}>! {t}</span>)}
            </div>
          )}
          <div className="col" style={{ gap: 4 }}>
            <span className="tiny muted" style={{ fontWeight: 900 }}>WHAT THEY WILL PROBABLY PLAY</span>
            {r.likely.map((x: any) => (
              <div key={x.plan} className="row small" style={{ gap: 8, fontWeight: 800 }}><span style={{ width: 120 }}>{x.plan}</span><div className="grow" style={{ height: 6, background: 'rgba(255,255,255,0.08)' }}><i style={{ display: 'block', height: '100%', width: `${x.p}%`, background: '#F2C14E' }} /></div><b style={{ width: 36, textAlign: 'right' }}>{x.p}%</b></div>
            ))}
            <span className="tiny muted">{r.likelyNote}</span>
          </div>
        </section>
        <section className="panel cut col" style={{ gap: 10 }}>
          <div className="row between"><span className="tag gold"><span>The plan</span></span><span className="tiny" style={{ fontWeight: 900, color: r.confidence === 'High' ? '#7CE3A1' : r.confidence === 'Medium' ? '#F2C14E' : '#FF8A80' }}>CONFIDENCE: {r.confidence.toUpperCase()}</span></div>
          <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
            <div className="col grow" style={{ gap: 2, minWidth: 150 }}>
              <span className="tiny muted" style={{ fontWeight: 900 }}>BEST FOR YOU</span>
              <span className="lz" style={{ fontSize: 26, color: '#F2C14E', overflowWrap: 'anywhere' }}>{r.best}</span>
              <span className="tiny muted">{(PRESETS as any)[r.best]?.desc}</span>
            </div>
            {d.club.tactic?.preset === r.best ? <span className="tag cyan"><span>Already your plan</span></span> : <button className="cta" onClick={() => use(r.best)}><span>Use this plan</span></button>}
          </div>
          <div className="col" style={{ gap: 4 }}>
            <div className="row tiny muted" style={{ fontWeight: 900, gap: 8 }}><span style={{ width: 120 }}>PLAN</span><span className="grow">{numbers ? 'WIN · DRAW · LOSS (%)' : 'ROUGH RANKING'}</span></div>
            {r.plans.map((x: any, i: number) => (
              <button key={x.plan} className="row-item" style={{ gap: 8, fontWeight: 800, fontSize: 13, textAlign: 'left' }} onClick={() => use(x.plan)} title={`Use ${x.plan}`}>
                <span style={{ width: 120, color: i === 0 ? '#F2C14E' : x.plan === r.avoid ? '#FF8A80' : undefined }}>{x.plan}{d.club.tactic?.preset === x.plan ? ' •' : ''}</span>
                {numbers ? (
                  <>
                    <div className="grow" style={{ display: 'flex', height: 8 }}>
                      <i style={{ width: `${x.win}%`, background: '#7CE3A1' }} /><i style={{ width: `${x.draw}%`, background: '#C9C0EC' }} /><i style={{ width: `${x.loss}%`, background: '#FF8A80' }} />
                    </div>
                    <span className="tiny" style={{ width: 86, textAlign: 'right', whiteSpace: 'nowrap' }}><b style={{ color: '#7CE3A1' }}>{x.win}</b> · {x.draw} · <span style={{ color: '#FF8A80' }}>{x.loss}</span></span>
                  </>
                ) : <span className="grow tiny muted">{i === 0 ? 'Looks best' : 'Could work'}</span>}
              </button>
            ))}
          </div>
          <span className="small" style={{ fontWeight: 800 }}><b style={{ color: '#FF8A80' }}>Avoid:</b> {r.avoid}{r.myLast && r.myLast === r.avoid ? ' (you played it last time, and they are ready for it)' : ''}</span>
          {r.tip && <span className="small" style={{ fontWeight: 700, color: '#7FE9F7' }}>💡 {r.tip}</span>}
          {(r.style || []).map((t: string, i: number) => <span key={i} className="small" style={{ fontWeight: 700 }}>{t}</span>)}
          {!numbers && <span className="tiny muted">A part-time analyst only gives a rough guess and can be wrong. A Match analyst plays the game through hundreds of times first.</span>}
          <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
            <button className="ghost small" onClick={() => go('tactics')}><span>Open tactics</span></button>
            <button className="ghost small" onClick={() => { setA(null); load(true); }}><span>Study again</span></button>
          </div>
        </section>
      </div>
    </div>
  );
}
