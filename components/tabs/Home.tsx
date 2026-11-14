'use client';
import { timeLeft } from '../WindowSplash.tsx';
import { useEffect, useState } from 'react';
import { H2HLine, useRecords } from './Records.tsx';
import { api, utcMinToLocal, localToUtcMin, shirt } from '../../lib/client.ts';
import { Bar, Crest, RefBadge, Ring, lastName } from '../ui.tsx';
import type { TabProps } from './types.ts';
import { REF_LEVELS } from '../../lib/game.ts';

function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return n;
}

function countdown(to: number, now: number) {
  const s = Math.max(0, Math.floor((to - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (v: number) => String(v).padStart(2, '0');
  return d > 0 ? { main: `${d}d ${h}h`, sec: '' } : { main: `${p(h)}:${p(m)}`, sec: p(x) };
}

export default function HomeTab({ lid, d, reload, toast, go }: TabProps) {
  const { league, club, fixtures, table, news } = d;
  const now = useNow();
  if (league.status === 'setup') return <SetupHome lid={lid} d={d} reload={reload} toast={toast} go={go} />;
  const next = fixtures.find((f: any) => f.status !== 'done');
  const myRow = table.findIndex((t: any) => t.id === club.id);
  const start = Math.max(0, Math.min(table.length - 3, myRow - 1));
  const slice = table.slice(start, start + 3);
  const star = club.star;
  const done = (fixtures as any[]).filter((f) => f.status === 'done');
  const res = (f: any) => { const my = f.home_id === club.id ? [f.home_goals, f.away_goals] : [f.away_goals, f.home_goals]; return f.winner_id ? (f.winner_id === club.id ? 'W' : 'L') : my[0] > my[1] ? 'W' : my[0] < my[1] ? 'L' : 'D'; };
  const form = done.slice(-5).map(res);
  let unb = 0; for (let i = done.length - 1; i >= 0 && res(done[i]) !== 'L'; i--) unb++;
  const upcoming = (fixtures as any[]).filter((f) => f.status !== 'done').slice(0, 4);
  return (
    <div className="col" style={{ gap: 14, minHeight: '100%' }}>
      <div className="h2-top">
        {next ? <NextMatch f={next} club={club} now={now} go={go} lid={lid} /> : league.status === 'finished' || league.status === 'rolling'
          ? <SeasonOver lid={lid} d={d} reload={reload} toast={toast} go={go} />
          : <div className="panel cut lz" style={{ fontSize: 22, justifyContent: 'center' }}>No more matches</div>}
        {league.status === 'running' ? <Today lid={lid} go={go} stamp={d} /> : <span />}
      </div>
      {d.window?.open && league.status === 'running' && (
        <button className="h2-window" onClick={() => go('market')}>
          <span className="h2-ico" style={{ background: 'rgba(255,196,77,0.18)' }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFD27A" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></svg></span>
          <span className="col grow" style={{ gap: 0, minWidth: 0 }}><span className="lz" style={{ fontSize: 18, color: '#FFD27A' }}>TRANSFER WINDOW OPEN</span><span className="small muted">{d.window.round === 2 ? 'Second round' : 'First round'}. Buy, sell, loan and swap in the Market.</span></span>
          {club.offers > 0 && <span className="pill red">{club.offers} offer{club.offers > 1 ? 's' : ''} for your players</span>}
          <span className="lz" style={{ fontSize: 26, color: '#EAF2FF', whiteSpace: 'nowrap' }}>{timeLeft(d.window.closesAt)}</span>
        </button>
      )}
      <div className="h2-cards">
        <button className="h2-card" onClick={() => go('lineup')}>
          <div className="h2-art" style={{ background: 'linear-gradient(180deg, #1A6B45, #0E4A2F)' }}><ArtPitch /></div>
          <div className="h2-body"><span className="lz h2-title">Team</span><span className="small muted ellipsis">{club.tactic?.formation || '4-3-3'} · {club.tactic?.preset || 'Custom'}</span><span className="h2-link">Match plan · Squad · Training ›</span></div>
        </button>
        <button className="h2-card" onClick={() => go('tv')}>
          <div className="h2-art" style={{ background: 'radial-gradient(120px 70px at 50% 40%, #2A5FA8, #0C1F3E)' }}><ArtTv />{news.length > 0 && <span className="pill red" style={{ position: 'absolute', top: 10, right: 10 }}>{Math.min(news.length, 20)} new</span>}</div>
          <div className="h2-body"><span className="lz h2-title">Media</span><span className="small muted h2-two">{news[0]?.text || 'The matchday show, the fans and the paper.'}</span><span className="h2-link">TV · Fans · Paper ›</span></div>
        </button>
        <button className="h2-card" onClick={() => go('market')}>
          <div className="h2-art" style={{ background: 'radial-gradient(130px 80px at 50% 50%, #1D4E6E, #0C1F3E)' }}><ArtSwap /></div>
          <div className="h2-body"><span className="lz h2-title">Transfers</span><span className="small muted">{club.offers ? `${club.offers} offer${club.offers > 1 ? 's' : ''} for your players` : 'No offers waiting'}</span><span className="h2-link" style={{ color: d.window?.open ? '#FFD27A' : undefined }}>{d.window?.open ? `Window shuts in ${timeLeft(d.window.closesAt)} ›` : 'Market · Deals · Packs ›'}</span></div>
        </button>
        <button className="h2-card" onClick={() => go('press')}>
          <div className="h2-art" style={{ background: 'radial-gradient(130px 80px at 50% 60%, #3A2F6E, #0C1F3E)' }}><ArtMic /></div>
          <div className="h2-body"><span className="lz h2-title">Press room</span><span className="small muted">Face the press before the match.</span><span className="h2-link">Answer the questions ›</span></div>
        </button>
        <button className="h2-card h2-fix" onClick={() => go('fixtures')}>
          <span className="lz h2-title">Fixtures</span>
          {!upcoming.length && <span className="small muted">Nothing scheduled.</span>}
          {upcoming.map((f, i) => (
            <span key={f.id} className={`h2-fx ${i === 0 ? 'on' : ''}`}>
              <b>{new Date(f.kickoff_at).toLocaleDateString(undefined, { weekday: 'short' })}</b>
              <span className="grow ellipsis">{f.home_id === club.id ? f.away : f.home}{f.comp === 'cup' && <span style={{ color: '#FFD27A', fontSize: 11, fontWeight: 800 }}> CUP</span>}</span>
              <span className="muted">{f.home_id === club.id ? 'H' : 'A'}</span>
            </span>
          ))}
        </button>
      </div>
      <div className="h2-low">
        <section className="panel cut" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="lz grow" style={{ fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>LEAGUE TABLE</span>
            <button className="pill on" onClick={() => go('table')}>Table</button><button className="pill" onClick={() => go('leaders')}>Scorers</button><button className="pill" onClick={() => go('streaks')}>Streaks</button>
          </div>
          {slice.map((t: any) => {
            const i = table.indexOf(t) + 1, me = t.id === club.id;
            return (
              <div key={t.id} className={`h2-trow ${me ? 'me' : ''}`}>
                <b style={{ width: 22, color: me ? '#fff' : 'var(--muted)' }}>{i}</b>
                <span className="grow ellipsis" style={{ fontWeight: me ? 800 : 700, color: me ? '#fff' : 'var(--muted)' }}>{t.name}</span>
                <span style={{ width: 36, textAlign: 'right', color: 'var(--muted)' }}>{t.gf - t.ga > 0 ? `+${t.gf - t.ga}` : t.gf - t.ga}</span>
                <b style={{ width: 36, textAlign: 'right' }}>{t.pts}</b>
              </div>
            );
          })}
        </section>
        <section className="panel cut" style={{ gap: 6, justifyContent: 'center' }}>
          <span className="lz" style={{ fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>FORM</span>
          <div className="row" style={{ gap: 6 }}>
            {!form.length && <span className="small muted">No matches yet.</span>}
            {form.map((r, i) => <span key={i} className={`h2-res ${r}`}>{r}</span>)}
          </div>
          {done.length > 0 && <span className="tiny muted">{unb >= 2 ? `Unbeaten in ${unb}` : club.pos ? `${club.pos}${suffix(club.pos)} · target top ${club.targetPos}` : ''}</span>}
        </section>
        <button className="h2-motto" onClick={() => go(star ? 'players' : 'awards')}>
          <span className="script" style={{ fontSize: 30, color: 'var(--mint)', transform: 'rotate(-5deg)', transformOrigin: 'left', textShadow: '0 0 18px rgba(46,242,176,0.4)' }}>More than a club</span>
          {star && <span className="tiny" style={{ color: 'var(--muted)', fontWeight: 700 }}>Your star: <b style={{ color: '#EAF2FF' }}>{star.name}</b> · {star.ovr} · {star.goals} goals, {star.assists} assists</span>}
        </button>
      </div>
      <Inbox club={club} go={go} />
      {league.isOwner && <OwnerSchedule lid={lid} league={league} toast={toast} reload={reload} />}
      <div className="ticker" style={{ marginTop: 'auto' }}>
        <span className="lbl">NEWS</span>
        <div className="run" key={news.length}>
          {news.slice(0, 10).map((n: any, i: number) => <span key={i} className="row" style={{ gap: 10 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--mint)', transform: 'rotate(45deg)', display: 'inline-block' }} />{n.text}</span>)}
        </div>
      </div>
    </div>
  );
}

// small drawings on the shortcut cards
function ArtPitch() {
  return <svg width="100%" height="100" viewBox="0 0 260 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect x="10" y="8" width="240" height="84" fill="none" stroke="#fff" strokeOpacity="0.3" strokeWidth="1.5" /><line x1="130" y1="8" x2="130" y2="92" stroke="#fff" strokeOpacity="0.3" strokeWidth="1.5" /><circle cx="130" cy="50" r="14" fill="none" stroke="#fff" strokeOpacity="0.3" strokeWidth="1.5" /><g fill="#3FA8FF" stroke="#DDEEFF" strokeWidth="1.5">{[[30, 50], [62, 22], [58, 42], [58, 60], [62, 80], [100, 30], [96, 50], [100, 70], [150, 24], [160, 50], [150, 76]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="6" />)}</g><path d="M166 50 Q200 30 226 46" fill="none" stroke="#2EF2B0" strokeWidth="2.5" strokeDasharray="5 4" /><path d="M222 40 L230 47 L220 51 Z" fill="#2EF2B0" /></svg>;
}
function ArtTv() {
  return <svg width="100%" height="100" viewBox="0 0 260 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="#163A6A"><rect x="18" y="14" width="44" height="26" rx="3" /><rect x="66" y="14" width="44" height="26" rx="3" /><rect x="150" y="14" width="44" height="26" rx="3" /><rect x="198" y="14" width="44" height="26" rx="3" /><rect x="18" y="44" width="44" height="26" rx="3" /><rect x="198" y="44" width="44" height="26" rx="3" /></g><rect x="90" y="30" width="80" height="48" rx="4" fill="#0A1A33" stroke="#7CCBFF" strokeWidth="2" /><path d="M122 44 L142 54 L122 64 Z" fill="#2EF2B0" /><rect x="70" y="84" width="120" height="10" rx="5" fill="#FF4D63" /></svg>;
}
function ArtSwap() {
  return <svg width="100%" height="100" viewBox="0 0 260 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect x="40" y="14" width="56" height="74" rx="8" fill="#163A6A" stroke="#7CCBFF" strokeWidth="1.5" /><circle cx="68" cy="40" r="10" fill="#7CCBFF" opacity="0.5" /><path d="M50 74c3-10 10-14 18-14s15 4 18 14z" fill="#7CCBFF" opacity="0.5" /><rect x="164" y="14" width="56" height="74" rx="8" fill="#163A6A" stroke="#FFD27A" strokeWidth="1.5" /><circle cx="192" cy="40" r="10" fill="#FFD27A" opacity="0.5" /><path d="M174 74c3-10 10-14 18-14s15 4 18 14z" fill="#FFD27A" opacity="0.5" /><path d="M104 40 H152 l-8 -7 M156 62 H108 l8 7" fill="none" stroke="#2EF2B0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ArtMic() {
  return <svg width="100%" height="100" viewBox="0 0 260 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="#22305F"><rect x="20" y="16" width="30" height="20" rx="3" /><rect x="54" y="16" width="30" height="20" rx="3" /><rect x="176" y="16" width="30" height="20" rx="3" /><rect x="210" y="16" width="30" height="20" rx="3" /><rect x="20" y="40" width="30" height="20" rx="3" /><rect x="210" y="40" width="30" height="20" rx="3" /></g><rect x="60" y="74" width="140" height="16" rx="3" fill="#0A1A33" /><rect x="118" y="34" width="24" height="38" rx="12" fill="#A9BCD6" /><rect x="128" y="70" width="4" height="8" fill="#A9BCD6" /><path d="M110 54 Q110 70 130 70 Q150 70 150 54" fill="none" stroke="#A9BCD6" strokeWidth="3" /></svg>;
}

const PART_NAMES: [string, string][] = [['players', 'Players'], ['position', 'Positions'], ['form', 'Form & morale'], ['fit', 'Plan fits squad'], ['familiarity', 'Knows the shape'], ['chemistry', 'Chemistry'], ['fitness', 'Fitness'], ['venue', 'Home crowd'], ['boost', 'AI level']];

// Before the next match: how strong you will be (the engine's own numbers) and what to look at.
function Today({ lid, go, stamp }: { lid: number; go: TabProps['go']; stamp: unknown }) {
  const [t, setT] = useState<any>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { api(`/api/leagues/${lid}/today`).then(setT).catch(() => {}); }, [lid, stamp]);
  if (!t) return null;
  const s = t.strength;
  const diff = s ? Math.round((s.me.total - s.them.total) * 10) / 10 : 0;
  const todo = t.items.filter((it: any) => !it.ok).length;
  return (
    <section className="panel cut" style={{ padding: '14px 12px 12px', gap: 8 }}>
      <div className="row between wrap" style={{ gap: 8, padding: '0 6px' }}>
        <span className="lz" style={{ fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>BEFORE KICK-OFF</span>
        {todo > 0 ? <span className="pill red">{todo} to fix</span> : <span className="pill">All set</span>}
      </div>
      {s && (
        <button className="row small" style={{ gap: 8, fontWeight: 800, padding: '0 6px' }} onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="muted">Match strength</span>
          <b className="lz" style={{ fontSize: 20, color: 'var(--mint)' }}>{s.me.total}</b>
          <span className="muted">vs</span>
          <b className="lz" style={{ fontSize: 20 }}>{s.them.total}</b>
          <span className="tiny" style={{ color: diff > 0.5 ? '#5CFFC8' : diff < -0.5 ? '#FF8796' : '#A9BCD6' }}>{diff > 0 ? `+${diff}` : diff} {open ? '▲' : '▼'}</span>
        </button>
      )}
      {s && open && (
        <div className="row wrap" style={{ gap: 6, padding: '0 6px' }}>
          {PART_NAMES.filter(([k]) => k === 'players' || Math.abs(s.me.parts[k]) >= 0.1).map(([k, label]) => {
            const v = s.me.parts[k];
            return (
              <span key={k} className="tiny" style={{ padding: '3px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.07)', fontWeight: 800 }}>
                {label} <b style={{ color: k === 'players' ? '#EAF2FF' : v > 0 ? '#5CFFC8' : '#FF8796' }}>{k === 'players' ? v : v > 0 ? `+${v}` : v}</b>
              </span>
            );
          })}
          <span className="tiny muted" style={{ width: '100%' }}>{s.opp.name}{s.opp.type ? ` (${s.opp.type})` : ''}: {s.them.total}. A few points either way still leaves room for surprises.</span>
        </div>
      )}
      <div className="col" style={{ gap: 8, overflowY: 'auto', minHeight: 0 }}>
        {t.items.map((it: any, i: number) => (
          <button key={i} className={`h2-todo ${it.ok ? 'ok' : 'warn'}`} onClick={() => go(it.tab)}>
            <span className="h2-ico">{it.ok ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5CFFC8" strokeWidth="2.6" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFD27A" strokeWidth="2.6" aria-hidden="true"><path d="M12 6v8M12 18v.5" /></svg>}</span>
            <span className="grow small" style={{ fontWeight: 700, textAlign: 'left' }}>{it.text}</span>
            <span style={{ color: 'var(--mint)', fontSize: 20 }}>›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Inbox({ club, go }: { club: any; go: TabProps['go'] }) {
  const [open, setOpen] = useState(false);
  const items: any[] = club.inbox || [];
  if (!items.length && !club.unhappy && !club.requests) return null;
  return (
    <section className="panel cut" style={{ padding: '8px 12px', gap: 4 }}>
      <div className="row between">
        <span className="row" style={{ gap: 8 }}>
          <span className="tag cyan"><span>Inbox</span></span>
          {club.unhappy > 0 && <button className="tiny" style={{ color: '#FF9DA8', fontWeight: 900, minHeight: 30 }} onClick={() => go('players')}>{club.unhappy} unhappy player{club.unhappy > 1 ? 's' : ''} ›</button>}
          {club.requests > 0 && <button className="tiny" style={{ color: 'var(--red)', fontWeight: 900, minHeight: 30 }} onClick={() => go('players')}>{club.requests} transfer request{club.requests > 1 ? 's' : ''} ›</button>}
        </span>
        {items.length > 2 && <button className="tiny" style={{ color: 'var(--muted)', fontWeight: 800, minHeight: 30, padding: '0 6px' }} onClick={() => setOpen(!open)}>{open ? 'Less' : `All ${items.length}`} ›</button>}
      </div>
      {items.slice(0, open ? 30 : 2).map((m) => (
        <div key={m.id} className="row small" style={{ gap: 8, fontWeight: 700 }}>
          <span className="grow">{m.text}</span>
          <span className="tiny dim" style={{ whiteSpace: 'nowrap' }}>{new Date(m.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        </div>
      ))}
    </section>
  );
}

function SeasonOver({ lid, d, reload, toast, go }: TabProps) {
  const { league, club, table } = d;
  const [busy, setBusy] = useState(false);
  const champ = table[0];
  const next = async () => {
    setBusy(true);
    try { await api(`/api/leagues/${lid}/nextseason`, {}); toast.ok(`Season ${league.season + 1} is here!`); reload(); } catch (e: any) { toast.bad(e.message); }
    setBusy(false);
  };
  const D = league.divisions || 1, P = league.movers || 1;
  const up = club.division > 1 && club.pos > 0 && club.pos <= P, down = club.division < D && club.pos > table.length - P;
  return (
    <section className="panel cut rise" style={{ gap: 8, background: 'linear-gradient(160deg, rgba(242,193,78,0.22), rgba(242,193,78,0.04))' }}>
      <span className="tag gold" style={{ alignSelf: 'flex-start' }}><span>Season {league.season} is over</span></span>
      {champ && <div className="lz" style={{ fontSize: 24, color: '#F2C14E' }}>🏆 {champ.name}</div>}
      <div className="small">You finished <b>{club.pos}{suffix(club.pos)}</b>{D > 1 ? ` in the ${league.divisionNames[club.division - 1]}` : ''}.
        {up && <b style={{ color: '#2EE6A0' }}> Promoted!</b>}{down && <b style={{ color: 'var(--red)' }}> Relegated.</b>}</div>
      <div className="tiny muted">Next season: players age, veterans retire, academy graduates arrive, loans end and you get prize money plus 300 coins.</div>
      <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
        <button className="ghost" onClick={() => go('history')}><span>Awards & history</span></button>
        {league.isOwner
          ? <button className="cta gold shine" disabled={busy || league.status === 'rolling'} onClick={next}><span>{busy || league.status === 'rolling' ? 'Preparing…' : `Start season ${league.season + 1}`}</span></button>
          : <span className="tiny muted">The league creator starts the next season.</span>}
      </div>
    </section>
  );
}

const suffix = (n: number) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

function Stat({ label, v, color, note }: { label: string; v: number; color: string; note?: string }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <span className="small" style={{ width: 54, color: 'var(--muted)', fontWeight: 800 }}>{label}</span>
      <Bar v={v} color={color} h={7} />
      <b className="tiny" style={{ width: 34, textAlign: 'right' }}>{note ?? `${v}%`}</b>
    </div>
  );
}

function NextMatch({ f, club, now, go, lid }: { f: any; club: any; now: number; go: TabProps['go']; lid: number }) {
  const rec = useRecords(lid, f.id);
  const derby = f.ht === 'fan' && f.at === 'fan' && f.hu && f.au;
  const cup = f.comp === 'cup';
  const live = f.status === 'live';
  const cd = countdown(new Date(f.kickoff_at).getTime(), now);
  const homeMine = f.home_id === club.id;
  const accent = derby ? '#FFD36B' : '#2EF2B0';
  const opp = homeMine ? f.away : f.home;
  return (
    <section className={`h2-hero rise ${derby ? 'derby-card' : ''}`} aria-label="Next match">
      <Stadium home={f.hc} away={f.ac} gold={!!derby} />
      <div className="h2-hero-in">
        <span className="lz h2-kick" style={{ fontSize: 15, fontWeight: 600, color: accent, letterSpacing: 2 }}>{live ? '● LIVE NOW' : derby ? 'DERBY' : 'NEXT MATCH'}{cup ? ' · CUP' : ` · MATCHDAY ${f.matchday}`}</span>
        <span className="lz h2-name1">{club.name}</span>
        <span className="lz h2-name2"><span style={{ color: '#8FA6C4', fontSize: '0.72em' }}>VS </span>{opp}</span>
        <div className="row h2-crests" style={{ gap: 12, marginTop: 6 }}>
          <Crest c1={f.hc} c2="#fff" shape={f.hsh} emblem={f.hu ? f.hem : -1} short={f.hs} size={44} />
          <span className="tiny muted" style={{ fontWeight: 800 }}>VS</span>
          <Crest c1={f.ac} c2="#fff" shape={f.ash} emblem={f.au ? f.aem : -1} short={f.as_} size={44} />
          <span className="col small" style={{ gap: 0, lineHeight: 1.4, marginLeft: 4 }}><b>{cup ? 'Cup' : 'League'} · {homeMine ? 'Home' : 'Away'}</b><span className="muted">{new Date(f.kickoff_at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></span>
        </div>
        <H2HLine rec={rec} oppId={homeMine ? f.away_id : f.home_id} />
        {f.cond && (
          <>
            {/* the full version (wide screens and phones held upright) */}
            <div className="col h2-cond-full" style={{ gap: 6, marginTop: 6 }}>
              <div className="col" style={{ gap: 2 }}>
                <span className="row" style={{ gap: 6, fontWeight: 800 }}><span>{f.cond.icon} Weather:</span><b>{f.cond.label}</b></span>
                {f.cond.weather !== 'clear' && <span className="tiny muted" style={{ fontWeight: 700 }}>{f.cond.note}</span>}
              </div>
              <RefBadge strict={f.cond.strict} name={f.cond.ref} explain />
            </div>
            {/* a phone on its side: two chips on one line, and a word on what they mean only when it matters */}
            <div className="col h2-cond-compact" style={{ gap: 3, marginTop: 4 }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="h2-chip">{f.cond.icon} <b>{f.cond.label}</b></span>
                <span className="h2-chip">🧑‍⚖️ Referee: <b style={{ color: REF_LEVELS[f.cond.strict]?.color }}>{REF_LEVELS[f.cond.strict]?.label}</b> <span style={{ letterSpacing: 2, fontSize: '0.8em' }}>{REF_LEVELS[f.cond.strict]?.cards}</span></span>
              </div>
              {(f.cond.weather !== 'clear' || f.cond.strict !== 1) && (
                <span className="tiny muted" style={{ fontWeight: 700 }}>{[f.cond.weather !== 'clear' ? f.cond.note : '', f.cond.strict !== 1 ? REF_LEVELS[f.cond.strict]?.text : ''].filter(Boolean).join(' ')}</span>
              )}
            </div>
          </>
        )}
        <span className="grow" />
        <div className="row wrap" style={{ gap: 16 }}>
          {live ? <a className={`cta ${derby ? 'gold' : ''}`} href={`/m/${f.id}`}><span>WATCH LIVE ›</span></a> : <button className={`cta ${derby ? 'gold' : ''}`} onClick={() => go('lineup')}><span>PREPARE THE MATCH ›</span></button>}
          {!live && <span className="small muted" style={{ fontWeight: 700 }}>Kick-off in <b className="lz" style={{ color: '#EAF2FF', fontSize: 20, fontWeight: 600 }}>{cd.main}{cd.sec && `:${cd.sec}`}</b></span>}
        </div>
      </div>
    </section>
  );
}

// the night stadium behind the next match: stands full of fans in both clubs' colours, floodlights, the pitch
function Stadium({ home, away, gold }: { home: string; away: string; gold: boolean }) {
  return (
    <svg className="h2-stadium" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={gold ? '#2A1E08' : '#071633'} /><stop offset="1" stopColor={gold ? '#3E2C0E' : '#0F2A55'} /></linearGradient>
        <radialGradient id="hs-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#fff" stopOpacity="0.95" /><stop offset="0.25" stopColor="#CFE6FF" stopOpacity="0.5" /><stop offset="1" stopColor="#CFE6FF" stopOpacity="0" /></radialGradient>
        <linearGradient id="hs-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#DDEEFF" stopOpacity="0.32" /><stop offset="1" stopColor="#DDEEFF" stopOpacity="0" /></linearGradient>
        <pattern id="hs-crowd" width="9" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#3A5C8F" /><circle cx="6.5" cy="5" r="1.6" fill="#24406B" /><circle cx="6" cy="1.5" r="1" fill={home} fillOpacity="0.7" /><circle cx="2.5" cy="5.5" r="0.9" fill="#9FD0FF" fillOpacity="0.5" /></pattern>
        <pattern id="hs-crowd2" width="7" height="6" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#2B4A7A" /><circle cx="5.5" cy="4.5" r="1.3" fill="#1C345A" /><circle cx="5" cy="1.5" r="0.8" fill={away} fillOpacity="0.7" /></pattern>
        <linearGradient id="hs-pitch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1D7A4E" /><stop offset="1" stopColor="#0F4B30" /></linearGradient>
        <linearGradient id="hs-fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#050D1C" stopOpacity="0.95" /><stop offset="0.45" stopColor="#050D1C" stopOpacity="0.55" /><stop offset="1" stopColor="#050D1C" stopOpacity="0.05" /></linearGradient>
      </defs>
      <rect width="1000" height="300" fill="url(#hs-sky)" />
      <rect x="0" y="60" width="1000" height="90" fill="url(#hs-crowd)" />
      <rect x="0" y="30" width="1000" height="30" fill="url(#hs-crowd2)" />
      <rect x="0" y="146" width="1000" height="8" fill="#0A1C38" />
      <rect x="0" y="148" width="1000" height="4" fill={gold ? '#FFD36B' : '#2EF2B0'} fillOpacity="0.55" />
      <polygon points="-200,300 1200,300 820,154 180,154" fill="url(#hs-pitch)" />
      {[[0, 120, 300, 260], [240, 360, 420, 380], [480, 600, 540, 500], [720, 840, 660, 620], [960, 1080, 780, 740]].map(([a, b, c, e], i) => <polygon key={i} points={`${a},300 ${b},300 ${c},154 ${e},154`} fill="#fff" fillOpacity="0.04" />)}
      <ellipse cx="600" cy="214" rx="150" ry="32" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" />
      <line x1="520" y1="154" x2="690" y2="300" stroke="#fff" strokeOpacity="0.3" strokeWidth="2" />
      <polygon points="760,154 900,154 990,196 790,196" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" />
      <polygon points="340,0 420,0 700,300 140,300" fill="url(#hs-beam)" />
      <polygon points="880,0 940,0 1000,300 560,300" fill="url(#hs-beam)" />
      <rect x="374" y="10" width="2" height="40" fill="#5B7BA8" /><rect x="354" y="2" width="44" height="14" rx="2" fill="#DCEBFF" /><circle cx="376" cy="9" r="60" fill="url(#hs-glow)" />
      <rect x="908" y="10" width="2" height="40" fill="#5B7BA8" /><rect x="888" y="2" width="44" height="14" rx="2" fill="#DCEBFF" /><circle cx="910" cy="9" r="60" fill="url(#hs-glow)" />
      <g fill={home}><circle cx="560" cy="200" r="5" /><rect x="556" y="205" width="8" height="12" rx="3" /><circle cx="640" cy="236" r="6" /><rect x="635" y="242" width="10" height="15" rx="3" /><circle cx="700" cy="196" r="5" /><rect x="696" y="201" width="8" height="12" rx="3" /></g>
      <g fill={away}><circle cx="600" cy="186" r="4.5" /><rect x="596.5" y="190" width="7" height="11" rx="3" /><circle cx="760" cy="226" r="6" /><rect x="755" y="232" width="10" height="15" rx="3" /><circle cx="820" cy="190" r="4.5" /><rect x="816.5" y="194" width="7" height="11" rx="3" /></g>
      <circle cx="652" cy="258" r="4" fill="#fff" />
      <rect width="1000" height="300" fill="url(#hs-fade)" />
    </svg>
  );
}

function OwnerSchedule({ lid, league, toast, reload }: { lid: number; league: any; toast: TabProps['toast']; reload: () => void }) {
  const [t, setT] = useState(utcMinToLocal(league.kickoffUtcMin));
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState(false);
  const save = async () => {
    try { await api(`/api/leagues/${lid}/schedule`, { kickoffUtcMin: localToUtcMin(t) }); toast.ok('Match time saved'); setOpen(false); reload(); } catch (e: any) { toast.bad(e.message); }
  };
  const setLevel = async (n: number) => {
    try { await api(`/api/leagues/${lid}/difficulty`, { aiLevel: n }); toast.ok(`AI managers: ${['Easy', 'Normal', 'Hard'][n]}`); setDiff(false); reload(); } catch (e: any) { toast.bad(e.message); }
  };
  return (
    <div className="row small wrap" style={{ gap: 8, color: 'var(--muted)', fontWeight: 700 }}>
      <span>Matches every day at <b style={{ color: '#F2C14E' }}>{utcMinToLocal(league.kickoffUtcMin)}</b> (your time)</span>
      {open ? (
        <>
          <input type="time" value={t} onChange={(e) => setT(e.target.value || '18:00')} style={{ width: 120, height: 30 }} />
          <button className="seg on" onClick={save}><span>Save</span></button>
        </>
      ) : <button className="seg" onClick={() => setOpen(true)}><span>Change time</span></button>}
      <span>AI managers: <b style={{ color: '#F2C14E' }}>{['Easy', 'Normal', 'Hard'][league.aiLevel ?? 1]}</b></span>
      {diff ? ['Easy', 'Normal', 'Hard'].map((x, i) => (
        <button key={x} className={`seg ${(league.aiLevel ?? 1) === i ? 'on' : ''}`} onClick={() => setLevel(i)}><span>{x}</span></button>
      )) : <button className="seg" onClick={() => setDiff(true)}><span>Change difficulty</span></button>}
    </div>
  );
}

function SetupHome({ lid, d, reload, toast, go }: TabProps) {
  const { league, club } = d;
  const [clubs, setClubs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/api/leagues/${lid}/clubs`).then(setClubs).catch(() => {}); }, [lid, d]);
  const ready = club.squadSize >= 16 && club.gks >= 2;
  const start = async () => {
    setBusy(true);
    try { await api(`/api/leagues/${lid}/start`, {}); toast.ok('The season has started!'); reload(); } catch (e: any) { toast.bad(e.message); }
    setBusy(false);
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      <section className="panel cut rise">
        <span className="tag gold" style={{ alignSelf: 'flex-start' }}><span>Pre-season</span></span>
        <div className="lz" style={{ fontSize: 24 }}>Build your squad</div>
        <Check ok={club.squadSize >= 16} text={`At least 16 players (${club.squadSize})`} />
        <Check ok={club.gks >= 2} text={`At least 2 goalkeepers (${club.gks})`} />
        <div className="small muted">You have <b style={{ color: '#F2C14E' }}>{club.coins} coins</b>. Stars, balance or depth: your call.</div>
        <button className="cta shine" onClick={() => go('store')}><span>Open packs</span></button>
        {ready && <button className="ghost" onClick={() => go('lineup')}><span>Set your lineup</span></button>}
      </section>
      <section className="panel cut rise" style={{ animationDelay: '.06s' }}>
        <div className="row between"><span className="tag cyan"><span>Invite friends</span></span><span className="tiny muted">{clubs.length}/{league.maxClubs} clubs</span></div>
        <div className="lz" style={{ fontSize: 36, letterSpacing: 6, color: 'var(--cyan)' }}>{league.code}</div>
        <div className="small muted">Send this code. Empty places become {['easy', 'normal', 'hard'][league.aiLevel]} AI clubs with {league.poolName.replace(' League', '')} names when the season starts.</div>
        <div className="col" style={{ gap: 4, maxHeight: 150, overflow: 'auto' }}>
          {clubs.map((c) => (
            <div key={c.id} className="row small" style={{ gap: 8 }}>
              <Crest c1={c.color1} c2={c.color2} shape={c.shape} emblem={c.emblem} size={22} /><b className="grow ellipsis">{c.name}</b><span className="dim">{c.username}</span><span className="muted">{c.players} pl</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel cut rise" style={{ animationDelay: '.12s' }}>
        <span className="tag" style={{ alignSelf: 'flex-start' }}><span>Schedule</span></span>
        <div className="small">One match every day at <b style={{ color: '#F2C14E' }}>{utcMinToLocal(league.kickoffUtcMin)}</b> (your time). Nobody can move a match earlier.</div>
        {league.isOwner && <OwnerSchedule lid={lid} league={league} toast={toast} reload={reload} />}
        {league.isOwner ? (
          <>
            <button className="cta gold" disabled={busy} onClick={start} style={{ marginTop: 'auto' }}><span>Start the season</span></button>
            <div className="tiny muted">Every manager needs 16+ players and 2 keepers. The first match is the next day at the match time.</div>
          </>
        ) : <div className="small muted">The league creator starts the season when everyone is ready.</div>}
      </section>
    </div>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return <div className="row small" style={{ gap: 8 }}><span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', background: ok ? '#2EE6A0' : 'rgba(255,255,255,0.12)', color: '#0E3020', fontWeight: 900 }}>{ok ? '✓' : ''}</span>{text}</div>;
}

export { lastName };
