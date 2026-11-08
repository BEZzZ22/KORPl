"""VO edit for the story shorts: trim each phrase take (audio/vo/NN.wav), speed it up a touch, place the
phrases one after another with onsets on a 0.25 s grid, write audio/vo.wav + story.json + film.json duration.
    python3 common/vo_edit.py <film> [--tempo 1.08] [--gap 0.18] [--tail 2.2] [--pause i:sec,...]"""
import argparse, json, subprocess, numpy as np, soundfile as sf
from pathlib import Path
ap = argparse.ArgumentParser(); ap.add_argument('film'); ap.add_argument('--tempo', type=float, default=1.08)
ap.add_argument('--gap', type=float, default=0.18); ap.add_argument('--tail', type=float, default=2.2); ap.add_argument('--pause', default='')
A = ap.parse_args(); F = Path(A.film); SR = 48000
lines = (F / 'audio/script.txt').read_text().strip().split('\n')
extra = {int(k): float(v) for k, v in (p.split(':') for p in A.pause.split(',') if p)}
def load(p):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(p), '-af', f'atempo={A.tempo},highpass=f=70', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32).copy()
    win = int(0.01 * SR); e = np.sqrt(np.convolve(x ** 2, np.ones(win) / win, 'same'))
    on = np.where(e > 10 ** (-38 / 20))[0]
    a, b = max(0, on[0] - int(0.02 * SR)), min(len(x), on[-1] + int(0.06 * SR))
    y = x[a:b]; f = int(0.008 * SR); y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f)
    return y
t = 0.25; phrases = []; parts = []
for i, l in enumerate(lines):
    y = load(F / f'audio/vo/{i:02d}.wav')
    t0 = np.ceil(t / 0.25 - 1e-6) * 0.25
    phrases.append({'i': i, 'text': l, 't0': round(float(t0), 3), 't1': round(float(t0 + len(y) / SR), 3)})
    parts.append((t0, y)); t = t0 + len(y) / SR + A.gap + extra.get(i, 0)
dur = round(float(np.ceil((phrases[-1]['t1'] + A.tail) * 2) / 2), 2)
out = np.zeros(int(dur * SR) + SR, np.float32)
env = []
for t0, y in parts: s = int(t0 * SR); out[s:s + len(y)] += y
out = out[:int(dur * SR)]; out /= np.abs(out).max() + 1e-9; out *= 0.89
sf.write(F / 'audio/vo.wav', np.stack([out, out], 1), SR, subtype='PCM_24')
# 100 Hz loudness envelope for mouth / pulse
hop = SR // 100; n = len(out) // hop
rms = np.sqrt((out[:n * hop].reshape(n, hop) ** 2).mean(1)); rms = np.clip(rms / (np.percentile(rms[rms > 1e-4], 95) + 1e-9), 0, 1)
(F / 'story.json').write_text(json.dumps({'duration': dur, 'phrases': phrases, 'env': [round(float(v), 3) for v in rms]}, ensure_ascii=False))
fj = json.loads((F / 'film.json').read_text()) if (F / 'film.json').exists() else {}
fj.update({'duration': dur, 'formats': ['9x16']}); (F / 'film.json').write_text(json.dumps(fj, ensure_ascii=False, indent=1))
for p in phrases: print(f"{p['i']:2d} {p['t0']:6.2f}-{p['t1']:6.2f} {p['text']}")
print('duration', dur)
