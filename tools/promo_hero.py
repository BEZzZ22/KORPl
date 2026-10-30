"""Shorts в монтаже «как у топов»: у каждого ролика свой формат и тема, но одна система.
Всё собрано по сетке своего трека (120 BPM): хук с первого кадра, сцены меняются на долю смаз-переходом, камера наезжает
на нужную строку экрана бота и подсвечивает её рамкой, перед развязкой нарастание и секунда тишины, на дропе удар со
вспышкой и тряской, затем твист и финал с ботом. Без эмодзи и стикеров, только типографика и векторная графика.
Ролики (VIDEOS): guessrank (угадай ранг), versus (ты против про), killers (топ тех, кто убивал), myth (миф или правда),
phases (оценка каждой фазы), wards (найди вард на половине врага), lanexp (крипы в плюс, опыт в минус),
zero3 (0 из 3 главных предметов), ganked (ганкали одного), manta (Manta, которой не было), fightquiz (где умирал в драках).
Все цифры — с настоящих экранов разбора: кадры берутся из рилсов promo/reels/<id>.mp4 (tools/promo_reels.py).
Матчи: Undying (саппорт, поражение, ранг Страж) и Drow Ranger (керри, ранг Страж).
Запуск: python tools/promo_hero.py [имя ...]  ->  promo/shorts/<имя>.mp4"""
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
from promo_sound import SR, clap, hat, kick, tone, whoosh  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REELS, OUT, BRAND = ROOT / "promo" / "reels", ROOT / "promo" / "shorts", ROOT / "promo" / "brand"
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-{}.otf"
W, H, FPS = 1080, 1920, 30
CROP = (92, 602, 988, 1458)                 # окно со скриншотом в исходном рилсе, кадр 896x856
WHITE, MUTED, INK = (246, 244, 240), (150, 150, 160), (7, 8, 11)
GOLD, RED, GREEN, BLUE = (255, 196, 64), (240, 78, 64), (52, 199, 120), (120, 180, 255)
YOU = (255, 110, 100)
BEAT = 0.5                                  # 120 BPM: все времена ниже кратны доле
SLOW = 1.6                                  # сценарии пишутся в «быстром» времени, ролик растягивается: 120 -> 75 BPM, ~37 с.
                                            # На 1.0 Ярик не успевал читать. Тряска, вспышка и смаз в спокойном режиме мягче.


# ---------- базовые инструменты ----------
def shift(a, dx, dy=0, fill=None):
    """Сдвиг кадра без заворота: уехавшее за край пропадает (np.roll выносил текст на другую сторону).
    Освободившийся край тянется (для мелкой тряски) или заливается цветом fill (для смаз-перехода)."""
    if not dx and not dy:
        return a
    h, w = a.shape[:2]
    pad = [(abs(dy), abs(dy)), (abs(dx), abs(dx))] + [(0, 0)] * (a.ndim - 2)
    p = np.pad(a, pad, mode="edge") if fill is None else np.pad(a, pad, constant_values=fill)
    return p[abs(dy) - dy:abs(dy) - dy + h, abs(dx) - dx:abs(dx) - dx + w]


def clamp01(x):
    return max(0.0, min(1.0, x))


def ease(t):
    t = clamp01(t)
    return t * t * (3 - 2 * t)


def expo(t):
    t = clamp01(t)
    return 1 - 2 ** (-10 * t) if t < 1 else 1.0


def lerp(a, b, k):
    return tuple(x + (y - x) * k for x, y in zip(a, b))


def fmt_num(n, sign=False):
    s = f"{abs(int(round(n))):,}".replace(",", " ")
    return ("−" if n < 0 else "+" if sign and n > 0 else "") + s


def fmt_time(sec):
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


_fonts = {}


def font(weight, size):
    if (weight, size) not in _fonts:
        _fonts[(weight, size)] = ImageFont.truetype(FONT.format(weight), size)
    return _fonts[(weight, size)]


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


def line_layer(text, weight, size, color, shadow=True):
    fnt = font(weight, size)
    d = ImageDraw.Draw(Image.new("L", (1, 1)))
    w, h = int(d.textlength(text, font=fnt)) + 40, int(size * 1.3) + 20
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((20, 10), text, font=fnt, fill=color)
    if not shadow:
        return layer
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh.putalpha(layer.getchannel("A").filter(ImageFilter.GaussianBlur(size / 10)).point(lambda v: int(v * 0.7)))
    out.alpha_composite(sh, (0, int(size / 18)))
    out.alpha_composite(layer)
    return out


def glow_layer(layer, color, radius=40, k=0.6):
    g = Image.new("RGBA", layer.size, color + (0,))
    g.putalpha(layer.getchannel("A").filter(ImageFilter.GaussianBlur(radius)).point(lambda v: int(v * k)))
    return g


def put(img, layer, cx, cy, k=1.0, alpha=1.0, blur=0.0):
    if layer is None or k <= 0.02 or alpha <= 0.01:
        return
    if abs(k - 1) > 0.005:
        layer = layer.resize((max(1, int(layer.width * k)), max(1, int(layer.height * k))), Image.BILINEAR)
    if blur > 0.5:
        layer = layer.filter(ImageFilter.GaussianBlur(blur))
    if alpha < 0.99:
        layer = layer.copy()
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * alpha)))
    img.alpha_composite(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)))


def panel(w, h, fill=(255, 255, 255, 16), outline=(255, 255, 255, 60), radius=34, width=2):
    p = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(p).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=fill, outline=outline, width=width)
    return p


class Headline:
    """Многострочный заголовок: строки выезжают из-под маски по очереди."""

    def __init__(self, text, weight, size, color, width=W - 150, lead=1.08):
        self.lines = [line_layer(x, weight, size, color) for x in wrap(text, font(weight, size), width)]
        self.step = int(size * lead)
        self.height = self.step * len(self.lines)

    def draw(self, img, x, cy, t, stagger=0.08, dur=0.5, alpha=1.0):
        y0 = cy - self.height / 2
        for i, ln in enumerate(self.lines):
            k = expo((t - i * stagger) / dur)
            off = int((1 - k) * ln.height)
            if k <= 0 or off >= ln.height:
                continue
            piece = ln.crop((0, 0, ln.width, ln.height - off))
            if alpha < 0.99:
                piece.putalpha(piece.getchannel("A").point(lambda v: int(v * alpha)))
            img.alpha_composite(piece, (int(x - ln.width / 2), int(y0 + i * self.step + off)))


class Caption:
    """Субтитры по словам: слово поднимается и проявляется, текущее подсвечено акцентом."""

    def __init__(self, text, size, accent, width=W - 160, per_word=0.18):
        self.fnt = font("Black", size)
        self.accent, self.per_word = accent, per_word
        d = ImageDraw.Draw(Image.new("L", (1, 1)))
        self.words, x, y, rows = [], 0, 0, [[]]
        space = d.textlength(" ", font=self.fnt)
        for wd in text.split():
            wl = d.textlength(wd, font=self.fnt)
            if x + wl > width and x > 0:
                x, y = 0, y + int(size * 1.15)
                rows.append([])
            rows[-1].append(len(self.words))
            self.words.append([wd, x, y, wl])
            x += wl + space
        for row in rows:
            rw = self.words[row[-1]][1] + self.words[row[-1]][3]
            for i in row:
                self.words[i][1] += (width - rw) / 2
        self.width, self.height = width, y + int(size * 1.3)
        self.duration = len(self.words) * per_word

    def draw(self, img, cy, t):
        if t <= 0:
            return
        layer = Image.new("RGBA", (self.width + 40, self.height + 30), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        cur = min(int(t / self.per_word), len(self.words) - 1)
        for i, (wd, x, y, _) in enumerate(self.words):
            k = expo((t - i * self.per_word) / 0.25)
            if k <= 0:
                break
            col = self.accent if i == cur and t < self.duration + 0.4 else WHITE
            d.text((20 + x, 10 + y + (1 - k) * 18), wd, font=self.fnt, fill=col + (int(255 * k),))
        sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        sh.putalpha(layer.getchannel("A").filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(v * 0.85)))
        x0, y0 = int((W - layer.width) / 2), int(cy - layer.height / 2)
        img.alpha_composite(sh, (x0, y0 + 4))
        img.alpha_composite(layer, (x0, y0))


def label(text, accent, size=34):
    """Плашка-метка: капс с разрядкой в тонкой рамке."""
    fnt = font("Bold", size)
    spaced = " ".join(text.upper())
    d = ImageDraw.Draw(Image.new("L", (1, 1)))
    w, h = int(d.textlength(spaced, font=fnt)) + 56, int(size * 1.9)
    layer = Image.new("RGBA", (w + 4, h + 4), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer)
    dl.rounded_rectangle((2, 2, w + 1, h + 1), radius=h // 2, fill=accent + (40,), outline=accent + (255,), width=2)
    dl.text((30, (h - size * 1.2) / 2), spaced, font=fnt, fill=accent + (255,))
    return layer


def stamp(text, color, size=150):
    """Печать-вердикт: жирный капс в рамке, повёрнутый на несколько градусов."""
    fnt = font("Black", size)
    d = ImageDraw.Draw(Image.new("L", (1, 1)))
    w, h = int(d.textlength(text, font=fnt)) + 90, int(size * 1.45)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer)
    dl.rounded_rectangle((6, 6, w - 7, h - 7), radius=26, fill=color + (36,), outline=color + (255,), width=12)
    dl.text((w / 2, h / 2), text, font=fnt, fill=color + (255,), anchor="mm")
    layer = layer.rotate(-7, resample=Image.BICUBIC, expand=True)
    out = glow_layer(layer, color, 30, 0.5)
    out.alpha_composite(layer)
    return out


def ring(size, frac, color, width=10):
    s = size * 2
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.arc((width, width, s - width, s - width), 0, 360, fill=(255, 255, 255, 40), width=width * 2)
    if frac > 0:
        d.arc((width, width, s - width, s - width), -90, -90 + 360 * frac, fill=color + (255,), width=width * 2)
    return im.resize((size, size), Image.LANCZOS)


def accel_ticks(t0, t1, first=0.25, last=0.055):
    """Тики с ускорением: интервал сжимается от first до last."""
    out, t = [], t0
    while t < t1 - 0.02:
        out.append(t)
        u = (t - t0) / (t1 - t0)
        t += first * (1 - u) + last * u
    return out


# ---------- общий монтаж ----------
class Cut:
    name = ""
    stills = {}                 # ключ -> (рилс, секунда)
    portraits = {}              # ключ -> (кадр, (x0, y0, x1, y1))
    scroll = None               # (рилс, с, длительность) — листающийся фон в хуке
    glow = [(110, 22, 16), (90, 60, 14), (60, 14, 20)]
    accent = GOLD
    chords = 0
    seed = 1
    end, build, drop, twist, cta = 23.0, 11.0, 14.0, 16.5, 19.5
    land = 13.75                # с этого момента тишина до дропа
    cta_text = ("Кинь Match ID боту", "и узнай, что сливает твои катки")

    def __init__(self, tmp):
        tmp = Path(tmp)
        self.img = {k: Image.open(tmp / f"{k}.png").convert("RGB") for k in self.stills}
        self.scroll_frames = sorted(tmp.glob("scroll*.png"))
        self.faces = {}
        for k, (src, box) in self.portraits.items():
            p = self.img[src].crop(box).resize((220, int(220 * (box[3] - box[1]) / (box[2] - box[0]))), Image.LANCZOS).convert("RGBA")
            side = min(p.size)
            p = p.crop(((p.width - side) // 2, (p.height - side) // 2, (p.width + side) // 2, (p.height + side) // 2))
            m = Image.new("L", p.size, 0)
            ImageDraw.Draw(m).rounded_rectangle((0, 0, side - 1, side - 1), radius=side // 5, fill=255)
            p.putalpha(m)
            self.faces[k] = p
        rng = np.random.default_rng(self.seed)
        field = Image.new("RGB", (W + 400, H + 400), INK)
        d = ImageDraw.Draw(field)
        for (cx, cy, r), col in zip(((300, 500, 560), (W, H * 0.7, 620), (W * 0.6, 200, 420)), self.glow):
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
            self.grain.append(Image.fromarray(np.dstack([col, col, col, a]), "RGBA").resize((W, H), Image.NEAREST))
        em = Image.open(BRAND / "avatar.png").convert("RGBA").resize((220, 220), Image.LANCZOS)
        m = Image.new("L", em.size, 0)
        ImageDraw.Draw(m).ellipse((0, 0, 219, 219), fill=255)
        em.putalpha(m)
        self.emblem = em
        self.shadow = {}
        self.cuts = []          # смаз-переходы
        self.hits = []          # (время, сила): удар, тряска, наезд
        self.ticks = []
        self.clicks = []
        self.cta_head = Headline(self.cta_text[0], "Black", 100, WHITE)
        self.cta_sub = Headline(self.cta_text[1], "SemiBold", 50, (210, 206, 200))
        self.setup()
        self.cuts += [self.twist, self.cta]

    # --- кадр экрана карточкой: наезд на зону, затемнение вокруг, рамка ---
    def shot(self, key, zoom, roi, spot=0.0, box=None, box_k=0.0, width=900, bump=1.0, color=None):
        src = self.img[key]
        iw, ih = src.size
        asp = iw / ih
        x0, y0, x1, y1 = roi
        ww = min(max((x1 - x0) * 1.12, (y1 - y0) * 1.12 * asp, iw * 0.62), iw)
        wh = ww / asp
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        cx, cy = min(max(cx, ww / 2), iw - ww / 2), min(max(cy, wh / 2), ih - wh / 2)
        win = lerp((0, 0, iw, ih), (cx - ww / 2, cy - wh / 2, cx + ww / 2, cy + wh / 2), ease(zoom))
        hgt = int(width / asp)
        piece = src.transform((width, hgt), Image.EXTENT, win, Image.BICUBIC).convert("RGBA")
        sx, sy = width / (win[2] - win[0]), hgt / (win[3] - win[1])
        boxes = box if box and isinstance(box[0], (tuple, list)) else ([box] if box else [])
        if boxes and spot > 0:
            dim = Image.new("L", piece.size, int(170 * spot))
            for b in boxes:
                ImageDraw.Draw(dim).rounded_rectangle(((b[0] - win[0]) * sx - 14, (b[1] - win[1]) * sy - 12,
                                                       (b[2] - win[0]) * sx + 14, (b[3] - win[1]) * sy + 12), radius=22, fill=0)
            shade = Image.new("RGBA", piece.size, (0, 0, 0, 255))
            shade.putalpha(dim)
            piece.alpha_composite(shade)
        if boxes and box_k > 0:
            col = color or self.accent
            g = 1 + 0.12 * (1 - expo(box_k / 0.6))            # рамка «защёлкивается» снаружи внутрь
            ov = Image.new("RGBA", piece.size, (0, 0, 0, 0))
            for b in boxes:
                bx0, by0 = (b[0] - win[0]) * sx - 14, (b[1] - win[1]) * sy - 12
                bx1, by1 = (b[2] - win[0]) * sx + 14, (b[3] - win[1]) * sy + 12
                mx, my, hw, hh = (bx0 + bx1) / 2, (by0 + by1) / 2, (bx1 - bx0) / 2 * g, (by1 - by0) / 2 * g
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

    def proof(self, img, t, t0, key, roi, box, cy=1110, width=900, color=None, zoom=1.0, rise=True):
        """Стандартный выход доказательства: карточка въезжает, через полсекунды наезд, затемнение и рамка."""
        k = t - t0
        if k < 0:
            return
        z = zoom * expo((k - 0.45) / 0.7)
        c = self.shot(key, z, roi, spot=clamp01((k - 0.8) / 0.3), box=box, box_k=max(0, k - 0.9), width=width,
                      bump=self.pulse(t, t0), color=color)
        e = expo(k / 0.5) if rise else 1
        put(img, c, W / 2, cy + (1 - e) * 140, 0.94 + 0.06 * e, alpha=clamp01(k / 0.12))

    @staticmethod
    def pulse(t, t0):
        if t < t0:
            return 1.0
        return 1 + 0.018 / SLOW * math.exp(-((t - t0) % BEAT) / BEAT * 9)

    def background(self, t):
        ox, oy = 200 + 150 * math.sin(t * 0.3 + self.seed), 200 + 160 * math.cos(t * 0.23)
        return self.field.crop((int(ox), int(oy), int(ox) + W, int(oy) + H)).convert("RGBA")

    def scroll_bg(self, img, t, dur=2.0, alpha=70):
        if not self.scroll_frames:
            return
        i = min(len(self.scroll_frames) - 1, int(t / dur * len(self.scroll_frames)))
        fr = Image.open(self.scroll_frames[i]).convert("RGB")
        s = H / fr.height
        fr = fr.resize((int(fr.width * s / 2), H // 2), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2.5)).resize((int(fr.width * s), H))
        x = (fr.width - W) // 2
        fr = fr.crop((x, 0, x + W, H)).convert("RGBA")
        fr.putalpha(alpha)
        img.alpha_composite(fr)

    def odometer(self, value, k, fmt=fmt_num):
        return fmt(value * ease(k) if k < 1 else value)

    def cta_scene(self, img, t):
        k = t - self.cta
        e = expo(k / 0.6)
        put(img, self.emblem, W / 2, 600 + (1 - e) * 60, 0.8 + 0.2 * e, alpha=clamp01(k / 0.2))
        self.cta_head.draw(img, W / 2, 860, k - 0.15)
        sub_y = 860 + self.cta_head.height / 2 + 70
        self.cta_sub.draw(img, W / 2, sub_y, k - 0.4)
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
        py = sub_y + self.cta_sub.height / 2 + 120
        put(img, pill, W / 2, py + (1 - e2) * 50, alpha=clamp01((k - 0.6) / 0.15))
        put(img, line_layer("ссылка в описании", "SemiBold", 40, MUTED), W / 2, py + 120, alpha=clamp01((k - 1.0) / 0.3))

    def frame(self, i):
        t = i / FPS / SLOW
        img = self.background(t)
        if t < self.cta:
            self.scene(img, t)
        else:
            self.cta_scene(img, t)
        img.alpha_composite(self.vignette)
        img.alpha_composite(self.grain[i % len(self.grain)])
        arr = np.asarray(img.convert("RGB")).copy()
        arr = self.whip(arr, i / FPS)
        calm = 1 / SLOW
        for at, power in self.hits + [(self.drop, 1.0), (0.0, 0.6)]:
            k = i / FPS - at * SLOW
            if not 0 <= k < 0.5 * power:
                continue
            amp = (1 - k / (0.5 * power)) ** 2 * power * calm ** 2
            rng = np.random.default_rng(i)
            dx, dy = (rng.uniform(-1, 1, 2) * 26 * amp).astype(int)
            arr = shift(arr, dx, dy)
            s = int(16 * amp)
            if s:
                arr[..., 0] = shift(arr[..., 0], s)
                arr[..., 2] = shift(arr[..., 2], -s)
            if at == self.drop and k < 0.1:
                fl = (1 - k / 0.1) * 0.85 * calm
                arr = (arr * (1 - fl) + 255 * fl).astype(np.uint8)
            arr = self.punch(arr, 1 + 0.07 * amp)
        return arr.tobytes()

    @staticmethod
    def punch(arr, zoom):
        if zoom < 1.002:
            return arr
        im = Image.fromarray(arr).resize((int(W * zoom), int(H * zoom)), Image.BILINEAR)
        x, y = (im.width - W) // 2, (im.height - H) // 2
        return np.asarray(im.crop((x, y, x + W, y + H)))

    def whip(self, arr, t):
        for n, c in enumerate(self.cuts):
            dt = t - c * SLOW
            if -0.12 < dt < 0.12:
                p = dt / 0.12
                off = int((1 if n % 2 else -1) * (-p if dt < 0 else 1 - p) * W * 0.25 / SLOW)
                strength = 1 - abs(p)
                acc = np.zeros(arr.shape, np.float32)
                for j in range(8):
                    acc += shift(arr, off + int((j - 4) * 22 * strength), fill=INK[0])
                return (acc / 8).astype(np.uint8)
        return arr


# ---------- 1. Угадай ранг ----------
class GuessRank(Cut):
    name = "guessrank"
    stills = {"am": ("deathlist", 10), "respawn": ("deathlist", 2), "glimmer": ("missing", 4.2), "xpm": ("missing", 8.2)}
    scroll = ("deathlist", 1.6, 8)
    RANKS = ["Рекрут", "Страж", "Рыцарь", "Герой", "Легенда", "Властелин", "Божество", "Титан"]
    CLUES = [(2.0, "am", "10 смертей от одного Anti-Mage", (20, 600, 880, 856), (20, 712, 876, 856)),
             (5.0, "respawn", "5 раз умер сразу после возрождения", (60, 380, 840, 720), (300, 546, 708, 610)),
             (8.0, "glimmer", "Glimmer Cape так и не собрал", (40, 100, 860, 460), (64, 126, 624, 190))]
    ROI_RANK, ROI_XPM = (390, 698, 656, 752), (28, 624, 872, 786)

    def setup(self):
        self.spin_n = 3 * len(self.RANKS) + 1
        self.big17 = line_layer("17", "Black", 560, WHITE)
        self.sub17 = Headline("смертей за одну катку", "SemiBold", 58, (220, 214, 206))
        self.guess = Headline("Угадай ранг", "Black", 128, GOLD)
        self.guess2 = Headline("по трём уликам", "SemiBold", 54, MUTED)
        self.tags = [label(f"Улика {i + 1} из 3", GOLD) for i in range(3)]
        self.heads = [Headline(c[2], "Black", 80, WHITE) for c in self.CLUES]
        self.roul_head = Headline("Какой это ранг?", "Black", 100, WHITE)
        self.roul_sub = Headline("пиши версию в комменты", "SemiBold", 50, MUTED)
        self.rank_layers = {r: line_layer(r, "Black", 132, WHITE) for r in self.RANKS}
        self.answer_tag = label("Ответ", GOLD)
        self.answer = line_layer("СТРАЖ", "Black", 250, GOLD)
        self.answer_glow = glow_layer(self.answer, GOLD)
        self.twist_head = Headline("Зато по опыту в минуту обходит 76% саппортов на Страже", "Black", 70, WHITE)
        self.twist_cap = Caption("Сливает не фарм, а смерти", 64, GOLD, per_word=0.22)
        self.cuts = [2.0, 5.0, 8.0, self.build]
        last = 0
        for i in range(int((self.land - self.build) * 600)):
            t = self.build + i / 600
            p = round(self.spin(t))
            if p != last:
                self.ticks.append(t)
                last = p
        self.clicks = [c[0] + 1.0 for c in self.CLUES]

    def spin(self, t):
        u = clamp01((t - self.build) / (self.land - self.build))
        return self.spin_n * (1 - (1 - u) ** 3.2)

    def scene(self, img, t):
        if t < 2.0:
            self.scroll_bg(img, t)
            put(img, self.big17, W / 2, 760, 1.14 - 0.14 * expo(t / 0.35))
            self.sub17.draw(img, W / 2, 1060, t * 1.6 + 0.3)
            self.guess.draw(img, W / 2, 1270, t - 0.75, dur=0.45)
            self.guess2.draw(img, W / 2, 1400, t - 1.15)
        elif t < self.build:
            i = 0 if t < 5 else 1 if t < 8 else 2
            t0, key, _, roi, box = self.CLUES[i]
            put(img, self.tags[i], W / 2, 330, alpha=clamp01((t - t0) / 0.15))
            self.heads[i].draw(img, W / 2, 500, t - t0 - 0.05)
            self.proof(img, t, t0, key, roi, box, cy=1110, width=940)
        elif t < self.drop:
            k = t - self.build
            self.roul_head.draw(img, W / 2, 400, k)
            self.roul_sub.draw(img, W / 2, 530, k - 0.25)
            p = self.spin(t)
            base, f = math.floor(p), p - math.floor(p)
            cy, landed = 1060, t >= self.land
            put(img, panel(W - 220, 210, outline=(GOLD + (255,)) if landed else (255, 255, 255, 70), width=3), W / 2, cy)
            blur = min(6, abs(self.spin(t + 0.02) - p) * 6)
            for j in range(-2, 3):
                off = j - f
                if abs(off) <= 1.9:
                    name = self.RANKS[(base + j) % len(self.RANKS)]
                    put(img, self.rank_layers[name], W / 2, cy + off * 175, max(0.45, 1 - abs(off) * 0.28), alpha=max(0, 1 - abs(off) * 0.5), blur=blur)
            put(img, ring(150, clamp01(k / (self.land - self.build)), GOLD), W / 2, 1480)
            put(img, line_layer(str(max(1, math.ceil(self.land - t))), "Black", 64, WHITE, shadow=False), W / 2, 1478)
        elif t < self.twist:
            k = t - self.drop
            sc = 1.2 - 0.2 * expo(k / 0.28)
            put(img, self.answer_tag, W / 2, 300, alpha=clamp01((k - 0.2) / 0.2))
            put(img, self.answer_glow, W / 2, 520, sc, alpha=0.6 + 0.4 * math.sin(k * 5) ** 2)
            put(img, self.answer, W / 2, 520, sc)
            self.proof(img, t, self.drop + 0.15, "xpm", self.ROI_XPM, self.ROI_RANK, cy=1180, zoom=0.65)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 470, k)
            c = self.shot("xpm", 0.65, self.ROI_XPM, spot=1, box=self.ROI_XPM, box_k=max(0, k - 0.5), width=860,
                          bump=self.pulse(t, self.twist), color=GREEN)
            put(img, c, W / 2, 1040)
            self.twist_cap.draw(img, 1580, k - 1.2)


# ---------- 2. Ты против про ----------
class Versus(Cut):
    name = "versus"
    stills = {"treads": ("early", 1.5), "late": ("early", 7.5), "greedy": ("review", 1.5), "missing": ("early", 4.5)}
    glow = [(110, 26, 22), (20, 50, 110), (60, 30, 70)]
    chords, seed = 1, 5
    cta_text = ("Сравни свои тайминги с про", "кинь Match ID боту")
    ROUNDS = [(2.0, "Power Treads", 451, 389, "treads", (60, 90, 840, 310), (60, 110, 830, 300)),
              (5.0, "Butterfly", 1603, 2020, "late", (60, 560, 840, 730), (60, 600, 840, 712)),
              (8.0, "Black King Bar", 2515, 1815, "late", (60, 300, 840, 450), (60, 318, 840, 428))]

    def setup(self):
        self.you, self.pro = line_layer("ТЫ", "Black", 230, YOU), line_layer("ПРО", "Black", 230, BLUE)
        self.vs = line_layer("vs", "Black", 110, WHITE)
        self.hook_sub = Headline("Drow Ranger на Страже. Сравнил тайминги предметов", "SemiBold", 54, (220, 214, 206))
        self.tags = [label(f"Раунд {i + 1}", GOLD) for i in range(3)]
        self.items = [Headline(r[1], "Black", 96, WHITE) for r in self.ROUNDS]
        self.build_head = Headline("Что бот сказал про этот билд?", "Black", 88, WHITE)
        self.verdict1 = line_layer("ЖАДНЫЙ ПРЕДМЕТ", "Black", 92, GOLD)
        self.verdict2 = line_layer("раньше защиты", "Black", 96, WHITE)
        self.twist_head = Headline("И ещё 6 предметов из сборки про так и не собрал", "Black", 72, WHITE)
        self.cuts = [r[0] for r in self.ROUNDS] + [self.build]
        self.hits = [(r[0] + 1.5, 0.45) for r in self.ROUNDS]
        self.ticks = accel_ticks(self.build + 0.5, self.land)
        self.clicks = [r[0] + 0.3 for r in self.ROUNDS]

    def scene(self, img, t):
        if t < 2.0:
            e = expo(t / 0.4)
            put(img, self.you, W / 2 - 180 - (1 - e) * 400, 560, 1.1 - 0.1 * e)
            put(img, self.vs, W / 2, 760, 1.6 - 0.6 * expo((t - 0.3) / 0.3), alpha=clamp01((t - 0.3) / 0.1))
            put(img, self.pro, W / 2 + 120 + (1 - e) * 400, 960, 1.1 - 0.1 * e)
            self.hook_sub.draw(img, W / 2, 1220, t - 0.6)
        elif t < self.build:
            i = 0 if t < 5 else 1 if t < 8 else 2
            t0, item, you, pro, key, roi, box = self.ROUNDS[i]
            k = t - t0
            put(img, self.tags[i], W / 2, 290, alpha=clamp01(k / 0.15))
            self.items[i].draw(img, W / 2, 420, k - 0.05)
            cnt = clamp01((k - 0.3) / 1.1)
            for x, who, val, col in ((W / 4 + 20, "ТЫ", you, YOU), (3 * W / 4 - 20, "ПРО", pro, BLUE)):
                win = (val < (pro if who == "ТЫ" else you))
                lit = k > 1.5
                put(img, panel(440, 260, fill=col + (60 if lit and win else 18,), outline=col + (255 if lit and win else 80,), width=4 if lit and win else 2),
                    x, 690, 1 + (0.05 * (1 - expo((k - 1.5) / 0.3)) if lit and win else 0))
                put(img, line_layer(who, "Bold", 40, col), x, 600)
                put(img, line_layer(fmt_time(val * ease(cnt)), "Black", 120, WHITE if not lit or win else MUTED), x, 715)
            if k > 1.5:
                d = abs(you - pro)
                txt = f"про быстрее на {fmt_time(d)}" if pro < you else f"ты раньше про на {fmt_time(d)}"
                put(img, line_layer(txt, "Black", 54, BLUE if pro < you else YOU), W / 2, 880, alpha=clamp01((k - 1.5) / 0.2),
                    k=1.15 - 0.15 * expo((k - 1.5) / 0.3))
            self.proof(img, t, t0 + 0.6, key, roi, box, cy=1300, width=820)
        elif t < self.drop:
            k = t - self.build
            self.build_head.draw(img, W / 2, 700, k)
            bar = panel(760, 26, fill=(255, 255, 255, 25), outline=(0, 0, 0, 0), radius=13)
            fill_w = int(760 * ease(k / (self.land - self.build)))
            if fill_w > 26:
                ImageDraw.Draw(bar).rounded_rectangle((0, 0, fill_w - 1, 25), radius=13, fill=GOLD + (255,))
            put(img, bar, W / 2, 980)
            put(img, line_layer("анализирую…", "SemiBold", 44, MUTED), W / 2, 1060, alpha=0.5 + 0.5 * math.sin(k * 8) ** 2)
        elif t < self.twist:
            k = t - self.drop
            sc = 1.3 - 0.3 * expo(k / 0.28)
            put(img, glow_layer(self.verdict1, GOLD), W / 2, 330, sc, alpha=0.7)
            put(img, self.verdict1, W / 2, 330, sc)
            put(img, self.verdict2, W / 2, 470, alpha=clamp01((k - 0.25) / 0.15), k=1.2 - 0.2 * expo((k - 0.25) / 0.3))
            self.proof(img, t, self.drop + 0.3, "greedy", (40, 110, 860, 360), (180, 160, 815, 215), cy=1100, width=880)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 420, k)
            self.proof(img, t, self.twist + 0.1, "missing", (50, 40, 860, 720), [(660, 70, 830, 125), (660, 360, 830, 410), (660, 600, 830, 650)],
                       cy=1080, width=860, color=RED, zoom=0.3)


# ---------- 3. Кто убивал больше всех ----------
class Killers(Cut):
    name = "killers"
    stills = {"viper": ("killers", 1.5), "hood": ("deathmap", 2.5), "slark": ("deathmap", 9.6), "am": ("deathlist", 11)}
    portraits = {"viper": ("viper", (81, 151, 249, 246)), "hood": ("hood", (80, 194, 249, 287)), "slark": ("slark", (64, 221, 240, 319)),
                 "am": ("am", (65, 682, 241, 778))}
    scroll = ("deathlist", 1.6, 8)
    glow = [(110, 18, 14), (70, 20, 20), (40, 14, 30)]
    chords, seed = 2, 9
    cta_text = ("Узнай, кто убивает тебя чаще всех", "кинь Match ID боту")
    ROWS = [(2.0, "slark", "Slark", 2050, 2), (5.0, "hood", "Hoodwink", 5089, 2), (8.0, "viper", "Viper", 5833, 2)]
    TOP = 23579

    def setup(self):
        self.hook_head = Headline("Кто убил меня больше всех?", "Black", 108, WHITE)
        self.hook_sub = Headline("топ за одну катку Undying", "SemiBold", 54, MUTED)
        self.am_name = line_layer("ANTI-MAGE", "Black", 150, RED)
        self.twist_head = Headline("Это почти вдвое больше, чем у остальных троих вместе", "Black", 70, WHITE)
        self.cuts = [2.0, self.build]
        self.hits = [(r[0], 0.35) for r in self.ROWS[1:]]
        self.ticks = accel_ticks(self.build, self.land)
        self.clicks = [r[0] for r in self.ROWS]

    def row(self, img, y, rank, face, name, dmg, deaths, k, hl, col=WHITE, bar_col=(255, 255, 255)):
        e = expo(k / 0.45)
        layer = Image.new("RGBA", (W - 100, 170), (0, 0, 0, 0))
        layer.alpha_composite(panel(W - 100, 170, fill=(255, 255, 255, 30 if hl else 14), outline=(255, 255, 255, 90 if hl else 30)))
        d = ImageDraw.Draw(layer)
        d.text((40, 85), f"#{rank}", font=font("Black", 64), fill=MUTED, anchor="lm")
        if face is not None:
            layer.alpha_composite(face.resize((120, 120), Image.LANCZOS), (150, 25))
        d.text((300, 62), name, font=font("Black", 54), fill=col, anchor="lm")
        d.text((W - 140, 62), fmt_num(dmg * ease(clamp01(k / 0.9))), font=font("Black", 54), fill=col, anchor="rm")
        bw = int((W - 440) * dmg / self.TOP * ease(clamp01(k / 0.9)))
        d.rounded_rectangle((300, 110, W - 140, 128), radius=9, fill=(255, 255, 255, 25))
        if bw > 18:
            d.rounded_rectangle((300, 110, 300 + bw, 128), radius=9, fill=bar_col + (255,))
        if deaths:
            d.text((W - 140, 150), f"{deaths} смерти", font=font("SemiBold", 28), fill=MUTED + (255,), anchor="rm")
        put(img, layer, W / 2 + (1 - e) * 200, y, 1 + (0.04 * (1 - expo((k - 0.2) / 0.4)) if hl else 0), alpha=e)

    def scene(self, img, t):
        if t < 2.0:
            self.scroll_bg(img, t)
            self.hook_head.draw(img, W / 2, 820, t * 1.3)
            self.hook_sub.draw(img, W / 2, 1080, t - 0.6)
        elif t < self.drop:
            put(img, label("Кто убивал", self.accent), W / 2, 330)
            slots = {0: 1300, 1: 1100, 2: 900}
            for i, (t0, face, name, dmg, deaths) in enumerate(self.ROWS):
                if t >= t0:
                    self.row(img, slots[i], 4 - i, self.faces[face], name, dmg, deaths, t - t0, hl=(t0 <= t < t0 + 3 and t < self.build))
            if t >= self.build:
                k = (t - self.build) / (self.land - self.build)
                dmg = self.TOP * clamp01(k) ** 2.2
                self.mystery(img, dmg, k)
        elif t < self.twist:
            k = t - self.drop
            put(img, glow_layer(self.faces["am"].resize((300, 300)), RED, 40, 0.8), W / 2, 470, 1.3 - 0.3 * expo(k / 0.3))
            put(img, self.faces["am"].resize((300, 300)), W / 2, 470, 1.3 - 0.3 * expo(k / 0.3))
            put(img, self.am_name, W / 2, 720, 1.3 - 0.3 * expo(k / 0.28))
            put(img, line_layer("23 579 урона · 10 смертей", "Black", 60, WHITE), W / 2, 850, alpha=clamp01((k - 0.3) / 0.2))
            self.proof(img, t, self.drop + 0.4, "am", (20, 380, 880, 856), (40, 655, 876, 800), cy=1320, width=820, color=RED)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 460, k)
            others = sum(r[3] for r in self.ROWS)
            for y, name, val, col in ((800, "Anti-Mage", self.TOP, RED), (1060, "Viper + Hoodwink + Slark", others, MUTED)):
                kk = clamp01((k - 0.4) / 1.0)
                put(img, line_layer(name, "Bold", 46, WHITE), 80 + line_layer(name, "Bold", 46, WHITE).width / 2, y - 70, alpha=clamp01(k / 0.3))
                bar = Image.new("RGBA", (W - 160, 70), (0, 0, 0, 0))
                bw = int((W - 160) * val / self.TOP * ease(kk))
                ImageDraw.Draw(bar).rounded_rectangle((0, 0, W - 161, 69), radius=20, fill=(255, 255, 255, 18))
                if bw > 40:
                    ImageDraw.Draw(bar).rounded_rectangle((0, 0, bw, 69), radius=20, fill=col + (255,))
                put(img, bar, W / 2, y)
                put(img, line_layer(fmt_num(val * ease(kk)), "Black", 56, WHITE), W / 2, y + 90, alpha=clamp01(k / 0.3))

    def mystery(self, img, dmg, k):
        layer = Image.new("RGBA", (W - 100, 210), (0, 0, 0, 0))
        layer.alpha_composite(panel(W - 100, 210, fill=RED + (40,), outline=RED + (255,), width=3))
        d = ImageDraw.Draw(layer)
        d.text((40, 105), "#1", font=font("Black", 76), fill=RED, anchor="lm")
        d.rounded_rectangle((150, 45, 270, 165), radius=24, fill=(255, 255, 255, 30))
        d.text((210, 105), "?", font=font("Black", 90), fill=WHITE, anchor="mm")
        d.text((300, 75), "???", font=font("Black", 60), fill=WHITE, anchor="lm")
        d.text((W - 140, 75), fmt_num(dmg), font=font("Black", 60), fill=WHITE, anchor="rm")
        bw = int((W - 440) * dmg / self.TOP)
        d.rounded_rectangle((300, 140, W - 140, 162), radius=11, fill=(255, 255, 255, 25))
        if bw > 22:
            d.rounded_rectangle((300, 140, 300 + bw, 162), radius=11, fill=RED + (255,))
        put(img, layer, W / 2, 660, 1 + 0.03 * math.sin(k * 40) * k)


class Killers2(Killers):
    """Исправленный «Кто убил»: всё по одной катке Drow (12/6/1), без чужих героев."""
    name = "killers2"
    stills = {"viper": ("killers", 1.5), "hood": ("deathmap", 2.5), "slark": ("deathmap", 9.6), "bkb": ("killers", 5)}
    portraits = {"viper": ("viper", (81, 151, 249, 246)), "hood": ("hood", (80, 194, 249, 287)), "slark": ("slark", (64, 221, 240, 319))}
    scroll = ("killers", 0.5, 8)
    chords, seed = 1, 21
    ROWS = [(2.0, "slark", "Slark", 2050, 2), (5.0, "hood", "Hoodwink", 5089, 2)]
    TOP = 5833

    def setup(self):
        self.hook_head = Headline("Кто убил меня больше всех?", "Black", 108, WHITE)
        self.hook_sub = Headline("топ за одну катку Drow Ranger", "SemiBold", 54, MUTED)
        self.top_name = line_layer("VIPER", "Black", 170, RED)
        self.even = Caption("6 смертей за катку. У каждого ровно по 2", 58, self.accent, per_word=0.12)
        self.twist_head = Headline("BKB был. Не спас", "Black", 110, WHITE)
        self.twist_sub = Caption("Viper Strike пробивает BKB, а диспел его не снимает", 48, RED)
        self.cuts = [2.0, self.build]
        self.hits = [(5.0, 0.35), (8.0, 0.3)]
        self.ticks = accel_ticks(self.build, self.land)
        self.clicks = [r[0] for r in self.ROWS]

    def scene(self, img, t):
        if t < 2.0:
            self.scroll_bg(img, t)
            self.hook_head.draw(img, W / 2, 820, t * 1.3)
            self.hook_sub.draw(img, W / 2, 1080, t - 0.6)
        elif t < self.drop:
            put(img, label("Кто убивал", self.accent), W / 2, 330)
            slots = {0: 1240, 1: 1000}
            for i, (t0, face, name, dmg, deaths) in enumerate(self.ROWS):
                if t >= t0:
                    self.row(img, slots[i], 3 - i, self.faces[face], name, dmg, deaths, t - t0, hl=(t0 <= t < t0 + 3 and t < self.build))
            if 8.0 <= t < self.build + 0.4:
                self.even.draw(img, 1520, t - 8.0)
            if t >= self.build:
                k = (t - self.build) / (self.land - self.build)
                self.mystery(img, self.TOP * clamp01(k) ** 2.2, k)
        elif t < self.twist:
            k = t - self.drop
            face = self.faces["viper"].resize((300, 300))
            put(img, glow_layer(face, RED, 40, 0.8), W / 2, 470, 1.3 - 0.3 * expo(k / 0.3))
            put(img, face, W / 2, 470, 1.3 - 0.3 * expo(k / 0.3))
            put(img, self.top_name, W / 2, 730, 1.3 - 0.3 * expo(k / 0.28))
            put(img, line_layer("5 833 урона · 2 смерти", "Black", 60, WHITE), W / 2, 860, alpha=clamp01((k - 0.3) / 0.2))
            self.proof(img, t, self.drop + 0.4, "viper", (40, 110, 870, 360), (270, 150, 730, 245), cy=1300, width=820, color=RED)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 420, k)
            self.twist_sub.draw(img, 600, k - 0.5)
            self.proof(img, t, self.twist + 0.3, "bkb", (30, 290, 870, 560), (60, 355, 620, 545), cy=1180, width=860, color=RED)


# ---------- 4. Миф или правда ----------
class Myth(Cut):
    name = "myth"
    stills = {"late": ("early", 7.5), "treads": ("early", 1.5), "kp": ("review", 4.5)}
    glow = [(30, 70, 50), (100, 20, 18), (40, 30, 60)]
    chords, seed = 3, 13
    cta_text = ("Проверь свою катку", "бот сравнит тебя с игроками твоего ранга")
    FACTS = [(2.0, "BKB можно собрать и после Butterfly", False, "late", (60, 300, 840, 730), [(60, 318, 840, 428), (60, 600, 840, 712)],
              "У про BKB к 30:15, Butterfly только к 33:40"),
             (6.5, "Power Treads на Drow — первым делом", True, "treads", (60, 90, 840, 310), (60, 110, 830, 300),
              "У про в 100% игр, к 6:29")]

    def setup(self):
        self.h_myth, self.h_or, self.h_true = line_layer("МИФ", "Black", 220, RED), line_layer("или", "SemiBold", 80, WHITE), line_layer("ПРАВДА", "Black", 190, GREEN)
        self.hook_sub = Headline("3 факта про керри на Страже. Проверяю на реальной катке", "SemiBold", 52, (220, 214, 206))
        self.stamps = {False: stamp("МИФ", RED), True: stamp("ПРАВДА", GREEN, 120)}
        self.quotes = [self.quote(f[1]) for f in self.FACTS] + [self.quote("Керри может не ходить в файты, главное — фарм")]
        self.caps = [Caption(f[6], 54, GOLD, per_word=0.15) for f in self.FACTS]
        self.twist_cap = Caption("28% участия в киллах. У керри на Страже обычно 48%", 58, GOLD, per_word=0.17)
        self.cuts = [2.0, 6.5, self.build]
        self.hits = [(f[0] + 1.6, 0.6) for f in self.FACTS]
        self.ticks = accel_ticks(self.build + 0.3, self.land, 0.3, 0.07)
        self.clicks = [f[0] for f in self.FACTS]

    def quote(self, text):
        hl = Headline(text, "Black", 74, WHITE, width=W - 240)
        h = hl.height + 110
        layer = panel(W - 120, h, fill=(255, 255, 255, 20), outline=(255, 255, 255, 70))
        ImageDraw.Draw(layer).rounded_rectangle((26, 30, 36, h - 30), radius=5, fill=GOLD + (255,))
        hl.draw(layer, (W - 120) / 2 + 10, h / 2, 5)
        return layer

    def scene(self, img, t):
        if t < 2.0:
            put(img, self.h_myth, W / 2, 620, 1.2 - 0.2 * expo(t / 0.3))
            put(img, self.h_or, W / 2, 800, alpha=clamp01((t - 0.35) / 0.1))
            put(img, self.h_true, W / 2, 960, 1.3 - 0.3 * expo((t - 0.6) / 0.3), alpha=clamp01((t - 0.6) / 0.08))
            self.hook_sub.draw(img, W / 2, 1200, t - 1.0)
        elif t < self.build:
            i = 0 if t < 6.5 else 1
            t0, _, truth, key, roi, box, _ = self.FACTS[i]
            k = t - t0
            put(img, label(f"Факт {i + 1} из 3", GOLD), W / 2, 260, alpha=clamp01(k / 0.15))
            q = self.quotes[i]
            e = expo(k / 0.45)
            put(img, q, W / 2, 470 + (1 - e) * 80, alpha=e)
            if k >= 1.6:
                kk = k - 1.6
                put(img, self.stamps[truth], W / 2 + 200, 470 + q.height / 2 + 70, 2.0 - 1.0 * expo(kk / 0.18), alpha=clamp01(kk / 0.06))
                self.proof(img, t, t0 + 1.9, key, roi, box, cy=1190, width=760, color=GREEN if truth else RED)
                self.caps[i].draw(img, 1640, kk - 1.0)
        elif t < self.drop:
            k = t - self.build
            put(img, label("Факт 3 из 3", GOLD), W / 2, 260)
            q = self.quotes[2]
            put(img, q, W / 2, 520)
            # стрелка-весы мечется между МИФ и ПРАВДА всё быстрее
            put(img, line_layer("МИФ", "Black", 70, RED), 250, 1000)
            put(img, line_layer("ПРАВДА", "Black", 70, GREEN), W - 250, 1000)
            phase = sum(1 for x in self.ticks if x <= t)
            side = -1 if phase % 2 else 1
            frac = clamp01((t - max([x for x in self.ticks if x <= t], default=self.build)) / 0.08)
            pos = side * (2 * frac - 1) if phase else 0
            track = panel(700, 16, fill=(255, 255, 255, 40), outline=(0, 0, 0, 0), radius=8)
            put(img, track, W / 2, 1120)
            put(img, panel(60, 60, fill=GOLD + (255,), outline=(0, 0, 0, 0), radius=30), W / 2 + pos * 320, 1120)
        elif t < self.twist:
            k = t - self.drop
            put(img, self.quotes[2], W / 2, 520)
            put(img, stamp("МИФ", RED, 170), W / 2 + 120, 520 + self.quotes[2].height / 2 + 90, 2.2 - 1.2 * expo(k / 0.2))
            self.proof(img, t, self.drop + 0.4, "kp", (40, 400, 860, 580), (180, 418, 830, 560), cy=1290, width=800, color=RED)
        else:
            k = t - self.twist
            put(img, label("Факт 3: миф", RED), W / 2, 300)
            c = self.shot("kp", 1, (40, 400, 860, 580), spot=1, box=(180, 418, 830, 560), box_k=1, width=860, color=RED)
            put(img, c, W / 2, 800)
            self.twist_cap.draw(img, 1350, k - 0.2)


# ---------- 5. Фазы катки ----------
class Phases(Cut):
    name = "phases"
    stills = {"p1": ("phases2", 1.5), "p3": ("phases2", 6.5), "chrono": ("phases2", 9)}
    glow = [(100, 16, 14), (60, 40, 10), (30, 14, 30)]
    chords, seed = 0, 21
    cta_text = ("Узнай, где ты слил свою катку", "кинь Match ID боту")
    SEG = [(0, 10, "Линия"), (10, 25, "Мидгейм"), (25, 48, "Лейт")]

    def setup(self):
        self.hook_head = Headline("В какой момент Undying слил катку?", "Black", 96, WHITE)
        self.verdicts = [stamp("РОВНО", GOLD, 110), stamp("ПРОИГРАНА", RED, 100)]
        self.p_heads = [Headline("Линия · 0–10 мин", "Black", 84, WHITE), Headline("Мидгейм · 10–25 мин", "Black", 84, WHITE),
                        Headline("Лейт · 25–48 мин", "Black", 84, WHITE)]
        self.twist_head = Headline("Каждую смерть можно открыть и спросить тренера, что пошло не так", "Black", 66, WHITE)
        self.cuts = [2.0, 6.5, self.build]
        self.hits = [(3.4, 0.4), (7.9, 0.6)]
        self.ticks = accel_ticks(self.build + 0.6, self.land)
        self.clicks = [2.0, 6.5]

    def timeline(self, img, t, revealed, head_min):
        x0, x1, y = 90, W - 90, 280
        bar = Image.new("RGBA", (W, 160), (0, 0, 0, 0))
        d = ImageDraw.Draw(bar)
        cols = [GOLD, RED, RED]
        for i, (a, b, name) in enumerate(self.SEG):
            sa, sb = x0 + (x1 - x0) * a / 48 + 4, x0 + (x1 - x0) * b / 48 - 4
            on = i < revealed
            d.rounded_rectangle((sa, 40, sb, 64), radius=12, fill=(cols[i] + (255,)) if on else (255, 255, 255, 40))
            d.text(((sa + sb) / 2, 100), name, font=font("Bold", 34), fill=(WHITE if on else MUTED) + (255,), anchor="mm")
        px = x0 + (x1 - x0) * head_min / 48
        d.ellipse((px - 16, 36, px + 16, 68), fill=WHITE + (255,))
        img.alpha_composite(bar, (0, y - 52))

    def stats(self, img, y, items, k):
        for j, (txt, col) in enumerate(items):
            e = expo((k - j * 0.15) / 0.4)
            put(img, panel(330, 120, fill=col + (30,), outline=col + (200,)), 190 + j * 350, y + (1 - e) * 40, alpha=e)
            put(img, line_layer(txt, "Black", 40, WHITE), 190 + j * 350, y + (1 - e) * 40, alpha=e)

    def scene(self, img, t):
        if t < 2.0:
            self.hook_head.draw(img, W / 2, 800, t * 1.3)
            self.timeline(img, t, 0, 48 * ease(t / 2))
        elif t < self.build:
            i = 0 if t < 6.5 else 1
            t0 = (2.0, 6.5)[i]
            k = t - t0
            self.timeline(img, t, i + (1 if k > 1.4 else 0), (5, 17.5)[i])
            self.p_heads[i].draw(img, W / 2, 470, k)
            if k > 1.4:
                put(img, self.verdicts[i], W / 2, 640, 1.8 - 0.8 * expo((k - 1.4) / 0.2), alpha=clamp01((k - 1.4) / 0.06))
            items = [[("2 смерти", WHITE), ("нетворс +212", GREEN), ("команда −969", RED)],
                     [("5 смертей", RED), ("0 убийств", RED), ("команда −5 414", RED)]][i]
            self.stats(img, 820, items, k - 0.5)
            roi = (30, 10, 866, 380) if i == 0 else (30, 400, 866, 820)
            self.proof(img, t, t0 + 1.8, "p1", roi, (36, 20, 862, 372) if i == 0 else (36, 405, 862, 812), cy=1330, width=760,
                       color=GOLD if i == 0 else RED, zoom=0.8)
        elif t < self.drop:
            k = t - self.build
            self.timeline(img, t, 2, 25 + 23 * ease(k / (self.land - self.build)))
            self.p_heads[2].draw(img, W / 2, 470, k)
            put(img, line_layer("команда за этот отрезок", "SemiBold", 46, MUTED), W / 2, 760)
            val = -14707 * clamp01(k / (self.land - self.build)) ** 2
            put(img, line_layer(fmt_num(val), "Black", 190, RED), W / 2, 920, 1 + 0.02 * math.sin(k * 50))
        elif t < self.twist:
            k = t - self.drop
            self.timeline(img, t, 3, 48)
            self.p_heads[2].draw(img, W / 2, 470, 5)
            put(img, glow_layer(line_layer("−14 707", "Black", 220, RED), RED), W / 2, 700, 1.4 - 0.4 * expo(k / 0.25), alpha=0.7)
            put(img, line_layer("−14 707", "Black", 220, RED), W / 2, 700, 1.4 - 0.4 * expo(k / 0.25))
            put(img, line_layer("золота  ·  10 смертей  ·  проиграна", "Bold", 46, WHITE), W / 2, 860, alpha=clamp01((k - 0.3) / 0.2))
            self.proof(img, t, self.drop + 0.5, "p3", (30, 130, 866, 530), (36, 140, 862, 520), cy=1280, width=820, color=RED, zoom=0.8)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 430, k)
            self.proof(img, t, self.twist + 0.1, "chrono", (40, 230, 860, 560), [(675, 285, 815, 330), (675, 475, 815, 520)], cy=1100,
                       width=880, color=GOLD, zoom=0.6)


# ---------- 6. Варды ----------
class Wards(Cut):
    name = "wards"
    stills = {"map": ("farmzones2", 2.5), "legend": ("farmzones2", 6)}
    glow = [(20, 40, 90), (60, 20, 60), (14, 40, 50)]
    accent = (120, 200, 255)
    chords, seed = 1, 31
    cta_text = ("Проверь свои варды", "бот нарисует карту по твоей катке")
    MAP = (90, 205, 815, 856)                 # карта в кадре
    ENEMY = [(105, 215), (815, 205), (815, 830)]     # треугольник выше реки — половина врага
    MAP_W = 960

    def setup(self):
        self.hook_head = Headline("Найди хоть один обс на половине врага", "Black", 84, WHITE)
        self.search = Headline("Ищем…", "Black", 84, WHITE)
        self.found = Headline("Нашёл?", "Black", 96, WHITE)
        self.zero = line_layer("0 из 16", "Black", 200, RED)
        self.twist_head = Headline("И ещё 7 обсов снесли раньше времени", "Black", 76, WHITE)
        self.cuts = [self.build]
        self.ticks = [x for x in accel_ticks(2.0, self.build, 0.5, 0.5)] + accel_ticks(self.build, self.land, 0.33, 0.1)
        self.clicks = []
        self.card = self.shot("map", 0, self.MAP, width=self.MAP_W)
        self.scale = self.MAP_W / 896

    def lens_pos(self, t):
        u = (t - 2.0) / (self.build - 2.0)
        # путь по половине врага: верх карты и правый край
        x = 520 + 200 * math.sin(u * 2 * math.pi * 1.3 + 0.6)
        y = 330 + 110 * math.sin(u * 2 * math.pi * 0.9) + 150 * u
        y = max(270, min(y, 240 + (x - 120) * 0.853 - 110))      # держим лупу выше реки, на половине врага
        return x, y

    def lens(self, img, card_xy, t, size=360, zoom=1.8):
        sx, sy = self.lens_pos(t)
        src = self.img["map"]
        r = size / 2 / zoom
        piece = src.crop((int(sx - r), int(sy - r), int(sx + r), int(sy + r))).resize((size, size), Image.BICUBIC).convert("RGBA")
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
        out = Image.new("RGBA", (size + 40, size + 40), (0, 0, 0, 0))
        sh = Image.new("RGBA", out.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse((20, 30, size + 20, size + 30), fill=(0, 0, 0, 200))
        out.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)))
        out.paste(piece, (20, 20), m)
        ImageDraw.Draw(out).ellipse((20, 20, size + 19, size + 19), outline=self.accent + (255,), width=8)
        cx, cy = card_xy
        put(img, out, cx + (sx - 448) * self.scale, cy + (sy - 428) * self.scale)

    def enemy_tint(self, img, card_xy, k):
        cx, cy = card_xy
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        pts = [(cx + (x - 448) * self.scale, cy + (y - 428) * self.scale) for x, y in self.ENEMY]
        ImageDraw.Draw(ov).polygon(pts, fill=RED + (int(110 * k),), outline=RED + (int(255 * k),))
        img.alpha_composite(ov)

    def scene(self, img, t):
        card_xy = (W / 2, 1060)
        if t < self.twist:
            put(img, self.card, *card_xy, k=self.pulse(t, 2.0) if 2 <= t < self.build else 1.0)
        if t < 2.0:
            self.hook_head.draw(img, W / 2, 360, t * 1.3)
            put(img, line_layer("карта вардов одной катки на Страже", "SemiBold", 44, MUTED), W / 2, 500, alpha=clamp01((t - 0.8) / 0.3))
        elif t < self.build:
            self.search.draw(img, W / 2, 420, t - 2.0)
            self.lens(img, card_xy, t)
        elif t < self.drop:
            k = t - self.build
            self.found.draw(img, W / 2, 420, k)
            put(img, ring(150, clamp01(k / (self.land - self.build)), self.accent), W / 2, 1650)
            put(img, line_layer(str(max(1, math.ceil(self.land - t))), "Black", 64, WHITE, shadow=False), W / 2, 1648)
        elif t < self.twist:
            k = t - self.drop
            self.enemy_tint(img, card_xy, expo(k / 0.3))
            put(img, glow_layer(self.zero, RED), W / 2, 380, 1.5 - 0.5 * expo(k / 0.25), alpha=0.7)
            put(img, self.zero, W / 2, 380, 1.5 - 0.5 * expo(k / 0.25))
            put(img, line_layer("обсов на половине врага", "Bold", 50, WHITE), W / 2, 530, alpha=clamp01((k - 0.3) / 0.2))
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 420, k)
            self.proof(img, t, self.twist + 0.1, "legend", (40, 560, 860, 820), (65, 650, 475, 705), cy=1080, width=900, color=RED, zoom=0.8)


# ---------- 7. Линия ----------
class Lane(Cut):
    name = "lanexp"
    stills = {"table": ("lane2", 4.5), "phase": ("phases2", 1.5)}
    glow = [(20, 70, 50), (100, 20, 18), (30, 30, 60)]
    chords, seed = 2, 41
    cta_text = ("Разбери свою линию по минутам", "кинь Match ID боту")
    ROWS = [(2, 130, 250, -135), (4, 270, 395, -295), (6, 410, 535, -272), (8, 555, 680, -218), (10, 690, 810, -523)]

    def setup(self):
        self.l1 = line_layer("Крипы в плюс", "Black", 110, GREEN)
        self.l2 = line_layer("опыт −523", "Black", 150, RED)
        self.l3 = Headline("Как так?", "Black", 90, WHITE)
        self.twist_head = Headline("И ноль обсов за всю линию", "Black", 84, WHITE)
        self.twist_cap = Caption("Бот видит такое по минутам", 60, GOLD, per_word=0.2)
        self.steps = [2.0 + i * 1.8 for i in range(4)]
        self.cuts = [2.0, self.build]
        self.clicks = self.steps[1:]
        self.ticks = accel_ticks(self.build + 0.4, self.land)

    def scene(self, img, t):
        if t < 2.0:
            put(img, self.l1, W / 2, 640, 1.2 - 0.2 * expo(t / 0.3))
            put(img, self.l2, W / 2, 820, 1.4 - 0.4 * expo((t - 0.5) / 0.3), alpha=clamp01((t - 0.5) / 0.08))
            self.l3.draw(img, W / 2, 1060, t - 1.1)
        elif t < self.drop:
            if t < self.build:
                i = min(3, int((t - 2.0) / 1.8))
                k = t - self.steps[i]
            else:
                i, k = 4, t - self.build
            mn, y0, y1, xp = self.ROWS[i]
            put(img, label("Линия против Nyx Assassin", self.accent), W / 2, 260)
            if t < self.build:
                put(img, line_layer(f"{mn} мин", "Black", 100, WHITE), W / 2, 420, 1.15 - 0.15 * expo(k / 0.3))
                put(img, line_layer(f"опыт {fmt_num(xp)}", "Black", 80, RED), W / 2, 560, alpha=clamp01((k - 0.3) / 0.15))
            else:
                v = -218 + (-523 + 218) * clamp01(k / (self.land - self.build)) ** 2
                put(img, line_layer("10 мин", "Black", 100, WHITE), W / 2, 420)
                put(img, line_layer(f"опыт {fmt_num(v)}", "Black", 110, RED), W / 2, 570, 1 + 0.02 * math.sin(k * 50))
            roi = (60, max(0, y0 - 120), 840, min(856, y1 + 120))
            z = 0.55 + 0.1 * ease(k / 1.8)
            c = self.shot("table", z, roi, spot=1, box=[(60, y0, 840, y1)], box_k=max(0.01, k - 0.2), width=900,
                          bump=self.pulse(t, 2.0), color=RED)
            put(img, c, W / 2, 1180)
        elif t < self.twist:
            k = t - self.drop
            put(img, glow_layer(line_layer("−523", "Black", 260, RED), RED), W / 2, 420, 1.5 - 0.5 * expo(k / 0.25), alpha=0.7)
            put(img, line_layer("−523", "Black", 260, RED), W / 2, 420, 1.5 - 0.5 * expo(k / 0.25))
            put(img, line_layer("опыта к 10-й минуте", "Bold", 54, WHITE), W / 2, 600, alpha=clamp01((k - 0.3) / 0.2))
            c = self.shot("table", 0.6, (60, 570, 840, 856), spot=1, box=(700, 700, 830, 800), box_k=max(0.01, k - 0.4), width=900, color=RED)
            put(img, c, W / 2, 1180)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 420, k)
            self.proof(img, t, self.twist + 0.1, "phase", (30, 10, 866, 380), (78, 165, 250, 210), cy=980, width=900, color=RED, zoom=0.7)
            self.twist_cap.draw(img, 1550, k - 1.0)


# ---------- общий квиз: подсветка бегает по вариантам и садится на ответ к тишине ----------
class Quiz(Cut):
    OPTIONS, ANSWER = [], 0
    option_size = 64

    def quiz_setup(self):
        self.opt_off = [self.option_card(o, False) for o in self.OPTIONS]
        self.opt_on = [self.option_card(o, True) for o in self.OPTIONS]
        self.ticks = accel_ticks(self.build + 0.3, self.land, 0.3, 0.07)

    def option_card(self, text, on):
        layer = panel(W - 200, 150, fill=(GOLD + (60,)) if on else (255, 255, 255, 16), outline=(GOLD + (255,)) if on else (255, 255, 255, 60), width=4 if on else 2)
        put(layer, line_layer(text, "Black", self.option_size, WHITE if on else (200, 198, 194)), (W - 200) / 2, 75)
        return layer

    def picked(self, t):
        c = sum(1 for x in self.ticks if x <= t)
        return (self.ANSWER - (len(self.ticks) - c)) % len(self.OPTIONS) if c else None

    def options(self, img, t, y0, step=180, final=False):
        cur = self.ANSWER if final else self.picked(t)
        for i in range(len(self.OPTIONS)):
            e = expo((t - self.build - i * 0.08) / 0.4) if not final else 1
            on = i == cur
            layer = self.opt_on[i] if on else self.opt_off[i]
            if final and not on:
                put(img, layer, W / 2, y0 + i * step, alpha=0.35)
            else:
                put(img, layer, W / 2 + (1 - e) * 200, y0 + i * step, 1.04 if on and not final else 1.0, alpha=e)


# ---------- 8. Ноль из трёх ----------
class Zero3(Cut):
    name = "zero3"
    stills = {"main": ("build2", 1.5), "order": ("build2", 6.5), "phase": ("build2", 10)}
    glow = [(100, 20, 18), (60, 40, 14), (30, 20, 60)]
    chords, seed = 1, 51
    cta_text = ("Сверь свою сборку с про", "кинь Match ID боту")
    CLUES = [(2.0, "main", "Glimmer Cape так и не собрал", (80, 200, 820, 550), (100, 285, 790, 415)),
             (5.0, "main", "Consecrated Wraps на 25:42. Про его почти не берут", (80, 200, 820, 550), (100, 435, 720, 520)),
             (8.0, "phase", "Phase Boots на 15:19. У про к 8:11", (40, 500, 860, 700), (50, 530, 840, 660))]

    def setup(self):
        self.big = line_layer("0 из 3", "Black", 300, RED)
        self.big_glow = glow_layer(self.big, RED)
        self.hook_sub = Headline("главных предметов у саппорта на Страже", "SemiBold", 58, (220, 214, 206))
        self.hook_q = Headline("Найди, где он слил сборку", "Black", 80, GOLD)
        self.tags = [label(f"Ошибка {i + 1} из 3", RED) for i in range(3)]
        self.heads = [Headline(c[2], "Black", 76, WHITE) for c in self.CLUES]
        self.q_head = Headline("Сколько главных предметов собрал?", "Black", 92, WHITE)
        self.digits = {n: line_layer(str(n), "Black", 340, WHITE) for n in range(4)}
        self.answer = line_layer("0 ИЗ 3", "Black", 230, RED)
        self.answer_glow = glow_layer(self.answer, RED)
        self.twist_head = Headline("Про собирают их к 21:41–31:07", "Black", 80, WHITE)
        self.twist_cap = Caption("А у тебя первый предмет только на 25:42", 60, GOLD, per_word=0.18)
        self.cuts = [2.0, 5.0, 8.0, self.build]
        self.hits = [(c[0] + 1.5, 0.45) for c in self.CLUES]
        self.ticks = accel_ticks(self.build + 0.3, self.land)
        self.clicks = [c[0] + 0.9 for c in self.CLUES]

    def scene(self, img, t):
        if t < 2.0:
            sc = 1.25 - 0.25 * expo(t / 0.3)
            put(img, self.big_glow, W / 2, 700, sc, alpha=0.7)
            put(img, self.big, W / 2, 700, sc)
            self.hook_sub.draw(img, W / 2, 950, t - 0.4)
            self.hook_q.draw(img, W / 2, 1180, t - 0.9)
        elif t < self.build:
            i = 0 if t < 5 else 1 if t < 8 else 2
            t0, key, _, roi, box = self.CLUES[i]
            put(img, self.tags[i], W / 2, 330, alpha=clamp01((t - t0) / 0.15))
            self.heads[i].draw(img, W / 2, 510, t - t0 - 0.05)
            self.proof(img, t, t0, key, roi, box, cy=1130, width=940, color=RED)
        elif t < self.drop:
            k = t - self.build
            self.q_head.draw(img, W / 2, 440, k)
            n = sum(1 for x in self.ticks if x <= t)
            landed = t >= self.land
            put(img, panel(520, 460, outline=(GOLD + (255,)) if landed else (255, 255, 255, 70), width=3), W / 2, 1020)
            if not landed:
                put(img, self.digits[3 - n % 4], W / 2, 1010, 1 + 0.06 * math.exp(-(t - max([x for x in self.ticks if x <= t], default=0)) * 20))
            else:
                put(img, line_layer("?", "Black", 340, GOLD), W / 2, 1010)
            put(img, ring(150, clamp01(k / (self.land - self.build)), GOLD), W / 2, 1480)
        elif t < self.twist:
            k = t - self.drop
            sc = 1.5 - 0.5 * expo(k / 0.25)
            put(img, self.answer_glow, W / 2, 420, sc, alpha=0.7)
            put(img, self.answer, W / 2, 420, sc)
            self.proof(img, t, self.drop + 0.3, "order", (40, 220, 860, 620), (60, 240, 640, 290), cy=1150, width=940, color=RED)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 420, k)
            c = self.shot("order", 1, (40, 380, 860, 610), spot=1, box=[(40, 500, 560, 610)], box_k=max(0.01, k - 0.4), width=940,
                          bump=self.pulse(t, self.twist), color=GREEN)
            put(img, c, W / 2, 960)
            self.twist_cap.draw(img, 1520, k - 1.0)


# ---------- 9. Ганкали одного ----------
class Ganked(Quiz):
    name = "ganked"
    stills = {"card": ("firsterr", 6.5), "tip": ("firsterr", 8)}
    glow = [(90, 18, 18), (20, 50, 70), (60, 14, 20)]
    chords, seed = 0, 61
    cta_text = ("Узнай, где умираешь ты", "кинь Match ID боту")
    DEATHS = [(11 * 60 + 34, 2.0), (29 * 60 + 47, 3.5), (32 * 60 + 46, 5.0), (38 * 60 + 40, 6.5)]
    LENGTH = 48 * 60
    OPTIONS = ["Купить побольше вардов", "Считать врагов на миникарте", "Фармить только лес"]
    ANSWER = 1
    option_size = 56

    def setup(self):
        self.h1 = line_layer("4 смерти", "Black", 190, RED)
        self.h1_glow = glow_layer(self.h1, RED)
        self.hook_sub = Headline("и ни одной в драке. Его просто ловили одного", "SemiBold", 58, (220, 214, 206))
        self.tag = label("Тебя ганкали одного", RED)
        self.gank_cap = Caption("Ганкали: башня, Sven, Anti-Mage", 60, RED, per_word=0.2)
        self.q_head = Headline("Что советует бот?", "Black", 100, WHITE)
        self.quiz_setup()
        self.answer_tag = label("Ответ бота", GREEN)
        self.twist_head = Headline("Трёх врагов нет на карте — значит, идут на тебя", "Black", 76, WHITE)
        self.twist_cap = Caption("Фарми ближе к своим", 66, GOLD, per_word=0.25)
        self.cuts = [2.0, self.build]
        self.clicks = [d[1] for d in self.DEATHS]
        self.hits = [(d[1], 0.3) for d in self.DEATHS[1:]]

    def timeline(self, img, t):
        x0, x1, y = 120, W - 120, 640
        put(img, panel(x1 - x0, 12, fill=(255, 255, 255, 50), outline=(0, 0, 0, 0), radius=6), W / 2, y)
        for m in (0, 12, 24, 36, 48):
            put(img, line_layer(f"{m}:00" if m else "0", "SemiBold", 30, MUTED), x0 + (x1 - x0) * m / 48, y + 56)
        for n, (sec, at) in enumerate(self.DEATHS):
            k = t - at
            if k < 0:
                continue
            x = x0 + (x1 - x0) * sec / self.LENGTH
            e = expo(k / 0.3)
            put(img, panel(28, 28, fill=RED + (255,), outline=(255, 255, 255, 200), radius=14), x, y, 2 - e)
            ly = y - 70 - 62 * max(0, n - 1)                  # поздние смерти идут плотно, подписи лесенкой
            if n > 1:
                put(img, panel(4, int(y - ly - 50), fill=(255, 255, 255, 90), outline=(0, 0, 0, 0), radius=2), x, (ly + y) / 2 + 5, alpha=e)
            put(img, line_layer(fmt_time(sec), "Black", 46, WHITE), x, ly + (1 - e) * 30, alpha=e)

    def scene(self, img, t):
        if t < 2.0:
            sc = 1.25 - 0.25 * expo(t / 0.3)
            put(img, self.h1_glow, W / 2, 720, sc, alpha=0.7)
            put(img, self.h1, W / 2, 720, sc)
            self.hook_sub.draw(img, W / 2, 1000, t - 0.5)
        elif t < self.build:
            put(img, self.tag, W / 2, 300, alpha=clamp01((t - 2.0) / 0.15))
            self.timeline(img, t)
            self.proof(img, t, 2.3, "card", (20, 530, 880, 856), (180, 630, 810, 730), cy=1190, width=940, color=RED, zoom=0.8)
            self.gank_cap.draw(img, 1700, t - 8.0)
        elif t < self.drop:
            k = t - self.build
            self.q_head.draw(img, W / 2, 420, k)
            self.options(img, t, 800)
            put(img, ring(130, clamp01(k / (self.land - self.build)), GOLD), W / 2, 1450)
        elif t < self.twist:
            k = t - self.drop
            put(img, self.answer_tag, W / 2, 300, alpha=clamp01(k / 0.2))
            put(img, self.opt_on[1], W / 2, 460, 1.3 - 0.3 * expo(k / 0.25))
            self.proof(img, t, self.drop + 0.3, "tip", (60, 120, 880, 700), (180, 380, 800, 630), cy=1130, width=940, color=GREEN, zoom=0.8)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 420, k)
            c = self.shot("tip", 0.8, (60, 120, 880, 700), spot=1, box=(180, 380, 800, 630), box_k=1, width=900, color=GREEN)
            put(img, c, W / 2, 1060)
            self.twist_cap.draw(img, 1560, k - 1.2)


# ---------- 10. Manta, которой не было ----------
class Manta(Cut):
    name = "manta"
    stills = {"core": ("order", 12)}
    glow = [(100, 20, 18), (30, 60, 90), (60, 50, 14)]
    chords, seed = 3, 71
    cta_text = ("Проверь, вовремя ли твоя сборка", "кинь Match ID боту")
    ITEMS = [(2.0, "Manta Style", "53%", "42%", (60, 64, 840, 254), (674, 134, 839, 179)),
             (5.0, "Aghanim's Scepter", "52%", "40%", (60, 314, 840, 494), (674, 384, 839, 429)),
             (8.0, "Hurricane Pike", "54%", "44%", (60, 564, 840, 744), (674, 629, 839, 674))]
    CLOCK = [20, 25, 30, 35, 40, 45]

    def setup(self):
        self.h1 = line_layer("−11%", "Black", 320, RED)
        self.h1_glow = glow_layer(self.h1, RED)
        self.hook_sub = Headline("побед, если Manta на Drow позже 25:00", "SemiBold", 60, (220, 214, 206))
        self.hook_q = Headline("А когда собрал этот Drow?", "Black", 80, GOLD)
        self.tags = [label(f"Предмет {i + 1} из 3", GOLD) for i in range(3)]
        self.names = [line_layer(it[1], "Black", 92, WHITE) for it in self.ITEMS]
        self.rates = [(line_layer(it[2], "Black", 110, GREEN), line_layer(it[3], "Black", 110, RED)) for it in self.ITEMS]
        self.arrow = line_layer("→", "Black", 90, WHITE)
        self.small = (line_layer("до 25:00", "SemiBold", 36, MUTED), line_layer("позже", "SemiBold", 36, MUTED))
        self.q_head = Headline("Во сколько у него Manta?", "Black", 96, WHITE)
        self.clock = {m: line_layer(f"{m}:00", "Black", 230, WHITE) for m in self.CLOCK}
        self.answer = stamp("НЕ БЫЛО", RED, 170)
        self.twist_head = Headline("Из всего ядра только BKB, и тот на 41:55", "Black", 78, WHITE)
        self.twist_cap = Caption("Бот покажет, какой предмет решал твою катку", 58, GOLD, per_word=0.17)
        self.cuts = [2.0, 5.0, 8.0, self.build]
        self.hits = [(it[0] + 1.0, 0.4) for it in self.ITEMS]
        self.ticks = accel_ticks(self.build + 0.3, self.land, 0.28, 0.06)
        self.clicks = [it[0] + 1.0 for it in self.ITEMS]

    def scene(self, img, t):
        if t < 2.0:
            sc = 1.25 - 0.25 * expo(t / 0.3)
            put(img, self.h1_glow, W / 2, 680, sc, alpha=0.7)
            put(img, self.h1, W / 2, 680, sc)
            self.hook_sub.draw(img, W / 2, 940, t - 0.4)
            self.hook_q.draw(img, W / 2, 1160, t - 0.9)
        elif t < self.build:
            i = 0 if t < 5 else 1 if t < 8 else 2
            t0, _, _, _, roi, _ = self.ITEMS[i]
            k = t - t0
            put(img, self.tags[i], W / 2, 270, alpha=clamp01(k / 0.15))
            put(img, self.names[i], W / 2, 400, 1.1 - 0.1 * expo(k / 0.3), alpha=clamp01(k / 0.1))
            good, bad = self.rates[i]
            e1, e2 = expo((k - 0.3) / 0.3), expo((k - 1.0) / 0.3)
            put(img, good, W / 2 - 230, 560, alpha=e1)
            put(img, self.small[0], W / 2 - 230, 650, alpha=e1)
            put(img, self.arrow, W / 2, 555, alpha=e2)
            put(img, bad, W / 2 + 230, 560, 1.3 - 0.3 * e2, alpha=clamp01((k - 1.0) / 0.08))
            put(img, self.small[1], W / 2 + 230, 650, alpha=e2)
            text_box = (roi[0] + 130, roi[1], 660, roi[3])
            self.proof(img, t, t0 + 0.2, "core", roi, text_box, cy=1180, width=940, zoom=0.9)
        elif t < self.drop:
            k = t - self.build
            self.q_head.draw(img, W / 2, 440, k)
            n = sum(1 for x in self.ticks if x <= t)
            landed = t >= self.land
            put(img, panel(W - 200, 330, outline=(GOLD + (255,)) if landed else (255, 255, 255, 70), width=3), W / 2, 980)
            if landed:
                put(img, line_layer("??:??", "Black", 230, GOLD), W / 2, 970)
            else:
                put(img, self.clock[self.CLOCK[n % len(self.CLOCK)]], W / 2, 970)
            put(img, ring(150, clamp01(k / (self.land - self.build)), GOLD), W / 2, 1450)
        elif t < self.twist:
            k = t - self.drop
            put(img, self.answer, W / 2, 400, 2.0 - 1.0 * expo(k / 0.2), alpha=clamp01(k / 0.06))
            self.proof(img, t, self.drop + 0.3, "core", (60, 64, 840, 744), [it[5] for it in self.ITEMS], cy=1150, width=900, color=RED, zoom=0.6)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 420, k)
            c = self.shot("core", 1, (60, 560, 840, 856), spot=1, box=(190, 805, 840, 856), box_k=max(0.01, k - 0.4), width=940,
                          bump=self.pulse(t, self.twist), color=GOLD)
            put(img, c, W / 2, 1000)
            self.twist_cap.draw(img, 1540, k - 1.0)


# ---------- 11. Где умирал в драках ----------
class FightMap(Quiz):
    name = "fightquiz"
    stills = {"map": ("fightmap", 4.5)}
    glow = [(20, 70, 40), (90, 18, 18), (30, 30, 70)]
    chords, seed = 2, 81
    cta_text = ("Посмотри свою карту смертей", "кинь Match ID боту")
    XS = [(150, 188), (250, 383), (408, 463), (200, 517)]
    MAP = (70, 30, 840, 700)
    OPTIONS = ["0", "1", "2", "4"]
    ANSWER = 0
    option_size = 80

    def setup(self):
        self.h1 = line_layer("4 смерти", "Black", 190, WHITE)
        self.hook_sub = Headline("в драках у саппорта на Страже", "SemiBold", 58, (220, 214, 206))
        self.hook_q = Headline("Сколько из них на половине врага?", "Black", 82, GOLD)
        self.tag = label("Карта смертей", GOLD)
        self.heads = [Headline("Крестик — место смерти", "Black", 76, WHITE),
                      Headline("Зелёный угол — твоя база, красный — вражеская", "Black", 70, WHITE)]
        self.q_head = Headline("Сколько смертей на половине врага?", "Black", 86, WHITE)
        self.quiz_setup()
        self.answer = line_layer("НОЛЬ", "Black", 260, GOLD)
        self.answer_glow = glow_layer(self.answer, GOLD)
        self.twist_head = Headline("Все 4 на своей половине", "Black", 88, WHITE)
        self.twist_cap = Caption("Враг сам заходил к тебе, а ты узнавал об этом последним", 56, GOLD, per_word=0.15)
        self.cuts = [2.0, 7.0, self.build]
        self.clicks = [2.6 + i * 0.9 for i in range(4)] + [7.6, 8.2]
        self.hits = [(7.6, 0.35)]

    def xbox(self, n):
        return [(x - 32, y - 32, x + 32, y + 32) for x, y in self.XS[:n]]

    def scene(self, img, t):
        if t < 2.0:
            put(img, self.h1, W / 2, 640, 1.2 - 0.2 * expo(t / 0.3))
            self.hook_sub.draw(img, W / 2, 860, t - 0.4)
            self.hook_q.draw(img, W / 2, 1100, t - 0.9)
        elif t < self.build:
            put(img, self.tag, W / 2, 270, alpha=clamp01((t - 2.0) / 0.15))
            if t < 7.0:
                self.heads[0].draw(img, W / 2, 420, t - 2.05)
                n = sum(1 for x in self.clicks[:4] if x <= t)
                box, col = self.xbox(n) or None, RED
                k_box = max(0.01, t - self.clicks[max(0, n - 1)]) if n else 0
            else:
                self.heads[1].draw(img, W / 2, 440, t - 7.05)
                box = [(100, 568, 215, 680)] + ([(665, 52, 775, 148)] if t >= 8.2 else [])
                col, k_box = GREEN if t < 8.2 else GOLD, max(0.01, t - (7.6 if t < 8.2 else 8.2))
            c = self.shot("map", 1, self.MAP, spot=0.6 if box else 0, box=box, box_k=k_box, width=900,
                          bump=self.pulse(t, 2.0), color=col)
            e = expo((t - 2.0) / 0.5)
            put(img, c, W / 2, 1150 + (1 - e) * 140, alpha=clamp01((t - 2.0) / 0.12))
        elif t < self.drop:
            k = t - self.build
            self.q_head.draw(img, W / 2, 400, k)
            self.options(img, t, 700)
            put(img, ring(130, clamp01(k / (self.land - self.build)), GOLD), W / 2, 1550)
        elif t < self.twist:
            k = t - self.drop
            sc = 1.5 - 0.5 * expo(k / 0.25)
            put(img, self.answer_glow, W / 2, 380, sc, alpha=0.7)
            put(img, self.answer, W / 2, 380, sc)
            self.proof(img, t, self.drop + 0.3, "map", (60, 560, 840, 856), (70, 735, 800, 815), cy=1100, width=940, zoom=0.8)
        else:
            k = t - self.twist
            self.twist_head.draw(img, W / 2, 330, k)
            c = self.shot("map", 1, self.MAP, spot=1, box=self.xbox(4), box_k=max(0.01, k - 0.3), width=860,
                          bump=self.pulse(t, self.twist), color=RED)
            put(img, c, W / 2, 1000)
            self.twist_cap.draw(img, 1620, k - 1.0)


VIDEOS = {c.name: c for c in (GuessRank, Versus, Killers, Myth, Phases, Wards, Lane, Zero3, Ganked, Manta, FightMap, Killers2)}


# ---------- звук ----------
def fft_lp(x, cutoff):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / (1 + (f / cutoff) ** 4), len(x))


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
    s = np.sin(2 * np.pi * np.cumsum(freq * (1 + 1.5 * np.exp(-t * 40))) / SR)
    return np.tanh(s * 2.2) * np.minimum(1, t / 0.004) * np.exp(-t * 1.6)


def impact(rng):
    t = n_(2.2)
    boom = np.sin(2 * np.pi * np.cumsum(38 + 90 * np.exp(-t * 18)) / SR) * np.exp(-t * 2.2)
    return np.tanh(boom * 1.6) + fft_hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 2.8) * 0.35


def riser(rng, sec):
    t = n_(sec)
    noise = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    for j in range(12):
        a, b = len(t) * j // 12, len(t) * (j + 1) // 12
        out[a:b] = fft_hp(noise, 300 + 9000 * (j / 12) ** 2)[a:b]
    sweep = np.sin(2 * np.pi * np.cumsum(220 + 660 * (t / sec) ** 2) / SR) * 0.15
    return (out * 0.5 + sweep) * (t / sec) ** 2.5


def pluck(freq, sec=0.18):
    t = n_(sec)
    return (np.sign(np.sin(2 * np.pi * freq * t)) * 0.3 + np.sin(2 * np.pi * freq * t)) * np.exp(-t * 22)


PROGS = [[(220.0, True), (174.61, False), (261.63, False), (196.0, False)],      # Am F C G
         [(146.83, True), (233.08, False), (174.61, False), (261.63, False)],    # Dm Bb F C
         [(164.81, True), (261.63, False), (196.0, False), (146.83, False)],     # Em C G D
         [(196.0, True), (155.56, False), (233.08, False), (174.61, False)]]     # Gm Eb Bb F


def soundtrack(cut, path):
    rng = np.random.default_rng(cut.seed + 100)
    beat = BEAT * SLOW                                    # трек растягивается вместе с картинкой
    bar_len = 4 * beat
    end, build, land, drop, cta = (x * SLOW for x in (cut.end, cut.build, cut.land, cut.drop, cut.cta))
    n = int(end * SR)
    drums, bass, pad, arp, fx = (np.zeros(n) for _ in range(5))
    K, C, Hh, Ho = kick(), clap(rng), hat(rng), hat(rng, True)
    duck = np.ones(n)
    for b in range(int(end / beat)):
        t = b * beat
        if build <= t < drop:
            continue
        hot, outro = drop <= t < cta, t >= cta
        if (b % 4 in (0, 2)) or hot or (outro and b % 4 == 0):
            add(drums, t, K, 1.0 if hot else 0.85)
            s = int(t * SR)
            ln = min(int(0.2 * SR), n - s)
            duck[s:s + ln] *= np.linspace(0.35, 1, ln)
        if b % 4 in (1, 3) and not outro:
            add(drums, t, C, 0.55 if hot else 0.45)
        add(drums, t + beat / 2, Ho if hot else Hh, 0.3 if hot else 0.22)
        if not outro:
            add(drums, t + beat / 4, Hh, 0.12)
            add(drums, t + 3 * beat / 4, Hh, 0.12)
        if b % 8 == 7 and not outro and t + beat < build:
            for j in range(6):
                add(drums, t + j * beat / 6, Hh, 0.1 + 0.03 * j)
    t = build
    while t < land - 0.02:                                # дробь клэпа ускоряется к дропу
        u = (t - build) / (land - build)
        add(drums, t, C, 0.15 + 0.45 * u)
        t += beat / (2 if u < 0.35 else 4 if u < 0.7 else 8)
    prog = PROGS[cut.chords % len(PROGS)]
    for bar in range(int(end / bar_len) + 1):
        root, minor = prog[bar % 4]
        t0 = bar * bar_len
        third = 1.189 if minor else 1.26
        for mult in (1, third, 1.498, 2):
            s = fft_lp(tone(root * mult, int(bar_len * SR), "saw"), 1800) * np.minimum(1, n_(bar_len) / 0.25) * np.exp(-n_(bar_len) / 2.5)
            add(pad, t0, s, 0.05)
        if t0 < build or t0 >= drop:
            per = 8 if drop <= t0 < cta else 4
            for j in range(per if t0 < cta else 1):
                add(bass, t0 + j * bar_len / per, sub808(root / 4, bar_len / per * 1.6), 0.6)
        if 2.0 * SLOW <= t0 < build or drop <= t0 < cta:
            for j in range(16):
                f = root * [1, third, 1.498, 2.0, 1.498, third][(j * (5 + cut.seed % 3)) % 6] * 2
                add(arp, t0 + j * bar_len / 16, pluck(f), 0.09 if t0 < build else 0.12)
    melody = pad + arp
    s0, s1, s2 = int(build * SR), int(land * SR), int(drop * SR)
    mix_k = np.zeros(n)
    mix_k[s0:s1] = np.linspace(0.2, 1, s1 - s0)
    melody = melody * (1 - mix_k) + fft_lp(melody, 500) * mix_k
    for x in (drums, bass, melody):
        x[s1:s2] = 0                                      # тишина перед дропом
    add(fx, 0, impact(rng), 0.9)
    add(fx, drop, impact(rng), 1.0)
    add(fx, drop, sub808(36.7, 1.8), 0.9)
    add(fx, build, riser(rng, land - build), 0.7)
    for c in cut.cuts:
        add(fx, c * SLOW - 0.22, whoosh(rng, 0.3), 0.5 / SLOW)
    for at, power in cut.hits:
        add(fx, at * SLOW, impact(rng)[: int(0.8 * SR)], 0.45 * power + 0.15)
    for c in cut.clicks:
        add(fx, c * SLOW, pluck(1760, 0.12), 0.25)
    for x in cut.ticks:
        add(fx, x * SLOW, np.sin(2 * np.pi * 2400 * n_(0.03)) * np.exp(-n_(0.03) * 160), 0.35)
    add(fx, land, np.sin(2 * np.pi * 1318 * n_(0.4)) * np.exp(-n_(0.4) * 9), 0.3)
    add(fx, cut.twist * SLOW + 0.5, np.sin(2 * np.pi * 1568 * n_(0.6)) * np.exp(-n_(0.6) * 7), 0.25)
    fade = np.ones(n)
    fade[-int(1.2 * SR):] = np.linspace(1, 0, int(1.2 * SR))
    mix = np.tanh((drums * 0.95 + bass * 0.75 + melody * duck + fx) * 1.25) * fade
    mix = mix / np.max(np.abs(mix)) * 0.9
    width = fft_hp(arp + pad, 800) * 0.05
    stereo = np.stack([mix + width, np.roll(mix, int(0.003 * SR)) - width], axis=1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(stereo, -1, 1) * 32767).astype(np.int16).tobytes())


# ---------- сборка ----------
def extract(cls, tmp):
    x0, y0, x1, y1 = CROP
    crop = f"crop={x1 - x0}:{y1 - y0}:{x0}:{y0}"
    for k, (reel, sec) in cls.stills.items():
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(sec), "-i", str(REELS / f"{reel}.mp4"), "-frames:v", "1", "-vf", crop,
                        f"{tmp}/{k}.png"], check=True)
    if cls.scroll:
        reel, ss, dur = cls.scroll
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(ss), "-t", str(dur), "-i", str(REELS / f"{reel}.mp4"), "-vf",
                        f"{crop},fps=30", f"{tmp}/scroll%04d.png"], check=True)


_cut = None


def _init(name, tmp):
    global _cut
    _cut = VIDEOS[name](tmp)


def _frame(i):
    return _cut.frame(i)


def make(name):
    cls = VIDEOS[name]
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        extract(cls, tmp)
        cut = cls(tmp)
        wav = Path(tmp) / "a.wav"
        soundtrack(cut, wav)
        enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                                "-i", str(wav), "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-maxrate", "5M", "-bufsize", "10M", "-pix_fmt", "yuv420p", "-profile:v", "high",
                                "-movflags", "+faststart", "-c:a", "aac", "-b:a", "256k", "-shortest", str(OUT / f"{name}.mp4")], stdin=subprocess.PIPE)
        with ProcessPoolExecutor(initializer=_init, initargs=(name, tmp)) as pool:
            for buf in pool.map(_frame, range(int(cut.end * SLOW * FPS)), chunksize=8):
                enc.stdin.write(buf)
        enc.stdin.close()
        if enc.wait():
            raise RuntimeError(f"ffmpeg упал на {name}")
    print("готово", OUT / f"{name}.mp4")


if __name__ == "__main__":
    for nm in sys.argv[1:] or list(VIDEOS):
        make(nm)
