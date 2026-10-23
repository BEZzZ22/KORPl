"""Shorts для YouTube: перемонтаж готовых рилсов promo/reels/<id>.mp4 в динамичный ролик 9:16 на 14 с.
0-1,4 с — хук: заголовок капсом во весь экран с ударом; 1,4-11 с — три склейки экрана мини-аппа со вспышкой, зумом
и подписью-аргументом (1/3, 2/3, 3/3); 11-14 с — эмблема канала и призыв к боту. Сверху полоса прогресса.
Звук: музыка tools/promo_sound.py + удар на хуке, «вуш» на каждой склейке, щелчки подписей, подъём к финалу.
Оформление — promo/brand (python tools/promo_brand.py). Рилсы — tools/promo_reels.py, отсюда берётся только экран.
Запуск: python tools/promo_shorts.py [id ...]  ->  promo/shorts/<id>.mp4"""
import math
import subprocess
import sys
import tempfile
import wave
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from promo_reels import REELS  # noqa: E402
from promo_sound import SR, kick, lowpass, make_track, whoosh  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT, BRAND = ROOT / "promo" / "reels", ROOT / "promo" / "shorts", ROOT / "promo" / "brand"
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-{}.otf"
W, H, FPS, SECONDS = 1080, 1920, 30, 14
HOOK, CTA = 1.4, 11.0
CUTS = [HOOK, 4.6, 7.8]                       # начала трёх склеек
SRC_AT = [(2.0, 5.2), (5.3, 8.5), (8.4, 11.6)]   # откуда в исходном рилсе берём каждую склейку (там идёт прокрутка)
CROP = (92, 602, 988, 1458)                   # окно со скриншотом в исходном рилсе
WIN_W = 940
WIN_H = int(WIN_W * (CROP[3] - CROP[1]) / (CROP[2] - CROP[0]))
WIN_X, WIN_Y = (W - WIN_W) // 2, 530
GOLD, RED, TEXT, MUTED, INK = (236, 190, 96), (206, 50, 38), (246, 244, 240), (170, 168, 178), (8, 8, 11)


def clamp01(x):
    return max(0.0, min(1.0, x))


def ease(t):
    t = clamp01(t)
    return t * t * (3 - 2 * t)


def out_back(t, c=1.9):
    t = clamp01(t)
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def font(weight, size):
    return ImageFont.truetype(FONT.format(weight), size)


def wrap(text, fnt, width):
    d = ImageDraw.Draw(Image.new("L", (1, 1)))
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if d.textlength(trial, font=fnt) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


def text_layer(lines, fnt, fill, step, shadow=True, align="center", width=W):
    h = step * len(lines) + 40
    layer = Image.new("RGBA", (width, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i, ln in enumerate(lines):
        tw = d.textlength(ln, font=fnt)
        x = (width - tw) / 2 if align == "center" else 0
        d.text((x, 10 + i * step), ln, font=fnt, fill=fill)
    if shadow:
        sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        sh.putalpha(layer.getchannel("A").filter(ImageFilter.GaussianBlur(9)).point(lambda v: int(v * 0.9)))
        out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        out.alpha_composite(sh, (0, 5))
        out.alpha_composite(layer)
        return out
    return layer


def scaled(layer, k, alpha=1.0):
    if k <= 0.01 or alpha <= 0:
        return None
    w, h = max(1, int(layer.width * k)), max(1, int(layer.height * k))
    out = layer.resize((w, h), Image.BILINEAR)
    if alpha < 1:
        out.putalpha(out.getchannel("A").point(lambda v: int(v * alpha)))
    return out


def paste_center(img, layer, cx, cy):
    if layer is not None:
        img.alpha_composite(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)))


class Short:
    def __init__(self, name, frames_dir, seed):
        _, _, _, title, sub, chips, *_ = REELS[name]
        self.name, self.frames, self.chips = name, frames_dir, chips
        rng = np.random.default_rng(seed)
        # фон: тёмный с красным и золотым свечением
        yy, xx = np.mgrid[0:H, 0:W]
        base = np.zeros((H, W, 3))
        for cx, cy, r, col in ((W * 0.15, H * 0.12, 900, (120, 22, 18)), (W * 0.9, H * 0.85, 1000, (90, 60, 14))):
            k = np.clip(1 - np.hypot(xx - cx, yy - cy) / r, 0, 1)[..., None] ** 2
            base += k * np.array(col)
        self.bg = Image.fromarray(np.clip(base + np.array(INK), 0, 255).astype(np.uint8), "RGB").convert("RGBA")
        self.sparks = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.4, 3.6), rng.uniform(50, 160), rng.uniform(0, 6.28)) for _ in range(45)]
        # хук: заголовок капсом поверх размытого экрана
        hook_src = Image.open(self.frame_path(5.0)).convert("RGB").resize((W, int(W * WIN_H / WIN_W)))
        hb = Image.new("RGB", (W, H), INK)
        hb.paste(hook_src.resize((int(W * 1.8), int(hook_src.height * 1.8))), (-int(W * 0.4), 200))
        self.hook_bg = Image.blend(hb.filter(ImageFilter.GaussianBlur(26)), Image.new("RGB", (W, H), INK), 0.55).convert("RGBA")
        f_hook = font("Black", 118)
        self.hook = text_layer(wrap(title.upper(), f_hook, W - 120), f_hook, TEXT + (255,), 126)
        f_tag = font("Bold", 40)
        self.tag = self.pill("РАЗБОР КАТКИ · DOTA 2", f_tag, (150, 30, 24), GOLD)
        # шапка во время склеек
        f_head = font("ExtraBold", 64)
        self.head = text_layer(wrap(title, f_head, W - 140), f_head, TEXT + (255,), 72)
        self.subl = text_layer([sub], font("SemiBold", 38), GOLD + (255,), 44, shadow=False)
        # подписи склеек
        f_cap = font("Black", 54)
        self.caps = [self.pill(f"{i + 1}/3  {c}", f_cap, (24, 20, 12), GOLD, pad=(44, 22)) for i, c in enumerate(chips)]
        # окно и тень
        self.mask = Image.new("L", (WIN_W, WIN_H), 0)
        ImageDraw.Draw(self.mask).rounded_rectangle((0, 0, WIN_W - 1, WIN_H - 1), radius=38, fill=255)
        sh = Image.new("L", (WIN_W + 160, WIN_H + 160), 0)
        ImageDraw.Draw(sh).rounded_rectangle((80, 90, 80 + WIN_W, 90 + WIN_H), radius=44, fill=200)
        self.shadow = sh.filter(ImageFilter.GaussianBlur(36))
        # эмблема и финал
        self.emblem = Image.open(BRAND / "watermark.png").convert("RGBA")
        self.emblem_big = Image.open(BRAND / "avatar.png").convert("RGBA").resize((420, 420), Image.LANCZOS)
        circ = Image.new("L", (420, 420), 0)
        ImageDraw.Draw(circ).ellipse((0, 0, 419, 419), fill=255)
        self.emblem_big.putalpha(circ)
        self.brand = text_layer(["DotaRazbor"], font("Bold", 40), TEXT + (255,), 44, shadow=False, align="left", width=400)
        self.cta1 = text_layer(["Кинь Match ID боту"], font("Black", 88), TEXT + (255,), 96)
        self.cta2 = self.pill("@DotaRazbor_bot", font("Black", 72), (170, 34, 26), GOLD, pad=(56, 26))
        self.cta3 = text_layer(["Бесплатно · Telegram · ссылка в описании"], font("SemiBold", 38), MUTED + (255,), 44, shadow=False)

    @staticmethod
    def pill(text, fnt, fill, outline, pad=(36, 16)):
        d = ImageDraw.Draw(Image.new("L", (1, 1)))
        bb = d.textbbox((0, 0), text, font=fnt)
        w, h = int(bb[2] - bb[0] + pad[0] * 2), int(bb[3] - bb[1] + pad[1] * 2)
        layer = Image.new("RGBA", (w + 8, h + 8), (0, 0, 0, 0))
        dl = ImageDraw.Draw(layer)
        dl.rounded_rectangle((4, 4, w + 3, h + 3), radius=h // 2, fill=fill + (240,), outline=outline + (255,), width=4)
        dl.text((4 + pad[0] - bb[0], 4 + pad[1] - bb[1]), text, font=fnt, fill=outline + (255,) if fill[0] < 60 else (255, 240, 220, 255))
        return layer

    def frame_path(self, t):
        return self.frames / f"s{min(int(t * FPS), FPS * 15 - 1) + 1:04d}.png"

    def background(self, t):
        img = self.bg.copy()
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dl = ImageDraw.Draw(layer)
        for x, y, r, speed, ph in self.sparks:
            yy = (y - speed * t) % H
            a = int(80 + 80 * math.sin(t * 2.4 + ph))
            dl.ellipse((x - r, yy - r, x + r, yy + r), fill=(255, 214, 120, max(20, a)))
        img.alpha_composite(layer)
        return img

    def window(self, img, t):
        seg = max(i for i, c in enumerate(CUTS) if t >= c)
        seg_end = CUTS[seg + 1] if seg + 1 < len(CUTS) else CTA
        k = (t - CUTS[seg]) / (seg_end - CUTS[seg])
        a, b = SRC_AT[seg]
        piece = Image.open(self.frame_path(a + (b - a) * k)).convert("RGB")
        # зум внутри склейки: чётные — наезд к центру, нечётная — к верху
        z = 1.0 + 0.12 * ease(k) + 0.06 * (1 - ease((t - CUTS[seg]) / 0.25))   # плюс «удар» на входе
        cw, ch = piece.width / z, piece.height / z
        cx = piece.width / 2
        cy = piece.height * (0.5 if seg != 1 else 0.38)
        x0, y0 = max(0, min(cx - cw / 2, piece.width - cw)), max(0, min(cy - ch / 2, piece.height - ch))
        piece = piece.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((WIN_W, WIN_H), Image.BILINEAR)
        # тряска на склейке
        shake = 1 - clamp01((t - CUTS[seg]) / 0.2)
        dx, dy = int(14 * shake * math.sin(t * 90)), int(10 * shake * math.cos(t * 70))
        kin = out_back((t - HOOK) / 0.5)
        wy = WIN_Y + int((1 - kin) * 300) + dy
        img.paste((0, 0, 0), (WIN_X - 80 + dx, wy - 60), self.shadow)
        img.paste(piece, (WIN_X + dx, wy), self.mask)
        ImageDraw.Draw(img).rounded_rectangle((WIN_X - 3 + dx, wy - 3, WIN_X + WIN_W + 2 + dx, wy + WIN_H + 2), radius=41, outline=GOLD + (255,), width=4)
        # подпись склейки: выпрыгивает над окном
        kc = out_back((t - CUTS[seg] - 0.05) / 0.35)
        paste_center(img, scaled(self.caps[seg], 0.6 + 0.4 * kc, clamp01(kc * 2)), W / 2, WIN_Y - 62 + dy)
        # вспышка на склейке
        fl = 1 - clamp01((t - CUTS[seg]) / 0.12) if seg > 0 else 0
        if fl > 0:
            img.alpha_composite(Image.new("RGBA", (W, H), (255, 244, 220, int(200 * fl))))

    def frame(self, t):
        if t < HOOK:
            img = self.hook_bg.copy()
            k = out_back(t / 0.35, 2.4)
            zoom = 1.35 - 0.35 * k + 0.03 * t
            shake = 1 - clamp01(t / 0.25)
            paste_center(img, scaled(self.hook, zoom, clamp01(t / 0.12)), W / 2 + 16 * shake * math.sin(t * 80), H * 0.46)
            paste_center(img, scaled(self.tag, out_back((t - 0.35) / 0.3)), W / 2, H * 0.46 - self.hook.height / 2 - 60)
            if t > HOOK - 0.15:                         # уход в склейку вспышкой
                img.alpha_composite(Image.new("RGBA", (W, H), (255, 244, 220, int(220 * clamp01((t - HOOK + 0.15) / 0.15)))))
        elif t < CTA:
            img = self.background(t)
            # шапка: эмблема + название канала, заголовок, подзаголовок
            img.alpha_composite(self.emblem.resize((96, 96), Image.LANCZOS), (60, 110))
            img.alpha_composite(self.brand, (172, 128))
            hk = ease((t - HOOK) / 0.4)
            hl = scaled(self.head, 0.85 + 0.15 * hk, hk)
            if hl is not None:
                img.alpha_composite(hl, (int((W - hl.width) / 2), 220))
            self.window(img, t)
            sl = scaled(self.subl, 1, ease((t - HOOK - 0.3) / 0.4))
            if sl is not None:
                img.alpha_composite(sl, (0, WIN_Y + WIN_H + 34))
        else:
            img = self.background(t)
            img.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 120)))
            k = out_back((t - CTA) / 0.5)
            pulse = 1 + 0.025 * math.sin((t - CTA) * 7)
            glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(glow).ellipse((W / 2 - 300, 640 - 300, W / 2 + 300, 640 + 300), fill=(220, 60, 40, int(110 * clamp01(k))))
            img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(70)))
            paste_center(img, scaled(self.emblem_big, k * pulse), W / 2, 640)
            paste_center(img, scaled(self.cta1, 1, ease((t - CTA - 0.3) / 0.35)), W / 2, 960)
            paste_center(img, scaled(self.cta2, out_back((t - CTA - 0.55) / 0.4) * pulse), W / 2, 1100)
            paste_center(img, scaled(self.cta3, 1, ease((t - CTA - 0.9) / 0.4)), W / 2, 1220)
            if t < CTA + 0.1:
                img.alpha_composite(Image.new("RGBA", (W, H), (255, 244, 220, int(220 * (1 - (t - CTA) / 0.1)))))
        # полоса прогресса
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, W, 9), fill=(40, 30, 20, 255))
        d.rectangle((0, 0, int(W * t / SECONDS), 9), fill=GOLD + (255,))
        return img.convert("RGB")


def sound(path, seed):
    """Музыка из promo_sound приглушённо + эффекты по монтажу."""
    tmp = Path(path).with_suffix(".music.wav")
    make_track(tmp, SECONDS, seed)
    with wave.open(str(tmp)) as w:
        music = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2).astype(float) / 32767
    tmp.unlink()
    n = int(SECONDS * SR)
    music = np.pad(music, ((0, max(0, n - len(music))), (0, 0)))[:n]
    fx = np.zeros(n)
    rng = np.random.default_rng(seed + 100)

    def add(at, sig, gain):
        s = int(at * SR)
        e = min(n, s + len(sig))
        fx[s:e] += sig[: e - s] * gain

    boom = kick() + lowpass(rng.standard_normal(len(kick())), 0.04) * 0.6
    add(0.0, boom, 1.1)                                  # удар на хуке
    sub = np.sin(2 * np.pi * 42 * np.arange(int(0.9 * SR)) / SR) * np.exp(-np.arange(int(0.9 * SR)) / SR / 0.35)
    add(0.0, sub, 0.7)
    for c in CUTS[1:] + [HOOK, CTA]:
        add(c - 0.35, whoosh(rng, 0.38), 0.9)            # «вуш» в склейку
        add(c, kick(), 0.6)
    for c in CUTS:                                       # щелчок подписи
        m = int(0.05 * SR)
        add(c + 0.1, np.sin(2 * np.pi * 1800 * np.arange(m) / SR) * np.exp(-np.arange(m) / SR / 0.012), 0.35)
    riser_n = int(1.6 * SR)                              # подъём к финалу
    noise = rng.standard_normal(riser_n)
    riser = (noise - lowpass(noise, 0.1)) * np.linspace(0, 1, riser_n) ** 3
    add(CTA - 1.6, riser, 0.35)
    add(CTA, boom, 1.0)
    add(CTA, sub, 0.8)
    # в хуке музыка тише, чтобы удар читался; дальше обычный уровень
    gain = np.ones(n) * 0.75
    gain[: int(HOOK * SR)] = 0.35
    mix = music * gain[:, None] + fx[:, None]
    mix = np.tanh(mix * 1.2)
    mix = mix / np.max(np.abs(mix)) * 0.89
    pcm = (mix * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def make(name):
    idx = list(REELS).index(name)
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        x0, y0, x1, y1 = CROP
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(SRC / f"{name}.mp4"), "-vf", f"crop={x1 - x0}:{y1 - y0}:{x0}:{y0}", "-r", str(FPS),
                        str(tmp / "s%04d.png")], check=True)
        short = Short(name, tmp, idx + 31)
        wav = tmp / "sound.wav"
        sound(wav, idx + 1)
        enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                                "-i", str(wav), "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-profile:v", "high",
                                "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-shortest", str(OUT / f"{name}.mp4")], stdin=subprocess.PIPE)
        for i in range(FPS * SECONDS):
            enc.stdin.write(short.frame(i / FPS).tobytes())
        enc.stdin.close()
        if enc.wait():
            raise RuntimeError(f"ffmpeg упал на {name}")
    return name


if __name__ == "__main__":
    names = sys.argv[1:] or list(REELS)
    with ProcessPoolExecutor() as pool:
        for n in pool.map(make, names):
            print("готово", n)
