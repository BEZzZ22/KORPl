"""Видеоразбор, звук: диктор + музыка + эффекты -> один wav. Музыка и эффекты синтезируются тут же (numpy),
никаких чужих треков: с авторскими правами вопросов нет.
    python3 tools/video/audio.py <film.json> <dir с vo/> <out.wav>
Музыка: тёмная пульсирующая подложка 100 уд/мин в ре миноре, приглушается под голос.
Эффекты: свист и удар на смене момента, глухой удар на убийстве, звоночек на совете."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 48000
BPM = 100
BEAT = 60 / BPM
rng = np.random.default_rng(7)


def tv(n):
    return np.arange(n) / SR


def lowpass_fast(x, cutoff):
    """То же через БПФ: для длинных дорожек."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(spec, len(x))


def highpass_fast(x, cutoff):
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= 1 - 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(spec, len(x))


def add(buf, x, t, gain=1.0):
    s = int(t * SR)
    if s >= len(buf) or s < 0:
        return
    e = min(len(buf), s + len(x))
    buf[s:e] += x[:e - s] * gain


def hz(semitones_from_d2):
    return 73.416 * 2 ** (semitones_from_d2 / 12)


def kick():
    n = int(0.32 * SR)
    t = tv(n)
    f = 46 + 90 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.11)


def hat():
    n = int(0.05 * SR)
    return highpass_fast(rng.standard_normal(n), 7000) * np.exp(-tv(n) / 0.012)


def bass(note, length):
    n = int(length * SR)
    t = tv(n)
    f = hz(note)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.12)
    return x * np.exp(-t / (length * 0.55)) * (1 - np.exp(-t / 0.004))


def pad(notes, length):
    n = int(length * SR)
    t = tv(n)
    x = np.zeros(n)
    for note in notes:
        f = hz(note + 12)
        for det in (-0.006, 0, 0.007):
            ph = rng.random() * 6.28
            # пила из первых гармоник: мягче настоящей
            for h in range(1, 7):
                x += np.sin(2 * np.pi * f * (1 + det) * h * t + ph * h) / h ** 1.6
    env = np.minimum(1, t / 0.6) * np.minimum(1, (length - t) / 0.8)
    return x * env / (len(notes) * 3)


def whoosh(length=0.55):
    n = int(length * SR)
    t = tv(n)
    x = rng.standard_normal(n)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= np.exp(-((np.log2(np.maximum(f, 1) / 1800)) ** 2) / 1.2)
    x = np.fft.irfft(spec, n)
    env = (t / length) ** 2.2 * np.exp(-np.maximum(0, t - length * 0.92) / 0.02)
    return x * env / (np.abs(x).max() + 1e-9)


def impact():
    n = int(1.1 * SR)
    t = tv(n)
    f = 38 + 70 * np.exp(-t / 0.05)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3)
    crack = lowpass_fast(rng.standard_normal(n), 2400) * np.exp(-t / 0.05) * 0.5
    return boom + crack


def thump():
    n = int(0.3 * SR)
    t = tv(n)
    f = 70 + 160 * np.exp(-t / 0.02)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07) + lowpass_fast(rng.standard_normal(n), 3000) * np.exp(-t / 0.018) * 0.4


def ding():
    n = int(0.9 * SR)
    t = tv(n)
    x = np.sin(2 * np.pi * 1174.7 * t) + 0.5 * np.sin(2 * np.pi * 1760 * t) + 0.25 * np.sin(2 * np.pi * 2349.3 * t)
    return x * np.exp(-t / 0.22) * (1 - np.exp(-t / 0.002)) / 1.75


def tick():
    n = int(0.06 * SR)
    t = tv(n)
    return np.sin(2 * np.pi * 2100 * t) * np.exp(-t / 0.012)


def music(dur, segs):
    n = int(dur * SR) + SR
    drums, low, pads = np.zeros(n), np.zeros(n), np.zeros(n)
    # ре минор: Dm — Bb — F — C, по два такта на аккорд
    chords = [([0, 3, 7], 0), ([-4, 0, 3], -4), ([3, 7, 10], 3), ([-2, 2, 5], -2)]
    k, h = kick(), hat()
    beats = int(dur / BEAT) + 2
    intro_end = segs[0]["t1"]
    outro_start = segs[-1]["t0"]
    for b in range(beats):
        t = b * BEAT
        notes, root = chords[(b // 8) % 4]
        if b % 8 == 0:
            add(pads, pad(notes, BEAT * 8 + 0.6), t, 0.5)
        calm = t < intro_end - 0.3 or t > outro_start + 0.2
        add(low, bass(root, BEAT * 0.9), t, 0.55)
        if b % 2 == 1:
            add(low, bass(root + 12, BEAT * 0.4), t + BEAT / 2, 0.2)
        if not calm:
            add(drums, k, t, 0.75 if b % 4 == 0 else 0.5)
            add(drums, h, t + BEAT / 2, 0.1)
            if b % 4 == 2:
                add(drums, h, t + BEAT * 0.75, 0.06)
    pads = lowpass_fast(pads, 1500)
    return (drums + low + pads)[:int(dur * SR)]


VOICE_CHAIN = ",".join([
    "highpass=f=85",                               # гул
    "equalizer=f=240:t=q:w=1.1:g=-3",              # бубнение
    "equalizer=f=140:t=q:w=1.0:g=2",               # грудь, плотность
    "equalizer=f=3400:t=q:w=1.3:g=3.5",            # разборчивость
    "aexciter=amount=1.6:drive=5:blend=0:freq=6000",  # воздух: у синтеза нет верха выше 11 кГц
    "deesser=i=0.3",
    "acompressor=threshold=-22dB:ratio=3.5:attack=5:release=110:makeup=5",
    "aecho=1.0:0.5:17|29:0.06|0.04",               # чуть комнаты: голос не «в вакууме»
    "alimiter=limit=0.94",
])


def voice_polish(x):
    """Дикторская обработка одним проходом ffmpeg. Не вышло (старый ffmpeg) — голос остаётся как есть."""
    try:
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                              "-af", VOICE_CHAIN, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                             input=x.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
        y = np.frombuffer(raw, np.float32).astype(np.float64)
        if len(y) < len(x) * 0.98:
            return x
        y = y[:len(x)]
        return y / (np.abs(y).max() + 1e-9) * 0.95
    except Exception as e:  # noqa: BLE001
        print(f"обработка голоса пропущена: {type(e).__name__}", file=sys.stderr)
        return x


def riser(length=0.9):
    n = int(length * SR)
    t = tv(n)
    f = 220 * 2 ** (t / length * 1.6)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.5 + highpass_fast(rng.standard_normal(n), 3000) * 0.25
    return x * (t / length) ** 2.5


def blip():
    n = int(0.09 * SR)
    t = tv(n)
    f = 900 + 700 * t / 0.09
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.03)


def main():
    film = json.loads(Path(sys.argv[1]).read_text())
    src = Path(sys.argv[2])
    dur = film["duration"]
    n = int(dur * SR)
    vo = np.zeros(n)
    for v in film.get("vo", []):
        p = src / "vo" / f"{v['seg']:02d}_{v['line']:02d}.wav"
        if p.exists():
            x, sr = sf.read(p, dtype="float32")
            if sr == SR:
                add(vo, x, v["t"])
    if np.abs(vo).max() > 0:
        vo = voice_polish(vo)
    fx = np.zeros(n)
    w, imp, th, dg, tk = whoosh(), impact(), thump(), ding(), tick()
    rs, bl = riser(), blip()
    for i, seg in enumerate(film["segs"]):
        t0 = seg["t0"]
        if i > 0:
            add(fx, w, t0 - 0.5, 0.3)
        add(fx, imp, t0 + (0.1 if i else 0.05), 0.5 if seg["kind"] == "moment" else 0.4)
        if seg["kind"] == "moment":
            for kill in seg["kills"]:
                mine = kill["v"] == film["me"]
                add(fx, th, t0 + kill["s"], 0.6 if mine else 0.42)
                if mine:
                    add(fx, imp, t0 + kill["s"], 0.34)
            if seg["kills"]:
                first = min(k["s"] for k in seg["kills"])
                if first > 1.6:
                    add(fx, rs, t0 + first - 0.9, 0.13)
            for c in seg.get("casts", []):
                add(fx, bl, t0 + c["s"], 0.07)
            tip = seg["lines"][-1]["t0"]
            add(fx, dg, t0 + tip - 0.12, 0.16)
            base = max(1.8, tip - 2.4)
            for j in range(len(seg["chips"])):
                add(fx, tk, t0 + base + j * 0.22, 0.12)
    mus = music(dur, film["segs"])
    # музыка приседает под голос: огибающая голоса, сглаженная на 0.25 с
    env = lowpass_fast(np.abs(vo), 4)
    env = np.clip(env / (np.percentile(env[env > 1e-4], 70) + 1e-9), 0, 1) if (env > 1e-4).any() else env
    has_vo = np.abs(vo).max() > 0
    duck = 1 - 0.68 * env
    mix = vo * 1.0 + fx + mus * (0.2 if has_vo else 0.34) * duck
    fade = int(0.9 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade) ** 1.5
    mix = np.tanh(mix * 1.15)
    mix /= np.abs(mix).max() + 1e-9
    mix *= 0.89
    sf.write(sys.argv[3], np.stack([mix, mix], 1), SR, subtype="PCM_16")
    print(f"звук: {dur:.1f} с, голос {'есть' if has_vo else 'нет'}", file=sys.stderr)


if __name__ == "__main__":
    main()
