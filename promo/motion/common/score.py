# /// script
# requires-python = ">=3.10"
# dependencies = ["librosa>=0.10", "numpy", "scipy", "soundfile"]
# ///
"""Beds for the Dota shorts. 120 BPM, 44 beats = 22 s. Hook b0-4, groove b4-24, filtered bot insert b24-30,
groove b30-36, end b36-44 (resolve). Styles: phonk (808 cowbell), trap (pluck lead, hat rolls),
dark (horror: drone, bell, heartbeat), hype (four-on-the-floor, saw stabs).
    MOTION_REEL_SKILL=<skill> uv run common/score.py <film> --style phonk --key F# --seed 3 --drops 4,8,12"""
import argparse, json, os, sys
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy import signal

sys.path.insert(0, str(Path(os.environ["MOTION_REEL_SKILL"]) / "scripts"))
from dsp import *  # noqa

ap = argparse.ArgumentParser()
ap.add_argument("film"); ap.add_argument("--style", default="phonk"); ap.add_argument("--key", default="F#")
ap.add_argument("--seed", type=int, default=1); ap.add_argument("--drops", default="4")
A = ap.parse_args()
FILM = Path(A.film)
BPM, NB = 120, 44
BEAT = 60 / BPM
DUR = NB * BEAT
N = int(SR * DUR)
seed(A.seed)
T = lambda b: b * BEAT
SC = [0, 2, 3, 5, 7, 8, 10]  # natural minor
ROOT = midi(A.key + "3")
nn = lambda deg, octv=0: note_name(ROOT + 12 * octv + SC[deg % 7] + 12 * (deg // 7))


def cowbell(note, length=0.28):
    n = int(length * SR); t = tvec(n); f = hz(note)
    x = np.sign(np.sin(2 * np.pi * f * t)) + 0.8 * np.sign(np.sin(2 * np.pi * f * 1.48 * t))
    x = filt(x, "bandpass", [f * 0.8, f * 4])
    return x * (0.7 * np.exp(-t / 0.03) + 0.3 * np.exp(-t / 0.16)) * (1 - np.exp(-t / 0.001))


def e808(note, length, glide_to=None):
    n = int(length * SR); t = tvec(n); f0 = hz(note)
    f = np.full(n, f0) if glide_to is None else f0 * (hz(glide_to) / f0) ** np.clip((t - length * 0.55) / (length * 0.4), 0, 1)
    f = f * (1 + 1.5 * np.exp(-t / 0.012))
    x = np.tanh(2.6 * np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-t / 0.9) * (1 - np.exp(-t / 0.002))
    return x * np.clip((length - t) / 0.03, 0, 1)


def bell(note, length=2.5):
    n = int(length * SR); t = tvec(n); f = hz(note)
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (length * d)) for r, a, d in [(1, 1, .5), (2.76, .5, .25), (5.4, .3, .12), (8.9, .15, .06)])
    return x * (1 - np.exp(-t / 0.002))


def drone(note, length):
    n = int(length * SR); t = tvec(n); f = hz(note)
    x = saw(f, n) + saw(f * 1.006, n) + 0.5 * saw(f * 0.5, n)
    x = sweep_filter(x, 200 + 250 * (0.5 + 0.5 * np.sin(2 * np.pi * t / 3.7)), "lowpass", 2.0)
    return x * adsr(n, 0.8, 0.5, 0.9, 0.8) * 0.5


def main():
    drums, bass, music, fx = (Bus(DUR, BPM) for _ in range(4))
    prog_deg = [0, 5, 3, 4] if A.style != "dark" else [0, 0, 5, 4]
    groove = lambda b: 4 <= b < 24 or 30 <= b < 40
    bot = lambda b: 24 <= b < 30
    roots = [nn(d, -2) for d in prog_deg]
    for bar in range(NB // 4):
        b0 = bar * 4; d = prog_deg[bar % 4]
        chord = [nn(d), nn(d + 2), nn(d + 4)]
        cut = (450, 800) if bot(b0) else ((900, 1600) if A.style == "dark" else (1400, 2400))
        music.add(pad_chord(chord, 4 * BEAT + 0.2, cut), b0, 0.3 if A.style != "hype" else 0.22)
        if A.style == "dark":
            music.add(drone(roots[bar % 4].replace("1", "2"), 4 * BEAT + 0.5), b0, 0.5)
            if not bot(b0): music.add(bell(nn(d + 7 * 1 + 4, 0), 3.0), b0, 0.18, pan=-0.3)
        if b0 >= 40:
            bass.add(e808(roots[0], 2.0), b0, 0.9); continue
        if A.style in ("phonk", "trap", "dark"):
            bass.add(e808(roots[bar % 4], 1.4), b0, 0.8)
            bass.add(e808(roots[bar % 4], 0.9, glide_to=roots[(bar + 1) % 4]), b0 + 2.5, 0.7)
        else:
            for s in range(8): bass.add(bass_note(roots[bar % 4].replace("1", "2"), 0.22), b0 + s * 0.5 + 0.5 * (s % 2 == 0) * 0, 0.45)
        if bot(b0): continue
        if A.style == "phonk":
            pat = [0, None, 2, None, 4, 3, None, 2, None, 0, None, 2, 3, None, 4, None]
            for i, dg in enumerate(pat):
                if dg is not None: music.add(cowbell(nn(d + dg, 2)), b0 + i * 0.25, 0.3, pan=0.15 if i % 2 else -0.15)
        elif A.style == "trap":
            pat = [4, None, None, 2, None, None, 4, None, 7, None, None, 4, None, 2, None, None]
            for i, dg in enumerate(pat):
                if dg is not None: music.add(pluck([nn(d + dg, 1)], 0.3, 2800), b0 + i * 0.25, 0.35, pan=0.2 if i % 2 else -0.2)
        elif A.style == "hype":
            for s in (0.5, 1.5, 2.5, 3.5): music.add(pluck([nn(d, 1), nn(d + 2, 1), nn(d + 4, 1)], 0.25, 3600), b0 + s, 0.35)
    for b in range(NB):
        if groove(b):
            if A.style == "hype":
                drums.add(kick(), b, 0.9)
                drums.add(hat(open_=True), b + 0.5, 0.15)
                if b % 2 == 1: drums.add(clap(), b, 0.7)
            elif A.style == "dark":
                if b % 4 == 0: drums.add(kick(), b, 0.9); drums.add(kick(soft=True), b + 0.35, 0.6)  # heartbeat
                if b % 4 == 2: drums.add(clap(tight=True), b, 0.5)
                drums.add(hat(), b + 0.5, 0.1)
            else:
                if b % 4 == 0: drums.add(kick(), b, 0.9)
                if b % 4 == 2: drums.add(kick(), b + 0.5, 0.7)
                if b % 2 == 1: drums.add(clap(), b, 0.75)
                roll = b % 4 == 3 and A.style == "trap"
                for s in range(6 if roll else (4 if b % 4 == 3 else 2)):
                    drums.add(hat(), b + s * ((1 / 6) if roll else (0.25 if b % 4 == 3 else 0.5)), 0.2, pan=0.2)
        elif b < 4:
            drums.add(hat(), b + 0.5, 0.12)
        elif bot(b) and b % 2 == 0:
            drums.add(kick(soft=True), b, 0.6)
    fx.add(sub_drop(1.6), 0, 0.9); fx.add(crash(2.0), 0, 0.5); fx.add(riser(T(2)), 2, 0.35)
    for b in [int(x) for x in A.drops.split(",") if x]:
        fx.add(sub_drop(1.0), b, 0.7); fx.add(crash(1.4), b, 0.3)
    fx.add(riser(T(2)), 22, 0.3); fx.add(riser(T(2)), 28, 0.35); fx.add(sub_drop(1.2), 30, 0.7); fx.add(crash(1.6), 30, 0.35)
    fx.add(sub_drop(2.0), 36, 0.9); fx.add(crash(2.5), 36, 0.45)
    kick_t = [T(b) for b in range(NB) if groove(b) and (b % 4 == 0 or A.style == "hype")]
    pump = sidechain(kick_t, bass.x.shape[1], 0.5, 0.12)
    ir = reverb_ir(2.2 if A.style == "dark" else 1.6, 0.5 if A.style == "dark" else 0.4)
    wet_src = music.x * 0.35 + fx.x * 0.15
    wet = np.stack([signal.fftconvolve(wet_src[c], ir[c])[: wet_src.shape[1]] for c in range(2)])
    bed = drums.x * 0.9 + bass.x * 0.75 + music.x * pump * 0.7 + fx.x * 0.8 + wet * 0.4
    bed = np.stack([filt(ch, "highpass", 28) for ch in bed])[:, :N]
    bed /= np.abs(bed).max() + 1e-9
    bed *= 0.5
    fade = int(0.6 * SR); bed[:, -fade:] *= np.linspace(1, 0, fade) ** 2
    (FILM / "audio").mkdir(parents=True, exist_ok=True)
    sf.write(FILM / "audio" / "music.wav", bed.T, SR, subtype="PCM_24")
    # the grid is the designed one (120 BPM from 0); verify against the drums
    grid_src = drums.x[:, :N].mean(axis=0) + bass.x[:, :N].mean(axis=0) * 0.3
    g = measure_beats(grid_src, SR, BPM, n_beats=NB + 1)
    grid = {"bpm": BPM, "period": BEAT, "offset": 0.0, "beats": [round(i * BEAT, 5) for i in range(NB + 1)],
            "downbeats": [round(i * BEAT, 5) for i in range(0, NB + 1, 4)], "measured": {k: g[k] for k in ("bpm", "offset", "fit_residual_ms")},
            "sections": {"hook": [0, 4], "a": [4, 24], "bot": [24, 30], "b": [30, 36], "end": [36, 44]}, "style": A.style}
    (FILM / "beats.json").write_text(json.dumps(grid, indent=1))
    print(f"{FILM}: {A.style} in {A.key} minor; measured {g['bpm']} bpm, offset {g['offset']*1000:.1f} ms")


main()
