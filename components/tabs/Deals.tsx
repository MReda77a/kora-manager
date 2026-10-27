'use client';
// Every transfer in the league: who sold, who bought, for how much.
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { BackHead, Spinner } from '../ui.tsx';
import { ClubSheet } from '../ClubSheet.tsx';
import type { TabProps } from './types.ts';

const KIND: Record<string, { label: string; color: string }> = {
  buy: { label: 'Transfer', color: '#7FE9F7' }, loan: { label: 'Loan', color: '#C5B3FF' }, swap: { label: 'Swap', color: '#F2C14E' },
  abroad: { label: 'From abroad', color: '#7CE3A1' }, 'sold abroad': { label: 'Sold abroad', color: '#FF8A65' },
};
const money = (v: number) => (v <= 0 ? '–' : v >= 10 ? `${Math.round(v)}M` : `${v.toFixed(1)}M`);

export default function DealsTab({ lid, d }: TabProps) {
  const [v, setV] = useState<any>(null);
  const [who, setWho] = useState<'all' | 'mine' | 'managers'>('all');
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { api(`/api/leagues/${lid}/transfers`).then(setV); }, [lid]);
  if (!v) return <Spinner />;
  const me = d.club.id;
  const rows = v.rows.filter((r: any) => who === 'all' || (who === 'mine' ? r.from.id === me || r.to.id === me : r.from.human || r.to.human));
  const biggest = [...v.rows].sort((a: any, b: any) => b.fee - a.fee)[0];
  const spent = new Map<string, number>();
  for (const r of v.rows) if (r.to.id) spent.set(r.to.name, (spent.get(r.to.name) || 0) + r.fee);
  const topSpender = [...spent.entries()].sort((a, b) => b[1] - a[1])[0];
  const club = (c: any) => (
    <button className="row deal-club" onClick={() => c.id && setOpen(c.id)} disabled={!c.id} style={{ gap: 5, minWidth: 0 }}>
      <i style={{ width: 8, height: 8, flex: 'none', background: c.color || '#8A80B8', borderRadius: c.id ? 0 : '50%' }} />
      <span className="ellipsis" style={{ fontWeight: c.human ? 900 : 700, color: c.id === me ? '#7FE9F7' : undefined }}>{c.name}</span>
    </button>
  );
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Transfers" sub={<span className="small muted">Every deal in the league</span>} right={<>
        {(['all', 'mine', 'managers'] as const).map((k) => <button key={k} className={`seg ${who === k ? 'on' : ''}`} onClick={() => setWho(k)}><span>{k === 'all' ? 'All' : k === 'mine' ? 'Mine' : 'Managers'}</span></button>)}
      </>} />
      {v.rows.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="tag"><span>{v.rows.length} deals</span></span>
          {biggest && biggest.fee > 0 && <span className="tag gold"><span>Record: {biggest.player.name} {money(biggest.fee)}</span></span>}
          {topSpender && <span className="tag pink"><span>Big spender: {topSpender[0]} {money(topSpender[1])}</span></span>}
        </div>
      )}
      <div className="panel cut" style={{ padding: 6, gap: 2 }}>
        {rows.length === 0 && v.older.length === 0 && <span className="small muted" style={{ padding: 8 }}>No deals yet. They show up here as soon as anyone buys, sells, loans or swaps a player.</span>}
        {rows.map((r: any) => (
          <div key={r.id} className="deal-row">
            <span className="tiny muted deal-day">{r.day ? `Day ${r.day}` : 'Pre'}</span>
            <span className="col deal-player" style={{ gap: 0, minWidth: 0 }}>
              <b className="small ellipsis">{r.player.name}</b>
              <span className="tiny muted">{r.player.pos || ''}{r.player.ovr ? ` · ${r.player.ovr}` : ''}</span>
            </span>
            <span className="row deal-move small" style={{ gap: 6, minWidth: 0 }}>{club(r.from)}<span className="muted" aria-label="to">→</span>{club(r.to)}</span>
            <span className="tag deal-kind" style={{ height: 18, fontSize: 9, background: 'rgba(255,255,255,0.06)', color: KIND[r.kind]?.color }}><span>{KIND[r.kind]?.label || r.kind}</span></span>
            <b className="lz deal-fee" style={{ color: r.fee >= 20 ? '#F2C14E' : undefined }}>{money(r.fee)}</b>
          </div>
        ))}
        {who === 'all' && v.older.map((o: any, i: number) => <div key={`o${i}`} className="small muted" style={{ padding: '5px 8px' }}>{o.text}</div>)}
      </div>
      {open !== null && <ClubSheet lid={lid} clubId={open} myId={me} onClose={() => setOpen(null)} />}
    </div>
  );
}
