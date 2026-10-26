'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/client.ts';
import { CORNER_ROUTINES, FORMATIONS, LINE, PRESETS, ROLES, stripDesc, tacticFit, type Tactic } from '../../lib/game.ts';
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
  const [plans, setPlans] = useState<Record<string, Tactic | null>>({});
  const [plan, setPlan] = useState<'A' | 'B' | 'C'>('A');
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [sp, setSp] = useState<Record<string, string>>({});
  const t = plans[plan] || null;
  const setT = (x: Tactic) => setPlans((ps) => ({ ...ps, [plan]: x }));
  const [pens, setPens] = useState<string[]>([]);
  const [as, setAs] = useState<Record<string, boolean>>({});
  const [panel, setPanel] = useState<'in' | 'out' | 'plans' | 'pens' | 'assistant' | 'roles' | 'setpieces' | 'fit'>('plans');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { api(`/api/leagues/${lid}/scout`).then(setScout).catch(() => {}); }, [lid]);
  useEffect(() => {
    if (!d) return;
    const a = d.club.tactic?.formation ? d.club.tactic : { preset: 'Wing play', formation: '4-3-3', ...stripDesc(PRESETS['Wing play']) };
    setPlans({ A: a, B: d.club.plans?.B || null, C: d.club.plans?.C || null });
    setRoles(d.club.roles || {});
    setSp(d.club.setpieces || {});
    setPens(d.club.pens || []);
    setAs({ injured: true, ...(d.club.assistant || {}) });
  }, [d]);
  const byId = useMemo(() => new Map((d?.players || []).map((p: any) => [p.id, p])), [d]);
  if (!d || !plans.A) return <Spinner />;
  if (!t) {
    return (
      <div className="col" style={{ gap: 8 }}>
        <BackHead title="Tactics" onBack={() => go('lineup')} tag={<PlanTabs plan={plan} plans={plans} setPlan={setPlan} />} />
        <section className="panel cut" style={{ gap: 8, alignItems: 'flex-start' }}>
          <div className="lz" style={{ fontSize: 22 }}>Plan {plan} is empty</div>
          <div className="small muted">Plans B and C are ready-made switches for the live match: one tap changes shape and style. Start from Plan A and change what you need, for example a 5-3-2 to protect a lead or a 4-2-4 when you must score.</div>
          <button className="cta" onClick={() => { setPlans({ ...plans, [plan]: { ...plans.A! } }); setDirty(true); }}><span>Create Plan {plan} from Plan A</span></button>
        </section>
      </div>
    );
  }
  const F = FORMATIONS[t.formation];
  const fam = Math.max(30, Math.min(100, d.club.familiarity?.[t.formation] ?? 50));
  // the saved line-up, unless players in it have left (sold, swapped, retired): then the best XI
  const sameShape = plan === 'A' && d.club.lineup?.length === 11 && t.formation === d.club.tactic?.formation;
  const saved: string[] = autoXI(d.players, t.formation, d.nextDay, sameShape ? d.club.lineup : []);
  const change = (fn: () => void) => { fn(); setDirty(true); };
  const setField = (k: keyof Tactic, v: number) => change(() => setT({ ...t, [k]: v, preset: 'Custom' }));
  const save = async () => {
    try {
      const reshaped = plans.A!.formation !== d.club.tactic?.formation;
      await api(`/api/leagues/${lid}/setup`, {
        tactic: plans.A, plans: { B: plans.B, C: plans.C }, pens, assistant: as, roles, setpieces: sp,
        ...(reshaped ? { lineup: autoXI(d.players, plans.A!.formation, d.nextDay) } : {}),
      });
      setDirty(false); toast.ok('Tactics saved for the next match');
    } catch (e: any) { toast.bad(e.message); }
  };
  const lineX = [22, 30, 40][t.line];
  const stamina = t.press + t.tempo >= 4 ? 'High' : t.press + t.tempo >= 2 ? 'Medium' : 'Low';
  const space = ['Small', 'Medium', 'Large'][t.line];
  const cards = t.press >= 2 ? 'High' : t.press === 1 ? 'Medium' : 'Low';
  const xiPlayers = saved.map((id) => byId.get(id) as any).filter(Boolean);
  // how well each plan suits the players in the line-up
  const fitXi = saved.map((id, i) => { const p: any = byId.get(id); return p ? { pos: p.pos, slot: F.slots[i], ovr: p.ovr, a: p.attrs || {} } : null; }).filter(Boolean) as any[];
  const fitNow = tacticFit(fitXi, t);
  const fitOf = (n: string) => tacticFit(fitXi.map((p) => ({ ...p })), stripDesc(PRESETS[n])).score;
  const fitColor = (v: number) => (v >= 65 ? '#7CE3A1' : v >= 45 ? '#7FE9F7' : '#FF9AA8');
  const takers = xiPlayers.filter((p: any) => p.pos !== 'GK').sort((a: any, b: any) => (b.attrs.Finishing + b.attrs.Composure) - (a.attrs.Finishing + a.attrs.Composure));
  return (
    <div className="col" style={{ gap: 8 }}>
      <BackHead title="Tactics" onBack={() => go('lineup')} tag={<PlanTabs plan={plan} plans={plans} setPlan={setPlan} />}
        right={<>
          <span className="tag pink"><span>{t.preset}</span></span>
          <button className="row tiny" onClick={() => setPanel('fit' as any)} title="How well this plan suits your players" style={{ gap: 6, fontWeight: 800 }}><span className="muted">Suits squad</span><div style={{ width: 60 }}><Bar v={fitNow.score} color={fitColor(fitNow.score)} /></div><b style={{ color: fitColor(fitNow.score) }}>{fitNow.score}%</b></button>
          <span className="row tiny" title="Familiarity grows each match you play this shape" style={{ gap: 6, fontWeight: 800 }}><span className="muted">Familiarity</span><div style={{ width: 70 }}><Bar v={fam} color={fam >= 80 ? '#7CE3A1' : fam >= 60 ? '#7FE9F7' : '#F2C14E'} /></div><b>{fam}</b></span>
          {scout?.opponent ? <span className="tag"><span>vs {scout.opponent.name}</span></span> : null}
        </>} />
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.95fr) minmax(280px, 1.05fr)', gap: 12 }}>
        <Pitch style={{ minHeight: 250 }}>
          <div style={{ position: 'absolute', top: 8, bottom: 8, left: `${lineX}%`, borderLeft: '2px dashed rgba(127,233,247,0.8)' }} />
          <span className="tiny" style={{ position: 'absolute', top: 10, left: `calc(${lineX}% + 4px)`, color: '#7FE9F7', fontWeight: 900 }}>DEF LINE</span>
          {F.xy.map(([x, y], i) => {
            const p: any = byId.get(saved[i]);
            const push = i === 0 ? 0 : (t.mentality - 1) * 4 + (F.slots[i] === 'DEF' ? (t.line - 1) * 4 : 0);
            const wide = F.slots[i] === 'GK' ? 0 : (y - 50) * (t.width - 1) * 0.15;
            return (
              <div key={i} className="pc" style={{ left: `clamp(31px, ${Math.max(5, Math.min(95, x + push))}%, calc(100% - 31px))`, top: `${Math.max(6, Math.min(94, y + wide))}%`, width: 58, height: 42, transition: 'left .3s, top .3s' }}>
                <b style={{ fontSize: 17 }}>{p && roles[p.id] && ROLES[roles[p.id]]?.line === F.slots[i] ? roleShort(roles[p.id]) : F.slots[i]}</b><small>{p ? lastName(p.name) : '—'}</small>
              </div>
            );
          })}
        </Pitch>
        <section className="panel cut" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 4 }}>
            {([['plans', 'Style'], ['fit', 'Squad fit'], ['in', 'In possession'], ['out', 'Out of possession'], ['roles', 'Roles'], ['setpieces', 'Set pieces'], ['pens', 'Penalties'], ['assistant', 'Assistant']] as const).map(([k, l]) => (
              <button key={k} className={`seg ${panel === k ? 'on' : ''}`} onClick={() => setPanel(k)}><span>{l}</span></button>
            ))}
          </div>
          {panel === 'plans' && (
            <div className="col" style={{ gap: 5 }}>
              <div className="row wrap" style={{ gap: 4 }}>
                <span className="small" style={{ width: 82, fontWeight: 800 }}>Formation</span>
                {Object.keys(FORMATIONS).map((f) => <button key={f} className={`seg ${t.formation === f ? 'on' : ''}`} onClick={() => change(() => setT({ ...t, formation: f }))}><span>{f}</span></button>)}
              </div>
              {plan !== 'A' && <div className="row tiny" style={{ gap: 8 }}><span className="muted grow">Switch to Plan {plan} live from the match screen.</span><button className="seg" onClick={() => change(() => setPlans({ ...plans, [plan]: null }))}><span>Delete Plan {plan}</span></button></div>}
              {Object.entries(PRESETS).map(([n, p]) => (
                <button key={n} className={`row-item ${t.preset === n ? 'sel' : ''}`} onClick={() => change(() => setT({ ...t, preset: n, ...stripDesc(p) }))} style={{ textAlign: 'left' }}>
                  <b style={{ width: 118, flex: 'none' }}>{n}</b><span className="tiny muted grow">{p.desc}</span>
                  <span className="tiny" title="How well this plan suits your line-up" style={{ fontWeight: 900, color: fitColor(fitOf(n)), whiteSpace: 'nowrap' }}>Fit {fitOf(n)}%</span>
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
          {panel === 'fit' && (
            <div className="col" style={{ gap: 6 }}>
              <span className="tiny muted">Every part of a plan needs something from your players. A plan that suits them is carried out better; one that doesn't is carried out worse, even if it is the right idea against this opponent.</span>
              {[...fitNow.parts].sort((a, b) => b.weight - a.weight).map((pt) => {
                const v = Math.round(50 + pt.value * 33);
                return (
                  <div key={pt.label} className="row small" style={{ gap: 8, fontWeight: 700 }}>
                    <span className="grow">{pt.label}</span>
                    <div style={{ width: 90 }}><Bar v={Math.max(4, Math.min(100, v))} color={fitColor(v)} /></div>
                    <b className="tiny" style={{ width: 70, textAlign: 'right', color: fitColor(v) }}>{v >= 65 ? 'Strength' : v >= 45 ? 'OK' : 'Weak spot'}</b>
                  </div>
                );
              })}
              <span className="tiny muted">Best plans for this line-up: {Object.keys(PRESETS).sort((a, b) => fitOf(b) - fitOf(a)).slice(0, 2).map((n) => `${n} (${fitOf(n)}%)`).join(', ')}.</span>
            </div>
          )}
          {panel === 'roles' && (
            <div className="col" style={{ gap: 4 }}>
              <span className="tiny muted">A role that suits the player's attributes gives a small edge. Roles stay with the player in every plan.</span>
              {xiPlayers.map((p: any, i: number) => {
                const slot = F.slots[saved.indexOf(p.id)] || LINE[p.pos];
                const opts = Object.entries(ROLES).filter(([, r]) => r.line === slot);
                const cur = roles[p.id] && ROLES[roles[p.id]]?.line === slot ? roles[p.id] : '';
                const fit = cur ? Math.round(ROLES[cur].keys.reduce((a: number, k: string) => a + (p.attrs[k] ?? 60), 0) / ROLES[cur].keys.length) : 0;
                return (
                  <div key={p.id} className="row small" style={{ gap: 8, fontWeight: 700 }}>
                    <span className="tiny" style={{ width: 30, color: '#7FE9F7', fontWeight: 900 }}>{slot}</span>
                    <span className="grow ellipsis" style={{ minWidth: 60 }}>{lastName(p.name)}</span>
                    <select value={cur} onChange={(e) => change(() => setRoles({ ...roles, [p.id]: e.target.value }))} style={{ width: 'clamp(104px, 40%, 140px)', height: 30 }} title={cur ? ROLES[cur].desc : ''}>
                      <option value="">Auto (assistant)</option>
                      {opts.map(([k]) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <b className="tiny" style={{ width: 26, textAlign: 'right', color: fit >= 80 ? '#7CE3A1' : fit >= 70 ? '#7FE9F7' : fit ? '#F2C14E' : '#8A7FB8' }}>{fit || '–'}</b>
                  </div>
                );
              })}
            </div>
          )}
          {panel === 'setpieces' && (
            <div className="col" style={{ gap: 8 }}>
              <Line label="Corners">
                <select value={sp.corner || ''} onChange={(e) => change(() => setSp({ ...sp, corner: e.target.value }))} style={{ height: 30 }}>
                  <option value="">Best crosser (auto)</option>
                  {takers.map((p: any) => <option key={p.id} value={p.id}>{p.name} · Crossing {p.attrs.Crossing}</option>)}
                </select>
              </Line>
              <Line label="Free kicks">
                <select value={sp.fk || ''} onChange={(e) => change(() => setSp({ ...sp, fk: e.target.value }))} style={{ height: 30 }}>
                  <option value="">Best shooter (auto)</option>
                  {takers.map((p: any) => <option key={p.id} value={p.id}>{p.name} · Long shots {p.attrs.LongShots}</option>)}
                </select>
              </Line>
              <Line label="Routine"><Seg small opts={Object.entries(CORNER_ROUTINES).map(([k, l]) => [k, l]) as any} value={sp.routine || 'far'} onPick={(v: any) => change(() => setSp({ ...sp, routine: v }))} /></Line>
              <div className="tiny muted">Near post suits quick movers, far post suits tall headers, short corners keep the ball and suit good passers.</div>
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
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="panel grow" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '8px 12px', minWidth: 240, flexBasis: 300 }}>
          <span className="tag" style={{ background: '#F29BC2', color: '#1B1048' }}><span>SCOUT</span></span>
          <span className="small" style={{ fontWeight: 700 }}>{scoutLine(scout)}</span>
        </div>
        <button className={`cta ${dirty ? 'shine' : ''}`} onClick={save} disabled={!dirty} style={{ minWidth: 150 }}><span>{dirty ? 'Save tactic' : 'Saved'}</span></button>
      </div>
    </div>
  );
}

const SHORT: Record<string, string> = {
  'Shot stopper': 'SS', 'Sweeper keeper': 'SK', Stopper: 'STP', 'Ball-playing': 'BPD', 'Wing-back': 'WB', Anchor: 'ANC',
  'Box-to-box': 'B2B', Playmaker: 'PM', Poacher: 'POA', 'Target man': 'TM', 'False 9': 'F9', 'Inside forward': 'IF',
};
const roleShort = (r: string) => SHORT[r] || r.slice(0, 3).toUpperCase();

function PlanTabs({ plan, plans, setPlan }: { plan: string; plans: Record<string, any>; setPlan: (p: any) => void }) {
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {(['A', 'B', 'C'] as const).map((k) => (
        <button key={k} className={`seg ${plan === k ? 'on' : ''}`} onClick={() => setPlan(k)} style={{ opacity: plans[k] ? 1 : 0.6 }}>
          <span>Plan {k}{plans[k] ? ` · ${plans[k].formation}` : ' +'}</span>
        </button>
      ))}
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
  const mine: string[] = s.myRecent || [];
  if (o.ai && mine.length >= 2 && mine.every((m) => m === mine[0])) parts.push(`You have played ${mine[0]} ${mine.length} times in a row: ${o.name} will be ready for it. Surprise them.`);
  else if (o.ai && mine.length) parts.push(`AI managers study your last plans (last time: ${mine[0]}) and pick one that beats it.`);
  if (o.recent?.length) parts.push(`${o.name} played ${o.recent[0]} last time.`);
  if (st.fwdPace >= 80) parts.push(`Their strikers have pace ${st.fwdPace}: a high line leaves space for through balls.`);
  else if (st.defPace <= 68) parts.push(`Their defenders are slow (pace ${st.defPace}): through balls can hurt them.`);
  if (st.defAir <= 65) parts.push(`Weak in the air at the back (${st.defAir}): try crosses.`);
  if (st.keeper <= 70) parts.push(`Their keeper is shaky (${st.keeper}): shoot on sight.`);
  if (!parts.length) parts.push(`${o.name}: team strength ${st.strength}. No obvious weakness.`);
  return parts.slice(0, 2).join(' ');
}
