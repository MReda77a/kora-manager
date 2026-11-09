'use client';
import { CLUB_TYPES, type ClubTypeKey } from '../../lib/game.ts';
import { useEffect, useState } from 'react';
import { api, clock } from '../../lib/client.ts';
import { BackHead, Crest, Spinner } from '../ui.tsx';
import { ClubSheet } from '../ClubSheet.tsx';
import type { TabProps } from './types.ts';

export function TableTab({ d: ov, lid }: TabProps) {
  const { club, league } = ov;
  const D = league.divisions || 1;
  const [div, setDiv] = useState<number>(ov.division || club.division || 1);
  const [table, setTable] = useState<any[]>(ov.table);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (div === ov.division) { setTable(ov.table); return; }
    api(`/api/leagues/${lid}/overview?div=${div}`).then((r) => setTable(r.table));
  }, [div, lid, ov.division, ov.table]);
  const n = table.length, P = league.movers || 1;
  const zone = (i: number) => (div > 1 && i < P ? 'up' : div < D && i >= n - P ? 'down' : null);
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title={D > 1 ? league.divisionNames[div - 1] : 'League Table'} sub={`${league.poolName} · Season ${league.season}${div === club.division ? ` · target top ${club.targetPos}` : ''}`}
        right={D > 1 ? <>{league.divisionNames.map((nm: string, i: number) => <button key={i} className={`seg ${div === i + 1 ? 'on' : ''}`} onClick={() => setDiv(i + 1)}><span>{nm.replace(' Division', '')}</span></button>)}</> : null} />
      <div className="tbl2">
      <div className="panel cut" style={{ padding: 8 }}>
        <table className="t">
          <thead><tr><th>#</th><th>Club</th><th className="num">P</th><th className="num">W</th><th className="num">D</th><th className="num">L</th><th className="num">GD</th><th className="num">Pts</th><th>Form</th></tr></thead>
          <tbody>
            {table.map((t: any, i: number) => {
              const z = zone(i);
              return (
              <tr key={t.id} className={`clickrow ${t.id === club.id ? 'me' : ''}`} onClick={() => setOpen(t.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(t.id); }} title={`See ${t.name}'s squad`} style={{ boxShadow: z === 'up' ? 'inset 3px 0 0 #2EE6A0' : z === 'down' ? 'inset 3px 0 0 #FF6B7A' : i + 1 === club.targetPos && div === club.division ? 'inset 0 -2px 0 rgba(242,193,78,0.6)' : undefined }}>
                <td><b>{i + 1}</b></td>
                <td><span className="row" style={{ gap: 6 }}><Crest c1={t.color1} c2={t.color2} shape={t.shape} emblem={t.user_id ? t.emblem : -1} short={t.short} size={20} /><span className="ellipsis" style={{ maxWidth: 190 }}>{t.name}</span>{t.user_id ? <span className="tag cyan" style={{ height: 16, fontSize: 9 }}><span>MGR</span></span> : <span className="tiny dim hide-sm">{CLUB_TYPES[t.club_type as ClubTypeKey]?.name}</span>}</span></td>
                <td className="num">{t.p}</td><td className="num">{t.w}</td><td className="num">{t.d}</td><td className="num">{t.l}</td>
                <td className="num">{t.gf - t.ga > 0 ? '+' : ''}{t.gf - t.ga}</td><td className="num"><b>{t.pts}</b></td>
                <td><span className="row" style={{ gap: 2 }}>{t.form.map((f: string, k: number) => <i key={k} style={{ width: 15, height: 15, fontSize: 11, fontStyle: 'normal', fontWeight: 900, display: 'grid', placeItems: 'center', background: f === 'W' ? '#2EE6A0' : f === 'D' ? 'var(--muted)' : 'var(--red)', color: '#06121F' }}>{f}</i>)}</span></td>
              </tr>
              );
            })}
          </tbody>
        </table>
        <div className="tiny muted" style={{ padding: '6px 6px 0' }}>Tap a club to see its squad.</div>
        {D > 1 && <div className="row tiny muted" style={{ gap: 14, padding: '8px 6px 2px' }}>
          {div > 1 && <span><i style={{ display: 'inline-block', width: 10, height: 10, background: '#2EE6A0', marginRight: 5 }} />Top {P} promoted</span>}
          {div < D && <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--red)', marginRight: 5 }} />Bottom {P} relegated</span>}
        </div>}
      </div>
      <TableSide lid={lid} table={table} />
      </div>
      {open !== null && <ClubSheet lid={lid} clubId={open} myId={club.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

// beside the table on wide screens: the scorers, the providers, who is hot and who is not, the best performer
function TableSide({ lid, table }: { lid: number; table: any[] }) {
  const [st, setSt] = useState<any>(null);
  useEffect(() => { api(`/api/leagues/${lid}/stats`).then(setSt).catch(() => {}); }, [lid]);
  const runOf = (form: string[], ok: (x: string) => boolean) => { let n = 0; for (let i = form.length - 1; i >= 0 && ok(form[i]); i--) n++; return n; };
  const withRuns = table.map((t) => ({ t, hot: runOf(t.form || [], (x) => x !== 'L'), cold: runOf(t.form || [], (x) => x !== 'W') }));
  const hot = withRuns.slice().sort((a, b) => b.hot - a.hot)[0], cold = withRuns.slice().sort((a, b) => b.cold - a.cold)[0];
  const lead = (title: string, rows: any[] | undefined, val: (r: any) => number, col: string) => (
    <div className="col" style={{ gap: 0 }}>
      <span className="lz" style={{ fontSize: 15, fontWeight: 600, letterSpacing: 1, color: col }}>{title}</span>
      {!rows?.length && <span className="tiny muted">No data yet.</span>}
      {(rows || []).slice(0, 3).map((r, k) => (
        <div key={r.player_id} className="row" style={{ gap: 10, padding: '5px 0' }}>
          <b className="tiny muted" style={{ width: 14 }}>{k + 1}</b>
          <span className="col grow" style={{ gap: 0, lineHeight: 1.2, minWidth: 0 }}><b className="small ellipsis">{r.name}</b><span className="tiny muted ellipsis">{r.club}</span></span>
          <b className="lz" style={{ fontSize: 20, color: k === 0 ? col : undefined }}>{val(r)}</b>
        </div>
      ))}
    </div>
  );
  const best = st?.rating?.[0];
  return (
    <div className="tbl2-side">
      <section className="panel cut" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
        {lead('GOALS', st?.goals, (r) => r.goals, 'var(--mint)')}
        {lead('ASSISTS', st?.assists, (r) => r.assists, '#7CCBFF')}
      </section>
      {(hot?.hot >= 2 || cold?.cold >= 2) && (
        <section className="panel cut" style={{ gap: 10 }}>
          <span className="lz" style={{ fontSize: 16, fontWeight: 600, letterSpacing: 1 }}>HOT &amp; COLD</span>
          {hot?.hot >= 2 && <div className="row hc hot"><Crest c1={hot.t.color1} c2={hot.t.color2} shape={hot.t.shape} emblem={hot.t.user_id ? hot.t.emblem : -1} short={hot.t.short} size={28} /><span className="col grow" style={{ gap: 0, lineHeight: 1.25 }}><b className="small">{hot.t.name}</b><span className="tiny muted">Unbeaten in {hot.hot}</span></span><b className="lz" style={{ fontSize: 28, color: 'var(--mint)' }}>{hot.hot}</b></div>}
          {cold?.cold >= 2 && <div className="row hc cold"><Crest c1={cold.t.color1} c2={cold.t.color2} shape={cold.t.shape} emblem={cold.t.user_id ? cold.t.emblem : -1} short={cold.t.short} size={28} /><span className="col grow" style={{ gap: 0, lineHeight: 1.25 }}><b className="small">{cold.t.name}</b><span className="tiny muted">No win in {cold.cold}</span></span><b className="lz" style={{ fontSize: 28, color: '#FF8796' }}>{cold.cold}</b></div>}
        </section>
      )}
      {best && (
        <section className="tbl2-best">
          <span className="lz" style={{ fontSize: 16, fontWeight: 600, letterSpacing: 1, color: '#FFD36B' }}>BEST PERFORMER</span>
          <div className="row" style={{ gap: 14 }}>
            <div className="tbl2-badge"><span className="lz" style={{ fontSize: 30, lineHeight: 1 }}>{(Number(best.rating_sum) / best.apps).toFixed(1)}</span><span className="tiny" style={{ fontWeight: 800 }}>RATING</span></div>
            <div className="col" style={{ gap: 2, minWidth: 0 }}><b style={{ fontSize: 18 }} className="ellipsis">{best.name}</b><span className="small muted">{best.club}</span><span className="small muted">{best.apps} matches</span></div>
          </div>
        </section>
      )}
    </div>
  );
}

export function FixturesTab({ lid, d: ov }: TabProps) {
  const [fx, setFx] = useState<any[] | null>(null);
  const [mine, setMine] = useState(true);
  const [day, setDay] = useState<number | null>(null);
  const D = ov.league.divisions || 1;
  const [div, setDiv] = useState<number>(ov.club.division || 1);
  useEffect(() => { api(`/api/leagues/${lid}/fixtures`).then((r) => { setFx(r); const n = r.find((f: any) => f.status !== 'done'); setDay(n ? n.day : r.length ? r[r.length - 1].day : 1); }); }, [lid]);
  if (!fx) return <Spinner />;
  const myId = ov.club.id;
  const days = [...new Set(fx.map((f) => f.day))].sort((a, b) => a - b);
  const rows = mine ? fx.filter((f) => f.home_id === myId || f.away_id === myId) : fx.filter((f) => f.day === day && (f.comp === 'cup' || D === 1 || f.division === div));
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Fixtures" right={<>
        <button className={`seg ${mine ? 'on' : ''}`} onClick={() => setMine(true)}><span>My matches</span></button>
        <button className={`seg ${!mine ? 'on' : ''}`} onClick={() => setMine(false)}><span>By day</span></button>
        {!mine && D > 1 && <select value={div} onChange={(e) => setDiv(Number(e.target.value))} style={{ width: 120, height: 32 }}>{ov.league.divisionNames.map((nm: string, i: number) => <option key={i} value={i + 1}>{nm}</option>)}</select>}
        {!mine && <select value={day ?? 1} onChange={(e) => setDay(Number(e.target.value))} style={{ width: 150, height: 32 }}>{days.map((x) => { const f = fx.find((y) => y.day === x); return <option key={x} value={x}>{f.comp === 'cup' ? `Day ${x} · Cup` : `Matchday ${f.matchday}`}</option>; })}</select>}
      </>} />
      {!fx.length && <div className="panel cut muted">Fixtures appear when the season starts.</div>}
      <div className="col" style={{ gap: 4 }}>
        {mine && (() => { const nextId = rows.find((x) => x.status !== 'done')?.id; return rows.map((f) => {
          const derby = f.ht === 'fan' && f.at === 'fan' && f.hu && f.au;
          const home = f.home_id === myId, done = f.status === 'done', isNext = f.id === nextId;
          const my = home ? [f.home_goals, f.away_goals] : [f.away_goals, f.home_goals];
          const r = !done ? '' : f.winner_id ? (f.winner_id === myId ? 'W' : 'L') : my[0] > my[1] ? 'W' : my[0] < my[1] ? 'L' : 'D';
          return (
            <a key={f.id} href={`/m/${f.id}`} className={`fx2 ${isNext ? 'next' : ''}`}>
              <span className="lz fx2-md">{f.comp === 'cup' ? 'CUP' : `MD ${f.matchday}`}</span>
              <span className="fx2-date">{new Date(f.kickoff_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              {home ? <Crest c1={f.ac} c2={f.ac2} shape={f.ash} emblem={f.au ? f.aem : -1} short={f.as_} size={30} /> : <Crest c1={f.hc} c2={f.hc2} shape={f.hsh} emblem={f.hu ? f.hem : -1} short={f.hs} size={30} />}
              <span className="grow ellipsis" style={{ fontWeight: 800, fontSize: 15 }}>{home ? f.away : f.home} <span className="small muted" style={{ fontWeight: 700 }}>· {home ? 'Home' : 'Away'}</span></span>
              {derby ? <span className="pill" style={{ background: 'rgba(255,196,77,0.16)', color: '#FFD27A' }}>Derby</span> : <span className="pill" style={f.comp === 'cup' ? { background: 'rgba(255,196,77,0.16)', color: '#FFD27A' } : { background: 'rgba(56,180,255,0.16)', color: '#7CCBFF' }}>{f.comp === 'cup' ? 'Cup' : 'League'}</span>}
              {done ? <><b className="lz fx2-score">{f.home_goals} – {f.away_goals}</b><span className={`h2-res ${r}`}>{r}</span></>
                : f.status === 'live' ? <span className="cta small"><span>WATCH LIVE ›</span></span>
                : isNext ? <span className="cta small"><span>PREPARE ›</span></span> : <span className="pill">Upcoming</span>}
            </a>
          );
        }); })()}
        {!mine && rows.map((f) => {
          const derby = f.ht === 'fan' && f.at === 'fan' && f.hu && f.au;
          const me = f.home_id === myId || f.away_id === myId;
          return (
            <a key={f.id} href={`/m/${f.id}`} className="row small" style={{ color: 'inherit', padding: '7px 10px', gap: 8, background: derby ? 'rgba(242,193,78,0.16)' : f.comp === 'cup' ? 'rgba(47,230,176,0.12)' : me ? 'rgba(46, 230, 160,0.12)' : 'rgba(255,255,255,0.05)', fontWeight: 700 }}>
              <span className="tiny" style={{ width: 54, color: f.comp === 'cup' ? '#2FE6B0' : derby ? '#F2C14E' : 'var(--dim)', fontWeight: 900 }}>{f.comp === 'cup' ? 'CUP' : derby ? 'DERBY' : `MD ${f.matchday}`}</span>
              <span className="grow ellipsis" style={{ textAlign: 'right', fontWeight: 800 }}>{f.home}</span>
              <Crest c1={f.hc} c2={f.hc2} shape={f.hsh} emblem={f.hu ? f.hem : -1} short={f.hs} size={20} />
              <b className="lz" style={{ width: 64, textAlign: 'center', fontSize: 17, color: f.status === 'live' ? 'var(--red)' : undefined }}>{f.status === 'done' ? `${f.home_goals} – ${f.away_goals}` : f.status === 'live' ? 'LIVE' : 'vs'}</b>
              <Crest c1={f.ac} c2={f.ac2} shape={f.ash} emblem={f.au ? f.aem : -1} short={f.as_} size={20} />
              <span className="grow ellipsis" style={{ fontWeight: 800 }}>{f.away}</span>
              <span className="tiny dim" style={{ width: 100, textAlign: 'right' }}>{f.status === 'done' ? 'Report ›' : f.status === 'live' ? 'Watch ›' : clock(f.kickoff_at)}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function LeadersTab({ lid, d: ov }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<'goals' | 'assists' | 'cleanSheets' | 'rating'>('goals');
  useEffect(() => { api(`/api/leagues/${lid}/stats`).then(setD); }, [lid]);
  if (!d) return <Spinner />;
  const rows = d[tab] as any[];
  const val = (r: any) => (tab === 'goals' ? r.goals : tab === 'assists' ? r.assists : tab === 'cleanSheets' ? r.clean_sheets : Number((Number(r.rating_sum) / r.apps).toFixed(2)));
  const max = rows.length ? Math.max(...rows.map(val)) : 1;
  const top = rows[0], mineTop = rows.find((r) => r.club_id === ov.club.id);
  const title = { goals: 'Golden Boot race', assists: 'Playmaker race', cleanSheets: 'Golden Glove race', rating: 'Best performer' }[tab];
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Stats Leaders" sub={`After ${ov.matchdays.played} rounds`} right={<>{([['goals', 'Goals'], ['assists', 'Assists'], ['cleanSheets', 'Clean sheets'], ['rating', 'Ratings']] as const).map(([k, l]) => <button key={k} className={`seg ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><span>{l}</span></button>)}</>} />
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(210px, 240px)', gap: 12 }}>
        <section className="panel cut" style={{ padding: 8, gap: 2 }}>
          {rows.length === 0 && <div className="small muted" style={{ padding: 10 }}>No data yet. Play some matches.</div>}
          {rows.map((r, i) => {
            const mine = r.club_id === ov.club.id;
            return (
              <div key={r.player_id} className="row small" style={{ gap: 10, padding: '5px 10px', background: mine ? 'color-mix(in srgb, var(--cyan) 14%, transparent)' : undefined, fontWeight: 800 }}>
                <span className="lz" style={{ width: 22, fontSize: 18, color: i === 0 ? '#F2C14E' : i === 2 ? '#EE7650' : 'var(--muted)' }}>{i + 1}</span>
                <span className="grow col" style={{ minWidth: 0, gap: 0 }}><span className="ellipsis">{r.name} {mine && <span className="tiny" style={{ color: 'var(--cyan)' }}>YOURS</span>}</span><span className="tiny muted ellipsis" style={{ fontWeight: 700 }}>{r.club}</span></span>
                <span className="tiny ellipsis hide-sm" style={{ width: 130, color: 'var(--soft)' }}><i style={{ display: 'inline-block', width: 8, height: 8, background: r.color1, transform: 'rotate(45deg)', marginRight: 6 }} />{r.club}</span>
                <div className="hide-sm" style={{ width: 150 }}><div className="bar" style={{ height: 8 }}><i style={{ width: `${(val(r) / max) * 100}%`, background: i === 0 ? '#F2C14E' : mine ? '#2EE6A0' : 'var(--cyan)' }} /></div></div>
                <span className="lz" style={{ width: 40, textAlign: 'right', fontSize: 20 }}>{val(r)}</span>
              </div>
            );
          })}
        </section>
        <aside className="col" style={{ gap: 10 }}>
          <div className="panel cut" style={{ alignItems: 'center', textAlign: 'center' }}>
            <svg width="44" height="54" viewBox="0 0 44 54" aria-hidden="true"><path d="M14 0h16l-4 18h-8z" fill="#2EE6A0" /><circle cx="22" cy="34" r="17" fill="#F2C14E" /><path d="M22 24l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#B5860A" /></svg>
            <span className="lz" style={{ fontSize: 20, color: '#F2C14E' }}>{title}</span>
            <span className="tiny muted">{top ? (mineTop && mineTop !== top ? `${mineTop.name} is ${(val(top) - val(mineTop)).toFixed(tab === 'rating' ? 2 : 0)} behind ${top.name}` : `${top.name} leads with ${val(top)}`) : 'Nobody yet'}</span>
          </div>
          <div className="panel cut" style={{ gap: 6 }}>
            <span className="kicker">How awards affect players</span>
            <div className="row-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}><b className="small" style={{ color: '#2EE6A0' }}>Team of the Week</b><span className="tiny">+2 rating for the next 2 days.</span></div>
            <div className="row-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}><b className="small" style={{ color: '#F2C14E' }}>Player of the Month</b><span className="tiny">Winner +3 for 4 days. Nominees who lose sulk: −2 for 2 days.</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Team streaks: each club's runs in the league this season (in the manager's division)
type Run = { id: number; name: string; short: string; c1: string; c2: string; res: { r: 'W' | 'D' | 'L'; gf: number; ga: number }[] };
const runOf = (res: Run['res'], ok: (x: Run['res'][number]) => boolean) => {
  let best = 0, cur = 0;
  for (const x of res) { cur = ok(x) ? cur + 1 : 0; best = Math.max(best, cur); }
  return { best, now: cur };
};
export function StreaksTab({ lid, d: ov }: TabProps) {
  const [fx, setFx] = useState<any[] | null>(null);
  useEffect(() => { api(`/api/leagues/${lid}/fixtures`).then(setFx); }, [lid]);
  if (!fx) return <Spinner />;
  const myDiv = ov.club.division;
  const clubs = new Map<number, Run>();
  const add = (id: number, name: string, short: string, c1: string, c2: string) => { if (!clubs.has(id)) clubs.set(id, { id, name, short, c1, c2, res: [] }); return clubs.get(id)!; };
  for (const f of fx) {
    if (f.comp !== 'league' || (f.division ?? 1) !== myDiv) continue;
    const h = add(f.home_id, f.home, f.hs, f.hc, f.hc2), a = add(f.away_id, f.away, f.as_, f.ac, f.ac2);
    if (f.status !== 'done') continue;
    const hg = Number(f.home_goals), ag = Number(f.away_goals);
    h.res.push({ r: hg > ag ? 'W' : hg < ag ? 'L' : 'D', gf: hg, ga: ag });
    a.res.push({ r: ag > hg ? 'W' : ag < hg ? 'L' : 'D', gf: ag, ga: hg });
  }
  const rows = [...clubs.values()].map((c) => {
    const win = runOf(c.res, (x) => x.r === 'W'), unb = runOf(c.res, (x) => x.r !== 'L'), winless = runOf(c.res, (x) => x.r !== 'W');
    const cs = runOf(c.res, (x) => x.ga === 0), scored = runOf(c.res, (x) => x.gf > 0);
    const now = win.now >= 2 ? { t: `Won ${win.now} in a row`, good: true, n: win.now + 10 } : unb.now >= 3 ? { t: `Unbeaten in ${unb.now}`, good: true, n: unb.now }
      : winless.now >= 3 ? { t: `No win in ${winless.now}`, good: false, n: -winless.now } : c.res.length ? { t: c.res[c.res.length - 1].r === 'W' ? 'Won the last one' : c.res[c.res.length - 1].r === 'D' ? 'Drew the last one' : 'Lost the last one', good: null, n: 0 } : { t: '-', good: null, n: 0 };
    return { ...c, win, unb, winless, cs, scored, now };
  });
  const top = (k: 'win' | 'unb' | 'winless' | 'cs' | 'scored', cur = false) => rows.slice().sort((a, b) => (cur ? b[k].now - a[k].now : b[k].best - a[k].best))[0];
  const cards: { label: string; r: any; n: number; col: string }[] = [
    { label: 'Longest winning run', r: top('win'), n: top('win')?.win.best ?? 0, col: '#2EE6A0' },
    { label: 'Longest unbeaten run', r: top('unb'), n: top('unb')?.unb.best ?? 0, col: '#5FD3F3' },
    { label: 'Clean sheets in a row', r: top('cs'), n: top('cs')?.cs.best ?? 0, col: '#F2C14E' },
    { label: 'Longest without a win', r: top('winless'), n: top('winless')?.winless.best ?? 0, col: '#FF6B7A' },
  ];
  const played = rows.some((r) => r.res.length);
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Team streaks" sub={`League · after ${ov.matchdays.played} rounds`} />
      {!played ? <div className="panel cut muted">No matches yet. Streaks start after the first round.</div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {cards.map((c) => (
              <div key={c.label} className="panel cut" style={{ gap: 4, padding: 10, boxShadow: `inset 0 3px 0 ${c.col}` }}>
                <span className="tiny muted" style={{ fontWeight: 800 }}>{c.label}</span>
                {c.r && c.n > 0 ? (
                  <span className="row" style={{ gap: 8 }}><Crest c1={c.r.c1} c2={c.r.c2} short={c.r.short} size={24} /><span className="grow ellipsis small" style={{ fontWeight: 800 }}>{c.r.name}</span><span className="lz" style={{ fontSize: 26, color: c.col }}>{c.n}</span></span>
                ) : <span className="small muted">Nobody yet</span>}
              </div>
            ))}
          </div>
          <div className="panel cut" style={{ padding: 6, overflowX: 'auto' }}>
            <table className="t">
              <thead><tr><th>Club</th><th>Now</th><th className="num" title="Best winning run">Wins</th><th className="num" title="Best unbeaten run">Unbeaten</th><th className="num hide-xs" title="Best run of clean sheets">Clean</th><th className="num hide-xs" title="Scored in this many in a row (now)">Scoring</th></tr></thead>
              <tbody>
                {rows.slice().sort((a, b) => b.now.n - a.now.n || b.unb.now - a.unb.now).map((r) => (
                  <tr key={r.id} className={r.id === ov.club.id ? 'me' : ''}>
                    <td><span className="row" style={{ gap: 6 }}><Crest c1={r.c1} c2={r.c2} short={r.short} size={20} /><span className="ellipsis" style={{ maxWidth: 150 }}>{r.name}</span></span></td>
                    <td><span className="small" style={{ fontWeight: 800, color: r.now.good === true ? '#2EE6A0' : r.now.good === false ? 'var(--red)' : 'var(--soft)' }}>{r.now.t}</span></td>
                    <td className="num">{r.win.best}</td><td className="num">{r.unb.best}</td><td className="num hide-xs">{r.cs.best}</td><td className="num hide-xs">{r.scored.now}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tiny muted" style={{ padding: '0 6px' }}>Wins, Unbeaten and Clean: the best run this season. Scoring: matches in a row with a goal, right now.</div>
        </>
      )}
    </div>
  );
}
