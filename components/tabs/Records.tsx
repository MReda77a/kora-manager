'use client';
// The lasting record: your head-to-head with each manager, and what happened in this league when each
// style met each other style. It is what was, never a forecast — it fills up as the league is played.
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { PRESETS } from '../../lib/game.ts';

export function useRecords(lid: number, stamp?: unknown) {
  const [r, setR] = useState<any>(null);
  useEffect(() => { api(`/api/leagues/${lid}/records`).then(setR).catch(() => {}); }, [lid, stamp]);
  return r;
}

const RES = { W: '#2EF2B0', D: '#F2C14E', L: '#FF7A6B' } as Record<string, string>;

/** one line under the next match: the record against this opponent, and the last few meetings */
export function H2HLine({ rec, oppId }: { rec: any; oppId: number }) {
  if (!rec) return null;
  const e = (rec.h2h || []).find((x: any) => x.clubId === oppId);
  if (!e) return <span className="h2h-line small"><b className="lz">HEAD TO HEAD</b><span className="muted">First meeting</span></span>;
  return (
    <span className="h2h-line small">
      <b className="lz">HEAD TO HEAD</b>
      <span>{`${e.w} won · ${e.d} drawn · ${e.l} lost`}</span>
      <span className="row" style={{ gap: 3 }}>{e.last.map((m: any, i: number) => <i key={i} className="h2h-chip" style={{ borderColor: RES[m.res], color: RES[m.res] }} title={m.theirs ? `They played ${m.theirs}` : undefined}>{m.score}</i>)}</span>
    </span>
  );
}

const SHORT: Record<string, string> = { 'Tiki-taka': 'TIK', Gegenpress: 'GEG', 'Counter attack': 'CNT', 'Wing play': 'WNG', 'Long ball': 'LNG', 'Shoot on sight': 'SHT' };

/** style against style in this league, and your own matches by style */
export function StyleBook({ rec, oppId, oppName }: { rec: any; oppId?: number; oppName?: string }) {
  if (!rec) return null;
  const names = Object.keys(PRESETS);
  const cell = (c?: { p: number; w: number; d: number; l: number }) => {
    if (!c || !c.p) return <span className="sb-cell empty">·</span>;
    const share = (c.w + c.d * 0.5) / c.p;
    const bg = share >= 0.6 ? 'rgba(46,242,176,0.22)' : share <= 0.4 ? 'rgba(255,122,107,0.2)' : 'rgba(255,255,255,0.07)';
    return <span className="sb-cell" style={{ background: bg }} title={`${c.p} played`}>{c.w}-{c.d}-{c.l}</span>;
  };
  const vs = oppId ? (rec.h2h || []).find((x: any) => x.clubId === oppId) : null;
  const mineRows = Object.entries(rec.mine || {}).flatMap(([a, row]: any) => Object.entries(row).map(([b, c]: any) => ({ a, b, ...c }))).sort((x: any, y: any) => y.p - x.p).slice(0, 6);
  return (
    <section className="panel cut col" style={{ gap: 10 }}>
      <div className="row between wrap" style={{ gap: 6 }}>
        <span className="tag"><span>The record book</span></span>
        <span className="tiny muted">{`${rec.matches} matches played in this league · won-drawn-lost for the style on the left`}</span>
      </div>
      {rec.matches < 6 && <span className="small muted">The book is nearly empty. Every match played in this league is written into it: which style met which, and who won.</span>}
      <div className="sb-wrap">
        <div className="sb-grid" style={{ gridTemplateColumns: `112px repeat(${names.length}, minmax(52px, 1fr))` }}>
          <span className="tiny muted" style={{ fontWeight: 900 }}>against ›</span>
          {names.map((n) => <span key={n} className="sb-h" title={n}>{SHORT[n] || n.slice(0, 3).toUpperCase()}</span>)}
          {names.map((a) => (
            <div key={a} style={{ display: 'contents' }}>
              <b className="small ellipsis">{a}</b>
              {names.map((b) => <div key={b} style={{ display: 'contents' }}>{cell(rec.styles?.[a]?.[b])}</div>)}
            </div>
          ))}
        </div>
      </div>
      {vs && vs.last.some((m: any) => m.theirs) && (
        <div className="col" style={{ gap: 4 }}>
          <span className="tiny muted" style={{ fontWeight: 900 }}>{`Your last meetings with ${oppName || vs.club}`}</span>
          {vs.last.filter((m: any) => m.theirs).map((m: any, i: number) => (
            <div key={i} className="row small" style={{ gap: 8, fontWeight: 700 }}>
              <i className="h2h-chip" style={{ borderColor: RES[m.res], color: RES[m.res] }}>{m.score}</i>
              <span>{`You played ${m.mine}, they played ${m.theirs}`}</span>
              {m.cup && <span className="tiny muted">Cup</span>}
            </div>
          ))}
        </div>
      )}
      {mineRows.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <span className="tiny muted" style={{ fontWeight: 900 }}>Your own matches by style</span>
          {mineRows.map((x: any, i: number) => (
            <div key={i} className="row small" style={{ gap: 8, fontWeight: 700 }}>
              <span className="grow ellipsis">{`${x.a} › ${x.b}`}</span>
              {cell(x)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
