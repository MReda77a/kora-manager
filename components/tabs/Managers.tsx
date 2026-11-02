'use client';
// Every manager in the league: most goals scored first, with their club, place and when they last played.
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { BackHead, Crest, Spinner } from '../ui.tsx';
import { ClubSheet } from '../ClubSheet.tsx';
import type { TabProps } from './types.ts';

const ago = (iso: string | null, now: number) => {
  if (!iso) return { text: 'Never', tone: 'off' };
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 5) return { text: 'Online now', tone: 'on' };
  if (m < 60) return { text: `${m} min ago`, tone: 'on' };
  const h = Math.round(m / 60);
  if (h < 24) return { text: `${h}h ago`, tone: h < 12 ? 'on' : 'mid' };
  const d = Math.round(h / 24);
  return { text: d === 1 ? 'Yesterday' : `${d} days ago`, tone: d <= 2 ? 'mid' : 'off' };
};
const ord = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;

export default function ManagersTab({ lid, d }: TabProps) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { api(`/api/leagues/${lid}/managers`).then(setRows); }, [lid]);
  if (!rows) return <Spinner />;
  const now = Date.now();
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Managers" sub={<span className="small muted">{rows.length} managers · ranked by the board's target</span>} />
      <div className="panel cut" style={{ padding: 6, gap: 2, overflowX: 'auto' }}>
        <div className="mgr-row mgr-head tiny muted">
          <span>#</span><span>Manager</span><span>Board target</span><span className="num">Board</span><span className="num">Goals</span><span>Form</span><span>Last check-in</span>
        </div>
        {rows.map((r, i) => {
          const seen = ago(r.lastSeen, now), me = r.clubId === d.club.id;
          return (
            <button key={r.clubId} className={`mgr-row ${me ? 'me' : ''}`} onClick={() => setOpen(r.clubId)}>
              <b className="lz" style={{ fontSize: 20, color: i === 0 ? '#F4C24E' : undefined }}>{i + 1}</b>
              <span className="row" style={{ gap: 8, minWidth: 0 }}>
                <Crest c1={r.color1} c2={r.color2} shape={r.shape} emblem={r.emblem} short={r.short} size={26} />
                <span className="col" style={{ gap: 0, minWidth: 0, alignItems: 'flex-start' }}>
                  <b className="ellipsis">{r.manager}{me ? ' (you)' : ''}</b>
                  <span className="tiny muted ellipsis">{r.club}</span>
                </span>
              </span>
              <span className="col" style={{ gap: 1, alignItems: 'flex-start' }}>
                <span className={`status ${r.status === 'ON TRACK' ? 'ok' : r.status === 'BEHIND' ? 'bad' : 'risk'}`}>{r.status}</span>
                <span className="tiny muted">{r.p ? ord(r.pos) : '–'} · target top {r.target}{d.league.divisions > 1 ? ` · D${r.division}` : ''}</span>
              </span>
              <b className="num lz" style={{ fontSize: 20, color: r.board >= 60 ? 'var(--mint)' : r.board >= 45 ? '#F2C14E' : '#FF8A80' }}>{r.board}</b>
              <span className="num">{r.gf}<small className="muted">–{r.ga}</small></span>
              <span className="row" style={{ gap: 2 }}>{(r.form || []).slice(-5).map((f: string, k: number) => <i key={k} className={`mgr-f ${f}`}>{f}</i>)}</span>
              <span className={`mgr-seen ${seen.tone}`}><i />{seen.text}</span>
            </button>
          );
        })}
      </div>
      {open !== null && <ClubSheet lid={lid} clubId={open} myId={d.club.id} onClose={() => setOpen(null)} />}
    </div>
  );
}
