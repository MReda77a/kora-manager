'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/client.ts';
import { Cash, Coin, Crest, Icon, Spinner, useToast } from '../../../components/ui.tsx';
import CreateClub from '../../../components/CreateClub.tsx';
import HomeTab from '../../../components/tabs/Home.tsx';
import LineupTab from '../../../components/tabs/Lineup.tsx';
import TacticsTab from '../../../components/tabs/Tactics.tsx';
import PlayersTab from '../../../components/tabs/Players.tsx';
import TrainingTab from '../../../components/tabs/Training.tsx';
import ConditionTab from '../../../components/tabs/Condition.tsx';
import OfficeTab from '../../../components/tabs/Office.tsx';
import StoreTab from '../../../components/tabs/Store.tsx';
import MarketTab from '../../../components/tabs/Market.tsx';
import CupTab from '../../../components/tabs/Cup.tsx';
import PaperTab from '../../../components/tabs/Paper.tsx';
import AwardsTab from '../../../components/tabs/Awards.tsx';
import { FixturesTab, LeadersTab, TableTab } from '../../../components/tabs/LeagueTabs.tsx';
import HistoryTab from '../../../components/tabs/History.tsx';
import Tutorial from '../../../components/Tutorial.tsx';
import LiveAlert from '../../../components/LiveAlert.tsx';
import { SoundButton } from '../../../components/SoundButton.tsx';
import WindowSplash from '../../../components/WindowSplash.tsx';
import { crowdBed, music } from '../../../lib/sound.ts';
import { SECTIONS, TABS, sectionOf, type Tab } from '../../../components/tabs/types.ts';

export default function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const toast = useToast();
  const load = useCallback(() => api(`/api/leagues/${id}/overview`).then(setD).catch((e) => setErr(e.message)), [id]);
  // the club menus have the main theme playing quietly (it starts on the first tap)
  useEffect(() => { music('menu'); crowdBed(null); }, []);
  useEffect(() => {
    load();
    try {
      const t = (new URL(location.href).searchParams.get('tab') || sessionStorage.getItem(`kora-tab-${id}`)) as Tab | null;
      if (t && TABS.some((x) => x[0] === t)) setTab(t);
    } catch {}
    const iv = setInterval(load, 20_000);
    return () => clearInterval(iv);
  }, [id, load]);
  // matches are played a little at a time on the server; keep asking while work is waiting
  useEffect(() => {
    if (!d?.pending) return;
    const t = setTimeout(load, 500);
    return () => clearTimeout(t);
  }, [d, load]);
  const [lastIn, setLastIn] = useState<Record<string, Tab>>({});
  const [tutClosed, setTutClosed] = useState(false);
  const go = (t: Tab) => {
    setTab(t);
    setLastIn((m) => ({ ...m, [sectionOf(t).key]: t }));
    try { sessionStorage.setItem(`kora-tab-${id}`, t); } catch {}
    document.querySelector('.content')?.scrollTo({ top: 0 });
  };

  if (err) return <div className="pad col" style={{ gap: 10 }}><div className="err">{err}</div><a className="ghost" href="/"><span>Back</span></a></div>;
  if (!d) return <Spinner />;
  const { league, club } = d;
  if (!club) {
    if (league.status !== 'setup') return <div className="pad col" style={{ gap: 10 }}><div className="lz" style={{ fontSize: 22 }}>{league.name}</div><div className="muted">This league has already kicked off. New clubs can join next season.</div><a className="ghost" href="/"><span>Back</span></a></div>;
    return <CreateClub league={league} onDone={load} />;
  }
  const lid = league.id;
  const props = { lid, d, reload: load, toast, go };
  return (
    <div className="shell">
      <nav className="rail" aria-label="Sections">
        <a href="/" aria-label="All leagues"><Icon name="back" /><span>Leagues</span></a>
        {SECTIONS.map((sec) => {
          const on = sectionOf(tab).key === sec.key;
          const badge = sec.key === 'transfers' ? club.offers : sec.key === 'team' ? club.requests : 0;
          return (
            <button key={sec.key} className={on ? 'on' : ''} onClick={() => go(lastIn[sec.key] && sec.tabs.includes(lastIn[sec.key]) ? lastIn[sec.key] : sec.tabs[0])} aria-current={on ? 'page' : undefined} style={{ position: 'relative' }}>
              <Icon name={sec.icon} />
              <span>{sec.label}</span>
              {badge > 0 && <i style={{ position: 'absolute', top: 4, right: 10, minWidth: 16, height: 16, borderRadius: 8, background: '#E8438C', color: '#fff', fontSize: 11, fontStyle: 'normal', fontWeight: 900, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{badge}</i>}
            </button>
          );
        })}
        <div style={{ marginTop: 'auto', display: 'grid', placeItems: 'center', padding: '8px 0' }}><SoundButton side /></div>
      </nav>
      <div className="main">
        {tab === 'home' && (
          <header className="top">
            <Crest c1={club.color1} c2={club.color2} shape={club.shape} emblem={club.emblem} size={38} />
            <div className="col grow" style={{ gap: 0, lineHeight: 1.1, minWidth: 0 }}>
              <span className="lz ellipsis" style={{ fontSize: 22 }}>{club.name}</span>
              <span className="tiny muted ellipsis" style={{ fontWeight: 700 }}>{league.name} · {league.poolName} · {league.status === 'setup' ? 'Pre-season' : league.status === 'finished' ? `Season ${league.season} over` : `S${league.season} · Matchday ${d.matchdays.played}/${d.matchdays.total}`}</span>
            </div>
            <div className="coin" title="Coins for packs"><Coin /><b>{club.coins}</b></div>
            <div className="coin" title="Club money"><Cash /><b>{Number(club.money).toFixed(1)}M</b></div>
          </header>
        )}
        {sectionOf(tab).tabs.length > 1 && (
          <nav className="subtabs" aria-label={sectionOf(tab).label}>
            {sectionOf(tab).tabs.map((k) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)} aria-current={tab === k ? 'page' : undefined}>
                <span>{TABS.find((x) => x[0] === k)![1]}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="content" style={tab === 'home' ? undefined : { paddingTop: 8 }}>
          {tab === 'home' && <HomeTab {...props} />}
          {tab === 'lineup' && <LineupTab {...props} />}
          {tab === 'tactics' && <TacticsTab {...props} />}
          {tab === 'players' && <PlayersTab {...props} />}
          {tab === 'training' && <TrainingTab {...props} />}
          {tab === 'condition' && <ConditionTab {...props} />}
          {tab === 'office' && <OfficeTab {...props} />}
          {tab === 'store' && <StoreTab {...props} />}
          {tab === 'market' && <MarketTab {...props} />}
          {tab === 'table' && <TableTab {...props} />}
          {tab === 'fixtures' && <FixturesTab {...props} />}
          {tab === 'cup' && <CupTab {...props} />}
          {tab === 'paper' && <PaperTab {...props} />}
          {tab === 'awards' && <AwardsTab {...props} />}
          {tab === 'leaders' && <LeadersTab {...props} />}
          {tab === 'history' && <HistoryTab {...props} />}
        </div>
      </div>
      <LiveAlert live={d.live} club={club} />
      {(club.tutorialDone || tutClosed) && !d.live?.length && league.status === 'running' && d.window && <WindowSplash lid={lid} season={league.season} win={d.window} go={go} />}
      {!club.tutorialDone && !tutClosed && !d.live?.length && <Tutorial lid={lid} league={league} club={club} go={(t) => { go(t); }} onDone={() => { setTutClosed(true); load(); }} />}
      {toast.node}
    </div>
  );
}
