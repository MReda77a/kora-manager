'use client';
import { useEffect, useState } from 'react';
import { AppPanel } from '../components/AppSetup.tsx';
import { SoundButton } from '../components/SoundButton.tsx';
import { crowdBed, music } from '../lib/sound.ts';
import { useRouter } from 'next/navigation';
import { api, localToUtcMin } from '../lib/client.ts';
import { Crest, Spinner, useToast } from '../components/ui.tsx';

type Me = { user: { id: number; name: string } | null; leagues?: any[] };

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [down, setDown] = useState('');
  // only a clear "not logged in" answer shows the login screen; a hiccup shows a retry instead
  const load = () => api<Me>('/api/me').then((m) => { setDown(''); setMe(m); }).catch((e) => setDown(e.message || 'No connection.'));
  useEffect(() => { music('menu'); crowdBed(null); }, []);
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!down) return;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [down]);
  if (down && !me?.user) {
    return (
      <div className="pad col center" style={{ minHeight: '100dvh', gap: 12, textAlign: 'center' }}>
        <span className="lz" style={{ fontSize: 24 }}>Can't reach the game right now</span>
        <span className="small muted">{down} You are still logged in, trying again…</span>
        <button className="cta" onClick={load}><span>Try again</span></button>
      </div>
    );
  }
  if (!me) return <Spinner />;
  if (!me.user) return <Auth onDone={load} />;
  return <Lobby me={me} reload={load} />;
}

function Logo({ size = 46 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 1l17 10v18L20 39 3 29V11z" fill="#2EE6A0" />
      <path d="M20 5l13.5 8v14L20 35 6.5 27V13z" fill="#0A1626" />
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
  const [view, setView] = useState<'list' | 'create' | 'join' | 'ranking'>('list');
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
          <span className="muted small">Hi, <b style={{ color: '#E8F1FA' }}>{me.user!.name}</b></span>
          <SoundButton />
          <button className="ghost" onClick={logout}><span>Log out</span></button>
        </div>
      </header>
      <div className="row wrap" style={{ margin: '6px 0 12px' }}>
        <button className={`chip ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}><span>My leagues ({leagues.length})</span></button>
        <button className={`chip ${view === 'create' ? 'on' : ''}`} onClick={() => setView('create')}><span>+ Create league</span></button>
        <button className={`chip ${view === 'join' ? 'on' : ''}`} onClick={() => setView('join')}><span>Join with code</span></button>
        <button className={`chip ${view === 'ranking' ? 'on' : ''}`} onClick={() => setView('ranking')}><span>🌍 Manager ranking</span></button>
      </div>

      {view === 'ranking' && (
        <div className="glass cut pad col" style={{ maxWidth: 560, gap: 4 }}>
          <div className="row between"><span className="lz" style={{ fontSize: 22 }}>Global manager ranking</span><span className="small muted">Your reputation: <b style={{ color: '#F2C14E' }}>{(me.user as any).reputation ?? 0}</b></span></div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>Win +3 · draw +1 · title +50 · cup +30 · promotion +30 · Manager of the Season +20 · relegation −20</div>
          {((me as any).ranking || []).map((r: any, i: number) => (
            <div key={r.username} className="row small" style={{ gap: 10, padding: '5px 10px', fontWeight: 800, background: r.username === me.user!.name ? 'rgba(95, 211, 243,0.14)' : i % 2 ? 'rgba(255,255,255,0.03)' : undefined }}>
              <span className="lz" style={{ width: 26, fontSize: 18, color: i === 0 ? '#F2C14E' : i < 3 ? '#5FD3F3' : 'var(--muted)' }}>{i + 1}</span>
              <span className="grow ellipsis">{r.username}</span>
              <span className="tiny muted">{r.titles} 🏆</span>
              <b className="lz" style={{ width: 54, textAlign: 'right', fontSize: 18 }}>{r.reputation}</b>
            </div>
          ))}
        </div>
      )}

      {view === 'list' && (
        leagues.length ? (
          <div className="grid3">
            {leagues.map((l) => (
              <a key={l.id} href={`/l/${l.id}`} className="glass cut pad col rise" style={{ color: 'inherit', gap: 6 }}>
                <div className="row between">
                  <span className={`tag ${l.status === 'running' ? 'green' : l.status === 'setup' ? 'gold' : ''}`}><span>{l.status === 'setup' ? 'Pre-season' : l.status === 'running' ? 'Live season' : 'Season over'}</span></span>
                  <span className="tiny dim">CODE {l.code}</span>
                </div>
                <div className="lz" style={{ fontSize: 20 }}>{l.name}</div>
                {l.club_id
                  ? <div className="row"><Crest c1={l.color1} c2={l.color2} size={28} /><span className="ellipsis" style={{ fontWeight: 800 }}>{l.club_name}</span></div>
                  : <div className="small" style={{ color: '#F2C14E', fontWeight: 800 }}>Create your club ›</div>}
                <div className="tiny muted">{l.humans} manager{l.humans === 1 ? '' : 's'} · {l.status === 'setup' ? `up to ${l.max_clubs} clubs` : `${l.clubs} clubs`}{l.divisions > 1 ? ` · ${l.divisions} divisions` : ''}{l.season > 1 ? ` · season ${l.season}` : ''}</div>
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

      {view === 'list' && <div style={{ marginTop: 12 }}><AppPanel toast={toast} /></div>}

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
              ) : preview.status === 'running' ? (
                <>
                  <div className="small" style={{ color: '#F2C14E', fontWeight: 700 }}>The season has started: you will take over a random AI club, with its players and its place in the table.</div>
                  <button type="button" className="cta cyan" onClick={() => router.push(`/l/${preview.id}`)}><span>Take over a club</span></button>
                </>
              ) : (
                <div className="err">This season is over. Join next season.</div>
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
  const [f, setF] = useState({ name: '', pool: 'ENG', maxClubs: 16, aiLevel: 2, time: '18:00', divisions: 1, startDivision: 'bottom' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/leagues').then(setMeta).catch(() => {});
  }, []);
  const cap = meta?.caps[f.pool] ?? 30;
  const perDiv = Math.floor(cap / f.divisions);
  const sizes = (f.divisions > 1 ? [6, 8, 10, 12] : [10, 16, 20, 30]).filter((n) => n <= perDiv);
  const maxDiv = cap >= 36 ? 3 : cap >= 12 ? 2 : 1;
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('/api/leagues', { name: f.name, pool: f.pool, maxClubs: Math.min(f.maxClubs, perDiv), aiLevel: f.aiLevel, kickoffUtcMin: localToUtcMin(f.time), divisions: f.divisions, startDivision: f.startDivision });
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
          <span className="small muted">Divisions (promotion and relegation between them)</span>
          <div className="row wrap">
            {[1, 2, 3].filter((n) => n <= maxDiv).map((n) => <button key={n} className={`chip ${f.divisions === n ? 'on' : ''}`} onClick={() => setF((s) => ({ ...s, divisions: n, maxClubs: n > 1 ? Math.min(8, Math.floor(cap / n)) : 16 }))}><span>{n === 1 ? 'One league' : `${n} divisions`}</span></button>)}
            {f.divisions > 1 && <>
              <span className="tiny muted" style={{ marginLeft: 8 }}>Managers start in</span>
              {[['bottom', 'the bottom'], ['top', 'the top flight']].map(([k, l]) => <button key={k} className={`chip ${f.startDivision === k ? 'on' : ''}`} onClick={() => set('startDivision', k)}><span>{l}</span></button>)}
            </>}
          </div>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <span className="small muted">{f.divisions > 1 ? 'Clubs per division' : 'Clubs'} (empty places become AI clubs)</span>
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
        <label className="col" style={{ gap: 4 }}>
          <span className="small muted">Every day at (your time)</span>
          <input type="time" value={f.time} onChange={(e) => set('time', e.target.value || '18:00')} style={{ maxWidth: 170, fontSize: 20, fontWeight: 900 }} />
        </label>
        <div className="small muted" style={{ lineHeight: 1.5 }}>
          One match every day at <b style={{ color: '#F2C14E' }}>{f.time}</b>, for everyone, in their own time zone. Nobody can play a match early, not even you.
          <br />Home and away league, plus a knockout cup. The transfer market opens before matchday 1 and at the halfway break.
        </div>
        <button className="cta shine" onClick={go} disabled={busy || f.name.trim().length < 3} style={{ marginTop: 'auto' }}><span>Create league</span></button>
      </div>
    </div>
  );
}
