"""Видеоразбор, озвучка: фразы сценария -> wav по фразе и их длительности. Бесплатно и без сети в рантайме:
Vosk TTS ru 0.9 (Apache 2.0), модель качается один раз и лежит в кэше.
    python3 tools/video/tts.py <script.json> <outdir> [--speaker 4] [--tempo 1.06]
В outdir: vo/SS_LL.wav (48 кГц, моно) и vo.json {"durations": [[сек, ...] по сегментам]}.
Не вышло озвучить (нет модели, нет пакета) — код 3: ролик соберётся немым, с субтитрами.
Модель: каталог из VOSK_TTS_MODEL, иначе кэш vosk, иначе зеркало на Hugging Face."""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 48000
MODEL = "vosk-model-tts-ru-0.9-multi"
MIRROR = "drakulavich/vosk-tts-ru-0.9-multi"
SAY = json.loads((Path(__file__).parent / "say.json").read_text(encoding="utf-8"))


def load_model():
    from vosk_tts import Model
    path = os.environ.get("VOSK_TTS_MODEL")
    if path and Path(path, "model.onnx").exists():
        return Model(model_path=path)
    try:
        return Model(model_name=MODEL)
    except Exception as e:  # noqa: BLE001 - сайт модели недоступен: берём зеркало
        print(f"кэш vosk недоступен ({type(e).__name__}), беру зеркало", file=sys.stderr)
        from huggingface_hub import snapshot_download
        return Model(model_path=snapshot_download(MIRROR))


def spoken(text):
    """Ударения и произношение игровых слов: say.json, слово целиком -> как читать (+ перед ударной гласной)."""
    import re
    def fix(m):
        w = m.group(0)
        r = SAY["words"].get(w.lower())
        if not r:
            return w
        return r[0].upper() + r[1:] if w[0].isupper() and r[0] != "+" else r
    text = re.sub(r"[А-Яа-яЁё]+", fix, text)
    return text.replace(" — ", ", ").replace("—", ",")


def polish(pcm, tempo):
    """Темп чуть быстрее, срез гула, 48 кГц, обрезка тишины по краям, короткие фейды."""
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", "22050", "-ac", "1", "-i", "-",
                          "-af", f"atempo={tempo},highpass=f=70", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         input=pcm.tobytes(), capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).copy()
    win = int(0.01 * SR)
    env = np.sqrt(np.convolve(x ** 2, np.ones(win) / win, "same"))
    on = np.where(env > 10 ** (-38 / 20))[0]
    if len(on):
        x = x[max(0, on[0] - int(0.02 * SR)):min(len(x), on[-1] + int(0.07 * SR))]
    f = int(0.008 * SR)
    if len(x) > 2 * f:
        x[:f] *= np.linspace(0, 1, f)
        x[-f:] *= np.linspace(1, 0, f)
    peak = np.abs(x).max() if len(x) else 0
    return x / peak * 0.9 if peak > 0 else x


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script")
    ap.add_argument("outdir")
    ap.add_argument("--speaker", type=int, default=int(SAY.get("speaker", 4)))
    ap.add_argument("--tempo", type=float, default=float(SAY.get("tempo", 1.06)))
    a = ap.parse_args()
    script = json.loads(Path(a.script).read_text(encoding="utf-8"))
    out = Path(a.outdir)
    (out / "vo").mkdir(parents=True, exist_ok=True)
    try:
        import soundfile as sf
        from vosk_tts import Synth
        synth = Synth(load_model())
    except Exception as e:  # noqa: BLE001
        print(f"озвучка недоступна: {type(e).__name__}: {e}", file=sys.stderr)
        return 3
    durations = []
    for si, seg in enumerate(script["segments"]):
        row = []
        for li, line in enumerate(seg["lines"]):
            # диффузия иногда даёт брак (слишком коротко или пусто): до трёх попыток
            best = None
            for _ in range(3):
                # совет читается спокойнее и весомее, описание — бодрее
                tempo = a.tempo * (0.965 if line.get("role") == "tip" else 1.02 if line.get("role") == "what" else 1.0)
                x = polish(synth.synth_audio(spoken(line["say"]), speaker_id=a.speaker), tempo)
                rate = len(line["say"]) / max(0.1, len(x) / SR)
                if best is None or abs(rate - 15) < abs(best[1] - 15):
                    best = (x, rate)
                if 9 <= rate <= 22:
                    break
            x = best[0]
            sf.write(out / "vo" / f"{si:02d}_{li:02d}.wav", x, SR, subtype="PCM_16")
            row.append(round(len(x) / SR, 3))
        durations.append(row)
    (out / "vo.json").write_text(json.dumps({"sr": SR, "speaker": a.speaker, "durations": durations}))
    print(f"озвучено фраз: {sum(len(r) for r in durations)}, всего {sum(map(sum, durations)):.1f} с", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
