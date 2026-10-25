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
};
export function Icon({ name, size = 22, color = 'currentColor' }: { name: string; size?: number; color?: string }) {
  const filled = ['home', 'squad', 'play'].includes(name);
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
