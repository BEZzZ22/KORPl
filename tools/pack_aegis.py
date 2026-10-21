"""Собирает раскадровку Аегиса в один спрайт для главной (docs/app.js, aegis()).

Кадры снимает tools/capture_aegis.mjs с 3D-модели Sketchfab «Aegis of champions» (автор msta2219, CC BY).
Запуск: python tools/pack_aegis.py <папка с f000.png ...>
Пишет docs/img/aegis_spin.webp (сетка COLS × строки, кадр FRAME px) и aegis_still.webp (анфас, грузится первым).
"""
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

FRAME = 360  # кадр на экране до ~170 px при плотности 2x, на 3x чуть мягче
COLS = 8
OUT = Path(__file__).resolve().parent.parent / "docs" / "img"


def grade(im: Image.Image) -> Image.Image:
    """Чуть резче и контрастнее: после уменьшения чеканка не должна мылиться."""
    alpha = im.getchannel("A")
    rgb = im.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=2))
    rgb = ImageEnhance.Contrast(rgb).enhance(1.06)
    rgb.putalpha(alpha)
    return rgb


def main():
    files = sorted(Path(sys.argv[1]).glob("f*.png"))
    frames = [grade(Image.open(f).convert("RGBA").resize((FRAME, FRAME), Image.LANCZOS)) for f in files]
    rows = -(-len(frames) // COLS)
    sheet = Image.new("RGBA", (COLS * FRAME, rows * FRAME), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.paste(fr, ((i % COLS) * FRAME, (i // COLS) * FRAME))
    sheet.save(OUT / "aegis_spin.webp", "WEBP", quality=76, method=6, alpha_quality=85)
    frames[0].save(OUT / "aegis_still.webp", "WEBP", quality=88, method=6)
    for name in ("aegis_spin.webp", "aegis_still.webp"):
        print(name, (OUT / name).stat().st_size, "байт")
    print("кадров", len(frames), "сетка", COLS, "x", rows)


if __name__ == "__main__":
    main()
