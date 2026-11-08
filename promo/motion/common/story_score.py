# /// script
# requires-python = ">=3.10"
# dependencies = ["librosa>=0.10", "numpy", "scipy", "soundfile"]
# ///
"""Light comedic bed for the story shorts, 120 BPM, length from film.json. Bouncy bass, mallet riff,
soft drums; drops out on 'stops' (seconds) for gags and rises into 'lift' (the bot insert).
    MOTION_REEL_SKILL=<skill> uv run common/story_score.py <film> --key D --mode major --stops 24.5 --lift 15.5"""
import argparse, json, os, sys
from pathlib import Path
import numpy as np, soundfile as sf
from scipy import signal
sys.path.insert(0, str(Path(os.environ["MOTION_REEL_SKILL"]) / "scripts"))
from dsp import *  # noqa
ap = argparse.ArgumentParser(); ap.add_argument("film"); ap.add_argument("--key", default="D"); ap.add_argument("--mode", default="major")
ap.add_argument("--stops", default=""); ap.add_argument("--lift", type=float, default=15.0); ap.add_argument("--seed", type=int, default=2)
A = ap.parse_args(); FILM = Path(A.film)
DUR = json.loads((FILM / "film.json").read_text())["duration"]
BPM = 120; BEAT = 60 / BPM; NB = int(round(DUR / BEAT)); N = int(SR * DUR); seed(A.seed)
SC = [0, 2, 4, 5, 7, 9, 11] if A.mode == "major" else [0, 2, 3, 5, 7, 8, 10]
ROOT = midi(A.key + "3")
nn = lambda d, o=0: note_name(ROOT + 12 * o + SC[d % 7] + 12 * (d // 7))
stops = [float(s) for s in A.stops.split(",") if s]
stopped = lambda b: any(s - 0.25 <= b * BEAT < s + 1.0 for s in stops)
def mallet(note, length=0.35):
    n = int(length * SR); t = tvec(n); f = hz(note)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 4.0 * t) * np.exp(-t / 0.03) + 0.15 * np.sin(2 * np.pi * f * 10.0 * t) * np.exp(-t / 0.01)
    return x * np.exp(-t / 0.18) * (1 - np.exp(-t / 0.001))
def main():
    drums, bass, music, fx = (Bus(DUR, BPM) for _ in range(4))
    prog = [0, 4, 5, 3] if A.mode == "major" else [0, 5, 3, 4]
    lift = int(A.lift / BEAT)
    riff = [0, None, 2, 4, None, 4, 2, None, 0, None, 4, 5, 4, None, 2, None]
    for bar in range(NB // 4 + 1):
        b0 = bar * 4; d = prog[bar % 4]
        if b0 >= NB: break
        chord = [nn(d), nn(d + 2), nn(d + 4)]
        hot = b0 >= lift
        music.add(pad_chord(chord, 4 * BEAT + 0.2, 1600 if hot else 1100), b0, 0.18)
        for s in range(8):
            if stopped(b0 + s * 0.5): continue
            nt = nn(d, -1) if s % 2 == 0 else nn(d + 4, -1)
            bass.add(bass_note(nt, 0.2, 700), b0 + s * 0.5, 0.5 if s % 2 == 0 else 0.35)
        if b0 >= 2:
            for i, dg in enumerate(riff):
                b = b0 + i * 0.25
                if dg is None or stopped(b) or b >= NB: continue
                music.add(mallet(nn(d + dg, 1 + (1 if hot and i % 4 == 0 else 0))), b, 0.32, pan=0.25 if i % 2 else -0.25)
    for b in range(NB):
        if stopped(b) or b < 2: continue
        if b % 2 == 0: drums.add(kick(soft=b < lift), b, 0.8)
        if b % 2 == 1: drums.add(clap(tight=True), b, 0.5)
        for s in range(4 if b >= lift else 2): drums.add(hat(), b + s * (0.25 if b >= lift else 0.5), 0.12, pan=0.2)
    for s in stops:
        b = s / BEAT; fx.add(sub_drop(0.9), b, 0.6)
    fx.add(riser(1.5), A.lift / BEAT - 3, 0.3); fx.add(crash(1.6), A.lift / BEAT, 0.3)
    kick_t = [b * BEAT for b in range(NB) if b % 2 == 0 and not stopped(b) and b >= 2]
    pump = sidechain(kick_t, bass.x.shape[1], 0.35, 0.12)
    ir = reverb_ir(1.4, 0.35); wet_src = music.x * 0.35
    wet = np.stack([signal.fftconvolve(wet_src[c], ir[c])[: wet_src.shape[1]] for c in range(2)])
    bed = drums.x * 0.8 + bass.x * 0.7 + music.x * pump * 0.7 + fx.x * 0.7 + wet * 0.35
    bed = np.stack([filt(ch, "highpass", 30) for ch in bed])[:, :N]
    bed /= np.abs(bed).max() + 1e-9; bed *= 0.5
    fade = int(1.0 * SR); bed[:, -fade:] *= np.linspace(1, 0, fade) ** 2
    sf.write(FILM / "audio" / "music.wav", bed.T, SR, subtype="PCM_24")
    grid = {"bpm": BPM, "period": BEAT, "offset": 0.0, "beats": [round(i * BEAT, 5) for i in range(NB + 1)], "downbeats": [round(i * BEAT, 5) for i in range(0, NB + 1, 4)]}
    (FILM / "beats.json").write_text(json.dumps(grid, indent=1))
    print(FILM, "ok", NB, "beats")
main()
