#!/usr/bin/env python3
"""Pixeltopia v1.9 "Soundtrack Vol. 2" + ambience generator.

Fully original: every note and sound is synthesised here with numpy (no samples, no third-party audio).
Compared with v1.8 (gen_audio.py) these pieces are longer multi-section compositions (intro / verse /
chorus / bridge / key change / outro) with 7th chords, FM electric piano, detuned pads, flute, marimba,
plucked strings, drum fills and a synthetic convolution reverb, encoded at higher quality (Vorbis q7).

  python3 tools/audio/gen_music_v19.py              -> assets/audio/music2/*.ogg + assets/audio/ambience/*.ogg
  python3 tools/audio/gen_music_v19.py 3 7          -> only track numbers 3 and 7
  python3 tools/audio/gen_music_v19.py ambience     -> only ambience loops
Deterministic (seeded). Needs numpy, scipy, ffmpeg (libvorbis).
"""
import os, subprocess, sys, tempfile, wave
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

SR = 44100
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'audio', 'music2')
AMB = os.path.join(ROOT, 'assets', 'audio', 'ambience')

def midi(n): return 440.0 * 2 ** ((n - 69) / 12.0)

SCALES = {
    'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10], 'dorian': [0, 2, 3, 5, 7, 9, 10],
    'mixo': [0, 2, 4, 5, 7, 9, 10], 'lydian': [0, 2, 4, 6, 7, 9, 11], 'harm': [0, 2, 3, 5, 7, 8, 11],
    'phryg': [0, 1, 3, 5, 7, 8, 10],
}

# ---------- instruments (all return mono float arrays) ----------
def t_axis(n): return np.arange(n) / SR

def env(n, a=0.01, d=0.1, s=0.6, r=0.1):
    e = np.full(n, float(s))
    a_n = max(1, min(n, int(a * SR))); d_n = int(d * SR); r_n = min(n, int(r * SR))
    e[:a_n] = np.linspace(0, 1, a_n)
    de = min(n, a_n + d_n)
    if de > a_n: e[a_n:de] = np.linspace(1, s, de - a_n)
    if r_n > 0: e[-r_n:] *= np.linspace(1, 0, r_n)
    return e

def inst(kind, f, dur, rng, vel=1.0):
    n = max(64, int(dur * SR)); t = t_axis(n)
    if kind == 'epiano':  # 2-operator FM, bell-ish attack
        idx = 2.2 * np.exp(-t * 6)
        x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * env(n, 0.003, 0.6, 0.25, 0.25)
        x += 0.15 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 3)
    elif kind == 'pad':  # 5 detuned saws, band-limited by smoothing
        x = np.zeros(n)
        for dt in (-0.12, -0.05, 0.0, 0.06, 0.11):
            ph = (t * f * (1 + dt / 100 * 3) + rng.random()) % 1.0
            x += 2 * ph - 1
        x = lp(x / 5, min(2400, f * 6)) * env(n, 0.6, 0.5, 0.8, 0.8)
    elif kind == 'flute':
        vib = 1 + 0.005 * np.sin(2 * np.pi * 5.2 * t) * np.clip(t * 3, 0, 1)
        ph = np.cumsum(f * vib) / SR
        x = np.sin(2 * np.pi * ph) + 0.18 * np.sin(4 * np.pi * ph) + 0.06 * np.sin(6 * np.pi * ph)
        x += 0.05 * lp(rng.uniform(-1, 1, n), 3000)
        x *= env(n, 0.06, 0.1, 0.8, 0.12)
    elif kind == 'marimba':
        x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 9) + 0.35 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t * 28)
             + 0.1 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t * 60))
        x *= env(n, 0.001, 0.05, 1.0, 0.05)
    elif kind == 'pluck':  # string-like: sum of decaying partials with brighter attack
        x = np.zeros(n)
        for k in range(1, 9):
            x += np.sin(2 * np.pi * f * k * t + rng.random()) * np.exp(-t * (2.5 + k * 1.8)) / k ** 1.1
        x *= env(n, 0.002, 0.05, 1.0, 0.08)
    elif kind == 'chip':  # pulse lead (nod to v1.8)
        ph = (t * f) % 1.0
        x = np.where(ph < 0.25, 1.0, -1.0) * 0.5 * env(n, 0.005, 0.08, 0.6, 0.06)
        x = lp(x, 5000)
    elif kind == 'bell':
        x = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.4 * t) * np.exp(-t * 2)
             + 0.25 * np.sin(2 * np.pi * f * 5.95 * t) * np.exp(-t * 5)) * np.exp(-t * 1.5) * env(n, 0.002, 0.1, 1, 0.2)
    elif kind == 'sub':
        x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
        x *= env(n, 0.005, 0.15, 0.7, 0.06)
    elif kind == 'synbass':
        ph = (t * f) % 1.0
        x = lp(2 * ph - 1, 300 + 1500 * 0 + 900 * np.exp(-0)) * env(n, 0.004, 0.12, 0.6, 0.05)
        x = 0.7 * x + 0.5 * np.sin(2 * np.pi * f * t) * env(n, 0.004, 0.12, 0.6, 0.05)
    elif kind == 'strings':
        x = np.zeros(n)
        for dt in (-0.07, 0.0, 0.08):
            vib = 1 + 0.004 * np.sin(2 * np.pi * (5 + dt * 10) * t)
            ph = (np.cumsum(f * (1 + dt / 100) * vib) / SR) % 1.0
            x += 2 * ph - 1
        x = lp(x / 3, 1800) * env(n, 0.25, 0.3, 0.85, 0.4)
    else:
        raise ValueError(kind)
    return x * vel

def lp(x, cut):
    cut = float(np.clip(cut, 40, SR * 0.45))
    return sosfilt(butter(2, cut / (SR / 2), 'low', output='sos'), x)

def hp(x, cut):
    return sosfilt(butter(2, cut / (SR / 2), 'high', output='sos'), x)

# ---------- drums ----------
def kick(rng, tone=48):
    n = int(0.3 * SR); t = t_axis(n)
    ph = np.cumsum(140 * np.exp(-t * 22) + tone) / SR
    return np.sin(2 * np.pi * ph) * np.exp(-t * 9) + 0.15 * rng.uniform(-1, 1, n) * np.exp(-t * 200)

def snare(rng):
    n = int(0.25 * SR); t = t_axis(n)
    return hp(rng.uniform(-1, 1, n), 1200) * np.exp(-t * 18) * 0.8 + 0.4 * np.sin(2 * np.pi * 185 * t) * np.exp(-t * 30)

def hat(rng, open_=False):
    n = int((0.25 if open_ else 0.05) * SR); t = t_axis(n)
    return hp(rng.uniform(-1, 1, n), 7000) * np.exp(-t * (14 if open_ else 90))

def shaker(rng):
    n = int(0.07 * SR); t = t_axis(n)
    return hp(rng.uniform(-1, 1, n), 5000) * np.sin(np.pi * np.clip(t / 0.07, 0, 1)) * 0.6

def tom(rng, f):
    n = int(0.3 * SR); t = t_axis(n)
    ph = np.cumsum(f * (1 + 0.6 * np.exp(-t * 15))) / SR
    return np.sin(2 * np.pi * ph) * np.exp(-t * 10)

def clap(rng):
    n = int(0.2 * SR); t = t_axis(n); x = hp(rng.uniform(-1, 1, n), 1500)
    e = np.exp(-t * 25)
    for k in (0.01, 0.02): e += np.roll(np.exp(-t * 120), int(k * SR))
    return x * e * 0.5

# ---------- mixing ----------
class Mix:
    def __init__(self, n):
        self.dry = np.zeros((n, 2)); self.send = np.zeros((n, 2))
    def put(self, at, sig, gain=1.0, pan=0.0, rev=0.25):
        at = int(at)
        if at >= len(self.dry): return
        end = min(len(self.dry), at + len(sig)); s = sig[:end - at] * gain
        l = np.sqrt(0.5 * (1 - pan)); r = np.sqrt(0.5 * (1 + pan))
        self.dry[at:end, 0] += s * l; self.dry[at:end, 1] += s * r
        if rev > 0:
            self.send[at:end, 0] += s * l * rev; self.send[at:end, 1] += s * r * rev

def reverb_ir(rng, secs=2.4, damp=3.0):
    n = int(secs * SR); t = t_axis(n)
    ir = np.zeros((n, 2))
    for c in range(2):
        x = rng.uniform(-1, 1, n) * np.exp(-t * damp)
        ir[:, c] = lp(x, 6000) 
    ir[: int(0.012 * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True))

def chord_notes(root, scale, deg, seventh=True, inv=0):
    s = SCALES[scale]
    def d2m(d):
        o, i = divmod(d, len(s)); return root + s[i] + 12 * o
    notes = [d2m(deg), d2m(deg + 2), d2m(deg + 4)] + ([d2m(deg + 6)] if seventh else [])
    for _ in range(inv): notes = notes[1:] + [notes[0] + 12]
    return notes

def d2m(root, scale, d):
    s = SCALES[scale]; o, i = divmod(d, len(s)); return root + s[i] + 12 * o

# ---------- composition ----------
# (file, title, root, scale, bpm, lead, keys, pad, groove, seed, minutes, mood)
TRACKS = [
    ('12_sunrise_over_pixeltopia', 'Sunrise over Pixeltopia', 62, 'major', 96, 'flute', 'epiano', 'pad', 'soft', 201, 3.8, 'bright'),
    ('13_tilled_soil', 'Tilled Soil', 60, 'mixo', 112, 'pluck', 'marimba', 'strings', 'shuffle', 202, 3.6, 'bright'),
    ('14_greenhouse_jam', 'Greenhouse Jam', 65, 'dorian', 118, 'chip', 'epiano', 'pad', 'funk', 203, 3.7, 'groove'),
    ('15_lanterns_at_dusk', 'Lanterns at Dusk', 57, 'minor', 82, 'flute', 'epiano', 'strings', 'soft', 204, 4.0, 'calm'),
    ('16_deep_mine_shuffle', 'Deep Mine Shuffle', 52, 'phryg', 100, 'pluck', 'marimba', 'pad', 'shuffle', 205, 3.6, 'dark'),
    ('17_crystal_caverns', 'Crystal Caverns', 56, 'harm', 88, 'bell', 'marimba', 'pad', 'sparse', 206, 3.9, 'dark'),
    ('18_trade_plaza', 'Trade Plaza', 64, 'major', 124, 'chip', 'epiano', 'strings', 'four', 207, 3.5, 'groove'),
    ('19_cloud_gardens', 'Cloud Gardens', 66, 'lydian', 90, 'flute', 'bell', 'pad', 'soft', 208, 3.9, 'calm'),
    ('20_lockkeepers_rest', "Lockkeeper's Rest", 58, 'dorian', 76, 'epiano', 'epiano', 'strings', 'sparse', 209, 4.1, 'calm'),
    ('21_rainy_rooftops', 'Rainy Rooftops', 61, 'minor', 92, 'pluck', 'epiano', 'pad', 'funk', 210, 3.8, 'groove'),
    ('22_harvest_festival', 'Harvest Festival', 67, 'mixo', 132, 'flute', 'marimba', 'strings', 'four', 211, 3.5, 'bright'),
    ('23_moonlit_orchard', 'Moonlit Orchard', 55, 'minor', 70, 'bell', 'epiano', 'pad', 'none', 212, 4.0, 'calm'),
    ('24_builders_anthem', "Builder's Anthem", 60, 'major', 128, 'chip', 'marimba', 'strings', 'four', 213, 3.6, 'bright'),
    ('25_desert_mirage', 'Desert Mirage', 62, 'harm', 104, 'flute', 'pluck', 'pad', 'shuffle', 214, 3.7, 'dark'),
    ('26_snowfall_village', 'Snowfall Village', 63, 'major', 84, 'bell', 'epiano', 'strings', 'sparse', 215, 3.9, 'calm'),
    ('27_sky_island_chase', 'Sky Island Chase', 59, 'dorian', 140, 'chip', 'pluck', 'pad', 'four', 216, 3.4, 'groove'),
    ('28_world_lock_waltz', 'World Lock Waltz', 65, 'major', 108, 'flute', 'marimba', 'strings', 'waltz', 217, 3.6, 'bright'),
    ('29_seed_vault_lullaby', 'Seed Vault Lullaby', 60, 'lydian', 66, 'bell', 'epiano', 'pad', 'none', 218, 4.0, 'calm'),
]

PROGS = {
    'bright': [[0, 4, 5, 3], [0, 5, 3, 4], [3, 4, 2, 5], [0, 3, 4, 4]],
    'calm': [[0, 5, 3, 4], [0, 2, 5, 4], [3, 0, 4, 5], [5, 3, 0, 4]],
    'groove': [[0, 0, 3, 4], [0, 6, 5, 4], [1, 4, 0, 5], [3, 4, 0, 0]],
    'dark': [[0, 5, 6, 4], [0, 3, 4, 0], [5, 6, 0, 0], [0, 1, 0, 6]],
}

def make_melody(rng, steps, start):
    """Phrase in scale degrees on a 16th grid; None = rest, (deg, len16)."""
    m = []; d = start; pos = 0
    while pos < steps:
        ln = int(rng.choice([2, 2, 2, 4, 4, 1, 1, 6, 8], p=[.18, .18, .14, .14, .1, .08, .06, .06, .06]))
        ln = min(ln, steps - pos)
        if rng.random() < 0.16: m.append((pos, None, ln))
        else:
            d = int(np.clip(d + rng.choice([-3, -2, -1, -1, 0, 1, 1, 2, 2, 4]), -3, 11)); m.append((pos, d, ln))
        pos += ln
    return m

def render(spec):
    name, title, root, scale, bpm, lead, keys, padk, groove, seed, minutes, mood = spec
    rng = np.random.default_rng(seed)
    beats_per_bar = 3 if groove == 'waltz' else 4
    beat = 60.0 / bpm; bar = beats_per_bar * beat; s16 = beat / 4
    total_bars = int(minutes * 60 / bar)
    # song form, in 8-bar blocks
    blocks = max(6, total_bars // 8)
    form = ['intro', 'verse', 'verse', 'chorus', 'break', 'verse', 'chorus', 'bridge', 'chorus_up', 'chorus_up', 'outro']
    while len(form) < blocks: form.insert(-3, rng.choice(['verse', 'chorus', 'break']))
    form = form[:blocks - 1] + ['outro']
    total = int(len(form) * 8 * bar * SR) + int(4 * SR)
    mx = Mix(total)
    K, S, H, HO, SH, CL = kick(rng), snare(rng), hat(rng), hat(rng, True), shaker(rng), clap(rng)
    TOMS = [tom(rng, f) for f in (110, 150, 200)]
    progs = PROGS[mood]
    prog_v, prog_c, prog_b = progs[int(rng.integers(0, 4))], progs[int(rng.integers(0, 4))], progs[int(rng.integers(0, 4))]
    steps_bar = beats_per_bar * 4
    mel_v = [make_melody(rng, steps_bar * 2, int(rng.integers(2, 6))) for _ in range(2)]
    mel_c = [make_melody(rng, steps_bar * 2, int(rng.integers(4, 8))) for _ in range(2)]
    mel_b = make_melody(rng, steps_bar * 4, 3)
    _bp = [[0, 8], [0, 6, 8, 14], [0, 3, 8, 11], [0, 4, 8, 12], [0, 10]]
    bass_pat = _bp[int(rng.integers(0, len(_bp)))]
    lead_oct = {'flute': 12, 'bell': 12, 'chip': 12, 'pluck': 12, 'epiano': 12}[lead]
    for bi, sec in enumerate(form):
        key_shift = 2 if sec == 'chorus_up' else 0
        r = root + key_shift
        prog = prog_c if sec.startswith('chorus') else prog_b if sec == 'bridge' else prog_v
        for b8 in range(8):
            b = bi * 8 + b8
            t0 = b * bar
            deg = prog[(b8 // (1 if beats_per_bar == 3 else 2)) % 4] if sec != 'bridge' else prog[b8 % 4]
            if sec in ('verse', 'chorus', 'chorus_up', 'outro', 'intro'):
                deg = prog[(b8 // 2) % 4]
            ch = chord_notes(r, scale, deg, seventh=(mood != 'bright' or sec == 'bridge'), inv=b8 % 2)
            fade_out = sec == 'outro' and b8 >= 4
            intensity = {'intro': 0.5, 'verse': 0.75, 'chorus': 1.0, 'chorus_up': 1.0, 'break': 0.45, 'bridge': 0.7, 'outro': 0.55}[sec]
            # pad / strings: whole bar
            if not (sec == 'intro' and b8 < 2):
                for m in ch[:3]:
                    sig = inst(padk, midi(m - 12), bar + 0.4, rng)
                    mx.put(t0 * SR, sig, 0.07 * intensity, pan=rng.uniform(-0.4, 0.4), rev=0.6)
            # keys comping
            if sec != 'break' or b8 % 2 == 0:
                if groove in ('funk', 'four', 'shuffle'):
                    hits = [0, 6, 10] if groove == 'funk' else [4, 12] if groove == 'four' else [0, 6, 8, 14]
                elif groove == 'waltz':
                    hits = [4, 8]
                else:
                    hits = [0]
                for h in hits:
                    if h >= steps_bar: continue
                    dur = (bar if hits == [0] else s16 * 3)
                    for k, m in enumerate(ch):
                        sig = inst(keys, midi(m), dur + 0.3, rng, vel=0.8 + 0.2 * rng.random())
                        mx.put((t0 + h * s16 + k * 0.012) * SR, sig, 0.06, pan=-0.25 + 0.15 * k, rev=0.35)
            # arpeggio in chorus / bridge
            if sec in ('chorus', 'chorus_up', 'bridge') or (sec == 'verse' and mood == 'groove'):
                pat = [0, 1, 2, 3, 2, 1] if beats_per_bar == 3 else [0, 1, 2, 3, 2, 1, 2, 3]
                for i in range(steps_bar // 2):
                    m = ch[pat[i % len(pat)] % len(ch)] + 12
                    sig = inst('marimba' if keys != 'marimba' else 'bell', midi(m), s16 * 2.5, rng, 0.7)
                    mx.put((t0 + i * 2 * s16) * SR, sig, 0.035 * intensity, pan=0.45 * np.sin(i * 0.9), rev=0.4)
            # bass
            if not (sec == 'intro' and b8 < 4) and not fade_out:
                bn = d2m(r, scale, deg) - 24
                for k, st in enumerate(bass_pat):
                    if st >= steps_bar: continue
                    note = bn + (12 if (k == len(bass_pat) - 1 and b8 % 2 == 1) else 0)
                    dur = s16 * (min(4, steps_bar - st) if groove != 'none' else steps_bar)
                    kind = 'synbass' if groove in ('funk', 'four') else 'sub'
                    mx.put((t0 + st * s16) * SR, inst(kind, midi(note), dur, rng), 0.3 * max(0.6, intensity), rev=0.05)
            # lead melody
            if sec not in ('intro', 'break') and not fade_out:
                if sec == 'bridge':
                    phrase = [(p - (b8 % 4) * steps_bar, d, l) for (p, d, l) in mel_b if (b8 % 4) * steps_bar <= p < (b8 % 4 + 1) * steps_bar]
                else:
                    src = (mel_c if sec.startswith('chorus') else mel_v)[(b8 // 4) % 2]
                    half = (b8 % 2) * steps_bar
                    phrase = [(p - half, d, l) for (p, d, l) in src if half <= p < half + steps_bar]
                    # answer phrase variation on bars 6-7
                    if b8 >= 6:
                        phrase = [(p, (d + 2) if d is not None else None, l) for (p, d, l) in phrase]
                for (p, d, l) in phrase:
                    if d is None: continue
                    m = d2m(r, scale, d) + lead_oct
                    swing = (s16 * 0.33 if (groove == 'shuffle' and p % 2 == 1) else 0)
                    sig = inst(lead, midi(m), l * s16 * 1.05 + 0.05, rng, vel=0.85 + 0.15 * rng.random())
                    mx.put((t0 + p * s16 + swing) * SR, sig, 0.11 if lead != 'chip' else 0.07, pan=-0.1, rev=0.45)
                    # harmony a third below in chorus_up
                    if sec == 'chorus_up':
                        sig2 = inst('strings' if lead != 'strings' else 'flute', midi(d2m(r, scale, d - 2) + lead_oct), l * s16 + 0.1, rng)
                        mx.put((t0 + p * s16 + swing) * SR, sig2, 0.04, pan=0.3, rev=0.5)
            # intro / break: bell motif
            if sec in ('intro', 'break') and b8 % 2 == 0:
                for i, dd in enumerate([4, 2, 0] if b8 % 4 == 0 else [5, 4, 2]):
                    mx.put((t0 + i * beat) * SR, inst('bell', midi(d2m(r, scale, deg + dd) + 12), beat * 2, rng), 0.05, pan=0.3, rev=0.7)
            # drums
            if groove != 'none' and sec not in ('intro',) and not fade_out:
                if sec == 'break' and groove not in ('four', 'funk'):
                    pass
                else:
                    sw = s16 * 0.33 if groove == 'shuffle' else 0
                    for st in range(steps_bar):
                        at = t0 + st * s16 + (sw if st % 2 else 0)
                        if groove == 'four':
                            if st % 4 == 0: mx.put(at * SR, K, 0.5, rev=0.05)
                            if st in (4, 12): mx.put(at * SR, CL if sec.startswith('chorus') else S, 0.25, rev=0.2)
                            if st % 4 == 2: mx.put(at * SR, HO, 0.08, pan=0.3, rev=0.1)
                            elif st % 2 == 0: mx.put(at * SR, H, 0.07, pan=0.3, rev=0.05)
                        elif groove == 'funk':
                            if st in (0, 7, 10): mx.put(at * SR, K, 0.5, rev=0.05)
                            if st in (4, 12): mx.put(at * SR, S, 0.28, rev=0.2)
                            mx.put(at * SR, H, 0.05 + 0.03 * (st % 2 == 0), pan=0.3, rev=0.05)
                        elif groove == 'shuffle':
                            if st in (0, 8) or (st == 14 and b8 % 2): mx.put(at * SR, K, 0.45, rev=0.05)
                            if st in (4, 12): mx.put(at * SR, S, 0.22, rev=0.25)
                            if st % 2 == 0: mx.put(at * SR, SH, 0.08, pan=-0.3, rev=0.1)
                        elif groove == 'waltz':
                            if st == 0: mx.put(at * SR, K, 0.45, rev=0.05)
                            if st in (4, 8): mx.put(at * SR, SH, 0.1, pan=0.3, rev=0.1)
                            if st == 8 and b8 % 2: mx.put(at * SR, S, 0.12, rev=0.3)
                        elif groove in ('soft', 'sparse'):
                            if st == 0 or (groove == 'soft' and st == 10): mx.put(at * SR, K, 0.32, rev=0.1)
                            if st == 8 and groove == 'soft': mx.put(at * SR, S, 0.12, rev=0.35)
                            if st % 4 == 2: mx.put(at * SR, SH, 0.06, pan=0.4, rev=0.15)
                    # fill on the last bar of a block
                    if b8 == 7 and sec != 'outro':
                        for i in range(4):
                            mx.put((t0 + (steps_bar - 4 + i) * s16) * SR, TOMS[2 - min(2, i)], 0.22, pan=-0.3 + 0.2 * i, rev=0.2)
                    if b8 == 0 and sec.startswith('chorus'):
                        mx.put(t0 * SR, HO, 0.15, rev=0.4)
    # final chord
    end_t = len(form) * 8 * bar
    for m in chord_notes(root, scale, 0, seventh=False):
        mx.put((end_t - bar * 2) * SR, inst('pad', midi(m), bar * 2 + 3, rng), 0.06, rev=0.8)
        mx.put((end_t - bar * 2) * SR, inst('bell', midi(m + 12), 3, rng), 0.05, rev=0.8)
    ir = reverb_ir(rng, 2.8 if mood == 'calm' else 2.0, 2.4 if mood == 'calm' else 3.2)
    wet = np.stack([fftconvolve(mx.send[:, c], ir[:, c])[:total] for c in range(2)], axis=1)
    out = mx.dry + 0.5 * wet
    out[:, 0] = hp(out[:, 0], 30); out[:, 1] = hp(out[:, 1], 30)
    # gentle bus compression (soft clip) + normalise
    out = out / max(1e-6, np.percentile(np.abs(out), 99.9)) * 0.7
    out = np.tanh(out * 1.2) / np.tanh(1.2)
    fi, fo = int(0.5 * SR), int(4 * SR)
    out[:fi] *= np.linspace(0, 1, fi)[:, None]; out[-fo:] *= np.linspace(1, 0, fo)[:, None]
    return out * 0.92

# ---------- ambience loops (seamless) ----------
def crossfade_loop(x, xf):
    n = int(xf * SR); head = x[:n].copy(); body = x[n:].copy()
    ramp = np.linspace(0, 1, n)[:, None] if x.ndim == 2 else np.linspace(0, 1, n)
    body[-n:] = body[-n:] * (1 - ramp) + head * ramp
    return body

def amb_birds(rng, secs):
    n = int(secs * SR); out = np.zeros((n, 2))
    wind = lp(rng.uniform(-1, 1, n), 400) * 0.25
    out += np.stack([wind, np.roll(wind, 2000)], 1)
    t = 0.0
    while t < secs - 2:
        f0 = rng.uniform(2200, 4200); calls = int(rng.integers(2, 7)); pan = rng.uniform(-0.8, 0.8)
        for c in range(calls):
            d = rng.uniform(0.05, 0.16); m = int(d * SR); tt = t_axis(m)
            sweep = f0 * (1 + rng.uniform(-0.25, 0.3) * tt / d)
            s = np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.sin(np.pi * tt / d) ** 2
            at = int((t + c * d * 1.4) * SR)
            if at + m < n:
                out[at:at + m, 0] += s * 0.25 * np.sqrt(0.5 * (1 - pan)); out[at:at + m, 1] += s * 0.25 * np.sqrt(0.5 * (1 + pan))
        t += rng.uniform(0.8, 3.5)
    return out

def amb_night(rng, secs):
    n = int(secs * SR); out = np.zeros((n, 2)); t = t_axis(n)
    for k in range(5):  # cricket choruses
        f = rng.uniform(3800, 5200); rate = rng.uniform(14, 22); pan = rng.uniform(-0.9, 0.9)
        chirp = (np.sin(2 * np.pi * rate * t + rng.random() * 6) > 0.6).astype(float)
        gate = lp(chirp, 80) * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(0.05, 0.15) * t + rng.random() * 6)) ** 2
        s = np.sin(2 * np.pi * f * t) * gate * 0.08
        out[:, 0] += s * np.sqrt(0.5 * (1 - pan)); out[:, 1] += s * np.sqrt(0.5 * (1 + pan))
    tt = 0.0
    while tt < secs - 3:  # distant owl-ish hoots
        tt += rng.uniform(6, 14)
        for h in range(2):
            m = int(0.35 * SR); x = t_axis(m)
            s = np.sin(2 * np.pi * 380 * x * (1 - 0.06 * x)) * np.sin(np.pi * x / 0.35) ** 2 * 0.12
            at = int((tt + h * 0.5) * SR)
            if at + m < n: out[at:at + m] += s[:, None] * np.array([0.7, 0.4])
    out += lp(rng.uniform(-1, 1, (n, 2)), 250) * 0.06
    return out

def amb_cave(rng, secs):
    n = int(secs * SR); out = np.zeros((n, 2))
    rumble = lp(rng.uniform(-1, 1, n), 90) * 0.5
    out += np.stack([rumble, np.roll(rumble, 3000)], 1)
    t = 0.0
    while t < secs - 1:
        t += rng.uniform(0.6, 2.8)
        f = rng.uniform(900, 2200); m = int(0.25 * SR); x = t_axis(m)
        drip = np.sin(2 * np.pi * f * x * (1 + 0.8 * np.exp(-x * 40))) * np.exp(-x * 25) * 0.3
        at = int(t * SR); pan = rng.uniform(-0.8, 0.8)
        if at + m < n:
            out[at:at + m, 0] += drip * np.sqrt(0.5 * (1 - pan)); out[at:at + m, 1] += drip * np.sqrt(0.5 * (1 + pan))
    ir = reverb_ir(rng, 3.5, 1.6)
    wet = np.stack([fftconvolve(out[:, c], ir[:, c])[:n] for c in range(2)], 1)
    return out * 0.6 + wet * 0.5

def amb_wind(rng, secs):
    n = int(secs * SR); t = t_axis(n)
    gust = 0.5 + 0.5 * lp(rng.uniform(-1, 1, n), 0.6) * 40
    gust = np.clip(gust, 0.1, 1.6)
    l = lp(hp(rng.uniform(-1, 1, n), 200), 900) * gust; r = lp(hp(rng.uniform(-1, 1, n), 200), 1100) * gust[::-1]
    whistle = np.sin(2 * np.pi * (620 + 80 * np.sin(2 * np.pi * 0.07 * t)) * t) * np.clip(gust - 0.9, 0, 1) * 0.08
    return np.stack([l + whistle, r + whistle], 1) * 0.5

def amb_rain(rng, secs):
    n = int(secs * SR)
    base = np.stack([lp(hp(rng.uniform(-1, 1, n), 400), 5000), lp(hp(rng.uniform(-1, 1, n), 400), 5000)], 1) * 0.35
    drops = np.zeros((n, 2))
    for _ in range(int(secs * 30)):
        at = int(rng.uniform(0, n - 3000)); m = int(rng.uniform(0.01, 0.04) * SR); x = t_axis(m)
        d = hp(rng.uniform(-1, 1, m), 2000) * np.exp(-x * 120) * rng.uniform(0.1, 0.5)
        c = int(rng.integers(0, 2)); drops[at:at + m, c] += d
    return base + drops

def amb_ocean(rng, secs):
    n = int(secs * SR); t = t_axis(n)
    swell = (0.55 + 0.45 * np.sin(2 * np.pi * t / 7.5)) ** 2
    x = np.stack([lp(rng.uniform(-1, 1, n), 700), lp(rng.uniform(-1, 1, n), 800)], 1)
    return x * swell[:, None] * 0.9 + np.stack([hp(rng.uniform(-1, 1, n), 3000)] * 2, 1) * (swell ** 3)[:, None] * 0.05

AMBIENCE = [('day_birds', amb_birds, 75), ('night_crickets', amb_night, 75), ('cave_drips', amb_cave, 70),
            ('mountain_wind', amb_wind, 70), ('rain_heavy', amb_rain, 60), ('ocean_shore', amb_ocean, 60)]

# ---------- io ----------
def write_wav(path, data):
    data = np.clip(data, -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((data * 32767).astype('<i2').tobytes())

def encode(wav, ogg, q, title, album):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', str(q),
                    '-metadata', f'title={title}', '-metadata', 'artist=Pixeltopia (original, generated)',
                    '-metadata', f'album={album}', ogg], check=True)

def main():
    os.makedirs(OUT, exist_ok=True); os.makedirs(AMB, exist_ok=True)
    args = sys.argv[1:]
    nums = {int(a) for a in args if a.isdigit()}
    with tempfile.TemporaryDirectory() as td:
        if not args or 'ambience' in args:
            for i, (nm, fn, secs) in enumerate(AMBIENCE):
                x = fn(np.random.default_rng(900 + i), secs + 4)
                x = crossfade_loop(x, 4)
                x = x / max(1e-6, np.max(np.abs(x))) * 0.8
                w = os.path.join(td, nm + '.wav'); write_wav(w, x)
                o = os.path.join(AMB, nm + '.ogg'); encode(w, o, 5, nm.replace('_', ' ').title(), 'Pixeltopia Ambience')
                print('ambience', nm, os.path.getsize(o) // 1024, 'KB', flush=True)
        if not args or nums:
            for spec in TRACKS:
                num = int(spec[0].split('_')[0])
                if nums and num not in nums: continue
                buf = render(spec)
                w = os.path.join(td, spec[0] + '.wav'); write_wav(w, buf)
                o = os.path.join(OUT, spec[0] + '.ogg'); encode(w, o, 7, spec[1], 'Pixeltopia Soundtrack Vol. 2')
                print(spec[0], f'{len(buf) / SR:.0f}s', os.path.getsize(o) // 1024, 'KB', flush=True)
                del buf

if __name__ == '__main__':
    main()
