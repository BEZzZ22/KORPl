# /// script
# requires-python = ">=3.10"
# dependencies = ["librosa>=0.10", "numpy", "scipy", "soundfile"]
# ///
"""Три Аегиса Spirit: drift-phonk bed. 120 BPM, 44 beats = 22 s, F# minor.
808 cowbell hook from frame 0, full groove from b4 (first Aegis), filtered under the bot insert (b24-30),
back full at b30, impact + resolve under the end card (b36-44)."""
import json, os, sys
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy import signal

SKILL = Path(os.environ["MOTION_REEL_SKILL"])
sys.path.insert(0, str(SKILL / "scripts"))
from dsp import *  # noqa

HERE = Path(__file__).resolve().parent
FILM = HERE.parent
BPM = 120
BEAT = 60 / BPM
NB = 44
DUR = NB * BEAT
N = int(SR * DUR)
seed(2026)
T = lambda b: b * BEAT


def cowbell(note, length=0.28):
    n = int(length * SR); t = tvec(n)
    f = hz(note)
    x = np.sign(np.sin(2 * np.pi * f * t)) + 0.8 * np.sign(np.sin(2 * np.pi * f * 1.48 * t))
    x = filt(x, "bandpass", [f * 0.8, f * 4])
    return x * (0.7 * np.exp(-t / 0.03) + 0.3 * np.exp(-t / 0.16)) * (1 - np.exp(-t / 0.001))


def e808(note, length, glide_to=None):
    n = int(length * SR); t = tvec(n)
    f0 = hz(note)
    f = np.full(n, f0) if glide_to is None else f0 * (hz(glide_to) / f0) ** np.clip((t - length * 0.55) / (length * 0.4), 0, 1)
    f = f * (1 + 1.5 * np.exp(-t / 0.012))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    x = np.tanh(2.6 * x) * np.exp(-t / 0.9) * (1 - np.exp(-t / 0.002))
    return x * np.clip((length - t) / 0.03, 0, 1)


def main():
    drums, bass, music, fx = (Bus(DUR, BPM) for _ in range(4))
    # cowbell motif: one bar, 16ths (None = rest)
    A = ["F#5", None, "A5", None, "C#6", "B5", None, "A5", None, "F#5", None, "A5", "B5", None, "C#6", None]
    B = ["E5", None, "G#5", None, "B5", "A5", None, "G#5", None, "E5", None, "F#5", "G#5", None, "A5", None]
    roots = ["F#1", "D1", "E1", "C#1"]
    for bar in range(NB // 4):
        b0 = bar * 4
        if 24 <= b0 < 28: continue  # bot insert: cowbell out (filtered pad carries it)
        pat = A if bar % 2 == 0 else B
        for i, nt in enumerate(pat):
            if nt: music.add(cowbell(nt), b0 + i * 0.25, 0.32 if b0 < 40 else 0.2, pan=0.15 if i % 2 else -0.15)
    for bar in range(NB // 4):
        b0 = bar * 4
        r = roots[bar % 4]
        if b0 >= 40:
            bass.add(e808("F#1", 2.0), b0, 0.9); continue
        bass.add(e808(r, 1.4, glide_to=None), b0, 0.85)
        bass.add(e808(r, 0.9, glide_to=roots[(bar + 1) % 4]), b0 + 2.5, 0.75)
    groove = lambda b: 4 <= b < 24 or 28 <= b < 40
    for b in range(NB):
        if groove(b):
            if b % 4 in (0,):
                drums.add(kick(), b, 0.9)
            if b % 4 == 2:
                drums.add(kick(), b + 0.5, 0.7)
            if b % 2 == 1:
                drums.add(clap(), b, 0.75)
            for s in range(4 if b % 4 == 3 else 2):
                drums.add(hat(), b + s * (0.25 if b % 4 == 3 else 0.5), 0.22, pan=0.2)
        elif b < 4:
            drums.add(hat(), b + 0.5, 0.14)
        elif 24 <= b < 28:
            drums.add(kick(soft=True), b, 0.6) if b % 2 == 0 else None
    # pad under everything, filtered dark in the bot insert
    chords = [["F#3", "A3", "C#4"], ["D3", "F#3", "A3"], ["E3", "G#3", "B3"], ["C#3", "E#3".replace("E#", "F"), "G#3"]]
    for bar in range(NB // 4):
        c = chords[bar % 4]
        cut = (500, 900) if 24 <= bar * 4 < 30 else (1400, 2200)
        music.add(pad_chord(c, 4 * BEAT + 0.2, cut), bar * 4, 0.35)
    # transitions
    fx.add(sub_drop(1.6), 0, 0.9); fx.add(crash(2.0), 0, 0.5)
    r = riser(T(2)); fx.add(r, 2, 0.35)
    for b in (4, 8, 12):
        fx.add(sub_drop(1.0), b, 0.7); fx.add(crash(1.4), b, 0.35)
    fx.add(crash(1.5), 16, 0.3)
    fx.add(riser(T(2)), 22, 0.3)
    fx.add(riser(T(2)), 28, 0.35); fx.add(sub_drop(1.2), 30, 0.7); fx.add(crash(1.6), 30, 0.35)
    fx.add(sub_drop(2.0), 36, 0.9); fx.add(crash(2.5), 36, 0.45)

    kick_t = [T(b) for b in range(NB) if groove(b) and b % 4 == 0] + [T(b + 0.5) for b in range(NB) if groove(b) and b % 4 == 2]
    pump = sidechain(kick_t, bass.x.shape[1], 0.5, 0.12)
    ir = reverb_ir(1.6, 0.4)
    wet_src = music.x * 0.35 + fx.x * 0.15
    wet = np.stack([signal.fftconvolve(wet_src[c], ir[c])[: wet_src.shape[1]] for c in range(2)])
    bed = drums.x * 0.9 + bass.x * 0.75 + music.x * pump * 0.7 + fx.x * 0.8 + wet * 0.4
    bed = np.stack([filt(ch, "highpass", 28) for ch in bed])[:, :N]
    bed /= np.abs(bed).max() + 1e-9
    bed *= 0.5
    fade = int(0.6 * SR)
    bed[:, -fade:] *= np.linspace(1, 0, fade) ** 2
    sf.write(HERE / "music.wav", bed.T, SR, subtype="PCM_24")

    grid_src = drums.x[:, :N].mean(axis=0) + bass.x[:, :N].mean(axis=0) * 0.3
    grid = measure_beats(grid_src, SR, BPM, n_beats=NB + 1)
    grid.update({"designed_bpm": BPM, "downbeats": grid["beats"][::4],
                 "sections": {"hook": [0, 4], "aegis": [4, 16], "final": [16, 24], "bot": [24, 30],
                              "names": [30, 36], "end": [36, 44]},
                 "source": "spirit3/audio/score.py drum stem, measured"})
    (FILM / "beats.json").write_text(json.dumps(grid, indent=1))
    print(f"beats: {grid['bpm']} bpm, offset {grid['offset'] * 1000:.1f} ms, rms {grid['fit_residual_ms']} ms")


main()
