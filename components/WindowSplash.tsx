'use client';
// A full-screen moment when a round starts and the transfer window opens (5 days), and when it shuts.
// Each one shows once per league and season on this device.
import { useEffect, useState } from 'react';
import { play, thud } from '../lib/sound.ts';
import type { Tab } from './tabs/types.ts';

type Win = { open: boolean; round: 0 | 1 | 2; phase: string; closesAt?: string; opensAt?: string };

export function timeLeft(iso?: string) {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : '');

export default function WindowSplash({ lid, season, win, go }: { lid: number; season: number; win: Win; go: (t: Tab) => void }) {
  const [show, setShow] = useState<null | 'open' | 'closed'>(null);
  const base = `kora-win-${lid}-${season}-${win.round}`;
  useEffect(() => {
    try {
      if ((win.phase === 'open1' || win.phase === 'open2') && !localStorage.getItem(`${base}-open`)) setShow('open');
      else if ((win.phase === 'between' || win.phase === 'after') && localStorage.getItem(`${base}-open`) && !localStorage.getItem(`${base}-closed`)) setShow('closed');
    } catch {}
  }, [base, win.phase]);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => { thud(); if (show === 'open') play('applause', { gain: 0.6 }); }, 700);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  const close = (goMarket = false) => {
    try { localStorage.setItem(`${base}-${show}`, '1'); } catch {}
    setShow(null);
    if (goMarket) go('market');
  };
  const first = win.round === 1;
  if (show === 'open') {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label="Transfer window open" style={{ zIndex: 65, flexDirection: 'column', gap: 10, textAlign: 'center', overflow: 'hidden' }}>
        <span className="tag cyan" style={{ animation: 'fadeUp .5s both' }}><span>🏁 {first ? 'THE FIRST ROUND' : 'THE SECOND ROUND'}</span></span>
        <span className="big" style={{ fontSize: 'clamp(30px, 7vw, 54px)', animation: 'zoomIn .9s .15s both' }}>HAS STARTED</span>
        <span className="small muted" style={{ maxWidth: 460, animation: 'fadeUp .5s .6s both', fontWeight: 700 }}>
          {first ? 'Every team plays every other team once.' : 'The return games: every fixture again, home and away swapped.'}
        </span>
        <div style={{ position: 'relative', margin: '8px 0', animation: 'pop .55s .8s both' }}>
          <span className="lz" style={{ display: 'inline-block', padding: '10px 22px', fontSize: 'clamp(20px, 4.2vw, 32px)', color: '#06121F', background: '#F2C14E', boxShadow: '0 0 0 3px #06121F, 0 0 0 6px #F2C14E', transform: 'rotate(-2deg)' }}>
            🔓 TRANSFER WINDOW OPEN
          </span>
        </div>
        <span className="lz" style={{ fontSize: 20, animation: 'fadeUp .5s 1.2s both' }}>Open for 5 days · {timeLeft(win.closesAt)} left</span>
        <span className="small muted" style={{ animation: 'fadeUp .5s 1.3s both', fontWeight: 700 }}>It shuts on {when(win.closesAt)}. After that, no buying, selling, loans or swaps{first ? ' until the second round.' : ' until next season.'}</span>
        <div className="row center" style={{ gap: 10, marginTop: 6, animation: 'fadeUp .5s 1.5s both' }}>
          <button className="cta shine" style={{ minHeight: 48 }} onClick={() => close(true)}><span>Go to the market</span></button>
          <button className="ghost" style={{ minHeight: 48 }} onClick={() => close()}><span>Later</span></button>
        </div>
      </div>
    );
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Transfer window closed" style={{ zIndex: 65, flexDirection: 'column', gap: 14, textAlign: 'center' }}>
      <div style={{ animation: 'pop .55s .2s both' }}>
        <span className="lz" style={{ display: 'inline-block', padding: '10px 22px', fontSize: 'clamp(20px, 4.2vw, 32px)', color: '#fff', background: 'var(--red)', boxShadow: '0 0 0 3px #06121F, 0 0 0 6px var(--red)', transform: 'rotate(-2deg)' }}>
          🔒 TRANSFER WINDOW CLOSED
        </span>
      </div>
      <span className="small muted" style={{ maxWidth: 460, fontWeight: 700, animation: 'fadeUp .5s .7s both' }}>
        {win.phase === 'between' ? `The deals are done. It opens again when the second round starts${win.opensAt ? ` (${when(win.opensAt)})` : ''}.` : 'The deals are done. It opens again next season.'}
      </span>
      <button className="cta" style={{ minHeight: 48, animation: 'fadeUp .5s .9s both' }} onClick={() => close()}><span>OK</span></button>
    </div>
  );
}
