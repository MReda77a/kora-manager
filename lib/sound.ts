'use client';
// The game's sound: music on the menus, a living crowd during matches, reactions to every
// big moment. All audio files in /public/sounds were generated for this game (see
// scripts/audio), so they are free to use. Browsers only allow sound after a tap, so
// everything asked for before that waits and starts on the first tap.

export type Track = 'menu' | 'derby' | 'press';
export type Fx = 'goal' | 'concede' | 'ooh' | 'ahh' | 'boo' | 'applause' | 'tension' | 'chant' | 'chant-derby'
  | 'press-shutter' | 'press-flashes' | 'press-gasp' | 'press-laugh' | 'press-sting';
type Settings = { music: boolean; sfx: boolean; volume: number };

const KEY = 'kora-sound';
let settings: Settings = { music: true, sfx: true, volume: 0.8 };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (s) settings = { ...settings, ...s };
  if (localStorage.getItem('kora-muted') === '1') settings.sfx = false; // the old mute switch
} catch {}

const listeners = new Set<() => void>();
export const soundSettings = () => settings;
export function setSound(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); localStorage.removeItem('kora-muted'); } catch {}
  apply();
  listeners.forEach((f) => f());
}
export function onSound(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
// kept for older callers: "muted" means no match sounds
export const isMuted = () => !settings.sfx;
export const setMuted = (m: boolean) => setSound({ sfx: !m });

// ---------------------------------------------------------------- audio graph
let ctx: AudioContext | null = null;
let master: GainNode, musicBus: GainNode, crowdBus: GainNode, fxBus: GainNode;
let unlocked = false;

function graph() {
  if (ctx || typeof window === 'undefined') return ctx;
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch { return null; }
  master = ctx.createGain();
  // a gentle limiter so a goal roar on top of the crowd never distorts
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.01; comp.release.value = 0.25;
  master.connect(comp).connect(ctx.destination);
  musicBus = ctx.createGain(); crowdBus = ctx.createGain(); fxBus = ctx.createGain();
  musicBus.connect(master); crowdBus.connect(master); fxBus.connect(master);
  apply();
  return ctx;
}

function apply() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.volume, t, 0.05);
  musicBus.gain.setTargetAtTime(settings.music ? 0.5 : 0, t, 0.3);
  crowdBus.gain.setTargetAtTime(settings.sfx ? 1 : 0, t, 0.2);
  fxBus.gain.setTargetAtTime(settings.sfx ? 1 : 0, t, 0.05);
}

function unlock() {
  const c = graph();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  if (!unlocked) {
    unlocked = true;
    syncMusic();
    syncBed();
  }
}
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { passive: true });
  // stop everything while the app is in the background (battery), carry on when it is back
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (unlocked) ctx.resume().catch(() => {});
  });
}

// tests can read what played: window.__sound = []
const log = (m: string) => { try { (window as any).__sound?.push(m); } catch {} };

const buffers = new Map<string, Promise<AudioBuffer | null>>();
function load(name: string) {
  if (!buffers.has(name)) {
    buffers.set(name, (async () => {
      try {
        const c = graph();
        if (!c) return null;
        const r = await fetch(`/sounds/${name}.mp3`);
        if (!r.ok) return null;
        const data = await r.arrayBuffer();
        return await new Promise<AudioBuffer>((ok, bad) => c.decodeAudioData(data, ok, bad));
      } catch { return null; }
    })());
  }
  return buffers.get(name)!;
}
export function preload(names: string[]) { if (unlocked) names.forEach(load); }

type Loop = { name: string; src: AudioBufferSourceNode; gain: GainNode };
async function startLoop(name: string, bus: GainNode, level: number, fadeIn: number): Promise<Loop | null> {
  const buf = await load(name);
  const c = ctx;
  if (!buf || !c) return null;
  const src = c.createBufferSource();
  src.buffer = buf; src.loop = true;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.linearRampToValueAtTime(level, c.currentTime + fadeIn);
  src.connect(gain).connect(bus);
  src.start(c.currentTime, Math.random() * buf.duration * (name.startsWith('crowd') ? 1 : 0));
  log(`loop:${name}`);
  return { name, src, gain };
}
function stopLoop(l: Loop | null, fadeOut: number) {
  if (!l || !ctx) return;
  const t = ctx.currentTime;
  l.gain.gain.cancelScheduledValues(t);
  l.gain.gain.setValueAtTime(l.gain.gain.value, t);
  l.gain.gain.linearRampToValueAtTime(0.0001, t + fadeOut);
  try { l.src.stop(t + fadeOut + 0.05); } catch {}
}

// ---------------------------------------------------------------- music
let wantTrack: Track | null = null;
let playing: Loop | null = null;
let musicJob = 0;
/** play a music track on a loop (crossfades from the current one); null fades it out */
export function music(track: Track | null) {
  wantTrack = track;
  syncMusic();
}
async function syncMusic() {
  if (!unlocked) return;
  const name = wantTrack ? `music-${wantTrack}` : null;
  if (playing?.name === name) return;
  const job = ++musicJob;
  stopLoop(playing, 1.6);
  playing = null;
  if (!name) return;
  const l = await startLoop(name, musicBus, 1, 2);
  if (job !== musicJob) { stopLoop(l, 0.3); return; }
  playing = l;
}

// ---------------------------------------------------------------- crowd during a match
let wantBed: 'normal' | 'derby' | 'press' | null = null;
let bedLoop: Loop | null = null;
let bedJob = 0;
let level = 0.55;
/** the steady stadium sound while a match is on (or the press room's murmur); null fades it out */
export function crowdBed(kind: 'normal' | 'derby' | 'press' | null) {
  wantBed = kind;
  syncBed();
}
async function syncBed() {
  if (!unlocked) return;
  const name = wantBed ? (wantBed === 'derby' ? 'crowd-bed-derby' : wantBed === 'press' ? 'press-room' : 'crowd-bed') : null;
  if (bedLoop?.name === name) return;
  const job = ++bedJob;
  stopLoop(bedLoop, 2.5);
  bedLoop = null;
  if (!name) return;
  if (wantBed === 'press') ['press-shutter', 'press-flashes', 'press-gasp', 'press-laugh', 'press-sting'].forEach(load);
  else ['goal', 'concede', 'ooh', 'ahh', 'boo', 'applause', 'tension', wantBed === 'derby' ? 'chant-derby' : 'chant'].forEach(load);
  const l = await startLoop(name, crowdBus, level, 2.5);
  if (job !== bedJob) { stopLoop(l, 0.3); return; }
  bedLoop = l;
}
/** how loud the crowd is right now, 0..1: it grows when a team attacks and in the last minutes */
export function crowdLevel(x: number) {
  level = 0.35 + Math.max(0, Math.min(1, x)) * 0.5;
  if (bedLoop && ctx) bedLoop.gain.gain.setTargetAtTime(level, ctx.currentTime, 1.2);
}
function duck(amount: number, seconds: number) {
  if (!bedLoop || !ctx) return;
  const g = bedLoop.gain.gain, t = ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(level * amount, t + 0.15);
  g.setTargetAtTime(level, t + seconds, 1.0);
}

/** a one-off crowd reaction */
export async function play(name: Fx, opts: { gain?: number; delay?: number; rate?: number } = {}) {
  if (!settings.sfx || !unlocked) return;
  const buf = await load(name);
  const c = ctx;
  if (!buf || !c) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  if (opts.rate) src.playbackRate.value = opts.rate;
  const g = c.createGain();
  g.gain.value = opts.gain ?? 1;
  src.connect(g).connect(fxBus);
  const at = c.currentTime + (opts.delay || 0);
  src.start(at);
  log(`fx:${name}`);
  // the steady crowd dips under a big reaction so the reaction stands out
  if (['goal', 'concede', 'boo', 'tension', 'press-gasp', 'press-laugh'].includes(name)) setTimeout(() => duck(name === 'tension' ? 0.4 : 0.55, Math.min(4, buf.duration * 0.6)), (opts.delay || 0) * 1000);
}

// ---------------------------------------------------------------- small synthesised sounds
function ac() {
  if (!settings.sfx) return null;
  const c = graph();
  if (!c || !unlocked) return null;
  return c;
}

export function whistle(times = 1) {
  const c = ac();
  if (!c) return;
  for (let k = 0; k < times; k++) {
    const long = k === times - 1 && times > 1;
    const t = c.currentTime + k * 0.42;
    const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.frequency.value = 2900;
    lfo.frequency.value = 38;
    lg.gain.value = 140;
    lfo.connect(lg).connect(o.frequency);
    const end = long ? 0.9 : 0.32;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.02);
    g.gain.setValueAtTime(0.09, t + end);
    g.gain.linearRampToValueAtTime(0, t + end + 0.06);
    o.connect(g).connect(fxBus);
    o.start(t); lfo.start(t); o.stop(t + end + 0.1); lfo.stop(t + end + 0.1);
  }
}

export function thud() {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  o.connect(g).connect(fxBus);
  o.start(t); o.stop(t + 0.3);
}

// older name for the reactions
export function crowd(kind: 'roar' | 'groan' | 'murmur' | 'jeer' = 'roar') {
  if (kind === 'roar') play('goal');
  else if (kind === 'groan') play('concede');
  else if (kind === 'jeer') play('boo');
}
