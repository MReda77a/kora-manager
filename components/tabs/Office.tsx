'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { BackHead, COLORS, Kit, Ring, Spinner } from '../ui.tsx';
import { PATTERNS } from '../../lib/game.ts';
import type { TabProps } from './types.ts';

export default function OfficeTab({ lid, d: ov, toast, reload }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const load = () => api(`/api/leagues/${lid}/office`).then((r) => { setD(r); setName(r.club.stadium); });
  useEffect(() => { load(); }, [lid]);
  if (!d) return <Spinner />;
  const c = d.club;
  const act = async (path: string, body: unknown, msg: string) => {
    try { await api(`/api/leagues/${lid}/${path}`, body); toast.ok(msg); load(); reload(); } catch (e: any) { toast.bad(e.message); }
  };
  const statusCls = (s: string) => (s === 'ON TRACK' || s === 'DONE' ? 'ok' : s === 'AT RISK' || s === 'WAITING' ? 'risk' : 'bad');
  const fanPct = Math.round(Math.min(100, (c.fans / c.capacity) * 100));
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Club Office" tag={<span className="tag" style={{ background: 'rgba(232,67,140,0.3)', color: '#7FE9F7' }}><span>{c.typeName.toUpperCase()}</span></span>}
        sub={ov.club.pos ? `${ov.club.pos}${['', 'st', 'nd', 'rd'][ov.club.pos] || 'th'} place` : 'Pre-season'}
        right={<><span className="tiny muted" style={{ fontWeight: 900, letterSpacing: 1 }}>PROJECTED GRADE</span><span className="lz" style={{ fontSize: 28, color: '#7CE3A1' }}>{d.grade}</span></>} />
      <div className="split3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <Gauge v={c.board} color="#F2C14E" title="Board confidence" note={c.board >= 60 ? 'They back you' : 'Patience is wearing thin'} good={c.board >= 60} />
        <Gauge v={fanPct} color="#E8438C" title="Fans" note={`${c.fans.toLocaleString()} supporters`} good={fanPct >= 70} />
        <Gauge v={Math.round(d.objectives.reduce((a: number, o: any) => a + o.progress, 0) / d.objectives.length * 100)} color="#7FE9F7" title="Targets" note={d.objectives.filter((o: any) => o.status === 'ON TRACK' || o.status === 'DONE').length + '/' + d.objectives.length + ' on track'} good />
      </div>
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 250px)', gap: 12 }}>
        <section className="panel cut" style={{ gap: 6 }}>
          <span className="kicker">Season objectives</span>
          {d.objectives.map((o: any, i: number) => (
            <div key={i} className="row-item" style={{ gap: 10, minHeight: 44 }}>
              <span className="tiny" style={{ width: 62, fontWeight: 900, color: 'var(--muted)' }}>{o.area.toUpperCase()}</span>
              <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
                <b className="small">{o.text}</b>
                <div className="row" style={{ gap: 8 }}><div className="bar" style={{ height: 6 }}><i style={{ width: `${Math.round(o.progress * 100)}%`, background: o.status === 'ON TRACK' || o.status === 'DONE' ? '#7CE3A1' : '#F2C14E' }} /></div><span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{o.note}</span></div>
              </div>
              <span className={`status ${statusCls(o.status)}`}>{o.status}</span>
            </div>
          ))}
          <span className="kicker" style={{ marginTop: 6 }}>Manager's inbox</span>
          {!d.inbox.length && <span className="small muted">Nothing yet. Player complaints, offers, club events and board messages land here.</span>}
          <div className="col" style={{ gap: 3, maxHeight: 220, overflowY: 'auto' }}>
            {d.inbox.map((m: any) => <div key={m.id} className="row small" style={{ gap: 8, fontWeight: 700, padding: '4px 8px', background: 'rgba(255,255,255,0.04)' }}><span className="grow">{m.text}</span><span className="tiny dim">{new Date(m.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></div>)}
          </div>
          <div className="small" style={{ padding: '6px 10px', background: 'rgba(10,4,30,0.4)' }}><b style={{ color: '#F2C14E' }}>Club perk:</b> {d.perk} <b style={{ color: '#FF8A80' }}>Weakness:</b> {d.weak}</div>
        </section>
        <section className="col" style={{ gap: 10 }}>
          <div className="panel cut" style={{ gap: 6 }}>
            <div className="row between"><span className="kicker">Sponsor deal</span><span className="tiny muted">{d.canChooseSponsor ? 'Choose once per season' : 'Signed'}</span></div>
            {d.sponsors.map((s: any) => {
              const chosen = c.sponsor === s.key;
              return (
                <button key={s.key} disabled={!d.canChooseSponsor} onClick={() => act('sponsor', { key: s.key }, `${s.name} deal signed`)} className="col" style={{ gap: 2, padding: '6px 10px', textAlign: 'left', background: chosen ? 'rgba(232,67,140,0.25)' : 'rgba(255,255,255,0.06)', boxShadow: chosen ? 'inset 0 0 0 2px #E8438C' : undefined, opacity: !d.canChooseSponsor && !chosen ? 0.45 : 1 }}>
                  <div className="row between"><b>{s.name}</b><span className="lz" style={{ fontSize: 18, color: '#F2C14E' }}>≈ {s.estimate}M</span></div>
                  <span className="tiny muted">{s.text}</span>
                </button>
              );
            })}
          </div>
          <KitPanel kit={d.kit} save={(kit: any) => act('setup', { kit }, 'Kits saved')} />
          <div className="panel cut" style={{ gap: 6 }}>
            <span className="kicker">Stadium</span>
            {editing ? (
              <div className="row" style={{ gap: 6 }}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} style={{ height: 32 }} /><button className="seg on" onClick={() => { setEditing(false); act('stadium', { name }, 'Stadium renamed'); }}><span>Save</span></button></div>
            ) : (
              <div className="row between"><b className="lz" style={{ fontSize: 19 }}>{c.stadium}</b><button className="seg" onClick={() => setEditing(true)}><span>Rename</span></button></div>
            )}
            <div className="tiny muted">{d.attendance.toLocaleString()} / {c.capacity.toLocaleString()} seats · {d.gate}M per home game</div>
            <button className="ghost" onClick={() => act('expand', {}, '+5,000 seats')}><span>+5,000 seats · 6M</span></button>
          </div>
        </section>
      </div>
    </div>
  );
}

function KitPanel({ kit, save }: { kit: any; save: (k: any) => void }) {
  const [k, setK] = useState(kit);
  const [open, setOpen] = useState(false);
  return (
    <div className="panel cut" style={{ gap: 6 }}>
      <div className="row between"><span className="kicker">Kits</span><button className="seg" onClick={() => (open ? (save(k), setOpen(false)) : setOpen(true))}><span>{open ? 'Save' : 'Edit'}</span></button></div>
      <div className="row" style={{ gap: 16 }}>
        <div className="col" style={{ alignItems: 'center', gap: 0 }}><Kit c1={k.color1} c2={k.color2} pattern={k.pattern} size={46} label="Home kit" /><span className="tiny muted">Home</span></div>
        <div className="col" style={{ alignItems: 'center', gap: 0 }}><Kit c1={k.away1} c2={k.away2} size={46} label="Away kit" /><span className="tiny muted">Away</span></div>
        <span className="tiny muted grow">When both teams' shirts look alike, the away side changes to its away kit (or a white or black third kit).</span>
      </div>
      {open && (
        <div className="col" style={{ gap: 4 }}>
          <div className="row wrap" style={{ gap: 4 }}>{PATTERNS.map((p, i) => <button key={p} className={`seg ${k.pattern === i ? 'on' : ''}`} onClick={() => setK({ ...k, pattern: i })}><span>{p}</span></button>)}</div>
          {(['away1', 'away2'] as const).map((key, j) => (
            <div key={key} className="row wrap" style={{ gap: 3 }}><span className="tiny muted" style={{ width: 54 }}>{j ? 'Away 2nd' : 'Away'}</span>
              {COLORS.map((c: string) => <button key={c} aria-label={c} onClick={() => setK({ ...k, [key]: c })} style={{ width: 20, height: 20, background: c, boxShadow: k[key] === c ? '0 0 0 2px #1E1250, 0 0 0 3px #F3EEFF' : 'inset 0 0 0 1px rgba(255,255,255,0.25)' }} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Gauge({ v, color, title, note, good }: { v: number; color: string; title: string; note: string; good: boolean }) {
  return (
    <div className="panel cut" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
      <Ring v={v} size={52} color={color} font={18} />
      <div className="col" style={{ gap: 0 }}><b>{title}</b><span className="tiny" style={{ color: good ? '#7CE3A1' : '#FF8A80', fontWeight: 800 }}>{good ? '▲' : '▼'} {note}</span></div>
    </div>
  );
}
