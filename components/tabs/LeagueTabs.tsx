'use client';
import { CLUB_TYPES, type ClubTypeKey } from '../../lib/game.ts';
import { useEffect, useState } from 'react';
import { api, clock } from '../../lib/client.ts';
import { BackHead, Crest, Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

export function TableTab({ d: ov, lid }: TabProps) {
  const { club, league } = ov;
  const D = league.divisions || 1;
  const [div, setDiv] = useState<number>(ov.division || club.division || 1);
  const [table, setTable] = useState<any[]>(ov.table);
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
      <div className="panel cut" style={{ padding: 8 }}>
        <table className="t">
          <thead><tr><th>#</th><th>Club</th><th className="num">P</th><th className="num">W</th><th className="num">D</th><th className="num">L</th><th className="num">GD</th><th className="num">Pts</th><th>Form</th></tr></thead>
          <tbody>
            {table.map((t: any, i: number) => {
              const z = zone(i);
              return (
              <tr key={t.id} className={t.id === club.id ? 'me' : ''} style={{ boxShadow: z === 'up' ? 'inset 3px 0 0 #7CE3A1' : z === 'down' ? 'inset 3px 0 0 #FF6B7A' : i + 1 === club.targetPos && div === club.division ? 'inset 0 -2px 0 rgba(242,193,78,0.6)' : undefined }}>
                <td><b>{i + 1}</b></td>
                <td><span className="row" style={{ gap: 6 }}><Crest c1={t.color1} c2={t.color2} shape={t.shape} emblem={t.user_id ? t.emblem : -1} short={t.short} size={20} /><span className="ellipsis" style={{ maxWidth: 190 }}>{t.name}</span>{t.user_id ? <span className="tag cyan" style={{ height: 16, fontSize: 9 }}><span>MGR</span></span> : <span className="tiny dim hide-sm">{CLUB_TYPES[t.club_type as ClubTypeKey]?.name}</span>}</span></td>
                <td className="num">{t.p}</td><td className="num">{t.w}</td><td className="num">{t.d}</td><td className="num">{t.l}</td>
                <td className="num">{t.gf - t.ga > 0 ? '+' : ''}{t.gf - t.ga}</td><td className="num"><b>{t.pts}</b></td>
                <td><span className="row" style={{ gap: 2 }}>{t.form.map((f: string, k: number) => <i key={k} style={{ width: 15, height: 15, fontSize: 11, fontStyle: 'normal', fontWeight: 900, display: 'grid', placeItems: 'center', background: f === 'W' ? '#7CE3A1' : f === 'D' ? 'var(--muted)' : 'var(--red)', color: '#1B1048' }}>{f}</i>)}</span></td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {D > 1 && <div className="row tiny muted" style={{ gap: 14, padding: '8px 6px 2px' }}>
          {div > 1 && <span><i style={{ display: 'inline-block', width: 10, height: 10, background: '#7CE3A1', marginRight: 5 }} />Top {P} promoted</span>}
          {div < D && <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--red)', marginRight: 5 }} />Bottom {P} relegated</span>}
        </div>}
      </div>
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
        {rows.map((f) => {
          const derby = f.ht === 'fan' && f.at === 'fan' && f.hu && f.au;
          const me = f.home_id === myId || f.away_id === myId;
          return (
            <a key={f.id} href={`/m/${f.id}`} className="row small" style={{ color: 'inherit', padding: '7px 10px', gap: 8, background: derby ? 'rgba(242,193,78,0.16)' : f.comp === 'cup' ? 'rgba(47,230,176,0.12)' : me ? 'rgba(232,67,140,0.12)' : 'rgba(255,255,255,0.05)', fontWeight: 700 }}>
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
              <div key={r.player_id} className="row small" style={{ gap: 10, padding: '5px 10px', background: mine ? 'rgba(127,233,247,0.14)' : undefined, fontWeight: 800 }}>
                <span className="lz" style={{ width: 22, fontSize: 18, color: i === 0 ? '#F2C14E' : i === 2 ? '#EE7650' : 'var(--muted)' }}>{i + 1}</span>
                <span className="grow col" style={{ minWidth: 0, gap: 0 }}><span className="ellipsis">{r.name} {mine && <span className="tiny" style={{ color: '#7FE9F7' }}>YOURS</span>}</span><span className="tiny muted ellipsis" style={{ fontWeight: 700 }}>{r.club}</span></span>
                <span className="tiny ellipsis hide-sm" style={{ width: 130, color: 'var(--soft)' }}><i style={{ display: 'inline-block', width: 8, height: 8, background: r.color1, transform: 'rotate(45deg)', marginRight: 6 }} />{r.club}</span>
                <div className="hide-sm" style={{ width: 150 }}><div className="bar" style={{ height: 8 }}><i style={{ width: `${(val(r) / max) * 100}%`, background: i === 0 ? '#F2C14E' : mine ? '#E8438C' : '#7FE9F7' }} /></div></div>
                <span className="lz" style={{ width: 40, textAlign: 'right', fontSize: 20 }}>{val(r)}</span>
              </div>
            );
          })}
        </section>
        <aside className="col" style={{ gap: 10 }}>
          <div className="panel cut" style={{ alignItems: 'center', textAlign: 'center' }}>
            <svg width="44" height="54" viewBox="0 0 44 54" aria-hidden="true"><path d="M14 0h16l-4 18h-8z" fill="#E8438C" /><circle cx="22" cy="34" r="17" fill="#F2C14E" /><path d="M22 24l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#B5860A" /></svg>
            <span className="lz" style={{ fontSize: 20, color: '#F2C14E' }}>{title}</span>
            <span className="tiny muted">{top ? (mineTop && mineTop !== top ? `${mineTop.name} is ${(val(top) - val(mineTop)).toFixed(tab === 'rating' ? 2 : 0)} behind ${top.name}` : `${top.name} leads with ${val(top)}`) : 'Nobody yet'}</span>
          </div>
          <div className="panel cut" style={{ gap: 6 }}>
            <span className="kicker">How awards affect players</span>
            <div className="row-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}><b className="small" style={{ color: '#7CE3A1' }}>Team of the Week</b><span className="tiny">+2 rating for the next 2 days.</span></div>
            <div className="row-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}><b className="small" style={{ color: '#F2C14E' }}>Player of the Month</b><span className="tiny">Winner +3 for 4 days. Nominees who lose sulk: −2 for 2 days.</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
