"""Аватарка канала: вращающийся Аегис на фоне с лучами, свечением и искрами. Видео-аватарка (mp4) + статичная версия (png).
Кадры щита: node tools/promo_avatar_frames.mjs <папка> 90. Сборка: python tools/promo_avatar.py <папка с кадрами>
Результат: promo/avatar.mp4 (512x512, петля 3 с, без звука, до 2 МБ) и promo/avatar.png (кадр для ботов и как запас)."""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
S, FPS = 512, 30
GOLD = np.array([255, 196, 92], dtype=np.float32)
CRIMSON = np.array([120, 18, 26], dtype=np.float32)

yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
cx = cy = (S - 1) / 2
rad = np.hypot(xx - cx, yy - cy) / (S / 2)
theta = np.arctan2(yy - cy, xx - cx)
rng = np.random.default_rng(7)
SPARKS = [(rng.uniform(0, S), rng.uniform(0, S), rng.uniform(0.6, 1.8), rng.uniform(40, 120), rng.uniform(0, 6.28)) for _ in range(46)]


def background(t, phase):
    """t в 0..1 по петле; всё периодично, чтобы стык видео не был виден."""
    base = np.clip(1 - rad * 1.05, 0, 1) ** 1.6
    img = np.zeros((S, S, 3), np.float32) + 6
    img += base[..., None] * CRIMSON * 1.9                         # багровое ядро
    pulse = 0.85 + 0.15 * np.sin(phase)
    img += (np.clip(1 - rad * 1.6, 0, 1) ** 2.2)[..., None] * GOLD * 0.85 * pulse   # золотое свечение за щитом
    rays = (0.5 + 0.5 * np.cos(9 * (theta - 2 * np.pi * t))) ** 3 * np.clip(1.15 - rad, 0, 1) ** 1.4
    img += rays[..., None] * GOLD * 0.62
    img *= (1 - 0.55 * np.clip(rad - 0.55, 0, 1) ** 1.5)[..., None]   # виньетка
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    px = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    spark = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    for x, y, r, speed, off in SPARKS:                               # искры поднимаются вверх по кругу
        yy_ = (y - speed * t * 3) % S
        a = int(120 + 120 * np.sin(2 * np.pi * (t * 2) + off))
        for dx in range(-int(r * 2), int(r * 2) + 1):
            for dy in range(-int(r * 2), int(r * 2) + 1):
                if dx * dx + dy * dy <= (r * 1.4) ** 2 and 0 <= x + dx < S and 0 <= yy_ + dy < S:
                    spark.putpixel((int(x + dx), int(yy_ + dy)), (255, 214, 120, max(30, min(255, a))))
    spark = spark.filter(ImageFilter.GaussianBlur(0.8))
    out = out.convert("RGBA")
    out.alpha_composite(spark)
    return out


def frame(shield_path, i, n):
    t = i / n
    bg = background(t, 2 * np.pi * t)
    shield = Image.open(shield_path).convert("RGBA")
    size = int(S * 0.80)
    shield = shield.resize((size, size), Image.LANCZOS)
    fade = np.ones(size, np.float32)                       # у нижнего края кадра WebGL остаётся ровный срез тени: плавно гасим
    cut = int(size * 0.10)
    fade[-cut:] = np.linspace(1, 0, cut) ** 1.5
    shield.putalpha(Image.fromarray((np.array(shield.getchannel("A"), np.float32) * fade[:, None]).astype(np.uint8)))
    pos = ((S - size) // 2, (S - size) // 2 - 4)
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    halo = Image.new("RGBA", shield.size, (255, 190, 80, 0))
    halo.putalpha(shield.getchannel("A").point(lambda v: int(v * 0.7)))
    glow.paste(halo, pos)
    bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(22)))
    bg.alpha_composite(shield, pos)
    return bg.convert("RGB")


def main(folder):
    shields = sorted(Path(folder).glob("f*.png"))
    n = len(shields)
    out = Path(folder) / "out"
    out.mkdir(exist_ok=True)
    for i, s in enumerate(shields):
        frame(s, i, n).save(out / f"c{i:03d}.png")
    frame(shields[0], 0, n).save(ROOT / "promo" / "avatar.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(out / "c%03d.png"), "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", "-an", str(ROOT / "promo" / "avatar.mp4")], check=True)
    print("готово: promo/avatar.mp4, promo/avatar.png")


if __name__ == "__main__":
    main(sys.argv[1])
