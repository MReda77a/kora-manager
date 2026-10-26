'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { LINE } from '../../lib/game.ts';
import { Bar, BackHead, PlayerCard, Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

export default function MarketTab({ lid, toast, reload }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [pos, setPos] = useState('All');
  const [sort, setSort] = useState<'ovr' | 'pot' | 'price' | 'age'>('ovr');
  const [qs, setQs] = useState('');
  const [sel, setSel] = useState<any>(null);
  const load = () => api(`/api/leagues/${lid}/market`).then((r) => { setD(r); setSel((s: any) => (s ? r.listings.find((x: any) => x.listingId === s.listingId) ?? null : r.listings[0] ?? null)); });
  useEffect(() => { load(); }, [lid]);
  if (!d) return <Spinner />;
  const buy = async (l: any) => {
    try { await api(`/api/leagues/${lid}/buy`, { listingId: l.listingId }); toast.ok(`${l.name} joins your club!`); load(); reload(); } catch (e: any) { toast.bad(e.message); }
  };
  const rows = d.listings
    .filter((l: any) => pos === 'All' || (LINE[l.pos] || 'MID') === pos)
    .filter((l: any) => !qs || l.name.toLowerCase().includes(qs.toLowerCase()))
    .sort((a: any, b: any) => (sort === 'price' ? a.price - b.price : sort === 'age' ? a.age - b.age : b[sort] - a[sort]));
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Transfer Market" right={<div className="row" style={{ gap: 8, padding: '4px 14px', transform: 'skewX(-12deg)', border: '1px solid #F2C14E' }}><span className="tiny" style={{ transform: 'skewX(12deg)', fontWeight: 900, color: '#B4A8E0' }}>BUDGET</span><span className="lz" style={{ fontSize: 22, color: '#F2C14E', transform: 'skewX(12deg)' }}>{d.money.toFixed(1)}M</span></div>} />
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="tag" style={{ background: d.window.open ? '#7CE3A1' : '#FF6B7A', color: d.window.open ? '#0E3020' : '#fff' }}><span>{d.window.open ? `WINDOW OPEN · ${d.window.label}` : d.window.label.toUpperCase()}</span></span>
        <input placeholder="Search player…" value={qs} onChange={(e) => setQs(e.target.value)} style={{ width: 170, height: 30, transform: 'skewX(-12deg)' }} />
        {['All', 'GK', 'DEF', 'MID', 'FWD'].map((p) => <button key={p} className={`seg ${pos === p ? 'on' : ''}`} onClick={() => setPos(p)}><span>{p}</span></button>)}
        <span className="tiny muted" style={{ fontWeight: 900, marginLeft: 6 }}>SORT</span>
        {(['ovr', 'pot', 'price', 'age'] as const).map((s) => <button key={s} className={`seg ${sort === s ? 'on' : ''}`} onClick={() => setSort(s)}><span>{s.toUpperCase()}</span></button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 250px)', gap: 12 }}>
        <section className="panel cut" style={{ padding: 8, gap: 2 }}>
          <div className="row tiny" style={{ color: '#B4A8E0', fontWeight: 900, padding: '0 8px 4px', gap: 8 }}>
            <span style={{ width: 30 }}>OVR</span><span className="grow">PLAYER</span><span style={{ width: 36 }}>POS</span><span style={{ width: 30 }}>AGE</span><span style={{ width: 110 }}>SELLER</span><span style={{ width: 30 }}>POT</span><span style={{ width: 56, textAlign: 'right' }}>PRICE</span>
          </div>
          {rows.length === 0 && <div className="small muted" style={{ padding: 12 }}>No players listed. Only players other managers or AI clubs put up for sale appear here. Sell your own from the Squad screen.</div>}
          <div className="col" style={{ gap: 2, maxHeight: 300, overflowY: 'auto' }}>
            {rows.map((l: any) => (
              <button key={l.listingId} className={`row-item ${sel?.listingId === l.listingId ? 'sel' : ''}`} style={{ textAlign: 'left', fontWeight: 700, fontSize: 13 }} onClick={() => setSel(l)}>
                <span className="lz" style={{ width: 30, fontSize: 18, color: l.ovr >= 85 ? '#F2C14E' : undefined }}>{l.ovr}</span>
                <b className="grow ellipsis">{l.name}</b>
                <span style={{ width: 36 }} className="muted">{l.pos}</span>
                <span style={{ width: 30 }}>{l.age}</span>
                <span style={{ width: 110 }} className="ellipsis muted">{l.seller}{l.bot ? ' (AI)' : ''}</span>
                <span style={{ width: 30 }}>{l.pot}</span>
                <b style={{ width: 56, textAlign: 'right', color: '#7FE9F7' }}>{l.price.toFixed(1)}M</b>
              </button>
            ))}
          </div>
        </section>
        <aside className="panel cut" style={{ gap: 8 }}>
          {sel ? (
            <>
              <div className="row" style={{ gap: 10 }}><div style={{ width: 66 }}><PlayerCard p={sel} /></div><div className="col" style={{ gap: 1 }}><b>{sel.name}</b><span className="tiny muted">{sel.pos} · {sel.age} yrs · {sel.nat}</span><span className="tiny muted">Seller: {sel.seller}</span></div></div>
              {['Pace', 'Passing', 'Finishing', 'Tackling', 'Stamina'].map((k) => (
                <div key={k} className="row tiny" style={{ gap: 6 }}><span style={{ width: 62 }} className="muted">{k}</span><Bar v={sel.attrs?.[k] ?? 0} /><b style={{ width: 22, textAlign: 'right' }}>{sel.attrs?.[k]}</b></div>
              ))}
              <div className="row between"><span className="lz" style={{ fontSize: 26, color: '#7FE9F7' }}>{sel.price.toFixed(1)}M</span><span className="tiny muted">value ≈ {sel.attrs?.v}M</span></div>
              {sel.sellerId === d.myClub ? <span className="tag"><span>Your listing</span></span> : <button className="cta" disabled={!d.window.open || d.money < sel.price} onClick={() => buy(sel)}><span>{d.money < sel.price ? 'Not enough money' : 'Buy now'}</span></button>}
            </>
          ) : <span className="small muted">Pick a player to see details.</span>}
        </aside>
      </div>
    </div>
  );
}
