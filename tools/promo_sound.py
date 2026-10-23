"""Звук для рилсов: своя синтезированная музыка (бит, бас, пэд, арпеджио) и эффекты, без чужих треков и авторских прав.
    from promo_sound import make_track; make_track("out.wav", seconds=15, seed=3)
Сигнал стерео 44,1 кГц, пик около -3 дБ, нарастание в начале и затухание в конце, «вуш» на входе и удар в финале."""
import wave
from pathlib import Path

import numpy as np

SR = 44100
# аккордовые прогрессии (корни в Гц): Am-F-C-G, Dm-Bb-F-C, Em-C-G-D
PROGRESSIONS = [
    [(220.0, 0), (174.61, 0), (261.63, 4), (196.0, 4)],
    [(146.83, 0), (233.08, 4), (174.61, 4), (261.63, 4)],
    [(164.81, 0), (261.63, 4), (196.0, 4), (146.83, 4)],
]


def tone(freq, n, kind="sine"):
    t = np.arange(n) / SR
    if kind == "saw":
        return 2 * ((t * freq) % 1) - 1
    if kind == "tri":
        return 2 * np.abs(2 * ((t * freq) % 1) - 1) - 1
    return np.sin(2 * np.pi * freq * t)


def env(n, attack=0.005, decay=0.3):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def lowpass(x, alpha):
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += alpha * (v - acc)
        y[i] = acc
    return y


def add(buf, start, sig, gain=1.0):
    s = int(start * SR)
    if s >= len(buf):
        return
    e = min(len(buf), s + len(sig))
    buf[s:e] += sig[: e - s] * gain


def kick():
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    f = 48 + 90 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.11)


def hat(rng, open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    noise = rng.standard_normal(n)
    noise = noise - lowpass(noise, 0.25)          # убрать низы, оставить шипение
    return noise * env(n, 0.001, 0.06 if open_ else 0.015)


def clap(rng):
    n = int(0.22 * SR)
    noise = rng.standard_normal(n)
    noise = lowpass(noise - lowpass(noise, 0.08), 0.6)
    return noise * env(n, 0.002, 0.07)


def whoosh(rng, seconds):
    n = int(seconds * SR)
    noise = rng.standard_normal(n)
    sweep = np.linspace(0.02, 0.5, n)
    out = np.empty(n)
    acc = 0.0
    for i in range(n):
        acc += sweep[i] * (noise[i] - acc)
        out[i] = acc
    return out * np.linspace(0, 1, n) ** 2


def make_track(path, seconds=15, seed=1):
    rng = np.random.default_rng(seed)
    bpm = [100, 104, 108, 112][seed % 4]
    beat = 60 / bpm
    n = int(seconds * SR)
    drums, bass, pad, arp, fx = (np.zeros(n) for _ in range(5))
    prog = PROGRESSIONS[seed % len(PROGRESSIONS)]
    bar = 4 * beat
    k, h, c = kick(), hat(rng), clap(rng)
    ho = hat(rng, True)
    nbeats = int(seconds / beat)
    for b in range(nbeats):
        t0 = b * beat
        if t0 < 1.0:
            continue                                   # первая секунда без бита: вход «вушем»
        if b % 4 in (0, 2) or b % 8 == 7:
            add(drums, t0, k, 0.9)
        if b % 4 in (1, 3):
            add(drums, t0, c, 0.45)
        add(drums, t0 + beat / 2, ho if b % 2 else h, 0.28)
        add(drums, t0, h, 0.18)
    for i in range(int(seconds / bar) + 1):
        root, third = prog[i % len(prog)]
        r = root / 2
        # бас по восьмым
        for j in range(8):
            add(bass, i * bar + j * beat / 2, lowpass(tone(r / 2, int(beat * 0.5 * SR), "saw"), 0.06) * env(int(beat * 0.5 * SR), 0.004, 0.25), 0.55)
        # пэд на весь такт: корень, терция (малая/большая), квинта
        minor = third == 0
        for mult in (1, 1.189 if minor else 1.26, 1.498):
            s = tone(root * mult, int(bar * SR), "tri") * np.minimum(1, np.arange(int(bar * SR)) / (0.4 * SR))
            add(pad, i * bar, s * np.exp(-np.arange(len(s)) / SR / 3.0), 0.16)
        # арпеджио шестнадцатыми с 3-й секунды
        if i * bar >= 3.0 - bar:
            for j in range(16):
                st = i * bar + j * beat / 4
                if st < 3.0:
                    continue
                f = root * [1, 1.189 if minor else 1.26, 1.498, 2.0][(j * 3 + i) % 4] * 2
                m = int(beat * 0.3 * SR)
                add(arp, st, tone(f, m, "tri") * env(m, 0.003, 0.09), 0.2)
    add(fx, 0, whoosh(rng, 1.0), 0.5)
    add(fx, seconds - 2.6, whoosh(rng, 1.0), 0.35)
    hit = kick() * 1.0 + lowpass(rng.standard_normal(int(0.8 * SR)), 0.05)[: len(kick())] * 0.2
    add(fx, seconds - 1.6, hit, 1.0)                    # удар на финальной плашке
    # «сайдчейн»: пэд и арпеджио приседают на кике
    duck = np.ones(n)
    for b in range(nbeats):
        t0 = b * beat
        if t0 >= 1.0 and (b % 4 in (0, 2) or b % 8 == 7):
            s = int(t0 * SR)
            ln = int(0.18 * SR)
            duck[s:s + ln] *= np.linspace(0.45, 1, min(ln, n - s))[: n - s]
    mix = drums * 0.9 + bass * 0.8 + (pad + arp) * duck + fx
    fade = np.ones(n)
    fade[: int(0.4 * SR)] = np.linspace(0, 1, int(0.4 * SR))
    fade[-int(0.8 * SR):] = np.linspace(1, 0, int(0.8 * SR))
    mix *= fade
    mix = np.tanh(mix * 1.3)
    mix = mix / np.max(np.abs(mix)) * 0.7
    stereo = np.stack([mix, np.roll(mix, int(0.004 * SR)) * 0.97 + arp * 0.05], axis=1)   # лёгкая ширина
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return Path(path)


if __name__ == "__main__":
    import sys
    make_track(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 15, int(sys.argv[3]) if len(sys.argv) > 3 else 1)
    print("готово", sys.argv[1])
