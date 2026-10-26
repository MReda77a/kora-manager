'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { LINE } from '../../lib/game.ts';
import { Bar, BackHead, PlayerCard, Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

function Listings({ lid, toast, reload }: TabProps) {
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
      <BackHead title="Transfer Market" tag={<MarketModes />} right={<div className="row" style={{ gap: 8, padding: '4px 14px', transform: 'skewX(-12deg)', border: '1px solid #F2C14E' }}><span className="tiny" style={{ transform: 'skewX(12deg)', fontWeight: 900, color: 'var(--muted)' }}>BUDGET</span><span className="lz" style={{ fontSize: 22, color: '#F2C14E', transform: 'skewX(12deg)' }}>{d.money.toFixed(1)}M</span></div>} />
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="tag" style={{ background: d.window.open ? '#7CE3A1' : 'var(--red)', color: d.window.open ? '#0E3020' : '#fff' }}><span>{d.window.open ? `WINDOW OPEN · ${d.window.label}` : d.window.label.toUpperCase()}</span></span>
        <input placeholder="Search player…" value={qs} onChange={(e) => setQs(e.target.value)} style={{ width: 170, height: 30, transform: 'skewX(-12deg)' }} />
        {['All', 'GK', 'DEF', 'MID', 'FWD'].map((p) => <button key={p} className={`seg ${pos === p ? 'on' : ''}`} onClick={() => setPos(p)}><span>{p}</span></button>)}
        <span className="tiny muted" style={{ fontWeight: 900, marginLeft: 6 }}>SORT</span>
        {(['ovr', 'pot', 'price', 'age'] as const).map((s) => <button key={s} className={`seg ${sort === s ? 'on' : ''}`} onClick={() => setSort(s)}><span>{s.toUpperCase()}</span></button>)}
      </div>
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 250px)', gap: 12 }}>
        <section className="panel cut" style={{ padding: 8, gap: 2 }}>
          <div className="row tiny" style={{ color: 'var(--muted)', fontWeight: 900, padding: '0 8px 4px', gap: 8 }}>
            <span style={{ width: 30 }}>OVR</span><span style={{ flex: '2 1 0', minWidth: 70 }}>PLAYER</span><span style={{ width: 36 }}>POS</span><span className="hide-sm" style={{ width: 30 }}>AGE</span><span className="hide-sm" style={{ width: 110 }}>SELLER</span><span className="hide-sm" style={{ width: 30 }}>POT</span><span style={{ width: 56, textAlign: 'right' }}>PRICE</span>
          </div>
          {rows.length === 0 && <div className="small muted" style={{ padding: 12 }}>No players listed. Only players other managers or AI clubs put up for sale appear here. Sell your own from the Squad screen.</div>}
          <div className="col" style={{ gap: 2, maxHeight: 300, overflowY: 'auto' }}>
            {rows.map((l: any) => (
              <button key={l.listingId} className={`row-item ${sel?.listingId === l.listingId ? 'sel' : ''}`} style={{ textAlign: 'left', fontWeight: 700, fontSize: 13 }} onClick={() => setSel(l)}>
                <span className="lz" style={{ width: 30, fontSize: 18, color: l.ovr >= 85 ? '#F2C14E' : undefined }}>{l.ovr}</span>
                <b className="ellipsis" style={{ flex: '2 1 0', minWidth: 70 }}>{l.name}</b>
                <span style={{ width: 36 }} className="muted">{l.pos}</span>
                <span className="hide-sm" style={{ width: 30 }}>{l.age}</span>
                <span style={{ width: 110 }} className="ellipsis muted hide-sm">{l.seller}{l.bot ? ' (AI)' : ''}</span>
                <span className="hide-sm" style={{ width: 30 }}>{l.pot}</span>
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

let setModeGlobal: (m: string) => void = () => {};
let modeGlobal = 'list';
let offersCount = 0;
function MarketModes() {
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {[['list', 'Listed'], ['offer', 'Make an offer'], ['inbox', `Offers${offersCount ? ` (${offersCount})` : ''}`]].map(([k, l]) => (
        <button key={k} className={`seg ${modeGlobal === k ? 'on' : ''}`} onClick={() => setModeGlobal(k)}><span>{l}</span></button>
      ))}
    </div>
  );
}

export default function MarketTab(props: TabProps) {
  const [mode, setMode] = useState(props.d.club.offers ? 'inbox' : 'list');
  setModeGlobal = setMode; modeGlobal = mode; offersCount = props.d.club.offers || 0;
  if (mode === 'offer') return <MakeOffer {...props} />;
  if (mode === 'inbox') return <OffersInbox {...props} />;
  return <Listings {...props} />;
}

const KIND_LABEL: Record<string, string> = { buy: 'Buy', loan: 'Loan', swap: 'Swap' };

// Offer for any player at another club: buy, season loan or swap. Bots answer at once; managers answer in their inbox.
function MakeOffer({ lid, toast, reload }: TabProps) {
  const [all, setAll] = useState<any[] | null>(null);
  const [mine, setMine] = useState<any[]>([]);
  const [win, setWin] = useState<any>(null);
  const [money, setMoney] = useState(0);
  const [qs, setQs] = useState('');
  const [pos, setPos] = useState('All');
  const [sel, setSel] = useState<any>(null);
  const [kind, setKind] = useState('buy');
  const [amount, setAmount] = useState('');
  const [swap, setSwap] = useState('');
  // a fair starting figure: the value for a buy, a small fee for a loan, the gap in value for a swap
  const suggest = (p: any, k: string, sw = swap) => {
    if (!p) return '';
    if (k === 'loan') return (Math.round(p.v * 2) / 10).toFixed(1);
    if (k === 'swap') { const m = mine.find((x) => x.id === sw); return Math.max(0, p.v - (Number(m?.attrs?.v) || 0)).toFixed(1); }
    return p.v.toFixed(1);
  };
  const [busy, setBusy] = useState(false);
  const load = () => {
    api(`/api/leagues/${lid}/players`).then(setAll);
    api(`/api/leagues/${lid}/squad`).then((r) => setMine(r.players.filter((p: any) => !p.loan)));
    api(`/api/leagues/${lid}/offers`).then((r) => { setWin(r.window); setMoney(r.money); });
  };
  useEffect(load, [lid]);
  if (!all || !win) return <Spinner />;
  const rows = all.filter((p) => (pos === 'All' || (LINE[p.pos] || 'MID') === pos) && (!qs || p.name.toLowerCase().includes(qs.toLowerCase()) || p.club.toLowerCase().includes(qs.toLowerCase()))).slice(0, 150);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/leagues/${lid}/offer`, { playerId: sel.id, kind, amount: Number(amount) || 0, swapPlayer: swap });
      (r.status === 'rejected' ? toast.bad : toast.ok)(r.text);
      if (r.status === 'accepted') { setSel(null); reload(); }
      load();
    } catch (e: any) { toast.bad(e.message); }
    setBusy(false);
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Transfer Market" tag={<MarketModes />} right={<span className="lz" style={{ fontSize: 22, color: '#F2C14E' }}>{money.toFixed(1)}M</span>} />
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="tag" style={{ background: win.open ? '#7CE3A1' : 'var(--red)', color: win.open ? '#0E3020' : '#fff' }}><span>{win.open ? `WINDOW OPEN · ${win.label}` : win.label.toUpperCase()}</span></span>
        <input placeholder="Player or club…" value={qs} onChange={(e) => setQs(e.target.value)} style={{ width: 170, height: 30, transform: 'skewX(-12deg)' }} />
        {['All', 'GK', 'DEF', 'MID', 'FWD'].map((p) => <button key={p} className={`seg ${pos === p ? 'on' : ''}`} onClick={() => setPos(p)}><span>{p}</span></button>)}
      </div>
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(230px, 270px)', gap: 12 }}>
        <section className="panel cut" style={{ padding: 8, gap: 2 }}>
          <div className="col" style={{ gap: 2, maxHeight: 330, overflowY: 'auto' }}>
            {rows.map((p) => (
              <button key={p.id} className={`row-item ${sel?.id === p.id ? 'sel' : ''}`} style={{ textAlign: 'left', fontWeight: 700, fontSize: 13 }} onClick={() => { setSel(p); setAmount(suggest(p, kind)); }}>
                <span className="lz" style={{ width: 30, fontSize: 18, color: p.ovr >= 85 ? '#F2C14E' : undefined }}>{p.ovr}</span>
                <b className="ellipsis" style={{ flex: '2 1 0', minWidth: 70 }}>{p.name}{p.request && <span className="tiny" style={{ color: 'var(--red)' }}> · wants out</span>}</b>
                <span style={{ width: 36 }} className="muted">{p.pos}</span>
                <span className="hide-sm" style={{ width: 28 }}>{p.age}</span>
                <span style={{ flex: '1.4 1 0', minWidth: 0, maxWidth: 140 }} className="ellipsis muted"><i style={{ display: 'inline-block', width: 7, height: 7, background: p.color1, transform: 'rotate(45deg)', marginRight: 5 }} />{p.club}{p.human ? '' : ' (AI)'}</span>
                <b style={{ width: 48, textAlign: 'right', color: '#7FE9F7' }}>{p.v.toFixed(1)}M</b>
              </button>
            ))}
          </div>
        </section>
        <aside className="panel cut" style={{ gap: 8 }}>
          {!sel ? <span className="small muted">Pick any player at another club. AI clubs answer straight away; managers answer from their inbox. Offers only work while the window is open.</span> : (
            <>
              <div className="col" style={{ gap: 1 }}><b>{sel.name}</b><span className="tiny muted">{sel.pos} · {sel.age} yrs · {sel.ovr} OVR · {sel.club}</span><span className="tiny muted">Value ≈ {sel.v.toFixed(1)}M{sel.loan ? ' · on loan (can not move)' : ''}</span></div>
              <div className="row" style={{ gap: 4 }}>{Object.entries(KIND_LABEL).map(([k, l]) => <button key={k} className={`seg ${kind === k ? 'on' : ''}`} onClick={() => { setKind(k); setAmount(suggest(sel, k)); }}><span>{l}</span></button>)}</div>
              {kind === 'swap' && (
                <select value={swap} onChange={(e) => { setSwap(e.target.value); setAmount(suggest(sel, 'swap', e.target.value)); }} style={{ height: 34 }}>
                  <option value="">Pick one of your players…</option>
                  {mine.map((p) => <option key={p.id} value={p.id}>{p.ovr} {p.pos} {p.name} · {Number(p.attrs?.v ?? 0).toFixed(1)}M</option>)}
                </select>
              )}
              <div className="row" style={{ gap: 6 }}>
                <span className="small muted" style={{ width: 70 }}>{kind === 'buy' ? 'Fee' : kind === 'loan' ? 'Loan fee' : 'Plus cash'}</span>
                <input type="number" step="0.1" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90, height: 34 }} /><span className="small muted">M</span>
              </div>
              <span className="tiny muted">{kind === 'loan' ? 'He plays for you until the end of the season, then goes back.' : kind === 'swap' ? 'Your player goes the other way.' : 'Key players cost more. Low offers get laughed at.'}</span>
              <button className="cta" disabled={busy || !win.open || sel.loan || (kind === 'swap' && !swap)} onClick={send}><span>Send offer</span></button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = { pending: '#F2C14E', countered: '#7FE9F7', accepted: '#7CE3A1', rejected: 'var(--red)', withdrawn: 'var(--dim)', expired: 'var(--dim)' };

function OffersInbox({ lid, toast, reload }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [counter, setCounter] = useState<Record<number, string>>({});
  const load = () => api(`/api/leagues/${lid}/offers`).then(setD);
  useEffect(() => { load(); }, [lid]);
  if (!d) return <Spinner />;
  const act = async (id: number, action: string, amount?: number) => {
    try { const r = await api(`/api/leagues/${lid}/respond`, { id, action, amount }); toast.ok(r.text); load(); reload(); } catch (e: any) { toast.bad(e.message); }
  };
  const what = (o: any) => `${KIND_LABEL[o.kind]}${o.kind === 'swap' ? ` for ${o.swap_name}` : ''}${Number(o.amount) ? ` · ${Number(o.amount).toFixed(1)}M` : ''}`;
  const Row = ({ o, incoming }: { o: any; incoming: boolean }) => (
    <div className="row-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row small" style={{ gap: 8, fontWeight: 800 }}>
        <i style={{ width: 8, height: 8, background: incoming ? o.from_color : o.to_color, transform: 'rotate(45deg)' }} />
        <span className="grow ellipsis">{o.player} <span className="tiny muted">{o.pos} {o.ovr}</span></span>
        <span className="tiny" style={{ color: STATUS_COLOR[o.status], fontWeight: 900 }}>{o.status.toUpperCase()}</span>
      </div>
      <span className="tiny muted">{incoming ? `From ${o.from_name}` : `To ${o.to_name}`} · {what(o)}{o.counter && o.status === 'countered' ? ` · they want ${Number(o.counter).toFixed(1)}M` : ''}{o.note && o.status !== 'pending' && o.status !== 'countered' ? ` · ${o.note}` : ''}</span>
      {incoming && o.status === 'pending' && (
        <div className="row" style={{ gap: 6 }}>
          <button className="seg on" onClick={() => act(o.id, 'accept')}><span>Accept</span></button>
          <button className="seg" onClick={() => act(o.id, 'reject')}><span>Reject</span></button>
          <input type="number" step="0.1" placeholder="Your price" value={counter[o.id] || ''} onChange={(e) => setCounter({ ...counter, [o.id]: e.target.value })} style={{ width: 90, height: 30 }} />
          <button className="seg" disabled={!counter[o.id]} onClick={() => act(o.id, 'counter', Number(counter[o.id]))}><span>Counter</span></button>
        </div>
      )}
      {!incoming && o.status === 'countered' && (
        <div className="row" style={{ gap: 6 }}>
          <button className="seg on" onClick={() => act(o.id, 'accept')}><span>Pay {Number(o.counter).toFixed(1)}M</span></button>
          <button className="seg" onClick={() => act(o.id, 'withdraw')}><span>Walk away</span></button>
        </div>
      )}
      {!incoming && o.status === 'pending' && <button className="seg" style={{ alignSelf: 'flex-start' }} onClick={() => act(o.id, 'withdraw')}><span>Withdraw</span></button>}
    </div>
  );
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Transfer Market" tag={<MarketModes />} right={<span className="lz" style={{ fontSize: 22, color: '#F2C14E' }}>{d.money.toFixed(1)}M</span>} />
      {d.deadline && <div className="lz" style={{ fontSize: 20, color: '#F2C14E', padding: '6px 12px', background: 'rgba(242,193,78,0.15)', animation: 'pulse 1.6s infinite' }}>⏰ DEADLINE DAY · the window shuts at the next kick-off</div>}
      {!d.window.open && <div className="small muted">{d.window.label}. Open offers expire when the window closes.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <section className="panel cut" style={{ gap: 4 }}>
          <span className="tag cyan" style={{ alignSelf: 'flex-start' }}><span>Offers for your players</span></span>
          {!d.incoming.length && <span className="small muted">Nobody has bid yet.</span>}
          {d.incoming.map((o: any) => <Row key={o.id} o={o} incoming />)}
        </section>
        <section className="panel cut" style={{ gap: 4 }}>
          <span className="tag" style={{ alignSelf: 'flex-start' }}><span>Your offers</span></span>
          {!d.outgoing.length && <span className="small muted">Make an offer for any player in the league.</span>}
          {d.outgoing.map((o: any) => <Row key={o.id} o={o} incoming={false} />)}
        </section>
      </div>
    </div>
  );
}
