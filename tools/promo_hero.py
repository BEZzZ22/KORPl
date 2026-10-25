"""Ролик-эталон «Угадай ранг по трём уликам»: формат, который сейчас хорошо заходит в игровых Shorts и TikTok
(зритель угадывает и пишет версию в комменты, ответ в конце держит досмотр).
Монтаж собран по битам своего трека (120 BPM): хук с первого кадра, три улики со скриншотами бота и наездом камеры
на нужную строку, рулетка рангов с нарастанием, тишина перед дропом, ответ с ударом, твист, финал с ботом.
Все цифры — с настоящих экранов разбора (рилсы deathlist и missing, матч Undying, ранг Страж).
Запуск: python tools/promo_hero.py [имя]  ->  promo/shorts/<имя>.mp4 (по умолчанию guessrank)"""
import math
import subprocess
import sys
import tempfile
import wave
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from promo_memes import (CROP, FPS, GREEN, H, INK, MUTED, RED, W, WHITE, Caption, Headline, clamp01, ease, expo,  # noqa: E402
                         font, label, line_layer, put)
from promo_sound import SR, clap, hat, kick, tone, whoosh  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REELS, OUT, BRAND = ROOT / "promo" / "reels", ROOT / "promo" / "shorts", ROOT / "promo" / "brand"
GOLD = (255, 196, 64)
BEAT = 0.5                                  # 120 BPM
T_C1, T_C2, T_C3, T_ROUL, T_LAND, T_DROP, T_TWIST, T_CTA, END = 2.0, 5.0, 8.0, 11.0, 13.75, 14.0, 16.5, 19.5, 23.0
RANKS = ["Рекрут", "Страж", "Рыцарь", "Герой", "Легенда", "Властелин", "Божество", "Титан"]
SPIN = 3 * len(RANKS) + RANKS.index("Страж")     # сколько позиций прокрутит рулетка

# кадры экрана: (рилс, секунда). Координаты зон — в обрезке CROP (896x856)
STILLS = {"am": ("deathlist", 10), "respawn": ("deathlist", 2), "glimmer": ("missing", 4.2), "xpm": ("missing", 8.2)}
CLUES = [  # начало, кадр, заголовок, зона наезда, зона подсветки
    (T_C1, "am", "10 смертей от одного Anti-Mage", (20, 600, 880, 856), (20, 712, 876, 856)),
    (T_C2, "respawn", "5 раз умер сразу после возрождения", (60, 380, 840, 720), (300, 546, 708, 610)),
    (T_C3, "glimmer", "Glimmer Cape так и не собрал", (40, 100, 860, 460), (64, 126, 624, 190)),
]
ROI_RANK, ROI_XPM = (390, 698, 656, 752), (28, 624, 872, 786)


def lerp(a, b, k):
    return tuple(x + (y - x) * k for x, y in zip(a, b))


class Hero:
    def __init__(self, tmp):
        tmp = Path(tmp)
        self.stills = {k: Image.open(tmp / f"{k}.png").convert("RGB") for k in STILLS}
        self.scroll = sorted(tmp.glob("d*.png"))
        rng = np.random.default_rng(17)
        field = Image.new("RGB", (W + 400, H + 400), INK)
        d = ImageDraw.Draw(field)
        for cx, cy, r, col in ((300, 500, 560, (110, 22, 16)), (W, H * 0.7, 620, (90, 60, 14)), (W * 0.6, 200, 420, (60, 14, 20))):
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=col)
        self.field = field.filter(ImageFilter.GaussianBlur(240))
        yy, xx = np.mgrid[0:H, 0:W]
        v = np.clip((np.hypot((xx - W / 2) / (W * 0.62), (yy - H / 2) / (H * 0.58)) - 0.5) / 0.6, 0, 1) ** 1.5
        self.vignette = Image.fromarray(np.dstack([np.zeros((H, W, 3)), v * 210]).astype(np.uint8), "RGBA")
        self.grain = []
        for _ in range(8):
            g = rng.normal(0, 1, (H // 2, W // 2))
            a = (np.abs(g) * 9).clip(0, 40).astype(np.uint8)
            col = np.where(g > 0, 255, 0).astype(np.uint8)
            layer = Image.fromarray(np.dstack([col, col, col, a]), "RGBA").resize((W, H), Image.NEAREST)
            self.grain.append(layer)
        em = Image.open(BRAND / "avatar.png").convert("RGBA").resize((220, 220), Image.LANCZOS)
        m = Image.new("L", em.size, 0)
        ImageDraw.Draw(m).ellipse((0, 0, 219, 219), fill=255)
        em.putalpha(m)
        self.emblem = em
        self.shadow = {}
        # тексты
        self.big17 = line_layer("17", "Black", 560, WHITE)
        self.sub17 = Headline("смертей за одну катку", "SemiBold", 58, (220, 214, 206))
        self.guess = Headline("Угадай ранг", "Black", 128, GOLD)
        self.guess2 = Headline("по трём уликам", "SemiBold", 54, MUTED)
        self.clue_tags = [label(f"Улика {i + 1} из 3", GOLD) for i in range(3)]
        self.clue_heads = [Headline(c[2], "Black", 80, WHITE, width=W - 150) for c in CLUES]
        self.roul_head = Headline("Какой это ранг?", "Black", 100, WHITE)
        self.roul_sub = Headline("пиши версию в комменты", "SemiBold", 50, MUTED)
        self.rank_layers = {r: line_layer(r, "Black", 132, WHITE) for r in RANKS}
        self.answer_tag = label("Ответ", GOLD)
        self.answer = line_layer("СТРАЖ", "Black", 250, GOLD)
        glow = Image.new("RGBA", self.answer.size, GOLD + (0,))
        glow.putalpha(self.answer.getchannel("A").filter(ImageFilter.GaussianBlur(40)).point(lambda v: int(v * 0.6)))
        self.answer_glow = glow
        self.twist = Headline("Зато по опыту в минуту обходит 76% саппортов на Страже", "Black", 70, WHITE, width=W - 150)
        self.twist_cap = Caption("Сливает не фарм, а смерти", 64, GOLD, per_word=0.22)
        self.cta_head = Headline("Кинь Match ID боту", "Black", 104, WHITE)
        self.cta_sub = Headline("и узнай, что сливает твои катки", "SemiBold", 52, (210, 206, 200))
        self.tick_times = self._ticks()

    # ---------- общие куски ----------
    def _ticks(self):
        out, last = [], 0
        for i in range(int((T_LAND - T_ROUL) * 600)):
            t = T_ROUL + i / 600
            p = round(self.spin(t))
            if p != last:
                out.append(t)
                last = p
        return out

    def spin(self, t):
        u = clamp01((t - T_ROUL) / (T_LAND - T_ROUL))
        return SPIN * (1 - (1 - u) ** 3.2)

    def background(self, t):
        ox, oy = 200 + 150 * math.sin(t * 0.3), 200 + 160 * math.cos(t * 0.23)
        return self.field.crop((int(ox), int(oy), int(ox) + W, int(oy) + H)).convert("RGBA")

    def hook_bg(self, img, t):
        """В хуке за цифрой быстро листается список смертей."""
        i = min(len(self.scroll) - 1, int(t / T_C1 * len(self.scroll)))
        fr = Image.open(self.scroll[i]).convert("RGB")
        s = H / fr.height
        fr = fr.resize((int(fr.width * s / 2), H // 2), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2.5)).resize((int(fr.width * s), H))
        x = (fr.width - W) // 2
        fr = fr.crop((x, 0, x + W, H)).convert("RGBA")
        fr.putalpha(70)
        img.alpha_composite(fr)

    def shot(self, key, zoom, roi, spot=0.0, box=None, box_k=0.0, width=940, bump=1.0):
        """Экран приложения карточкой. zoom 0..1 — от всего кадра до зоны roi; spot — затемнение вокруг box."""
        src = self.stills[key]
        iw, ih = src.size
        asp = iw / ih
        x0, y0, x1, y1 = roi
        ww = max((x1 - x0) * 1.12, (y1 - y0) * 1.12 * asp)
        ww = min(max(ww, iw * 0.62), iw)                          # не наезжать сильнее, чем в 1,6 раза
        wh = ww / asp
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        cx, cy = min(max(cx, ww / 2), iw - ww / 2), min(max(cy, wh / 2), ih - wh / 2)
        win = lerp((0, 0, iw, ih), (cx - ww / 2, cy - wh / 2, cx + ww / 2, cy + wh / 2), ease(zoom))
        hgt = int(width / asp)
        piece = src.transform((width, hgt), Image.EXTENT, win, Image.BICUBIC).convert("RGBA")
        sx, sy = width / (win[2] - win[0]), hgt / (win[3] - win[1])
        if box and (spot > 0 or box_k > 0):
            bx0, by0 = (box[0] - win[0]) * sx - 14, (box[1] - win[1]) * sy - 12
            bx1, by1 = (box[2] - win[0]) * sx + 14, (box[3] - win[1]) * sy + 12
            if spot > 0:
                dim = Image.new("L", piece.size, int(170 * spot))
                ImageDraw.Draw(dim).rounded_rectangle((bx0, by0, bx1, by1), radius=22, fill=0)
                shade = Image.new("RGBA", piece.size, (0, 0, 0, 255))
                shade.putalpha(dim)
                piece.alpha_composite(shade)
            if box_k > 0:
                g = 1 + 0.12 * (1 - expo(box_k / 0.6))          # рамка «защёлкивается» снаружи внутрь
                mx, my = (bx0 + bx1) / 2, (by0 + by1) / 2
                hw, hh = (bx1 - bx0) / 2 * g, (by1 - by0) / 2 * g
                col = self.box_col
                ov = Image.new("RGBA", piece.size, (0, 0, 0, 0))
                ImageDraw.Draw(ov).rounded_rectangle((mx - hw, my - hh, mx + hw, my + hh), radius=22, outline=col + (255,), width=6)
                gl = ov.filter(ImageFilter.GaussianBlur(10))
                a = clamp01(box_k / 0.15)
                for layer in (gl, gl, ov):
                    if a < 1:
                        layer = layer.copy()
                        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * a)))
                    piece.alpha_composite(layer)
        mask = Image.new("L", piece.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, hgt - 1), radius=36, fill=255)
        pad = 70
        out = Image.new("RGBA", (width + pad * 2, hgt + pad * 2), (0, 0, 0, 0))
        if (width, hgt) not in self.shadow:
            sh = Image.new("L", out.size, 0)
            ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 26, pad + width, pad + hgt + 26), radius=36, fill=210)
            layer = Image.new("RGBA", out.size, (0, 0, 0, 255))
            layer.putalpha(sh.filter(ImageFilter.GaussianBlur(32)))
            self.shadow[(width, hgt)] = layer
        out.alpha_composite(self.shadow[(width, hgt)])
        out.paste(piece, (pad, pad), mask)
        ImageDraw.Draw(out).rounded_rectangle((pad, pad, pad + width - 1, pad + hgt - 1), radius=36, outline=(255, 255, 255, 40), width=2)
        if abs(bump - 1) > 0.003:
            out = out.resize((int(out.width * bump), int(out.height * bump)), Image.BILINEAR)
        return out

    @staticmethod
    def kick_bump(t, t0):
        """Лёгкий «пульс» карточки на каждую долю после t0."""
        if t < t0:
            return 1.0
        ph = ((t - t0) % BEAT) / BEAT
        return 1 + 0.018 * math.exp(-ph * 9)

    # ---------- сцены ----------
    def hook(self, img, t):
        self.hook_bg(img, t)
        k = expo(t / 0.35)
        put(img, self.big17, W / 2, 760, 1.14 - 0.14 * k)               # уже на первом кадре цифра читается
        self.sub17.draw(img, W / 2, 1060, t * 1.6 + 0.3)
        self.guess.draw(img, W / 2, 1270, t - 0.75, dur=0.45)
        self.guess2.draw(img, W / 2, 1400, t - 1.15)

    def clue(self, img, t, i):
        t0, key, _, roi, box = CLUES[i]
        k = t - t0
        put(img, self.clue_tags[i], W / 2, 330, alpha=clamp01(k / 0.15))
        self.clue_heads[i].draw(img, W / 2, 500, k - 0.05, stagger=0.09, dur=0.45)
        self.box_col = GOLD
        z = expo((k - 0.55) / 0.7)
        c = self.shot(key, z, roi, spot=clamp01((k - 0.9) / 0.3), box=box, box_k=max(0, k - 1.0), bump=self.kick_bump(t, t0))
        e = expo(k / 0.5)
        put(img, c, W / 2, 1110 + (1 - e) * 140, 0.94 + 0.06 * e, alpha=clamp01(k / 0.12))

    def roulette(self, img, t):
        k = t - T_ROUL
        self.roul_head.draw(img, W / 2, 400, k)
        self.roul_sub.draw(img, W / 2, 530, k - 0.25)
        p = self.spin(t)
        base, f = math.floor(p), p - math.floor(p)
        cy = 1060
        landed = t >= T_LAND
        bar = Image.new("RGBA", (W - 220, 210), (0, 0, 0, 0))
        ImageDraw.Draw(bar).rounded_rectangle((0, 0, W - 221, 209), radius=36, fill=(255, 255, 255, 18),
                                              outline=(GOLD if landed else (255, 255, 255)) + (255 if landed else 70,), width=3)
        put(img, bar, W / 2, cy)
        for j in range(-3, 4):
            off = j - f
            if abs(off) > 1.9:
                continue
            name = RANKS[(base + j) % len(RANKS)]
            sc = max(0.45, 1 - abs(off) * 0.28)
            blur = min(6, abs(self.spin(t + 0.02) - p) * 6)             # смаз при быстрой прокрутке
            put(img, self.rank_layers[name], W / 2, cy + off * 175, sc, alpha=max(0, 1 - abs(off) * 0.5), blur=blur)
        # кольцо-таймер вокруг
        frac = clamp01(k / (T_LAND - T_ROUL))
        ring = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
        rd = ImageDraw.Draw(ring)
        rd.arc((10, 10, 290, 290), 0, 360, fill=(255, 255, 255, 40), width=10)
        rd.arc((10, 10, 290, 290), -90, -90 + 360 * frac, fill=GOLD + (255,), width=10)
        put(img, ring.resize((150, 150), Image.LANCZOS), W / 2, 1480)
        secs = max(1, math.ceil(T_LAND - t))
        put(img, line_layer(str(secs), "Black", 64, WHITE, shadow=False), W / 2, 1478)

    def drop(self, img, t):
        k = t - T_DROP
        sc = 1.55 - 0.55 * expo(k / 0.28)
        put(img, self.answer_tag, W / 2, 300, alpha=clamp01((k - 0.2) / 0.2))
        put(img, self.answer_glow, W / 2, 520, sc, alpha=0.6 + 0.4 * math.sin(k * 5) ** 2)
        put(img, self.answer, W / 2, 520, sc)
        self.box_col = GOLD
        z = 0.65 * expo((k - 0.4) / 0.6)
        c = self.shot("xpm", z, ROI_XPM, spot=clamp01((k - 0.7) / 0.3), box=ROI_RANK, box_k=max(0, k - 0.8), width=900,
                      bump=self.kick_bump(t, T_DROP))
        e = expo((k - 0.15) / 0.5)
        put(img, c, W / 2, 1180 + (1 - e) * 200, alpha=clamp01((k - 0.15) / 0.15))

    def twist_scene(self, img, t):
        k = t - T_TWIST
        self.twist.draw(img, W / 2, 470, k, stagger=0.08, dur=0.45)
        self.box_col = GREEN
        c = self.shot("xpm", 0.65, ROI_XPM, spot=1, box=ROI_XPM, box_k=max(0, k - 0.5), width=860, bump=self.kick_bump(t, T_TWIST))
        put(img, c, W / 2, 1040)
        self.twist_cap.draw(img, 1580, k - 1.2)

    def cta(self, img, t):
        k = t - T_CTA
        e = expo(k / 0.6)
        put(img, self.emblem, W / 2, 600 + (1 - e) * 60, 0.8 + 0.2 * e, alpha=clamp01(k / 0.2))
        self.cta_head.draw(img, W / 2, 860, k - 0.15)
        self.cta_sub.draw(img, W / 2, 1060, k - 0.4)
        handle = line_layer("@DotaRazbor_bot", "Black", 68, (24, 16, 6), shadow=False)
        pw, ph = handle.width + 50, handle.height + 22
        pill = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        ImageDraw.Draw(pill).rounded_rectangle((0, 0, pw - 1, ph - 1), radius=ph // 2, fill=GOLD + (255,))
        pill.alpha_composite(handle, (25, 11))
        sx = int(((k - 1.0) % 1.8) / 0.9 * (pw + 200)) - 100              # блик по плашке
        shine = Image.new("L", (pw, ph), 0)
        ImageDraw.Draw(shine).polygon([(sx, 0), (sx + 70, 0), (sx + 25, ph), (sx - 45, ph)], fill=110)
        sl = Image.new("RGBA", (pw, ph), (255, 255, 255, 0))
        sl.putalpha(Image.composite(shine, Image.new("L", (pw, ph), 0), pill.getchannel("A")))
        pill.alpha_composite(sl)
        e2 = expo((k - 0.6) / 0.5)
        put(img, pill, W / 2, 1220 + (1 - e2) * 50, alpha=clamp01((k - 0.6) / 0.15))
        put(img, line_layer("ссылка в описании", "SemiBold", 40, MUTED), W / 2, 1340, alpha=clamp01((k - 1.0) / 0.3))

    # ---------- кадр ----------
    def frame(self, i):
        t = i / FPS
        img = self.background(t)
        if t < T_C1:
            self.hook(img, t)
        elif t < T_ROUL:
            self.clue(img, t, 0 if t < T_C2 else 1 if t < T_C3 else 2)
        elif t < T_DROP:
            self.roulette(img, t)
        elif t < T_TWIST:
            self.drop(img, t)
        elif t < T_CTA:
            self.twist_scene(img, t)
        else:
            self.cta(img, t)
        img.alpha_composite(self.vignette)
        img.alpha_composite(self.grain[i % len(self.grain)])
        arr = np.asarray(img.convert("RGB")).copy()
        arr = self.whip(arr, t)
        k = t - T_DROP
        if 0 <= k < 0.5:                                                  # дроп: вспышка, тряска, расслоение цвета
            amp = (1 - k / 0.5) ** 2
            rng = np.random.default_rng(i)
            dx, dy = (rng.uniform(-1, 1, 2) * 26 * amp).astype(int)
            arr = np.roll(arr, (dy, dx), axis=(0, 1))
            s = int(16 * amp)
            if s:
                arr[..., 0] = np.roll(arr[..., 0], s, axis=1)
                arr[..., 2] = np.roll(arr[..., 2], -s, axis=1)
            if k < 0.1:
                arr = (arr * (1 - (1 - k / 0.1) * 0.85) + 255 * (1 - k / 0.1) * 0.85).astype(np.uint8)
            zoom = 1 + 0.07 * amp
            arr = self.punch(arr, zoom)
        if 0 <= t < 0.25:
            arr = self.punch(arr, 1 + 0.06 * (1 - t / 0.25) ** 2)
        return arr.tobytes()

    @staticmethod
    def punch(arr, zoom):
        if zoom < 1.002:
            return arr
        im = Image.fromarray(arr).resize((int(W * zoom), int(H * zoom)), Image.BILINEAR)
        x, y = (im.width - W) // 2, (im.height - H) // 2
        return np.asarray(im.crop((x, y, x + W, y + H)))

    @staticmethod
    def whip(arr, t):
        """Смаз-переход на долю: кадр уезжает вбок с размытием в движении."""
        for n, c in enumerate((T_C1, T_C2, T_C3, T_ROUL, T_TWIST, T_CTA)):
            dt = t - c
            if -0.12 < dt < 0.12:
                p = dt / 0.12
                sign = 1 if n % 2 else -1
                shift = int(sign * (-p if dt < 0 else 1 - p) * W * 0.25)
                strength = 1 - abs(p)
                acc = np.zeros(arr.shape, np.float32)
                for j in range(8):
                    acc += np.roll(arr, shift + int((j - 4) * 22 * strength), axis=1)
                return (acc / 8).astype(np.uint8)
        return arr


# ---------- звук ----------
def fft_lp(x, cutoff):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, len(x))


def fft_hp(x, cutoff):
    return x - fft_lp(x, cutoff)


def add(buf, at, sig, gain=1.0):
    s = int(at * SR)
    if s >= len(buf) or s < 0:
        return
    e = min(len(buf), s + len(sig))
    buf[s:e] += sig[: e - s] * gain


def n_(sec):
    return np.arange(int(sec * SR)) / SR


def sub808(freq, sec):
    t = n_(sec)
    f = freq * (1 + 1.5 * np.exp(-t * 40))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR)
    return np.tanh(s * 2.2) * np.minimum(1, t / 0.004) * np.exp(-t * 1.6)


def impact(rng):
    t = n_(2.2)
    boom = np.sin(2 * np.pi * np.cumsum(38 + 90 * np.exp(-t * 18)) / SR) * np.exp(-t * 2.2)
    crash = fft_hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 2.8) * 0.35
    return np.tanh(boom * 1.6) + crash


def riser(rng, sec):
    t = n_(sec)
    noise = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    steps = 12                                               # ступенчато поднимаем срез фильтра
    for j in range(steps):
        a, b = len(t) * j // steps, len(t) * (j + 1) // steps
        out[a:b] = fft_hp(noise, 300 + 9000 * (j / steps) ** 2)[a:b]
    tone_ = np.sin(2 * np.pi * np.cumsum(220 + 660 * (t / sec) ** 2) / SR) * 0.15
    return (out * 0.5 + tone_) * (t / sec) ** 2.5


def pluck(freq, sec=0.18):
    t = n_(sec)
    s = (np.sign(np.sin(2 * np.pi * freq * t)) * 0.3 + np.sin(2 * np.pi * freq * t)) * np.exp(-t * 22)
    return s


def soundtrack(path, ticks):
    rng = np.random.default_rng(23)
    n = int(END * SR)
    drums, bass, pad, arp, fx = (np.zeros(n) for _ in range(5))
    chords = [(220.0, True), (174.61, False), (261.63, False), (196.0, False)]   # Am F C G, такт = 2 с
    K, C, Hh, Ho = kick(), clap(rng), hat(rng), hat(rng, True)
    beats = int(END / BEAT)
    duck = np.ones(n)
    for b in range(beats):
        t = b * BEAT
        in_build = T_ROUL <= t < T_DROP
        drop = T_DROP <= t < T_CTA
        outro = t >= T_CTA
        if in_build:
            continue
        kick_on = (b % 4 in (0, 2)) or drop or (outro and b % 4 == 0)
        if kick_on:
            add(drums, t, K, 1.0 if drop else 0.85)
            s = int(t * SR)
            ln = min(int(0.2 * SR), n - s)
            duck[s:s + ln] *= np.linspace(0.35, 1, ln)
        if b % 4 in (1, 3) and not outro:
            add(drums, t, C, 0.55 if drop else 0.45)
        add(drums, t + BEAT / 2, Ho if drop else Hh, 0.3 if drop else 0.22)
        if not outro:
            add(drums, t + BEAT / 4, Hh, 0.12)
            add(drums, t + 3 * BEAT / 4, Hh, 0.12)
        if b % 8 == 7 and not outro and t + BEAT < T_ROUL:              # дробь хэтов в конце каждых двух тактов
            for j in range(6):
                add(drums, t + j * BEAT / 6, Hh, 0.1 + 0.03 * j)
    # сборка: дробь клэпа ускоряется, всё уходит в фильтр, затем тишина
    t = T_ROUL
    while t < T_LAND - 0.02:
        u = (t - T_ROUL) / (T_LAND - T_ROUL)
        step = BEAT / (2 if u < 0.35 else 4 if u < 0.7 else 8)
        add(drums, t, C, 0.15 + 0.45 * u)
        t += step
    for bar in range(int(END / 2) + 1):
        root, minor = chords[bar % 4]
        t0 = bar * 2.0
        third = 1.189 if minor else 1.26
        for mult in (1, third, 1.498, 2):
            s = tone(root * mult, int(2.0 * SR), "saw")
            s = fft_lp(s, 1800) * np.minimum(1, n_(2.0) / 0.25) * np.exp(-n_(2.0) / 2.5)
            add(pad, t0, s, 0.05)
        if t0 < T_ROUL or t0 >= T_DROP:
            for j in range(4 if t0 < T_DROP or t0 >= T_CTA else 8):          # 808 под каждую долю, в дропе — по восьмым
                step = 2.0 / (4 if t0 < T_DROP or t0 >= T_CTA else 8)
                if t0 + j * step < T_CTA or j == 0:
                    add(bass, t0 + j * step, sub808(root / 4, step * 1.6), 0.6)
        if T_C1 <= t0 < T_ROUL or T_DROP <= t0 < T_CTA:
            for j in range(16):
                f = root * [1, third, 1.498, 2.0, 1.498, third][(j * 5) % 6] * 2
                add(arp, t0 + j * 0.125, pluck(f), 0.09 if t0 < T_ROUL else 0.12)
    # фильтр на сборке: пэд и арп темнеют, затем полная тишина перед дропом
    melody = pad + arp
    s0, s1, s2 = int(T_ROUL * SR), int(T_LAND * SR), int(T_DROP * SR)
    dark = fft_lp(melody, 500)
    mix_k = np.zeros(n)
    mix_k[s0:s1] = np.linspace(0.2, 1, s1 - s0)
    melody = melody * (1 - mix_k) + dark * mix_k
    for x in (drums, bass, melody):
        x[s1:s2] = 0
    # эффекты
    add(fx, 0, impact(rng), 0.9)
    add(fx, T_DROP, impact(rng), 1.0)
    add(fx, T_DROP, sub808(36.7, 1.8), 0.9)
    add(fx, T_ROUL, riser(rng, T_LAND - T_ROUL), 0.7)
    for c in (T_C1, T_C2, T_C3, T_ROUL, T_TWIST, T_CTA):
        add(fx, c - 0.22, whoosh(rng, 0.3), 0.5)
    for c in (T_C1, T_C2, T_C3):
        add(fx, c + 1.0, pluck(1760, 0.12), 0.25)                            # щелчок на рамке подсветки
    for x in ticks:
        tk = np.sin(2 * np.pi * 2400 * n_(0.03)) * np.exp(-n_(0.03) * 160)
        add(fx, x, tk, 0.35)
    add(fx, T_LAND, np.sin(2 * np.pi * 1318 * n_(0.4)) * np.exp(-n_(0.4) * 9), 0.3)
    add(fx, T_TWIST + 0.5, np.sin(2 * np.pi * 1568 * n_(0.6)) * np.exp(-n_(0.6) * 7), 0.25)
    music = drums * 0.95 + bass * 0.75 + melody * duck
    fade = np.ones(n)
    fade[-int(1.2 * SR):] = np.linspace(1, 0, int(1.2 * SR))
    mix = np.tanh((music + fx) * 1.25) * fade
    mix = mix / np.max(np.abs(mix)) * 0.9
    width = fft_hp(arp + pad, 800) * 0.05
    stereo = np.stack([mix + width, np.roll(mix, int(0.003 * SR)) - width], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ---------- сборка ----------
_hero = None


def _init(tmp):
    global _hero
    _hero = Hero(tmp)


def _frame(i):
    return _hero.frame(i)


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "guessrank"
    OUT.mkdir(parents=True, exist_ok=True)
    x0, y0, x1, y1 = CROP
    crop = f"crop={x1 - x0}:{y1 - y0}:{x0}:{y0}"
    with tempfile.TemporaryDirectory() as tmp:
        for k, (reel, sec) in STILLS.items():
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(sec), "-i", str(REELS / f"{reel}.mp4"), "-frames:v", "1", "-vf", crop,
                            f"{tmp}/{k}.png"], check=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "1.6", "-t", "8", "-i", str(REELS / "deathlist.mp4"), "-vf", f"{crop},fps=30",
                        f"{tmp}/d%04d.png"], check=True)
        probe = Hero(tmp)
        wav = Path(tmp) / "a.wav"
        soundtrack(wav, probe.tick_times)
        enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                                "-i", str(wav), "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-profile:v", "high",
                                "-movflags", "+faststart", "-c:a", "aac", "-b:a", "256k", "-shortest", str(OUT / f"{name}.mp4")], stdin=subprocess.PIPE)
        with ProcessPoolExecutor(initializer=_init, initargs=(tmp,)) as pool:
            for buf in pool.map(_frame, range(int(END * FPS)), chunksize=8):
                enc.stdin.write(buf)
        enc.stdin.close()
        if enc.wait():
            raise RuntimeError("ffmpeg упал")
    print("готово", OUT / f"{name}.mp4")


if __name__ == "__main__":
    main()
