'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api, clock, utcMinToLocal, localToUtcMin, when } from '../../../lib/client.ts';
import { Cash, Coin, Crest, Icon, Spinner, useToast } from '../../../components/ui.tsx';
import CreateClub from '../../../components/CreateClub.tsx';
import SquadTab from '../../../components/SquadTab.tsx';
import TacticsTab from '../../../components/TacticsTab.tsx';
import StoreTab from '../../../components/StoreTab.tsx';
import MarketTab from '../../../components/MarketTab.tsx';
import { FixturesTab, StatsTab, TableTab } from '../../../components/LeagueTabs.tsx';

const TABS = [
  ['home', 'Home'], ['squad', 'Squad'], ['tactics', 'Tactics'], ['store', 'Packs'], ['market', 'Market'], ['table', 'Table'], ['fixtures', 'Fixtures'], ['stats', 'Leaders'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const toast = useToast();
  const load = useCallback(() => api(`/api/leagues/${id}/overview`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => {
    load();
    try {
      const t = sessionStorage.getItem(`kora-tab-${id}`) as Tab | null;
      if (t) setTab(t);
    } catch {}
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [id, load]);
  // matches are played a few at a time on the server; keep asking while some are waiting
  useEffect(() => {
    if (!d?.pending) return;
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [d, load]);
  const go = (t: Tab) => {
    setTab(t);
    try { sessionStorage.setItem(`kora-tab-${id}`, t); } catch {}
  };

  if (err) return <div className="pad col" style={{ gap: 10 }}><div className="err">{err}</div><a className="ghost" href="/"><span>Back</span></a></div>;
  if (!d) return <Spinner />;
  const { league, club } = d;
  if (!club) {
    if (league.status !== 'setup') return <div className="pad col" style={{ gap: 10 }}><div className="lz" style={{ fontSize: 22 }}>{league.name}</div><div className="muted">This league has already kicked off. New clubs can join next season.</div><a className="ghost" href="/"><span>Back</span></a></div>;
    return <CreateClub league={league} onDone={load} />;
  }
  const lid = league.id;
  return (
    <div className="shell">
      <nav className="rail">
        <a href="/" aria-label="All leagues"><Icon name="back" /><span>Leagues</span></a>
        {TABS.map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
            <Icon name={k === 'store' ? 'store' : k} />
            <span>{t}</span>
          </button>
        ))}
      </nav>
      <div className="main">
        <header className="top">
          <Crest c1={club.color1} c2={club.color2} shape={club.shape} emblem={club.emblem} size={36} />
          <div className="col grow" style={{ gap: 0, lineHeight: 1.1 }}>
            <span className="lz ellipsis" style={{ fontSize: 20 }}>{club.name}</span>
            <span className="tiny muted ellipsis">{league.name} · {league.poolName} · {league.status === 'setup' ? 'Pre-season' : league.status === 'finished' ? 'Season over' : `Matchday ${d.matchdays.played}/${d.matchdays.total}`}</span>
          </div>
          <div className="coin" title="Coins for packs"><Coin /><b>{club.coins}</b></div>
          <div className="coin" title="Transfer money"><Cash /><b>{Number(club.money).toFixed(1)}M</b></div>
        </header>
        <div className="content">
          {tab === 'home' && <HomeTab d={d} reload={load} toast={toast} goTab={go} />}
          {tab === 'squad' && <SquadTab lid={lid} window={d.window} toast={toast} />}
          {tab === 'tactics' && <TacticsTab lid={lid} toast={toast} />}
          {tab === 'store' && <StoreTab lid={lid} coins={club.coins} canOpen={league.status === 'setup' || d.window.open} reload={load} toast={toast} />}
          {tab === 'market' && <MarketTab lid={lid} toast={toast} reload={load} />}
          {tab === 'table' && <TableTab table={d.table} myId={club.id} targetPos={club.targetPos} />}
          {tab === 'fixtures' && <FixturesTab lid={lid} myId={club.id} />}
          {tab === 'stats' && <StatsTab lid={lid} />}
        </div>
      </div>
      {toast.node}
    </div>
  );
}

function HomeTab({ d, reload, toast, goTab }: { d: any; reload: () => void; toast: ReturnType<typeof useToast>; goTab: (t: Tab) => void }) {
  const { league, club, fixtures, table, news } = d;
  const now = new Date(d.now).getTime();
  const next = fixtures.find((f: any) => f.status !== 'done');
  const last = [...fixtures].reverse().find((f: any) => f.status === 'done');
  const [busy, setBusy] = useState(false);
  const act = async (path: string, body: unknown, okMsg: string) => {
    setBusy(true);
    try {
      await api(`/api/leagues/${league.id}/${path}`, body);
      toast.ok(okMsg);
      reload();
    } catch (e: any) {
      toast.bad(e.message);
    }
    setBusy(false);
  };

  if (league.status === 'setup') return <SetupHome d={d} act={act} busy={busy} goTab={goTab} />;

  const myRow = table.findIndex((t: any) => t.id === club.id);
  const slice = table.slice(Math.max(0, myRow - 2), Math.max(0, myRow - 2) + 5);
  const started = d.matchdays.played > 0;
  const onTrack = club.pos <= club.targetPos;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
      {next ? <MatchCard f={next} club={club} now={now} title="Next match" /> : <div className="glass cut pad lz" style={{ fontSize: 22 }}>Season over</div>}
      <div className="col" style={{ gap: 12 }}>
        {last && <MatchCard f={last} club={club} now={now} title="Last result" compact />}
        <div className="glass cut pad col" style={{ gap: 6 }}>
          <div className="row between"><span className="tag"><span>Board target</span></span><span className={`tag ${!started ? '' : onTrack ? 'green' : 'pink'}`}><span>{!started ? 'Not started' : onTrack ? 'On track' : 'Behind'}</span></span></div>
          <div className="small">{club.type.board}</div>
          <div className="row small"><span className="muted">Now</span><b className="lz" style={{ fontSize: 22 }}>{club.pos}{suffix(club.pos)}</b><span className="muted">· target top {club.targetPos}</span></div>
        </div>
      </div>
      <div className="glass cut pad col" style={{ gap: 4 }}>
        <div className="row between"><span className="tag cyan"><span>Table</span></span><button className="tiny" style={{ color: '#7FE9F7', fontWeight: 800 }} onClick={() => goTab('table')}>Full table ›</button></div>
        {slice.map((t: any) => {
          const i = table.indexOf(t) + 1;
          return (
            <div key={t.id} className="row small" style={{ height: 28, padding: '0 6px', background: t.id === club.id ? 'rgba(232,67,140,0.2)' : undefined }}>
              <b style={{ width: 20 }}>{i}</b><span className="grow ellipsis">{t.name}</span><span className="dim">{t.p}</span><b style={{ width: 28, textAlign: 'right' }}>{t.pts}</b>
            </div>
          );
        })}
      </div>
      <div className="glass cut pad col" style={{ gap: 6, gridColumn: '1 / -1' }}>
        <div className="row between"><span className="tag pink"><span>League news</span></span><span className="tiny dim">Code {league.code}</span></div>
        {news.slice(0, 8).map((n: any, i: number) => (
          <div key={i} className="row small" style={{ gap: 8 }}>
            <span className="tag" style={{ height: 18, fontSize: 10, background: n.kind === 'derby' ? '#F2C14E' : undefined, color: n.kind === 'derby' ? '#2A1A00' : undefined }}><span>{n.kind}</span></span>
            <span className="grow">{n.text}</span><span className="tiny dim">{when(n.created_at, now)}</span>
          </div>
        ))}
      </div>
      {league.isOwner && <OwnerTools d={d} act={act} busy={busy} />}
    </div>
  );
}

function suffix(n: number) {
  return n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
}

function MatchCard({ f, club, now, title, compact }: { f: any; club: any; now: number; title: string; compact?: boolean }) {
  const derby = f.ht === 'fan' && f.at === 'fan' && f.hu && f.au;
  const done = f.status === 'done';
  const kick = new Date(f.kickoff_at).getTime();
  const live = done && now - kick < 120_000;
  const gold = derby ? { background: 'linear-gradient(135deg, rgba(242,193,78,0.28), rgba(242,193,78,0.06))' } : {};
  return (
    <a href={`/m/${f.id}`} className="glass cut pad col rise" style={{ color: 'inherit', gap: 8, ...gold }}>
      <div className="row between">
        <span className={`tag ${derby ? 'gold' : 'pink'}`}><span>{derby ? 'DERBY DAY' : title}</span></span>
        <span className="tiny muted">MD {f.matchday} · {done ? (live ? 'LIVE NOW' : 'Full time') : `${clock(f.kickoff_at)} · ${when(f.kickoff_at, now)}`}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8 }}>
        <Side name={f.home} short={f.hs} color={f.hc} me={f.home_id === club.id} size={compact ? 30 : 44} />
        <div className="lz" style={{ fontSize: compact ? 24 : 32, textAlign: 'center', color: derby ? '#F2C14E' : undefined }}>
          {done ? `${f.home_goals} – ${f.away_goals}` : 'VS'}
        </div>
        <Side name={f.away} short={f.as_} color={f.ac} me={f.away_id === club.id} size={compact ? 30 : 44} />
      </div>
      {!compact && <span className={`cta small ${derby ? 'gold' : done ? 'cyan' : ''}`} style={{ alignSelf: 'center' }}><span>{done ? (live ? 'Watch live' : 'Watch / report') : 'Pre-match: line-up & penalties'}</span></span>}
    </a>
  );
}

function Side({ name, short, color, me, size }: { name: string; short: string; color: string; me: boolean; size: number }) {
  return (
    <div className="col" style={{ alignItems: 'center', gap: 2, minWidth: 0 }}>
      <Crest c1={color} c2="#F3EEFF" size={size} emblem={-1} short={short} />
      <span className="small ellipsis" style={{ fontWeight: 800, maxWidth: '100%', color: me ? '#7FE9F7' : undefined }}>{name}</span>
    </div>
  );
}

function SetupHome({ d, act, busy, goTab }: { d: any; act: (p: string, b: unknown, m: string) => void; busy: boolean; goTab: (t: Tab) => void }) {
  const { league, club } = d;
  const [clubs, setClubs] = useState<any[]>([]);
  useEffect(() => {
    api(`/api/leagues/${league.id}/clubs`).then(setClubs).catch(() => {});
  }, [league.id, d]);
  const ready = club.squadSize >= 16 && club.gks >= 2;
  const share = typeof window !== 'undefined' ? `${location.origin}` : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
      <div className="glass cut pad col" style={{ gap: 10 }}>
        <span className="tag gold"><span>Pre-season</span></span>
        <div className="lz" style={{ fontSize: 22 }}>Build your squad</div>
        <Check ok={club.squadSize >= 16} text={`At least 16 players (${club.squadSize})`} />
        <Check ok={club.gks >= 2} text={`At least 2 goalkeepers (${club.gks})`} />
        <div className="small muted">You have <b style={{ color: '#F2C14E' }}>{club.coins} coins</b>. Stars or depth: it is your call.</div>
        <button className="cta shine" onClick={() => goTab('store')}><span>Open packs</span></button>
        {ready && <div className="small" style={{ color: '#7CE3A1' }}>Squad ready. Set your tactics while you wait for kick-off.</div>}
      </div>
      <div className="glass cut pad col" style={{ gap: 8 }}>
        <div className="row between"><span className="tag cyan"><span>Invite friends</span></span><span className="tiny muted">{clubs.length}/{league.maxClubs} clubs</span></div>
        <div className="lz" style={{ fontSize: 34, letterSpacing: 6, color: '#7FE9F7' }}>{league.code}</div>
        <div className="small muted">Send them the link {share} and this code. Empty places become {['easy', 'normal', 'hard'][league.aiLevel]} AI clubs when the season starts.</div>
        {clubs.map((c) => (
          <div key={c.id} className="row small">
            <Crest c1={c.color1} c2={c.color2} size={22} /><b className="grow ellipsis">{c.name}</b><span className="dim">{c.username}</span><span className="muted">{c.players} pl</span>
          </div>
        ))}
      </div>
      <div className="glass cut pad col" style={{ gap: 8 }}>
        <span className="tag"><span>Schedule</span></span>
        <div className="small">{league.interval === 1440 ? <>Every day at <b style={{ color: '#F2C14E' }}>{utcMinToLocal(league.kickoffUtcMin)}</b> (your time)</> : league.intervalLabel}</div>
        {league.isOwner ? (
          <>
            <ScheduleEditor league={league} act={act} busy={busy} />
            <button className="cta gold" disabled={busy} onClick={() => act('start', {}, 'The season has started!')}><span>Start the season</span></button>
            <div className="tiny muted">Every manager needs 16+ players and 2 keepers before you can start.</div>
          </>
        ) : (
          <div className="small muted">The league creator starts the season when everyone is ready.</div>
        )}
      </div>
    </div>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return <div className="row small"><span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', background: ok ? '#7CE3A1' : 'rgba(255,255,255,0.12)', color: '#0E3020', fontWeight: 900 }}>{ok ? '✓' : ''}</span>{text}</div>;
}

function ScheduleEditor({ league, act, busy }: { league: any; act: (p: string, b: unknown, m: string) => void; busy: boolean }) {
  const [iv, setIv] = useState(league.interval);
  const [t, setT] = useState(utcMinToLocal(league.kickoffUtcMin));
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row wrap">
        {[[1440, 'Daily'], [60, 'Hourly'], [15, '15 min']].map(([v, l]) => (
          <button key={v} className={`chip ${iv === v ? 'on' : ''}`} onClick={() => setIv(v as number)}><span>{l}</span></button>
        ))}
        {iv === 1440 && <input type="time" value={t} onChange={(e) => setT(e.target.value || '18:00')} style={{ width: 120, height: 32 }} />}
      </div>
      <button className="ghost" disabled={busy} onClick={() => act('schedule', { interval: iv, kickoffUtcMin: localToUtcMin(t) }, 'Schedule saved')}><span>Save schedule</span></button>
    </div>
  );
}

function OwnerTools({ d, act, busy }: { d: any; act: (p: string, b: unknown, m: string) => void; busy: boolean }) {
  const { league } = d;
  if (league.status !== 'running') return null;
  return (
    <div className="glass cut pad col" style={{ gap: 8 }}>
      <span className="tag gold"><span>League creator</span></span>
      <div className="small">{league.interval === 1440 ? <>Matches every day at <b style={{ color: '#F2C14E' }}>{utcMinToLocal(league.kickoffUtcMin)}</b></> : league.intervalLabel}</div>
      <ScheduleEditor league={league} act={act} busy={busy} />
      <button className="cta small" disabled={busy} onClick={() => act('playnow', {}, 'Matchday played')}><span>Play next matchday now</span></button>
      <div className="tiny muted">For testing: plays the next matchday right away and moves the rest of the schedule earlier.</div>
    </div>
  );
}
