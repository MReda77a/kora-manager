'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { LINE } from '../../lib/game.ts';
import { BackHead, Bar, FitBar, PlayerCard, Spinner } from '../ui.tsx';
import { useSquad } from './Lineup.tsx';
import type { TabProps } from './types.ts';

const KEYS: Record<string, string[]> = {
  GK: ['Reflexes', 'Handling', 'OneOnOne', 'Distribution', 'Positioning', 'Composure'],
  DEF: ['Tackling', 'Marking', 'Heading', 'Pace', 'Strength', 'Passing'],
  MID: ['Passing', 'Vision', 'Dribbling', 'Tackling', 'Stamina', 'LongShots'],
  FWD: ['Finishing', 'Pace', 'Dribbling', 'Heading', 'Composure', 'Crossing'],
};

import { TRAITS } from '../../lib/game.ts';

const mood = (m: number) => (m >= 85 ? ['😁', '#7CE3A1', 'Delighted'] : m >= 65 ? ['🙂', '#7FE9F7', 'Content'] : m >= 40 ? ['😐', '#F2C14E', 'Restless'] : m >= 25 ? ['😠', '#FF8A80', 'Unhappy'] : ['🤬', 'var(--red)', 'Furious']);

export default function PlayersTab({ lid, d: ov, toast, go }: TabProps) {
  const { d, load } = useSquad(lid);
  const [sel, setSel] = useState<any>(null);
  const [price, setPrice] = useState('');
  useEffect(() => { if (d) setSel((s: any) => (s ? d.players.find((p: any) => p.id === s.id) : d.players[0])); }, [d]);
  if (!d) return <Spinner />;
  const win = ov.window;
  const list = async () => {
    try { await api(`/api/leagues/${lid}/list`, { playerId: sel.id, price: Number(price) }); toast.ok(`${sel.name} is on the market`); setPrice(''); load(); } catch (e: any) { toast.bad(e.message); }
  };
  const unlist = async () => {
    try { await api(`/api/leagues/${lid}/unlist`, { listingId: sel.listing.id }); toast.ok('Removed from the market'); load(); } catch (e: any) { toast.bad(e.message); }
  };
  const talk = async (kind: string) => {
    try { const r = await api(`/api/leagues/${lid}/talk`, { playerId: sel.id, kind }); toast.ok(r.text); load(); } catch (e: any) { toast.bad(e.message); }
  };
  const groups: [string, string][] = [['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['FWD', 'Forwards']];
  const avg = (d.players.reduce((a: number, p: any) => a + p.ovr, 0) / Math.max(1, d.players.length)).toFixed(1);
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Squad" sub={`${d.players.length} players · average ${avg}`} right={<button className="seg" onClick={() => go('training')}><span>Training ›</span></button>} />
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(230px, 280px)', gap: 12 }}>
        <div className="col" style={{ gap: 10 }}>
          {groups.map(([g, label]) => {
            const ps = d.players.filter((p: any) => (LINE[p.pos] || 'MID') === g);
            if (!ps.length) return null;
            return (
              <div key={g} className="col" style={{ gap: 5 }}>
                <span className="kicker">{label} · {ps.length}</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 8 }}>
                  {ps.map((p: any) => {
                    const out = p.outUntil >= d.nextDay;
                    return (
                      <button key={p.id} className="col" style={{ gap: 3, padding: 2, outline: sel?.id === p.id ? '2px solid #7FE9F7' : 'none', outlineOffset: 1, background: sel?.id === p.id ? 'rgba(127,233,247,0.12)' : undefined }} onClick={() => setSel(p)}>
                        <PlayerCard p={{ ...p, ovr: p.ovr + (p.form || 0) }} badge={p.request ? <span style={{ background: 'var(--red)', color: '#fff', fontSize: 11, fontWeight: 900, padding: '1px 4px' }}>WANTS OUT</span> : p.loan ? <span style={{ background: 'var(--muted)', color: '#1B1048', fontSize: 11, fontWeight: 900, padding: '1px 4px' }}>LOAN</span> : out ? <span style={{ background: 'var(--red)', color: '#fff', fontSize: 11, fontWeight: 900, padding: '1px 4px' }}>{p.outReason === 'Suspended' ? 'SUS' : 'INJ'}</span> : p.form > 0 ? <span style={{ background: '#7CE3A1', color: '#0E3020', fontSize: 11, fontWeight: 900, padding: '1px 4px' }}>+{p.form}</span> : p.form < 0 ? <span style={{ background: '#FF8A80', color: '#3A0A12', fontSize: 11, fontWeight: 900, padding: '1px 4px' }}>{p.form}</span> : p.listing ? <span style={{ background: '#7FE9F7', color: '#12204A', fontSize: 11, fontWeight: 900, padding: '1px 4px' }}>SALE</span> : null} />
                        <div className="row" style={{ gap: 3 }}><FitBar v={p.fitness} /><span title={`Morale ${p.morale}`} style={{ fontSize: 11, lineHeight: 1 }}>{mood(p.morale)[0]}</span></div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {sel && (
          <aside className="panel cut" style={{ alignSelf: 'start', position: 'sticky', top: 0 }}>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ width: 70 }}><PlayerCard p={sel} /></div>
              <div className="col grow" style={{ gap: 2 }}>
                <b style={{ fontSize: 15 }}>{sel.name}</b>
                <span className="tiny muted">{sel.pos}{sel.natPos !== sel.pos ? ` (was ${sel.natPos})` : ''} · {sel.age} yrs · {sel.foot === 'L' ? 'Left' : 'Right'} foot · {sel.nat}</span>
                <span className="tiny muted">Potential {sel.pot}{sel.ovrDelta ? <b style={{ color: sel.ovrDelta > 0 ? '#7CE3A1' : '#FF8A80' }}> · {sel.ovrDelta > 0 ? '+' : ''}{sel.ovrDelta} since signing</b> : null} · Value {sel.attrs?.v ?? '?'}M{sel.academy ? ' · Academy' : ''}</span>
                <div className="row tiny" style={{ gap: 6 }}><span className="muted">Fitness</span><FitBar v={sel.fitness} /><b>{sel.fitness}%</b></div>
              </div>
            </div>
            <div className="row" style={{ gap: 8, padding: '6px 8px', background: 'rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize: 22 }}>{mood(sel.morale)[0]}</span>
              <div className="col grow" style={{ gap: 2 }}>
                <div className="row tiny" style={{ gap: 6 }}><b style={{ color: mood(sel.morale)[1] }}>{mood(sel.morale)[2]}</b><Bar v={sel.morale} color={mood(sel.morale)[1]} h={6} /><b>{sel.morale}</b></div>
                <span className="tiny muted"><b style={{ color: '#F3EEFF' }}>{sel.trait}</b> · {TRAITS[sel.trait]}</span>
              </div>
            </div>
            {sel.request && <div className="small" style={{ color: 'var(--red)', fontWeight: 800 }}>He has asked to leave. Talk to him, play him, or sell him.</div>}
            {sel.loan && <div className="small" style={{ color: 'var(--muted)', fontWeight: 800 }}>On loan: he goes back to his club at the end of the season.</div>}
            <div className="row" style={{ gap: 6 }}>
              <button className="seg" onClick={() => talk('talk')}><span>Have a talk</span></button>
              <button className="seg" disabled={sel.promised} onClick={() => talk('promise')}><span>{sel.promised ? 'Games promised' : 'Promise games'}</span></button>
            </div>
            {sel.outUntil >= d.nextDay && <div className="small err">{sel.outReason}: back on day {sel.outUntil + 1}</div>}
            {sel.formNote && <div className="small" style={{ color: sel.form > 0 ? '#7CE3A1' : '#FF8A80', fontWeight: 800 }}>{sel.formNote}: {sel.form > 0 ? '+' : ''}{sel.form} rating for now</div>}
            <div className="col" style={{ gap: 4 }}>
              {KEYS[LINE[sel.pos] || 'MID'].map((k) => (
                <div key={k} className="row tiny" style={{ gap: 6 }}><span style={{ width: 82 }} className="muted">{k}</span><Bar v={sel.attrs?.[k] ?? 0} color={(sel.attrs?.[k] ?? 0) >= 85 ? '#7CE3A1' : (sel.attrs?.[k] ?? 0) >= 70 ? '#7FE9F7' : 'var(--muted)'} /><b style={{ width: 22, textAlign: 'right' }}>{sel.attrs?.[k]}</b></div>
              ))}
            </div>
            {sel.stats && <div className="tiny muted">{sel.stats.apps} apps · {sel.stats.goals} goals · {sel.stats.assists} assists · avg {(Number(sel.stats.rating_sum) / Math.max(1, sel.stats.apps)).toFixed(1)}</div>}
            <div className="col" style={{ gap: 6, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
              <span className="tiny muted">Transfer market · {win.label}</span>
              {sel.listing ? (
                <div className="row"><span className="small grow">Listed for <b>{Number(sel.listing.price).toFixed(1)}M</b></span><button className="ghost" onClick={unlist}><span>Remove</span></button></div>
              ) : (
                <div className="row" style={{ gap: 6 }}>
                  <input type="number" step="0.1" min="0.1" placeholder={`${sel.attrs?.v ?? 1}`} value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 90, height: 34 }} />
                  <span className="small muted">M</span>
                  <button className="cta small" disabled={!win.open || !price || sel.loan} onClick={list}><span>Sell</span></button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
