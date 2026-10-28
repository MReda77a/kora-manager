'use client';
// Any club's squad, opened from the league table: keepers, defenders, midfielders and forwards,
// with ratings, ages, values, form this season and who is injured or for sale.
import { useEffect, useState } from 'react';
import { api } from '../lib/client.ts';
import { Crest, Spinner } from './ui.tsx';

const LINES: [string, string][] = [['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['FWD', 'Forwards']];
const money = (v: number) => (v >= 10 ? `${Math.round(v)}M` : `${v.toFixed(1)}M`);

export function ClubSheet({ lid, clubId, myId, onClose }: { lid: number; clubId: number; myId?: number; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setD(null); api(`/api/leagues/${lid}/clubview?club=${clubId}`).then(setD).catch((e) => setErr(e.message)); }, [lid, clubId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const c = d?.club;
  return (
    <div className="sheet-back" onClick={onClose} role="dialog" aria-label={c ? `${c.name} squad` : 'Club'}>
      <div className="sheet panel cut" onClick={(e) => e.stopPropagation()}>
        {!d ? (err ? <div className="err">{err}</div> : <Spinner />) : (
          <>
            <header className="row" style={{ gap: 10, alignItems: 'center' }}>
              <Crest c1={c.color1} c2={c.color2} shape={c.shape} emblem={c.human ? c.emblem : -1} short={c.short} size={44} />
              <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="lz ellipsis" style={{ fontSize: 22 }}>{c.name}{c.id === myId ? ' (you)' : ''}</span>
                <span className="tiny muted ellipsis">{c.human ? <>Manager <b style={{ color: '#5FD3F3' }}>{c.manager}</b></> : 'AI club'} · {c.type}{c.pos ? ` · ${c.pos}${['st', 'nd', 'rd'][c.pos - 1] || 'th'} with ${c.row.pts} pts` : ''} · {c.stadium}</span>
              </div>
              <button className="press-x" onClick={onClose} aria-label="Close">✕</button>
            </header>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="tag cyan"><span>Best XI {d.strength}</span></span>
              <span className="tag"><span>{d.players.length} players</span></span>
              <span className="tag gold"><span>Squad value {money(d.value)}</span></span>
              {c.row && <span className="tag"><span>{c.row.w}W {c.row.d}D {c.row.l}L · {c.row.gf}:{c.row.ga}</span></span>}
            </div>
            <div className="sheet-lines">
              {LINES.map(([ln, label]) => {
                const ps = d.players.filter((p: any) => p.line === ln);
                if (!ps.length) return null;
                return (
                  <section key={ln} className="col" style={{ gap: 3 }}>
                    <span className="kicker">{label} · {ps.length}</span>
                    {ps.map((p: any) => (
                      <div key={p.id} className="row small sheet-row" style={{ opacity: p.injured ? 0.6 : 1 }}>
                        <b className="lz" style={{ width: 30, fontSize: 18, color: p.ovr >= 85 ? '#F2C14E' : undefined }}>{p.ovr}</b>
                        <span className="tag" style={{ height: 18, fontSize: 10, minWidth: 34, justifyContent: 'center' }}><span>{p.pos}</span></span>
                        <span className="grow ellipsis" style={{ fontWeight: 800, minWidth: 0 }}>
                          {p.num ? <span className="muted tiny">#{p.num} </span> : null}{p.name}{p.captain ? ' ©' : ''}
                          {p.injured && <span style={{ color: '#FF8A80' }}> · ✚ {p.injured}</span>}
                          {p.listed !== null && <span style={{ color: '#2EE6A0' }}> · for sale {money(p.listed)}</span>}
                        </span>
                        <span className="tiny muted hide-sm" style={{ width: 92, textAlign: 'right' }}>{p.apps ? `${p.apps} apps · ${p.goals}G ${p.assists}A` : '–'}</span>
                        <span className="tiny" style={{ width: 30, textAlign: 'right', fontWeight: 900, color: p.rating === null ? 'var(--dim)' : p.rating >= 7 ? '#2EE6A0' : p.rating < 6.3 ? '#FF8A80' : undefined }}>{p.rating ?? '–'}</span>
                        <span className="tiny muted" style={{ width: 34, textAlign: 'right' }}>{p.age}y</span>
                        <span className="tiny" style={{ width: 40, textAlign: 'right', fontWeight: 800 }}>{money(p.v)}</span>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>
            <span className="tiny muted">Rating = average match rating this season. Tap outside to close.</span>
          </>
        )}
      </div>
    </div>
  );
}
