"""Озвучка рекламы: фразы audio/sp3/vo/00_NN.wav (tools/video/tts.py, голос 3) ставятся на бит из AT (в долях,
120 BPM), пишется audio/vo.wav и vo.json (начало и конец фраз в долях) для субтитров.
    python3 audio/vo_place.py   (из папки ролика)"""
import json, numpy as np, soundfile as sf
from pathlib import Path
SR, BEAT, DUR = 48000, 0.5, 32.0
AT = [0.4, 6.3, 12.2, 18.4, 24.2, 30.4, 36.3, 42.3, 48.3, 54.3]
out = np.zeros(int(DUR * SR), np.float32); spans = []
for i, b in enumerate(AT):
    y, sr = sf.read(f'audio/sp3/vo/00_{i:02d}.wav', dtype='float32'); assert sr == SR
    s = int(b * BEAT * SR); out[s:s + len(y)] += y; spans.append([b, round(b + len(y) / SR / BEAT, 2)])
out *= 0.89 / (np.abs(out).max() + 1e-9)
sf.write('audio/vo.wav', np.stack([out, out], 1), SR, subtype='PCM_24')
Path('vo.json').write_text(json.dumps({'spans': spans}))
print(spans)
