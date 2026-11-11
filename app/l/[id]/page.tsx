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
import ProfileTab from '../../../components/tabs/Profile.tsx';
import OfficeTab from '../../../components/tabs/Office.tsx';
import StoreTab from '../../../components/tabs/Store.tsx';
import MarketTab from '../../../components/tabs/Market.tsx';
import CupTab from '../../../components/tabs/Cup.tsx';
import PaperTab from '../../../components/tabs/Paper.tsx';
import AwardsTab from '../../../components/tabs/Awards.tsx';
import { FixturesTab, LeadersTab, StreaksTab, TableTab } from '../../../components/tabs/LeagueTabs.tsx';
import HistoryTab from '../../../components/tabs/History.tsx';
import AnalystTab from '../../../components/tabs/Analyst.tsx';
import PressTab from '../../../components/tabs/Press.tsx';
import DealsTab from '../../../components/tabs/Deals.tsx';
import ManagersTab from '../../../components/tabs/Managers.tsx';
import { SocialTab, TvTab } from '../../../components/tabs/Media.tsx';
import FriendlyTab from '../../../components/tabs/Friendly.tsx';
import Tutorial from '../../../components/Tutorial.tsx';
import LiveAlert from '../../../components/LiveAlert.tsx';
import { LangButton } from '../../../components/Lang.tsx';
import { SoundButton } from '../../../components/SoundButton.tsx';
import WindowSplash from '../../../components/WindowSplash.tsx';
import { crowdBed, music } from '../../../lib/sound.ts';
import { GROUPS, SECTIONS, TABS, sectionOf, topTab, type Tab } from '../../../components/tabs/types.ts';

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
    // the press room covers the whole screen: never come back into it from the menu or a reload
    const keep = t === 'press' ? 'analyst' : t;
    setLastIn((m) => ({ ...m, [sectionOf(t).key]: keep }));
    try { sessionStorage.setItem(`kora-tab-${id}`, keep); } catch {}
    document.querySelector('.content')?.scrollTo({ top: 0 });
  };

  // the whole game turns gold while your next match is a derby
  const nextFx = d?.fixtures?.find((f: any) => f.status !== 'done');
  const derbyNext = !!(nextFx && nextFx.ht === 'fan' && nextFx.at === 'fan' && nextFx.hu && nextFx.au);
  if (err) return <div className="pad col" style={{ gap: 10 }}><div className="err">{err}</div><div className="row" style={{ gap: 8 }}><button className="cta" onClick={() => { setErr(''); load(); }}><span>Try again</span></button><a className="ghost" href="/"><span>Back</span></a></div></div>;
  if (!d) return <Spinner />;
  const { league, club } = d;
  if (!club) {
    if (league.status === 'finished') return <div className="pad col" style={{ gap: 10 }}><div className="lz" style={{ fontSize: 22 }}>{league.name}</div><div className="muted">This season is over. New clubs can join next season.</div><a className="ghost" href="/"><span>Back</span></a></div>;
    return <CreateClub league={league} onDone={load} />;
  }
  const lid = league.id;
  const props = { lid, d, reload: load, toast, go };
  return (
    <div className={`shell ${derbyNext ? 'theme-derby derby-ui' : ''}`}>
      <nav className="rail" aria-label="Sections">
        <div className="rail-club"><Crest c1={club.color1} c2={club.color2} shape={club.shape} emblem={club.emblem} size={40} /><div className="col" style={{ gap: 0, lineHeight: 1.15, minWidth: 0 }}><span className="lz ellipsis" style={{ fontSize: 17, fontWeight: 600 }}>{club.name}</span><span className="tiny muted ellipsis">{league.name}</span></div></div>
        <a href="/" aria-label="All leagues" className="rail-back"><Icon name="back" /><span>Leagues</span></a>
        {SECTIONS.map((sec) => {
          const on = sectionOf(tab).key === sec.key;
          const badge = sec.key === 'transfers' ? club.offers : sec.key === 'team' ? club.requests : 0;
          return (
            <button key={sec.key} className={on ? 'on' : ''} onClick={() => go(lastIn[sec.key] && sec.tabs.includes(topTab(lastIn[sec.key])) ? lastIn[sec.key] : sec.tabs[0])} aria-current={on ? 'page' : undefined} style={{ position: 'relative' }}>
              <Icon name={sec.icon} />
              <span>{sec.label}</span>
              {badge > 0 && <i style={{ position: 'absolute', top: 4, right: 10, minWidth: 16, height: 16, borderRadius: 8, background: '#2EE6A0', color: '#fff', fontSize: 11, fontStyle: 'normal', fontWeight: 900, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{badge}</i>}
            </button>
          );
        })}
        <div className="rail-card" style={{ marginTop: 'auto' }}><span className="script" style={{ fontSize: 22, color: 'var(--mint)', transform: 'rotate(-4deg)', transformOrigin: 'left' }}>Vamos!</span><span className="tiny muted" style={{ lineHeight: 1.4 }}>{league.name}<br />{league.poolName}</span></div>
        <div className="rail-settings" style={{ display: 'grid', placeItems: 'center', padding: '8px 0', gap: 6, gridAutoFlow: 'row' }}><LangButton /><SoundButton side /></div>
      </nav>
      <div className="main">
        <header className="head2">
          <span className="sec">{sectionOf(tab).label}</span>
          {sectionOf(tab).tabs.length > 1 && (
            <nav className="subtabs" aria-label={sectionOf(tab).label}>
              {sectionOf(tab).tabs.map((k) => (
                <button key={k} className={topTab(tab) === k ? 'on' : ''} onClick={() => go(k)} aria-current={topTab(tab) === k ? 'page' : undefined}>
                  <span>{TABS.find((x) => x[0] === k)![1]}</span>
                </button>
              ))}
            </nav>
          )}
          <span className="grow" />
          <div className="when"><b>{new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b><span>{league.status === 'setup' ? 'Pre-season' : league.status === 'finished' ? `Season ${league.season} over` : `Season ${league.season} · Matchday ${d.matchdays.played}/${d.matchdays.total}`}</span></div>
          <div className="coin" title="Coins for packs"><Coin /><b>{club.coins}</b></div>
          <div className="coin" title="Club money"><Cash /><b>{Number(club.money).toFixed(1)}M</b></div>
        </header>
        {tab === 'home' && (
          <header className="top home-top">
            <Crest c1={club.color1} c2={club.color2} shape={club.shape} emblem={club.emblem} size={38} />
            <div className="col grow" style={{ gap: 0, lineHeight: 1.1, minWidth: 0 }}>
              <span className="lz ellipsis" style={{ fontSize: 22 }}>{club.name}</span>
              <span className="tiny muted ellipsis" style={{ fontWeight: 700 }}>{league.name} · {league.poolName} · {league.status === 'setup' ? 'Pre-season' : league.status === 'finished' ? `Season ${league.season} over` : `S${league.season} · Matchday ${d.matchdays.played}/${d.matchdays.total}`}</span>
            </div>
            <div className="coin" title="Coins for packs"><Coin /><b>{club.coins}</b></div>
            <div className="coin" title="Club money"><Cash /><b>{Number(club.money).toFixed(1)}M</b></div>
            <span className="portrait-only row" style={{ gap: 4 }}><LangButton /></span>
          </header>
        )}
        {sectionOf(tab).tabs.length > 1 && (
          <nav className="subtabs bare" aria-label={sectionOf(tab).label}>
            {sectionOf(tab).tabs.map((k) => (
              <button key={k} className={topTab(tab) === k ? 'on' : ''} onClick={() => go(k)} aria-current={topTab(tab) === k ? 'page' : undefined}>
                <span>{TABS.find((x) => x[0] === k)![1]}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="content" style={tab === 'home' ? undefined : { paddingTop: 8 }}>
          {(() => { const g = GROUPS.find((x) => x.tabs.includes(tab)); return g ? (
            <div className="row groupnav" role="tablist">{g.tabs.map((k, i) => <button key={k} role="tab" aria-selected={tab === k} className={`seg ${tab === k ? 'on' : ''}`} onClick={() => go(k)}><span>{g.labels[i]}</span></button>)}</div>
          ) : null; })()}
          {tab === 'home' && <HomeTab {...props} />}
          {tab === 'lineup' && <LineupTab {...props} />}
          {tab === 'tactics' && <TacticsTab {...props} />}
          {tab === 'analyst' && <AnalystTab {...props} />}
          {tab === 'press' && <PressTab {...props} />}
          {tab === 'deals' && <DealsTab {...props} />}
          {tab === 'managers' && <ManagersTab {...props} />}
          {(tab === 'tv' || tab === 'social') && <div className="media2">
            <MediaHead icon="tv" title="TV coverage" sub="Match days · Analysis · Interviews" /><TvTab {...props} />
            <MediaHead icon="fans" title="Social media" sub="Fans · Reactions · Demands" /><SocialTab {...props} />
          </div>}
          {tab === 'friendly' && <FriendlyTab {...props} />}
          {tab === 'players' && <PlayersTab {...props} />}
          {tab === 'training' && <TrainingTab {...props} />}
          {tab === 'condition' && <ConditionTab {...props} />}
          {tab === 'profile' && <ProfileTab {...props} />}
          {tab === 'office' && <OfficeTab {...props} />}
          {tab === 'store' && <StoreTab {...props} />}
          {tab === 'market' && <MarketTab {...props} />}
          {tab === 'table' && <TableTab {...props} />}
          {tab === 'fixtures' && <FixturesTab {...props} />}
          {tab === 'cup' && <CupTab {...props} />}
          {tab === 'paper' && <div className="media2"><MediaHead icon="paper" title="Newspapers" sub="Articles · Interviews · Features" /><PaperTab {...props} /></div>}
          {tab === 'awards' && <AwardsTab {...props} />}
          {tab === 'leaders' && <LeadersTab {...props} />}
          {tab === 'streaks' && <StreaksTab {...props} />}
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

// the heading of each media desk: an icon, the desk and what it covers
function MediaHead({ icon, title, sub }: { icon: 'tv' | 'fans' | 'paper'; title: string; sub: string }) {
  const path = icon === 'tv' ? <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M8 3l4 3 4-3" /><path d="M10 10l5 2.5-5 2.5z" fill="#2EF2B0" /></>
    : icon === 'fans' ? <path d="M4 5h16v10H9l-5 4z" /> : <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h6M7 16h10" /></>;
  return (
    <div className="media-head">
      <span className="media-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2EF2B0" strokeWidth="2" aria-hidden="true">{path}</svg></span>
      <span className="col" style={{ gap: 0, lineHeight: 1.15 }}><span className="lz" style={{ fontSize: 22, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>{title}</span><span className="small muted">{sub}</span></span>
    </div>
  );
}
