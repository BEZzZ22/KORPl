# Портреты героев -> docs/img/heroes/<key>.webp (128x72, как портрет Steam, только меньше).
# У части игроков CDN Steam не открывается в Телеграме, поэтому приложение берёт портреты со своего сайта.
# Запуск: python3 tools/fetch-hero-icons.py (нужен Pillow). Workflow «Портреты героев» — после выхода нового героя.
import io
import json
import os
import sys
import urllib.request

from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "img", "heroes")
CDNS = ["https://cdn.cloudflare.steamstatic.com", "https://cdn.akamai.steamstatic.com"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "dota-razbor-icons"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


heroes = json.loads(get("https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json"))
os.makedirs(OUT, exist_ok=True)
done, failed = 0, []
for h in heroes.values():
    key = h["name"].replace("npc_dota_hero_", "")
    path = h["img"].split("?")[0]
    raw = None
    for cdn in CDNS:
        try:
            raw = get(cdn + path)
            break
        except Exception:  # noqa: BLE001 - пробуем зеркало
            continue
    if raw is None:
        failed.append(key)
        continue
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    # весь портрет 16:9 в 128x72: и для плашек списков (object-fit: cover), и для круга на карте (обрезка по центру)
    im.resize((128, 72), Image.LANCZOS).save(os.path.join(OUT, f"{key}.webp"), "WEBP", quality=84, method=6)
    done += 1
print(f"портретов: {done}, не скачались: {len(failed)} {' '.join(failed)}")
if done < 100:
    sys.exit(1)
