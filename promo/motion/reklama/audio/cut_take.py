"""Режет один дубль озвучки (vo_qwen.py) на фразы script.json по словам из faster-whisper:
граница — середина паузы между последним словом фразы и первым словом следующей.
    python3 audio/cut_take.py full.wav audio/sp3   (из папки ролика) -> audio/sp3/vo/00_NN.wav, 48 кГц"""
import json, re, sys, subprocess, numpy as np, soundfile as sf
from pathlib import Path
from faster_whisper import WhisperModel
SR = 48000
src, out = sys.argv[1], Path(sys.argv[2]); (out / 'vo').mkdir(parents=True, exist_ok=True)
lines = [l['say'] for l in json.loads(Path('audio/script.json').read_text())['segments'][0]['lines']]
raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', str(SR), '-af', 'highpass=f=70', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.float32).copy()
x16 = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
m = WhisperModel('small', device='cpu', compute_type='int8')
segs, _ = m.transcribe(np.frombuffer(x16, np.float32), language='ru', word_timestamps=True)
words = [w for s in segs for w in s.words]
cnt = [len(re.findall(r'[\wёЁ-]+', l.replace('—', ''))) for l in lines]
print('слов в дубле', len(words), 'в сценарии', sum(cnt))
# align script words to whisper words (difflib on normalized tokens); a phrase starts at its first word
import difflib
norm = lambda w: re.sub(r'[^а-яёa-z0-9]', '', w.lower())
sw = [(i, norm(t)) for i, l in enumerate(lines) for t in re.findall(r'[\wёЁ-]+', l)]
ww = [norm(w.word) for w in words]
sm = difflib.SequenceMatcher(a=[t for _, t in sw], b=ww, autojunk=False)
amap = {}
for blk in sm.get_matching_blocks():
    for k in range(blk.size): amap[blk.a + k] = blk.b + k
first = {}
for j, (i, _) in enumerate(sw):
    if j in amap and i not in first: first[i] = amap[j] - (j - min(jj for jj, (ii, _) in enumerate(sw) if ii == i))
bounds = [0.0]
for i in range(1, len(lines)):
    k = max(1, first[i])
    matched = set(amap.values())
    # words whisper split differently ("В виде о разбор") belong to the phrase they lead into
    while k > 1 and (k - 1) not in matched and words[k].start - words[k - 1].end < 0.15: k -= 1
    bounds.append((words[k - 1].end + words[k].start) / 2)
bounds.append(len(x) / SR)
for i in range(len(lines)):
    y = x[int(bounds[i] * SR):int(bounds[i + 1] * SR)]
    win = int(0.01 * SR); e = np.sqrt(np.convolve(y ** 2, np.ones(win) / win, 'same')); on = np.where(e > 10 ** (-40 / 20))[0]
    y = y[max(0, on[0] - int(0.02 * SR)):on[-1] + int(0.08 * SR)].copy()
    f = int(0.008 * SR); y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f)
    y *= 0.9 / (np.abs(y).max() + 1e-9)
    sf.write(out / 'vo' / f'00_{i:02d}.wav', y, SR, subtype='PCM_16')
    seg_words = ' '.join(w.word.strip() for w in words if bounds[i] <= w.start < bounds[i + 1])
    print(f'{i} {len(y) / SR:5.2f}s | {lines[i]} | {seg_words}')
