'use client';
// Registers the service worker and offers "Install app" and phone notifications.
import { useEffect, useState } from 'react';
import { api } from '../lib/client.ts';

const toKey = (b64: string) => {
  const p = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export function useServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
}

export function AppPanel({ toast }: { toast: { ok: (m: string) => void; bad: (m: string) => void } }) {
  const [prompt, setPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [perm, setPerm] = useState<string>('default');
  const [subbed, setSubbed] = useState(false);
  const pushOk = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  useEffect(() => {
    const standalone = matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    setInstalled(!!standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const h = (e: any) => { e.preventDefault(); setPrompt(e); };
    addEventListener('beforeinstallprompt', h);
    if ('Notification' in window) setPerm(Notification.permission);
    navigator.serviceWorker?.ready.then((r) => r.pushManager?.getSubscription()).then((s) => setSubbed(!!s)).catch(() => {});
    return () => removeEventListener('beforeinstallprompt', h);
  }, []);
  const install = async () => { if (!prompt) return; prompt.prompt(); const r = await prompt.userChoice; if (r.outcome === 'accepted') setInstalled(true); setPrompt(null); };
  const turnOn = async () => {
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') return toast.bad('Notifications are blocked in your browser settings.');
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api('/api/push');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
      await api('/api/push', { subscription: sub.toJSON() });
      setSubbed(true);
      toast.ok('Notifications on: kick-offs, offers and big club news.');
    } catch (e: any) { toast.bad(e.message || 'Could not turn on notifications.'); }
  };
  const turnOff = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/api/push', { unsubscribe: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    setSubbed(false);
    toast.ok('Notifications off on this device.');
  };
  return (
    <div className="glass cut pad col" style={{ gap: 8, maxWidth: 560 }}>
      <div className="lz" style={{ fontSize: 20 }}>Play it like an app</div>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        {installed ? <span className="tag green"><span>Installed</span></span>
          : prompt ? <button className="cta small" onClick={install}><span>Install app</span></button>
          : <span className="small muted">{ios ? 'On iPhone: tap Share, then "Add to Home Screen". It opens full screen.' : 'Open your browser menu and choose "Install app" or "Add to Home screen". It opens full screen and sideways.'}</span>}
      </div>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        {!pushOk ? <span className="small muted">{ios ? 'On iPhone, notifications work after you add the game to the Home Screen.' : 'This browser does not support notifications.'}</span>
          : subbed ? <><span className="tag green"><span>Notifications on</span></span><button className="seg" onClick={turnOff}><span>Turn off</span></button></>
          : <button className="ghost" onClick={turnOn}><span>{perm === 'denied' ? 'Notifications blocked' : 'Turn on notifications'}</span></button>}
        <span className="tiny muted">Kick-offs, offers for your players, done deals and transfer requests, even when the game is closed.</span>
      </div>
    </div>
  );
}
