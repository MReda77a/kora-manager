# Synthesised stadium crowd: every sound here is generated from scratch (no recordings),
# so the game can use them freely. Run:  python3 scripts/audio/crowd.py  -> public/sounds/*.mp3
#
# How it works: a crowd is a few hundred "voices". Each voice is a buzzing vocal source
# (a pitch that wanders, like a person shouting) shaped by vowel formants (a, e, o, u),
# switched on and off by its own envelope. Voices that share a vowel are summed first and
# filtered once, which keeps it fast. Claps, whistles, drums and a little stadium echo are
# added on top.
import os, subprocess, sys
import numpy as np
from scipy import signal

SR = 24000
CR = 200  # control rate for envelopes and pitch (Hz)
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'sounds')
rng = np.random.default_rng(7)

FORMANTS = {  # F1, F2, F3 (adult male); women ~ x1.17
    'a': (730, 1090, 2440), 'e': (530, 1840, 2480), 'o': (570, 840, 2410),
    'u': (320, 870, 2240), 'i': (300, 2200, 2950),
}
VOWELS = list(FORMANTS)
_bank = {}


def formant_bank(v, fem):
    key = (v, fem)
    if key not in _bank:
        k = 1.17 if fem else 1.0
        sos = []
        for f, bw, g in zip(FORMANTS[v], (160, 220, 320), (1.0, 0.55, 0.3)):
            f *= k
            s = signal.butter(2, [max(60, f - bw / 2), min(SR / 2 - 100, f + bw / 2)], btype='band', fs=SR, output='sos')
            sos.append((s, g))
        _bank[key] = sos
    return _bank[key]


def apply_formants(x, v, fem):
    return sum(g * signal.sosfilt(s, x) for s, g in formant_bank(v, fem))


def up(ctrl, n):
    """control-rate curve -> audio rate"""
    t = np.arange(n) / SR
    tc = np.arange(len(ctrl)) / CR
    return np.interp(t, tc, ctrl)


def smooth(c, ms):
    k = max(1, int(CR * ms / 1000))
    return np.convolve(c, np.ones(k) / k, mode='same')


class Mix:
    """Accumulates voices per (vowel, sex, side) and renders them in one pass."""

    def __init__(self, dur):
        self.n = int(dur * SR)
        self.nc = int(dur * CR) + 2
        self.ch = {}
        self.extra = np.zeros((2, self.n))

    def voice(self, f0c, envs, pan, fem, breath=0.25):
        """f0c: control-rate pitch (Hz); envs: {vowel: control-rate amplitude}"""
        f0 = up(f0c, self.n)
        f0 *= up(smooth(1 + 0.015 * rng.standard_normal(self.nc), 25), self.n)  # a voice is never perfectly steady
        ph = np.cumsum(f0 / SR) % 1.0
        src = (2 * ph - 1) * (1 - breath) + breath * rng.standard_normal(self.n) * 0.6
        side = 0 if pan < 0.5 else 1
        for v, e in envs.items():
            if e.max() <= 0:
                continue
            a = up(e, self.n)
            for s, w in ((side, 0.75), (1 - side, 0.25)):
                key = (v, fem, s)
                if key not in self.ch:
                    self.ch[key] = np.zeros(self.n)
                self.ch[key] += src * a * w

    def add(self, x, start=0.0, gain=1.0, pan=0.5):
        i = int(start * SR)
        if i >= self.n:
            return
        x = x[: self.n - i]
        if x.ndim == 1:
            self.extra[0, i:i + len(x)] += x * gain * (1 - pan) * 1.4
            self.extra[1, i:i + len(x)] += x * gain * pan * 1.4
        else:
            self.extra[:, i:i + x.shape[1]] += x * gain

    def render(self):
        out = np.zeros((2, self.n))
        for (v, fem, s), x in self.ch.items():
            out[s] += apply_formants(x, v, fem)
        # shouting crowds lose the low end and get a soft lowpass with distance
        sos = signal.butter(2, [140, 6500], btype='band', fs=SR, output='sos')
        out = signal.sosfilt(sos, out, axis=1)
        return out * 0.02 + self.extra


# ------------------------------------------------------------------ building blocks
def speaker(fem=None):
    fem = rng.random() < 0.28 if fem is None else fem
    base = rng.uniform(185, 240) if fem else rng.uniform(95, 145)
    return fem, base


def wander(n, depth=0.08, speed=0.02):
    w = np.cumsum(rng.standard_normal(n)) * speed
    w -= np.linspace(w[0], w[-1], n)
    return 1 + np.clip(w, -1, 1) * depth


def chatter(m, n_voices=120, activity=0.25, loud=1.0, t0=0.0, t1=None):
    """background talking: each voice speaks in phrases of syllables"""
    t1 = t1 or m.nc / CR
    for _ in range(n_voices):
        fem, base = speaker()
        f0 = base * wander(m.nc, 0.12)
        envs = {v: np.zeros(m.nc) for v in VOWELS}
        t = t0 + rng.uniform(0, 3)
        while t < t1:
            if rng.random() < activity:
                phrase = rng.uniform(0.6, 2.4)
                s = t
                while s < t + phrase:
                    syl = rng.uniform(0.09, 0.22)
                    a, b = int(s * CR), int((s + syl) * CR)
                    if b < m.nc:
                        envs[VOWELS[rng.integers(0, 5)]][a:b] = rng.uniform(0.4, 1.0) * loud
                    s += syl + rng.uniform(0.0, 0.08)
                t += phrase
            t += rng.uniform(0.8, 4.0)
        for v in envs:
            envs[v] = smooth(envs[v], 30)
        m.voice(f0, envs, rng.random(), fem, breath=0.4)


def shouts(m, n=8, t0=0.0, t1=None, loud=1.6):
    """occasional single voices calling out over the murmur ("come on!", "hey ref!")"""
    t1 = t1 or m.nc / CR
    for _ in range(n):
        fem, base = speaker()
        t = rng.uniform(t0, max(t0, t1 - 1.2))
        f0 = np.full(m.nc, base * 1.7)
        envs = {v: np.zeros(m.nc) for v in VOWELS}
        s = t
        for k in range(rng.integers(2, 5)):
            syl = rng.uniform(0.12, 0.35) if k < 2 else rng.uniform(0.3, 0.6)
            a, b = int(s * CR), min(m.nc, int((s + syl) * CR))
            envs[rng.choice(['a', 'e', 'o'])][a:b] = loud
            f0[a:b] = base * rng.uniform(1.6, 2.2) * np.linspace(1.05, 0.92, b - a)
            s += syl + 0.04
        for v in envs:
            envs[v] = smooth(envs[v], 25)
        m.voice(smooth(f0, 40), envs, rng.random(), fem, breath=0.2)


def env_shape(nc, t0, attack, hold, release, peak=1.0):
    e = np.zeros(nc)
    a, h, r = int(t0 * CR), int((t0 + attack) * CR), int((t0 + attack + hold) * CR)
    z = min(nc, int((t0 + attack + hold + release) * CR))
    if a >= nc:
        return e
    e[a:min(h, nc)] = np.linspace(0, peak, h - a)[: min(h, nc) - a]
    if h < nc:
        e[h:min(r, nc)] = peak
    if r < nc:
        e[r:z] = np.linspace(peak, 0, z - r)[: z - r] if z > r else 0
    return e


def mass(m, n, start, vowels, f0_shape, attack=(0.08, 0.3), hold=(1.5, 3.0), release=(0.8, 2.0), loud=1.0, spread=0.25, breath=0.3, wobble=0.25):
    """many people making the same sound together (a roar, a groan, an 'ooh')"""
    for _ in range(n):
        fem, base = speaker()
        t = start + abs(rng.normal(0, spread))
        at, ho, re = rng.uniform(*attack), rng.uniform(*hold), rng.uniform(*release)
        e = env_shape(m.nc, t, at, ho, re, loud * rng.uniform(0.6, 1.0))
        e *= 1 + wobble * (wander(m.nc, 1.0, 0.05) - 1)  # people breathe and re-shout
        e = np.clip(e, 0, None)
        tt = np.arange(m.nc) / CR - t
        f0 = base * f0_shape(np.clip(tt, 0, None)) * wander(m.nc, 0.05)
        # the vowel can drift (o -> a in a roar, o -> u in a groan)
        if len(vowels) == 1:
            envs = {vowels[0]: e}
        else:
            x = np.clip(tt / max(0.3, ho * 0.6), 0, 1)
            envs = {vowels[0]: e * (1 - x), vowels[1]: e * x}
        m.voice(f0, envs, rng.random(), fem, breath)


def clap():
    n = int(SR * rng.uniform(0.012, 0.03))
    x = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * rng.uniform(0.004, 0.008)))
    f = rng.uniform(900, 2400)
    s = signal.butter(2, [f * 0.5, min(SR / 2 - 100, f * 2.2)], btype='band', fs=SR, output='sos')
    return signal.sosfilt(s, x)


def applause(m, start, dur, people=90, loud=1.0, fade=1.2):
    for _ in range(people):
        rate = rng.uniform(2.6, 4.6)
        t = start + rng.uniform(0, 0.6)
        stop = start + dur - rng.uniform(0, fade)
        pan = rng.random()
        g = rng.uniform(0.3, 1.0) * loud
        while t < stop:
            fadein = min(1, (t - start) / 0.4 + 0.2)
            fadeout = min(1, (start + dur - t) / fade)
            m.add(clap(), t, 0.11 * g * fadein * max(0, fadeout), pan)
            t += 1 / rate * rng.uniform(0.85, 1.15)


def rhythm_claps(m, times, people=120, loud=1.0, jitter=0.03):
    for t in times:
        for _ in range(people):
            m.add(clap(), t + rng.normal(0, jitter), 0.09 * loud * rng.uniform(0.4, 1.0), rng.random())


def whistle_people(m, n, start, dur, loud=1.0, kind='cheer'):
    """fans whistling: wolf-whistles for a goal, long piercing whistles to jeer"""
    for _ in range(n):
        t = start + rng.uniform(0, dur * 0.5)
        if kind == 'cheer':
            d = rng.uniform(0.35, 0.8)
            f = np.concatenate([np.linspace(rng.uniform(1200, 1600), rng.uniform(2600, 3200), int(d * 0.45 * SR)),
                                np.linspace(rng.uniform(2000, 2400), rng.uniform(1100, 1500), int(d * 0.55 * SR))])
        else:
            d = rng.uniform(0.8, 2.2)
            f = np.full(int(d * SR), rng.uniform(2400, 3600)) * (1 + 0.012 * np.sin(2 * np.pi * rng.uniform(4, 7) * np.arange(int(d * SR)) / SR))
        ph = np.cumsum(f / SR) * 2 * np.pi
        e = np.minimum(1, np.minimum(np.arange(len(f)) / (0.04 * SR), (len(f) - np.arange(len(f))) / (0.08 * SR)))
        x = np.sin(ph) * e + 0.15 * rng.standard_normal(len(f)) * e
        m.add(x * 0.035 * loud * rng.uniform(0.4, 1.0), t, 1.0, rng.random())


def roar_noise(m, start, attack, hold, release, loud=1.0):
    """the wide 'wall of sound' under a big roar: thousands of voices blur into noise"""
    n = m.n
    e = up(env_shape(m.nc, start, attack, hold, release, 1.0), n)
    e *= up(wander(m.nc, 0.25, 0.05), n)
    out = np.zeros((2, n))
    for c in range(2):
        x = rng.standard_normal(n)
        s = signal.butter(2, [350, 3200], btype='band', fs=SR, output='sos')
        out[c] = signal.sosfilt(s, x) * e * 0.09 * loud
    m.add(out)


def drum(kind='bass'):
    """a supporters' big drum"""
    if kind == 'bass':
        n = int(SR * 0.5)
        t = np.arange(n) / SR
        f = 58 + 60 * np.exp(-t * 30)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
        x += 0.25 * rng.standard_normal(n) * np.exp(-t * 60)
        return x * 0.5
    n = int(SR * 0.25)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 18) * 0.5 + rng.standard_normal(n) * np.exp(-t * 22) * 0.35
    s = signal.butter(2, [150, 3000], btype='band', fs=SR, output='sos')
    return signal.sosfilt(s, x) * 0.6


def sing(m, start, notes, bpm, root, people=150, loud=1.0, detune=0.035, jitter=0.035):
    """the crowd sings a chant together. notes: (beats, semitones from root or None for a rest, vowel)"""
    beat = 60 / bpm
    for _ in range(people):
        fem = rng.random() < 0.25
        r = root * (2 if fem else 1) * 2 ** (rng.normal(0, detune))
        f0 = np.full(m.nc, r)
        envs = {v: np.zeros(m.nc) for v in VOWELS}
        t = start + rng.normal(0, jitter)
        g = loud * rng.uniform(0.55, 1.0)
        for beats, semi, v in notes:
            d = beats * beat
            if semi is not None:
                a, b = int(t * CR), min(m.nc, int((t + d * 0.92) * CR))
                if a < m.nc:
                    envs[v][a:b] = g
                    f0[a:b] = r * 2 ** (semi / 12) * 2 ** (rng.normal(0, 0.01))
            t += d
        for v in envs:
            envs[v] = smooth(envs[v], 35)
        m.voice(smooth(f0, 25), envs, rng.random(), fem, breath=0.3)


# ------------------------------------------------------------------ space and export
def stadium(x, wet=0.28, tail=1.3):
    n = int(tail * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for c in range(2):
        ir = rng.standard_normal(n) * np.exp(-t * 6.9 / tail)
        ir[: int(0.02 * SR)] = 0
        for d, g in ((0.13, 0.5), (0.21, 0.35), (0.34, 0.2)):  # echoes off the stands
            ir[int((d + 0.01 * c) * SR)] += g * 30
        ir /= np.sqrt((ir ** 2).sum())
        out[c] = signal.fftconvolve(x[c], ir)[: x.shape[1]]
    return x * (1 - wet) + out * wet * 1.2


def loop_fade(x, xf=1.5):
    """make a bed loop seamlessly: crossfade the tail into the head"""
    k = int(xf * SR)
    head, body, tail = x[:, :k], x[:, k:-k], x[:, -k:]
    w = np.linspace(0, 1, k)
    return np.concatenate([tail * (1 - w) + head * w, body], axis=1)


def fade(x, a=0.02, b=0.4):
    n = x.shape[1]
    e = np.ones(n)
    ka, kb = int(a * SR), int(b * SR)
    e[:ka] = np.linspace(0, 1, ka)
    e[n - kb:] = np.linspace(1, 0, kb)
    return x * e


def export(name, x, peak=0.89, kbps=80, lufs=None):
    x = signal.sosfilt(signal.butter(4, 7500, fs=SR, output='sos'), x, axis=1)  # no harsh hiss on phone speakers
    x = x / (np.abs(x).max() + 1e-9) * peak
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, name + '.wav')
    from scipy.io import wavfile
    wavfile.write(wav, SR, (x.T * 32767).astype(np.int16))
    af = ['-af', f'loudnorm=I={lufs}:TP=-1.5:LRA=11'] if lufs else []
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, *af, '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', os.path.join(OUT, name + '.mp3')], check=True)
    os.remove(wav)
    print(f'  {name}.mp3  {x.shape[1] / SR:.1f}s  {os.path.getsize(os.path.join(OUT, name + ".mp3")) // 1024} KB')


# ------------------------------------------------------------------ the sounds
def bed(derby=False):
    """the steady sound of a full stadium while the ball is in play (loops)"""
    L = 30
    m = Mix(L + 1.5)
    chatter(m, 200 if derby else 150, 0.32 if derby else 0.24, 1.0)
    shouts(m, 26 if derby else 12, 0, L)
    # a few pockets clapping now and then, encouragement
    for t in rng.uniform(1, L - 4, 4 if derby else 3):
        applause(m, t, rng.uniform(1.5, 3), people=25, loud=0.5)
    if derby:
        # the ultras' drum keeps going all match, with whistles and bursts of a chant
        beat = 60 / 118
        t = 0.0
        while t < L + 1.4:
            m.add(drum('bass'), t, 0.32, 0.5)
            m.add(drum('snare'), t + beat / 2, 0.12, 0.5)
            t += beat
        whistle_people(m, 10, 0, L, 0.6, 'jeer')
        roar_noise(m, 0, 2, L - 1, 0.5, 0.35)
        notes = [(1, 0, 'o'), (0.5, 0, 'e'), (0.5, 2, 'o'), (1, 4, 'o'), (1, None, 'o'), (1, 4, 'e'), (0.5, 5, 'o'), (0.5, 4, 'o'), (1, 2, 'o'), (1, None, 'o')]
        for s in (4, 18):
            sing(m, s, notes * 2, 118, 150, people=70, loud=0.8)
    else:
        roar_noise(m, 0, 2, L - 1, 0.5, 0.2)
    x = stadium(m.render())
    return loop_fade(x)


def goal():
    """GOAL: a huge rise, wolf-whistles, then clapping and singing"""
    m = Mix(9)
    mass(m, 240, 0.05, ['o', 'a'], lambda t: 1.6 + 0.6 * np.minimum(1, t / 0.4), attack=(0.08, 0.35), hold=(2.2, 4.0), release=(1.0, 2.5), loud=1.4, spread=0.18, breath=0.35)
    roar_noise(m, 0.05, 0.35, 3.2, 2.5, 1.4)
    whistle_people(m, 22, 0.4, 3.0, 1.2, 'cheer')
    applause(m, 2.6, 6, people=120, loud=1.1, fade=2.5)
    mass(m, 60, 4.2, ['e'], lambda t: 1.7 - 0.1 * t, attack=(0.05, 0.15), hold=(0.2, 0.5), release=(0.2, 0.5), loud=0.8, spread=0.6)  # "yeah!" calls
    return fade(stadium(m.render()), 0.01, 1.5)


def concede():
    """a goal against: a deflated 'ohhh', then a small pocket of away fans celebrating far away"""
    m = Mix(6)
    mass(m, 200, 0.05, ['o', 'u'], lambda t: 1.55 * np.maximum(0.62, 1 - t * 0.45), attack=(0.05, 0.2), hold=(0.6, 1.2), release=(1.0, 1.8), loud=1.0, spread=0.12, breath=0.45)
    # away end
    far = Mix(6)
    mass(far, 70, 0.3, ['o', 'a'], lambda t: 1.9, attack=(0.1, 0.3), hold=(1.5, 2.5), release=(1, 2), loud=1.0, spread=0.2)
    applause(far, 1.5, 3.5, people=30, loud=0.8)
    x = far.render()
    x = signal.sosfilt(signal.butter(2, 2200, fs=SR, output='sos'), x, axis=1) * 0.35
    m.add(x)
    chatter(m, 80, 0.3, 0.6, 2.0)
    return fade(stadium(m.render(), 0.35), 0.01, 1.2)


def ooh():
    """a near miss or a big save: a rising 'ooooh' that falls away, then encouragement"""
    m = Mix(4.5)
    mass(m, 220, 0.0, ['o', 'u'], lambda t: 1.45 + 0.45 * np.sin(np.minimum(t, 1.4) / 1.4 * np.pi) - 0.2 * (t > 1.4) * np.minimum(1, (t - 1.4)),
         attack=(0.25, 0.5), hold=(0.5, 0.9), release=(0.6, 1.2), loud=1.1, spread=0.1, breath=0.35, wobble=0.1)
    roar_noise(m, 0.0, 0.5, 0.6, 1.0, 0.5)
    applause(m, 1.6, 2.6, people=60, loud=0.7, fade=1.2)
    return fade(stadium(m.render()), 0.05, 0.8)


def ahh():
    """a foul or a booking: a sharp 'aahh!' of protest, a few whistles"""
    m = Mix(3.2)
    mass(m, 180, 0.0, ['a'], lambda t: 1.9 * np.maximum(0.7, 1 - t * 0.35), attack=(0.04, 0.12), hold=(0.3, 0.6), release=(0.4, 0.9), loud=1.1, spread=0.08, breath=0.35, wobble=0.1)
    roar_noise(m, 0.0, 0.1, 0.4, 0.7, 0.5)
    whistle_people(m, 4, 0.3, 1.4, 0.3, 'jeer')
    return fade(stadium(m.render()), 0.01, 0.6)


def boo():
    """a red card or a decision against: long booing and piercing whistles"""
    m = Mix(5)
    mass(m, 200, 0.0, ['u', 'o'], lambda t: 1.15 + 0.05 * np.sin(t * 3), attack=(0.2, 0.5), hold=(1.6, 2.6), release=(0.8, 1.4), loud=1.0, spread=0.25, breath=0.45)
    whistle_people(m, 40, 0.1, 3.0, 1.0, 'jeer')
    roar_noise(m, 0.0, 0.5, 2.0, 1.2, 0.5)
    return fade(stadium(m.render()), 0.05, 0.8)


def clapping():
    """applause: kick-off, half-time, full-time, a substitution"""
    m = Mix(5)
    applause(m, 0, 5, people=140, loud=1.0, fade=2.0)
    mass(m, 30, 0.2, ['e'], lambda t: 1.8, attack=(0.05, 0.2), hold=(0.3, 0.8), release=(0.3, 0.6), loud=0.6, spread=0.8)
    return fade(stadium(m.render()), 0.3, 1.5)


def tension():
    """a penalty: the crowd rises, then goes quiet as the taker runs up"""
    m = Mix(3.5)
    mass(m, 160, 0.0, ['o', 'a'], lambda t: 1.4 + 0.25 * np.minimum(1, t / 1.2), attack=(0.6, 1.2), hold=(0.4, 0.8), release=(0.6, 1.0), loud=0.9, spread=0.2)
    roar_noise(m, 0.0, 1.0, 0.8, 1.0, 0.6)
    whistle_people(m, 14, 0.3, 1.6, 0.6, 'jeer')
    return fade(stadium(m.render()), 0.2, 1.2)


def chant(derby=False):
    """the crowd sings: clap-clap, 'oh-oh-oh' - in a derby louder, faster, with drums"""
    bpm = 132 if derby else 116
    beat = 60 / bpm
    root = 155 if derby else 145
    # an original two-line chant; the second line answers the first
    a = [(1, 0, 'o'), (0.5, 4, 'o'), (0.5, 4, 'e'), (1, 7, 'o'), (1, None, 'o'), (0.5, 7, 'o'), (0.5, 9, 'e'), (1, 7, 'o'), (1, 4, 'o'), (1, None, 'o')]
    b = [(1, 2, 'e'), (0.5, 4, 'o'), (0.5, 5, 'e'), (1, 4, 'o'), (1, 2, 'o'), (2, 0, 'o'), (2, None, 'o')]
    notes = (a + b) * 2
    bars = sum(n[0] for n in notes)
    L = bars * beat + 2.5
    m = Mix(L)
    sing(m, 0.4, notes, bpm, root, people=200 if derby else 150, loud=1.2 if derby else 1.0)
    # claps on the rests and on every beat
    times = [0.4 + k * beat for k in range(int(bars))]
    rhythm_claps(m, times, people=70 if derby else 40, loud=0.9 if derby else 0.7)
    if derby:
        for k in range(int(bars) * 2):
            t = 0.4 + k * beat / 2
            m.add(drum('bass' if k % 2 == 0 else 'snare'), t, 0.55 if k % 2 == 0 else 0.25, 0.5)
        whistle_people(m, 12, 0, L - 2, 0.6, 'cheer')
        roar_noise(m, 0, 1, L - 2, 1, 0.5)
        chatter(m, 60, 0.3, 0.6)
    else:
        roar_noise(m, 0, 1, L - 2, 1, 0.25)
        chatter(m, 60, 0.25, 0.5)
    return fade(stadium(m.render()), 0.3, 1.8)


if __name__ == '__main__':
    only = sys.argv[1:]
    jobs = {
        'crowd-bed': lambda: bed(False), 'crowd-bed-derby': lambda: bed(True), 'goal': goal, 'concede': concede, 'ooh': ooh,
        'ahh': ahh, 'boo': boo, 'applause': clapping, 'tension': tension, 'chant': lambda: chant(False), 'chant-derby': lambda: chant(True),
    }
    for name, fn in jobs.items():
        if only and name not in only:
            continue
        export(name, fn(), kbps=80 if 'bed' in name else 72)
