'use client';
import { useState } from 'react';
import { api } from '../lib/client.ts';
import { CLUB_TYPES, PATTERNS, shortName, type ClubTypeKey } from '../lib/game.ts';
import { COLORS, Crest, EMBLEM_NAMES, Kit, SHAPE_NAMES, useToast } from './ui.tsx';

const TYPE_COLOR: Record<ClubTypeKey, string> = { fan: '#E8438C', invest: '#F2C14E', academy: '#7CE3A1', commercial: '#7FE9F7', historic: '#C5B3FF' };

export default function CreateClub({ league, onDone }: { league: any; onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: '', short: '', stadium: '', shape: 0, emblem: 0, color1: COLORS[0], color2: COLORS[5], away1: '#F3EEFF', away2: COLORS[0], pattern: 0, type: 'fan' as ClubTypeKey });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const T = CLUB_TYPES[f.type];
  const name = f.name.trim() || 'Your club';
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/leagues/${league.id}/club`, { ...f, short: f.short || shortName(f.name) });
      onDone();
    } catch (e: any) {
      toast.bad(e.message);
      setBusy(false);
    }
  };
  return (
    <div style={{ minHeight: '100dvh', padding: '10px 16px 20px' }}>
      <header className="row between" style={{ height: 48 }}>
        <div className="col" style={{ gap: 0 }}>
          <span className="lz" style={{ fontSize: 22 }}>Create your club</span>
          <span className="tiny muted">{league.name} · {league.poolName}</span>
        </div>
        <div className="row">
          <button className={`chip ${step === 0 ? 'on' : ''}`} onClick={() => setStep(0)}><span>1 · Identity</span></button>
          <button className={`chip ${step === 1 ? 'on' : ''}`} onClick={() => setStep(1)}><span>2 · Club type</span></button>
        </div>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 230px) 1fr', gap: 12, marginTop: 6 }}>
        <div className="glass cut pad col" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <div style={{ animation: 'pop .5s both' }} key={`${f.shape}${f.emblem}${f.color1}${f.color2}`}>
            <Crest c1={f.color1} c2={f.color2} shape={f.shape} emblem={f.emblem} size={96} />
          </div>
          <div className="lz" style={{ fontSize: 22, lineHeight: 1.1 }}>{name}</div>
          <div className="tag"><span>{(f.short || shortName(f.name || 'Club')).toUpperCase()}</span></div>
          <div className="tiny muted">{(f.stadium.trim() || `${name} Park`)} · Home ground</div>
          <div className="row" style={{ gap: 14 }}>
            <div className="col" style={{ alignItems: 'center', gap: 0 }}><Kit c1={f.color1} c2={f.color2} pattern={f.pattern} size={44} label="Home kit" /><span className="tiny muted">Home</span></div>
            <div className="col" style={{ alignItems: 'center', gap: 0 }}><Kit c1={f.away1} c2={f.away2} size={44} label="Away kit" /><span className="tiny muted">Away</span></div>
          </div>
          <div className="tag" style={{ background: TYPE_COLOR[f.type], color: '#1B1048' }}><span>{T.name}</span></div>
        </div>
        {step === 0 ? (
          <div className="glass cut pad col" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="col grow" style={{ gap: 4, minWidth: 160 }}><span className="small muted">Club name</span><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={28} placeholder="Red Eagles" /></label>
              <label className="col" style={{ gap: 4, width: 90 }}><span className="small muted">Short</span><input value={f.short} onChange={(e) => set('short', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3))} placeholder={shortName(f.name || 'Club')} /></label>
              <label className="col grow" style={{ gap: 4, minWidth: 160 }}><span className="small muted">Stadium</span><input value={f.stadium} onChange={(e) => set('stadium', e.target.value)} maxLength={32} placeholder={`${name} Park`} /></label>
            </div>
            <div className="row wrap"><span className="small muted" style={{ width: 70 }}>Shape</span>{SHAPE_NAMES.map((s, i) => <button key={s} className={`chip ${f.shape === i ? 'on' : ''}`} onClick={() => set('shape', i)}><span>{s}</span></button>)}</div>
            <div className="row wrap"><span className="small muted" style={{ width: 70 }}>Emblem</span>{EMBLEM_NAMES.map((s, i) => <button key={s} className={`chip ${f.emblem === i ? 'on' : ''}`} onClick={() => set('emblem', i)}><span>{s}</span></button>)}</div>
            <div className="row wrap"><span className="small muted" style={{ width: 70 }}>Shirt</span>{PATTERNS.map((s, i) => <button key={s} className={`chip ${f.pattern === i ? 'on' : ''}`} onClick={() => set('pattern', i)}><span>{s}</span></button>)}</div>
            {(['color1', 'color2', 'away1', 'away2'] as const).map((k, j) => (
              <div key={k} className="row wrap"><span className="small muted" style={{ width: 70 }}>{['Main', 'Second', 'Away', 'Away 2nd'][j]}</span>
                {COLORS.map((c) => <button key={c} aria-label={c} onClick={() => set(k, c)} style={{ width: 28, height: 28, background: c, boxShadow: f[k] === c ? '0 0 0 2px #1E1250, 0 0 0 4px #F3EEFF' : 'inset 0 0 0 1px rgba(255,255,255,0.25)' }} />)}
              </div>
            ))}
            <button className="cta" style={{ alignSelf: 'flex-end' }} disabled={f.name.trim().length < 3} onClick={() => setStep(1)}><span>Next: club type</span></button>
          </div>
        ) : (
          <div className="glass cut pad col" style={{ gap: 10 }}>
            <div className="row wrap">
              {(Object.keys(CLUB_TYPES) as ClubTypeKey[]).map((k) => (
                <button key={k} onClick={() => set('type', k)} className="col" style={{ gap: 0, padding: '6px 12px', alignItems: 'flex-start', background: f.type === k ? 'rgba(232,67,140,0.25)' : 'rgba(255,255,255,0.07)', boxShadow: f.type === k ? `inset 0 0 0 2px ${TYPE_COLOR[k]}` : undefined }}>
                  <b>{CLUB_TYPES[k].name}</b><span className="tiny muted">{CLUB_TYPES[k].coins} coins · {CLUB_TYPES[k].money}M</span>
                </button>
              ))}
            </div>
            <div className="grid2" style={{ gap: 8 }}>
              <Info label="Perk" text={T.perk} color="#7CE3A1" />
              <Info label="Weakness" text={T.weak} color="#FF9AA8" />
              <Info label="Board target" text={T.board} color={TYPE_COLOR[f.type]} />
              <Info label="Sponsor target" text={T.sponsor} color="#7FE9F7" />
            </div>
            {f.type === 'fan' && <div className="small" style={{ padding: '6px 10px', background: 'rgba(242,193,78,0.14)', color: '#F2C14E' }}>If another manager here is also a Fan Club, your games against them become the derby, with a gold match day.</div>}
            <button className="cta shine" style={{ alignSelf: 'flex-end' }} disabled={busy || f.name.trim().length < 3} onClick={save}><span>Create {name}</span></button>
          </div>
        )}
      </div>
      {toast.node}
    </div>
  );
}

function Info({ label, text, color }: { label: string; text: string; color: string }) {
  return (
    <div className="col" style={{ gap: 2, padding: '6px 10px', background: 'rgba(10,4,30,0.3)', borderLeft: `3px solid ${color}` }}>
      <span className="tiny" style={{ color, fontWeight: 900 }}>{label.toUpperCase()}</span>
      <span className="small">{text}</span>
    </div>
  );
}
