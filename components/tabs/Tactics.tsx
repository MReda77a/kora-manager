'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/client.ts';
import { FORMATIONS, LINE, PRESETS, stripDesc, type Tactic } from '../../lib/game.ts';
import { Bar, BackHead, Seg, Spinner, lastName } from '../ui.tsx';
import { Pitch, autoXI, useSquad } from './Lineup.tsx';
import type { TabProps } from './types.ts';

const ASSIST = [
  ['tired', 'Sub tired players', 'Fitness low after 60\''],
  ['cards', 'Protect booked players', 'Sub a booked defender'],
  ['winning', 'Shut it down when winning', 'Go defensive after 75\''],
  ['losing', 'Go for it when losing', 'Add a striker after 60\''],
  ['injured', 'Replace injured players', 'Like for like from the bench'],
] as const;

export default function TacticsTab({ lid, toast, go }: TabProps) {
  const { d } = useSquad(lid);
  const [scout, setScout] = useState<any>(null);
  const [t, setT] = useState<Tactic | null>(null);
  const [pens, setPens] = useState<string[]>([]);
  const [as, setAs] = useState<Record<string, boolean>>({});
  const [panel, setPanel] = useState<'in' | 'out' | 'plans' | 'pens' | 'assistant'>('plans');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { api(`/api/leagues/${lid}/scout`).then(setScout).catch(() => {}); }, [lid]);
  useEffect(() => {
    if (!d) return;
    setT(d.club.tactic?.formation ? d.club.tactic : { preset: 'Wing play', formation: '4-3-3', ...stripDesc(PRESETS['Wing play']) });
    setPens(d.club.pens || []);
    setAs({ injured: true, ...(d.club.assistant || {}) });
  }, [d]);
  const byId = useMemo(() => new Map((d?.players || []).map((p: any) => [p.id, p])), [d]);
  if (!d || !t) return <Spinner />;
  const F = FORMATIONS[t.formation];
  const saved: string[] = d.club.lineup?.length === 11 ? d.club.lineup : autoXI(d.players, t.formation, d.nextDay);
  const change = (fn: () => void) => { fn(); setDirty(true); };
  const setField = (k: keyof Tactic, v: number) => change(() => setT({ ...t, [k]: v, preset: 'Custom' }));
  const save = async () => {
    try { await api(`/api/leagues/${lid}/setup`, { tactic: t, pens, assistant: as }); setDirty(false); toast.ok('Tactics saved for the next match'); } catch (e: any) { toast.bad(e.message); }
  };
  const lineX = [22, 30, 40][t.line];
  const stamina = t.press + t.tempo >= 4 ? 'High' : t.press + t.tempo >= 2 ? 'Medium' : 'Low';
  const space = ['Small', 'Medium', 'Large'][t.line];
  const cards = t.press >= 2 ? 'High' : t.press === 1 ? 'Medium' : 'Low';
  const xiPlayers = saved.map((id) => byId.get(id) as any).filter(Boolean);
  const takers = xiPlayers.filter((p: any) => p.pos !== 'GK').sort((a: any, b: any) => (b.attrs.Finishing + b.attrs.Composure) - (a.attrs.Finishing + a.attrs.Composure));
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Tactics" onBack={() => go('lineup')} tag={<span className="tag pink"><span>{t.preset}</span></span>}
        right={scout?.opponent ? <span className="tag"><span>vs {scout.opponent.name}</span></span> : undefined} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.95fr) minmax(280px, 1.05fr)', gap: 12 }}>
        <Pitch style={{ minHeight: 250 }}>
          <div style={{ position: 'absolute', top: 8, bottom: 8, left: `${lineX}%`, borderLeft: '2px dashed rgba(127,233,247,0.8)' }} />
          <span className="tiny" style={{ position: 'absolute', top: 10, left: `calc(${lineX}% + 4px)`, color: '#7FE9F7', fontWeight: 900 }}>DEF LINE</span>
          {F.xy.map(([x, y], i) => {
            const p: any = byId.get(saved[i]);
            const push = i === 0 ? 0 : (t.mentality - 1) * 4 + (F.slots[i] === 'DEF' ? (t.line - 1) * 4 : 0);
            const wide = F.slots[i] === 'GK' ? 0 : (y - 50) * (t.width - 1) * 0.15;
            return (
              <div key={i} className="pc" style={{ left: `${Math.max(5, Math.min(95, x + push))}%`, top: `${Math.max(6, Math.min(94, y + wide))}%`, width: 58, height: 42, transition: 'left .3s, top .3s' }}>
                <b style={{ fontSize: 17 }}>{F.slots[i]}</b><small>{p ? lastName(p.name) : '—'}</small>
              </div>
            );
          })}
        </Pitch>
        <section className="panel cut" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 4 }}>
            {([['plans', 'Game plans'], ['in', 'In possession'], ['out', 'Out of possession'], ['pens', 'Penalties'], ['assistant', 'Assistant']] as const).map(([k, l]) => (
              <button key={k} className={`seg ${panel === k ? 'on' : ''}`} onClick={() => setPanel(k)}><span>{l}</span></button>
            ))}
          </div>
          {panel === 'plans' && (
            <div className="col" style={{ gap: 5 }}>
              {Object.entries(PRESETS).map(([n, p]) => (
                <button key={n} className={`row-item ${t.preset === n ? 'sel' : ''}`} onClick={() => change(() => setT({ ...t, preset: n, ...stripDesc(p) }))} style={{ textAlign: 'left' }}>
                  <b style={{ width: 118, flex: 'none' }}>{n}</b><span className="tiny muted">{p.desc}</span>
                </button>
              ))}
            </div>
          )}
          {panel === 'in' && (
            <div className="col" style={{ gap: 8 }}>
              <Line label="Tempo"><Seg small opts={[[0, 'Slow'], [1, 'Normal'], [2, 'Fast']]} value={t.tempo} onPick={(v) => setField('tempo', v)} /></Line>
              <Line label="Width"><Seg small opts={[[0, 'Narrow'], [1, 'Balanced'], [2, 'Wide']]} value={t.width} onPick={(v) => setField('width', v)} /></Line>
              <Line label="Build-up"><Seg small opts={[[0, 'Play out'], [1, 'Mixed'], [2, 'Direct']]} value={t.build} onPick={(v) => setField('build', v)} /></Line>
              <Line label="Final third"><Seg small opts={[[0, 'Cross'], [1, 'Through'], [2, 'Work in'], [3, 'Shoot']]} value={t.focus} onPick={(v) => setField('focus', v)} /></Line>
            </div>
          )}
          {panel === 'out' && (
            <div className="col" style={{ gap: 8 }}>
              <Line label="Mentality"><Seg small opts={[[0, 'Defensive'], [1, 'Balanced'], [2, 'Attacking']]} value={t.mentality} onPick={(v) => setField('mentality', v)} /></Line>
              <Line label="Pressing"><Seg small opts={[[0, 'Low'], [1, 'Mid'], [2, 'High'], [3, 'Gegen']]} value={t.press} onPick={(v) => setField('press', v)} /></Line>
              <Line label="Def. line"><Seg small opts={[[0, 'Deep'], [1, 'Mid'], [2, 'High']]} value={t.line} onPick={(v) => setField('line', v)} /></Line>
              <div className="tiny muted">A high press wins the ball near goal but drains legs. A high line squeezes the pitch but fast strikers run in behind. A deep block stops through balls but invites crosses and long shots.</div>
            </div>
          )}
          {panel === 'pens' && (
            <div className="col" style={{ gap: 4 }}>
              <div className="row between tiny"><span className="muted" style={{ fontWeight: 800 }}>PENALTY TAKERS · TAP IN ORDER</span><b style={{ color: '#7CE3A1' }}>{pens.filter((x) => takers.some((p: any) => p.id === x)).length}/5 picked</b></div>
              {takers.map((p: any) => {
                const n = pens.indexOf(p.id);
                const skill = Math.round((p.attrs.Finishing + p.attrs.Composure) / 2);
                return (
                  <button key={p.id} className={`row-item ${n >= 0 ? 'sel' : ''}`} style={{ textAlign: 'left', minHeight: 30 }} onClick={() => change(() => setPens(n >= 0 ? pens.filter((x) => x !== p.id) : pens.length < 5 ? [...pens, p.id] : pens))}>
                    <span style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', background: n >= 0 ? '#E8438C' : 'rgba(255,255,255,0.1)', clipPath: 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)', fontWeight: 900, fontSize: 12 }}>{n >= 0 ? n + 1 : ''}</span>
                    <b className="grow ellipsis">{p.name} <span className="tiny muted">{p.pos}</span></b>
                    <div style={{ width: 70 }}><Bar v={skill} color={skill >= 80 ? '#7CE3A1' : skill >= 70 ? '#7FE9F7' : '#F2C14E'} /></div>
                    <b style={{ width: 24, textAlign: 'right', color: skill >= 80 ? '#7CE3A1' : skill >= 70 ? '#7FE9F7' : '#F2C14E' }}>{skill}</b>
                  </button>
                );
              })}
            </div>
          )}
          {panel === 'assistant' && (
            <div className="col" style={{ gap: 8 }}>
              <span className="kicker">If you skip, your assistant will…</span>
              {ASSIST.map(([k, l, sub]) => (
                <button key={k} className="row" style={{ gap: 10, textAlign: 'left' }} onClick={() => change(() => setAs({ ...as, [k]: !as[k] }))}>
                  <span style={{ width: 40, height: 22, borderRadius: 11, background: as[k] ? '#7CE3A1' : 'rgba(255,255,255,0.15)', position: 'relative', flex: 'none' }}>
                    <i style={{ position: 'absolute', top: 3, left: as[k] ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
                  </span>
                  <span className="col" style={{ gap: 0 }}><b className="small">{l}</b><span className="tiny muted">{sub}</span></span>
                </button>
              ))}
            </div>
          )}
          <div className="row wrap" style={{ gap: 6, marginTop: 'auto' }}>
            <span className="tag" style={{ background: 'rgba(232,67,140,0.25)' }}><span>Stamina drain: {stamina}</span></span>
            <span className="tag" style={{ background: 'rgba(242,193,78,0.22)', color: '#F2C14E' }}><span>Space behind: {space}</span></span>
            <span className="tag" style={{ background: 'rgba(127,233,247,0.18)', color: '#7FE9F7' }}><span>Card risk: {cards}</span></span>
          </div>
        </section>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="panel grow" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
          <span className="tag" style={{ background: '#F29BC2', color: '#1B1048' }}><span>SCOUT</span></span>
          <span className="small" style={{ fontWeight: 700 }}>{scoutLine(scout)}</span>
        </div>
        <button className={`cta ${dirty ? 'shine' : ''}`} onClick={save} disabled={!dirty} style={{ minWidth: 150 }}><span>{dirty ? 'Save tactic' : 'Saved'}</span></button>
      </div>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="row" style={{ gap: 8 }}><span className="small" style={{ width: 82, flex: 'none', fontWeight: 800 }}>{label}</span><div className="grow">{children}</div></div>;
}

function scoutLine(s: any) {
  if (!s) return 'Loading the scout report…';
  if (!s.opponent) return 'No match coming up.';
  const o = s.opponent, st = s.stats;
  const parts: string[] = [];
  if (o.recent?.length) parts.push(`${o.name} played ${o.recent[0]} last time${o.ai ? ' (AI clubs read your last tactics and counter them)' : ''}.`);
  if (st.fwdPace >= 80) parts.push(`Their strikers have pace ${st.fwdPace}: a high line leaves space for through balls.`);
  else if (st.defPace <= 68) parts.push(`Their defenders are slow (pace ${st.defPace}): through balls can hurt them.`);
  if (st.defAir <= 65) parts.push(`Weak in the air at the back (${st.defAir}): try crosses.`);
  if (st.keeper <= 70) parts.push(`Their keeper is shaky (${st.keeper}): shoot on sight.`);
  if (!parts.length) parts.push(`${o.name}: team strength ${st.strength}. No obvious weakness.`);
  return parts.slice(0, 2).join(' ');
}
