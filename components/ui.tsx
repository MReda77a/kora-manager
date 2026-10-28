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
        <>
          {/* AI clubs: each gets its own crest design from its initials */}
          <clipPath id={`cr${short}${shape}`}><g transform="translate(20 20) scale(0.86) translate(-20 -20)"><path d={SHAPES[shape % 4]} /></g></clipPath>
          <g clipPath={`url(#cr${short}${shape})`} opacity="0.3" fill={c2}>
            {[null, <rect key="b" x="0" y="15" width="40" height="11" />, <path key="s" d="M0 30L30 0h10L0 40z" />, <><rect key="v1" x="9" y="0" width="5" height="40" /><rect key="v2" x="26" y="0" width="5" height="40" /></>, <path key="c" d="M20 4l3 6 6 1-4.5 4 1 6.5L20 18l-5.5 3.5 1-6.5L11 11l6-1z" />][short.split('').reduce((h, ch) => h + ch.charCodeAt(0), 0) % 5]}
          </g>
          <text x="20" y="25" textAnchor="middle" fontSize="11" fontWeight="900" fill={c2}>{short}</text>
        </>
      ) : (
        <path d={EMBLEMS[Math.abs(emblem) % EMBLEMS.length]} fill={c2} />
      )}
    </svg>
  );
}

export type P = { id: string; num?: number | null; name: string; pos: string; ovr: number; age?: number; nat?: string; foot?: string; fitness?: number; outUntil?: number; outReason?: string | null; attrs?: Record<string, number> };

export function PlayerCard({ p, style, onClick, selected, badge }: { p: P; style?: React.CSSProperties; onClick?: () => void; selected?: boolean; badge?: React.ReactNode }) {
  const last = p.name.split(' ').slice(-1)[0];
  return (
    <div
      className={`pcard ${tier(p.ovr)}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined, outline: selected ? '3px solid #5FD3F3' : undefined, ...style }}
    >
      <div className="no">{p.num ?? shirt(p.id, p.pos)}</div>
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
  const c = v >= 80 ? '#2EE6A0' : v >= 60 ? '#F2C14E' : 'var(--red)';
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
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1l8 6-8 12L2 7z" fill="#5FD3F3" /><path d="M2 7h16" stroke="#E6FDFF" strokeWidth="1" /></svg>
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
  history: 'M3 12a9 9 0 103-6.7M3 4v4h4M12 7v5l3 2',
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

// While a screen loads: a faded outline of a screen instead of a "Loading…" word.
export function Spinner() {
  return (
    <div className="col" style={{ gap: 10, padding: '6px 0' }} aria-busy="true" aria-label="Loading">
      <div className="row" style={{ gap: 10 }}><i className="sk" style={{ width: 160, height: 26 }} /><i className="sk" style={{ width: 90, height: 18 }} /></div>
      <div className="split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(200px, 260px)', gap: 12 }}>
        <div className="col" style={{ gap: 6 }}>{[0, 1, 2, 3, 4].map((i) => <i key={i} className="sk" style={{ height: 34, animationDelay: `${i * 0.08}s` }} />)}</div>
        <i className="sk" style={{ height: 190 }} />
      </div>
    </div>
  );
}
export function MiniCard({ p, selected, dim }: { p: P; selected?: boolean; dim?: boolean }) {
  const last = p.name.split(' ').slice(-1)[0];
  return (
    <div className={`pcard ${tier(p.ovr)}`} style={{ aspectRatio: 'auto', width: 'auto', padding: '3px 6px 4px', clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)', outline: selected ? '3px solid #5FD3F3' : undefined, opacity: dim ? 0.45 : 1, alignItems: 'center', gap: 0, minWidth: 54 }}>
      <span className="lz" style={{ fontSize: 17, lineHeight: 1 }}>{p.ovr}</span>
      <span style={{ fontSize: 11, fontWeight: 900, maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{last}</span>
    </div>
  );
}

export function BackHead({ title, sub, onBack, href, right, tag }: { title: string; sub?: React.ReactNode; onBack?: () => void; href?: string; right?: React.ReactNode; tag?: React.ReactNode }) {
  const arrow = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E8F1FA" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;
  return (
    <header className="row between backhead" style={{ minHeight: 44, flex: 'none', gap: 12, flexWrap: 'wrap', rowGap: 6 }}>
      <div className="row" style={{ gap: 12, minWidth: 0, flex: '1 1 auto' }}>
        {href ? <a className="back" href={href} aria-label="Back">{arrow}</a> : onBack ? <button className="back" onClick={onBack} aria-label="Back">{arrow}</button> : null}
        <span className="lz" style={{ fontSize: 24, whiteSpace: 'nowrap', flex: 'none' }}>{title}</span>
        {tag}
        {sub && <span className="small muted" style={{ fontWeight: 700, minWidth: 0 }}>{sub}</span>}
      </div>
      {right && <div className="row" style={{ gap: 8, flex: '0 1 auto', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto', rowGap: 6 }}>{right}</div>}
    </header>
  );
}

export function Ring({ v, size = 64, color = '#2EE6A0', track = 'rgba(255,255,255,0.12)', label, font = 22 }: { v: number; size?: number; color?: string; track?: string; label?: React.ReactNode; font?: number }) {
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

export function Bar({ v, color = '#5FD3F3', h = 6, max = 100 }: { v: number; color?: string; h?: number; max?: number }) {
  return <div className="bar" style={{ height: h }}><i style={{ width: `${Math.max(2, Math.min(100, (v / max) * 100))}%`, background: color }} /></div>;
}

export function Stars({ n }: { n: number }) {
  return <span className="stars">{'★'.repeat(n)}<span style={{ opacity: 0.25 }}>{'★'.repeat(Math.max(0, 5 - n))}</span></span>;
}

export const lastName = (n: string) => n.split(' ').slice(-1)[0];

// A football shirt in a club's colours. pattern: 0 plain, 1 stripes, 2 halves, 3 hoops, 4 sash.
export function Kit({ c1, c2, pattern = 0, size = 40, label }: { c1: string; c2: string; pattern?: number; size?: number; label?: string }) {
  const id = `k${(c1 + c2 + pattern).replace(/[^a-z0-9]/gi, '')}`;
  const body = 'M14 6l6-3h8l6 3 9 6-5 8-5-3v24H14V17l-5 3-5-8z';
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 48 44" aria-label={label} role={label ? 'img' : undefined}>
      <defs><clipPath id={id}><path d={body} /></clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <rect width="48" height="44" fill={c1} />
        {pattern === 1 && [12, 20, 28, 36].map((x) => <rect key={x} x={x} y="0" width="4" height="44" fill={c2} />)}
        {pattern === 2 && <rect x="24" y="0" width="24" height="44" fill={c2} />}
        {pattern === 3 && [12, 22, 32].map((y) => <rect key={y} x="0" y={y} width="48" height="5" fill={c2} />)}
        {pattern === 4 && <path d="M8 4l8-2 28 38-8 3z" fill={c2} />}
        <path d="M20 3h8l-4 5z" fill={c2} />
        <path d="M4 12l5 8 3-2-4-9zM44 12l-5 8-3-2 4-9z" fill={c2} opacity="0.85" />
      </g>
      <path d={body} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
    </svg>
  );
}
