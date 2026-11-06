'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { BackHead, COLORS, Kit, Ring, Spinner } from '../ui.tsx';
import { PATTERNS } from '../../lib/game.ts';
import type { TabProps } from './types.ts';

export default function OfficeTab({ lid, d: ov, toast, reload, go }: TabProps) {
  const [d, setD] = useState<any>(null);
  const [openObj, setOpenObj] = useState<number | null>(0);
  const [rules, setRules] = useState(false);
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
      <BackHead title="Club Office" tag={<span className="tag" style={{ background: 'rgba(46, 230, 160,0.3)', color: 'var(--cyan)' }}><span>{c.typeName.toUpperCase()}</span></span>}
        sub={ov.club.pos ? `${ov.club.pos}${['', 'st', 'nd', 'rd'][ov.club.pos] || 'th'} place` : 'Pre-season'}
        right={<><span className="tiny muted" style={{ fontWeight: 900, letterSpacing: 1 }}>PROJECTED GRADE</span><span className="lz" style={{ fontSize: 28, color: '#2EE6A0' }}>{d.grade}</span></>} />
      <div className="split3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, cursor: 'pointer' }} onClick={() => setRules(!rules)} title="What moves these numbers">
        <Gauge v={c.board} color="#F2C14E" title="Board confidence ⓘ" note={c.board >= 60 ? 'They back you' : 'Patience is wearing thin'} good={c.board >= 60} />
        <Gauge v={fanPct} color="#2EE6A0" title="Fans" note={`${c.fans.toLocaleString()} supporters`} good={fanPct >= 70} />
        <Gauge v={Math.round(d.objectives.reduce((a: number, o: any) => a + o.progress, 0) / d.objectives.length * 100)} color="#5FD3F3" title="Targets" note={d.objectives.filter((o: any) => o.status === 'ON TRACK' || o.status === 'DONE').length + '/' + d.objectives.length + ' on track'} good />
      </div>
      {d.finance && <Finance f={d.finance} season={ov.league.season} />}
      {rules && (
        <div className="panel obj-how" style={{ gap: 3 }}>
          <b className="small">What moves board confidence</b>
          {(d.boardRules || []).map((r: string, i: number) => <span key={i} className="tiny">• {r}</span>)}
          <span className="tiny muted">Fans grow with wins (more in derbies) and leave after defeats. Targets are the objectives below.</span>
        </div>
      )}
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 250px)', gap: 12 }}>
        <section className="panel cut" style={{ gap: 6 }}>
          <span className="kicker">Season objectives</span>
          <span className="tiny muted">Tap a target to see how to reach it.</span>
          {d.objectives.map((o: any, i: number) => (
            <div key={i} className="col" style={{ gap: 0 }}>
            <button className={`row-item obj ${openObj === i ? 'open' : ''}`} style={{ gap: 10, minHeight: 44, width: '100%', textAlign: 'left' }} onClick={() => setOpenObj(openObj === i ? null : i)} aria-expanded={openObj === i}>
              <span className="tiny" style={{ width: 62, fontWeight: 900, color: 'var(--muted)' }}>{o.area.toUpperCase()}</span>
              <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
                <b className="small">{o.text}</b>
                <div className="row" style={{ gap: 8 }}><div className="bar" style={{ height: 6 }}><i style={{ width: `${Math.round(o.progress * 100)}%`, background: o.status === 'ON TRACK' || o.status === 'DONE' ? '#2EE6A0' : '#F2C14E' }} /></div><span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{o.note}</span></div>
              </div>
              <span className={`status ${statusCls(o.status)}`}>{o.status}</span>
              <span className="muted" style={{ width: 12 }}>{openObj === i ? '▴' : '▾'}</span>
            </button>
            {openObj === i && (
              <div className="obj-how">
                {o.how && <span className="small"><b style={{ color: 'var(--mint)' }}>How:</b> {o.how}</span>}
                {o.reward && <span className="tiny muted">{o.reward}</span>}
                {o.go && <button className="seg on" style={{ alignSelf: 'flex-start' }} onClick={() => go(o.go)}><span>{o.cta || 'Go'} ›</span></button>}
              </div>
            )}
            </div>
          ))}
          <span className="kicker" style={{ marginTop: 6 }}>Manager's inbox</span>
          {!d.inbox.length && <span className="small muted">Nothing yet. Player complaints, offers, club events and board messages land here.</span>}
          <div className="col" style={{ gap: 3, maxHeight: 220, overflowY: 'auto' }}>
            {d.inbox.map((m: any) => <div key={m.id} className="row small" style={{ gap: 8, fontWeight: 700, padding: '4px 8px', background: 'rgba(255,255,255,0.04)' }}><span className="grow">{m.text}</span><span className="tiny dim">{new Date(m.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></div>)}
          </div>
          <div className="small" style={{ padding: '6px 10px', background: 'rgba(6, 14, 26,0.4)' }}><b style={{ color: '#F2C14E' }}>Club perk:</b> {d.perk} <b style={{ color: '#FF8A80' }}>Weakness:</b> {d.weak}</div>
        </section>
        <section className="col" style={{ gap: 10 }}>
          <div className="panel cut" style={{ gap: 6 }}>
            <div className="row between"><span className="kicker">Sponsor deal</span><span className="tiny muted">{d.canChooseSponsor ? 'Choose once per season' : 'Signed'}</span></div>
            {d.sponsors.map((s: any) => {
              const chosen = c.sponsor === s.key;
              return (
                <button key={s.key} disabled={!d.canChooseSponsor} onClick={() => act('sponsor', { key: s.key }, `${s.name} deal signed`)} className="col" style={{ gap: 2, padding: '6px 10px', textAlign: 'left', background: chosen ? 'rgba(46, 230, 160,0.25)' : 'rgba(255,255,255,0.06)', boxShadow: chosen ? 'inset 0 0 0 2px #2EE6A0' : undefined, opacity: !d.canChooseSponsor && !chosen ? 0.45 : 1 }}>
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
      <Resign lid={lid} club={c.name} toast={toast} />
    </div>
  );
}

// leaving the league: the club carries on with an AI manager; asks for the club name to be typed first
function Resign({ lid, club, toast }: { lid: number; club: string; toast: TabProps['toast'] }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await api(`/api/leagues/${lid}/resign`, { confirm: typed }); window.location.href = '/'; }
    catch (e: any) { toast.bad(e.message); setBusy(false); }
  };
  return (
    <section className="panel" style={{ gap: 8, borderColor: 'rgba(255, 92, 108, 0.35)' }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <b>Resign from this league</b>
          <span className="tiny muted">{club} carries on with an AI manager, with its players and money. You lose the club and the league leaves your list. This cannot be undone.</span>
        </div>
        {!open && <button className="ghost" style={{ borderColor: 'rgba(255, 92, 108, 0.6)', color: '#FF8A80' }} onClick={() => setOpen(true)}><span>Resign</span></button>}
      </div>
      {open && (
        <div className="row wrap" style={{ gap: 6 }}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type "${club}" to confirm`} style={{ flex: '1 1 200px', height: 38 }} aria-label="Type your club name to confirm" />
          <button className="cta" style={{ background: 'linear-gradient(180deg, #FF7A86, #E0465A)', color: '#fff' }} disabled={busy || typed.trim().toLowerCase() !== club.trim().toLowerCase()} onClick={go}><span>{busy ? 'Resigning…' : 'Resign for good'}</span></button>
          <button className="seg" onClick={() => { setOpen(false); setTyped(''); }}><span>Cancel</span></button>
        </div>
      )}
    </section>
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
              {COLORS.map((c: string) => <button key={c} aria-label={c} onClick={() => setK({ ...k, [key]: c })} style={{ width: 20, height: 20, background: c, boxShadow: k[key] === c ? '0 0 0 2px #0F2238, 0 0 0 3px #E8F1FA' : 'inset 0 0 0 1px rgba(255,255,255,0.25)' }} />)}
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
      <div className="col" style={{ gap: 0 }}><b>{title}</b><span className="tiny" style={{ color: good ? '#2EE6A0' : '#FF8A80', fontWeight: 800 }}>{good ? '▲' : '▼'} {note}</span></div>
    </div>
  );
}

// The club's money: balance, wage bill per match and the last match's books.
function Finance({ f, season }: { f: any; season: number }) {
  const red = f.money < 0;
  return (
    <div className="panel cut fin-card">
      <div className="col" style={{ gap: 2 }}>
        <span className="tiny muted" style={{ fontWeight: 900 }}>CLUB MONEY</span>
        <b className="lz" style={{ fontSize: 26, color: red ? '#FF8A80' : 'var(--mint)' }}>{f.money.toFixed(1)}M</b>
        {red && <span className="tiny" style={{ color: '#FF8A80', fontWeight: 800 }}>In the red: board −2 every match, no buying until you are back above zero.</span>}
      </div>
      <div className="col" style={{ gap: 2 }}>
        <span className="tiny muted" style={{ fontWeight: 900 }}>WAGES PER MATCH</span>
        <b className="lz" style={{ fontSize: 22 }}>{f.wageBill.toFixed(2)}M</b>
        <span className="tiny muted">{f.players} players{f.wagesOn ? '' : ` · wages start in season ${f.wagesFrom}`}</span>
      </div>
      <div className="col" style={{ gap: 2 }}>
        <span className="tiny muted" style={{ fontWeight: 900 }}>LAST MATCH</span>
        {f.last ? (
          <>
            <span className="small" style={{ fontWeight: 800 }}><span style={{ color: 'var(--mint)' }}>+{Number(f.last.income).toFixed(2)}M</span> in · <span style={{ color: '#FF8A80' }}>−{Number(f.last.wages).toFixed(2)}M</span> wages</span>
            <span className="tiny muted">TV money (0.2M a match), wins, home gates and your sponsor bring money in. Every player costs a wage, the best ones the most.</span>
          </>
        ) : <span className="tiny muted">No match yet{f.wagesOn ? '' : `. From season ${f.wagesFrom} every player is paid after each match, the best ones the most`}.</span>}
      </div>
    </div>
  );
}
