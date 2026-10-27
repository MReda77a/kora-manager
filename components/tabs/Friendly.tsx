'use client';
// Friendlies: pick a club, play at once, see the result and the stats. It costs stamina and can cost an injury.
import { useEffect, useState } from 'react';
import { api } from '../../lib/client.ts';
import { BackHead, Crest, Spinner } from '../ui.tsx';
import type { TabProps } from './types.ts';

export default function FriendlyTab({ lid, d, reload, toast }: TabProps) {
  const [v, setV] = useState<any>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api(`/api/leagues/${lid}/friendly`).then(setV).catch((e) => toast.bad(e.message));
  useEffect(() => { load(); }, [lid]);
  if (!v) return <Spinner />;
  const play = async () => {
    if (!pick) return;
    setBusy(true);
    try { const r = await api(`/api/leagues/${lid}/friendly`, { opponentId: pick }); setRes(r); load(); reload(); } catch (e: any) { toast.bad(e.message); }
    setBusy(false);
  };
  const club = d.club;
  return (
    <div className="col" style={{ gap: 10 }}>
      <BackHead title="Friendly" sub={<span className="small muted">Play any club now. Only the result and the stats, no live match.</span>} />
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: 12 }}>
        <section className="panel cut col" style={{ gap: 8 }}>
          <span className="tag"><span>Pick an opponent</span></span>
          <div className="col" style={{ gap: 2, maxHeight: 300, overflowY: 'auto' }}>
            {v.clubs.map((c: any) => (
              <button key={c.id} className={`row-item ${pick === c.id ? 'sel' : ''}`} style={{ gap: 8, textAlign: 'left', fontWeight: 800 }} onClick={() => setPick(c.id)}>
                <Crest c1={c.color1} c2={c.color2} shape={c.shape} emblem={c.human ? c.emblem : -1} short={c.short} size={22} />
                <span className="grow ellipsis">{c.name}</span>
                {c.human && <span className="tag cyan" style={{ height: 16, fontSize: 9 }}><span>MGR</span></span>}
                <span className="tiny muted">Div {c.division}</span>
                <b className="lz" style={{ width: 26, textAlign: 'right' }}>{c.strength ?? '–'}</b>
              </button>
            ))}
          </div>
          <span className="tiny" style={{ color: '#F2C14E', fontWeight: 800 }}>⚠ One friendly between match days. Your players lose stamina and build chemistry. Injuries are rare and mostly small knocks. Their club is not affected.</span>
          <button className="cta shine" disabled={!pick || busy} onClick={play}><span>{busy ? 'Playing…' : 'Play the friendly'}</span></button>
        </section>
        <section className="panel cut col" style={{ gap: 8 }}>
          {res ? <Result r={res} club={club} /> : (
            <>
              <span className="tag"><span>Recent friendlies</span></span>
              {v.recent.length === 0 && <span className="small muted">No friendlies yet. Try a new plan or give the bench some minutes.</span>}
              {v.recent.map((r: any, i: number) => (
                <button key={i} className="row-item" style={{ gap: 8, fontWeight: 800, textAlign: 'left' }} onClick={() => setRes(r)}>
                  <span className="grow ellipsis">vs {r.opp.name}</span>
                  <b className="lz" style={{ fontSize: 18, color: r.score[0] > r.score[1] ? '#7CE3A1' : r.score[0] < r.score[1] ? '#FF8A80' : undefined }}>{r.score[0]} – {r.score[1]}</b>
                </button>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Result({ r, club }: { r: any; club: any }) {
  const s = r.stats;
  const outcome = r.score[0] > r.score[1] ? 'WIN' : r.score[0] < r.score[1] ? 'LOSS' : 'DRAW';
  const row = (label: string, a: number | string, b: number | string) => (
    <div className="row small" style={{ fontWeight: 800 }}><b style={{ width: 50 }}>{a}</b><span className="grow muted" style={{ textAlign: 'center' }}>{label}</span><b style={{ width: 50, textAlign: 'right' }}>{b}</b></div>
  );
  return (
    <div className="col" style={{ gap: 8, animation: 'fadeUp .4s both' }}>
      <div className="row between"><span className="tag gold"><span>Friendly · full time</span></span><span className="tiny" style={{ fontWeight: 900, color: outcome === 'WIN' ? '#7CE3A1' : outcome === 'LOSS' ? '#FF8A80' : '#C9C0EC' }}>{outcome}</span></div>
      <div className="row center" style={{ gap: 12 }}>
        <span className="lz ellipsis" style={{ fontSize: 18, maxWidth: 140 }}>{club.name}</span>
        <span className="lz" style={{ fontSize: 40, animation: 'pop .5s both' }}>{r.score[0]} – {r.score[1]}</span>
        <span className="lz ellipsis" style={{ fontSize: 18, maxWidth: 140 }}>{r.opp.name}</span>
      </div>
      {r.goals.length > 0 && (
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <div className="col grow tiny" style={{ gap: 2 }}>{r.goals.filter((g: any) => g.side === 0).map((g: any, i: number) => <span key={i}>⚽ {g.name} {g.m}'</span>)}</div>
          <div className="col grow tiny" style={{ gap: 2, textAlign: 'right' }}>{r.goals.filter((g: any) => g.side === 1).map((g: any, i: number) => <span key={i}>{g.m}' {g.name} ⚽</span>)}</div>
        </div>
      )}
      {row('Possession', `${s.poss[0]}%`, `${s.poss[1]}%`)}
      {row('Shots', s.shots[0], s.shots[1])}
      {row('On target', s.onTarget[0], s.onTarget[1])}
      {row('xG', s.xg[0], s.xg[1])}
      {row('Cards', `${s.yellows[0]}🟨 ${s.reds[0] ? s.reds[0] + '🟥' : ''}`, `${s.yellows[1]}🟨 ${s.reds[1] ? s.reds[1] + '🟥' : ''}`)}
      {row('Plan', r.tactics[0], r.tactics[1])}
      <div className="small" style={{ fontWeight: 800 }}>Stamina: <b style={{ color: '#F2C14E' }}>{r.fitness.before}% → {r.fitness.after}%</b>{r.motm ? ` · Player of the match: ${r.motm}` : ''}</div>
      {r.injured.length > 0 && <div className="small" style={{ fontWeight: 800, color: '#FF8A80' }}>✚ Injured: {r.injured.join(', ')}</div>}
      <div className="tiny muted">Best ratings: {r.ratings.slice(0, 3).map((p: any) => `${p.name.split(' ').slice(-1)[0]} ${p.r}`).join(' · ')}</div>
    </div>
  );
}
