'use client';
// Small synthesized sounds (no audio files): referee whistle, crowd roar, groan, card.
let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem('kora-muted') === '1'; } catch {}

export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('kora-muted', m ? '1' : '0'); } catch {}
}
export const isMuted = () => muted;

function ac() {
  if (muted) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function noise(c: AudioContext, seconds: number) {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

export function whistle(times = 1) {
  const c = ac();
  if (!c) return;
  for (let k = 0; k < times; k++) {
    const t = c.currentTime + k * 0.45;
    const o = c.createOscillator();
    const lfo = c.createOscillator();
    const lg = c.createGain();
    const g = c.createGain();
    o.frequency.value = 2900;
    lfo.frequency.value = 38;
    lg.gain.value = 120;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.setValueAtTime(0.07, t + 0.32);
    g.gain.linearRampToValueAtTime(0, t + 0.38);
    o.connect(g).connect(c.destination);
    o.start(t); lfo.start(t); o.stop(t + 0.4); lfo.stop(t + 0.4);
  }
}

// Crowd: filtered noise with a swell. big = goal roar.
export function crowd(kind: 'roar' | 'groan' | 'murmur' | 'jeer' = 'roar') {
  const c = ac();
  if (!c) return;
  const dur = kind === 'roar' ? 3.2 : kind === 'murmur' ? 1.6 : 2;
  const src = noise(c, dur);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = kind === 'groan' ? 380 : kind === 'jeer' ? 1200 : 900;
  bp.Q.value = 0.7;
  const g = c.createGain();
  const t = c.currentTime;
  const peak = kind === 'roar' ? 0.32 : kind === 'murmur' ? 0.08 : 0.18;
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (kind === 'roar' ? 0.25 : 0.4));
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur);
  if (kind === 'groan') {
    const o = c.createOscillator();
    const og = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 1.2);
    og.gain.setValueAtTime(0.02, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    o.connect(og).connect(c.destination);
    o.start(t); o.stop(t + 1.3);
  }
}

export function thud() {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime;
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + 0.3);
}
