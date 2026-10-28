'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { BackHead, Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

const KIND_ICON: Record<string, string> = { league: '🏆', division: '🥇', cup: '🏆', promotion: '⬆️', award: '⭐' };

// Club history: every finished season, the trophy cabinet, season awards and the league's legends.
export default function HistoryTab({ lid, d: ov }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { api(`/api/leagues/${lid}/history`).then((r) => { setD(r); setSel(r.seasons[0]?.season ?? null); }); }, [lid]);
  if (!d) return <Spinner />;
  const s = d.seasons.find((x: any) => x.season === sel);
  const mine = d.trophies.filter((t: any) => t.club_id === ov.club.id);
  const hall = Object.values(d.trophies.filter((t: any) => t.kind !== 'award').reduce((acc: any, t: any) => {
    const k = t.club_id;
    acc[k] ||= { club: t.club, color1: t.color1, n: 0, list: [] as string[], manager: t.username };
    acc[k].n++; acc[k].list.push(`${KIND_ICON[t.kind] || ''} S${t.season}`);
    return acc;
  }, {})).sort((a: any, b: any) => b.n - a.n) as any[];
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="History" sub={`Season ${ov.league.season}${d.seasons.length ? ` · ${d.seasons.length} finished` : ''}`}
        right={d.seasons.length > 1 ? <>{d.seasons.map((x: any) => <button key={x.season} className={`seg ${sel === x.season ? 'on' : ''}`} onClick={() => setSel(x.season)}><span>S{x.season}</span></button>)}</> : null} />
      {!d.seasons.length && <div className="panel cut small muted">History is written at the end of the first season: champions, promotions, the cup winner and the season awards all land here.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
        {s && (
          <section className="panel cut rise" style={{ gap: 6 }}>
            <span className="tag gold" style={{ alignSelf: 'flex-start' }}><span>Season {s.season}</span></span>
            {s.divisions.map((dv: any) => (
              <div key={dv.d} className="col" style={{ gap: 2 }}>
                <span className="kicker">{dv.name}</span>
                {dv.table.slice(0, 3).map((t: any) => (
                  <div key={t.id} className="row small" style={{ gap: 8, fontWeight: 800, color: t.id === ov.club.id ? '#5FD3F3' : undefined }}>
                    <span className="lz" style={{ width: 20, color: t.pos === 1 ? '#F2C14E' : 'var(--muted)' }}>{t.pos}</span>
                    <i style={{ width: 8, height: 8, background: t.color1, transform: 'rotate(45deg)' }} />
                    <span className="grow ellipsis">{t.name}</span><span>{t.pts} pts</span>
                  </div>
                ))}
                {(() => { const me = dv.table.find((t: any) => t.id === ov.club.id); return me && me.pos > 3 ? <div className="tiny" style={{ color: '#5FD3F3', fontWeight: 800 }}>You: {me.pos}th, {me.pts} pts</div> : null; })()}
              </div>
            ))}
            {s.cup?.winner && <div className="row small" style={{ gap: 8, fontWeight: 800 }}><span>🏆</span><span className="grow">{s.cup.name}</span><b style={{ color: '#2FE6B0' }}>{s.cup.winner}</b></div>}
          </section>
        )}
        {s && (
          <section className="panel cut rise" style={{ gap: 6, animationDelay: '.06s' }}>
            <span className="tag cyan" style={{ alignSelf: 'flex-start' }}><span>Season awards</span></span>
            {s.awards.map((a: any) => (
              <div key={a.title} className="row-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0, background: a.clubId === ov.club.id ? 'rgba(95, 211, 243,0.14)' : undefined }}>
                <span className="tiny" style={{ color: '#F2C14E', fontWeight: 900 }}>⭐ {a.title}</span>
                <b className="small">{a.name} <span className="muted" style={{ fontWeight: 700 }}>· {a.club}</span></b>
                <span className="tiny muted">{a.value}</span>
              </div>
            ))}
          </section>
        )}
        <section className="panel cut rise" style={{ gap: 6, animationDelay: '.1s' }}>
          <span className="tag" style={{ alignSelf: 'flex-start' }}><span>Your trophy cabinet</span></span>
          {!mine.length && <div className="small muted">Empty for now. Win a title, a cup or promotion to fill it.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6 }}>
            {mine.map((t: any) => (
              <div key={t.id} className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 2, padding: 8, background: 'rgba(242,193,78,0.12)' }}>
                <span style={{ fontSize: 26 }}>{KIND_ICON[t.kind] || '🏅'}</span>
                <span className="tiny" style={{ fontWeight: 800 }}>{t.label}</span>
                <span className="tiny muted">Season {t.season}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel cut rise" style={{ gap: 4, animationDelay: '.14s' }}>
          <span className="tag gold" style={{ alignSelf: 'flex-start' }}><span>Hall of fame</span></span>
          {!hall.length && <div className="small muted">No honours yet.</div>}
          {hall.slice(0, 8).map((h: any) => (
            <div key={h.club} className="row small" style={{ gap: 8, fontWeight: 800 }}>
              <i style={{ width: 8, height: 8, background: h.color1, transform: 'rotate(45deg)' }} />
              <span className="grow ellipsis">{h.club}{h.manager && <span className="tiny muted"> · {h.manager}</span>}</span>
              <span className="tiny" style={{ color: '#F2C14E' }}>{h.list.join(' ')}</span>
            </div>
          ))}
          <span className="kicker" style={{ marginTop: 8 }}>Legends</span>
          {!d.legends.length && <div className="tiny muted">Club records count from the end of season 1.</div>}
          {d.legends.slice(0, 8).map((x: any) => (
            <div key={x.player_id + x.club_id} className="row small" style={{ gap: 8, fontWeight: 700 }}>
              <span className="grow ellipsis">{x.name} <span className="tiny muted">{x.pos} · {x.club}</span>{x.retired && <span className="tiny" style={{ color: '#F2C14E' }}> · retired</span>}</span>
              <span className="tiny">{x.apps} apps · {x.goals} g · {x.assists} a</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
