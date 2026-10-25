'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, localToUtcMin } from '../lib/client.ts';
import { Crest, Spinner, useToast } from '../components/ui.tsx';

type Me = { user: { id: number; name: string } | null; leagues?: any[] };

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const load = () => api<Me>('/api/me').then(setMe).catch(() => setMe({ user: null }));
  useEffect(() => {
    load();
  }, []);
  if (!me) return <Spinner />;
  if (!me.user) return <Auth onDone={load} />;
  return <Lobby me={me} reload={load} />;
}

function Logo({ size = 46 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 1l17 10v18L20 39 3 29V11z" fill="#E8438C" />
      <path d="M20 5l13.5 8v14L20 35 6.5 27V13z" fill="#1E1250" />
      <path d="M20 11a9 9 0 110 18 9 9 0 010-18zm0 4l-3.5 2.6 1.3 4.1h4.4l1.3-4.1z" fill="#F3EEFF" />
    </svg>
  );
}

function Auth({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, { username: u, password: p });
      onDone();
    } catch (x: any) {
      setErr(x.message);
    }
    setBusy(false);
  };
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', alignItems: 'center', gap: 20, padding: '20px 24px' }}>
      <div className="col rise" style={{ gap: 6 }}>
        <div className="row"><Logo size={56} /><span className="lz" style={{ fontSize: 40, lineHeight: 1 }}>Kora Manager</span></div>
        <p className="muted" style={{ margin: 0, fontSize: 15, maxWidth: 380 }}>Build your club from packs, set the tactics that beat your friends, and watch every match play out in two minutes.</p>
        <div className="row wrap" style={{ marginTop: 6 }}>
          <span className="tag pink"><span>8 leagues</span></span>
          <span className="tag"><span>Real tactics</span></span>
          <span className="tag gold"><span>Derby days</span></span>
        </div>
      </div>
      <form onSubmit={go} className="glass cut pad col rise" style={{ maxWidth: 360, width: '100%', justifySelf: 'center', gap: 10 }}>
        <div className="row">
          <button type="button" className={`chip ${mode === 'register' ? 'on' : ''}`} onClick={() => setMode('register')}><span>New manager</span></button>
          <button type="button" className={`chip ${mode === 'login' ? 'on' : ''}`} onClick={() => setMode('login')}><span>Log in</span></button>
        </div>
        <label className="col" style={{ gap: 4 }}><span className="small muted">Username</span><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required /></label>
        <label className="col" style={{ gap: 4 }}><span className="small muted">Password</span><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
        {err && <div className="err">{err}</div>}
        <button className="cta shine" disabled={busy}><span>{mode === 'register' ? 'Create account' : 'Log in'}</span></button>
      </form>
    </div>
  );
}

function Lobby({ me, reload }: { me: Me; reload: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState<'list' | 'create' | 'join'>('list');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const leagues = me.leagues || [];

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const l = await api(`/api/leagues/join?code=${encodeURIComponent(code)}`);
      setPreview(l);
    } catch (x: any) {
      toast.bad(x.message);
    }
  };
  const logout = async () => {
    await api('/api/auth/logout', {});
    reload();
  };
  return (
    <div style={{ minHeight: '100dvh', padding: '10px 16px 20px' }}>
      <header className="row between" style={{ height: 52 }}>
        <div className="row"><Logo size={36} /><span className="lz" style={{ fontSize: 24 }}>Kora Manager</span></div>
        <div className="row">
          <span className="muted small">Hi, <b style={{ color: '#F3EEFF' }}>{me.user!.name}</b></span>
          <button className="ghost" onClick={logout}><span>Log out</span></button>
        </div>
      </header>
      <div className="row wrap" style={{ margin: '6px 0 12px' }}>
        <button className={`chip ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}><span>My leagues ({leagues.length})</span></button>
        <button className={`chip ${view === 'create' ? 'on' : ''}`} onClick={() => setView('create')}><span>+ Create league</span></button>
        <button className={`chip ${view === 'join' ? 'on' : ''}`} onClick={() => setView('join')}><span>Join with code</span></button>
      </div>

      {view === 'list' && (
        leagues.length ? (
          <div className="grid3">
            {leagues.map((l) => (
              <a key={l.id} href={`/l/${l.id}`} className="glass cut pad col rise" style={{ color: 'inherit', gap: 6 }}>
                <div className="row between">
                  <span className={`tag ${l.status === 'running' ? 'green' : l.status === 'setup' ? 'gold' : ''}`}><span>{l.status === 'setup' ? 'Pre-season' : l.status === 'running' ? 'Live season' : 'Finished'}</span></span>
                  <span className="tiny dim">CODE {l.code}</span>
                </div>
                <div className="lz" style={{ fontSize: 20 }}>{l.name}</div>
                <div className="row"><Crest c1={l.color1} c2={l.color2} size={28} /><span className="ellipsis" style={{ fontWeight: 800 }}>{l.club_name}</span></div>
                <div className="tiny muted">{l.humans} managers · {l.clubs}/{l.max_clubs} clubs</div>
              </a>
            ))}
          </div>
        ) : (
          <div className="glass cut pad col" style={{ maxWidth: 520, gap: 10 }}>
            <div className="lz" style={{ fontSize: 22 }}>No leagues yet</div>
            <div className="muted">Create a league and send the code to your friends, or join one with a code.</div>
            <div className="row"><button className="cta" onClick={() => setView('create')}><span>Create league</span></button><button className="ghost" onClick={() => setView('join')}><span>Join with code</span></button></div>
          </div>
        )
      )}

      {view === 'join' && (
        <form onSubmit={join} className="glass cut pad col" style={{ maxWidth: 420, gap: 10 }}>
          <div className="lz" style={{ fontSize: 22 }}>Join a league</div>
          <input placeholder="6-letter code, e.g. K7Q2MX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} style={{ letterSpacing: 4, fontWeight: 900, fontSize: 18 }} />
          <button className="cta"><span>Find league</span></button>
          {preview && (
            <div className="col" style={{ gap: 6, marginTop: 6 }}>
              <div className="lz" style={{ fontSize: 20 }}>{preview.name}</div>
              <div className="small muted">{preview.pool} · {preview.clubs}/{preview.max} clubs · {preview.status === 'setup' ? 'pre-season' : 'already started'}</div>
              {preview.status === 'setup' ? (
                <button type="button" className="cta cyan" onClick={() => router.push(`/l/${preview.id}`)}><span>Create my club here</span></button>
              ) : (
                <div className="err">This league already kicked off.</div>
              )}
            </div>
          )}
        </form>
      )}

      {view === 'create' && <CreateLeague onCreated={(id) => router.push(`/l/${id}`)} toast={toast} />}
      {toast.node}
    </div>
  );
}

function CreateLeague({ onCreated, toast }: { onCreated: (id: number) => void; toast: ReturnType<typeof useToast> }) {
  const [meta, setMeta] = useState<{ pools: Record<string, string>; caps: Record<string, number> } | null>(null);
  const [f, setF] = useState({ name: '', pool: 'ENG', maxClubs: 16, aiLevel: 2, interval: 1440, time: '18:00' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/leagues').then(setMeta).catch(() => {});
  }, []);
  const cap = meta?.caps[f.pool] ?? 30;
  const sizes = [10, 16, 20, 30].filter((n) => n <= cap);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('/api/leagues', { name: f.name, pool: f.pool, maxClubs: Math.min(f.maxClubs, cap), aiLevel: f.aiLevel, interval: f.interval, kickoffUtcMin: localToUtcMin(f.time) });
      onCreated(r.id);
    } catch (x: any) {
      toast.bad(x.message);
    }
    setBusy(false);
  };
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  return (
    <div className="grid2">
      <div className="glass cut pad col" style={{ gap: 12 }}>
        <div className="lz" style={{ fontSize: 22 }}>Create league</div>
        <label className="col" style={{ gap: 4 }}><span className="small muted">League name</span><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Friday Night League" maxLength={40} /></label>
        <div className="col" style={{ gap: 4 }}>
          <span className="small muted">Player pool (packs only give players from this league)</span>
          <div className="row wrap">
            {meta && Object.entries(meta.pools).map(([k, v]) => (
              <button key={k} className={`chip ${f.pool === k ? 'on' : ''}`} onClick={() => set('pool', k)}><span>{v.replace(' League', '')}</span></button>
            ))}
          </div>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <span className="small muted">Clubs (empty places become AI clubs)</span>
          <div className="row wrap">
            {sizes.map((n) => <button key={n} className={`chip ${f.maxClubs === n ? 'on' : ''}`} onClick={() => set('maxClubs', n)}><span>{n} clubs</span></button>)}
          </div>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <span className="small muted">AI difficulty</span>
          <div className="row wrap">
            {['Easy', 'Normal', 'Hard'].map((t, i) => <button key={t} className={`chip ${f.aiLevel === i ? 'on' : ''}`} onClick={() => set('aiLevel', i)}><span>{t}</span></button>)}
          </div>
        </div>
      </div>
      <div className="glass cut pad col" style={{ gap: 12 }}>
        <div className="lz" style={{ fontSize: 22 }}>Match schedule</div>
        <div className="row wrap">
          {[[1440, 'Every day'], [60, 'Every hour'], [15, 'Every 15 min (test)']].map(([v, t]) => (
            <button key={v} className={`chip ${f.interval === v ? 'on' : ''}`} onClick={() => set('interval', v)}><span>{t}</span></button>
          ))}
        </div>
        {f.interval === 1440 && (
          <label className="col" style={{ gap: 4 }}>
            <span className="small muted">Kick-off time (your time)</span>
            <input type="time" value={f.time} onChange={(e) => set('time', e.target.value || '18:00')} style={{ maxWidth: 160, fontSize: 18, fontWeight: 900 }} />
          </label>
        )}
        <div className="small muted" style={{ lineHeight: 1.5 }}>
          {f.interval === 1440 ? <>One matchday every day at <b style={{ color: '#F2C14E' }}>{f.time}</b>. Each friend sees it in their own time zone.</> : <>A matchday every {f.interval === 60 ? 'hour' : '15 minutes'}. Good for a quick test.</>}
          <br />Every club plays home and away. The transfer market opens before matchday 1 and at the halfway break. You can change the time later.
        </div>
        <button className="cta shine" onClick={go} disabled={busy || f.name.trim().length < 3} style={{ marginTop: 'auto' }}><span>Create league</span></button>
      </div>
    </div>
  );
}
