'use client';
import { timeLeft } from '../WindowSplash.tsx';
import { useEffect, useState } from 'react';
import { api, utcMinToLocal, localToUtcMin, shirt } from '../../lib/client.ts';
import { Bar, Crest, Ring, lastName } from '../ui.tsx';
import type { TabProps } from './types.ts';

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
  return (
    <div className="col" style={{ gap: 10, minHeight: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 1.15fr) minmax(220px, 1fr) minmax(150px, 170px)', gap: 12 }} className="home-grid">
        {next ? <NextMatch f={next} club={club} now={now} go={go} /> : league.status === 'finished' || league.status === 'rolling'
          ? <SeasonOver lid={lid} d={d} reload={reload} toast={toast} go={go} />
          : <div className="panel cut lz" style={{ fontSize: 22, justifyContent: 'center' }}>No more matches</div>}
        <div className="col" style={{ gap: 12 }}>
          <section className="panel cut rise" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <div className="col" style={{ alignItems: 'center', gap: 4 }}>
              <span className="tag"><span>Team</span></span>
              <Ring v={club.strength} size={84} label={club.strength} font={30} color="#E8438C" />
            </div>
            <div className="col grow" style={{ gap: 10 }}>
              <Stat label="Morale" v={club.morale} color="#7FE9F7" />
              <Stat label="Fitness" v={club.fitness} color="#7FE9F7" />
              <Stat label="Fans" v={Math.round(Math.min(100, (club.fans / club.capacity) * 100))} color="#E8438C" note={`${(club.fans / 1000).toFixed(1)}k`} />
            </div>
          </section>
          <section className="panel cut rise" style={{ gap: 4, animationDelay: '.08s' }}>
            <div className="row between"><span className="tag"><span>{league.divisions > 1 ? league.divisionNames[club.division - 1] : `${league.poolName.replace(' League', '')} League`}</span></span><button className="tiny" style={{ color: 'var(--muted)', fontWeight: 800, minHeight: 30, padding: '0 8px' }} onClick={() => go('table')}>TABLE ›</button></div>
            {slice.map((t: any) => {
              const i = table.indexOf(t) + 1;
              const me = t.id === club.id;
              return (
                <div key={t.id} className="row" style={{ height: 30, padding: '0 10px', fontWeight: 800, fontSize: 13, transform: me ? 'skewX(-10deg)' : undefined, background: me ? 'linear-gradient(90deg, rgba(127,233,247,0.32), rgba(127,233,247,0.1))' : undefined }}>
                  <span style={{ width: 22, transform: me ? 'skewX(10deg)' : undefined, color: me ? '#fff' : 'var(--muted)' }}>{i}</span>
                  <span className="grow ellipsis" style={{ transform: me ? 'skewX(10deg)' : undefined }}>{t.name}</span>
                  <span style={{ transform: me ? 'skewX(10deg)' : undefined }}>{t.pts}</span>
                </div>
              );
            })}
          </section>
        </div>
        <section className="col rise" style={{ gap: 6, animationDelay: '.12s' }}>
          {star && (
            <button onClick={() => go('players')} className="pcard holo" style={{ aspectRatio: '0.74', padding: '10px 12px', textAlign: 'left' }}>
              <div className="no" style={{ fontSize: 96, opacity: 0.35 }}>{star.num ?? shirt(star.id, star.pos)}</div>
              <div style={{ position: 'relative' }}><div className="ovr" style={{ fontSize: 30 }}>{star.ovr}</div><div className="pos">{star.pos}</div></div>
              <div style={{ marginTop: 'auto', position: 'relative', background: 'rgba(20,10,50,0.72)', color: '#F3EEFF', margin: '0 -12px -10px', padding: '6px 8px 14px', textAlign: 'center' }}>
                <div style={{ fontWeight: 900, fontSize: 14 }} className="ellipsis">{star.name}</div>
                <div className="tiny" style={{ color: '#7FE9F7', fontWeight: 900 }}>Goals {star.goals} · Assists {star.assists}</div>
              </div>
            </button>
          )}
          <div className="tiny" style={{ textAlign: 'center', color: '#F2C14E', fontWeight: 800 }}>{club.pos ? `${club.pos}${suffix(club.pos)} · target top ${club.targetPos}` : ''}</div>
        </section>
      </div>
      {d.window?.open && league.status === 'running' && (
        <button className="row small" onClick={() => go('market')} style={{ gap: 10, flexWrap: 'wrap', rowGap: 2, padding: '8px 12px', background: 'linear-gradient(90deg, rgba(242,193,78,0.3), rgba(242,193,78,0.05))', color: '#F3EEFF', fontWeight: 800, textAlign: 'left' }}>
          <span className="lz" style={{ fontSize: 18, color: '#F2C14E' }}>🔓 TRANSFER WINDOW OPEN</span>
          <span className="grow" style={{ minWidth: 200 }}>{d.window.round === 2 ? 'Second round' : 'First round'} · shuts in <b style={{ color: '#F2C14E' }}>{timeLeft(d.window.closesAt)}</b>. Buy, sell, loan and swap in the Market.</span>
          {club.offers > 0 && <span className="tag" style={{ background: '#E8438C' }}><span>{club.offers} offer{club.offers > 1 ? 's' : ''} for your players</span></span>}
        </button>
      )}
      {league.status === 'running' && <Today lid={lid} go={go} stamp={d} />}
      <Inbox club={club} go={go} />
      <MoreHome d={d} go={go} />
      {league.isOwner && <OwnerSchedule lid={lid} league={league} toast={toast} reload={reload} />}
      <div className="ticker" style={{ marginTop: 'auto' }}>
        <span className="lbl">BREAKING</span>
        <div className="run" key={news.length}>
          {news.slice(0, 10).map((n: any, i: number) => <span key={i} className="row" style={{ gap: 10 }}><i style={{ width: 8, height: 8, background: '#7FE9F7', transform: 'rotate(45deg)', display: 'inline-block' }} />{n.text}</span>)}
        </div>
      </div>
      <style>{`@media (max-width: 760px){ .home-grid{ grid-template-columns: 1fr 1fr !important; } } @media (max-width: 480px){ .home-grid{ grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </div>
  );
}

// Tablets and computers have room for more: your recent results and what is coming next.
function MoreHome({ d, go }: { d: any; go: TabProps['go'] }) {
  const mine = d.fixtures as any[];
  const done = mine.filter((f) => f.status === 'done').slice(-5).reverse();
  const next = mine.filter((f) => f.status === 'scheduled').slice(1, 5);
  const me = d.club.id;
  const res = (f: any) => { const my = f.home_id === me ? [f.home_goals, f.away_goals] : [f.away_goals, f.home_goals]; return f.winner_id ? (f.winner_id === me ? 'W' : 'L') : my[0] > my[1] ? 'W' : my[0] < my[1] ? 'L' : 'D'; };
  if (!done.length && !next.length) return null;
  return (
    <div className="wide-only" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <section className="panel cut" style={{ gap: 4 }}>
        <div className="row between"><span className="kicker">Recent results</span><button className="tiny" style={{ color: 'var(--muted)', fontWeight: 800 }} onClick={() => go('fixtures')}>All ›</button></div>
        {!done.length && <span className="small muted">No matches played yet.</span>}
        {done.map((f) => { const r = res(f); return (
          <a key={f.id} href={`/m/${f.id}`} className="row small" style={{ gap: 8, color: 'inherit', fontWeight: 700 }}>
            <i style={{ width: 20, height: 20, display: 'grid', placeItems: 'center', fontStyle: 'normal', fontWeight: 900, fontSize: 11, background: r === 'W' ? '#7CE3A1' : r === 'L' ? 'var(--red)' : '#B4A8E0', color: '#1B1048' }}>{r}</i>
            <span className="grow ellipsis">{f.home} <b>{f.home_goals}–{f.away_goals}</b> {f.away}</span>
            <span className="tiny muted">{f.comp === 'cup' ? 'Cup' : `MD ${f.matchday}`}</span>
          </a>
        ); })}
      </section>
      <section className="panel cut" style={{ gap: 4 }}>
        <div className="row between"><span className="kicker">Coming up</span><button className="tiny" style={{ color: 'var(--muted)', fontWeight: 800 }} onClick={() => go('fixtures')}>All ›</button></div>
        {!next.length && <span className="small muted">Nothing else scheduled.</span>}
        {next.map((f) => (
          <div key={f.id} className="row small" style={{ gap: 8, fontWeight: 700 }}>
            <span className="tiny" style={{ width: 44, fontWeight: 900, color: f.comp === 'cup' ? '#2FE6B0' : 'var(--muted)' }}>{f.comp === 'cup' ? 'CUP' : `MD ${f.matchday}`}</span>
            <span className="grow ellipsis">{f.home_id === me ? `vs ${f.away}` : `at ${f.home}`}</span>
            <span className="tiny muted">{new Date(f.kickoff_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          </div>
        ))}
      </section>
    </div>
  );
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
  return (
    <section className="panel cut" style={{ padding: '8px 12px', gap: 6 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="tag cyan"><span>Today</span></span>
        {s && (
          <button className="row small" style={{ gap: 8, fontWeight: 800 }} onClick={() => setOpen(!open)} aria-expanded={open}>
            <span className="muted">Match strength</span>
            <b className="lz" style={{ fontSize: 20, color: '#7FE9F7' }}>{s.me.total}</b>
            <span className="muted">vs</span>
            <b className="lz" style={{ fontSize: 20 }}>{s.them.total}</b>
            <span className="tiny" style={{ color: diff > 0.5 ? '#7CE3A1' : diff < -0.5 ? '#FF8A80' : '#C9C0EC' }}>{diff > 0 ? `+${diff}` : diff} {open ? '▲' : '▼'}</span>
          </button>
        )}
      </div>
      {s && open && (
        <div className="row wrap" style={{ gap: 6 }}>
          {PART_NAMES.filter(([k]) => k === 'players' || Math.abs(s.me.parts[k]) >= 0.1).map(([k, label]) => {
            const v = s.me.parts[k];
            return (
              <span key={k} className="tiny" style={{ padding: '3px 8px', background: 'rgba(255,255,255,0.07)', fontWeight: 800 }}>
                {label} <b style={{ color: k === 'players' ? '#F3EEFF' : v > 0 ? '#7CE3A1' : '#FF8A80' }}>{k === 'players' ? v : v > 0 ? `+${v}` : v}</b>
              </span>
            );
          })}
          <span className="tiny muted" style={{ width: '100%' }}>{s.opp.name}{s.opp.type ? ` (${s.opp.type})` : ''}: {s.them.total}. A few points either way still leaves room for surprises.</span>
        </div>
      )}
      <div className="col" style={{ gap: 2 }}>
        {t.items.map((it: any, i: number) => (
          <button key={i} className="row small" style={{ gap: 8, textAlign: 'left', fontWeight: 700, padding: '3px 0' }} onClick={() => go(it.tab)}>
            <b style={{ width: 16, color: it.ok ? '#7CE3A1' : '#F2C14E' }}>{it.ok ? '✓' : '!'}</b>
            <span className="grow">{it.text}</span>
            <span className="tiny muted">›</span>
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
        {up && <b style={{ color: '#7CE3A1' }}> Promoted!</b>}{down && <b style={{ color: 'var(--red)' }}> Relegated.</b>}</div>
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

function NextMatch({ f, club, now, go }: { f: any; club: any; now: number; go: TabProps['go'] }) {
  const derby = f.ht === 'fan' && f.at === 'fan' && f.hu && f.au;
  const cup = f.comp === 'cup';
  const live = f.status === 'live';
  const cd = countdown(new Date(f.kickoff_at).getTime(), now);
  const homeMine = f.home_id === club.id;
  const accent = derby ? '#F2C14E' : cup ? '#2FE6B0' : '#E8438C';
  return (
    <section className="panel cut rise" style={{ padding: 10, gap: 8, background: derby ? 'linear-gradient(160deg, rgba(242,193,78,0.22), rgba(242,193,78,0.05))' : cup ? 'linear-gradient(160deg, rgba(47,230,176,0.16), rgba(230,238,242,0.04))' : undefined }}>
      <div className="row between">
        <span className="tag" style={{ background: accent, color: derby || cup ? '#1B1048' : '#fff' }}><span>{live ? 'LIVE NOW' : 'Next match'}</span></span>
        <span className="tiny" style={{ fontWeight: 900, color: accent }}>{derby ? 'DERBY' : cup ? 'CUP' : `MATCHDAY ${f.matchday}`}</span>
      </div>
      <a href={`/m/${f.id}`} style={{ position: 'relative', flex: 1, minHeight: 150, overflow: 'hidden', display: 'block', color: 'inherit' }}>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(65deg, ${f.hc} 0 49.5%, transparent 49.5% 50.5%, #E6E1F7 50.5% 100%)` }} />
        <div style={{ position: 'relative', height: '100%', minHeight: 150, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
          <div className="col" style={{ alignItems: 'center', gap: 2, color: '#fff' }}>
            <Crest c1="#fff" c2={f.hc} shape={f.hsh} emblem={f.hu ? f.hem : -1} short={f.hs} size={50} />
            <span className="lz ellipsis" style={{ fontSize: 16, maxWidth: 120, textAlign: 'center' }}>{f.home}</span>
            {homeMine && <span className="tiny" style={{ fontWeight: 900 }}>YOU</span>}
          </div>
          <span style={{ width: 54, height: 54, transform: 'rotate(45deg)', background: '#1B1048', border: `2px solid ${derby ? '#F2C14E' : '#7FE9F7'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 10px rgba(127,233,247,0.35)' }}>
            <span className="lz" style={{ transform: 'rotate(-45deg)', fontSize: 21 }}>VS</span>
          </span>
          <div className="col" style={{ alignItems: 'center', gap: 2, color: '#1E1250' }}>
            <Crest c1={f.ac} c2="#fff" shape={f.ash} emblem={f.au ? f.aem : -1} short={f.as_} size={50} />
            <span className="lz ellipsis" style={{ fontSize: 16, maxWidth: 120, textAlign: 'center' }}>{f.away}</span>
            {!homeMine && <span className="tiny" style={{ fontWeight: 900 }}>YOU</span>}
          </div>
        </div>
      </a>
      <div className="row between" style={{ gap: 8 }}>
        {live ? <span className="lz" style={{ fontSize: 24, color: 'var(--red)', animation: 'pulse 1.2s infinite' }}>● LIVE</span> : <span className="lz" style={{ fontSize: 28, whiteSpace: 'nowrap' }}>{cd.main}{cd.sec && <span style={{ color: '#7FE9F7', fontSize: 20 }}>:{cd.sec}</span>}</span>}
        {live ? <a className="cta shine" href={`/m/${f.id}`}><span>Watch live</span></a> : <button className="cta shine" onClick={() => go('lineup')}><span>Set lineup</span></button>}
      </div>
    </section>
  );
}

function OwnerSchedule({ lid, league, toast, reload }: { lid: number; league: any; toast: TabProps['toast']; reload: () => void }) {
  const [t, setT] = useState(utcMinToLocal(league.kickoffUtcMin));
  const [open, setOpen] = useState(false);
  const save = async () => {
    try { await api(`/api/leagues/${lid}/schedule`, { kickoffUtcMin: localToUtcMin(t) }); toast.ok('Match time saved'); setOpen(false); reload(); } catch (e: any) { toast.bad(e.message); }
  };
  return (
    <div className="row small" style={{ gap: 8, color: 'var(--muted)', fontWeight: 700 }}>
      <span>Matches every day at <b style={{ color: '#F2C14E' }}>{utcMinToLocal(league.kickoffUtcMin)}</b> (your time)</span>
      {open ? (
        <>
          <input type="time" value={t} onChange={(e) => setT(e.target.value || '18:00')} style={{ width: 120, height: 30 }} />
          <button className="seg on" onClick={save}><span>Save</span></button>
        </>
      ) : <button className="seg" onClick={() => setOpen(true)}><span>Change time</span></button>}
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
        <div className="lz" style={{ fontSize: 36, letterSpacing: 6, color: '#7FE9F7' }}>{league.code}</div>
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
  return <div className="row small" style={{ gap: 8 }}><span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', background: ok ? '#7CE3A1' : 'rgba(255,255,255,0.12)', color: '#0E3020', fontWeight: 900 }}>{ok ? '✓' : ''}</span>{text}</div>;
}

export { lastName };
