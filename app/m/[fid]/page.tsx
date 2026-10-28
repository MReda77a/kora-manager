'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { api, clock, shirt } from '../../../lib/client.ts';
import { CLUB_TYPES, FORMATIONS, PRESETS, TACKLE_STYLES, minuteAt, type ClubTypeKey } from '../../../lib/game.ts';
import { crowdBed, crowdLevel, isMuted, music, play, whistle } from '../../../lib/sound.ts';
import { SoundButton } from '../../../components/SoundButton.tsx';
import { Crest, Kit, Spinner, lastName, useToast } from '../../../components/ui.tsx';
import { Pitch2D, tm, usePlan } from '../../../components/match/Pitch2D.tsx';
import { Commentary, Formation, KeyEvents, LiveStats, Lineups, useSmoothClock } from '../../../components/match/Panels.tsx';

type Ev = { m: number; type: string; side: 0 | 1; text: string; pid?: string; pid2?: string };
const fmtMin = (m: number) => (m > 90 ? `90+${m - 90}'` : `${m}'`);
const evAt = (e: Ev) => (e.type === 'ft' || e.type === 'pens' ? 90.5 : e.type === 'ht' ? 45 : tm(e.m));

export default function MatchPage({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = use(params);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [skip, setSkip] = useState(false);
  const load = () => api(`/api/fixtures/${fid}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    try { setSkip(new URL(location.href).searchParams.get('skip') === '1'); } catch {}
  }, [fid]);
  useEffect(() => {
    if (!d || d.fixture.status !== 'scheduled') return;
    const ms = new Date(d.fixture.kickoff).getTime() - Date.now();
    const t = setTimeout(load, ms < 0 ? 1500 : Math.min(ms + 1200, 60_000));
    return () => clearTimeout(t);
  }, [d]);
  if (err) return <div className="pad err">{err}</div>;
  if (!d) return <Spinner />;
  const theme = d.derby ? 'theme-derby' : d.fixture.comp === 'cup' ? 'theme-cup' : '';
  return (
    <div className={theme} style={{ minHeight: '100dvh' }}>
      {d.fixture.status === 'scheduled' || d.fixture.status === 'playing' || !d.report ? <PreMatch d={d} reload={load} /> : <Watch d={d} setD={setD} skip={skip} reload={load} />}
    </div>
  );
}

function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return n;
}

function TeamBlock({ c, size = 60 }: { c: any; size?: number }) {
  return (
    <div className="col" style={{ alignItems: 'center', gap: 2, minWidth: 0 }}>
      <Crest c1={c.color1} c2={c.color2} size={size} shape={c.shape} emblem={c.human ? c.emblem : -1} short={c.short} />
      <span className="lz ellipsis" style={{ fontSize: 19, maxWidth: '100%', color: c.mine ? 'var(--cyan)' : undefined }}>{c.name}</span>
      <span className="tiny muted">{c.human ? `Manager: ${c.manager}` : `AI club${CLUB_TYPES[c.club_type as ClubTypeKey] ? ` · ${CLUB_TYPES[c.club_type as ClubTypeKey].name}` : ''}`}</span>
    </div>
  );
}

// Both kits for this match. The away side changes shirt when the colours clash.
function KitPair({ d, size = 34 }: { d: any; size?: number }) {
  const [h, a] = d.kits;
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
      <div className="col" style={{ alignItems: 'center', gap: 0 }}><Kit c1={h.c1} c2={h.c2} pattern={h.pattern} size={size} label={`${d.home.name} ${h.label}`} /><span className="tiny muted">{h.label}</span></div>
      <div className="col" style={{ alignItems: 'center', gap: 0 }}><Kit c1={a.c1} c2={a.c2} pattern={a.pattern} size={size} label={`${d.away.name} ${a.label}`} /><span className="tiny" style={{ color: a.label === 'Home kit' ? undefined : '#F2C14E', fontWeight: 800 }}>{a.label}</span></div>
    </div>
  );
}

function Conditions({ d }: { d: any }) {
  const c = d.conditions;
  return (
    <div className="row small" style={{ gap: 10, flexWrap: 'wrap', fontWeight: 800 }}>
      <span title={c.weatherInfo.note}>{c.weatherInfo.icon} {c.weatherInfo.label}</span>
      <span className="muted">·</span>
      <span>Referee {c.referee.name} <span className="tiny" style={{ color: c.referee.strict === 2 ? '#FF8A80' : c.referee.strict === 0 ? '#2EE6A0' : 'var(--muted)' }}>({c.referee.label})</span></span>
    </div>
  );
}

function Back({ d }: { d: any }) {
  return <a className="back" href={`/l/${d.fixture.leagueId}`} aria-label="Back"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E8F1FA" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg></a>;
}

// ---------------------------------------------------------------- before kick-off
function PreMatch({ d, reload }: { d: any; reload: () => void }) {
  // the build-up: the derby gets its own theme
  useEffect(() => { music(d.derby ? 'derby' : 'menu'); crowdBed(null); }, [d.derby]);
  const now = useNow();
  const toast = useToast();
  const kick = new Date(d.fixture.kickoff).getTime();
  const s = Math.max(0, Math.floor((kick - now) / 1000));
  const hms = `${String(Math.floor((s % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const cd = s >= 86400 ? `${Math.floor(s / 86400)}d ${hms.slice(0, 5)}` : hms;
  const rivals = d.home.human && d.away.human; // pre-match words count when two managers meet
  const mine = d.home.mine || d.away.mine;
  const [text, setText] = useState('');
  const [tone, setTone] = useState('confident');
  const title = d.derby ? `THE ${d.home.name.split(' ')[0].toUpperCase()} DERBY` : d.fixture.comp === 'cup' ? d.fixture.roundName : `Matchday ${d.fixture.matchday}`;
  const post = async () => {
    try { await api(`/api/leagues/${d.fixture.leagueId}/comment`, { text, tone: rivals ? tone : undefined }); setText(''); toast.ok('Sent to the matchday paper'); reload(); } catch (e: any) { toast.bad(e.message); }
  };
  const tension = d.derby ? 70 + ((d.home.id * 7 + d.away.id * 13) % 25) : 0;
  return (
    <div style={{ padding: '8px 14px 16px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100dvh', maxWidth: 1320, margin: '0 auto' }}>
      <header className="row between" style={{ minHeight: 44 }}>
        <div className="row" style={{ gap: 12 }}><Back d={d} /><span className="lz" style={{ fontSize: 24, color: d.derby ? '#F2C14E' : undefined }}>{title}</span><span className="small muted hide-sm" style={{ fontWeight: 700 }}>{d.home.stadium}</span></div>
        <div className="row" style={{ gap: 8 }}><span className="tiny muted" style={{ fontWeight: 900 }}>KICK-OFF IN</span><span className="lz" style={{ fontSize: 26 }}>{cd}</span></div>
      </header>
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 300px)', gap: 12, flex: 1 }}>
        <section className="panel cut" style={{ gap: 14, justifyContent: 'center' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16 }}>
            <TeamBlock c={d.home} size={72} />
            <div className="col" style={{ alignItems: 'center', gap: 2 }}>
              <span className="lz" style={{ fontSize: 44, color: d.derby ? '#F2C14E' : undefined }}>VS</span>
              <span className="small muted">{clock(d.fixture.kickoff)}</span>
            </div>
            <TeamBlock c={d.away} size={72} />
          </div>
          <div className="row between wrap" style={{ gap: 10, padding: '8px 10px', background: 'rgba(0,0,0,0.15)' }}>
            <div className="col" style={{ gap: 3 }}>
              <span className="kicker">Match conditions</span>
              <Conditions d={d} />
              <span className="tiny muted">{d.conditions.weatherInfo.note} {d.conditions.referee.strict === 2 ? 'Strict referee: more cards and penalties.' : d.conditions.referee.strict === 0 ? 'Lenient referee: lets the game flow.' : ''}</span>
            </div>
            <KitPair d={d} />
          </div>
          {d.derby && (
            <div className="col" style={{ gap: 4 }}>
              <div className="row between"><span className="kicker">Tension</span><span className="lz" style={{ fontSize: 24, color: '#F2C14E' }}>{tension}%</span></div>
              <div style={{ height: 12, background: 'repeating-linear-gradient(135deg, #E0A22E 0 10px, var(--mint) 10px 20px)', width: `${tension}%`, transform: 'skewX(-20deg)' }} />
              <div className="row wrap tiny" style={{ gap: 6, fontWeight: 800 }}><span className="tag" style={{ background: 'color-mix(in srgb, var(--mint) 30%, transparent)' }}><span>Cards ×1.5</span></span><span className="tag" style={{ background: 'rgba(242,193,78,0.3)' }}><span>Fans swing ×2</span></span><span className="tag"><span>Form is wilder</span></span></div>
            </div>
          )}
          {d.comments.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="kicker">From the press room</span>
              {d.comments.map((c: any, i: number) => <div key={i} className="small" style={{ padding: '4px 10px', borderLeft: `3px solid ${c.club_id === d.home.id ? d.home.color1 : d.away.color1}`, background: 'rgba(0,0,0,0.15)' }}>“{c.text}” <span className="tiny muted">— {c.club}{c.tone ? ` · ${c.tone}` : ''}</span></div>)}
            </div>
          )}
        </section>
        <section className="col" style={{ gap: 10 }}>
          {mine ? (
            <>
              <a className="cta" href={`/l/${d.fixture.leagueId}?tab=lineup`} style={{ minHeight: 56 }}><span>Set lineup</span></a>
              <a className="ghost" href={`/l/${d.fixture.leagueId}?tab=tactics`}><span>Tactics, penalties & assistant</span></a>
              <div className="panel cut" style={{ gap: 6 }}>
                <span className="kicker">{rivals ? 'Mind games' : 'Say something to the paper'}</span>
                {rivals && <div className="segrow">{(['calm', 'confident', 'provocative'] as const).map((t) => <button key={t} className={`seg ${tone === t ? 'on' : ''}`} onClick={() => setTone(t)}><span>{t[0].toUpperCase() + t.slice(1)}</span></button>)}</div>}
                {rivals && <span className="tiny muted">{tone === 'calm' ? 'Calm: no effect.' : tone === 'confident' ? 'Confident: your players +1 tonight.' : 'Provocative: +2, but the game gets dirtier.'}</span>}
                <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={160} rows={2} placeholder="Your words go in the matchday paper…" style={{ background: 'rgba(6, 14, 26,0.45)', border: '1px solid rgba(255,255,255,0.12)', color: 'inherit', padding: 8, resize: 'none', font: 'inherit' }} />
                <button className={`cta small ${d.derby ? 'gold' : ''}`} disabled={text.trim().length < 2} onClick={post}><span>Send to the matchday paper</span></button>
              </div>
            </>
          ) : <div className="panel cut small muted">Comes on at the kick-off time. Open this page then to watch it live.</div>}
          <span className="tiny muted">The match plays at kick-off whether you watch or not. Watching live lets you change tactics and make subs. If you skip, your assistant follows your rules.</span>
        </section>
      </div>
      {toast.node}
    </div>
  );
}

// ---------------------------------------------------------------- live / replay
function Watch({ d: raw, setD, skip, reload }: { d: any; setD: (x: any) => void; skip: boolean; reload: () => void }) {
  const toast = useToast();
  // shirts on the pitch: the away side wears its change kit when the colours clash
  const d = { ...raw, home: { ...raw.home, color1: raw.kits[0].c1, kit2: raw.kits[0].c2 }, away: { ...raw.away, color1: raw.kits[1].c1, kit2: raw.kits[1].c2 } };
  const rep = d.report;
  const events: Ev[] = rep.events;
  const LIVE = d.liveSeconds;
  const HT = d.htSeconds ?? 0; // the clock stops at half-time for this long in a live match
  const TOTAL = LIVE + HT;
  const liveFrom = d.fixture.liveFrom ? new Date(d.fixture.liveFrom).getTime() : 0;
  const clockSkew = useRef(new Date(d.now).getTime() - Date.now()).current;
  const elapsed = () => (Date.now() + clockSkew - liveFrom) / 1000;
  const isLiveNow = d.fixture.status !== 'done' && elapsed() < TOTAL;
  const [phase, setPhase] = useState<'intro' | 'play' | 'ft'>(skip ? 'ft' : isLiveNow ? 'play' : 'intro');
  const [live] = useState(isLiveNow);
  const liveGm = () => { const e = elapsed(); return e >= TOTAL ? 90.6 : minuteAt(e, HT, LIVE); };
  const [gm, setGm] = useState(isLiveNow ? liveGm() : 0);
  const [nowMs, setNowMs] = useState(Date.now());
  const htHold = useRef(0);
  const [react, setReact] = useState<null | { type: string; mine: boolean; until: number }>(null);
  const [speed, setSpeed] = useState(1);
  const [fx, setFx] = useState<Ev | null>(null);
  const [panel, setPanel] = useState<null | 'tactic' | 'sub'>(null);
  const [subOut, setSubOut] = useState<string | null>(null);
  const chanted = useRef(new Set<number>());
  const shotSeen = useRef(-1);
  const shown = useRef(-1);
  const mineSide: number = d.home.mine ? 0 : d.away.mine ? 1 : -1;
  const [info, setInfo] = useState('live');
  const plan = usePlan(rep, events);

  const team = (s: number) => (s === 0 ? d.home : d.away);

  const revealed = useMemo(() => { let k = 0; for (; k < events.length; k++) if (evAt(events[k]) > gm) break; return k; }, [gm, events]);

  // sound follows the match: music before kick-off, the crowd while it is on
  useEffect(() => {
    if (phase === 'intro') { music(d.derby ? 'derby' : 'menu'); crowdBed(null); }
    if (phase === 'play') { music(null); crowdBed(d.derby ? 'derby' : 'normal'); }
  }, [phase]);
  useEffect(() => () => crowdBed(null), []);
  // clock
  useEffect(() => {
    if (phase !== 'play') return;
    const step = 0.2;
    const i = setInterval(() => {
      if (live) { setGm(liveGm()); setNowMs(Date.now()); }
      else setGm((g) => {
        // a replay stops for a moment at half-time too
        if (g >= 45 && g < 45.001 && htHold.current < 3 / step) { htHold.current++; return g; }
        const n = g + (90 / LIVE) * step * speed;
        return g < 45 && n >= 45 ? 45 : Math.min(90.6, n);
      });
    }, step * 1000);
    return () => clearInterval(i);
  }, [phase, speed, live]);
  // pick up the other manager's changes while live
  useEffect(() => {
    if (!live || phase !== 'play') return;
    const i = setInterval(async () => { try { const n = await api(`/api/fixtures/${d.fixture.id}`); if (n.report) setD(n); } catch {} }, 6000);
    return () => clearInterval(i);
  }, [live, phase]);
  // events -> animations + sound
  useEffect(() => {
    if (phase !== 'play') return;
    if (shown.current < 0) { shown.current = revealed; whistle(1); play('applause', { gain: 0.8 }); return; }
    if (revealed > shown.current) {
      const fresh = events.slice(shown.current, revealed);
      shown.current = revealed;
      const pri = ['goal', 'var', 'red', 'penalty', 'pens', 'penmiss', 'injury', 'yellow', 'trap', 'freekick', 'offside', 'sub', 'save', 'miss', 'tactic', 'ht', 'ft'];
      const big = [...fresh].sort((a, b) => pri.indexOf(a.type) - pri.indexOf(b.type))[0];
      if (big && pri.includes(big.type)) {
        setFx(big);
        // the crowd is on your side (the home side when you are only watching)
        const forMe = mineSide < 0 ? big.side === 0 : big.side === mineSide;
        // phones buzz on the big moments (Android; iPhones ignore it), unless the sound is muted
        const buzz = (p: number | number[]) => { try { if (!isMuted()) navigator.vibrate?.(p); } catch {} };
        if (big.type === 'goal') buzz(forMe ? [90, 50, 220] : 70);
        // the big moments are when a manager wants to react: offer the quick changes right away
        if (live && mineSide >= 0 && evAt(big) < 86 && (big.type === 'goal' || big.type === 'red' || (big.type === 'injury' && big.side === mineSide)))
          setReact({ type: big.type, mine: big.side === mineSide, until: Date.now() + 10_000 });
        else if (big.type === 'red') buzz([150, 60, 150]);
        else if (big.type === 'penalty') buzz(100);
        const chant = d.derby ? 'chant-derby' : 'chant';
        switch (big.type) {
          case 'goal':
            if (forMe) { play('goal', { gain: d.derby ? 1.15 : 1 }); play(chant, { delay: 5.5, gain: 0.85 }); }
            else play('concede');
            break;
          case 'penalty': whistle(2); play(forMe ? 'tension' : 'boo', { delay: 0.3 }); break;
          case 'penmiss': play(forMe ? 'ooh' : 'goal', { gain: forMe ? 1 : 0.75 }); break;
          // a save is logged for the keeper's side: your keeper saving brings relief, theirs an 'ooooh'
          case 'save': if (forMe) play('applause', { gain: 0.7 }); else play('ooh'); break;
          case 'miss': play('ooh', { gain: forMe ? 1 : 0.55 }); break;
          case 'red': whistle(1); play(forMe ? 'boo' : 'applause', { delay: 0.2 }); break;
          case 'yellow': whistle(1); play('ahh', { gain: forMe ? 1 : 0.75, delay: 0.1 }); break;
          case 'freekick': whistle(1); play('ahh', { gain: 0.8, delay: 0.1 }); break;
          case 'injury': play('ahh', { gain: 0.6 }); break;
          case 'var': play('tension', { gain: 0.7 }); break;
          case 'offside': whistle(1); play(forMe ? 'ooh' : 'applause', { gain: 0.5 }); break;
          case 'trap': play(forMe ? 'tension' : 'ooh', { gain: 0.7 }); break;
          case 'sub': play('applause', { gain: 0.4 }); break;
          case 'ht': whistle(2); play('applause', { delay: 0.8 }); break;
          case 'ft': whistle(3); break;
        }
      }
    }
    // every other real chance gets an 'ooh' too (shots that did not make the headlines)
    {
      const shots = (rep.shots || []) as { m: number; side: number; xg: number; goal: boolean }[];
      const from = shotSeen.current;
      shotSeen.current = gm;
      if (from >= 0 && gm - from < 3 && !fx) {
        const s = shots.find((x) => !x.goal && x.xg >= 0.09 && x.m > from && x.m <= gm);
        const busy = events.some((e) => Math.abs(evAt(e) - (s?.m ?? -9)) < 1.2 && ['goal', 'save', 'miss', 'penalty', 'penmiss', 'var', 'red'].includes(e.type));
        if (s && !busy) {
          const mineAttack = mineSide < 0 ? s.side === 0 : s.side === mineSide;
          play('ooh', { gain: Math.min(1, (mineAttack ? 0.45 : 0.3) + s.xg) });
        }
      }
    }
    // the crowd sings now and then; in a derby it hardly stops
    const marks = d.derby ? [4, 28, 52, 76] : [18, 63];
    for (const k of marks) {
      if (gm >= k && gm < k + 6 && !chanted.current.has(k)) {
        chanted.current.add(k);
        const goalJustNow = events.slice(0, revealed).some((e) => e.type === 'goal' && gm - evAt(e) < 6);
        if (!goalJustNow) play(d.derby ? 'chant-derby' : 'chant', { gain: d.derby ? 0.9 : 0.7 });
      }
    }
    // how loud the stadium is: chances and a close finish lift it
    {
      const recentHot = events.slice(0, revealed).filter((e) => gm - evAt(e) < 8 && ['goal', 'save', 'miss', 'penalty', 'freekick'].includes(e.type)).length;
      const [a, b] = events.slice(0, revealed).reduce((s, e) => { if (e.type === 'goal') s[e.side]++; return s; }, [0, 0]);
      const close = Math.abs(a - b) <= 1 && gm > 75 ? 0.3 : 0;
      crowdLevel(0.3 + Math.min(0.4, recentHot * 0.2) + close + (d.derby ? 0.15 : 0));
    }
    if (gm >= 90.5) { const t = setTimeout(() => setPhase('ft'), 1800); return () => clearTimeout(t); }
  }, [revealed, gm, phase]);
  useEffect(() => {
    if (!fx) return;
    const t = setTimeout(() => setFx(null), fx.type === 'goal' || fx.type === 'var' ? 2700 : fx.type === 'injury' ? 2600 : 1800);
    return () => clearTimeout(t);
  }, [fx]);

  // who is on the pitch right now (for subs)
  const onPitch = (side: 0 | 1) => {
    const set = new Set<string>(rep.lineups[side].xi);
    const bench = new Set<string>(rep.lineups[side].bench);
    for (const e of events.slice(0, revealed)) {
      if (e.side !== side) continue;
      if (e.type === 'sub' && e.pid && e.pid2) { set.delete(e.pid2); set.add(e.pid); bench.delete(e.pid); }
      if ((e.type === 'red') && e.pid) set.delete(e.pid);
    }
    return { on: [...set], bench: [...bench] };
  };
  const subsUsed = (side: number) => events.slice(0, revealed).filter((e) => e.side === side && e.type === 'sub').length;
  const change = async (body: Record<string, unknown>, msg: string) => {
    setReact(null);
    try {
      const r = await api(`/api/fixtures/${d.fixture.id}/change`, body);
      setD({ ...raw, report: r.report });
      toast.ok(msg);
      setPanel(null); setSubOut(null);
    } catch (e: any) { toast.bad(e.message); }
  };

  const score = [0, 0];
  events.slice(0, phase === 'ft' ? events.length : revealed).forEach((e) => { if (e.type === 'goal') score[e.side]++; });
  const minute = Math.min(90, Math.floor(gm));
  const canChange = live && mineSide >= 0 && phase === 'play' && gm < 88;

  if (phase === 'intro') {
    return (
      <div style={{ padding: '8px 14px', minHeight: '100dvh', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <header className="row" style={{ gap: 12 }}><Back d={d} /><span className="lz" style={{ fontSize: 22 }}>{d.derby ? 'DERBY' : d.fixture.comp === 'cup' ? d.fixture.roundName : `Matchday ${d.fixture.matchday}`}</span><span className="tag"><span>Full time</span></span></header>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16, width: '100%', maxWidth: 640, margin: '20px auto 0' }}>
          <TeamBlock c={d.home} size={76} /><span className="lz" style={{ fontSize: 44 }}>VS</span><TeamBlock c={d.away} size={76} />
        </div>
        <div className="row center" style={{ gap: 12 }}>
          <button className="cta shine" style={{ minHeight: 56, minWidth: 200 }} onClick={() => setPhase('play')}><span>Watch ({Math.round(LIVE / 60)} min)</span></button>
          <button className="ghost" style={{ minHeight: 56 }} onClick={() => setPhase('ft')}><span>Skip to result</span></button>
        </div>
        <span className="tiny muted" style={{ textAlign: 'center' }}>No spoilers: the score stays hidden until you watch or skip.</span>
      </div>
    );
  }
  if (phase === 'ft') return <FullTime d={d} skipped={skip} reload={reload} />;

  // the live match centre
  const lastEv = events[Math.max(0, revealed - 1)];
  const seen = events.slice(0, revealed);
  const { on, bench } = mineSide >= 0 ? onPitch(mineSide as 0 | 1) : { on: [], bench: [] };
  const hasFlow = !!rep.flow;
  const formSide = (mineSide >= 0 ? mineSide : 0) as 0 | 1;
  const tactics = canChange ? [
    { k: 'att', ico: '⚔️', t: 'All-out attack', s: 'Everyone forward, press high', go: () => change({ mentality: 2, press: 2 }, 'All out attack!') },
    { k: 'bus', ico: '🚌', t: 'Park the bus', s: 'Sit deep, protect the lead', go: () => change({ mentality: 0, line: 0, press: 0 }, 'Park the bus') },
    { k: 'press', ico: '🔥', t: 'High press', s: 'Win the ball back high', go: () => change({ press: 3 }, 'High press on') },
    ...((d.plans || []).length > 1 ? d.plans.map((k: string) => ({ k: `plan${k}`, ico: '📋', t: `Plan ${k}`, s: 'Switch to your saved plan', go: () => change({ plan: k }, `Plan ${k}!`) })) : []),
  ] : [];
  // half-time break of a live match: seconds until the second half
  const htLeft = live && HT > 0 ? (() => { const e = (nowMs + clockSkew - liveFrom) / 1000; return e > LIVE / 2 && e < LIVE / 2 + HT ? Math.ceil(LIVE / 2 + HT - e) : 0; })() : 0;
  const reactOn = canChange && !htLeft && react && react.until > nowMs ? react : null;
  const reactTitle = !reactOn ? '' : reactOn.type === 'goal' ? (reactOn.mine ? '⚽ You scored! Protect the lead or go for more?' : '😤 Conceded! Change something?')
    : reactOn.type === 'red' ? (reactOn.mine ? '🟥 Down to 10 men! Reorganise?' : '🟥 They are down to 10! Go for it?') : '🚑 Injury! Make a sub?';
  const tabsList: [string, string][] = [['live', 'Live'], ['stats', 'Stats'], ['events', 'Events'], ['lineups', 'Line-ups'], ['shape', 'Formation']];
  const infoTab = () => (
    <>
      {info === 'live' && <Commentary shown={seen} />}
      {info === 'stats' && <LiveStats d={d} gm={gm} shown={seen} shots={rep.shots || []} flow={rep.flow || []} />}
      {info === 'events' && <KeyEvents d={d} shown={seen} />}
      {info === 'lineups' && <Lineups d={d} gm={gm} shown={seen} />}
      {info === 'shape' && <Formation d={d} side={formSide} shown={seen} />}
    </>
  );
  return (
    <div className="mc-root">
      <header className="mc-top">
        <Back d={d} />
        <div className="mc-score">
          <div className="row mc-side" style={{ justifyContent: 'flex-end' }}>
            <span className="col" style={{ alignItems: 'flex-end', gap: 0, minWidth: 0 }}><b className="lz ellipsis tname">{d.home.name}</b><span className="tiny muted">{rep.lineups?.[0]?.formation}</span></span>
            <Crest c1={d.home.color1} c2={d.home.color2} size={30} shape={d.home.shape} emblem={d.home.human ? d.home.emblem : -1} short={d.home.short} />
          </div>
          <div className="col" style={{ alignItems: 'center', gap: 0 }}>
            <span className="lz" style={{ fontSize: 32, lineHeight: 1, whiteSpace: 'nowrap' }}>{score[0]} – {score[1]}</span>
            <span className="tiny" style={{ color: live ? 'var(--red)' : 'var(--cyan)', fontWeight: 900, whiteSpace: 'nowrap' }}>{live ? '● LIVE' : 'REPLAY'} · {fmtMin(Math.max(1, minute))}</span>
          </div>
          <div className="row mc-side">
            <Crest c1={d.away.color1} c2={d.away.color2} size={30} shape={d.away.shape} emblem={d.away.human ? d.away.emblem : -1} short={d.away.short} />
            <span className="col" style={{ gap: 0, minWidth: 0 }}><b className="lz ellipsis tname">{d.away.name}</b><span className="tiny muted">{rep.lineups?.[1]?.formation}</span></span>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {!live && [1, 2, 4].map((sp) => <button key={sp} className={`seg ${speed === sp ? 'on' : ''}`} onClick={() => setSpeed(sp)}><span>{sp}x</span></button>)}
          <SoundButton />
          <button className="ghost mc-skip" onClick={() => setPhase('ft')}><span>{live ? 'Result' : 'Skip'}</span></button>
        </div>
      </header>
      <div className="mc-cond tiny muted row">
        <span>🏟 {d.home.stadium}</span><span title={d.conditions.weatherInfo.label}>{d.conditions.weatherInfo.icon} {d.conditions.weatherInfo.label}</span><span>🧑‍⚖️ {d.conditions.referee.name} ({d.conditions.referee.label})</span>
      </div>
      <div className="mc-body">
        <aside className="panel mc-left mc-wide">
          <Lineups d={d} gm={gm} shown={seen} />
        </aside>
        <aside className="panel mc-tabs mc-narrow">
          <div className="row mc-tabrow">{tabsList.map(([k, l]) => <button key={k} className={`seg ${info === k ? 'on' : ''}`} onClick={() => setInfo(k)}><span>{l}</span></button>)}</div>
          <div className="mc-tabbody">{infoTab()}</div>
        </aside>
        <main className="field mc-pitch" style={{ animation: fx && (fx.type === 'red' || (fx.type === 'goal' && fx.side !== mineSide && mineSide >= 0)) ? 'shake .5s ease' : fx?.type === 'goal' ? 'beat .6s ease' : undefined }}>
          {hasFlow ? <SmoothPitch d={d} gm={gm} rate={htLeft ? 0 : live ? 90 / LIVE : (90 / LIVE) * speed} plan={plan} mineSide={mineSide} /> : (
            <>
              <div className="ln" style={{ inset: '26px 10px' }} />
              <div className="ln" style={{ top: 26, bottom: 26, left: '50%', width: 0, borderWidth: '0 0 0 1.5px' }} />
              <Dots d={d} gm={gm} events={events} revealed={revealed} />
            </>
          )}
          {!htLeft && lastEv && gm - evAt(lastEv) < 3.5 && !['kickoff', 'goal'].includes(lastEv.type) && <span className="tiny ellipsis mc-evbanner">{team(lastEv.side).name} · {lastEv.text}</span>}
          {fx && !htLeft && <FxOverlay e={fx} d={d} mineSide={mineSide} names={d.names} />}
          {htLeft > 0 && (
            <div className="mc-ht">
              <span className="lz" style={{ fontSize: 40, lineHeight: 1 }}>HALF-TIME</span>
              <span className="lz" style={{ fontSize: 28 }}>{score[0]} – {score[1]}</span>
              <span className="small" style={{ fontWeight: 800 }}>Second half in <b style={{ color: 'var(--mint)' }}>0:{String(htLeft).padStart(2, '0')}</b></span>
              {canChange && <>
                <span className="tiny muted">The clock is stopped: make your changes now.</span>
                <div className="row wrap center" style={{ gap: 6 }}>
                  <button className="cta small" onClick={() => setPanel('sub')} disabled={subsUsed(mineSide) >= 5}><span>🔁 Substitution</span></button>
                  <button className="ghost" onClick={() => setPanel('tactic')}><span>🎛 Style</span></button>
                  {tactics.filter((x) => x.k.startsWith('plan')).map((x) => <button key={x.k} className="ghost" onClick={x.go}><span>{x.t}</span></button>)}
                </div>
              </>}
            </div>
          )}
          {reactOn && (
            <div className="mc-react">
              <b className="small">{reactTitle}</b>
              <div className="row wrap center" style={{ gap: 6 }}>
                {tactics.map((x) => <button key={x.k} className="seg rq" style={{ minHeight: 34 }} onClick={x.go}><span>{x.ico} {x.t}</span></button>)}
                <button className="seg" style={{ minHeight: 34 }} disabled={subsUsed(mineSide) >= 5} onClick={() => { setPanel('sub'); setReact(null); }}><span>🔁 Sub</span></button>
                <button className="seg" style={{ minHeight: 34 }} onClick={() => setReact(null)}><span>✕</span></button>
              </div>
            </div>
          )}
        </main>
        <aside className="panel mc-right mc-wide">
          {canChange ? (
            <>
              <span className="kicker">Quick tactics</span>
              {tactics.map((x) => <button key={x.k} className="mc-tac" onClick={x.go}><span className="mc-tac-ico">{x.ico}</span><span className="col" style={{ gap: 0, alignItems: 'flex-start' }}><b>{x.t}</b><span className="tiny muted">{x.s}</span></span></button>)}
              <button className={`mc-tac ${panel === 'tactic' ? 'on' : ''}`} onClick={() => setPanel(panel === 'tactic' ? null : 'tactic')}><span className="mc-tac-ico">🎛</span><span className="col" style={{ gap: 0, alignItems: 'flex-start' }}><b>Style</b><span className="tiny muted">Plan, tackling, offside trap</span></span></button>
              <button className={`mc-tac ${panel === 'sub' ? 'on' : ''}`} disabled={subsUsed(mineSide) >= 5} onClick={() => setPanel(panel === 'sub' ? null : 'sub')}><span className="mc-tac-ico">🔁</span><span className="col" style={{ gap: 0, alignItems: 'flex-start' }}><b>Substitution</b><span className="tiny muted">{5 - subsUsed(mineSide)} left</span></span></button>
            </>
          ) : (
            <>
              <span className="kicker">Match stats</span>
              <LiveStats d={d} gm={gm} shown={seen} shots={rep.shots || []} flow={rep.flow || []} />
            </>
          )}
        </aside>
      </div>
      <div className="mc-bottom mc-wide">
        <section className="panel"><span className="kicker">Live commentary</span><div className="mc-scroll"><Commentary shown={seen} /></div></section>
        <section className="panel"><span className="kicker">{canChange ? 'Match stats' : 'Key events'}</span><div className="mc-scroll">{canChange ? <LiveStats d={d} gm={gm} shown={seen} shots={rep.shots || []} flow={rep.flow || []} /> : <KeyEvents d={d} shown={seen} />}</div></section>
        {canChange && <section className="panel"><span className="kicker">Key events</span><div className="mc-scroll"><KeyEvents d={d} shown={seen} /></div></section>}
        <section className="panel"><span className="kicker">Current formation</span><Formation d={d} side={formSide} shown={seen} /></section>
      </div>
      {canChange && (
        <div className="row mc-actions mc-narrow">
          {tactics.map((x) => <button key={x.k} className="seg" style={{ minHeight: 40, background: 'rgba(95, 211, 243,0.2)', color: '#A8E8F8' }} onClick={x.go}><span>{x.ico} {x.t}</span></button>)}
          <button className={`seg ${panel === 'tactic' ? 'on' : ''}`} style={{ minHeight: 40 }} onClick={() => setPanel(panel === 'tactic' ? null : 'tactic')}><span>Style</span></button>
          <button className={`seg ${panel === 'sub' ? 'on' : ''}`} style={{ minHeight: 40 }} disabled={subsUsed(mineSide) >= 5} onClick={() => setPanel(panel === 'sub' ? null : 'sub')}><span>Substitution ({5 - subsUsed(mineSide)})</span></button>
        </div>
      )}
      {panel === 'tactic' && (
        <div className="panel cut mc-pop" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {Object.keys(PRESETS).map((pr) => <button key={pr} className="seg" style={{ minHeight: 36 }} onClick={() => change({ preset: pr }, `Switched to ${pr}`)}><span>{pr}</span></button>)}
          <span className="tiny muted" style={{ width: '100%', fontWeight: 900, marginTop: 4 }}>TACKLING</span>
          {TACKLE_STYLES.map((x, i) => <button key={x.name} className="seg" style={{ minHeight: 36 }} onClick={() => change({ tackle: i }, `${x.face} ${x.name}`)}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 20 }}>{x.face}</span>{x.short}</span></button>)}
          <span className="tiny muted" style={{ width: '100%', fontWeight: 900, marginTop: 4 }}>OFFSIDE TRAP</span>
          <button className="seg" style={{ minHeight: 36 }} onClick={() => change({ trap: 1 }, '🚩 Offside trap on')}><span>🚩 Trap on</span></button>
          <button className="seg" style={{ minHeight: 36 }} onClick={() => change({ trap: 0 }, 'Offside trap off')}><span>Trap off</span></button>
        </div>
      )}
      {panel === 'sub' && (
        <div className="panel cut mc-pop" style={{ gap: 6 }}>
          <span className="kicker">{subOut ? 'Who comes on?' : 'Who comes off?'}</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {(subOut ? bench : on).map((id) => {
              const pl = d.names[id];
              return <button key={id} className={`bench ${subOut === id ? 'sel' : ''}`} style={{ width: 84 }} onClick={() => (subOut ? change({ kind: 'sub', out: subOut, in: id }, `${lastName(pl?.name || '')} comes on`) : setSubOut(id))}><b>{pl?.ovr ?? ''}</b><small>{lastName(pl?.name || '?')} · {pl?.pos}</small></button>;
            })}
          </div>
          {subOut && <button className="tiny muted" onClick={() => setSubOut(null)}>‹ choose another player</button>}
        </div>
      )}
      {toast.node}
    </div>
  );
}

// only the pitch redraws every frame (a smooth clock between the page's ticks)
function SmoothPitch({ d, gm, rate, plan, mineSide }: { d: any; gm: number; rate: number; plan: ReturnType<typeof usePlan>; mineSide: number }) {
  const t = useSmoothClock(gm, rate);
  return <Pitch2D d={d} t={t} plan={plan} mineSide={mineSide} />;
}

function Crowd({ color, alt, top, loud }: { color: string; alt: string; top?: boolean; loud: boolean }) {
  return (
    <div className="crowd" style={top ? { top: 0 } : { bottom: 0, alignItems: 'flex-start' }}>
      {Array.from({ length: 40 }, (_, i) => (
        <i key={i} style={{ background: (i * 7 + (top ? 1 : 3)) % 5 === 0 ? alt : color, opacity: loud ? 1 : 0.7, animation: `${loud ? 'bobBig 0.35s' : 'bob 1.4s'} ease-in-out ${((i * 0.07) % 0.7).toFixed(2)}s infinite` }} />
      ))}
    </div>
  );
}

// Moving players: both teams shift with the ball, which leans toward whoever attacks next and flies
// at goal just before a chance. Shirt numbers on every player; the man on the ball is named.
function Dots({ d, gm, events, revealed }: { d: any; gm: number; events: Ev[]; revealed: number }) {
  const rep = d.report;
  const fh = FORMATIONS[rep.lineups?.[0]?.formation || '4-3-3'];
  const fa = FORMATIONS[rep.lineups?.[1]?.formation || '4-3-3'];
  const next = events.slice(revealed).find((e) => ['goal', 'save', 'miss', 'penalty', 'penmiss', 'var'].includes(e.type));
  const t = gm * 7.3;
  let push = Math.sin(t * 0.21) * 0.45 + Math.sin(t * 0.077) * 0.35;
  const soon = next && next.m >= gm ? next.m - gm : 99;
  if (soon < 2.2) push = next!.side === 0 ? 0.95 : -0.95;
  let bx = 50 + push * 38 + Math.sin(t * 0.9) * 4;
  let by = 50 + Math.sin(t * 0.53) * 24 + Math.cos(t * 0.31) * 6;
  if (soon < 0.5) { bx = next!.side === 0 ? 95 : 5; by = 47 + Math.sin(t) * 5; } // the shot
  const clampY = (y: number) => Math.max(14, Math.min(86, y));
  const pos = (side: 0 | 1, x: number, y: number, i: number): [number, number] => side === 0
    ? [Math.max(3, Math.min(97, x * 0.9 + 3 + (i ? push * 14 + (bx - 50) * 0.08 : 0))), clampY(y + (by - y) * (i ? 0.12 : 0.05) + Math.sin(t * 0.4 + i) * 1.5)]
    : [Math.max(3, Math.min(97, 100 - (x * 0.9 + 3) + (i ? push * 14 + (bx - 50) * 0.08 : 0))), clampY(100 - y + (by - (100 - y)) * (i ? 0.12 : 0.05) + Math.cos(t * 0.4 + i) * 1.5)];
  const ids = (side: 0 | 1) => rep.lineups?.[side]?.xi || [];
  const home = fh.xy.map(([x, y]: number[], i: number) => ({ side: 0 as const, i, id: ids(0)[i], xy: pos(0, x, y, i) }));
  const away = fa.xy.map(([x, y]: number[], i: number) => ({ side: 1 as const, i, id: ids(1)[i], xy: pos(1, x, y, i) }));
  // who has the ball: the nearest player of the side that is attacking
  const att = push >= 0 ? home : away;
  const carrier = att.reduce((best: any, p: any) => { const dd = (p.xy[0] - bx) ** 2 + (p.xy[1] - by) ** 2; return !best || dd < best.dd ? { ...p, dd } : best; }, null);
  const carrierName = carrier?.id ? lastName(d.names[carrier.id]?.name || '') : '';
  const dot = (p: any) => {
    const team = p.side === 0 ? d.home : d.away;
    const no = p.id ? d.names[p.id]?.num ?? shirt(p.id, d.names[p.id]?.pos || 'CM') : '';
    return (
      <span key={`${p.side}${p.i}`} style={{ position: 'absolute', left: `${p.xy[0]}%`, top: `${p.xy[1]}%`, width: 17, height: 17, marginLeft: -8.5, marginTop: -8.5, borderRadius: '50%', background: team.color1, boxShadow: `0 0 0 2px ${team.kit2 || (p.side ? '#151018' : '#E8F1FA')}`, transition: 'left .25s linear, top .25s linear', zIndex: 2, display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 900, color: contrastInk(team.color1) }}>{no}
        {p.id && p.id === rep.lineups?.[p.side]?.captain && <i aria-label="Captain" style={{ position: 'absolute', right: -6, top: -6, width: 10, height: 10, borderRadius: '50%', background: '#F2C14E', color: '#06121F', fontSize: 7, fontStyle: 'normal', display: 'grid', placeItems: 'center', fontWeight: 900 }}>C</i>}</span>
    );
  };
  return (
    <>
      {home.map(dot)}
      {away.map(dot)}
      {carrier && carrierName && soon >= 0.5 && (
        <span className="tiny" style={{ position: 'absolute', left: `${carrier.xy[0]}%`, top: `calc(${carrier.xy[1]}% - 22px)`, transform: 'translateX(-50%)', zIndex: 4, padding: '0 5px', background: 'rgba(8, 18, 32,0.8)', fontWeight: 800, whiteSpace: 'nowrap', transition: 'left .25s linear, top .25s linear', pointerEvents: 'none' }}>{carrierName}</span>
      )}
      <span style={{ position: 'absolute', left: `${bx}%`, top: `${clampY(by)}%`, width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5, borderRadius: '50%', background: '#fff', boxShadow: '0 0 8px #fff', transition: soon < 0.5 ? 'left .35s ease-in, top .35s ease-in' : 'left .2s linear, top .2s linear', zIndex: 3 }} />
    </>
  );
}

// dark or light shirt numbers, whichever reads better on the shirt
function contrastInk(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt((hex || '#000000').slice(i, i + 2), 16) || 0);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#151018' : '#fff';
}

function FxOverlay({ e, d, mineSide, names }: { e: Ev; d: any; mineSide: number; names: any }) {
  const team = e.side === 0 ? d.home : d.away;
  const forMe = mineSide < 0 ? true : e.side === mineSide;
  const who = (id?: string) => (id ? names[id]?.name || '' : '');
  const conf = ['#FFE48A', '#E8438C', '#7FE9F7', '#F3EEFF', '#7CE3A1'];
  const minute = fmtMin(e.m);
  if (e.type === 'goal' && forMe) {
    return (
      <div className="ov" style={{ animation: 'flashP 1s ease-out forwards' }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 600, height: 600, borderRadius: '50%', background: 'repeating-conic-gradient(rgba(255,228,138,0.25) 0deg 8deg, transparent 8deg 22deg)', animation: 'spin 6s linear infinite', WebkitMask: 'radial-gradient(circle, #000 0 15%, transparent 60%)', mask: 'radial-gradient(circle, #000 0 15%, transparent 60%)' }} />
        <span className="big" style={{ fontSize: 'min(92px, 18vw)', color: '#FFE48A', textShadow: `0 4px 0 ${team.color1}, 0 0 30px rgba(255,228,138,0.8)`, animation: 'boom 0.8s cubic-bezier(.3,1.4,.5,1) both' }}>GOAL!</span>
        <span style={{ fontSize: 16, fontWeight: 900, animation: 'fadeUp .4s .5s both' }}>{who(e.pid)} · {minute}</span>
        <span className="tiny" style={{ fontWeight: 800, animation: 'fadeUp .4s .7s both' }}>{team.name}{e.pid2 ? ` · assist ${lastName(who(e.pid2))}` : ''}</span>
        {Array.from({ length: 24 }).map((_, i) => <span key={i} className="conf" style={{ left: `${(i * 37) % 100}%`, background: conf[i % 5], animationDelay: `${((i * 0.06) % 0.8).toFixed(2)}s` }} />)}
      </div>
    );
  }
  if (e.type === 'goal') {
    return (
      <div className="ov" style={{ background: 'rgba(6, 14, 26,0.55)', animation: 'vign 1.6s ease-out forwards' }}>
        <span className="big" style={{ fontSize: 70, color: 'var(--dim)', animation: 'shake .6s ease both' }}>GOAL</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--soft)', animation: 'fadeUp .4s .4s both' }}>{who(e.pid)} scores for {team.name}</span>
        <span className="tiny" style={{ fontWeight: 700, color: '#5FD3F3', animation: 'fadeUp .4s .7s both' }}>Momentum swings to them</span>
      </div>
    );
  }
  if (e.type === 'yellow') {
    return (
      <div className="ov" style={{ perspective: 600, background: 'rgba(6, 14, 26,0.35)' }}>
        <div style={{ width: 70, height: 96, background: 'linear-gradient(135deg,#FFE86B,#F2C14E)', borderRadius: 6, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', animation: 'cardIn .8s cubic-bezier(.3,1.3,.5,1) both' }} />
        <span className="lz" style={{ fontSize: 26, color: '#FFE86B', animation: 'fadeUp .4s .5s both' }}>Yellow card</span>
        <span style={{ fontSize: 13, fontWeight: 800, animation: 'fadeUp .4s .7s both' }}>{who(e.pid)} · {team.name}</span>
      </div>
    );
  }
  if (e.type === 'red') {
    return (
      <div className="ov" style={{ animation: 'flashR 1.4s ease-out forwards' }}>
        <div style={{ width: 80, height: 110, background: 'linear-gradient(135deg,#FF4A5E,#C8142C)', borderRadius: 6, boxShadow: '0 0 40px rgba(255,40,60,0.8)', animation: 'slam .55s cubic-bezier(.3,1.3,.5,1) both' }} />
        <span className="lz" style={{ fontSize: 30, color: '#FFB3BC', animation: 'shake .5s .4s both' }}>SENT OFF</span>
        <span style={{ fontSize: 13, fontWeight: 800, animation: 'fadeUp .4s .7s both' }}>{who(e.pid)} · {team.name} down to 10</span>
      </div>
    );
  }
  if (e.type === 'injury') {
    return (
      <div className="ov" style={{ background: 'rgba(6, 14, 26,0.45)' }}>
        <div style={{ position: 'relative', width: 70, height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ position: 'absolute', inset: 0, border: '3px solid #2EE6A0', borderRadius: '50%', animation: 'ringOut 1.2s ease-out infinite' }} />
          <svg width="54" height="54" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="4" fill="#E8F1FA" /><path d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z" fill="#1F9D55" /></svg>
        </div>
        <span className="lz" style={{ fontSize: 24, color: '#2EE6A0' }}>Injury</span>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{who(e.pid)} · {team.name}</span>
        <svg width="70" height="22" viewBox="0 0 70 22" aria-hidden="true" style={{ animation: 'stretcher 2.4s linear both' }}><rect x="4" y="6" width="62" height="6" rx="2" fill="#E8F1FA" /><circle cx="14" cy="17" r="4" fill="#B8C9DA" /><circle cx="56" cy="17" r="4" fill="#B8C9DA" /></svg>
      </div>
    );
  }
  if (e.type === 'penalty') {
    return (
      <div className="ov" style={{ background: 'rgba(6, 14, 26,0.5)' }}>
        <span style={{ position: 'absolute', width: 120, height: 120, border: '3px solid #E8F1FA', borderRadius: '50%', animation: 'ringOut .9s ease-out 2' }} />
        <span className="big" style={{ fontSize: 'min(64px, 13vw)', color: '#E8F1FA', animation: 'zoomIn .9s cubic-bezier(.2,.9,.3,1) both' }}>PENALTY!</span>
        <svg width="160" height="70" viewBox="0 0 160 70" aria-hidden="true" style={{ animation: 'fadeUp .4s .6s both' }}><path d="M20 10h120v40" fill="none" stroke="#E8F1FA" strokeWidth="3" /><path d="M20 10v40" stroke="#E8F1FA" strokeWidth="3" /><circle cx="80" cy="62" r="5" fill="#E8F1FA" style={{ animation: 'ballUp .7s 1.3s ease-in forwards' }} /></svg>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{team.name}</span>
      </div>
    );
  }
  if (e.type === 'penmiss' || e.type === 'save' || e.type === 'miss') {
    return (
      <div className="ov" style={{ zIndex: 6, background: 'radial-gradient(circle, rgba(6, 14, 26,0) 30%, rgba(6, 14, 26,0.8) 85%)' }}>
        <span className="big" style={{ fontSize: 48, color: '#E8F1FA', animation: 'beat 1s ease-in-out' }}>{e.type === 'save' ? 'WHAT A SAVE' : e.type === 'penmiss' ? 'NO GOAL!' : 'BIG CHANCE'}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--cyan)' }}>{e.text}</span>
      </div>
    );
  }
  if (e.type === 'sub') {
    const p1 = names[e.pid || ''], p2 = names[e.pid2 || ''];
    return (
      <div className="ov" style={{ background: 'rgba(6, 14, 26,0.5)', gap: 10 }}>
        <span className="lz" style={{ fontSize: 22, color: 'var(--cyan)', animation: 'fadeUp .3s both' }}>Substitution · {team.name}</span>
        <div className="row" style={{ gap: 8, padding: '8px 16px', background: 'rgba(46, 230, 160,0.25)', animation: 'outL .9s .5s ease forwards' }}><span style={{ color: 'var(--red)', fontWeight: 900 }}>▼ OUT</span><b>{p2?.name}</b><span className="lz" style={{ color: 'var(--soft)' }}>{p2?.ovr}</span></div>
        <div className="row" style={{ gap: 8, padding: '8px 16px', background: 'rgba(46, 230, 160,0.25)', animation: 'inR .7s .7s cubic-bezier(.3,1.3,.5,1) both' }}><span style={{ color: '#2EE6A0', fontWeight: 900 }}>▲ IN</span><b>{p1?.name}</b><span className="lz" style={{ color: '#2EE6A0' }}>{p1?.ovr}</span></div>
        <span className="tiny" style={{ color: 'var(--soft)', fontWeight: 700 }}>{e.text.startsWith("Manager") ? 'Manager’s decision' : 'Assistant’s decision'}</span>
      </div>
    );
  }
  if (e.type === 'var') {
    return (
      <div className="ov" style={{ background: 'rgba(4, 10, 20,0.75)', gap: 8 }}>
        <div style={{ position: 'relative', width: 190, height: 110, border: '3px solid #5FD3F3', background: 'repeating-linear-gradient(0deg, rgba(95, 211, 243,0.08) 0 2px, transparent 2px 6px)', overflow: 'hidden' }}>
          <span style={{ position: 'absolute', left: 0, right: 0, height: 3, background: '#5FD3F3', boxShadow: '0 0 12px #5FD3F3', animation: 'varScan 1.1s ease-in-out 2 alternate' }} />
          <span className="lz" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 40, color: '#5FD3F3', letterSpacing: 4 }}>VAR</span>
        </div>
        <span className="lz" style={{ fontSize: 20, color: '#E8F1FA', animation: 'fadeUp .4s 1.4s both' }}>{e.text.includes('overturns') ? 'PENALTY OVERTURNED' : 'GOAL RULED OUT'}</span>
        <span className="tiny" style={{ fontWeight: 800, color: 'var(--soft)', animation: 'fadeUp .4s 1.7s both', maxWidth: '80%', textAlign: 'center' }}>{e.text}</span>
      </div>
    );
  }
  if (e.type === 'freekick') {
    return (
      <div className="ov" style={{ background: 'rgba(6, 14, 26,0.4)' }}>
        <svg width="150" height="60" viewBox="0 0 150 60" aria-hidden="true">{[0, 1, 2, 3].map((i) => <rect key={i} x={50 + i * 12} y="10" width="9" height="34" rx="4" fill={team.color1} stroke="#E8F1FA" strokeWidth="1.5" style={{ animation: `fadeUp .3s ${i * 0.08}s both` }} />)}<circle cx="20" cy="50" r="5" fill="#fff" style={{ animation: 'ballUp .8s .6s ease-in forwards' }} /></svg>
        <span className="lz" style={{ fontSize: 26, color: '#F2C14E', animation: 'zoomIn .6s both' }}>FREE KICK</span>
        <span className="tiny" style={{ fontWeight: 800 }}>{e.text}</span>
      </div>
    );
  }
  if (e.type === 'tactic') {
    return <div className="ov" style={{ background: 'rgba(6, 14, 26,0.35)' }}><span className="kicker" style={{ color: '#E8F1FA' }}>Change of plan</span><span className="lz" style={{ fontSize: 24, color: 'var(--cyan)', animation: 'fadeUp .5s both', maxWidth: '80%' }}>{e.text}</span></div>;
  }
  if (e.type === 'offside') {
    return <div className="ov" style={{ background: 'rgba(6, 14, 26,0.35)' }}><span className="big" style={{ fontSize: 46, color: '#F2C14E', animation: 'stamp .5s both' }}>🚩 OFFSIDE!</span><span className="small" style={{ fontWeight: 800 }}>{e.text}</span></div>;
  }
  if (e.type === 'trap') {
    return <div className="ov" style={{ background: 'rgba(6, 14, 26,0.35)' }}><span className="big" style={{ fontSize: 40, animation: 'zoomIn .6s both' }}>TRAP BEATEN!</span><span className="small" style={{ fontWeight: 800 }}>{e.text}</span></div>;
  }
  if (e.type === 'ht' || e.type === 'ft' || e.type === 'pens') {
    return <div className="ov" style={{ background: 'rgba(6, 14, 26,0.55)' }}><span className="big" style={{ fontSize: 52, animation: 'zoomIn .8s both' }}>{e.type === 'ht' ? 'HALF-TIME' : e.type === 'pens' ? 'PENALTIES' : 'FULL TIME'}</span><span className="small" style={{ fontWeight: 800 }}>{e.text}</span></div>;
  }
  return null;
}

// ---------------------------------------------------------------- full time
function FullTime({ d, skipped, reload }: { d: any; skipped: boolean; reload?: () => void }) {
  const rep = d.report;
  const s = rep.stats;
  const [hg, ag] = rep.score;
  const mine = d.home.mine ? 0 : d.away.mine ? 1 : -1;
  const won = mine >= 0 && (rep.winner !== undefined ? rep.winner === mine : rep.score[mine] > rep.score[1 - mine]);
  const lost = mine >= 0 && (rep.winner !== undefined ? rep.winner !== mine : rep.score[mine] < rep.score[1 - mine]);
  const res = mine < 0 ? null : won ? 'WIN' : lost ? 'LOSS' : 'DRAW';
  useEffect(() => {
    if (!skipped) {
      // the final whistle, the crowd's verdict, then the stadium empties and the music returns
      play(res === 'LOSS' ? 'boo' : res === 'WIN' ? 'goal' : 'applause', { gain: res === 'WIN' ? 0.8 : 0.7, delay: 0.6 });
      if (res === 'WIN') play(d.derby ? 'chant-derby' : 'chant', { delay: 5, gain: 0.8 });
    }
    const t = setTimeout(() => { crowdBed(null); music(d.derby && res === 'WIN' ? 'derby' : 'menu'); }, skipped ? 0 : res === 'WIN' ? 12000 : 5000);
    return () => clearTimeout(t);
  }, []);
  const motm = rep.players.find((p: any) => p.id === rep.motm);
  const name = (id?: string) => (id ? d.names[id]?.name || '' : '');
  const key = rep.events.filter((e: Ev) => ['goal', 'red', 'yellow', 'penmiss', 'injury', 'sub', 'tactic', 'var'].includes(e.type));
  const bars: [string, number, number, (v: number) => string][] = [
    ['Possession', s.poss[0], s.poss[1], (v) => `${v}%`], ['Shots', s.shots[0], s.shots[1], String], ['On target', s.onTarget[0], s.onTarget[1], String],
    ['Expected goals', s.xg[0], s.xg[1], (v) => v.toFixed(2)], ['Corners', s.corners[0], s.corners[1], String], ['Yellow cards', s.yellows[0], s.yellows[1], String],
  ];
  const icon = (e: Ev) => {
    const c = e.type === 'goal' ? '#E8F1FA' : e.type === 'yellow' ? '#FFE86B' : e.type === 'red' ? '#FF4A5E' : e.type === 'injury' ? '#2EE6A0' : e.type === 'sub' ? '#5FD3F3' : '#A9C8F0';
    if (e.type === 'goal') return <span style={{ width: 12, height: 12, borderRadius: '50%', background: c, flex: 'none' }} />;
    if (e.type === 'yellow' || e.type === 'red') return <span style={{ width: 10, height: 13, background: c, flex: 'none' }} />;
    if (e.type === 'sub') return <span style={{ color: c, fontWeight: 900, width: 12, flex: 'none' }}>⇅</span>;
    if (e.type === 'injury') return <span style={{ color: c, fontWeight: 900, width: 12, flex: 'none' }}>✚</span>;
    if (e.type === 'var') return <span style={{ width: 12, flex: 'none', fontSize: 11 }} aria-label="VAR">📺</span>;
    return <span style={{ width: 11, height: 11, transform: 'rotate(45deg)', background: c, flex: 'none' }} />;
  };
  const isAst = (e: Ev) => (e.type === 'sub' && !e.text.startsWith("Manager")) || (e.type === 'tactic' && !e.text.includes('switch to'));
  const txt = (e: Ev) => {
    if (e.type === 'goal') return `${lastName(name(e.pid))} scores · ${countUpTo(rep.events, e)}`;
    if (e.type === 'sub') return `${lastName(name(e.pid2))} off, ${lastName(name(e.pid))} on`;
    if (e.type === 'yellow') return `${lastName(name(e.pid))} booked`;
    if (e.type === 'red') return `${lastName(name(e.pid))} sent off`;
    if (e.type === 'injury') return `${lastName(name(e.pid))} injured`;
    return e.text;
  };
  const ratings = rep.players.filter((p: any) => p.mins > 0 && (mine < 0 ? p.side === 0 : p.side === mine)).sort((a: any, b: any) => b.r - a.r);
  const so = rep.shootout;
  return (
    <div style={{ padding: '8px 14px 16px', minHeight: '100dvh', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', maxWidth: 1320, margin: '0 auto' }}>
      <header className="ft-head" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto minmax(0, 1fr) auto', alignItems: 'center', gap: 12 }}>
        <Back d={d} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, minWidth: 0 }}><span className="lz ellipsis tname" style={{ fontSize: 22 }}>{d.home.name}</span><Crest c1={d.home.color1} c2={d.home.color2} size={40} shape={d.home.shape} emblem={d.home.human ? d.home.emblem : -1} short={d.home.short} /></div>
        <div className="col" style={{ alignItems: 'center', gap: 0 }}>
          <span className="lz" style={{ fontSize: 46, lineHeight: 1, animation: 'pop .6s both', whiteSpace: 'nowrap' }}>{hg} – {ag}</span>
          <span className="tiny" style={{ color: 'var(--mint)', fontWeight: 900 }}>{so ? `${rep.winner === 0 ? d.home.name : d.away.name} win ${Math.max(...so.score)}–${Math.min(...so.score)} on penalties` : res ? `FULL TIME · ${res}` : 'FULL TIME'}</span>
        </div>
        <div className="row" style={{ gap: 10, minWidth: 0 }}><Crest c1={d.away.color1} c2={d.away.color2} size={40} shape={d.away.shape} emblem={d.away.human ? d.away.emblem : -1} short={d.away.short} /><span className="lz ellipsis tname" style={{ fontSize: 22 }}>{d.away.name}</span></div>
        {skipped ? <span className="tag cyan simtag"><span>SIMULATED · YOU SKIPPED</span></span> : <span className="simtag"><KitPair d={d} size={26} /></span>}
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, flex: 1 }}>
        <section className="panel cut" style={{ gap: 4, overflowY: 'auto', maxHeight: 330 }}>
          <span className="kicker">What happened · <span style={{ color: 'var(--cyan)' }}>AST</span> = your assistant</span>
          {key.length === 0 && <span className="small muted">A quiet one.</span>}
          {key.map((e: Ev, i: number) => (
            <div key={i} className="row small" style={{ gap: 8, fontWeight: 800, color: e.type === 'goal' ? (e.side === mine || mine < 0 ? 'var(--mint)' : '#FF8A80') : undefined }}>
              <b style={{ width: 38, color: 'var(--cyan)' }}>{fmtMin(e.m)}</b>{icon(e)}<span className="grow ellipsis">{txt(e)} <span className="tiny muted">{e.side === 0 ? d.home.short : d.away.short}</span></span>
              {isAst(e) && (e.side === mine) && <span className="tag" style={{ height: 16, fontSize: 11, background: 'rgba(95, 211, 243,0.25)', color: '#5FD3F3' }}><span>AST</span></span>}
            </div>
          ))}
          {so && (
            <div className="col" style={{ gap: 3, marginTop: 4 }}>
              {[0, 1].map((side) => (
                <div key={side} className="row tiny" style={{ gap: 4, fontWeight: 900 }}>
                  <span style={{ width: 36 }}>{side === 0 ? d.home.short : d.away.short}</span>
                  {so.kicks.filter((k: any) => k.side === side).map((k: any, i: number) => <span key={i} title={name(k.pid)} style={{ width: 16, height: 16, borderRadius: '50%', display: 'grid', placeItems: 'center', background: k.scored ? '#2EE6A0' : 'var(--red)', color: '#06121F', fontSize: 11, animation: `pop .3s ${i * 0.15}s both` }}>{k.scored ? '✓' : '✕'}</span>)}
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel cut" style={{ gap: 7 }}>
          <span className="kicker">Match stats</span>
          {bars.map(([l, a, b, f]) => (
            <div key={l} className="col" style={{ gap: 2 }}>
              <div className="row tiny between" style={{ fontWeight: 900 }}><b>{f(a)}</b><span className="muted">{l}</span><b>{f(b)}</b></div>
              <div className="row" style={{ gap: 3 }}>
                <div className="bar" style={{ direction: 'rtl' }}><i style={{ width: `${(a / Math.max(0.01, a + b)) * 100}%`, background: 'var(--mint)' }} /></div>
                <div className="bar"><i style={{ width: `${(b / Math.max(0.01, a + b)) * 100}%`, background: 'color-mix(in srgb, var(--mint) 55%, #0A1626)' }} /></div>
              </div>
            </div>
          ))}
          <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
            <a className="ghost grow" href={`/m/${d.fixture.id}`}><span>Replay</span></a>
            <a className="cta grow" href={`/l/${d.fixture.leagueId}`}><span>Continue</span></a>
          </div>
        </section>
        <section className="col" style={{ gap: 8 }}>
          {motm && (
            <div className="panel cut" style={{ gap: 2, background: 'linear-gradient(160deg, rgba(242,193,78,0.2), rgba(242,193,78,0.04))' }}>
              <div className="row between"><span className="tiny" style={{ fontWeight: 900, color: '#F2C14E' }}>MAN OF THE MATCH</span><span className="lz" style={{ fontSize: 26, color: '#F2C14E' }}>{motm.r.toFixed(1)}</span></div>
              <b className="lz" style={{ fontSize: 20 }}>{name(motm.id)}</b>
              <span className="tiny muted">{motm.g ? `${motm.g} goal${motm.g > 1 ? 's' : ''} · ` : ''}{motm.a ? `${motm.a} assist · ` : ''}{motm.side === 0 ? d.home.name : d.away.name}</span>
            </div>
          )}
          <div className="panel cut" style={{ gap: 2 }}>
            <span className="kicker">{mine >= 0 ? 'Your ratings' : 'Ratings'}</span>
            {ratings.slice(0, 8).map((p: any) => (
              <div key={p.id} className="row small between" style={{ fontWeight: 800 }}><span className="ellipsis">{name(p.id)}{p.g ? ` ⚽${p.g > 1 ? p.g : ''}` : ''}{p.inj ? ' ✚' : ''}</span><b style={{ color: p.r >= 7.5 ? '#2EE6A0' : p.r < 6 ? '#FF8A80' : undefined }}>{p.r.toFixed(1)}</b></div>
            ))}
          </div>
          {mine >= 0 && <div className="tiny" style={{ padding: '6px 10px', background: 'color-mix(in srgb, var(--mint) 12%, transparent)', fontWeight: 800, color: 'var(--mint)' }}>{won ? '+10 coins · fans up · board +3' : lost ? '+3 coins · fans down · board −4' : '+5 coins · fans steady'}</div>}
        </section>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {rep.shots?.length ? <ShotMap d={d} /> : null}
        {rep.shots?.length ? <XgRace d={d} /> : null}
        {mine >= 0 && d.fixture.status === 'done' && <Press d={d} reload={reload} />}
      </div>
    </div>
  );
}

// Every shot where it was taken: bigger circle = better chance, filled = goal.
function ShotMap({ d }: { d: any }) {
  const shots = d.report.shots as any[];
  const col = (s: number) => (s === 0 ? d.kits[0].c1 : d.kits[1].c1);
  return (
    <section className="panel cut" style={{ gap: 4 }}>
      <div className="row between"><span className="kicker">Shot map</span><span className="tiny muted">size = xG · filled = goal</span></div>
      <svg viewBox="0 0 100 64" style={{ width: '100%', background: '#1F6B45', display: 'block' }} role="img" aria-label="Shot map">
        <g fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.4">
          <rect x="1" y="1" width="98" height="62" /><path d="M50 1v62" /><circle cx="50" cy="32" r="7" />
          <rect x="1" y="17" width="14" height="30" /><rect x="85" y="17" width="14" height="30" />
          <rect x="1" y="25" width="5" height="14" /><rect x="94" y="25" width="5" height="14" />
        </g>
        {shots.map((s, i) => {
          const r = 0.9 + Math.sqrt(s.xg) * 4.2;
          return <circle key={i} cx={s.x} cy={2 + s.y * 0.6} r={r} fill={s.goal ? col(s.side) : 'none'} stroke={s.goal ? '#fff' : col(s.side)} strokeWidth={s.goal ? 0.5 : 0.7} opacity={s.goal ? 1 : 0.85}><title>{`${s.m}' ${s.kind} · xG ${s.xg}${s.goal ? ' · GOAL' : ''}`}</title></circle>;
        })}
      </svg>
      <div className="row tiny between" style={{ fontWeight: 800 }}><span>← {d.away.short} attack</span><span>{d.home.short} attack →</span></div>
    </section>
  );
}

// Cumulative expected goals through the match, with goals marked.
function XgRace({ d }: { d: any }) {
  const shots = [...(d.report.shots as any[])].sort((a, b) => a.m - b.m);
  const W = 100, H = 50;
  const lines: [number, number][][] = [[[0, 0]], [[0, 0]]];
  const tot = [0, 0];
  for (const s of shots) { lines[s.side].push([s.m, tot[s.side]]); tot[s.side] += s.xg; lines[s.side].push([s.m, tot[s.side]]); }
  lines[0].push([93, tot[0]]); lines[1].push([93, tot[1]]);
  const max = Math.max(1, tot[0], tot[1]) * 1.1;
  const pt = ([m, v]: [number, number]) => `${(Math.min(93, m) / 93) * W},${H - (v / max) * H}`;
  const col = (s: number) => (s === 0 ? d.kits[0].c1 : d.kits[1].c1);
  return (
    <section className="panel cut" style={{ gap: 4 }}>
      <div className="row between"><span className="kicker">xG race</span><span className="tiny" style={{ fontWeight: 900 }}>{tot[0].toFixed(2)} – {tot[1].toFixed(2)}</span></div>
      <svg viewBox={`-2 -3 ${W + 4} ${H + 10}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="Expected goals over time">
        <path d={`M0 ${H}H${W}`} stroke="rgba(255,255,255,0.25)" strokeWidth="0.4" />
        <path d={`M${(45 / 93) * W} 0V${H}`} stroke="rgba(255,255,255,0.15)" strokeWidth="0.4" strokeDasharray="1 1" />
        {[0, 1].map((s) => <polyline key={s} points={lines[s].map(pt).join(' ')} fill="none" stroke={col(s)} strokeWidth="1.2" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.6))' }} />)}
        {shots.filter((s) => s.goal).map((s, i) => { const before = shots.filter((x) => x.side === s.side && x.m <= s.m).reduce((a, x) => a + x.xg, 0); return <circle key={i} cx={(Math.min(93, s.m) / 93) * W} cy={H - (before / max) * H} r="1.8" fill={col(s.side)} stroke="#fff" strokeWidth="0.5" />; })}
        <text x="0" y={H + 6} fontSize="4" fill="#8FA6BF">0'</text><text x={(45 / 93) * W - 3} y={H + 6} fontSize="4" fill="#8FA6BF">45'</text><text x={W - 6} y={H + 6} fontSize="4" fill="#8FA6BF">90'</text>
      </svg>
      <div className="row tiny" style={{ gap: 12, fontWeight: 800 }}><span><i style={{ display: 'inline-block', width: 10, height: 3, background: col(0), marginRight: 4, verticalAlign: 'middle' }} />{d.home.name}</span><span><i style={{ display: 'inline-block', width: 10, height: 3, background: col(1), marginRight: 4, verticalAlign: 'middle' }} />{d.away.name}</span></div>
    </section>
  );
}

// Post-match press conference: one answer, with consequences.
function Press({ d, reload }: { d: any; reload?: () => void }) {
  const toast = useToast();
  const [res, setRes] = useState<any>(null);
  const done = d.press?.done || res;
  const ask = async (choice: string) => {
    try { const r = await api(`/api/fixtures/${d.fixture.id}/press`, { choice }); setRes(r); toast.ok('Your words are in the papers'); } catch (e: any) { toast.bad(e.message); }
  };
  return (
    <section className="panel cut" style={{ gap: 6 }}>
      <span className="kicker">Post-match press conference</span>
      {done ? (
        <>
          <div className="small" style={{ fontStyle: 'italic' }}>{res?.quote || 'You have already spoken to the press.'}</div>
          {res?.effect && <div className="tiny" style={{ color: '#5FD3F3', fontWeight: 800 }}>{res.effect}</div>}
        </>
      ) : (
        <>
          <div className="small muted">"Your thoughts on the game, coach?"</div>
          {d.press.options.map((o: any) => <button key={o.key} className="seg" style={{ minHeight: 34, justifyContent: 'flex-start' }} onClick={() => ask(o.key)}><span>{o.label}</span></button>)}
          <span className="tiny muted">Praise lifts morale. Demanding more fires them up but stings. Blaming the referee pleases fans and costs a fine.</span>
        </>
      )}
      {toast.node}
    </section>
  );
}

function countUpTo(events: Ev[], upto: Ev) {
  const s = [0, 0];
  for (const e of events) { if (e.type === 'goal') s[e.side]++; if (e === upto) break; }
  return `${s[0]}–${s[1]}`;
}

