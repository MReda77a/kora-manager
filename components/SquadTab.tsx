'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/client.ts';
import { LINE } from '../lib/game.ts';
import { FitBar, PlayerCard, Spinner, useToast } from './ui.tsx';

const KEYS: Record<string, string[]> = {
  GK: ['Reflexes', 'Handling', 'OneOnOne', 'Distribution', 'Positioning', 'Composure'],
  DEF: ['Tackling', 'Marking', 'Heading', 'Pace', 'Strength', 'Passing'],
  MID: ['Passing', 'Vision', 'Dribbling', 'Tackling', 'Stamina', 'LongShots'],
  FWD: ['Finishing', 'Pace', 'Dribbling', 'Heading', 'Composure', 'Crossing'],
};

export default function SquadTab({ lid, window: win, toast }: { lid: number; window: { open: boolean; label: string }; toast: ReturnType<typeof useToast> }) {
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const [price, setPrice] = useState('');
  const load = () => api(`/api/leagues/${lid}/squad`).then((r) => { setD(r); setSel((s: any) => (s ? r.players.find((p: any) => p.id === s.id) : r.players[0])); });
  useEffect(() => { load(); }, [lid]);
  if (!d) return <Spinner />;
  const list = async () => {
    try {
      await api(`/api/leagues/${lid}/list`, { playerId: sel.id, price: Number(price) });
      toast.ok(`${sel.name} is on the market`);
      load();
    } catch (e: any) { toast.bad(e.message); }
  };
  const unlist = async () => {
    try {
      await api(`/api/leagues/${lid}/unlist`, { listingId: sel.listing.id });
      toast.ok('Removed from the market');
      load();
    } catch (e: any) { toast.bad(e.message); }
  };
  const groups = ['GK', 'DEF', 'MID', 'FWD'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(230px, 280px)', gap: 12 }}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row between"><span className="lz" style={{ fontSize: 22 }}>Squad · {d.players.length}</span><span className="small muted">Avg {(d.players.reduce((a: number, p: any) => a + p.ovr, 0) / Math.max(1, d.players.length)).toFixed(1)}</span></div>
        {groups.map((g) => {
          const ps = d.players.filter((p: any) => (LINE[p.pos] || 'MID') === g);
          if (!ps.length) return null;
          return (
            <div key={g} className="col" style={{ gap: 4 }}>
              <span className="tag"><span>{g === 'GK' ? 'Goalkeepers' : g === 'DEF' ? 'Defenders' : g === 'MID' ? 'Midfielders' : 'Forwards'} · {ps.length}</span></span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: 8 }}>
                {ps.map((p: any) => (
                  <div key={p.id} className="col" style={{ gap: 3 }}>
                    <PlayerCard p={p} onClick={() => setSel(p)} selected={sel?.id === p.id}
                      badge={p.outUntil >= d.nextMatchday ? <span style={{ background: '#FF6B7A', color: '#fff', fontSize: 9, fontWeight: 900, padding: '1px 4px' }}>{p.outReason === 'Suspended' ? 'SUS' : 'INJ'}</span> : p.listing ? <span style={{ background: '#7FE9F7', color: '#12204A', fontSize: 9, fontWeight: 900, padding: '1px 4px' }}>SALE</span> : null} />
                    <FitBar v={p.fitness} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {sel && (
        <div className="glass cut pad col" style={{ gap: 8, alignSelf: 'start', position: 'sticky', top: 0 }}>
          <div className="row" style={{ gap: 10 }}>
            <div style={{ width: 70 }}><PlayerCard p={sel} /></div>
            <div className="col grow" style={{ gap: 2 }}>
              <b style={{ fontSize: 15 }}>{sel.name}</b>
              <span className="tiny muted">{sel.pos} · {sel.age} yrs · {sel.foot === 'L' ? 'Left' : 'Right'} foot · {sel.nat}</span>
              <span className="tiny muted">Potential {sel.pot} · Value {sel.attrs?.v ?? '?'}M{sel.attrs?.Academy ? ' · Academy' : ''}</span>
              <div className="row tiny"><span className="muted">Fitness</span><FitBar v={sel.fitness} /><b>{sel.fitness}%</b></div>
            </div>
          </div>
          {sel.outUntil >= d.nextMatchday && <div className="small err">{sel.outReason}: out until matchday {sel.outUntil + 1}</div>}
          <div className="col" style={{ gap: 4 }}>
            {KEYS[LINE[sel.pos] || 'MID'].map((k) => (
              <div key={k} className="row tiny"><span style={{ width: 82 }} className="muted">{k}</span><div className="bar"><i style={{ width: `${sel.attrs?.[k] ?? 0}%`, background: (sel.attrs?.[k] ?? 0) >= 85 ? '#7CE3A1' : (sel.attrs?.[k] ?? 0) >= 70 ? '#7FE9F7' : '#B4A8E0' }} /></div><b style={{ width: 22, textAlign: 'right' }}>{sel.attrs?.[k]}</b></div>
            ))}
          </div>
          {sel.stats && <div className="tiny muted">{sel.stats.apps} apps · {sel.stats.goals} goals · {sel.stats.assists} assists · avg {(Number(sel.stats.rating_sum) / Math.max(1, sel.stats.apps)).toFixed(1)}</div>}
          <div className="col" style={{ gap: 6, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
            <span className="tiny muted">Transfer market · {win.label}</span>
            {sel.listing ? (
              <div className="row"><span className="small grow">Listed for <b>{Number(sel.listing.price).toFixed(1)}M</b></span><button className="ghost" onClick={unlist}><span>Remove</span></button></div>
            ) : (
              <div className="row">
                <input type="number" step="0.1" min="0.1" placeholder={`${sel.attrs?.v ?? 1}`} value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 90, height: 34 }} />
                <span className="small muted">M</span>
                <button className="cta small" disabled={!win.open || !price} onClick={list}><span>Sell</span></button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
