'use client';
import { useState } from 'react';
import { api } from '../../lib/client.ts';
import { LINE, PACKS, STAFF_PACK, type PackKey } from '../../lib/game.ts';
import { Coin, PlayerCard, Stars } from '../ui.tsx';
import { useSquad } from './Lineup.tsx';
import type { TabProps } from './types.ts';

const LOOK: Record<string, { bg: string; icon: string; text: string }> = {
  legend: { bg: 'linear-gradient(160deg,#F2A65A,#E8438C)', icon: 'M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.4 6.7 19l1-5.8L3.5 9.2l5.9-.9z', text: '1 player · top 3.5% of the league' },
  gold: { bg: 'linear-gradient(160deg,#5FB6D9,#8E7BE0)', icon: 'M12 3l8 5v8l-8 5-8-5V8z', text: '3 players · strong first-teamers' },
  silver: { bg: 'linear-gradient(160deg,#C9C3F0,#8E85C9)', icon: 'M12 6a6 6 0 110 12 6 6 0 010-12z', text: '4 players · solid squad depth' },
  bronze: { bg: 'linear-gradient(160deg,#C98A5A,#8E5232)', icon: 'M7 7h10v10H7z', text: '5 players · fills squad gaps' },
  staff: { bg: 'linear-gradient(160deg,#7CE3A1,#7FE9F7)', icon: 'M12 4a4 4 0 110 8 4 4 0 010-8zM5 20a7 7 0 0114 0z', text: 'Doctor, physio or coach · 1–5★' },
};

export default function StoreTab({ lid, d: ov, reload, toast }: TabProps) {
  const { d, load } = useSquad(lid);
  const [opening, setOpening] = useState<{ key: string; players?: any[]; staff?: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const coins = ov.club.coins;
  const canOpen = ov.league.status === 'setup' || ov.window.open;
  const open = async (key: string) => {
    setBusy(true);
    try {
      const r = await api(`/api/leagues/${lid}/pack`, { pack: key });
      setOpening({ key, players: r.players, staff: r.staff });
      reload();
      load();
    } catch (e: any) { toast.bad(e.message); }
    setBusy(false);
  };
  const ps = d?.players || [];
  const count = (line: string) => ps.filter((p: any) => (LINE[p.natPos || p.pos] || 'MID') === line).length;
  const packs: [string, string, number][] = [...(Object.keys(PACKS) as PackKey[]).map((k) => [k, PACKS[k].name, PACKS[k].price] as [string, string, number]), ['staff', STAFF_PACK.name, STAFF_PACK.price]];
  return (
    <div className="col" style={{ gap: 8 }}>
      <header className="row between" style={{ minHeight: 48 }}>
        <div className="col" style={{ gap: 0 }}>
          <span className="lz" style={{ fontSize: 26, lineHeight: 1 }}>Pack Store</span>
          <span className="tiny muted" style={{ fontWeight: 700 }}>League pool: {ov.league.poolName} · every player has only one owner in your league</span>
        </div>
        <div className="row" style={{ gap: 8, padding: '6px 16px', transform: 'skewX(-12deg)', border: '1px solid #F2C14E', background: 'rgba(10,4,30,0.5)' }}>
          <span style={{ transform: 'skewX(12deg)' }} className="row"><Coin size={22} /><span className="lz" style={{ fontSize: 26, color: '#F2C14E', marginLeft: 6 }}>{coins}</span></span>
        </div>
      </header>
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(210px, 240px)', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 10 }}>
          {packs.map(([k, name, price]) => {
            const L = LOOK[k];
            return (
              <div key={k} className="panel cut" style={{ alignItems: 'center', textAlign: 'center', gap: 8, padding: '14px 10px', boxShadow: k === 'legend' ? 'inset 0 0 0 1px #F2C14E' : undefined }}>
                <div style={{ width: 62, height: 76, background: L.bg, clipPath: 'polygon(50% 0, 100% 18%, 100% 82%, 50% 100%, 0 82%, 0 18%)', display: 'grid', placeItems: 'center' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d={L.icon} fill="#1B1048" /></svg>
                </div>
                <span className="lz" style={{ fontSize: 22 }}>{name}</span>
                <span className="tiny" style={{ fontWeight: 800, minHeight: 30 }}>{L.text}</span>
                <button className="cta small" style={{ width: '100%', marginTop: 'auto' }} disabled={!canOpen || busy || coins < price} onClick={() => open(k)}>
                  <span className="row" style={{ gap: 6 }}><Coin size={14} />{price}</span>
                </button>
              </div>
            );
          })}
        </div>
        <aside className="panel cut" style={{ gap: 6 }}>
          <div className="row between"><span className="kicker">Your squad</span><span className="lz" style={{ fontSize: 22 }}>{ps.length} / 16</span></div>
          <div className="row" style={{ gap: 4 }}>
            {[['90+', ps.filter((p: any) => p.ovr >= 90).length, '#F2C14E'], ['80-89', ps.filter((p: any) => p.ovr >= 80 && p.ovr < 90).length, '#7FE9F7'], ['Best XI', ps.length >= 11 ? Math.round(ps.map((p: any) => p.ovr).sort((a: number, b: number) => b - a).slice(0, 11).reduce((a: number, b: number) => a + b, 0) / 11) : '—', '#F3EEFF']].map(([l, v, c]) => (
              <div key={String(l)} className="col grow" style={{ alignItems: 'center', gap: 0, padding: 6, background: 'rgba(255,255,255,0.06)' }}><span className="lz" style={{ fontSize: 20, color: String(c) }}>{v}</span><span className="tiny muted" style={{ fontWeight: 800 }}>{l}</span></div>
            ))}
          </div>
          {([['GK', 2], ['DEF', 5], ['MID', 5], ['FWD', 4]] as [string, number][]).map(([l, need]) => (
            <div key={l} className="row tiny" style={{ gap: 8, fontWeight: 900 }}><span style={{ width: 30 }}>{l}</span><div className="bar"><i style={{ width: `${Math.min(100, (count(l) / need) * 100)}%`, background: count(l) >= need ? '#7CE3A1' : '#E8438C' }} /></div><span style={{ width: 30, textAlign: 'right' }}>{count(l)}/{need}</span></div>
          ))}
          <div className="tiny muted" style={{ marginTop: 'auto' }}>{canOpen ? '1000 coins at the start. Go for stars, balance or depth. You earn coins from every match too.' : 'Packs open in pre-season and in the mid-season window.'}</div>
        </aside>
      </div>
      {opening && (
        <div className="overlay" onClick={() => setOpening(null)}>
          <div className="col" style={{ alignItems: 'center', gap: 14, width: '100%', maxWidth: 760 }}>
            <div className="lz" style={{ fontSize: 30, animation: 'pop .5s both' }}>{opening.key === 'staff' ? 'New staff member' : `${PACKS[opening.key as PackKey].name} pack`}</div>
            <div className="row center wrap" style={{ gap: 12, perspective: 800 }}>
              {opening.players?.map((p: any, i: number) => (
                <div key={p.id} style={{ width: 118, animation: `flipin .5s ${0.25 + i * 0.35}s both` }}>
                  <PlayerCard p={p} />
                  <div className="tiny" style={{ marginTop: 4, color: 'var(--soft)', textAlign: 'center', fontWeight: 800 }}>{p.name}</div>
                </div>
              ))}
              {opening.staff && (
                <div className="panel cut" style={{ alignItems: 'center', width: 220, animation: 'flipin .6s .2s both', background: 'linear-gradient(160deg,#7CE3A1,#5FB6D9)', color: '#0E3020' }}>
                  <span className="lz" style={{ fontSize: 24 }}>{opening.staff.role === 'doctor' ? 'Club Doctor' : opening.staff.role === 'physio' ? 'Physio' : 'Coach'}</span>
                  <b>{opening.staff.name}</b>
                  <span style={{ fontSize: 22 }}><Stars n={opening.staff.level} /></span>
                </div>
              )}
            </div>
            <button className="ghost"><span>Tap to close</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
