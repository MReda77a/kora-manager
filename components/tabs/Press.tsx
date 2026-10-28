'use client';
// The big-match press conference: a full-screen press room. Questions are typed out by the
// journalists, the manager picks an answer, the room reacts (flashes, gasps, laughter), and at
// the end the next morning's back page shows what he said and what it will do to the match.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/client.ts';
import { PAPER_NAMES } from '../../lib/game.ts';
import { crowdBed, crowdLevel, music, play } from '../../lib/sound.ts';
import { BackHead, Crest, Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

const OUTLETS = [
  { name: 'Kora Daily', color: '#2EE6A0' }, { name: 'The Touchline', color: '#5FD3F3' }, { name: 'Matchday Times', color: '#F2C14E' },
  { name: 'Goal Line Radio', color: '#2EE6A0' }, { name: 'The Back Page', color: '#A9C8F0' }, { name: 'Pitchside TV', color: '#FF8A65' },
];
const TONE_COLOR: Record<string, string> = { calm: '#5FD3F3', humble: '#A9C8F0', bold: '#F2C14E', fiery: '#FF6B7A', witty: '#2EE6A0', mind: '#B9A6FF' };

export default function PressTab({ lid, d, go, toast }: TabProps) {
  const [v, setV] = useState<any>(null);
  const [stage, setStage] = useState<'intro' | 'q' | 'react' | 'paper'>('intro');
  const [qi, setQi] = useState(0);
  const [typed, setTyped] = useState(0);
  const [last, setLast] = useState<{ a: number; react: string; chips: { t: string; good: boolean }[] } | null>(null);
  const [flash, setFlash] = useState({ n: 0, big: false });
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    api(`/api/leagues/${lid}/press`).then((x) => {
      setV(x);
      if (!x.available) return;
      if (x.done) setStage('paper');
      else {
        const n = x.questions.filter((q: any) => q.picked !== null).length;
        setQi(n);
        if (n > 0) setStage('q');
      }
    }).catch((e) => toast.bad(e.message));
  }, [lid]);

  // the room's sound: a tense theme over the murmur of journalists
  useEffect(() => {
    if (!v?.available) return;
    music('press'); crowdBed('press'); crowdLevel(0.15);
    return () => { music('menu'); crowdBed(null); };
  }, [v?.available]);

  // the question is typed out, with a camera or two going off
  const q = v?.questions?.[qi];
  useEffect(() => {
    if (stage !== 'q' || !q) return;
    setTyped(0);
    play('press-shutter', { gain: 0.7, rate: 0.95 + Math.random() * 0.1 });
    if (Math.random() < 0.6) play('press-shutter', { gain: 0.5, delay: 0.35 + Math.random() * 0.4, rate: 0.9 + Math.random() * 0.2 });
    const len = q.text.length;
    let k = 0;
    const t = setInterval(() => { k += 2; setTyped(Math.min(len, k)); if (k >= len) clearInterval(t); }, 24);
    return () => clearInterval(t);
  }, [stage, qi, q?.text]);

  const outlet = useMemo(() => OUTLETS[(qi * 7 + (v?.fixtureId || 0)) % OUTLETS.length], [qi, v?.fixtureId]);

  if (!v) return <Spinner />;
  if (!v.available) {
    return (
      <div className="col" style={{ gap: 10 }}>
        <BackHead title="Press conference" />
        <div className="panel cut col" style={{ gap: 8, maxWidth: 560 }}>
          <span className="lz" style={{ fontSize: 22 }}>🎙️ No press conference right now</span>
          <span className="small" style={{ fontWeight: 700 }}>The press room opens before the big ones: a <b style={{ color: '#F2C14E' }}>derby</b> (two Fan Club managers) and the <b style={{ color: '#F2C14E' }}>cup final</b>.</span>
          <span className="small muted">Five questions about the table, the form, the stars, the referee and what the other manager said. Every answer changes the match: your team's spirit, the rival's anger, the referee's patience and what the fans expect. Everything you say is printed in the news.</span>
        </div>
      </div>
    );
  }

  const fire = (big: boolean) => setFlash((f) => ({ n: f.n + 1, big }));
  const begin = () => {
    started.current = true;
    play('press-flashes', { gain: 0.9 });
    fire(true);
    setTimeout(() => setStage('q'), 650);
  };
  const answer = async (ai: number) => {
    if (busy || typed < (q?.text.length || 0)) { setTyped(q?.text.length || 0); return; }
    setBusy(true);
    try {
      const r = await api(`/api/leagues/${lid}/press`, { q: qi, a: ai });
      const tone = q.answers[ai].tone;
      // the room reacts to the words
      if (tone === 'fiery') { play('press-gasp', { gain: 1 }); play('press-flashes', { gain: 1, delay: 0.1 }); fire(true); }
      else if (tone === 'bold') { play('press-gasp', { gain: 0.6 }); play('press-flashes', { gain: 0.7 }); fire(true); }
      else if (tone === 'witty') { play('press-laugh', { gain: 0.95 }); play('press-shutter', { gain: 0.6, delay: 0.5 }); fire(false); }
      else if (tone === 'mind') { play('press-gasp', { gain: 0.45, rate: 0.92 }); play('press-shutter', { gain: 0.7, delay: 0.2 }); fire(false); }
      else { play('press-shutter', { gain: 0.6 }); play('press-shutter', { gain: 0.4, delay: 0.25, rate: 1.08 }); fire(false); }
      setV(r);
      setLast({ a: ai, ...r.last });
      setStage('react');
    } catch (e: any) { toast.bad(e.message); }
    setBusy(false);
  };
  const next = () => {
    if (v.done) {
      play('press-sting', { gain: 1 });
      play('press-flashes', { gain: 0.8, delay: 0.3 });
      fire(true);
      setStage('paper');
      return;
    }
    setLast(null);
    setQi(qi + 1);
    setStage('q');
  };
  const leave = () => go('home');
  const paperName = PAPER_NAMES[d.league?.pool] || 'The Daily Kickoff';
  const total = v.questions.length;
  const label = v.final ? 'Cup final' : 'Derby';
  const kick = new Date(v.kickoff);

  return (
    <div className="press-scene" role="dialog" aria-label="Press conference">
      <PressWall me={v.me} opp={v.opp} />
      <Flashes key={flash.n} n={flash.n} big={flash.big} />
      <header className="press-top">
        <span className="tag gold"><span>🎙️ Press conference · {label}</span></span>
        <div className="row press-vs">
          <Crest c1={v.me.color1} c2={v.me.color2} shape={v.me.shape} emblem={v.me.emblem} size={26} />
          <b className="lz">{v.me.short}</b><span className="muted tiny">vs</span><b className="lz">{v.opp.short}</b>
          <Crest c1={v.opp.color1} c2={v.opp.color2} shape={v.opp.shape} emblem={v.opp.human ? v.opp.emblem : -1} short={v.opp.short} size={26} />
        </div>
        <div className="row press-dots" aria-label={`Question ${Math.min(qi + 1, total)} of ${total}`}>
          {v.questions.map((x: any, i: number) => <i key={i} className={x.picked !== null ? 'done' : i === qi && stage !== 'paper' ? 'on' : ''} style={x.picked !== null ? { background: TONE_COLOR[x.answers[x.picked].tone] } : undefined} />)}
        </div>
        <button className="press-x" onClick={leave} aria-label="Leave the press room">✕</button>
      </header>

      {stage === 'intro' && (
        <div className="press-intro">
          <div className="lz press-title">THE PRESS ROOM IS FULL</div>
          <div className="small" style={{ fontWeight: 700, maxWidth: 520, textAlign: 'center' }}>
            {v.me.name} vs {v.opp.name}, {kick.toLocaleDateString(undefined, { weekday: 'long' })} at {kick.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
            {' '}Five questions. Every answer changes the match{v.opp.human ? `, and the ${v.opp.name} manager will read every word` : ''}.
          </div>
          {v.rivalDone && <div className="tag pink"><span>The other manager has already spoken…</span></div>}
          <button className="cta shine" onClick={begin}><span>Take your seat</span></button>
        </div>
      )}

      {(stage === 'q' || stage === 'react') && q && (
        <main className="press-main">
          <section className="press-ask">
            <div className="row" style={{ gap: 8 }}>
              <span className="press-badge" style={{ background: outlet.color }}>🎤</span>
              <div className="col" style={{ gap: 0 }}>
                <b className="small">{outlet.name}</b>
                <span className="tiny muted">Question {qi + 1} of {total}</span>
              </div>
            </div>
            <div className="press-bubble" key={qi}>
              {q.text.slice(0, typed)}<span className="press-caret" style={{ opacity: typed < q.text.length ? 1 : 0 }}>▍</span>
            </div>
            {stage === 'react' && last && (
              <div className="press-react" key={`r${qi}`}>
                <span className="small" style={{ fontWeight: 800 }}>{last.react}</span>
                <div className="row wrap" style={{ gap: 5 }}>
                  {last.chips.map((c, i) => <span key={i} className={`press-chip ${c.good ? 'good' : 'bad'}`} style={{ animationDelay: `${0.25 + i * 0.12}s` }}>{c.good ? '▲' : '▼'} {c.t}</span>)}
                </div>
                <button className="cta" onClick={next} style={{ alignSelf: 'flex-start' }}><span>{v.done ? 'See tomorrow’s papers' : 'Next question'}</span></button>
              </div>
            )}
          </section>
          <section className="press-answers" aria-label="Your answer">
            {q.answers.map((a: any, i: number) => {
              const chosen = stage === 'react' && last?.a === i;
              const dim = stage === 'react' && !chosen;
              return (
                <button key={`${qi}-${i}`} className={`press-ans ${chosen ? 'chosen' : ''} ${dim ? 'dim' : ''}`} disabled={stage === 'react' || busy}
                  onClick={() => answer(i)} style={{ ['--tc' as any]: TONE_COLOR[a.tone], animationDelay: `${0.15 + i * 0.08}s` }}>
                  <span className="press-face" aria-hidden="true">{a.face}</span>
                  <span className="col" style={{ gap: 1, minWidth: 0 }}>
                    <b className="tiny" style={{ color: TONE_COLOR[a.tone], letterSpacing: 0.5 }}>{a.toneName.toUpperCase()}</b>
                    <span className="press-say">“{a.text}”</span>
                  </span>
                </button>
              );
            })}
          </section>
        </main>
      )}

      {stage === 'paper' && v.summary && (
        <main className="press-end">
          <article className="press-paper">
            <div className="press-mast">{paperName}</div>
            <div className="press-dateline">{label.toUpperCase()} SPECIAL · {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h2 className="press-head">{v.summary.headline}</h2>
            <div className="press-cols">
              <p>{v.me.name} face {v.opp.name} {v.venue === 'home' ? 'at home' : 'away'} in {v.final ? 'the cup final' : 'the derby'}, and their manager did not hold back in front of the cameras.</p>
              <p className="press-pull">“{v.questions.map((x: any) => x.answers[x.picked]).sort((a: any, b: any) => ['fiery', 'bold', 'mind', 'witty', 'humble', 'calm'].indexOf(a.tone) - ['fiery', 'bold', 'mind', 'witty', 'humble', 'calm'].indexOf(b.tone))[0]?.text}”</p>
            </div>
          </article>
          <section className="press-sum">
            <span className="tag"><span>What your words will do</span></span>
            {v.summary.lines.length === 0 && <span className="small muted">Nothing much. A quiet press conference.</span>}
            {v.summary.lines.map((l: any, i: number) => (
              <span key={i} className="small press-line" style={{ animationDelay: `${0.6 + i * 0.15}s`, color: l.good ? '#2EE6A0' : '#FF9AA8' }}>{l.good ? '▲' : '▼'} {l.t}</span>
            ))}
            <span className="tiny muted">The effects count in this match only. {v.opp.human ? 'The other manager has been told what you said.' : ''}</span>
            <div className="row wrap" style={{ gap: 8, marginTop: 'auto' }}>
              <button className="cta" onClick={() => go('lineup')}><span>Set the line-up</span></button>
              <button className="ghost" onClick={leave}><span>Leave the room</span></button>
            </div>
          </section>
        </main>
      )}

      <div className="press-desk" aria-hidden="true">
        <div className="press-mics">
          {OUTLETS.map((o, i) => (
            <svg key={o.name} width="34" height="58" viewBox="0 0 34 58" style={{ transform: `rotate(${(i - 2.5) * 5}deg)` }}>
              <rect x="15" y="22" width="4" height="36" fill="#22344F" />
              <rect x="5" y="20" width="24" height="12" rx="2" fill={o.color} />
              <ellipse cx="17" cy="12" rx="9" ry="11" fill="#0E1A2B" stroke="#2C4A6B" strokeWidth="1.5" />
              <path d="M10 8h14M9 12h16M10 16h14" stroke="#2C4A6B" strokeWidth="1" />
            </svg>
          ))}
        </div>
        <div className="press-plate"><b>{v.manager}</b><span>{v.me.name}</span></div>
      </div>
    </div>
  );
}

// the sponsor wall behind the manager: both crests, over and over
function PressWall({ me, opp }: { me: any; opp: any }) {
  const cells = Array.from({ length: 40 });
  return (
    <div className="press-wall" aria-hidden="true">
      {cells.map((_, i) => {
        const c = (i + Math.floor(i / 8)) % 2 === 0 ? me : opp;
        return (
          <div key={i} className="press-cell">
            <Crest c1={c.color1} c2={c.color2} shape={c.shape} emblem={c === opp && !opp.human ? -1 : c.emblem} short={c.short} size={30} />
            <span>{c.short}</span>
          </div>
        );
      })}
    </div>
  );
}

// camera flashes: bright bursts from the crowd of photographers
function Flashes({ n, big }: { n: number; big: boolean }) {
  const spots = useMemo(() => Array.from({ length: n === 0 ? 0 : big ? 14 : 5 }, () => ({ x: Math.random() * 100, y: 40 + Math.random() * 55, d: Math.random() * (big ? 0.9 : 0.6), s: 60 + Math.random() * 90 })), [n, big]);
  if (!n) return null;
  return (
    <div className="press-flashes" aria-hidden="true">
      {big && <div className="press-white" />}
      {spots.map((p, i) => <i key={i} style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, animationDelay: `${p.d}s` }} />)}
    </div>
  );
}
