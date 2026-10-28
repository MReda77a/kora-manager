'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, shirt } from '../../lib/client.ts';
import { FORMATIONS, LINE, PRESETS, chemGroup, lineChem, offPositionCost, pairKey, slotLabel, stripDesc, type Tactic, CHEM_START } from '../../lib/game.ts';
import { BackHead, Seg, Spinner, lastName } from '../ui.tsx';
import type { TabProps } from './types.ts';

// Best XI for a formation. `keep` holds players already chosen per slot ('' = empty slot to fill).
export function autoXI(players: any[], formation: string, nextDay: number, keep: string[] = []) {
  const slots = FORMATIONS[formation].slots;
  const avail = players.filter((p) => !(p.outUntil >= nextDay));
  const ids = new Set(players.map((p) => p.id));
  const xi: string[] = slots.map((_, i) => (keep[i] && ids.has(keep[i]) ? keep[i] : ''));
  const used = new Set<string>(xi.filter(Boolean));
  const score = (p: any) => (p.ovr + (p.form || 0)) * (0.6 + 0.4 * Math.min(100, p.fitness + 22) / 100);
  for (const strict of [true, false]) {
    slots.forEach((s, i) => {
      if (xi[i]) return;
      const best = avail.filter((p) => !used.has(p.id) && (!strict || (LINE[p.pos] || 'MID') === s)).sort((a, b) => score(b) - score(a))[0];
      if (best) { used.add(best.id); xi[i] = best.id; }
    });
  }
  return xi;
}

// formations sit in the left three quarters of the pitch: use its whole length on screen
export const spreadX = (x: number) => 5 + (x - 6) * (88 / 72);

export function useSquad(lid: number) {
  const [d, setD] = useState<any>(null);
  const load = () => api(`/api/leagues/${lid}/squad`).then(setD);
  useEffect(() => { load(); }, [lid]);
  return { d, load };
}

export function Pitch({ children, style, sized }: { children: React.ReactNode; style?: React.CSSProperties; sized?: boolean }) {
  return (
    <div className={`field ${sized ? 'sized' : ''}`} style={{ flex: 1, minHeight: 230, ...style }}>
      <div className="ln" style={{ inset: 8 }} />
      <div className="ln" style={{ top: 8, bottom: 8, left: '50%', width: 0, borderWidth: '0 0 0 1.5px' }} />
      <div className="ln" style={{ left: '50%', top: '50%', width: 64, height: 64, margin: '-32px 0 0 -32px', borderRadius: '50%' }} />
      <div className="ln" style={{ left: 8, top: '50%', width: 52, height: 120, marginTop: -60, borderLeft: 'none' }} />
      <div className="ln" style={{ right: 8, top: '50%', width: 52, height: 120, marginTop: -60, borderRight: 'none' }} />
      {children}
    </div>
  );
}

export default function LineupTab({ lid, toast, go }: TabProps) {
  const { d } = useSquad(lid);
  const [t, setT] = useState<Tactic | null>(null);
  const [xi, setXi] = useState<string[]>([]);
  const [sel, setSel] = useState<{ kind: 'slot' | 'bench'; v: number | string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [cap, setCap] = useState<{ c: string | null; v: string | null }>({ c: null, v: null });
  useEffect(() => {
    if (!d) return;
    setCap({ c: d.club.captain, v: d.club.vice });
    const tac = d.club.tactic?.formation ? d.club.tactic : { preset: 'Wing play', formation: '4-3-3', ...stripDesc(PRESETS['Wing play']) };
    setT(tac);
    const saved: string[] = d.club.lineup || [];
    const ids = new Set(d.players.map((p: any) => p.id));
    const ok = saved.length === 11 && saved.every((x) => ids.has(x));
    // players who left the club leave a gap: fill only those slots
    setXi(ok ? saved : autoXI(d.players, tac.formation, d.nextDay, saved.length === 11 ? saved : []));
  }, [d]);
  const byId = useMemo(() => new Map((d?.players || []).map((p: any) => [p.id, p])), [d]);
  if (!d || !t) return <Spinner />;
  const F = FORMATIONS[t.formation];
  const forms = Object.keys(FORMATIONS);
  const out = (p: any) => p && p.outUntil >= d.nextDay;
  const bench = d.players.filter((p: any) => !xi.includes(p.id)).sort((a: any, b: any) => Number(out(a)) - Number(out(b)) || b.ovr - a.ovr);
  const strength = Math.round(xi.map((id) => byId.get(id) as any).filter(Boolean).reduce((a: number, p: any) => a + p.ovr + (p.form || 0) - offPositionCost(LINE[p.pos] || 'MID', F.slots[xi.indexOf(p.id)]), 0) / 11);
  const set = (fn: () => void) => { fn(); setDirty(true); };
  const chem: Record<string, number> = d.club.chem || {};
  const lc = lineChem(xi, t.formation, chem);

  const tapSlot = (i: number) => {
    if (!sel) return setSel({ kind: 'slot', v: i });
    if (sel.kind === 'slot') {
      if (sel.v === i) return setSel(null);
      set(() => { const n = [...xi]; [n[i], n[sel.v as number]] = [n[sel.v as number], n[i]]; setXi(n); });
      return setSel(null);
    }
    set(() => { const n = [...xi]; n[i] = sel.v as string; setXi(n); });
    setSel(null);
  };
  const tapBench = (id: string) => {
    if (sel?.kind === 'slot') {
      set(() => { const n = [...xi]; n[sel.v as number] = id; setXi(n); });
      return setSel(null);
    }
    setSel(sel?.kind === 'bench' && sel.v === id ? null : { kind: 'bench', v: id });
  };
  const setF = (dir: number) => set(() => {
    const f = forms[(forms.indexOf(t.formation) + dir + forms.length) % forms.length];
    setT({ ...t, formation: f });
    setXi(autoXI(d.players, f, d.nextDay));
    setSel(null);
  });
  const save = async () => {
    try {
      const r = await api(`/api/leagues/${lid}/setup`, { tactic: t, lineup: xi, captain: cap.c, vice: cap.v });
      setDirty(false);
      toast.ok(r?.note || 'Lineup saved for the next match');
      d.club.captain = cap.c; d.club.vice = cap.v;
    } catch (e: any) { toast.bad(e.message); }
  };
  // the armband: the manager's pick, or the best leader on the pitch when none is chosen
  const xiPlayers = xi.map((id) => byId.get(id) as any).filter(Boolean);
  const autoCap = [...xiPlayers].sort((a, b) => b.lead - a.lead)[0]?.id;
  const wearer = cap.c && xi.includes(cap.c) ? cap.c : cap.v && xi.includes(cap.v) ? cap.v : autoCap;
  const stars = (l: number) => '★'.repeat(Math.max(1, Math.min(5, Math.round(l * 5))));
  const opp = d.next ? (d.next.home_id === d.club.id ? d.next.away : d.next.home) : null;
  const hint = sel ? (sel.kind === 'slot' ? 'Tap another player to swap, or a bench player to bring him on' : 'Now tap the player on the pitch to replace') : 'Tap a player to move or replace him';
  return (
    <div className="col" style={{ gap: 8, height: '100%' }}>
      <BackHead title="Lineup" tag={opp ? <span className="tag pink"><span>vs {opp}</span></span> : undefined}
        right={<><span className="small muted" style={{ fontWeight: 700 }}>Team strength</span><span className="lz" style={{ fontSize: 24, color: '#5FD3F3' }}>{strength}</span></>} />
      <div className="split" style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 250px)', gap: 12 }}>
        <section className="col" style={{ gap: 8, minWidth: 0 }}>
          <Pitch sized>
            {/* chemistry links between team-mates in the same line: green = they know each other, red = strangers */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true">
              {(['DEF', 'MID', 'FWD'] as const).flatMap((g) => {
                const mem = F.slots.map((sl, i) => ({ i, sl })).filter((m) => xi[m.i] && chemGroup(m.sl) === g).sort((a, b) => F.xy[a.i][1] - F.xy[b.i][1]);
                return mem.slice(1).map((m, k) => {
                  const a = mem[k], v = chem[pairKey(xi[a.i], xi[m.i])] ?? CHEM_START;
                  const col = v >= 70 ? '#2EE6A0' : v >= 45 ? '#F2C14E' : '#FF6B7A';
                  return <line key={`${g}${k}`} x1={spreadX(F.xy[a.i][0])} y1={F.xy[a.i][1]} x2={spreadX(F.xy[m.i][0])} y2={F.xy[m.i][1]} stroke={col} strokeWidth={3} strokeOpacity={0.85} strokeDasharray={v < 45 ? '4 4' : undefined} vectorEffect="non-scaling-stroke" />;
                });
              })}
            </svg>
            {F.xy.map(([x, y], i) => {
              const p: any = byId.get(xi[i]);
              const label = slotLabel(F.slots[i], x, y);
              const cost = p ? offPositionCost(LINE[p.pos] || 'MID', F.slots[i]) : 0;
              const wrong = cost > 0;
              const on = sel?.kind === 'slot' && sel.v === i;
              return (
                <button key={i} className={`pc ${on ? 'sel' : ''} ${sel && !on ? 'swap' : ''} ${wrong ? 'wrong' : ''} ${out(p) ? 'out' : ''}`} style={{ left: `clamp(24px, ${spreadX(x)}%, calc(100% - 24px))`, top: `clamp(20px, ${y}%, calc(100% - 20px))` }} onClick={() => tapSlot(i)}
                  aria-label={p ? `${p.name}, ${label}${wrong ? `, out of position (${p.pos}), minus ${cost}` : ''}` : `Empty ${label}`}>
                  <i>{p ? p.num ?? shirt(p.id, p.natPos || p.pos) : ''}</i>
                  <em>{label}</em>
                  <b>{p ? p.ovr + (p.form || 0) - cost : '–'}</b>
                  <small>{p ? (wrong ? `${p.pos} · −${cost}` : lastName(p.name)) : label}</small>
                  {p && p.id === wearer && <span className={`arm ${p.id !== cap.c && cap.c ? 'v' : ''}`} aria-label="Captain">C</span>}
                </button>
              );
            })}
          </Pitch>
          <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            <span className="tiny" style={{ width: 40, flex: 'none', color: 'var(--muted)', fontWeight: 800 }}>Bench</span>
            {/* the bench in groups: keepers, defenders, midfielders, forwards */}
            {(['GK', 'DEF', 'MID', 'FWD'] as const).map((ln) => {
              const group = bench.filter((p: any) => (p.pos === 'GK' ? 'GK' : LINE[p.pos] || 'MID') === ln);
              if (!group.length) return null;
              return (
                <div key={ln} className="row bench-group" style={{ gap: 4, flex: 'none' }}>
                  <span className="bench-label">{ln}</span>
                  {group.map((p: any) => (
                    <button key={p.id} className={`bench ${sel?.kind === 'bench' && sel.v === p.id ? 'sel' : ''}`} style={{ opacity: out(p) ? 0.5 : 1, width: out(p) ? 72 : 58 }} onClick={() => tapBench(p.id)}>
                      <b>{p.ovr + (p.form || 0)}</b><small>{lastName(p.name)}{out(p) ? ` · ${p.outReason === 'Suspended' ? 'Susp.' : 'Injured'}` : ` · ${p.pos}`}</small>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="tiny muted">{hint}. A red card plays out of position and loses power (−8, or −30 in or out of goal).</div>
        </section>
        <section className="panel cut rise" style={{ gap: 9 }}>
          <div className="row between">
            <span className="tag"><span>Formation</span></span>
            <div className="row" style={{ gap: 8 }}>
              <button onClick={() => setF(-1)} aria-label="Previous formation" style={{ width: 30, height: 30, border: '1px solid rgba(255,255,255,0.25)', fontSize: 16 }}>‹</button>
              <span className="lz" style={{ fontSize: t.formation.length > 5 ? 18 : 22, minWidth: 60, textAlign: 'center', whiteSpace: 'nowrap' }}>{t.formation}</span>
              <button onClick={() => setF(1)} aria-label="Next formation" style={{ width: 30, height: 30, border: '1px solid rgba(255,255,255,0.25)', fontSize: 16 }}>›</button>
            </div>
          </div>
          <span className="tiny muted" style={{ fontWeight: 800 }}>Mentality</span>
          <Seg opts={[[0, 'Defensive'], [1, 'Balanced'], [2, 'Attacking']]} value={t.mentality} onPick={(v) => set(() => setT({ ...t, mentality: v, preset: 'Custom' }))} />
          <span className="tiny muted" style={{ fontWeight: 800 }}>Pressing</span>
          <Seg opts={[[0, 'Low'], [1, 'Mid'], [2, 'High'], [3, 'Gegen']]} value={t.press} onPick={(v) => set(() => setT({ ...t, press: v, preset: 'Custom' }))} />
          <span className="tiny muted" style={{ fontWeight: 800 }}>Passing</span>
          <Seg opts={[[0, 'Short'], [1, 'Mixed'], [2, 'Long']]} value={t.build} onPick={(v) => set(() => setT({ ...t, build: v, preset: 'Custom' }))} />
          <span className="tiny muted" style={{ fontWeight: 800 }}>Captain ©</span>
          <div className="row" style={{ gap: 6 }}>
            {(['c', 'v'] as const).map((k) => (
              <label key={k} className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="tiny muted">{k === 'c' ? 'Captain' : 'Vice'}</span>
                <select className="capsel" value={cap[k] || ''} onChange={(e) => set(() => setCap((x) => { const n = { ...x, [k]: e.target.value || null }; if (n.c && n.c === n.v) n[k === 'c' ? 'v' : 'c'] = null; return n; }))} aria-label={k === 'c' ? 'Captain' : 'Vice-captain'}>
                  <option value="">Auto (best leader)</option>
                  {[...d.players].sort((a: any, b: any) => b.lead - a.lead).map((p: any) => <option key={p.id} value={p.id}>{lastName(p.name)} {stars(p.lead)}</option>)}
                </select>
              </label>
            ))}
          </div>
          {cap.c && !xi.includes(cap.c) && <span className="tiny" style={{ color: '#F2C14E', fontWeight: 800 }}>Your captain is not in the line-up. He will not like it.</span>}
          <span className="tiny muted">★ Leadership. With the armband he keeps heads cool (fewer cards) and drives the team on when it is losing.</span>
          <span className="tiny muted" style={{ fontWeight: 800 }}>Chemistry</span>
          {([['DEF', 'Defence'], ['MID', 'Midfield'], ['FWD', 'Attack']] as const).map(([k, label]) => {
            const v = lc[k], fx = Math.round(((v - 50) / 50) * 2.5 * 10) / 10;
            const col = v >= 70 ? '#2EE6A0' : v >= 45 ? '#F2C14E' : '#FF6B7A';
            return (
              <div key={k} className="row tiny" style={{ gap: 6, fontWeight: 800 }}>
                <span style={{ width: 62 }}>{label}</span>
                <div className="grow" style={{ height: 6, background: 'rgba(255,255,255,0.1)' }}><i style={{ display: 'block', height: '100%', width: `${v}%`, background: col }} /></div>
                <b style={{ width: 22, textAlign: 'right', color: col }}>{v}</b>
                <span className="muted" style={{ width: 30, textAlign: 'right' }}>{fx > 0 ? '+' : ''}{fx}</span>
              </div>
            );
          })}
          <span className="tiny muted">Players who play together (league, cup or friendly) understand each other better. New signings start as strangers.</span
          >
          <button className="ghost" style={{ marginTop: 'auto', borderColor: '#5FD3F3', color: '#5FD3F3' }} onClick={() => go('tactics')}><span>Advanced tactics</span></button>
          <button className={`cta ${dirty ? 'shine' : ''}`} onClick={save} disabled={!dirty}><span>{dirty ? 'Save lineup' : 'Saved'}</span></button>
        </section>
      </div>
    </div>
  );
}
