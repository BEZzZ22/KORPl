"""Вырезает Аегис чемпионов с официальных фото dota2.com/aegisofchampions (чёрный фон) для 3D-знака приложения.

Запуск: python tools/cut_aegis.py <папка с front.jpg и back.jpg>
Фото: https://cdn.steamstatic.com/apps/dota2/images//aegis/hi-res/aegis_{front,back}.jpg
Пишет docs/img/aegis_front.webp, aegis_back.webp (лицо и оборот) и aegis_mask.png (силуэт для ребра и блика).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SIZE = 600  # сторона квадрата: знак до 130 px при плотности экрана 3x и запас на наклон
BG = 30  # ярче этого — уже щит, темнее и связано с краем — фон
OUT = Path(__file__).resolve().parent.parent / "docs" / "img"


def cut(path: Path, bg_level: int = BG) -> Image.Image:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    im = im.crop((0, 0, w, int(h * 0.86)))  # снизу логотип DOTA 2
    # фон — тёмное, связанное с краем кадра; тёмные места внутри щита остаются.
    # Заливку от краёв считаем на копии в 4 раза меньше: так быстро, край потом сглаживается
    small = im.resize((w // 4, im.height // 4), Image.BILINEAR)
    dark = np.asarray(small).max(axis=2) < bg_level
    bg = np.zeros_like(dark)
    bg[0, :], bg[-1, :], bg[:, 0], bg[:, -1] = dark[0, :], dark[-1, :], dark[:, 0], dark[:, -1]
    while True:
        grown = bg.copy()
        grown[1:, :] |= bg[:-1, :]
        grown[:-1, :] |= bg[1:, :]
        grown[:, 1:] |= bg[:, :-1]
        grown[:, :-1] |= bg[:, 1:]
        grown &= dark
        if (grown == bg).all():
            break
        bg = grown
    mask = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)
    # мягкий край без тёмной каймы от тени на фото
    mask = mask.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.6))
    im.putalpha(mask)
    box = mask.point(lambda v: 255 if v > 40 else 0).getbbox()
    im = im.crop(box)
    side = max(im.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return square.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    src = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    front = cut(src / "front.jpg")
    back = cut(src / "back.jpg", 10)  # на обороте нижний правый край в тени: порог ниже
    front.save(OUT / "aegis_front.webp", "WEBP", quality=86, method=6)
    back.save(OUT / "aegis_back.webp", "WEBP", quality=80, method=6)
    # силуэт: чёрный с альфой, для mask-image ребра и блика
    alpha = front.getchannel("A").resize((300, 300), Image.LANCZOS)
    mask = Image.new("RGBA", alpha.size, (0, 0, 0, 0))
    mask.putalpha(alpha)
    mask.save(OUT / "aegis_mask.png", optimize=True)
    for name in ("aegis_front.webp", "aegis_back.webp", "aegis_mask.png"):
        print(name, (OUT / name).stat().st_size, "байт")


if __name__ == "__main__":
    main()
