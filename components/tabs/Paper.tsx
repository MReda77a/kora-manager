'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

export default function PaperTab({ lid, d: ov, toast, go }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [idx, setIdx] = useState(-1); // -1 = preview of the next day
  const [text, setText] = useState('');
  const [tone, setTone] = useState('confident');
  const load = () => api(`/api/leagues/${lid}/paper`).then((r) => { setD(r); });
  useEffect(() => { load(); }, [lid]);
  if (!d) return <Spinner />;
  const ed = idx >= 0 ? d.editions[idx] : null;
  const pv = d.preview;
  const name = d.name || ov.league.poolName;
  const myDerby = pv?.fixtures.some((f: any) => f.derby && (f.home === ov.club.name || f.away === ov.club.name));
  const post = async () => {
    try { await api(`/api/leagues/${lid}/comment`, { text, tone: myDerby ? tone : undefined }); setText(''); toast.ok('Your words go to print'); load(); } catch (e: any) { toast.bad(e.message); }
  };
  const date = (s: string) => new Date(s).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between">
        <div className="row" style={{ gap: 6 }}>
          <button className={`seg ${idx === -1 ? 'on' : ''}`} onClick={() => setIdx(-1)} disabled={!pv}><span>Next matchday</span></button>
          {d.editions.slice(0, 6).map((e: any, i: number) => <button key={e.day} className={`seg ${idx === i ? 'on' : ''}`} onClick={() => setIdx(i)}><span>{e.label || `Day ${e.day}`}</span></button>)}
        </div>
        {d.potm?.[0] && <button className="seg" onClick={() => go('awards')}><span>Player of the Month ›</span></button>}
      </div>
      <article className="paper cut" style={{ padding: '14px 18px', position: 'relative' }}>
        <div className="row between" style={{ borderBottom: '3px double #1B1410', paddingBottom: 6 }}>
          <span className="kick" style={{ color: '#1B1410' }}>{ed ? (ed.kind === 'cup' ? 'CUP SPECIAL' : 'MATCHDAY REPORT') + ` · ${ed.label || ''}` : pv ? (pv.kind === 'cup' ? 'CUP PREVIEW' : pv.kind === 'break' ? 'MID-SEASON' : `PREVIEW · MATCHDAY ${pv.matchday}`) : ''}</span>
          <span style={{ fontSize: 26, fontWeight: 700 }}>{name}</span>
          <span className="kick" style={{ color: '#1B1410' }}>{date(ed ? ed.date : pv?.kickoff || new Date().toISOString())} · 1 COIN</span>
        </div>
        {ed ? (
          <>
            <h2 style={{ fontSize: 34, margin: '8px 0 2px', lineHeight: 1.05 }}>{ed.headline}</h2>
            {ed.sub && <p style={{ margin: '0 0 8px', fontFamily: 'Cairo, sans-serif', fontWeight: 700, color: '#5A4A3A' }}>{ed.sub}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 14, borderTop: '1px solid #1B1410', paddingTop: 8 }}>
              <div>
                <div className="kick">The managers spoke</div>
                {ed.comments?.length ? ed.comments.map((c: any, i: number) => (
                  <blockquote key={i} style={{ margin: '6px 0', padding: '6px 10px', borderLeft: `4px solid ${c.color1}`, background: 'rgba(0,0,0,0.05)' }}>
                    <div style={{ fontSize: 15 }}>“{c.text}”</div>
                    <div style={{ fontFamily: 'Cairo, sans-serif', fontSize: 11, fontWeight: 900 }}>{(c.username || '').toUpperCase()} · {c.club.toUpperCase()}{c.tone ? ` · ${c.tone.toUpperCase()}` : ''}</div>
                  </blockquote>
                )) : <p style={{ fontStyle: 'italic', color: '#6A5A4A' }}>No comments before this matchday.</p>}
              </div>
              <div>
                <div className="kick">Results</div>
                {ed.results?.map((r: any) => (
                  <div key={r.id} style={{ fontFamily: 'Cairo, sans-serif', fontWeight: 800, fontSize: 13, padding: '3px 0', borderBottom: '1px dotted #8A7A6A', background: r.derby ? 'rgba(242,193,78,0.35)' : undefined }}>
                    <a href={`/m/${r.id}`} style={{ color: '#1B1410' }}>{r.home} <b>{r.hg}–{r.ag}</b> {r.away}{r.pens ? ` (${r.pens.join('–')} pens)` : ''}</a>
                  </div>
                ))}
                {ed.top && <><div className="kick" style={{ marginTop: 8 }}>Top of the table</div>{ed.top.map((t: any, i: number) => <div key={i} style={{ fontFamily: 'Cairo, sans-serif', fontSize: 12, fontWeight: 800 }}>{i + 1}. {t.name} — {t.pts} pts</div>)}</>}
              </div>
              <div style={{ borderLeft: '1px solid #1B1410', paddingLeft: 12 }}>
                <div className="kick">Team of the Week</div>
                {ed.totw?.players?.map((p: any) => (
                  <div key={p.id} style={{ fontFamily: 'Cairo, sans-serif', fontSize: 12, fontWeight: 800, display: 'flex', justifyContent: 'space-between', color: p.id === ed.totw.star ? '#8B1E2D' : undefined }}>
                    <span>{p.line} · {p.name}</span><span>{p.r.toFixed(1)}</span>
                  </div>
                ))}
                {ed.totw && <button className="kick" style={{ marginTop: 6, color: '#8B1E2D' }} onClick={() => go('awards')}>See the full team ›</button>}
              </div>
            </div>
          </>
        ) : pv ? (
          <>
            <h2 style={{ fontSize: 32, margin: '8px 0 2px', lineHeight: 1.05 }}>{pv.fixtures.find((f: any) => f.derby) ? `Tonight, only one can rule ${pv.fixtures.find((f: any) => f.derby).home.split(' ')[0]}` : pv.kind === 'cup' ? 'Cup night: win or go home' : pv.kind === 'break' ? 'The window is open' : 'Matchday is coming'}</h2>
            {pv.fixtures.some((f: any) => f.derby) && <span style={{ position: 'absolute', right: 40, top: 70, transform: 'rotate(-8deg)', border: '3px solid #8B1E2D', color: '#8B1E2D', padding: '2px 10px', fontSize: 22, fontWeight: 700, animation: 'stamp .5s both' }}>DERBY</span>}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, borderTop: '1px solid #1B1410', paddingTop: 8, marginTop: 6 }}>
              <div>
                <div className="kick">The managers speak</div>
                {pv.comments.length ? pv.comments.map((c: any, i: number) => (
                  <blockquote key={i} style={{ margin: '6px 0', padding: '6px 10px', borderLeft: `4px solid ${c.color1}`, background: 'rgba(0,0,0,0.05)' }}>
                    <div style={{ fontSize: 15 }}>“{c.text}”</div>
                    <div style={{ fontFamily: 'Cairo, sans-serif', fontSize: 11, fontWeight: 900 }}>{(c.username || '').toUpperCase()} · {c.club.toUpperCase()}{c.tone ? ` · ${c.tone.toUpperCase()}` : ''}</div>
                  </blockquote>
                )) : <p style={{ fontStyle: 'italic', color: '#6A5A4A' }}>No manager has spoken yet. Be the first.</p>}
              </div>
              <div style={{ borderLeft: '1px solid #1B1410', paddingLeft: 12 }}>
                <div className="kick">On the card</div>
                {pv.fixtures.map((f: any) => <div key={f.id} style={{ fontFamily: 'Cairo, sans-serif', fontWeight: 800, fontSize: 13, padding: '2px 0', background: f.derby ? 'rgba(242,193,78,0.35)' : undefined }}>{f.home} v {f.away}</div>)}
                <div className="kick" style={{ marginTop: 10 }}>Your words</div>
                {myDerby && (
                  <div className="row" style={{ gap: 4, margin: '4px 0' }}>
                    {(['calm', 'confident', 'provocative'] as const).map((t) => <button key={t} onClick={() => setTone(t)} style={{ flex: 1, padding: '3px 0', fontFamily: 'Cairo', fontWeight: 900, fontSize: 11, background: tone === t ? '#1B1410' : 'transparent', color: tone === t ? '#F4ECDC' : '#1B1410', border: '1px solid #1B1410' }}>{t.toUpperCase()}</button>)}
                  </div>
                )}
                {myDerby && <div style={{ fontFamily: 'Cairo', fontSize: 11, fontWeight: 700, color: '#6A5A4A' }}>{tone === 'calm' ? 'Calm: no effect.' : tone === 'confident' ? 'Confident: your players +1 in the derby.' : 'Provocative: +2, but the derby gets dirtier.'}</div>}
                <div className="row" style={{ gap: 4, marginTop: 4 }}>
                  <input value={text} onChange={(e) => setText(e.target.value)} maxLength={160} placeholder="Say something…" style={{ background: '#fff', color: '#1B1410', borderColor: '#1B1410', height: 34, fontFamily: 'Cairo' }} />
                  <button onClick={post} disabled={text.trim().length < 2} style={{ background: '#1B1410', color: '#F4ECDC', padding: '0 12px', fontFamily: 'Cairo', fontWeight: 900, height: 34 }}>Post</button>
                </div>
              </div>
            </div>
          </>
        ) : <p>No edition yet.</p>}
      </article>
    </div>
  );
}
