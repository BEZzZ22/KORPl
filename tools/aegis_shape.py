"""Контур и обратная сторона Аегиса для 3D-щита на главной (docs/aegis.js).

Берёт анфас docs/img/aegis_still.webp и кадр «сзади» (24-й из 48) из раскадровки docs/img/aegis_spin.webp
(их снимают tools/capture_aegis.mjs и tools/pack_aegis.py с модели Sketchfab «Aegis of champions», msta2219, CC BY).
Пишет docs/img/aegis_back.webp и docs/aegis_shape.js — внешний контур силуэта: из центра щита по лучам до края.
Запуск: python tools/aegis_shape.py
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image

DOCS = Path(__file__).resolve().parent.parent / "docs"
FRAME, COLS, BACK = 360, 8, 24
RAYS = 160


def main():
    still = Image.open(DOCS / "img" / "aegis_still.webp").convert("RGBA")
    sheet = Image.open(DOCS / "img" / "aegis_spin.webp").convert("RGBA")
    back = sheet.crop(((BACK % COLS) * FRAME, (BACK // COLS) * FRAME, (BACK % COLS + 1) * FRAME, (BACK // COLS + 1) * FRAME))
    # сзади щит виден зеркально; кадр снят с другой точки, поэтому вписываем его в рамку силуэта анфаса,
    # чтобы в 3D обе стороны лежали на одном контуре
    back = back.transpose(Image.FLIP_LEFT_RIGHT)
    fb, bb = still.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox(), back.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox()
    fitted = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    fitted.paste(back.crop(bb).resize((fb[2] - fb[0], fb[3] - fb[1]), Image.LANCZOS), fb[:2])
    fitted.save(DOCS / "img" / "aegis_back.webp", quality=88, method=6)

    a = np.asarray(still.getchannel("A"), dtype=np.float32) / 255
    b = np.asarray(fitted.getchannel("A"), dtype=np.float32) / 255
    inside = a > 0.5
    iou = (inside & (b > 0.5)).sum() / max(1, (inside | (b > 0.5)).sum())
    ys, xs = np.nonzero(inside)
    cx, cy = xs.mean(), ys.mean()

    pts = []
    for k in range(RAYS):
        t = 2 * math.pi * k / RAYS
        dx, dy = math.cos(t), -math.sin(t)
        r, last = 0.0, 0.0
        while r < FRAME:
            x, y = cx + dx * r, cy + dy * r
            if not (0 <= x < FRAME - 1 and 0 <= y < FRAME - 1):
                break
            if a[int(y), int(x)] > 0.5:
                last = r
            r += 0.25
        pts.append(last)
    # сглаживаем шум края по соседним лучам
    sm = [sorted([pts[k - 1], pts[k], pts[(k + 1) % RAYS]])[1] for k in range(RAYS)]
    out = []
    for k, r in enumerate(sm):
        t = 2 * math.pi * k / RAYS
        x, y = cx + math.cos(t) * r, cy - math.sin(t) * r
        out += [round((x - FRAME / 2) / (FRAME / 2), 3), round(-(y - FRAME / 2) / (FRAME / 2), 3)]
    (DOCS / "aegis_shape.js").write_text(
        "// Внешний контур Аегиса (x, y в долях полукадра, против часовой): tools/aegis_shape.py\n"
        f"export const OUTLINE = [{','.join(str(v) for v in out)}];\n", encoding="utf-8")
    print(f"лучей {RAYS}, центр {cx:.1f},{cy:.1f}, совпадение силуэтов спереди и сзади {iou:.2f}")


if __name__ == "__main__":
    main()
