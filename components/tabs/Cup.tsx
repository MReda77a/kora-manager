'use client';
import { useEffect, useState } from 'react';
import { api, clock } from '../../lib/client.ts';
import { BackHead, Crest, Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

const seenKey = (lid: number, r: number) => `kora-cupdraw-${lid}-${r}`;

export default function CupTab({ lid }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [shown, setShown] = useState<number>(999); // how many draw slots are revealed for the newest round
  const [drawing, setDrawing] = useState(false);
  useEffect(() => { api(`/api/leagues/${lid}/cup`).then(setD); }, [lid]);
  const cup = d?.cup;
  const latest = cup ? cup.rounds.reduce((a: number, r: any, i: number) => (r.drawn ? i : a), -1) : -1;
  useEffect(() => {
    if (latest < 0) return;
    let seen = true;
    try { seen = !!localStorage.getItem(seenKey(lid, latest + 1)); } catch {}
    if (!seen) setShown(0);
  }, [latest, lid]);
  useEffect(() => {
    if (!drawing || !cup) return;
    const total = cup.rounds[latest].pairs.length * 2;
    if (shown >= total) {
      setDrawing(false);
      try { localStorage.setItem(seenKey(lid, latest + 1), '1'); } catch {}
      return;
    }
    const t = setTimeout(() => setShown((s) => s + 1), 750);
    return () => clearTimeout(t);
  }, [drawing, shown, cup, latest, lid]);
  if (!d) return <Spinner />;
  if (!cup) return <div className="col" style={{ gap: 8 }}><BackHead title="The Cup" /><div className="panel cut muted">The cup draw happens when the season starts.</div></div>;
  const club = (id: number) => d.clubs.find((c: any) => c.id === id);
  const fx = (r: number, h: number, a: number) => d.fixtures.find((f: any) => f.round === r && f.home_id === h && f.away_id === a);
  const pot = latest >= 0 ? cup.rounds[latest].pairs.flat().length - Math.min(shown, cup.rounds[latest].pairs.flat().length) : 0;
  const winner = cup.winner ? club(cup.winner) : null;
  const myOut = d.fixtures.some((f: any) => f.status === 'done' && (f.home_id === d.myClub || f.away_id === d.myClub) && f.winner_id !== d.myClub);
  return (
    <div className="theme-cup col" style={{ gap: 8, margin: '-8px -14px -16px', padding: '8px 14px 16px', minHeight: 'calc(100% + 24px)' }}>
      <BackHead title={cup.name.toUpperCase()} tag={<span className="tag" style={{ background: '#2FE6B0', color: '#0B2A33' }}><span>KNOCKOUT</span></span>}
        right={latest >= 0 && shown < cup.rounds[latest].pairs.length * 2 ? <><button className="seg on" onClick={() => setDrawing(true)} disabled={drawing}><span>{drawing ? 'Drawing…' : `Watch the ${cup.rounds[latest].name} draw`}</span></button><button className="seg" onClick={() => { setShown(999); try { localStorage.setItem(seenKey(lid, latest + 1), '1'); } catch {} }}><span>Skip</span></button></> : undefined} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 210px) minmax(0, 1fr)', gap: 12 }}>
        <section className="panel cut" style={{ alignItems: 'center', gap: 10 }}>
          <span className="kicker" style={{ alignSelf: 'flex-start' }}>The pot · {pot} left</span>
          <div style={{ position: 'relative', width: 150, height: 150, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.18), rgba(255,255,255,0.03) 60%)', border: '2px solid rgba(230,238,242,0.4)' }}>
            {Array.from({ length: Math.min(pot, 12) }).map((_, i) => (
              <span key={i} style={{ position: 'absolute', width: 26, height: 26, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #fff, #B9C6CF)', left: 20 + ((i * 37) % 100), top: 30 + ((i * 53) % 85), animation: drawing ? `beat ${0.5 + (i % 3) * 0.2}s infinite` : undefined }} />
            ))}
          </div>
          {winner ? (
            <div className="col" style={{ alignItems: 'center', gap: 2 }}><Trophy /><b style={{ color: '#2FE6B0' }}>{winner.name}</b><span className="tiny muted">Cup winners</span></div>
          ) : (
            <span className="tiny muted" style={{ textAlign: 'center' }}>{myOut ? 'You are out. Better luck next season.' : 'Draw after a draw at 90 minutes goes straight to penalties, taken in your order.'}</span>
          )}
        </section>
        <section className="panel cut" style={{ overflowX: 'auto' }}>
          <div className="row" style={{ gap: 12, alignItems: 'stretch', minWidth: cup.rounds.length * 190 }}>
            {cup.rounds.map((r: any, ri: number) => (
              <div key={ri} className="col" style={{ gap: 6, minWidth: 180, flex: 1, justifyContent: 'space-around' }}>
                <span className="kicker">{r.name}{r.day ? ` · day ${r.day}` : ''}</span>
                {!r.drawn && <span className="tiny muted">Draw after the previous round</span>}
                {r.drawn && r.pairs.map(([h, a]: [number, number], pi: number) => {
                  const f = fx(ri + 1, h, a);
                  const hide = ri === latest;
                  const showH = !hide || shown > pi * 2, showA = !hide || shown > pi * 2 + 1;
                  return (
                    <div key={pi} className="col" style={{ gap: 2 }}>
                      <Slot c={showH ? club(h) : null} score={f?.status === 'done' ? f.home_goals : null} win={f?.winner_id === h} me={h === d.myClub} home />
                      <Slot c={showA ? club(a) : null} score={f?.status === 'done' ? f.away_goals : null} win={f?.winner_id === a} me={a === d.myClub} />
                      {f && f.status !== 'done' && showA && <a href={`/m/${f.id}`} className="tiny" style={{ color: '#2FE6B0', fontWeight: 800 }}>{f.status === 'live' ? 'LIVE ›' : clock(f.kickoff_at)}</a>}
                    </div>
                  );
                })}
                {r.drawn && r.byes?.length > 0 && <span className="tiny muted">Byes: {r.byes.map((b: number) => club(b)?.short).join(', ')}</span>}
              </div>
            ))}
            <div className="col" style={{ alignItems: 'center', justifyContent: 'center', minWidth: 120, gap: 4 }}><Trophy /><span className="tiny" style={{ color: '#2FE6B0', fontWeight: 900 }}>Winner: 8M + trophy</span><span className="tiny muted">Each win +1M</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Slot({ c, score, win, me, home }: { c: any; score: number | null; win: boolean; me: boolean; home?: boolean }) {
  return (
    <div className="row small" style={{ gap: 6, height: 26, padding: '0 8px', background: me ? 'rgba(47,230,176,0.22)' : 'rgba(255,255,255,0.07)', fontWeight: 800, animation: c ? 'drop .5s both' : undefined, opacity: score != null && !win ? 0.55 : 1 }}>
      {c ? <Crest c1={c.color1} c2={c.color2} shape={c.shape} emblem={c.user_id ? c.emblem : -1} short={c.short} size={16} /> : <i style={{ width: 8, height: 8, transform: 'rotate(45deg)', background: 'rgba(255,255,255,0.3)', display: 'inline-block' }} />}
      <span className="grow ellipsis">{c ? c.name : '—'}</span>
      {home && c && score == null && <span className="tiny muted">HOME</span>}
      {score != null && <b style={{ color: win ? '#2FE6B0' : undefined }}>{score}</b>}
    </div>
  );
}

function Trophy() {
  return (
    <svg width="54" height="64" viewBox="0 0 54 64" aria-hidden="true">
      <path d="M14 4h26v14a13 13 0 01-26 0z" fill="#E6EEF2" /><path d="M14 8H6a9 9 0 009 12M40 8h8a9 9 0 01-9 12" fill="none" stroke="#E6EEF2" strokeWidth="3" />
      <rect x="24" y="30" width="6" height="14" fill="#B9C6CF" /><rect x="15" y="44" width="24" height="8" fill="#2FE6B0" /><rect x="12" y="52" width="30" height="6" fill="#E6EEF2" />
    </svg>
  );
}
