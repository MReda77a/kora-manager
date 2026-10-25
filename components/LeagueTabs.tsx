'use client';
import { useEffect, useState } from 'react';
import { api, clock } from '../lib/client.ts';
import { Spinner } from './ui.tsx';

export function TableTab({ table, myId, targetPos }: { table: any[]; myId: number; targetPos: number }) {
  return (
    <div className="glass cut pad">
      <table className="t">
        <thead>
          <tr><th>#</th><th>Club</th><th className="num">P</th><th className="num">W</th><th className="num">D</th><th className="num">L</th><th className="num">GD</th><th className="num">Pts</th><th>Form</th></tr>
        </thead>
        <tbody>
          {table.map((t, i) => (
            <tr key={t.id} className={t.id === myId ? 'me' : ''} style={{ borderLeft: i + 1 === targetPos ? undefined : undefined }}>
              <td><b>{i + 1}</b></td>
              <td><span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, background: t.color1, display: 'inline-block' }} /><span className="ellipsis" style={{ maxWidth: 170 }}>{t.name}</span>{t.user_id && <span className="tag cyan" style={{ height: 16, fontSize: 9 }}><span>MGR</span></span>}</span></td>
              <td className="num">{t.p}</td><td className="num">{t.w}</td><td className="num">{t.d}</td><td className="num">{t.l}</td>
              <td className="num">{t.gf - t.ga > 0 ? '+' : ''}{t.gf - t.ga}</td><td className="num"><b>{t.pts}</b></td>
              <td><span className="row" style={{ gap: 2 }}>{t.form.map((f: string, k: number) => <i key={k} style={{ width: 14, height: 14, fontSize: 9, fontStyle: 'normal', fontWeight: 900, display: 'grid', placeItems: 'center', background: f === 'W' ? '#7CE3A1' : f === 'D' ? '#B4A8E0' : '#FF6B7A', color: '#1B1048' }}>{f}</i>)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FixturesTab({ lid, myId }: { lid: number; myId: number }) {
  const [fx, setFx] = useState<any[] | null>(null);
  const [mine, setMine] = useState(true);
  const [md, setMd] = useState<number | null>(null);
  useEffect(() => { api(`/api/leagues/${lid}/fixtures`).then((r) => { setFx(r); const n = r.find((f: any) => f.status !== 'done'); setMd(n ? n.matchday : r.length ? r[r.length - 1].matchday : 1); }); }, [lid]);
  if (!fx) return <Spinner />;
  if (!fx.length) return <div className="glass cut pad muted">Fixtures appear when the season starts.</div>;
  const total = fx[fx.length - 1].matchday;
  const rows = mine ? fx.filter((f) => f.home_id === myId || f.away_id === myId) : fx.filter((f) => f.matchday === md);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap">
        <button className={`chip ${mine ? 'on' : ''}`} onClick={() => setMine(true)}><span>My matches</span></button>
        <button className={`chip ${!mine ? 'on' : ''}`} onClick={() => setMine(false)}><span>By matchday</span></button>
        {!mine && (
          <select value={md ?? 1} onChange={(e) => setMd(Number(e.target.value))} style={{ width: 150, height: 32 }}>
            {Array.from({ length: total }, (_, i) => <option key={i} value={i + 1}>Matchday {i + 1}</option>)}
          </select>
        )}
      </div>
      <div className="col" style={{ gap: 4 }}>
        {rows.map((f) => (
          <a key={f.id} href={`/m/${f.id}`} className="glass row small" style={{ color: 'inherit', padding: '6px 10px', gap: 8, background: f.home_id === myId || f.away_id === myId ? 'rgba(232,67,140,0.12)' : undefined }}>
            <span className="tiny dim" style={{ width: 42 }}>MD {f.matchday}</span>
            <span className="grow ellipsis" style={{ textAlign: 'right', fontWeight: 800 }}>{f.home}</span>
            <b className="lz" style={{ width: 64, textAlign: 'center', fontSize: 17 }}>{f.status === 'done' ? `${f.home_goals} – ${f.away_goals}` : 'vs'}</b>
            <span className="grow ellipsis" style={{ fontWeight: 800 }}>{f.away}</span>
            <span className="tiny dim" style={{ width: 92, textAlign: 'right' }}>{f.status === 'done' ? 'Report ›' : clock(f.kickoff_at)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function StatsTab({ lid }: { lid: number }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api(`/api/leagues/${lid}/stats`).then(setD); }, [lid]);
  if (!d) return <Spinner />;
  const box = (title: string, rows: any[], val: (r: any) => string, color: string) => (
    <div className="glass cut pad col" style={{ gap: 4 }}>
      <span className="tag" style={{ background: color, color: '#1B1048' }}><span>{title}</span></span>
      {rows.length === 0 && <span className="small muted">No data yet.</span>}
      {rows.map((r, i) => (
        <div key={r.player_id} className="row small" style={{ height: 26 }}>
          <b style={{ width: 18, color: i === 0 ? color : undefined }}>{i + 1}</b>
          <span className="grow ellipsis"><b>{r.name}</b> <span className="tiny dim">{r.club}</span></span>
          <b className="lz" style={{ fontSize: 17 }}>{val(r)}</b>
        </div>
      ))}
    </div>
  );
  return (
    <div className="grid2">
      {box('Top scorers', d.goals, (r) => r.goals, '#E8438C')}
      {box('Assists', d.assists, (r) => r.assists, '#7FE9F7')}
      {box('Clean sheets', d.cleanSheets, (r) => r.clean_sheets, '#7CE3A1')}
      {box('Best average rating', d.rating, (r) => (Number(r.rating_sum) / r.apps).toFixed(2), '#F2C14E')}
    </div>
  );
}
