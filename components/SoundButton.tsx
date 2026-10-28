'use client';
import { useEffect, useRef, useState } from 'react';
import { onSound, setSound, soundSettings } from '../lib/sound.ts';

// One speaker button: tap to open, then switch music and the crowd on or off separately.
export function SoundButton({ side = false }: { side?: boolean }) {
  const [s, setS] = useState(soundSettings());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  useEffect(() => onSound(() => setS(soundSettings())), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const icon = !s.music && !s.sfx ? '🔇' : '🔊';
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="seg" onClick={(e) => {
        // in the side menu the panel floats next to the button (the menu itself scrolls and would clip it)
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setAt({ left: r.right + 8, bottom: Math.max(8, window.innerHeight - r.bottom) });
        setOpen(!open);
      }} aria-label="Sound settings" aria-expanded={open}><span>{icon}</span></button>
      {open && (
        <div role="dialog" aria-label="Sound" style={{ background: '#0F2238', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12, boxShadow: '0 12px 30px rgba(0,0,0,0.5)', ...(side && at ? { position: 'fixed', left: at.left, bottom: at.bottom } : { position: 'absolute', right: 0, top: 'calc(100% + 6px)' }), zIndex: 60, width: 220, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Toggle label="🎵 Music" on={s.music} set={(v) => setSound({ music: v })} />
          <Toggle label="📣 Crowd & effects" on={s.sfx} set={(v) => setSound({ sfx: v })} />
          <label className="row tiny" style={{ gap: 8, fontWeight: 800 }}>
            <span>Volume</span>
            <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => setSound({ volume: Number(e.target.value) })} style={{ flex: 1, accentColor: 'var(--sel, #5FD3F3)' }} aria-label="Volume" />
          </label>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button onClick={() => set(!on)} aria-pressed={on} className="row between small"
      style={{ width: '100%', display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, padding: '9px 12px', borderRadius: 8, fontWeight: 800, background: on ? 'var(--sel, #5FD3F3)' : 'rgba(255,255,255,0.08)', color: on ? '#0F2440' : '#E8F1FA', gap: 10 }}>
      <span>{label}</span><b>{on ? 'On' : 'Off'}</b>
    </button>
  );
}
