#!/usr/bin/env python3
"""Pixeltopia original music + SFX generator (v1.8).

Everything here is synthesised from scratch (numpy oscillators, no samples, no third-party audio), so the
output is original and free to ship. Deterministic: the same seed list always gives the same files.
  python3 tools/audio/gen_audio.py            -> assets/audio/music/*.ogg, assets/audio/sfx/*.ogg
Needs numpy + ffmpeg (libvorbis).
"""
import os, subprocess, sys, tempfile, wave
import numpy as np

SR = 44100
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MUSIC_DIR = os.path.join(ROOT, 'assets', 'audio', 'music')
SFX_DIR = os.path.join(ROOT, 'assets', 'audio', 'sfx')

def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12.0)

# ---------- oscillators ----------
def osc(kind, f, n, phase=0.0, duty=0.5):
    t = (np.arange(n) / SR) * f + phase
    fr = t % 1.0
    if kind == 'sine':
        return np.sin(2 * np.pi * t)
    if kind == 'tri':
        return 4 * np.abs(fr - 0.5) - 1
    if kind == 'saw':
        return 2 * fr - 1
    if kind == 'square':
        return np.where(fr < duty, 1.0, -1.0)
    if kind == 'pluck':  # soft saw + sine
        return 0.6 * np.sin(2 * np.pi * t) + 0.4 * (2 * fr - 1) * np.exp(-np.arange(n) / (SR * 0.15))
    if kind == 'bell':
        return np.sin(2 * np.pi * t) + 0.4 * np.sin(2 * np.pi * t * 2.76) + 0.2 * np.sin(2 * np.pi * t * 5.4)
    raise ValueError(kind)

def adsr(n, a=0.01, d=0.08, s=0.6, r=0.08):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    env = np.full(n, s, dtype=np.float64)
    a_n = min(a_n, n); env[:a_n] = np.linspace(0, 1, a_n, endpoint=False) if a_n else env[:a_n]
    e = min(a_n + d_n, n)
    if e > a_n: env[a_n:e] = np.linspace(1, s, e - a_n, endpoint=False)
    if r_n and n > r_n: env[-r_n:] *= np.linspace(1, 0, r_n)
    return env

def lowpass(x, cutoff):
    # one-pole low-pass (cheap, smooth)
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x); acc = 0.0
    # vectorised via lfilter-like recurrence using cumulative trick is unstable; chunked loop is fine for SFX
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y

def noise(n, rng):
    return rng.uniform(-1, 1, n)

# ---------- music ----------
SCALES = {
    'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10], 'dorian': [0, 2, 3, 5, 7, 9, 10],
    'mixo': [0, 2, 4, 5, 7, 9, 10], 'penta': [0, 2, 4, 7, 9], 'lydian': [0, 2, 4, 6, 7, 9, 11],
}
# (name, title, key root midi, scale, bpm, progression (scale degrees), lead, pad, drums, swing, seed, bars)
TRACKS = [
    ('01_meadow_morning', 'Meadow Morning', 60, 'major', 104, [0, 4, 5, 3], 'square', 'tri', 'light', 0.0, 11, 48),
    ('02_pixel_plains', 'Pixel Plains', 62, 'mixo', 120, [0, 6, 3, 0], 'pluck', 'saw', 'full', 0.08, 23, 56),
    ('03_seed_lab', 'Seed Lab', 57, 'dorian', 96, [0, 3, 0, 4], 'bell', 'tri', 'light', 0.12, 37, 44),
    ('04_market_day', 'Market Day', 65, 'major', 128, [0, 3, 4, 0], 'square', 'saw', 'full', 0.0, 41, 60),
    ('05_starlit_farm', 'Starlit Farm', 55, 'minor', 78, [0, 5, 2, 6], 'bell', 'sine', 'none', 0.0, 53, 36),
    ('06_cavern_echo', 'Cavern Echo', 52, 'minor', 90, [0, 0, 5, 4], 'tri', 'saw', 'light', 0.1, 67, 44),
    ('07_rainy_greenhouse', 'Rainy Greenhouse', 58, 'lydian', 84, [0, 1, 0, 4], 'pluck', 'sine', 'light', 0.15, 71, 40),
    ('08_lockkeepers_march', "Lockkeeper's March", 60, 'mixo', 136, [0, 6, 5, 4], 'square', 'saw', 'full', 0.0, 83, 64),
    ('09_desert_caravan', 'Desert Caravan', 62, 'dorian', 110, [0, 3, 6, 0], 'pluck', 'tri', 'full', 0.18, 97, 52),
    ('10_sunset_harvest', 'Sunset Harvest', 63, 'major', 100, [0, 5, 3, 4], 'tri', 'saw', 'light', 0.05, 101, 48),
    ('11_snowy_peaks', 'Snowy Peaks', 64, 'penta', 92, [0, 3, 4, 2], 'bell', 'sine', 'light', 0.0, 113, 44),
]

def degree_to_midi(root, scale, deg, octave=0):
    s = SCALES[scale]
    o, i = divmod(deg, len(s))
    return root + s[i] + 12 * (o + octave)

def chord(root, scale, deg):
    return [degree_to_midi(root, scale, deg + k) for k in (0, 2, 4)]

def put(buf, start, sig, gain=1.0, pan=0.0):
    end = min(len(buf), start + len(sig))
    if end <= start: return
    l = gain * np.sqrt(0.5 * (1 - pan)); r = gain * np.sqrt(0.5 * (1 + pan))
    buf[start:end, 0] += sig[:end - start] * l
    buf[start:end, 1] += sig[:end - start] * r

def kick(rng):
    n = int(0.22 * SR); t = np.arange(n) / SR
    f = 120 * np.exp(-t * 18) + 42
    ph = np.cumsum(f) / SR
    return np.sin(2 * np.pi * ph) * np.exp(-t * 14)

def snare(rng):
    n = int(0.18 * SR); t = np.arange(n) / SR
    return (0.7 * noise(n, rng) + 0.3 * np.sin(2 * np.pi * 190 * t)) * np.exp(-t * 22)

def hat(rng, open_=False):
    n = int((0.12 if open_ else 0.04) * SR); t = np.arange(n) / SR
    x = noise(n, rng); x = np.diff(np.concatenate([[0], x]))  # crude high-pass
    return x * np.exp(-t * (25 if open_ else 80)) * 0.6

def render_track(spec):
    name, title, root, scale, bpm, prog, lead, pad, drums, swing, seed, bars = spec
    rng = np.random.default_rng(seed)
    beat = 60.0 / bpm
    bar_n = int(4 * beat * SR)
    total = bars * bar_n + int(2.5 * SR)
    buf = np.zeros((total, 2))
    K, S, H, HO = kick(rng), snare(rng), hat(rng), hat(rng, True)
    # motif: 2-bar melody of eighth notes (scale degrees, None = rest), varied per section
    def make_motif():
        m = []; d = int(rng.integers(0, 5))
        for i in range(16):
            if rng.random() < 0.22: m.append(None); continue
            d = int(np.clip(d + rng.choice([-2, -1, -1, 0, 1, 1, 2, 3]), -2, 9)); m.append(d)
        return m
    motifs = [make_motif(), make_motif(), make_motif()]
    sections = ['A', 'A', 'B', 'A', 'C', 'B', 'A', 'A']  # per 'bars/len' chunk
    sec_len = max(1, bars // len(sections))
    eighth = beat / 2
    for b in range(bars):
        sec = sections[min(len(sections) - 1, b // sec_len)]
        intro = b < 2; outro = b >= bars - 2
        deg = prog[b % len(prog)]
        bs = b * bar_n
        # pad chord (whole bar)
        ch = chord(root, scale, deg)
        pn = bar_n + int(0.3 * SR)
        padsig = sum(osc(pad, midi(m - 12), pn, phase=rng.random()) for m in ch) / 3
        padsig = padsig * adsr(pn, a=0.25, d=0.3, s=0.7, r=0.35)
        put(buf, bs, padsig, 0.10 if pad == 'saw' else 0.16)
        # bass: root on beats, octave hop
        for q in range(4 if not intro else 2):
            bn = degree_to_midi(root, scale, deg, -2) + (12 if (q == 3 and sec != 'C') else 0)
            n = int(beat * 0.9 * SR)
            sig = osc('tri', midi(bn), n) * adsr(n, 0.005, 0.1, 0.5, 0.05)
            put(buf, bs + int(q * beat * SR), sig, 0.32)
        # arpeggio (sixteenths) in B/C sections
        if sec in ('B', 'C') and not outro:
            for s16 in range(16):
                m = ch[s16 % 3] + (12 if (s16 // 3) % 2 else 0)
                n = int(beat / 4 * 0.8 * SR)
                sig = osc('square', midi(m), n, duty=0.25) * adsr(n, 0.002, 0.04, 0.3, 0.02)
                put(buf, bs + int(s16 * beat / 4 * SR), sig, 0.045, pan=0.35 * np.sin(s16))
        # lead melody (motif with chord-relative offset)
        if not intro:
            motif = motifs['ABC'.index(sec)]
            half = (b % 2) * 8
            for e in range(8):
                d = motif[half + e]
                if d is None: continue
                if outro and e > 3: break
                m = degree_to_midi(root, scale, d + (deg if sec == 'C' else 0), 1 if lead != 'bell' else 1)
                sw = swing * eighth if e % 2 else 0.0
                n = int(eighth * (1.6 if lead == 'bell' else 0.85) * SR)
                vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * np.arange(n) / SR)
                sig = osc(lead, midi(m), n, duty=0.5) if lead != 'bell' else osc('bell', midi(m), n)
                sig = sig * vib ** 0 * adsr(n, 0.008, 0.08, 0.55 if lead != 'bell' else 0.2, 0.06)
                put(buf, bs + int((e * eighth + sw) * SR), sig, 0.12 if lead == 'square' else 0.17, pan=-0.15)
        # drums
        if drums != 'none' and not intro:
            for e in range(8):
                t0 = bs + int((e * eighth + (swing * eighth if e % 2 else 0)) * SR)
                if drums == 'full':
                    if e in (0, 4) or (e == 7 and b % 4 == 3): put(buf, t0, K, 0.55)
                    if e in (2, 6): put(buf, t0, S, 0.28)
                    put(buf, t0, HO if e == 7 else H, 0.16, pan=0.3)
                else:
                    if e == 0: put(buf, t0, K, 0.4)
                    if e == 4: put(buf, t0, S, 0.15)
                    if e % 2 == 0: put(buf, t0, H, 0.1, pan=0.3)
    # simple stereo echo for space
    d = int(beat * 0.75 * SR)
    echo = np.zeros_like(buf); echo[d:] = buf[:-d] * 0.22
    buf[:, 0] += echo[:, 1]; buf[:, 1] += echo[:, 0]
    # fades + normalise
    fi, fo = int(0.8 * SR), int(2.5 * SR)
    buf[:fi] *= np.linspace(0, 1, fi)[:, None]
    buf[-fo:] *= np.linspace(1, 0, fo)[:, None]
    buf /= max(1e-6, np.max(np.abs(buf))) / 0.85
    return buf

# ---------- SFX ----------
def sfx_defs(rng):
    def tone(notes, dur, kind='square', decay=10.0, slide=0.0, gain=0.8):
        n = int(dur * SR); out = np.zeros(n)
        step = n // len(notes)
        for i, f in enumerate(notes):
            seg = n - i * step
            t = np.arange(seg) / SR
            ff = f * (1 + slide * t)
            ph = np.cumsum(ff) / SR
            fr = ph % 1.0
            w = {'square': np.where(fr < 0.5, 1.0, -1.0), 'tri': 4 * np.abs(fr - 0.5) - 1, 'sine': np.sin(2 * np.pi * ph)}[kind]
            out[i * step:] += w * np.exp(-t * decay) * (0.9 ** i)
        return out * gain
    def crunch(dur, cutoff, gain=0.9, pitch=None):
        n = int(dur * SR); t = np.arange(n) / SR
        x = lowpass(noise(n, rng), cutoff) * 3
        if pitch: x += 0.4 * np.sin(2 * np.pi * pitch * t * (1 - 0.5 * t / dur))
        return x * np.exp(-t * (6 / dur)) * gain
    def mix(*xs):
        out = np.zeros(max(len(x) for x in xs))
        for x in xs: out[:len(x)] += x
        return out
    return {
        'ui': tone([880], 0.06, 'tri', 40),
        'ui_open': tone([660, 990], 0.12, 'tri', 22),
        'ui_close': tone([990, 660], 0.12, 'tri', 22),
        'place': np.concatenate([crunch(0.05, 1800, 0.6), tone([196, 262], 0.08, 'tri', 30)]),
        'hit': crunch(0.07, 2600, 0.7, pitch=160),
        'break': crunch(0.22, 1200, 1.0, pitch=110),
        'break_glass': mix(tone([2093, 2637, 3136, 2349], 0.3, 'sine', 14, gain=0.5), crunch(0.3, 6000, 0.35)),
        'footstep': crunch(0.05, 700, 0.5),
        'jump': tone([330], 0.14, 'square', 14, slide=4.0, gain=0.45),
        'land': crunch(0.06, 500, 0.7),
        'harvest': tone([784, 1046, 1318], 0.22, 'tri', 12),
        'plant': mix(tone([392, 523], 0.12, 'tri', 20), crunch(0.12, 900, 0.3)),
        'craft': tone([523, 659, 784, 1046], 0.3, 'square', 9, gain=0.4),
        'splice': tone([523, 698, 880, 1175, 1397], 0.45, 'sine', 6),
        'buy': tone([1046, 1318], 0.16, 'square', 16, gain=0.4),
        'sell': tone([1318, 1046, 1568], 0.2, 'square', 14, gain=0.4),
        'coin': tone([1568, 2093], 0.18, 'square', 18, gain=0.35),
        'trade': tone([392, 494, 587, 784], 0.3, 'tri', 9),
        'levelup': tone([523, 659, 784, 1046, 1318], 0.7, 'square', 4, gain=0.4),
        'achievement': tone([659, 880, 1175, 1568], 0.55, 'tri', 5),
        'daily': tone([784, 988, 1175, 1568, 1976], 0.8, 'sine', 3.5),
        'pm': tone([1175, 1568], 0.18, 'sine', 14),
        'error': tone([220, 165], 0.22, 'square', 12, gain=0.35),
        'thunder': crunch(1.4, 220, 1.0),
        'door': mix(crunch(0.12, 900, 0.6, pitch=90), tone([147], 0.12, 'tri', 25, gain=0.4)),
        'lock': mix(tone([523, 392, 784], 0.35, 'square', 8, gain=0.4), crunch(0.1, 3000, 0.3)),
    }

def write_wav(path, data, stereo):
    data = np.clip(data, -1, 1)
    pcm = (data * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2 if stereo else 1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())

def encode(wav, ogg, q, title=None):
    cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', str(q)]
    if title: cmd += ['-metadata', f'title={title}', '-metadata', 'artist=Pixeltopia (original, generated)']
    subprocess.run(cmd + [ogg], check=True)

def main():
    os.makedirs(MUSIC_DIR, exist_ok=True); os.makedirs(SFX_DIR, exist_ok=True)
    only = set(sys.argv[1:])
    with tempfile.TemporaryDirectory() as td:
        if not only or 'sfx' in only:
            rng = np.random.default_rng(7)
            for k, v in sfx_defs(rng).items():
                v = v / max(1e-6, np.max(np.abs(v))) * 0.8
                fade = min(len(v), int(0.01 * SR)); v[-fade:] *= np.linspace(1, 0, fade)
                w = os.path.join(td, k + '.wav'); write_wav(w, v, False); encode(w, os.path.join(SFX_DIR, k + '.ogg'), 4)
        if not only or 'music' in only:
            for spec in TRACKS:
                buf = render_track(spec)
                w = os.path.join(td, spec[0] + '.wav'); write_wav(w, buf, True)
                encode(w, os.path.join(MUSIC_DIR, spec[0] + '.ogg'), 5, spec[1])
                print(spec[0], f'{len(buf)/SR:.0f}s', os.path.getsize(os.path.join(MUSIC_DIR, spec[0] + '.ogg')) // 1024, 'KB')

if __name__ == '__main__':
    main()
