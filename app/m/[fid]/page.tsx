'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { api, clock, when } from '../../../lib/client.ts';
import { FORMATIONS } from '../../../lib/game.ts';
import { Crest, Icon, Spinner } from '../../../components/ui.tsx';

// A watched match lasts at most two real minutes at 1x.
const REAL_SECONDS = 110;

export default function MatchPage({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = use(params);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = () => api(`/api/fixtures/${fid}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [fid]);
  useEffect(() => {
    if (!d || d.fixture.status === 'done') return;
    const ms = new Date(d.fixture.kickoff).getTime() - Date.now();
    const t = setTimeout(load, ms < 0 ? 1200 : Math.min(ms + 1500, 60_000));
    return () => clearTimeout(t);
  }, [d]);
  if (err) return <div className="pad err">{err}</div>;
  if (!d) return <Spinner />;
  if (d.fixture.status !== 'done' || !d.report) return <PreMatch d={d} />;
  return <Watch d={d} />;
}

function TopBar({ d }: { d: any }) {
  return (
    <a href={`/l/${d.fixture.leagueId}`} className="row small" style={{ color: '#CFC6F0', fontWeight: 800, position: 'absolute', top: 10, left: 12, zIndex: 5 }}>
      <Icon name="back" size={18} /> League
    </a>
  );
}

function Team({ c, size = 64, align = 'center' }: { c: any; size?: number; align?: 'center' | 'flex-start' | 'flex-end' }) {
  return (
    <div className="col" style={{ alignItems: align, gap: 2, minWidth: 0 }}>
      <Crest c1={c.color1} c2={c.color2} size={size} shape={c.shape} emblem={c.human ? c.emblem : -1} short={c.short} />
      <span className="lz ellipsis" style={{ fontSize: 18, maxWidth: '100%', color: c.mine ? '#7FE9F7' : undefined }}>{c.name}</span>
      {c.human ? <span className="tag cyan" style={{ height: 16, fontSize: 9 }}><span>MANAGER</span></span> : <span className="tiny dim">AI club</span>}
    </div>
  );
}

function PreMatch({ d }: { d: any }) {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  const gold = d.derby;
  const mine = d.home.mine || d.away.mine;
  return (
    <div style={{ minHeight: '100dvh', position: 'relative', padding: '40px 16px 16px', background: gold ? 'radial-gradient(70% 90% at 50% 0%, rgba(242,193,78,0.3), transparent 70%)' : undefined }}>
      <TopBar d={d} />
      <div className="col" style={{ alignItems: 'center', gap: 10 }}>
        <span className={`tag ${gold ? 'gold' : 'pink'}`}><span>{gold ? 'DERBY DAY · NILE CLASICO' : `Matchday ${d.fixture.matchday}`}</span></span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16, width: '100%', maxWidth: 640 }}>
          <Team c={d.home} />
          <div className="col" style={{ alignItems: 'center', gap: 2 }}>
            <span className="lz" style={{ fontSize: 40, color: gold ? '#F2C14E' : undefined }}>VS</span>
            <span className="small muted">{clock(d.fixture.kickoff)}</span>
            <b className="lz" style={{ fontSize: 20, color: '#7FE9F7' }}>{when(d.fixture.kickoff)}</b>
          </div>
          <Team c={d.away} />
        </div>
        <div className="small muted">{d.home.stadium}</div>
        {mine ? (
          <div className="glass cut pad col" style={{ maxWidth: 520, gap: 8, alignItems: 'center', textAlign: 'center' }}>
            <div className="small">Set your line-up, game plan, penalty takers and assistant rules before kick-off. The match plays itself at kick-off time; come back to watch it (2 minutes) or skip to the result.</div>
            <a className={`cta ${gold ? 'gold' : ''}`} href={`/l/${d.fixture.leagueId}`} onClick={() => { try { sessionStorage.setItem(`kora-tab-${d.fixture.leagueId}`, 'tactics'); } catch {} }}><span>Set tactics</span></a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const fmtMin = (m: number) => (m > 90 ? `90+${m - 90}'` : `${m}'`);

type Ev = { m: number; type: string; side: 0 | 1; text: string; pid?: string; pid2?: string };

function Watch({ d }: { d: any }) {
  const rep = d.report;
  const events: Ev[] = rep.events;
  const kickMs = new Date(d.fixture.kickoff).getTime();
  const liveOffset = (Date.now() - kickMs) / 1000; // seconds since kick-off
  const isLive = liveOffset >= 0 && liveOffset < REAL_SECONDS;
  const [phase, setPhase] = useState<'intro' | 'play' | 'ft'>(isLive ? 'play' : 'intro');
  const [gm, setGm] = useState(isLive ? (liveOffset / REAL_SECONDS) * 90 : 0); // game minute 0..90 (float)
  const [speed, setSpeed] = useState(1);
  const [fx, setFx] = useState<Ev | null>(null);
  const shown = useRef(0);
  const side = d.home.mine ? 0 : d.away.mine ? 1 : -1;

  // event order: their index in the array; reveal when the clock passes their minute
  const revealed = useMemo(() => {
    let k = 0;
    for (; k < events.length; k++) {
      const e = events[k];
      const at = e.type === 'ft' ? 90 : e.type === 'ht' ? 45.01 : e.m > 90 ? 89 + (e.m - 90) * 0.15 : e.m;
      if (at > gm) break;
    }
    return k;
  }, [gm, events]);

  useEffect(() => {
    if (phase !== 'play') return;
    const step = 0.2; // seconds per tick
    const i = setInterval(() => setGm((g) => Math.min(90, g + (90 / REAL_SECONDS) * step * speed)), step * 1000);
    return () => clearInterval(i);
  }, [phase, speed]);

  useEffect(() => {
    if (phase !== 'play') return;
    if (revealed > shown.current) {
      const fresh = events.slice(shown.current, revealed);
      shown.current = revealed;
      const big = [...fresh].reverse().find((e) => ['goal', 'red', 'penalty', 'penmiss', 'injury', 'yellow', 'sub', 'ht', 'save'].includes(e.type));
      if (big) setFx(big);
    }
    if (gm >= 90) setTimeout(() => setPhase('ft'), 1200);
  }, [revealed, gm, phase, events]);

  useEffect(() => {
    if (!fx) return;
    const t = setTimeout(() => setFx(null), fx.type === 'goal' ? 2600 : 1600);
    return () => clearTimeout(t);
  }, [fx]);

  const score = [0, 0];
  events.slice(0, phase === 'ft' ? events.length : revealed).forEach((e) => { if (e.type === 'goal') score[e.side]++; });
  const gold = d.derby;
  const minute = Math.min(90, Math.floor(gm));

  if (phase === 'intro') {
    return (
      <div style={{ minHeight: '100dvh', position: 'relative', padding: '40px 16px 16px', background: gold ? 'radial-gradient(70% 90% at 50% 0%, rgba(242,193,78,0.3), transparent 70%)' : undefined }}>
        <TopBar d={d} />
        <div className="col" style={{ alignItems: 'center', gap: 14 }}>
          <span className={`tag ${gold ? 'gold' : 'pink'}`}><span>{gold ? 'DERBY DAY' : `Matchday ${d.fixture.matchday}`} · Full time</span></span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16, width: '100%', maxWidth: 640 }}>
            <Team c={d.home} /><span className="lz" style={{ fontSize: 40 }}>VS</span><Team c={d.away} />
          </div>
          <div className="row">
            <button className={`cta shine ${gold ? 'gold' : ''}`} onClick={() => setPhase('play')}><span className="row" style={{ gap: 6 }}><Icon name="play" size={16} />Watch (2 min)</span></button>
            <button className="ghost" onClick={() => { setGm(90); setPhase('ft'); }}><span>Skip to result</span></button>
          </div>
          <div className="tiny muted">No spoilers: the score stays hidden until you watch or skip.</div>
        </div>
      </div>
    );
  }
  if (phase === 'ft') return <FullTime d={d} />;

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', padding: '8px 12px', gap: 8, position: 'relative', overflow: 'hidden' }}>
      <div className="row" style={{ gap: 10 }}>
        <a href={`/l/${d.fixture.leagueId}`} aria-label="Back"><Icon name="back" size={20} color="#CFC6F0" /></a>
        <div className="glass row grow" style={{ padding: '4px 12px', gap: 10, background: gold ? 'linear-gradient(90deg, rgba(242,193,78,0.25), rgba(242,193,78,0.06))' : undefined }}>
          <Crest c1={d.home.color1} c2={d.home.color2} size={26} shape={d.home.shape} emblem={d.home.human ? d.home.emblem : -1} short={d.home.short} />
          <b className="ellipsis grow" style={{ textAlign: 'right' }}>{d.home.name}</b>
          <span className="lz" style={{ fontSize: 30, minWidth: 74, textAlign: 'center', color: gold ? '#F2C14E' : undefined }}>{score[0]} – {score[1]}</span>
          <b className="ellipsis grow">{d.away.name}</b>
          <Crest c1={d.away.color1} c2={d.away.color2} size={26} shape={d.away.shape} emblem={d.away.human ? d.away.emblem : -1} short={d.away.short} />
        </div>
        <span className="lz" style={{ fontSize: 22, width: 46, textAlign: 'center', color: '#7FE9F7' }}>{minute}&apos;</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(190px, 240px)', gap: 10 }}>
        <Pitch d={d} gm={gm} events={events} revealed={revealed} />
        <div className="glass col" style={{ padding: 8, gap: 4, overflowY: 'auto', minHeight: 0 }}>
          {events.slice(0, revealed).slice().reverse().map((e, i) => (
            <div key={revealed - i} className="row tiny" style={{ gap: 6, alignItems: 'flex-start', animation: i === 0 ? 'slidein .4s both' : undefined, color: e.type === 'goal' ? '#F3EEFF' : '#CFC6F0', fontWeight: e.type === 'goal' ? 900 : 700 }}>
              <b style={{ width: 34, color: '#7FE9F7', flex: 'none' }}>{fmtMin(e.m)}</b>
              <span style={{ width: 8, height: 8, marginTop: 4, flex: 'none', background: ['kickoff', 'ht', 'ft'].includes(e.type) ? '#F3EEFF' : e.side === 0 ? d.home.color1 : d.away.color1 }} />
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="row between">
        <div className="row">{[1, 2, 4].map((s) => <button key={s} className={`chip ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}><span>{s}x</span></button>)}</div>
        <span className="tiny muted">{isLive ? 'LIVE · in sync with kick-off' : 'Replay'} · your assistant handles subs and changes</span>
        <button className="ghost" onClick={() => { setGm(90); setPhase('ft'); }}><span>Skip</span></button>
      </div>
      {fx && <FxOverlay e={fx} d={d} mineSide={side} />}
    </div>
  );
}

function FxOverlay({ e, d, mineSide }: { e: Ev; d: any; mineSide: number }) {
  const team = e.side === 0 ? d.home : d.away;
  let title = '', color = '#F3EEFF', bg = 'rgba(10,4,30,0.55)';
  if (e.type === 'goal') {
    const forMe = mineSide === e.side, againstMe = mineSide >= 0 && mineSide !== e.side;
    title = 'GOAL!';
    color = againstMe ? '#FF9AA8' : '#F2C14E';
    bg = forMe ? 'radial-gradient(circle, rgba(242,193,78,0.45), rgba(10,4,30,0.6))' : againstMe ? 'radial-gradient(circle, rgba(255,107,122,0.35), rgba(10,4,30,0.65))' : 'radial-gradient(circle, rgba(232,67,140,0.4), rgba(10,4,30,0.6))';
  } else if (e.type === 'red') { title = 'RED CARD'; color = '#FF6B7A'; }
  else if (e.type === 'yellow') { title = 'YELLOW CARD'; color = '#F2C14E'; }
  else if (e.type === 'penalty') { title = 'PENALTY!'; color = '#7FE9F7'; }
  else if (e.type === 'penmiss') { title = 'NO GOAL'; color = '#CFC6F0'; }
  else if (e.type === 'injury') { title = 'INJURY'; color = '#FF9AA8'; }
  else if (e.type === 'sub') { title = 'SUBSTITUTION'; color = '#7CE3A1'; }
  else if (e.type === 'save') { title = 'WHAT A SAVE'; color = '#7FE9F7'; }
  else if (e.type === 'ht') { title = 'HALF-TIME'; color = '#F3EEFF'; }
  const small = ['yellow', 'sub', 'save', 'injury'].includes(e.type);
  return (
    <div style={{ position: 'absolute', inset: small ? 'auto 0 56px 0' : 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', background: small ? undefined : bg, animation: 'flash 2.6s both' }}>
      <div className="col" style={{ alignItems: 'center', gap: 4, animation: 'pop .5s both', padding: small ? '6px 18px' : 0, background: small ? 'rgba(10,4,30,0.8)' : undefined }}>
        {e.type === 'yellow' || e.type === 'red' ? <div style={{ width: small ? 18 : 46, height: small ? 26 : 64, background: e.type === 'red' ? '#FF4757' : '#F2C14E', transform: 'rotate(-8deg)', borderRadius: 3 }} /> : null}
        <span className="lz" style={{ fontSize: small ? 22 : 72, color, textShadow: '0 4px 24px rgba(0,0,0,0.5)', lineHeight: 1 }}>{title}</span>
        <span className="small" style={{ fontWeight: 800, textAlign: 'center' }}>{e.text}</span>
        {e.type === 'goal' && <span className="tiny" style={{ color: '#CFC6F0' }}>{team.name} · the crowd goes wild</span>}
      </div>
    </div>
  );
}

// Moving dots: both teams shift with an imaginary ball that leans toward whoever attacks next.
function Pitch({ d, gm, events, revealed }: { d: any; gm: number; events: Ev[]; revealed: number }) {
  const rep = d.report;
  const fh = FORMATIONS[rep.lineups?.[0]?.formation || '4-3-3'];
  const fa = FORMATIONS[rep.lineups?.[1]?.formation || '4-3-3'];
  const next = events.slice(revealed).find((e) => ['goal', 'save', 'miss', 'penalty', 'penmiss'].includes(e.type));
  const t = gm * 7.3;
  let push = Math.sin(t * 0.21) * 0.45 + Math.sin(t * 0.077) * 0.35; // -1 home deep .. +1 home attacking
  if (next && next.m - gm < 2.2 && next.m >= gm) push = next.side === 0 ? 0.95 : -0.95;
  const bx = 50 + push * 38 + Math.sin(t * 0.9) * 4;
  const by = 50 + Math.sin(t * 0.53) * 28 + Math.cos(t * 0.31) * 8;
  const dot = (x: number, y: number, c: string, k: string, ring: string) => (
    <span key={k} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: '50%', background: c, boxShadow: `0 0 0 2px ${ring}`, transition: 'left .25s linear, top .25s linear' }} />
  );
  return (
    <div className="pitch" style={{ width: '100%', height: '100%', minHeight: 160 }}>
      <div className="box" style={{ left: 0, borderLeft: 'none' }} />
      <div className="box" style={{ right: 0, borderRight: 'none' }} />
      {fh.xy.map(([x, y], i) => {
        const shift = i === 0 ? 0 : push * 14 + (bx - 50) * 0.08;
        const yy = y + (by - y) * (i === 0 ? 0.05 : 0.12) + Math.sin(t * 0.4 + i) * 1.5;
        return dot(Math.max(3, Math.min(97, x * 0.9 + 3 + shift)), yy, d.home.color1, `h${i}`, '#F3EEFF');
      })}
      {fa.xy.map(([x, y], i) => {
        const shift = i === 0 ? 0 : push * 14 + (bx - 50) * 0.08;
        const yy = 100 - y + (by - (100 - y)) * (i === 0 ? 0.05 : 0.12) + Math.cos(t * 0.4 + i) * 1.5;
        return dot(Math.max(3, Math.min(97, 100 - (x * 0.9 + 3) + shift)), yy, d.away.color1, `a${i}`, '#151018');
      })}
      <span style={{ position: 'absolute', left: `${bx}%`, top: `${by}%`, width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5, borderRadius: '50%', background: '#fff', boxShadow: '0 0 8px #fff', transition: 'left .2s linear, top .2s linear' }} />
    </div>
  );
}

function FullTime({ d }: { d: any }) {
  const rep = d.report;
  const s = rep.stats;
  const [hg, ag] = rep.score;
  const mine = d.home.mine ? 0 : d.away.mine ? 1 : -1;
  const res = mine < 0 ? null : rep.score[mine] > rep.score[1 - mine] ? 'WIN' : rep.score[mine] === rep.score[1 - mine] ? 'DRAW' : 'LOSS';
  const motm = rep.players.find((p: any) => p.id === rep.motm);
  const name = (id?: string) => (id ? d.names[id]?.name || '' : '');
  const key = rep.events.filter((e: Ev) => ['goal', 'red', 'penmiss', 'injury', 'sub'].includes(e.type));
  const bars: [string, number, number, (v: number) => string][] = [
    ['Possession', s.poss[0], s.poss[1], (v) => `${v}%`], ['Shots', s.shots[0], s.shots[1], String], ['On target', s.onTarget[0], s.onTarget[1], String],
    ['xG', s.xg[0], s.xg[1], (v) => v.toFixed(2)], ['Corners', s.corners[0], s.corners[1], String], ['Yellow cards', s.yellows[0], s.yellows[1], String],
  ];
  const ratings = (side: 0 | 1) => rep.players.filter((p: any) => p.side === side && p.mins > 0).sort((a: any, b: any) => b.r - a.r);
  return (
    <div style={{ minHeight: '100dvh', padding: '10px 14px 20px', position: 'relative' }}>
      <div className="row between">
        <a href={`/l/${d.fixture.leagueId}`} className="row small" style={{ color: '#CFC6F0', fontWeight: 800 }}><Icon name="back" size={18} /> League</a>
        <span className={`tag ${d.derby ? 'gold' : res === 'WIN' ? 'green' : res === 'LOSS' ? 'pink' : ''}`}><span>{res ? `FULL TIME · ${res}` : 'FULL TIME'}</span></span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, margin: '8px auto', maxWidth: 640 }} className="rise">
        <Team c={d.home} size={52} />
        <span className="lz" style={{ fontSize: 48, color: d.derby ? '#F2C14E' : undefined, animation: 'pop .6s both' }}>{hg} – {ag}</span>
        <Team c={d.away} size={52} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        <div className="glass cut pad col" style={{ gap: 4 }}>
          <span className="tag pink"><span>Key moments</span></span>
          {key.length === 0 && <span className="small muted">A quiet one.</span>}
          {key.map((e: Ev, i: number) => (
            <div key={i} className="row tiny" style={{ gap: 6, justifyContent: e.side === 0 ? 'flex-start' : 'flex-end', textAlign: e.side === 0 ? 'left' : 'right' }}>
              {e.side === 0 && <b style={{ color: '#7FE9F7' }}>{fmtMin(e.m)}</b>}
              <span className="ellipsis">{e.type === 'goal' ? '⚽ ' : e.type === 'red' ? '🟥 ' : e.type === 'sub' ? '⇄ ' : e.type === 'injury' ? '✚ ' : '✗ '}{e.type === 'goal' ? name(e.pid) : e.type === 'sub' ? `${name(e.pid)} for ${name(e.pid2)}` : name(e.pid)}{e.type === 'sub' && <span className="tag" style={{ height: 14, fontSize: 8, marginLeft: 4 }}><span>AST</span></span>}</span>
              {e.side === 1 && <b style={{ color: '#7FE9F7' }}>{fmtMin(e.m)}</b>}
            </div>
          ))}
        </div>
        <div className="glass cut pad col" style={{ gap: 6 }}>
          <span className="tag cyan"><span>Stats</span></span>
          {bars.map(([l, a, b, f]) => (
            <div key={l} className="col" style={{ gap: 2 }}>
              <div className="row tiny between"><b>{f(a)}</b><span className="muted">{l}</span><b>{f(b)}</b></div>
              <div className="row" style={{ gap: 3 }}>
                <div className="bar" style={{ direction: 'rtl' }}><i style={{ width: `${(a / Math.max(0.01, a + b)) * 100}%`, background: d.home.color1 }} /></div>
                <div className="bar"><i style={{ width: `${(b / Math.max(0.01, a + b)) * 100}%`, background: d.away.color1 }} /></div>
              </div>
            </div>
          ))}
        </div>
        <div className="glass cut pad col" style={{ gap: 4 }}>
          {motm && (
            <div className="row" style={{ gap: 8, padding: '4px 8px', background: 'rgba(242,193,78,0.15)' }}>
              <span className="tag gold"><span>Man of the match</span></span>
              <b className="grow ellipsis">{name(motm.id)}</b><b className="lz" style={{ fontSize: 20, color: '#F2C14E' }}>{motm.r.toFixed(1)}</b>
            </div>
          )}
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            {[0, 1].map((sd) => (
              <div key={sd} className="col grow" style={{ gap: 1, minWidth: 0 }}>
                <span className="tiny dim">{(sd ? d.away : d.home).short} ratings</span>
                {ratings(sd as 0 | 1).slice(0, 14).map((p: any) => (
                  <div key={p.id} className="row tiny" style={{ gap: 4 }}>
                    <span className="grow ellipsis">{name(p.id).split(' ').slice(-1)[0]}{p.g ? ` ⚽${p.g > 1 ? p.g : ''}` : ''}{p.inj ? ' ✚' : ''}</span>
                    <b style={{ color: p.r >= 7.5 ? '#7CE3A1' : p.r < 6 ? '#FF9AA8' : undefined }}>{p.r.toFixed(1)}</b>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="row center" style={{ marginTop: 12 }}>
        <a className="cta" href={`/l/${d.fixture.leagueId}`}><span>Back to league</span></a>
      </div>
    </div>
  );
}
