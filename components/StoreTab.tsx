'use client';
import { useState } from 'react';
import { api } from '../lib/client.ts';
import { PACKS, type PackKey } from '../lib/game.ts';
import { Coin, PlayerCard, useToast, type P } from './ui.tsx';

const LOOK: Record<PackKey, { bg: string; ink: string; blurb: string }> = {
  legend: { bg: 'linear-gradient(135deg,#FFF0B0,#E8A93A 45%,#B5740F)', ink: '#2A1A00', blurb: '1 player from the top 3.5% of the league' },
  gold: { bg: 'linear-gradient(135deg,#F2C14E,#C98A1E)', ink: '#2A1A00', blurb: '3 strong first-team players' },
  silver: { bg: 'linear-gradient(135deg,#E6EEF2,#98A6B6)', ink: '#1B1048', blurb: '4 solid squad players' },
  bronze: { bg: 'linear-gradient(135deg,#E3A27A,#8E5232)', ink: '#2A1205', blurb: '5 depth players, always 1 keeper' },
};

export default function StoreTab({ lid, coins, canOpen, reload, toast }: { lid: number; coins: number; canOpen: boolean; reload: () => void; toast: ReturnType<typeof useToast> }) {
  const [opening, setOpening] = useState<{ key: PackKey; players: P[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async (key: PackKey) => {
    setBusy(true);
    try {
      const r = await api(`/api/leagues/${lid}/pack`, { pack: key });
      setOpening({ key, players: r.players });
      reload();
    } catch (e: any) {
      toast.bad(e.message);
    }
    setBusy(false);
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row between wrap">
        <div className="lz" style={{ fontSize: 22 }}>Pack store</div>
        <div className="small muted">{canOpen ? 'Packs only give players from this league. Nobody else sees what you pull.' : 'Packs open in pre-season and in the mid-season window.'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {(Object.keys(PACKS) as PackKey[]).map((k) => {
          const p = PACKS[k];
          const L = LOOK[k];
          return (
            <div key={k} className="cut col shine" style={{ position: 'relative', overflow: 'hidden', background: L.bg, color: L.ink, padding: 12, gap: 6, minHeight: 170 }}>
              <span className="lz" style={{ fontSize: 26 }}>{p.name}</span>
              <span className="small" style={{ fontWeight: 800 }}>{L.blurb}</span>
              <span className="lz" style={{ fontSize: 44, lineHeight: 1, opacity: 0.35, position: 'absolute', right: 10, top: 6 }}>{p.n}</span>
              <button className="cta small" style={{ marginTop: 'auto', background: '#1B1048', color: '#fff', boxShadow: 'none' }} disabled={!canOpen || busy || coins < p.price} onClick={() => open(k)}>
                <span className="row" style={{ gap: 6 }}><Coin size={14} />{p.price}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="small muted">Tip: 1000 coins can buy several Legend packs and fill the rest with Bronze, or skip legends and build a deep squad of Gold players. A squad needs at least 16 players and 2 keepers.</div>
      {opening && (
        <div className="overlay" onClick={() => setOpening(null)}>
          <div className="col" style={{ alignItems: 'center', gap: 14, width: '100%', maxWidth: 760 }}>
            <div className="lz" style={{ fontSize: 28, animation: 'pop .5s both' }}>{PACKS[opening.key].name} pack</div>
            <div className="row center wrap" style={{ gap: 12, perspective: 800 }}>
              {opening.players.map((p, i) => (
                <div key={p.id} style={{ width: 118, animation: `flipin .5s ${0.25 + i * 0.35}s both` }}>
                  <PlayerCard p={p} />
                  <div className="tiny center row" style={{ marginTop: 4, color: '#CFC6F0', textAlign: 'center' }}>{p.name}</div>
                </div>
              ))}
            </div>
            <button className="ghost"><span>Tap to close</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
