# Press-room sounds for the big-match press conference, made from scratch (no recordings):
# a murmuring room, camera shutters and flash bursts, a gasp, laughter, a tense news-style
# music bed and a headline sting. Run:  python3 scripts/audio/press.py  -> public/sounds/*.mp3
import os, sys
import numpy as np
from scipy import signal

sys.path.insert(0, os.path.dirname(__file__))
import crowd as C  # noqa: E402  (voices, mixing, export)
import music as M  # noqa: E402  (notes, soundfont rendering)

SR = C.SR
rng = np.random.default_rng(11)


def room(x, wet=0.22, tail=0.55):
    """a small, hard-walled room: short early reflections and a quick tail"""
    n = int(tail * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for c in range(2):
        ir = rng.standard_normal(n) * np.exp(-t * 6.9 / tail)
        ir[: int(0.004 * SR)] = 0
        for d, g in ((0.011, 0.6), (0.019, 0.45), (0.031, 0.3)):
            ir[int((d + 0.002 * c) * SR)] += g * 25
        ir /= np.sqrt((ir ** 2).sum())
        out[c] = signal.fftconvolve(x[c], ir)[: x.shape[1]]
    return x * (1 - wet) + out * wet * 1.3


def click(bright=1.0):
    """one shutter: the curtain snaps open, the mirror slaps back"""
    def tick(ms, f):
        n = int(SR * ms / 1000)
        x = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * 0.0012))
        s = signal.butter(2, [f * 0.6, min(SR / 2 - 200, f * 1.8)], btype='band', fs=SR, output='sos')
        return signal.sosfilt(s, x)
    a, b = tick(6, 3800 * bright), tick(9, 2300 * bright)
    gap = int(SR * rng.uniform(0.045, 0.075))
    x = np.zeros(gap + len(b) + 200)
    x[: len(a)] += a
    x[gap: gap + len(b)] += b * 0.8
    # the body of the camera: a tiny low thump
    th = np.sin(2 * np.pi * 140 * np.arange(len(x)) / SR) * np.exp(-np.arange(len(x)) / (SR * 0.008)) * 0.25
    return x + th


def whine(dur=0.7, loud=0.06):
    """a flash charging up"""
    t = np.arange(int(dur * SR)) / SR
    f = 2600 + 3600 * (t / dur) ** 0.6
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * loud * np.minimum(1, t / 0.05) * np.minimum(1, (dur - t) / 0.2)
    return x


def shutter():
    m = C.Mix(0.6)
    m.add(click(), 0.01, 1.0, 0.5)
    m.add(whine(0.5, 0.03), 0.12, 1.0, 0.5)
    return C.fade(room(m.render(), 0.15), 0.001, 0.15)


def flashes(dur=2.2, n=16):
    """a wall of photographers firing at once"""
    m = C.Mix(dur + 0.4)
    for k in range(n):
        t = abs(rng.normal(0, dur * 0.28))
        if t > dur:
            continue
        m.add(click(rng.uniform(0.75, 1.25)), t, rng.uniform(0.5, 1.0), rng.random())
        # motor-drive cameras: a quick run of frames
        if rng.random() < 0.35:
            for j in range(1, int(rng.integers(2, 5))):
                m.add(click(rng.uniform(0.9, 1.1)), t + j * 0.11, rng.uniform(0.5, 0.8), rng.random())
    for k in range(3):
        m.add(whine(rng.uniform(0.5, 0.9), 0.012), rng.uniform(0.2, dur * 0.7), 1.0, rng.random())
    return C.fade(room(m.render(), 0.18), 0.002, 0.35)


def murmur():
    """the room waiting: journalists talking low, chairs, the air conditioning, the odd camera"""
    L = 26
    m = C.Mix(L)
    C.chatter(m, n_voices=34, activity=0.32, loud=1.3)
    # air conditioning hum
    hum = rng.standard_normal(m.n)
    hum = signal.sosfilt(signal.butter(2, [70, 260], btype='band', fs=SR, output='sos'), hum) * 0.012
    m.add(np.vstack([hum, hum * 0.9]), 0, 1.0)
    # chairs creak, papers rustle
    for _ in range(14):
        n = int(SR * rng.uniform(0.15, 0.45))
        x = rng.standard_normal(n) * np.hanning(n)
        f = rng.uniform(700, 2400)
        x = signal.sosfilt(signal.butter(2, [f * 0.7, f * 1.4], btype="band", fs=SR, output="sos"), x) * 0.004
        m.add(x, rng.uniform(0, L - 1), 1.0, rng.random())
    for _ in range(5):
        m.add(click(rng.uniform(0.8, 1.2)), rng.uniform(0.5, L - 1), rng.uniform(0.01, 0.02), rng.random())
    x = room(m.render(), 0.25)
    # indoors and a bit further away: soften the top
    x = signal.sosfilt(signal.butter(2, 4200, fs=SR, output='sos'), x, axis=1)
    return C.loop_fade(x, 1.5)


def gasp():
    """'oooh!': the room reacts to big words, then everyone starts talking at once"""
    m = C.Mix(3.0)
    C.mass(m, 45, 0.0, ['o', 'a'], lambda t: 1.35 + 0.25 * np.sin(np.minimum(t, 0.9) / 0.9 * np.pi), attack=(0.08, 0.2), hold=(0.3, 0.6), release=(0.4, 0.8),
           loud=1.0, spread=0.06, breath=0.45, wobble=0.1)
    C.chatter(m, n_voices=26, activity=0.9, loud=0.9, t0=0.7, t1=2.8)
    m.add(flashes(1.2, 7)[:, : int(1.4 * SR)], 0.15, 0.08)
    return C.fade(room(m.render(), 0.22), 0.01, 0.6)


def laugh():
    """the room laughs: short breathy 'ha ha ha' bursts that fall in pitch"""
    m = C.Mix(3.0)
    for _ in range(26):
        fem, base = C.speaker()
        t0 = abs(rng.normal(0.05, 0.12))
        rate = rng.uniform(4.2, 6.0)
        k = int(rng.integers(4, 9))
        e = np.zeros(m.nc)
        for j in range(k):
            a = int((t0 + j / rate) * C.CR)
            b = a + int(C.CR * rng.uniform(0.07, 0.11))
            if b < m.nc:
                e[a:b] = rng.uniform(0.6, 1.0) * (1 - j / (k + 2))
        e = C.smooth(e, 18)
        tt = np.clip(np.arange(m.nc) / C.CR - t0, 0, None)
        f0 = base * (1.55 - 0.35 * np.minimum(1, tt / 1.4)) * C.wander(m.nc, 0.05)
        m.voice(f0, {'a': e}, rng.random(), fem, breath=0.75)
    C.chatter(m, n_voices=14, activity=0.8, loud=0.5, t0=1.4, t1=2.9)
    return C.fade(room(m.render(), 0.22), 0.01, 0.6)


def music():
    """a tense, ticking news theme: synth bass ostinato, pizzicato, strings and a clock"""
    BPM, BARS = 96, 8
    s = M.Song(BPM)
    BASS, PIZZ, STR, PAD, TIMP = 0, 1, 2, 3, 4
    s.instrument(BASS, 38)   # synth bass
    s.instrument(PIZZ, 45)   # pizzicato strings
    s.instrument(STR, 48)    # string ensemble
    s.instrument(PAD, 89)    # warm pad
    s.instrument(TIMP, 47)   # timpani
    prog = ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A']
    roots = {'Dm': 'D2', 'Bb': 'A#1', 'Gm': 'G1', 'A': 'A1'}
    for rep in range(2):
        for bar in range(BARS):
            b = (rep * BARS + bar) * 4
            ch = prog[bar]
            r = M.n(roots[ch])
            # driving eighths with an octave jump
            for k in range(8):
                s.note(BASS, r + (12 if k in (3, 6) else 0), b + k * 0.5, 0.45, 96 if k % 2 == 0 else 78)
            # pizzicato motif: chord tones climbing
            tones = M.chord(ch if ch != 'A' else 'A', 4)
            for k, i in enumerate((0, 1, 2, 1, 0, 2, 1, 2)):
                s.note(PIZZ, tones[i] + (12 if k >= 6 else 0), b + k * 0.5, 0.4, 70 + (10 if k % 2 == 0 else 0))
            if bar % 2 == 0:
                for p in M.chord(ch if ch != 'A' else 'A', 4):
                    s.note(STR, p, b, 8, 58)
                for p in M.chord(ch if ch != 'A' else 'A', 3):
                    s.note(PAD, p, b, 8, 50)
            # the clock: a closed hi-hat on every sixteenth, accents on the beat
            for k in range(16):
                s.note(9, 42, b + k * 0.25, 0.2, 58 if k % 4 == 0 else 34)
            s.note(9, 76, b, 0.5, 60)  # woodblock on the one
            if bar in (0, 4):
                s.note(TIMP, r + 12, b, 1, 96)
            if bar == 7:
                for k in range(8):
                    s.note(TIMP, M.n('A2'), b + 2 + k * 0.25, 0.25, 60 + k * 7)
    M.render(s, BARS * 4, 'music-press', gain_db=-3)


def sting():
    """the front page: a brass hit with timpani and a crash"""
    import subprocess, tempfile
    s = M.Song(100)
    s.instrument(0, 61)  # brass section
    s.instrument(1, 47)  # timpani
    s.instrument(2, 48)  # strings
    for k in range(6):
        s.note(1, M.n('D2'), k * 0.12, 0.15, 60 + k * 10)
    for p in [M.n('D3'), M.n('A3'), M.n('D4'), M.n('F4'), M.n('A4')]:
        s.note(0, p, 0.75, 0.35, 120)
        s.note(0, p + 2 if p % 12 == 2 else p, 1.25, 1.6, 115)
    for p in M.chord('D', 4):
        s.note(2, p, 1.25, 2, 100)
    s.note(9, 49, 1.25, 1, 120)
    s.note(9, 57, 1.25, 1, 100)
    s.note(1, M.n('D2'), 1.25, 1, 120)
    tmp = tempfile.mkdtemp()
    mid, wav = os.path.join(tmp, 's.mid'), os.path.join(tmp, 's.wav')
    s.save(mid)
    subprocess.run(['fluidsynth', '-ni', '-g', '0.7', '-r', '44100', '-F', wav, M.SF, mid], check=True, capture_output=True)
    out = os.path.join(M.OUT, 'press-sting.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-t', '3.2', '-i', wav, '-af', 'loudnorm=I=-15:TP=-1.5,afade=t=out:st=2.4:d=0.8', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '112k', out], check=True)
    print(f'  press-sting.mp3  {os.path.getsize(out) // 1024} KB')


if __name__ == '__main__':
    only = sys.argv[1:]
    jobs = {'press-room': murmur, 'press-shutter': shutter, 'press-flashes': flashes, 'press-gasp': gasp, 'press-laugh': laugh}
    for name, fn in jobs.items():
        if only and name not in only:
            continue
        lufs = {'press-room': -26, 'press-gasp': -19, 'press-laugh': -19}.get(name)
        C.export(name, fn(), kbps=72 if name == 'press-room' else 64, lufs=lufs)
    if not only or 'music-press' in only:
        music()
    if not only or 'press-sting' in only:
        sting()
