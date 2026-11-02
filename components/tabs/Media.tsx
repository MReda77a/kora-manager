'use client';
// Media: the matchday TV show (studio seen from behind the pundits, a video wall with the story of each
// segment, the line on a lower third) and the fans' social feed with a reply to the loudest post.
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { Crest, Spinner } from '../ui.tsx';
import { play } from '../../lib/sound.ts';
import type { TabProps } from './types.ts';

const WHO = { kareem: { name: 'KAREEM', role: 'THE CRITIC', c: '#F4C24E', ink: '#2A1A00' }, sami: { name: 'SAMI', role: 'THE CALM ONE', c: '#5FD3F3', ink: '#04202B' } } as const;

// the formation sketch on the wall for a style: arrows of how that plan attacks
const STYLE_ARROWS: Record<string, string[]> = {
  'Tiki-taka': ['M90 60 L130 45', 'M130 45 L170 60', 'M170 60 L210 48', 'M210 48 L250 62'],
  Gegenpress: ['M240 30 L210 50', 'M240 90 L210 70', 'M200 60 L250 60'],
  'Low block': ['M80 30 L80 90', 'M110 40 L110 80', 'M110 60 L270 60'],
  'Wing play': ['M120 18 L250 18', 'M250 18 L260 55', 'M120 102 L250 102', 'M250 102 L260 65'],
  'Long ball': ['M70 60 L260 50'],
  'Shoot on sight': ['M200 40 L285 58', 'M210 80 L285 62', 'M180 60 L285 60'],
};

function WallArt({ w }: { w: any }) {
  if (w.kind === 'result') return (
    <div className="tv-result">
      <div className="col" style={{ alignItems: 'center', gap: 4 }}><Crest c1={w.home.c1} c2={w.home.c2} shape={w.home.shape} emblem={w.home.emblem} short={w.home.short} size={48} /><b className="tiny ellipsis" style={{ maxWidth: 120 }}>{w.home.name}</b></div>
      <span className="lz" style={{ fontSize: 54, lineHeight: 1 }}>{w.score[0]} – {w.score[1]}</span>
      <div className="col" style={{ alignItems: 'center', gap: 4 }}><Crest c1={w.away.c1} c2={w.away.c2} shape={w.away.shape} emblem={w.away.emblem} short={w.away.short} size={48} /><b className="tiny ellipsis" style={{ maxWidth: 120 }}>{w.away.name}</b></div>
    </div>
  );
  if (w.kind === 'tactics') return (
    <div className="col" style={{ gap: 4, height: '100%' }}>
      <svg viewBox="0 0 300 120" className="tv-pitch" preserveAspectRatio="xMidYMid meet">
        <defs><marker id="tva" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#F4C24E" /></marker></defs>
        <rect x="2" y="2" width="296" height="116" rx="4" fill="#1E6842" stroke="rgba(255,255,255,.4)" />
        <line x1="150" y1="2" x2="150" y2="118" stroke="rgba(255,255,255,.4)" /><circle cx="150" cy="60" r="16" fill="none" stroke="rgba(255,255,255,.4)" />
        <rect x="2" y="32" width="26" height="56" fill="none" stroke="rgba(255,255,255,.4)" /><rect x="272" y="32" width="26" height="56" fill="none" stroke="rgba(255,255,255,.4)" />
        {(STYLE_ARROWS[w.preset] || []).map((d, i) => <path key={i} d={d} stroke="#F4C24E" strokeWidth={3} strokeDasharray="7 5" fill="none" markerEnd="url(#tva)"><animate attributeName="stroke-dashoffset" from="24" to="0" dur="1s" repeatCount="indefinite" /></path>)}
      </svg>
      <div className="row between small" style={{ fontWeight: 800 }}><span>{w.manager} · <b style={{ color: '#F4C24E' }}>{w.preset}</b></span><span>Beat it: <b style={{ color: 'var(--mint)' }}>{w.counter}</b> ({w.pct}%)</span></div>
    </div>
  );
  if (w.kind === 'board') return (
    <div className="col" style={{ gap: 4 }}>
      <span className="tiny" style={{ fontWeight: 900, color: '#9FB3C9', letterSpacing: 1 }}>{w.title}</span>
      {w.rows.map((r: any, i: number) => <div key={i} className="row between tv-row"><b>{r.name}</b><span className="row" style={{ gap: 3 }}>{r.note.split(' ').map((x: string, k: number) => <i key={k} className={`mgr-f ${x}`}>{x}</i>)}</span></div>)}
    </div>
  );
  if (w.kind === 'transfer') return (
    <div className="col" style={{ alignItems: 'center', gap: 6, justifyContent: 'center', height: '100%' }}>
      <span className="lz" style={{ fontSize: 34, lineHeight: 1 }}>{w.player}</span>
      <span className="small" style={{ fontWeight: 800 }}>{w.from} <span style={{ color: '#F4C24E' }}>→</span> {w.to}</span>
      <span className="lz" style={{ fontSize: 40, color: '#F4C24E', lineHeight: 1 }}>{w.fee >= 10 ? Math.round(w.fee) : w.fee.toFixed(1)}M</span>
    </div>
  );
  return (
    <div className="col" style={{ alignItems: 'center', justifyContent: 'center', gap: 6, height: '100%', textAlign: 'center', padding: '0 10px' }}>
      <span className="lz" style={{ fontSize: w.big.length > 40 ? 22 : 36, lineHeight: 1.05 }}>{w.big}</span>
      <span className="small muted" style={{ fontWeight: 800 }}>{w.small}</span>
    </div>
  );
}

export function TvTab({ lid }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [seg, setSeg] = useState(0);
  const [line, setLine] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => { api(`/api/leagues/${lid}/tv`).then(setD).catch(() => setD({ segments: [] })); }, [lid]);
  const S = d?.segments || [];
  const cur = S[seg];
  // the show plays on by itself: a line every few seconds, then the next segment
  useEffect(() => {
    if (!cur || !auto) return;
    const t = setTimeout(() => {
      if (line < cur.lines.length - 1) setLine(line + 1);
      else if (seg < S.length - 1) { setSeg(seg + 1); setLine(0); }
      else setAuto(false);
    }, 5200);
    return () => clearTimeout(t);
  }, [cur, line, seg, auto]);
  useEffect(() => { if (cur?.lines[line]?.who === 'kareem' && line === 0) play('press-laugh', { gain: 0.25 }); }, [seg]);
  if (!d) return <Spinner />;
  if (!S.length) return <div className="panel cut small muted">The first Matchday Show goes on air after the first round of matches.</div>;
  const L = cur.lines[line];
  const P = WHO[L.who as 'kareem' | 'sami'];
  const next = () => { setAuto(false); if (line < cur.lines.length - 1) setLine(line + 1); else if (seg < S.length - 1) { setSeg(seg + 1); setLine(0); } };
  const v = d.verdict;
  return (
    <div className="tv-wrap">
      <div className="col" style={{ gap: 6, minWidth: 0 }}>
        <div className="tv-studio" onClick={next} role="button" aria-label="Next line">
          <div className="tv-wall"><span className="tv-wall-label">{cur.wall.label || cur.title.toUpperCase()}</span><div className="tv-wall-in" key={seg}><WallArt w={cur.wall} /></div></div>
          {/* the two pundits, from behind, lit by the wall: the one speaking glows */}
          <svg className="tv-backs" viewBox="0 0 600 130" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
            <defs><linearGradient id="tvb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D3550" /><stop offset="1" stop-color="#050C17" /></linearGradient></defs>
            {[{ x: 120, who: 'sami' }, { x: 400, who: 'kareem' }].map((b) => {
              const on = L.who === b.who, c = WHO[b.who as 'kareem' | 'sami'].c;
              const d2 = `M${b.x} 130 C${b.x} 92 ${b.x + 26} 80 ${b.x + 50} 76 L${b.x + 52} 62 C${b.x + 38} 56 ${b.x + 34} 44 ${b.x + 35} 34 C${b.x + 36} 14 ${b.x + 50} 4 ${b.x + 64} 4 C${b.x + 80} 4 ${b.x + 92} 16 ${b.x + 91} 36 C${b.x + 91} 46 ${b.x + 85} 56 ${b.x + 76} 62 L${b.x + 78} 76 C${b.x + 104} 80 ${b.x + 128} 92 ${b.x + 128} 130 Z`;
              return <path key={b.who} d={d2} fill="url(#tvb)" stroke={c} strokeOpacity={on ? 1 : 0.25} strokeWidth={on ? 3 : 1.5} style={on ? { filter: `drop-shadow(0 0 10px ${c})` } : undefined} />;
            })}
          </svg>
          <div className="tv-l3" key={`${seg}-${line}`}>
            <div className="tv-l3-n" style={{ background: `linear-gradient(135deg, ${P.c}, color-mix(in srgb, ${P.c} 70%, #000))`, color: P.ink }}><b>{P.name}</b><span>{P.role}</span></div>
            <div className="tv-l3-t">{L.text}</div>
          </div>
          <div className="tv-ticker"><i>VAMOS TV</i><span>Matchday Show · tap to move on</span></div>
        </div>
        <div className="row tv-segs">
          {S.map((s: any, i: number) => <button key={s.key} className={`seg ${i === seg ? 'on' : ''}`} onClick={() => { setSeg(i); setLine(0); setAuto(false); }}><span>{i + 1} · {s.title}</span></button>)}
        </div>
      </div>
      <aside className="panel cut tv-side">
        <span className="kicker">The verdict on you</span>
        {v ? <>
          <b style={{ fontSize: 15, color: v.tone === 'praised' ? 'var(--mint)' : v.tone === 'mocked' ? '#FF8A80' : 'var(--soft)' }}>{v.tone === 'praised' ? 'PRAISED 👏' : v.tone === 'mocked' ? 'MOCKED 😬' : 'IGNORED 😐'}</b>
          <span className="small">{v.why}</span>
          <span className="tiny muted">{v.effect}</span>
        </> : <span className="small muted">You did not play this matchday.</span>}
        {d.hotSeat?.length > 0 && <>
          <span className="kicker" style={{ marginTop: 6 }}>Hot seat 🔥</span>
          {d.hotSeat.map((h: any, i: number) => <span key={i} className="small">{i + 1}. <b>{h.name}</b> <span className="muted">{h.note}</span></span>)}
        </>}
      </aside>
    </div>
  );
}

export function SocialTab({ lid, toast }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState<'mine' | 'league'>('mine');
  const load = () => api(`/api/leagues/${lid}/social`).then(setD);
  useEffect(() => { load(); }, [lid]);
  if (!d) return <Spinner />;
  const posts = view === 'mine' ? d.mine : d.league;
  const moodC = d.mood >= 60 ? 'var(--mint)' : d.mood >= 35 ? '#F2C14E' : '#FF5C6C';
  const reply = async (choice: string) => {
    try { const r = await api(`/api/leagues/${lid}/fans-reply`, { choice, line: d.want.find((w: any) => w.line)?.line }); toast.ok(r.note); load(); } catch (e: any) { toast.bad(e.message); }
  };
  return (
    <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 260px)', gap: 10 }}>
      <section className="panel cut" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 4 }}>
          <button className={`seg ${view === 'mine' ? 'on' : ''}`} onClick={() => setView('mine')}><span>Your fans</span></button>
          <button className={`seg ${view === 'league' ? 'on' : ''}`} onClick={() => setView('league')}><span>Whole league</span></button>
        </div>
        {!posts.length && <span className="small muted">Quiet so far. The fans start posting after the first matchday.</span>}
        <div className="col" style={{ gap: 5, overflowY: 'auto', maxHeight: 'calc(100dvh - 170px)' }}>
          {posts.map((p: any) => (
            <div key={p.id} className="fan-post">
              <span className="fan-av" style={{ background: p.color }}>{p.club[0]}</span>
              <div className="col" style={{ gap: 1, minWidth: 0 }}>
                <span className="tiny muted" style={{ fontWeight: 800 }}>{p.handle} · {p.club}</span>
                <span className="small" style={{ fontWeight: 700 }}>{p.text}</span>
                <span className="tiny muted" style={{ fontWeight: 800 }}>❤ {p.likes} {p.tag ? <b style={{ color: '#F2C14E', marginLeft: 8 }}>● {p.tag}</b> : null}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <aside className="panel cut" style={{ gap: 6 }}>
        <span className="kicker">Fan mood</span>
        <div className="fan-meter"><i style={{ left: `${d.mood}%` }} /></div>
        <b className="small" style={{ color: moodC }}>{d.mood >= 60 ? 'Happy' : d.mood >= 35 ? 'Restless' : 'Angry'} · {d.mood}</b>
        <span className="tiny muted">Wins, the TV verdict and how you answer them move it. It follows your board confidence.</span>
        {d.want.length > 0 && <>
          <span className="kicker" style={{ marginTop: 4 }}>The fans want</span>
          {d.want.map((w: any) => <span key={w.key} className="small" style={{ fontWeight: 700 }}>• {w.text}</span>)}
        </>}
        {d.replyTo && <>
          <span className="kicker" style={{ marginTop: 4 }}>Answer {d.replyTo.handle}</span>
          {d.replied ? <span className="small muted">You answered this matchday. Next chance after the next match.</span>
            : d.options.map((o: any) => <button key={o.key} className="seg fan-reply" title={o.note} onClick={() => reply(o.key)}><span>{o.text}<small>{o.note}</small></span></button>)}
        </>}
      </aside>
    </div>
  );
}
