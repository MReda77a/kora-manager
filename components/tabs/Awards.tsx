'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { BackHead, Spinner, lastName } from '../ui.tsx';
import { Pitch } from './Lineup.tsx';
import type { TabProps } from './types.ts';

// 4-3-3 spots for the Team of the Week
const SPOTS: Record<string, [number, number][]> = {
  GK: [[7, 50]], DEF: [[25, 14], [22, 38], [22, 62], [25, 86]], MID: [[47, 26], [44, 50], [47, 74]], FWD: [[72, 18], [77, 50], [72, 82]],
};

export default function AwardsTab({ lid }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState<'totw' | 'potm'>('totw');
  const [wk, setWk] = useState(0);
  const [reveal, setReveal] = useState(0);
  const [potmShown, setPotmShown] = useState(false);
  const [sel, setSel] = useState<any>(null);
  useEffect(() => { api(`/api/leagues/${lid}/awards`).then(setD); }, [lid]);
  useEffect(() => {
    if (!d || reveal >= 11) return;
    const t = setTimeout(() => setReveal((r) => r + 1), 220);
    return () => clearTimeout(t);
  }, [d, reveal, wk]);
  if (!d) return <Spinner />;
  const t = d.totw[wk];
  const team = t?.totw?.players || [];
  const star = team.find((p: any) => p.id === t?.totw?.star);
  const pick = sel || star;
  const potm = d.potm[0];
  const placed = (() => {
    const used: Record<string, number> = {};
    return team.map((p: any) => { const i = used[p.line] ?? 0; used[p.line] = i + 1; return { ...p, xy: SPOTS[p.line]?.[i] ?? [50, 50] }; });
  })();
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Awards"
        right={<>
          <button className={`seg ${view === 'totw' ? 'on' : ''}`} onClick={() => setView('totw')}><span>Team of the Week</span></button>
          <button className={`seg ${view === 'potm' ? 'on' : ''}`} onClick={() => setView('potm')}><span>Player of the Month</span></button>
          {view === 'totw' && <button className="ghost" onClick={() => setReveal(0)}><span>Replay reveal</span></button>}
        </>} />
      {view === 'totw' && (
        !t ? <div className="panel cut muted">The first Team of the Week comes after matchday 1.</div> : (
          <>
            <div className="row" style={{ gap: 4 }}>{d.totw.map((x: any, i: number) => <button key={x.day} className={`seg ${wk === i ? 'on' : ''}`} onClick={() => { setWk(i); setReveal(0); setSel(null); }}><span>{x.label}</span></button>)}</div>
            <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 240px)', gap: 12 }}>
              <Pitch style={{ minHeight: 280 }}>
                {placed.map((p: any, i: number) => {
                  const mine = p.clubId === d.myClub, isStar = p.id === t.totw.star;
                  if (i >= reveal) return null;
                  return (
                    <button key={p.id} className="pc" onClick={() => setSel(p)} style={{ left: `clamp(32px, ${p.xy[0]}%, calc(100% - 32px))`, top: `${p.xy[1]}%`, width: 'clamp(54px, 14%, 70px)', height: 'clamp(44px, 15%, 56px)', background: isStar ? 'linear-gradient(135deg,#FFE48A,#E0A22E)' : mine ? '#E8438C' : 'rgba(14,8,40,0.9)', color: isStar ? '#2A1A00' : undefined, animation: 'dropPc .45s both' }}>
                      <b style={{ fontSize: 'clamp(15px, 2.4vw, 22px)' }}>{p.r.toFixed(1)}</b><small>{lastName(p.name)}</small>
                    </button>
                  );
                })}
                <div className="row tiny" style={{ position: 'absolute', right: 14, top: 12, gap: 10, fontWeight: 800, zIndex: 3 }}>
                  <span className="row" style={{ gap: 4 }}><i style={{ width: 10, height: 10, background: '#E8438C', display: 'inline-block' }} />Your players</span>
                  <span className="row" style={{ gap: 4 }}><i style={{ width: 10, height: 10, background: '#F2C14E', display: 'inline-block' }} />Star of the week</span>
                </div>
              </Pitch>
              {pick && (
                <aside className="panel cut" style={{ gap: 6 }}>
                  <div className="row" style={{ gap: 10 }}><span className="lz" style={{ fontSize: 40, color: '#7FE9F7', lineHeight: 1 }}>{pick.r.toFixed(1)}</span><div className="col" style={{ gap: 0 }}><b className="lz" style={{ fontSize: 20 }}>{pick.name}</b><span className="tiny muted">{pick.pos} · {pick.club}</span></div></div>
                  {pick.id === t.totw.star && <b className="small">Star of the week.</b>}
                  <div className="row between small"><span>Goals</span><b>{pick.g}</b></div>
                  <div className="row between small"><span>Assists</span><b>{pick.a}</b></div>
                  <div className="small" style={{ padding: '6px 10px', background: 'rgba(127,233,247,0.12)' }}><b style={{ color: '#7CE3A1' }}>Effect:</b> “In form”: +2 rating for the next 2 days.</div>
                  <div className="small" style={{ padding: '6px 10px', background: 'rgba(232,67,140,0.18)' }}><b style={{ color: '#F29BC2' }}>Your club:</b> {team.filter((p: any) => p.clubId === d.myClub).length} players picked.</div>
                  <span className="tiny muted">Picked automatically: the best match rating in each position. Ratings count goals, assists, saves, clean sheets and the team result.</span>
                </aside>
              )}
            </div>
          </>
        )
      )}
      {view === 'potm' && (
        !potm ? <div className="panel cut muted">The first Player of the Month is picked after matchday 4.</div> : (
          <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(200px, 230px)', gap: 12 }}>
            <div className="col" style={{ gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${potm.nominees.length}, minmax(0, 1fr))`, gap: 8, width: '100%', position: 'relative' }}>
                {potm.nominees.map((n: any) => {
                  const win = n.id === potm.winner;
                  return (
                    <div key={n.id} className="col" style={{ minWidth: 0, transition: 'transform .5s, opacity .5s', transform: potmShown && win ? 'scale(1.08) translateY(-6px)' : undefined, opacity: potmShown && !win ? 0.45 : 1 }}>
                      <div className={`pcard ${potmShown && win ? 'legend' : 'holo'}`} style={{ aspectRatio: 'auto', minHeight: 120, padding: '8px 10px', clipPath: 'none' }}>
                        <div className="ovr" style={{ fontSize: 30 }}>{n.ovr ?? ''}</div><div className="pos">{n.pos}</div>
                        <div className="ellipsis" style={{ marginTop: 'auto', textAlign: 'center', fontWeight: 900 }}>{n.name}</div>
                        <div className="tiny" style={{ textAlign: 'center', fontWeight: 800, opacity: 0.8 }}>{n.club}</div>
                      </div>
                      <div className="col" style={{ gap: 0, background: 'rgba(14,8,40,0.85)', padding: '6px 10px', clipPath: 'polygon(0 0,100% 0,100% calc(100% - 14px),50% 100%,0 calc(100% - 14px))', paddingBottom: 18 }}>
                        {[['Goals', n.g], ['Assists', n.a], ['Avg rating', n.avg], ['Score', n.score]].map(([k, v]) => <div key={String(k)} className="row between tiny" style={{ fontWeight: 800 }}><span>{k}</span><b style={{ color: k === 'Score' ? '#F2C14E' : undefined }}>{v}</b></div>)}
                      </div>
                      {potmShown && win && <span className="lz" style={{ textAlign: 'center', color: '#F2C14E', fontSize: 20, animation: 'pop .5s both' }}>WINNER</span>}
                      {potmShown && !win && <span className="tiny" style={{ textAlign: 'center', color: '#FF9AA8', fontWeight: 800 }}>Upset: −2 for 2 days</span>}
                    </div>
                  );
                })}
                {potmShown && Array.from({ length: 26 }).map((_, i) => <span key={i} className="conf" style={{ left: `${(i * 37) % 100}%`, background: ['#FFE48A', '#E8438C', '#7FE9F7', '#F3EEFF', '#7CE3A1'][i % 5], animationDelay: `${(i * 0.06) % 0.8}s` }} />)}
              </div>
              {!potmShown && <button className="cta gold shine" onClick={() => setPotmShown(true)} style={{ minWidth: 220 }}><span>Reveal the winner</span></button>}
            </div>
            <aside className="panel cut" style={{ gap: 6 }}>
              <span className="kicker">What happens next</span>
              <span className="small">The winner gets a confidence boost: +3 rating for 4 days. Nominees who lose may sulk: their rating drops by 2 for 2 days, then recovers.</span>
              <span className="tiny muted" style={{ marginTop: 'auto' }}>Score = avg rating × 10 + goals × 2 + assists × 1.5 + team points × 0.8</span>
            </aside>
          </div>
        )
      )}
    </div>
  );
}
