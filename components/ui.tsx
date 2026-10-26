'use client';
import { useEffect, useState } from 'react';
import { shirt, tier } from '../lib/client.ts';

export const SHAPES = ['M20 1L37 6V20C37 30 29 36 20 39 11 36 3 30 3 20V6z', 'M20 1l17 10v18L20 39 3 29V11z', 'M20 1a19 19 0 110 38 19 19 0 010-38z', 'M20 0L40 20 20 40 0 20z'];
export const SHAPE_NAMES = ['Shield', 'Hex', 'Round', 'Diamond'];
export const EMBLEMS = [
  'M20 10l2.9 6.2 6.8.8-5 4.6 1.3 6.7L20 25l-6 3.3 1.3-6.7-5-4.6 6.8-.8z',
  'M11 27V15l4.5 4L20 11l4.5 8 4.5-4v12z',
  'M23 8l-9 14h6l-3 10 9-14h-6z',
  'M20 11a9 9 0 110 18 9 9 0 010-18zm0 4l-3.5 2.6 1.3 4.1h4.4l1.3-4.1z',
  'M20 28L8 15l6 1.5 6 5.5 6-5.5 6-1.5z',
  'M11 25L20 12l9 13-9-4z',
];
export const EMBLEM_NAMES = ['Star', 'Crown', 'Bolt', 'Ball', 'Wings', 'Eagle'];
export const COLORS = ['#C93A4A', '#E8438C', '#3651C9', '#1F9D55', '#F2C14E', '#F3EEFF', '#151018', '#7FE9F7', '#EE7650', '#7A5BD6'];

export function Crest({ c1 = '#E8438C', c2 = '#F3EEFF', shape = 0, emblem = 0, size = 40, short }: { c1?: string; c2?: string; shape?: number; emblem?: number; size?: number; short?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={SHAPES[shape % 4]} fill={c2} />
      <g transform="translate(20 20) scale(0.86) translate(-20 -20)">
        <path d={SHAPES[shape % 4]} fill={c1} />
      </g>
      {short && emblem < 0 ? (
        <text x="20" y="25" textAnchor="middle" fontSize="11" fontWeight="900" fill={c2}>{short}</text>
      ) : (
        <path d={EMBLEMS[Math.abs(emblem) % EMBLEMS.length]} fill={c2} />
      )}
    </svg>
  );
}

export type P = { id: string; name: string; pos: string; ovr: number; age?: number; nat?: string; foot?: string; fitness?: number; outUntil?: number; outReason?: string | null; attrs?: Record<string, number> };

export function PlayerCard({ p, style, onClick, selected, badge }: { p: P; style?: React.CSSProperties; onClick?: () => void; selected?: boolean; badge?: React.ReactNode }) {
  const last = p.name.split(' ').slice(-1)[0];
  return (
    <div
      className={`pcard ${tier(p.ovr)}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined, outline: selected ? '3px solid #7FE9F7' : undefined, ...style }}
    >
      <div className="no">{shirt(p.id, p.pos)}</div>
      <div style={{ position: 'relative' }}>
        <div className="ovr">{p.ovr}</div>
        <div className="pos">{p.pos}</div>
      </div>
      {badge && <div style={{ position: 'absolute', top: 6, right: 7 }}>{badge}</div>}
      <div className="nm ellipsis">{last}</div>
    </div>
  );
}

export function FitBar({ v }: { v: number }) {
  const c = v >= 80 ? '#7CE3A1' : v >= 60 ? '#F2C14E' : '#FF6B7A';
  return (
    <div className="bar" style={{ maxWidth: 60, height: 5 }}>
      <i style={{ width: `${Math.max(4, v)}%`, background: c }} />
    </div>
  );
}

export function Toast({ msg, bad, onDone }: { msg: string; bad?: boolean; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  return <div className={`toast ${bad ? 'bad' : ''}`} role="status">{msg}</div>;
}

export function useToast() {
  const [t, setT] = useState<{ msg: string; bad?: boolean } | null>(null);
  const node = t ? <Toast msg={t.msg} bad={t.bad} onDone={() => setT(null)} /> : null;
  return { node, ok: (msg: string) => setT({ msg }), bad: (msg: string) => setT({ msg, bad: true }) };
}

export function Coin({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#F2C14E" /><circle cx="10" cy="10" r="6" fill="none" stroke="#B5860A" strokeWidth="1.5" /></svg>
  );
}
export function Cash({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1l8 6-8 12L2 7z" fill="#7FE9F7" /><path d="M2 7h16" stroke="#E6FDFF" strokeWidth="1" /></svg>
  );
}

const ICONS: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z',
  squad: 'M8 11a3.5 3.5 0 110-7 3.5 3.5 0 010 7zm8 0a3 3 0 110-6 3 3 0 010 6zM2 20c0-3.5 2.7-6 6-6s6 2.5 6 6zm12.5 0c0-2-.6-3.8-1.7-5.1.9-.6 2-.9 3.2-.9 3 0 5 2.2 5 6z',
  tactics: 'M4 4h16v16H4zM12 4v16M4 12h4M16 12h4M8 8l2 2M8 10l2-2M15 15l2 2M15 17l2-2',
  store: 'M4 8h16l-1 12H5zM8 8V6a4 4 0 018 0v2',
  market: 'M4 7h13l-3-3M20 17H7l3 3',
  table: 'M4 5h16M4 10h16M4 15h16M4 20h16',
  fixtures: 'M5 5h14v15H5zM5 9h14M9 3v4M15 3v4',
  stats: 'M5 20V10M10 20V4M15 20v-7M20 20v-11',
  back: 'M15 5l-7 7 7 7',
  play: 'M7 4l13 8-13 8z',
  lineup: 'M4 4h16v16H4zM12 4v16M8 9h.01M16 9h.01M8 15h.01M16 15h.01',
  training: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12',
  condition: 'M3 12h4l2-5 4 10 2-5h6',
  office: 'M4 21V7l8-4 8 4v14M9 21v-6h6v6M9 10h.01M15 10h.01',
  cup: 'M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 21h8M10 17h4',
  paper: 'M5 4h12v16H7a2 2 0 01-2-2zM17 8h2v10a2 2 0 01-2 2M8 8h6M8 12h6M8 16h4',
  awards: 'M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.4 6.7 19l1-5.8L3.5 9.2l5.9-.9z',
  players: 'M9 7a3 3 0 106 0 3 3 0 00-6 0M5 21v-2a5 5 0 015-5h4a5 5 0 015 5v2',
  bell: 'M6 16V11a6 6 0 0112 0v5l1.5 2h-15zM10 20a2 2 0 004 0',
};
export function Icon({ name, size = 22, color = 'currentColor' }: { name: string; size?: number; color?: string }) {
  const filled = ['home', 'squad', 'play', 'awards'].includes(name);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={filled ? color : 'none'} stroke={filled ? 'none' : color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Spinner() {
  return <div className="lz" style={{ padding: 30, textAlign: 'center', color: '#B4A8E0', animation: 'pulse 1.2s infinite' }}>Loading…</div>;
}

export function MiniCard({ p, selected, dim }: { p: P; selected?: boolean; dim?: boolean }) {
  const last = p.name.split(' ').slice(-1)[0];
  return (
    <div className={`pcard ${tier(p.ovr)}`} style={{ aspectRatio: 'auto', width: 'auto', padding: '3px 6px 4px', clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)', outline: selected ? '3px solid #7FE9F7' : undefined, opacity: dim ? 0.45 : 1, alignItems: 'center', gap: 0, minWidth: 54 }}>
      <span className="lz" style={{ fontSize: 17, lineHeight: 1 }}>{p.ovr}</span>
      <span style={{ fontSize: 10, fontWeight: 900, maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{last}</span>
    </div>
  );
}

export function BackHead({ title, sub, onBack, href, right, tag }: { title: string; sub?: React.ReactNode; onBack?: () => void; href?: string; right?: React.ReactNode; tag?: React.ReactNode }) {
  const arrow = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F3EEFF" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;
  return (
    <header className="row between" style={{ minHeight: 44, flex: 'none', gap: 12 }}>
      <div className="row" style={{ gap: 12, minWidth: 0 }}>
        {href ? <a className="back" href={href} aria-label="Back">{arrow}</a> : onBack ? <button className="back" onClick={onBack} aria-label="Back">{arrow}</button> : null}
        <span className="lz" style={{ fontSize: 24, whiteSpace: 'nowrap', flex: 'none' }}>{title}</span>
        {tag}
        {sub && <span className="small muted ellipsis" style={{ fontWeight: 700 }}>{sub}</span>}
      </div>
      {right && <div className="row" style={{ gap: 8, flex: 'none' }}>{right}</div>}
    </header>
  );
}

export function Ring({ v, size = 64, color = '#E8438C', track = 'rgba(255,255,255,0.12)', label, font = 22 }: { v: number; size?: number; color?: string; track?: string; label?: React.ReactNode; font?: number }) {
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, v / 100)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .8s' }} />
      </svg>
      <span style={{ fontSize: font }}>{label ?? Math.round(v)}</span>
    </div>
  );
}

export function Seg<T extends string | number>({ opts, value, onPick, small }: { opts: [T, string][]; value: T; onPick: (v: T) => void; small?: boolean }) {
  return (
    <div className="segrow">
      {opts.map(([v, t]) => (
        <button key={String(v)} className={`seg ${value === v ? 'on' : ''}`} style={small ? { minHeight: 26, fontSize: 11, padding: '0 8px' } : undefined} onClick={() => onPick(v)}><span>{t}</span></button>
      ))}
    </div>
  );
}

export function Bar({ v, color = '#7FE9F7', h = 6, max = 100 }: { v: number; color?: string; h?: number; max?: number }) {
  return <div className="bar" style={{ height: h }}><i style={{ width: `${Math.max(2, Math.min(100, (v / max) * 100))}%`, background: color }} /></div>;
}

export function Stars({ n }: { n: number }) {
  return <span className="stars">{'★'.repeat(n)}<span style={{ opacity: 0.25 }}>{'★'.repeat(Math.max(0, 5 - n))}</span></span>;
}

export const lastName = (n: string) => n.split(' ').slice(-1)[0];
