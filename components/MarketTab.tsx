'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/client.ts';
import { PlayerCard, Spinner, useToast } from './ui.tsx';

export default function MarketTab({ lid, toast, reload }: { lid: number; toast: ReturnType<typeof useToast>; reload: () => void }) {
  const [d, setD] = useState<any>(null);
  const [pos, setPos] = useState('All');
  const load = () => api(`/api/leagues/${lid}/market`).then(setD);
  useEffect(() => { load(); }, [lid]);
  if (!d) return <Spinner />;
  const buy = async (l: any) => {
    if (!confirm(`Buy ${l.name} for ${l.price.toFixed(1)}M?`)) return;
    try {
      await api(`/api/leagues/${lid}/buy`, { listingId: l.listingId });
      toast.ok(`${l.name} joins your club!`);
      load();
      reload();
    } catch (e: any) { toast.bad(e.message); }
  };
  const POS = ['All', 'GK', 'DEF', 'MID', 'FWD'];
  const line = (p: string) => (p === 'GK' ? 'GK' : ['CB', 'LB', 'RB'].includes(p) ? 'DEF' : ['DM', 'CM', 'CAM'].includes(p) ? 'MID' : 'FWD');
  const rows = d.listings.filter((l: any) => pos === 'All' || line(l.pos) === pos);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row between wrap">
        <div className="row"><span className="lz" style={{ fontSize: 22 }}>Transfer market</span><span className={`tag ${d.window.open ? 'green' : 'pink'}`}><span>{d.window.label}</span></span></div>
        <div className="row">{POS.map((p) => <button key={p} className={`chip ${pos === p ? 'on' : ''}`} onClick={() => setPos(p)}><span>{p}</span></button>)}</div>
      </div>
      {!d.window.open && <div className="glass cut pad small muted">You can browse, but buying and selling only work in the pre-season window and at the halfway break.</div>}
      {rows.length === 0 && <div className="glass cut pad muted">No players listed yet. Only players other managers put up for sale appear here. List your own from the Squad tab.</div>}
      <div className="col" style={{ gap: 6 }}>
        {rows.map((l: any) => (
          <div key={l.listingId} className="glass row" style={{ padding: '6px 10px', gap: 10 }}>
            <div style={{ width: 46 }}><PlayerCard p={l} /></div>
            <div className="col grow" style={{ gap: 0 }}>
              <b className="ellipsis">{l.name}</b>
              <span className="tiny muted">{l.pos} · {l.age} yrs · seller {l.seller}{l.bot ? ' (AI)' : ''}</span>
            </div>
            <b className="lz" style={{ fontSize: 20, color: '#7FE9F7' }}>{l.price.toFixed(1)}M</b>
            {l.sellerId === d.myClub ? <span className="tag"><span>Yours</span></span> : (
              <button className="cta small" disabled={!d.window.open || d.money < l.price} onClick={() => buy(l)}><span>Buy</span></button>
            )}
          </div>
        ))}
      </div>
      <div className="tiny muted">Your budget: {d.money.toFixed(1)}M. You earn money from every match; Commercial clubs also get 0.1M per goal.</div>
    </div>
  );
}
