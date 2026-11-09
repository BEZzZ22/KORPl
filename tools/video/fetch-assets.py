# Портреты героев для видеоразбора -> tools/video/assets/heroes/<key>.webp (256x144: в ролике они крупные,
# портретов приложения 128x72 не хватает). Запуск: python3 tools/video/fetch-assets.py (нужен Pillow).
# После выхода нового героя — запустить ещё раз; без файла ролик берёт портрет приложения.
import io
import json
import os
import sys
import urllib.request

from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "assets", "heroes")
CDNS = ["https://cdn.cloudflare.steamstatic.com", "https://cdn.akamai.steamstatic.com"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "dota-razbor-icons"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


heroes = json.load(open(os.path.join(os.path.dirname(__file__), "heroes.json"), encoding="utf-8"))
os.makedirs(OUT, exist_ok=True)
done, failed = 0, []
for h in heroes.values():
    key = h["key"]
    raw = None
    for cdn in CDNS:
        try:
            raw = get(f"{cdn}/apps/dota2/images/dota_react/heroes/{key}.png")
            break
        except Exception:  # noqa: BLE001 - пробуем зеркало
            continue
    if raw is None:
        failed.append(key)
        continue
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    im.resize((256, 144), Image.LANCZOS).save(os.path.join(OUT, f"{key}.webp"), "WEBP", quality=88, method=6)
    done += 1
print(f"портретов: {done}, не скачались: {len(failed)} {' '.join(failed)}")
if done < 100:
    sys.exit(1)
