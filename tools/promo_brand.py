"""Оформление канала: эмблема-аватар (800x800) и шапка YouTube (2560x1440, безопасная зона 1546x423 по центру).
Стиль «официальный»: чёрный с тёмно-красным, золотой кант, монограмма DR. Без чужих логотипов и артов Valve.
Запуск: python tools/promo_brand.py  ->  promo/brand/avatar.png, banner.png, watermark.png"""
import math
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "promo" / "brand"
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-{}.otf"
GOLD_HI, GOLD, GOLD_LO = (255, 228, 160), (226, 178, 84), (140, 92, 30)
RED, RED_DEEP, INK = (196, 44, 34), (58, 10, 10), (8, 8, 11)


def font(weight, size):
    return ImageFont.truetype(FONT.format(weight), size)


def vgrad(size, top, bottom):
    w, h = size
    k = np.linspace(0, 1, h)[:, None, None]
    arr = np.array(top)[None, None, :] * (1 - k) + np.array(bottom)[None, None, :] * k
    return Image.fromarray(np.repeat(arr, w, axis=1).astype(np.uint8), "RGB")


def radial(size, center, radius, inner, outer):
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.clip(np.hypot(xx - center[0], yy - center[1]) / radius, 0, 1)[..., None]
    arr = np.array(inner)[None, None, :] * (1 - d) + np.array(outer)[None, None, :] * d
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def gold_fill(mask):
    """Золото с бликом сверху и тенью снизу по маске."""
    g = vgrad(mask.size, GOLD_HI, GOLD_LO)
    shine = vgrad(mask.size, (255, 255, 255), GOLD)
    band = Image.new("L", mask.size, 0)
    w, h = mask.size
    ImageDraw.Draw(band).polygon([(0, int(h * 0.30)), (w, int(h * 0.18)), (w, int(h * 0.26)), (0, int(h * 0.38))], fill=70)
    g = Image.composite(shine, g, band.filter(ImageFilter.GaussianBlur(w / 80)))
    out = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    out.paste(g, (0, 0), mask)
    return out


def emblem(size):
    """Круглая эмблема: тёмно-красный центр, двойной золотой кант, монограмма DR, засечки по кругу."""
    S = size * 4
    c = S / 2
    img = radial((S, S), (c, c * 0.8), S * 0.62, (120, 22, 18), INK).convert("RGBA")
    circle = Image.new("L", (S, S), 0)
    ImageDraw.Draw(circle).ellipse((0, 0, S - 1, S - 1), fill=255)
    # кольца
    rings = Image.new("L", (S, S), 0)
    dr = ImageDraw.Draw(rings)
    m = S * 0.035
    dr.ellipse((m, m, S - m, S - m), outline=255, width=int(S * 0.028))
    m2 = S * 0.105
    dr.ellipse((m2, m2, S - m2, S - m2), outline=255, width=int(S * 0.008))
    # засечки между кольцами: 24 штуки, каждая шестая крупнее
    for i in range(24):
        a = i / 24 * 2 * math.pi - math.pi / 2
        r1, r2 = S * 0.405, S * (0.44 if i % 6 == 0 else 0.425)
        wdt = int(S * (0.012 if i % 6 == 0 else 0.006))
        dr.line([(c + r1 * math.cos(a), c + r1 * math.sin(a)), (c + r2 * math.cos(a), c + r2 * math.sin(a))], fill=255, width=wdt)
    # монограмма
    f = font("Black", int(S * 0.40))
    txt = Image.new("L", (S, S), 0)
    dt = ImageDraw.Draw(txt)
    bb = dt.textbbox((0, 0), "DR", font=f)
    tx, ty = c - (bb[0] + bb[2]) / 2, c - (bb[1] + bb[3]) / 2 - S * 0.02
    dt.text((tx, ty), "DR", font=f, fill=255)
    # красный «разрез» по монограмме: диагональ, как штрих на графике
    cut = Image.new("L", (S, S), 0)
    ImageDraw.Draw(cut).line([(S * 0.24, S * 0.66), (S * 0.44, S * 0.52), (S * 0.56, S * 0.60), (S * 0.78, S * 0.36)], fill=255, width=int(S * 0.03), joint="curve")
    txt_cut = ImageChops.subtract(txt, cut.filter(ImageFilter.MaxFilter(int(S * 0.02) | 1)))
    # подпись снизу
    f2 = font("Bold", int(S * 0.062))
    cap = "DOTA 2 · РАЗБОР"
    cw = dt.textlength(cap, font=f2)
    capm = Image.new("L", (S, S), 0)
    ImageDraw.Draw(capm).text((c - cw / 2, S * 0.725), cap, font=f2, fill=255)
    # тени
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow.putalpha(txt.filter(ImageFilter.GaussianBlur(S * 0.02)).point(lambda v: int(v * 0.85)))
    img.alpha_composite(shadow, (0, int(S * 0.012)))
    img.alpha_composite(gold_fill(rings))
    img.alpha_composite(gold_fill(txt_cut))
    red_line = Image.new("RGBA", (S, S), RED + (0,))
    red_line.putalpha(cut)
    glow = Image.new("RGBA", (S, S), (255, 70, 50, 0))
    glow.putalpha(cut.filter(ImageFilter.GaussianBlur(S * 0.015)).point(lambda v: int(v * 0.8)))
    img.alpha_composite(glow)
    img.alpha_composite(red_line)
    capc = Image.new("RGBA", (S, S), GOLD + (0,))
    capc.putalpha(capm.point(lambda v: int(v * 0.9)))
    img.alpha_composite(capc)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), circle)
    return out.resize((size, size), Image.LANCZOS)


def banner():
    W, H = 2560, 1440
    img = radial((W, H), (W * 0.5, H * 0.45), W * 0.62, (64, 12, 12), INK).convert("RGBA")
    # сетка «карты» и линия графика на фоне — тихо, чтобы не спорить с текстом
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dg = ImageDraw.Draw(grid)
    for x in range(0, W, 80):
        dg.line([(x, 0), (x, H)], fill=(255, 210, 140, 10), width=1)
    for y in range(0, H, 80):
        dg.line([(0, y), (W, y)], fill=(255, 210, 140, 10), width=1)
    rng = np.random.default_rng(7)
    pts, v = [], 0.0
    for i, x in enumerate(range(-40, W + 80, 80)):
        v += rng.normal(0, 1)
        if 12 < i < 18:
            v -= 2.2                                   # провал посередине: «где перевернулась катка»
        pts.append((x, H * 0.62 - v * 22))
    dg.line(pts, fill=(196, 44, 34, 70), width=5, joint="curve")
    img.alpha_composite(grid)
    # золотые искры
    sp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ds = ImageDraw.Draw(sp)
    for _ in range(160):
        x, y, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.5, 4)
        ds.ellipse((x - r, y - r, x + r, y + r), fill=(255, 214, 120, int(rng.uniform(40, 140))))
    img.alpha_composite(sp.filter(ImageFilter.GaussianBlur(1.2)))
    # кадры из роликов по краям: видны на ТВ и компьютере, в безопасную зону не лезут
    for name, x, ang in (("review", 30, -8), ("deathmap", 2075, 8)):
        src = ROOT / "promo" / "reels" / f"{name}.mp4"
        if not src.exists():
            continue
        with tempfile.TemporaryDirectory() as tmp:
            fr = Path(tmp) / "f.png"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "8", "-i", str(src), "-frames:v", "1", str(fr)], check=True)
            shot = Image.open(fr).convert("RGB").crop((90, 600, 990, 1460)).resize((400, 382), Image.LANCZOS)
        card = Image.new("RGBA", (440, 422), (0, 0, 0, 0))
        mask = Image.new("L", (400, 382), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, 399, 381), radius=26, fill=255)
        card.paste(shot, (20, 20), mask)
        ImageDraw.Draw(card).rounded_rectangle((18, 18, 421, 403), radius=28, outline=GOLD_LO + (255,), width=3)
        card.putalpha(card.getchannel("A").point(lambda v: int(v * 0.55)))
        card = card.rotate(ang, resample=Image.BICUBIC, expand=True)
        img.alpha_composite(card, (x, 500))
    # безопасная зона: эмблема + имя + подпись + бот
    sx, sy, sw, sh = (W - 1546) // 2, (H - 423) // 2, 1546, 423
    em = emblem(330)
    img.alpha_composite(em, (sx + 20, sy + (sh - 330) // 2))
    tx = sx + 400
    f1, f2, f3 = font("Black", 132), font("SemiBold", 50), font("Bold", 44)
    name = Image.new("L", (W, 170), 0)
    ImageDraw.Draw(name).text((0, 0), "DOTARAZBOR", font=f1, fill=255)
    nm = gold_fill(name)
    sh_ = Image.new("RGBA", nm.size, (0, 0, 0, 0))
    sh_.putalpha(name.filter(ImageFilter.GaussianBlur(10)))
    img.alpha_composite(sh_, (tx, sy + 48 + 6))
    img.alpha_composite(nm, (tx, sy + 48))
    d = ImageDraw.Draw(img)
    d.text((tx + 6, sy + 205), "Разбор твоей катки Dota 2 за секунды", font=f2, fill=(244, 240, 232, 255))
    pill = "Telegram  @DotaRazbor_bot"
    pw = d.textlength(pill, font=f3)
    d.rounded_rectangle((tx + 4, sy + 290, tx + 4 + pw + 64, sy + 290 + 78), radius=39, fill=(150, 30, 24, 255), outline=GOLD + (255,), width=3)
    d.text((tx + 36, sy + 302), pill, font=f3, fill=(255, 240, 220, 255))
    return img.convert("RGB")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    av = emblem(800)
    flat = Image.new("RGB", av.size, INK)
    flat.paste(av, (0, 0), av)
    flat.save(OUT / "avatar.png")
    emblem(150).save(OUT / "watermark.png")
    banner().save(OUT / "banner.png", optimize=True)
    print("готово:", ", ".join(p.name for p in sorted(OUT.iterdir())))


if __name__ == "__main__":
    main()
