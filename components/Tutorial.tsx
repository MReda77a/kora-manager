'use client';
// First visit: five short steps that explain how the game works, each with a "show me" jump.
import { useState } from 'react';
import { api, utcMinToLocal } from '../lib/client.ts';
import type { Tab } from './tabs/types.ts';

export default function Tutorial({ lid, league, club, go, onDone }: { lid: number; league: any; club: any; go: (t: Tab) => void; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [mini, setMini] = useState(false);
  const steps: { title: string; text: string; tab?: Tab; cta?: string }[] = [
    { title: `Welcome, boss of ${club.name}`, text: `You manage ${club.name} against your friends and AI clubs. Matches are played every day at ${utcMinToLocal(league.kickoffUtcMin)} (your time). Win the league, the cup and your board's targets.` },
    { title: '1. Build your squad', text: 'Open packs with your coins. You need at least 16 players and 2 keepers. Packs fill your gaps first: up to 2 keepers, then 4 defenders, 3 midfielders and 3 forwards.', tab: 'store', cta: 'Open packs' },
    { title: '2. Pick a plan that suits your players', text: 'In Tactics, every plan shows how well it suits your squad. A great striker in the air loves crosses, fast forwards love through balls, a fit midfield can press. AI managers study your last plans: if you always play the same, they will be ready.', tab: 'tactics', cta: 'Show tactics' },
    { title: '3. Match day', text: 'At kick-off you get a notification. Watch it live (5 minutes, with a half-time break) to switch plans, change mentality and make subs, or let your assistant follow your rules. Prepare Plan B and Plan C in Tactics for one-tap switches.', tab: 'fixtures', cta: 'See fixtures' },
    { title: '4. Run the club', text: 'Choose a sponsor and check the board targets in the Club Office. Keep players happy: the ones on the bench sulk. Buy, loan and swap players when the transfer window is open.', tab: 'office', cta: 'Open the office' },
  ];
  const s = steps[i];
  const finish = async () => { try { await api(`/api/leagues/${lid}/tutorial`, {}); } catch {} onDone(); };
  if (mini) {
    return (
      <div className="glass cut row" style={{ position: 'fixed', left: 90, bottom: 12, zIndex: 70, padding: '8px 12px', gap: 10, maxWidth: 'calc(100vw - 110px)' }}>
        <span className="small" style={{ fontWeight: 800 }}>Guide {i + 1}/{steps.length}: {s.title}</span>
        <button className="cta small" onClick={() => { setMini(false); if (i < steps.length - 1) setI(i + 1); }}><span>{i < steps.length - 1 ? 'Next step' : 'Finish'}</span></button>
      </div>
    );
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="How to play" style={{ zIndex: 70 }}>
      <div className="glass cut pad col" style={{ maxWidth: 520, width: '100%', gap: 10 }}>
        <div className="row between"><span className="tag cyan"><span>How to play · {i + 1}/{steps.length}</span></span><button className="tiny muted" style={{ fontWeight: 800 }} onClick={finish}>Skip</button></div>
        <div className="lz" style={{ fontSize: 24 }}>{s.title}</div>
        <div className="small" style={{ lineHeight: 1.55 }}>{s.text}</div>
        <div className="row" style={{ gap: 6 }}>{steps.map((_, k) => <i key={k} style={{ width: 22, height: 4, background: k <= i ? 'var(--cyan)' : 'rgba(255,255,255,0.15)' }} />)}</div>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {i > 0 && <button className="ghost" onClick={() => setI(i - 1)}><span>Back</span></button>}
          {s.tab && <button className="ghost" onClick={() => { go(s.tab!); setMini(true); }}><span>{s.cta}</span></button>}
          {i < steps.length - 1 ? <button className="cta small" onClick={() => setI(i + 1)}><span>Next</span></button> : <button className="cta small" onClick={finish}><span>Let's play</span></button>}
        </div>
      </div>
    </div>
  );
}
