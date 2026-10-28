'use client';
import { useEffect, useState } from 'react';
import { Crest } from './ui.tsx';
import { whistle } from '../lib/sound.ts';

// Pops up when one of your matches kicks off: watch it live or skip to the result.
export default function LiveAlert({ live, club }: { live: any[]; club: any }) {
  const [hidden, setHidden] = useState<Record<number, boolean>>({});
  useEffect(() => {
    try { setHidden(JSON.parse(sessionStorage.getItem('kora-live-seen') || '{}')); } catch {}
  }, []);
  const f = (live || []).find((x) => !hidden[x.id]);
  useEffect(() => {
    if (!f) return;
    whistle();
    try { navigator.vibrate?.([120, 60, 120]); } catch {}
    try {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Kick-off!', { body: `${f.home} vs ${f.away} is live now. Watch or skip.`, tag: `kora-${f.id}` });
      }
    } catch {}
  }, [f?.id]);
  if (!f) return null;
  const dismiss = () => {
    const n = { ...hidden, [f.id]: true };
    setHidden(n);
    try { sessionStorage.setItem('kora-live-seen', JSON.stringify(n)); } catch {}
  };
  const derby = f.ht === 'fan' && f.at === 'fan' && f.hu && f.au;
  const cup = f.comp === 'cup';
  const accent = derby ? '#F2C14E' : cup ? '#2FE6B0' : '#2EE6A0';
  return (
    <div className="overlay" style={{ zIndex: 70 }}>
      <div className={`panel cut ${derby ? 'theme-derby' : cup ? 'theme-cup' : ''}`} style={{ width: 'min(520px, 100%)', alignItems: 'center', textAlign: 'center', gap: 10, padding: 18, animation: 'pop .4s both' }}>
        <span className="tag" style={{ background: accent, color: derby || cup ? '#06121F' : '#fff' }}><span>{derby ? 'DERBY · KICK-OFF' : cup ? 'CUP · KICK-OFF' : 'KICK-OFF'}</span></span>
        <div className="row" style={{ gap: 16, justifyContent: 'center' }}>
          <Crest c1={f.hc} c2={f.hc2} shape={f.hsh} emblem={f.hu ? f.hem : -1} short={f.hs} size={52} />
          <span className="lz" style={{ fontSize: 30, color: accent, animation: 'beat 1s infinite' }}>LIVE</span>
          <Crest c1={f.ac} c2={f.ac2} shape={f.ash} emblem={f.au ? f.aem : -1} short={f.as_} size={52} />
        </div>
        <b className="lz" style={{ fontSize: 22 }}>{f.home} vs {f.away}</b>
        <span className="small muted">Your match has started. Watch it live (2 minutes) and make changes, or let your assistant handle it and see the result.</span>
        <div className="row" style={{ gap: 10 }}>
          <a className="cta shine" href={`/m/${f.id}`} onClick={dismiss}><span>Watch live</span></a>
          <a className="ghost" href={`/m/${f.id}?skip=1`} onClick={dismiss}><span>Skip to result</span></a>
        </div>
        {'Notification' in globalThis && typeof Notification !== 'undefined' && Notification.permission === 'default' && (
          <button className="tiny" style={{ color: '#5FD3F3', fontWeight: 800 }} onClick={() => Notification.requestPermission()}>Turn on kick-off notifications</button>
        )}
        <button className="tiny muted" onClick={dismiss}>Later</button>
      </div>
    </div>
  );
}
