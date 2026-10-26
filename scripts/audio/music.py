# Original music for the game, written note by note here and played with the FluidR3 GM
# soundfont (MIT licence), so it is free to use. Run:  python3 scripts/audio/music.py
#   needs: pip install mido ; apt install fluidsynth fluid-soundfont-gm ; ffmpeg
# Each track is a loop: the MIDI plays the loop twice and we cut out the second pass, so the
# reverb tail of the first pass is already at its start and the join is seamless.
import os, subprocess, tempfile
import mido

SF = '/usr/share/sounds/sf2/FluidR3_GM.sf2'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'sounds')
TPB = 480
NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def n(s):
    """'F#5' -> midi number"""
    acc = {'#': 1, 'b': -1}.get(s[1], 0) if len(s) > 2 else 0
    return 12 * (int(s[-1]) + 1) + NAMES[s[0]] + acc


def chord(name, octave=4):
    """'Bm' -> three midi notes in close position"""
    root = name[0] + (name[1] if len(name) > 1 and name[1] in '#b' else '')
    q = name[len(root):]
    r = n(root + str(octave)) if len(root) == 1 else n(root + str(octave))
    third = 3 if q.startswith('m') else 4
    return [r, r + third, r + 7]


class Song:
    def __init__(self, bpm):
        self.bpm = bpm
        self.ev = {}  # channel -> list of (tick, msg)
        self.prog = {}

    def instrument(self, ch, program):
        self.prog[ch] = program

    def note(self, ch, pitch, beat, length, vel=90):
        on, off = int(beat * TPB), int((beat + length) * TPB) - 8
        self.ev.setdefault(ch, []).append((on, mido.Message('note_on', channel=ch, note=pitch, velocity=max(1, min(127, int(vel))))))
        self.ev.setdefault(ch, []).append((off, mido.Message('note_off', channel=ch, note=pitch, velocity=0)))

    def cc(self, ch, beat, ctl, val):
        self.ev.setdefault(ch, []).append((int(beat * TPB), mido.Message('control_change', channel=ch, control=ctl, value=val)))

    def save(self, path):
        mid = mido.MidiFile(ticks_per_beat=TPB)
        meta = mido.MidiTrack()
        meta.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(self.bpm), time=0))
        mid.tracks.append(meta)
        for ch, evs in sorted(self.ev.items()):
            tr = mido.MidiTrack()
            if ch != 9:
                tr.append(mido.Message('program_change', channel=ch, program=self.prog.get(ch, 0), time=0))
            last = 0
            for t, m in sorted(evs, key=lambda x: (x[0], x[1].type == 'note_on')):
                tr.append(m.copy(time=t - last))
                last = t
            mid.tracks.append(tr)
        mid.save(path)


def render(song, loop_beats, name, gain_db=0):
    tmp = tempfile.mkdtemp()
    mid, wav = os.path.join(tmp, 'a.mid'), os.path.join(tmp, 'a.wav')
    song.save(mid)
    subprocess.run(['fluidsynth', '-ni', '-g', '0.6', '-r', '44100', '-F', wav, SF, mid], check=True, capture_output=True)
    sec = 60 / song.bpm
    start, dur = loop_beats * sec, loop_beats * sec
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.4f}', '-t', f'{dur:.4f}', '-i', wav,
                    '-af', f'loudnorm=I=-16:TP=-1.5:LRA=9,volume={gain_db}dB', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '112k', out], check=True)
    print(f'  {name}.mp3  {dur:.1f}s  {os.path.getsize(out) // 1024} KB')


def drums(s, bar, kind, fill=False, crash=False):
    b = bar * 4
    K, S, H, OH, C, T1, T2, T3 = 36, 38, 42, 46, 49, 50, 47, 43
    if crash:
        s.note(9, C, b, 1, 100)
    if kind == 'pop':
        for k in (0, 2, 2.5):
            s.note(9, K, b + k, 0.5, 105 if k != 2.5 else 80)
        for k in (1, 3):
            s.note(9, S, b + k, 0.5, 100)
        for k in range(8):
            s.note(9, H if k != 7 else OH, b + k * 0.5, 0.5, 70 if k % 2 else 85)
    elif kind == 'war':
        # floor toms and kick: a driving, stamping pattern
        for k in (0, 0.75, 1.5, 2, 2.75, 3.5):
            s.note(9, K, b + k, 0.25, 110)
        for k in (1, 3):
            s.note(9, S, b + k, 0.5, 105)
        for k in (0, 1.5, 2.5):
            s.note(9, T3, b + k, 0.5, 95)
        for k in range(8):
            s.note(9, H, b + k * 0.5, 0.5, 60 + (20 if k % 2 == 0 else 0))
    if fill:
        for i, (k, t) in enumerate(((3, T1), (3.25, T1), (3.5, T2), (3.75, T3))):
            s.note(9, t, b + k, 0.25, 100 + i * 5)


def anthem():
    """the menu theme: a driving sports-broadcast rock anthem (E minor, 126 bpm) -
    distorted guitar chugs, synth bass, big drums, a brass hook in the second half"""
    s = Song(126)
    GTR, LEAD, BRASS, BASS, PAD, STR = 0, 1, 2, 3, 4, 5
    s.instrument(GTR, 29); s.instrument(LEAD, 30); s.instrument(BRASS, 61); s.instrument(BASS, 38); s.instrument(PAD, 89); s.instrument(STR, 48)
    chords = ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D']
    hook = [[('B4', .5), ('E5', 1), ('E5', .5), ('F#5', .5), ('G5', 1.5)], [('G5', 1), ('F#5', .5), ('E5', .5), ('E5', 2)],
            [('D5', .5), ('D5', .5), ('E5', .5), ('G5', 1), ('B5', 1.5)], [('A5', 1.5), ('G5', .5), ('F#5', 2)],
            [('B4', .5), ('E5', 1), ('E5', .5), ('F#5', .5), ('G5', 1.5)], [('G5', 1), ('A5', .5), ('G5', .5), ('E5', 2)],
            [('D5', 1), ('G5', 1), ('B5', 1), ('A5', 1)], [('F#5', 3), (None, 1)]]
    BARS = 16
    for rep in range(2):
        for i, c in enumerate(chords):
            bar = rep * BARS + i
            b = bar * 4
            root = chord(c, 2)[0]
            # power chords, palm-muted 8ths with accents; open and ringing in the hook
            pw = [root + 12, root + 19, root + 24]
            for k in range(8):
                acc = k in (0, 3, 6)
                for p in pw:
                    s.note(GTR, p, b + k * 0.5, 0.45 if (i >= 8 or acc) else 0.25, 112 if acc else 88)
            for k in range(8):
                s.note(BASS, root + (12 if k % 2 else 0), b + k * 0.5, 0.45, 100 if k % 2 == 0 else 84)
            for p in chord(c, 4 if c[0] in 'CDE' else 3):
                s.note(PAD, p, b, 4, 58 if i < 8 else 70)
            # four on the floor, snare on 2 and 4, open hats off the beat; bigger in the hook
            K, SN, CL, OH, CH, CR = 36, 38, 39, 46, 42, 49
            for k in range(4):
                s.note(9, K, b + k, 0.5, 115)
                s.note(9, OH if i >= 8 else CH, b + k + 0.5, 0.5, 80)
            for k in (1, 3):
                s.note(9, SN, b + k, 0.5, 110)
                if i >= 8:
                    s.note(9, CL, b + k, 0.5, 90)
            if i in (0, 8):
                s.note(9, CR, b, 1, 105)
            if i in (7, 15):
                for k, t in ((3, 38), (3.25, 38), (3.5, 45), (3.75, 41)):
                    s.note(9, t, b + k, 0.25, 110)
            if i >= 8:
                t = b
                for p, d in hook[i - 8]:
                    if p:
                        s.note(BRASS, n(p), t, d, 112)
                        s.note(LEAD, n(p) - 12, t, d, 84)
                        s.note(STR, n(p) + 12, t, d, 64)
                    t += d
            else:
                # first half: a guitar answer phrase every other bar
                if i % 2 == 1:
                    for k, p in ((2, 'E4'), (2.5, 'G4'), (3, 'A4'), (3.5, 'B4')):
                        s.note(LEAD, n(p) + (2 if c == 'D' else 0), b + k, 0.5, 90)
    for p in [n('E3'), n('B3'), n('E4')]:
        s.note(GTR, p, 2 * BARS * 4, 2, 100)
    s.note(9, 49, 2 * BARS * 4, 1, 100)
    render(s, BARS * 4, 'music-menu')


def derby():
    """the derby theme: tense and fierce (D minor, 138 bpm) - drums, low strings, brass, choir"""
    s = Song(138)
    STR, LOW, BRASS, CHOIR, HORN, TIMP = 0, 1, 2, 3, 4, 5
    s.instrument(STR, 48); s.instrument(LOW, 44); s.instrument(BRASS, 61); s.instrument(CHOIR, 52); s.instrument(HORN, 60); s.instrument(TIMP, 47)
    chords = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A', 'Gm', 'Dm', 'Bb', 'A', 'Gm', 'Dm', 'Eb', 'A']
    mel = [None] * 8 + [
        [('G4', 1), ('Bb4', 1), ('D5', 2)], [('F5', 1), ('E5', .5), ('D5', .5), ('A4', 2)], [('Bb4', 1), ('D5', 1), ('F5', 1.5), ('D5', .5)], [('E5', 2), ('C#5', 1), ('A4', 1)],
        [('G5', 1.5), ('F5', .5), ('D5', 1), ('Bb4', 1)], [('A4', 1), ('D5', 1), ('F5', 1), ('A5', 1)], [('G5', 1.5), ('Eb5', .5), ('G5', 1), ('Bb5', 1)], [('A5', 3), (None, 1)]]
    BARS = 16
    for rep in range(2):
        for i, c in enumerate(chords):
            bar = rep * BARS + i
            b = bar * 4
            root = chord(c, 2)[0]
            # the engine: low strings hammering 8ths, accents that push forward
            for k in range(8):
                acc = k in (0, 3, 6)
                s.note(LOW, root + 12, b + k * 0.5, 0.45, 112 if acc else 84)
                s.note(LOW, root, b + k * 0.5, 0.45, 100 if acc else 70)
            # brass stabs
            tri = chord(c, 3 if c[0] in 'ABGF' else 4)
            for k, d in ((0, 0.75), (1.5, 0.5), (3, 0.5)):
                for p in tri:
                    s.note(BRASS, p, b + k, d, 108 if i >= 8 else 92)
            if i >= 4:
                for p in tri:
                    s.note(CHOIR, p + 12, b, 4, 70 if i < 8 else 86)
                s.note(STR, tri[0] + 12, b, 4, 66)
            s.note(TIMP, root + 12, b, 1, 110)
            if i % 2 == 1:
                s.note(TIMP, root + 12, b + 3.5, 0.5, 90)
            drums(s, bar, 'war', fill=i in (3, 7, 11, 15), crash=i in (0, 4, 8, 12))
            if mel[i]:
                t = b
                for p, d in mel[i]:
                    if p:
                        s.note(HORN, n(p), t, d, 112)
                        s.note(STR, n(p) + 12, t, d, 80)
                    t += d
    for p in chord('Dm', 3):
        s.note(BRASS, p, 2 * BARS * 4, 2, 90)
    s.note(TIMP, n('D3'), 2 * BARS * 4, 1, 110)
    render(s, BARS * 4, 'music-derby')


if __name__ == '__main__':
    import sys
    if 'derby' not in sys.argv[1:]: anthem()
    if 'menu' not in sys.argv[1:]: derby()
