'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/client.ts';
import { FORMATIONS, LINE, PRESETS, TACTIC_FIELDS, stripDesc, type Tactic } from '../lib/game.ts';
import { FitBar, MiniCard, PlayerCard, Spinner, useToast } from './ui.tsx';

const ASSIST = [
  ['tired', 'Sub tired players after 60\''],
  ['cards', 'Protect booked defenders'],
  ['losing', 'Go all out when losing after 60\''],
  ['winning', 'Sit back when winning after 75\''],
] as const;

function autoXI(players: any[], formation: string, nextMd: number) {
  const slots = FORMATIONS[formation].slots;
  const avail = players.filter((p) => !(p.outUntil >= nextMd));
  const used = new Set<string>();
  const xi: string[] = slots.map(() => '');
  for (const strict of [true, false]) {
    slots.forEach((s, i) => {
      if (xi[i]) return;
      const best = avail.filter((p) => !used.has(p.id) && (!strict || (LINE[p.pos] || 'MID') === s)).sort((a, b) => b.ovr * (0.6 + 0.4 * b.fitness / 100) - a.ovr * (0.6 + 0.4 * a.fitness / 100))[0];
      if (best) { used.add(best.id); xi[i] = best.id; }
    });
  }
  return xi;
}

export default function TacticsTab({ lid, toast }: { lid: number; toast: ReturnType<typeof useToast> }) {
  const [d, setD] = useState<any>(null);
  const [t, setT] = useState<Tactic | null>(null);
  const [xi, setXi] = useState<string[]>([]);
  const [pens, setPens] = useState<string[]>([]);
  const [as, setAs] = useState<Record<string, boolean>>({});
  const [slot, setSlot] = useState<number | null>(null);
  const [panel, setPanel] = useState<'style' | 'pens' | 'assistant'>('style');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    api(`/api/leagues/${lid}/squad`).then((r) => {
      setD(r);
      const tac = r.club.tactic?.formation ? r.club.tactic : { preset: 'Wing play', formation: '4-3-3', ...stripDesc(PRESETS['Wing play']) };
      setT(tac);
      const saved: string[] = r.club.lineup || [];
      const ids = new Set(r.players.map((p: any) => p.id));
      const ok = saved.length === 11 && saved.every((x) => ids.has(x));
      setXi(ok ? saved : autoXI(r.players, tac.formation, r.nextMatchday));
      setPens(r.club.pens || []);
      setAs(r.club.assistant || {});
    });
  }, [lid]);
  const byId = useMemo(() => new Map((d?.players || []).map((p: any) => [p.id, p])), [d]);
  if (!d || !t) return <Spinner />;
  const F = FORMATIONS[t.formation];
  const change = (fn: () => void) => { fn(); setDirty(true); };
  const setField = (k: keyof Tactic, v: number) => change(() => setT({ ...t, [k]: v, preset: 'Custom' }));
  const setPreset = (name: string) => change(() => setT({ ...t, preset: name, ...stripDesc(PRESETS[name]) }));
  const setFormation = (f: string) => change(() => { setT({ ...t, formation: f }); setXi(autoXI(d.players, f, d.nextMatchday)); });
  const pick = (pid: string) => {
    if (slot === null) return;
    change(() => {
      const next = [...xi];
      const at = next.indexOf(pid);
      if (at >= 0) next[at] = next[slot];
      next[slot] = pid;
      setXi(next);
      setSlot(null);
    });
  };
  const togglePen = (pid: string) => change(() => setPens(pens.includes(pid) ? pens.filter((x) => x !== pid) : pens.length < 5 ? [...pens, pid] : pens));
  const save = async () => {
    try {
      await api(`/api/leagues/${lid}/setup`, { tactic: t, lineup: xi, pens, assistant: as });
      setDirty(false);
      toast.ok('Tactics saved for the next match');
    } catch (e: any) { toast.bad(e.message); }
  };
  const bench = d.players.filter((p: any) => !xi.includes(p.id));
  const out = (p: any) => p.outUntil >= d.nextMatchday;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(250px, 1fr)', gap: 12 }}>
      <div className="col" style={{ gap: 8 }}>
        <div className="row wrap">
          {Object.keys(FORMATIONS).map((f) => <button key={f} className={`chip ${t.formation === f ? 'on' : ''}`} onClick={() => setFormation(f)}><span>{f}</span></button>)}
          <button className="chip" onClick={() => change(() => setXi(autoXI(d.players, t.formation, d.nextMatchday)))}><span>Auto pick</span></button>
        </div>
        <div className="pitch" style={{ width: '100%', aspectRatio: '1.65' }}>
          <div className="box" style={{ left: 0, borderLeft: 'none' }} />
          <div className="box" style={{ right: 0, borderRight: 'none' }} />
          {F.xy.map(([x, y], i) => {
            const p: any = byId.get(xi[i]);
            const wrong = p && (LINE[p.pos] || 'MID') !== F.slots[i];
            return (
              <button key={i} onClick={() => setSlot(slot === i ? null : i)}
                style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                {p ? <MiniCard p={p} selected={slot === i} dim={out(p)} /> : <div style={{ width: 54, height: 36, background: 'rgba(255,255,255,0.2)', outline: slot === i ? '3px solid #7FE9F7' : undefined }} />}
                <span style={{ fontSize: 9, background: wrong ? '#FF6B7A' : 'rgba(10,4,30,0.6)', padding: '0 4px', fontWeight: 800, whiteSpace: 'nowrap' }}>{p ? p.pos : F.slots[i]}{p && pens.includes(p.id) ? ` · P${pens.indexOf(p.id) + 1}` : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="tiny muted">{slot === null ? 'Tap a position on the pitch, then tap a player below to put him there. Red label = playing out of position (weaker).' : `Choose a player for the ${F.slots[slot]} spot:`}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: 6 }}>
          {(slot === null ? bench : [...bench].sort((a: any, b: any) => Number((LINE[b.pos] || 'MID') === F.slots[slot]) - Number((LINE[a.pos] || 'MID') === F.slots[slot]) || b.ovr - a.ovr)).map((p: any) => (
            <div key={p.id} className="col" style={{ gap: 2, opacity: out(p) ? 0.4 : 1 }}>
              <PlayerCard p={p} onClick={() => pick(p.id)} />
              <FitBar v={p.fitness} />
            </div>
          ))}
        </div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <div className="row">
          {(['style', 'pens', 'assistant'] as const).map((k) => <button key={k} className={`chip ${panel === k ? 'on' : ''}`} onClick={() => setPanel(k)}><span>{k === 'style' ? 'Game plan' : k === 'pens' ? 'Penalties' : 'Assistant'}</span></button>)}
        </div>
        {panel === 'style' && (
          <div className="glass cut pad col" style={{ gap: 8 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {Object.keys(PRESETS).map((n) => <button key={n} className={`chip ${t.preset === n ? 'on' : ''}`} onClick={() => setPreset(n)}><span>{n}</span></button>)}
            </div>
            <div className="tiny muted" style={{ minHeight: 16 }}>{PRESETS[t.preset]?.desc || 'Custom plan. Every setting changes how you attack and defend.'}</div>
            {TACTIC_FIELDS.map((fd) => (
              <div key={fd.key} className="row" style={{ gap: 6 }}>
                <span className="tiny muted" style={{ width: 84, flex: 'none' }}>{fd.label}</span>
                <div className="row wrap" style={{ gap: 4 }}>
                  {fd.opts.map((o, i) => <button key={o} className={`chip ${(t[fd.key] as number) === i ? 'on' : ''}`} style={{ height: 26, padding: '0 8px', fontSize: 11 }} onClick={() => setField(fd.key, i)}><span>{o}</span></button>)}
                </div>
              </div>
            ))}
            <div className="tiny dim">High press wins the ball high but tires legs. A high line is open to pace and through balls. A deep block kills through balls but invites crosses and long shots. Read your opponent.</div>
          </div>
        )}
        {panel === 'pens' && (
          <div className="glass cut pad col" style={{ gap: 6 }}>
            <div className="small muted">Pick up to 5 takers in order. They also take penalties during the match.</div>
            {xi.map((id) => byId.get(id) as any).filter(Boolean).filter((p: any) => p.pos !== 'GK').sort((a: any, b: any) => (b.attrs.Finishing + b.attrs.Composure) - (a.attrs.Finishing + a.attrs.Composure)).map((p: any) => {
              const n = pens.indexOf(p.id);
              return (
                <button key={p.id} className="row small" onClick={() => togglePen(p.id)} style={{ padding: '4px 8px', background: n >= 0 ? 'rgba(232,67,140,0.22)' : 'rgba(255,255,255,0.05)', textAlign: 'left' }}>
                  <b style={{ width: 22, color: '#F2C14E' }}>{n >= 0 ? n + 1 : ''}</b>
                  <span className="grow ellipsis">{p.name}</span>
                  <span className="tiny muted">FIN {p.attrs.Finishing} · COM {p.attrs.Composure}</span>
                </button>
              );
            })}
          </div>
        )}
        {panel === 'assistant' && (
          <div className="glass cut pad col" style={{ gap: 8 }}>
            <div className="small muted">When you skip or are not watching, your assistant follows these rules during the match.</div>
            {ASSIST.map(([k, l]) => (
              <button key={k} className="row small" onClick={() => change(() => setAs({ ...as, [k]: !as[k] }))} style={{ textAlign: 'left' }}>
                <span style={{ width: 38, height: 20, background: as[k] ? '#7CE3A1' : 'rgba(255,255,255,0.15)', position: 'relative', flex: 'none', transform: 'skewX(-12deg)' }}>
                  <i style={{ position: 'absolute', top: 2, left: as[k] ? 20 : 2, width: 16, height: 16, background: '#fff', transition: 'left .2s' }} />
                </span>
                {l}
              </button>
            ))}
          </div>
        )}
        <button className={`cta ${dirty ? 'shine' : ''}`} onClick={save} disabled={!dirty}><span>{dirty ? 'Save for next match' : 'Saved'}</span></button>
      </div>
    </div>
  );
}
