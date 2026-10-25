"""Shorts в разных форматах: у каждого ролика очереди свой приём, палитра, звук и длина, чтобы лента не была однотипной.
Форматы: quiz (угадай ответ с таймером), pov (POV-мем с бумом), nobody («Никто: / Абсолютно никто:»), expect (ожидание/реальность),
top3 (обратный отсчёт), chat (переписка с ботом), error (ошибка → исправление), versus (ты против про), karaoke (крупные
субтитры по словам), counter (счётчик смертей). Кадры экрана берутся из рилсов promo/reels/<id>.mp4 (tools/promo_reels.py),
все цифры в подписях — те, что видны на этих экранах. Эмодзи — Noto Color Emoji, музыка и эффекты синтезируются (свои, без чужих прав).
Запуск: python tools/promo_memes.py [id ...]  ->  promo/shorts/<id>.mp4"""
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
from promo_sound import SR, kick, lowpass, make_track, whoosh  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT, BRAND = ROOT / "promo" / "reels", ROOT / "promo" / "shorts", ROOT / "promo" / "brand"
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-{}.otf"
EMOJI = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"
W, H, FPS = 1080, 1920, 30
CROP = (92, 602, 988, 1458)          # окно со скриншотом в исходном рилсе
GOLD, RED, GREEN, WHITE, INK = (236, 190, 96), (226, 58, 46), (64, 200, 120), (246, 244, 240), (8, 8, 11)

# id -> формат и тексты. src — отрезок исходного рилса (с, с), где на экране нужное место.
SPECS = {
    "missing": dict(fmt="quiz", src=(2.0, 6.5), q="Undying слил катку. Чего у него НЕ было?",
                    opts=["Rapier", "Glimmer Cape", "Бутылки с маной"], ok=1, after="Бот так и написал: «Не было Glimmer Cape»"),
    "killers": dict(fmt="pov", src=(5.5, 10.5), pov="ты саппорт и думаешь, что Hoodwink тебя не трогал", emoji="💀",
                    after="Hoodwink: 5 089 урона по тебе. Бот считает всё"),
    "fightmap": dict(fmt="nobody", src=(2.2, 8.0), lines=["Никто:", "Абсолютно никто:", "Undying в каждой драке:"], emoji="🗿",
                     after="4 смерти в драках. Бот ставит крестик на каждую"),
    "deathmap": dict(fmt="expect", src=(2.0, 7.5), exp="Я саппорт, стою сзади, меня не поймают", exp_emoji="😇",
                     real_emoji="😭", after="Hoodwink снял 5 089, Slark 2 050. Бот всё посчитал"),
    "phases2": dict(fmt="top3", src=[(2.0, 4.6), (4.2, 6.8), (7.2, 9.8)],
                    items=["Линия: ровно", "Мидгейм: 5 смертей", "Лейт: 10 смертей"], title="3 фазы, где Undying слил катку"),
    "farmzones": dict(fmt="chat", src=(2.0, 7.5), ask="почему у меня нет фарма???", reply="Лейт: 184 крипа, но рядом со своими ты был 17% времени. Вот где ты фармил:"),
    "build2": dict(fmt="error", src=(2.0, 7.0), err="0 из 3 основных предметов", fix="Glimmer Cape сразу после сапог: так у про на этой позиции"),
    "order": dict(fmt="versus", src=(4.5, 10.0), rows=[("BKB", "41:55", "к 30:15"), ("Manta", "не было", "к 20:15"), ("Butterfly", "26:43", "к 33:40")]),
    "lane2": dict(fmt="karaoke", src=(2.0, 10.5), text="Линия 2 на 2 против Nyx. Крипы в плюс, а опыт минус 523 к десятой минуте. Бот видит это по минутам"),
    "early": dict(fmt="quiz", src=(2.4, 4.6), q="Когда про собирают Power Treads на Drow?", opts=["К 6:29", "К 15:00", "Не собирают"], ok=0,
                  after="У про в 100% игр к 6:29. У тебя — 7:31"),
    "deathlist": dict(fmt="counter", src=(3.0, 9.5), n=17, label="смертей за катку", after="Бот разложил каждую: минута, место, причина"),
    "advantage": dict(fmt="pov", src=(1.9, 5.2), pov="команда закамбэчила, а ты не понял, в какой момент", emoji="🤯",
                      after="Бот показывает, где перевернулась катка"),
    "farmzones2": dict(fmt="nobody", src=(4.5, 10.0), lines=["Никто:", "Абсолютно никто:", "Варды на Страже:"], emoji="🙈",
                       after="Обсов на вражеской половине: 0 из 16"),
    "networth": dict(fmt="chat", src=(1.9, 4.4), ask="я керри, я вообще норм нафармил?", reply="Твой нетворс выше, чем у Viper, почти всю катку. Смотри:"),
    "farm2": dict(fmt="karaoke", src=(2.0, 10.5), text="Сколько крипов ты добил за катку? А сколько добивает керри на твоём ранге? Бот рисует обе линии рядом"),
    "draft": dict(fmt="expect", src=(5.5, 10.5), exp="Пикнул имбу из ютуба", exp_emoji="😎", real_emoji="🤡", after="Перед игрой открой драфт в боте"),
    "firsterr": dict(fmt="error", src=(2.0, 6.0), err="10 смертей от Anti-Mage", fix="Стой за спинами своих и купи Ghost Scepter или Solar Crest"),
}
PALETTE = {
    "quiz": ((44, 18, 86), (14, 8, 30), (186, 140, 255)), "pov": ((20, 20, 24), (4, 4, 6), (255, 255, 255)),
    "nobody": ((30, 30, 34), (10, 10, 12), (255, 255, 255)), "expect": ((16, 40, 74), (6, 10, 20), (120, 190, 255)),
    "top3": ((90, 20, 16), (12, 6, 6), GOLD), "chat": ((14, 22, 33), (14, 22, 33), (100, 170, 255)),
    "error": ((60, 0, 0), (6, 0, 0), RED), "versus": ((40, 12, 50), (8, 6, 14), GOLD),
    "karaoke": ((10, 10, 14), (10, 10, 14), (255, 220, 60)), "counter": ((70, 8, 8), (8, 4, 4), RED),
}
CTA_LINES = ["Проверь свою катку", "Кинь Match ID боту", "Узнай, почему слил ты", "Разбор за 10 секунд", "Бесплатно в Телеграме"]


def clamp01(x):
    return max(0.0, min(1.0, x))


def ease(t):
    t = clamp01(t)
    return t * t * (3 - 2 * t)


def back(t, c=1.9):
    t = clamp01(t)
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


_fonts, _emoji = {}, {}


def font(weight, size):
    key = (weight, size)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(FONT.format(weight), size)
    return _fonts[key]


def emoji(ch, size):
    if (ch, size) not in _emoji:
        f = ImageFont.truetype(EMOJI, 109)
        im = Image.new("RGBA", (150, 150), (0, 0, 0, 0))
        ImageDraw.Draw(im).text((10, 10), ch, font=f, embedded_color=True)
        im = im.crop(im.getbbox())
        _emoji[(ch, size)] = im.resize((size, int(size * im.height / im.width)), Image.LANCZOS)
    return _emoji[(ch, size)]


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


def text_block(text, weight, size, color, width=W - 120, align="center", stroke=0, stroke_fill=(0, 0, 0), step=None):
    fnt = font(weight, size)
    lines = wrap(text, fnt, width)
    step = step or int(size * 1.14)
    layer = Image.new("RGBA", (width + 40, step * len(lines) + 30), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i, ln in enumerate(lines):
        tw = d.textlength(ln, font=fnt)
        x = (layer.width - tw) / 2 if align == "center" else 20
        d.text((x, 10 + i * step), ln, font=fnt, fill=color, stroke_width=stroke, stroke_fill=stroke_fill)
    return layer


def put(img, layer, cx, cy, k=1.0, alpha=1.0):
    """Слой по центру (cx, cy) с масштабом k и прозрачностью."""
    if layer is None or k <= 0.02 or alpha <= 0.01:
        return
    if abs(k - 1) > 0.01:
        layer = layer.resize((max(1, int(layer.width * k)), max(1, int(layer.height * k))), Image.BILINEAR)
    if alpha < 0.99:
        layer = layer.copy()
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * alpha)))
    img.alpha_composite(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)))


def pill(text, weight, size, fill, color, pad=(34, 16)):
    fnt = font(weight, size)
    bb = ImageDraw.Draw(Image.new("L", (1, 1))).textbbox((0, 0), text, font=fnt)
    w, h = bb[2] - bb[0] + pad[0] * 2, bb[3] - bb[1] + pad[1] * 2
    layer = Image.new("RGBA", (w + 6, h + 6), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((3, 3, w + 2, h + 2), radius=h // 2, fill=fill)
    d.text((3 + pad[0] - bb[0], 3 + pad[1] - bb[1]), text, font=fnt, fill=color)
    return layer


def bg(c1, c2):
    k = np.linspace(0, 1, H)[:, None, None]
    arr = np.array(c1)[None, None, :] * (1 - k) + np.array(c2)[None, None, :] * k
    return Image.fromarray(np.repeat(arr, W, axis=1).astype(np.uint8), "RGB").convert("RGBA")


def flash(img, a, color=(255, 250, 240)):
    if a > 0.01:
        img.alpha_composite(Image.new("RGBA", (W, H), color + (int(255 * clamp01(a)),)))


class Footage:
    def __init__(self, folder):
        self.folder = folder
        self.n = len(list(folder.glob("s*.png")))

    def at(self, t):
        return Image.open(self.folder / f"s{min(self.n, max(1, int(t * FPS) + 1)):04d}.png").convert("RGB")

    def panel(self, t, width, zoom=1.0, focus=0.5, radius=36, border=None):
        piece = self.at(t)
        cw, ch = piece.width / zoom, piece.height / zoom
        x0 = (piece.width - cw) / 2
        y0 = max(0, min((piece.height - ch) * focus, piece.height - ch))
        piece = piece.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch)))
        h = int(width * piece.height / piece.width)
        piece = piece.resize((width, h), Image.BILINEAR).convert("RGBA")
        mask = Image.new("L", (width, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, h - 1), radius=radius, fill=255)
        out = Image.new("RGBA", (width + 16, h + 16), (0, 0, 0, 0))
        out.paste(piece, (8, 8), mask)
        if border:
            ImageDraw.Draw(out).rounded_rectangle((5, 5, width + 10, h + 10), radius=radius + 3, outline=border, width=5)
        return out


class Short:
    """Общая часть: фон, кадры экрана, финальная плашка, звуковые события."""

    def __init__(self, name, spec, folder, idx):
        self.name, self.spec, self.idx = name, spec, idx
        self.fmt = spec["fmt"]
        self.c1, self.c2, self.accent = PALETTE[self.fmt]
        self.base = bg(self.c1, self.c2)
        self.foot = Footage(folder)
        self.events = []                        # (время, звук, громкость)
        self.seconds = 13.0
        self.cta_at = 10.5
        em = Image.open(BRAND / "avatar.png").convert("RGBA").resize((300, 300), Image.LANCZOS)
        m = Image.new("L", (300, 300), 0)
        ImageDraw.Draw(m).ellipse((0, 0, 299, 299), fill=255)
        em.putalpha(m)
        self.emblem = em
        self.cta_line = CTA_LINES[idx % len(CTA_LINES)]
        getattr(self, f"setup_{self.fmt}")()
        self.events.append((self.cta_at - 0.3, "whoosh", 0.8))
        self.events.append((self.cta_at, "boom", 0.9))

    def src_t(self, k, rng=None):
        a, b = rng or self.spec["src"]
        return a + (b - a) * clamp01(k)

    # финал: два варианта по чётности, чтобы и он не был одинаковым
    def cta(self, img, t):
        k = t - self.cta_at
        img.alpha_composite(Image.new("RGBA", (W, H), (6, 6, 9, int(235 * ease(k / 0.3)))))
        pulse = 1 + 0.03 * math.sin(k * 8)
        if self.idx % 2:
            put(img, self.emblem, W / 2, 620, back(k / 0.5) * pulse)
            put(img, text_block(self.cta_line, "Black", 84, WHITE), W / 2, 920, 1, ease((k - 0.25) / 0.3))
            put(img, pill("@DotaRazbor_bot", "Black", 70, (170, 34, 26), (255, 240, 220)), W / 2, 1080, back((k - 0.45) / 0.4) * pulse)
            put(img, text_block("ссылка в описании", "SemiBold", 40, (170, 168, 178)), W / 2, 1190, 1, ease((k - 0.8) / 0.4))
        else:
            put(img, text_block(self.cta_line.upper(), "Black", 96, self.accent, stroke=4), W / 2, 700, back(k / 0.45))
            put(img, emoji("👇", 150), W / 2, 900 + 18 * math.sin(k * 9), back((k - 0.3) / 0.4))
            put(img, pill("@DotaRazbor_bot", "Black", 74, (255, 255, 255), (20, 20, 24)), W / 2, 1080, back((k - 0.5) / 0.4) * pulse)
            put(img, self.emblem.resize((120, 120)), W / 2, 1260, ease((k - 0.8) / 0.3))

    def frame(self, t):
        img = self.base.copy()
        if t < self.cta_at:
            getattr(self, f"draw_{self.fmt}")(img, t)
        else:
            getattr(self, f"draw_{self.fmt}")(img, self.cta_at - 0.01)
            self.cta(img, t)
        d = ImageDraw.Draw(img)
        d.rectangle((0, H - 8, int(W * t / self.seconds), H), fill=self.accent + (255,))
        return img.convert("RGB")

    # ---------- quiz ----------
    def setup_quiz(self):
        s = self.spec
        self.q = text_block(s["q"], "Black", 78, WHITE)
        self.badge = pill("КВИЗ", "Black", 46, self.accent, (20, 10, 40))
        letters = "ABC"
        self.opts = []
        for i, o in enumerate(s["opts"]):
            self.opts.append([pill(f"{letters[i]}  {o}", "Bold", 54, c, WHITE, pad=(48, 26)) for c in ((60, 40, 110), (30, 140, 80), (120, 30, 30))])
        self.reveal = 5.2
        for i in range(len(self.opts)):
            self.events.append((0.9 + i * 0.35, "pop", 0.6))
        for i in range(3):
            self.events.append((2.2 + i, "tick", 0.8))
        self.events += [(0.0, "boom", 0.7), (self.reveal, "ding", 1.0), (self.reveal + 1.2, "whoosh", 0.7)]
        self.after = text_block(s["after"], "ExtraBold", 50, self.accent)

    def draw_quiz(self, img, t):
        put(img, self.badge, W / 2, 220, back(t / 0.3))
        if t < self.reveal + 1.4:
            put(img, self.q, W / 2, 420, back(t / 0.4))
            for i, o in enumerate(self.opts):
                k = back((t - 0.9 - i * 0.35) / 0.3)
                state = 0 if t < self.reveal else (1 if i == self.spec["ok"] else 2)
                alpha = 1 if state != 2 else 0.45
                put(img, o[state], W / 2, 760 + i * 170, k * (1.08 if state == 1 else 1), alpha)
            if 2.2 <= t < self.reveal:
                left = 3 - int(t - 2.2)
                put(img, text_block(str(max(1, left)), "Black", 200, self.accent), W / 2, 1400, back(((t - 2.2) % 1) / 0.25))
                frac = 1 - (t - 2.2) / 3
                d = ImageDraw.Draw(img)
                d.rounded_rectangle((140, 1580, 140 + int(800 * frac), 1610), radius=15, fill=self.accent + (255,))
            if t >= self.reveal:
                put(img, emoji("✅", 120), W / 2 + 420, 760 + self.spec["ok"] * 170, back((t - self.reveal) / 0.3))
        else:
            k = (t - self.reveal - 1.4) / (self.cta_at - self.reveal - 1.4)
            put(img, self.after, W / 2, 380, 1, ease((t - self.reveal - 1.4) / 0.3))
            put(img, self.foot.panel(self.src_t(k), 960, 1.05 + 0.1 * k, border=self.accent + (255,)), W / 2, 1060, back((t - self.reveal - 1.4) / 0.4))

    # ---------- pov ----------
    def setup_pov(self):
        s = self.spec
        self.typed = "POV: " + s["pov"]
        self.boom_at = 0.4 + len(self.typed) * 0.035 + 0.5
        for i in range(0, len(self.typed), 2):
            self.events.append((0.4 + i * 0.035, "type", 0.35))
        self.events += [(self.boom_at, "vine", 1.0), (self.boom_at + 0.9, "whoosh", 0.6)]
        self.after = text_block(s["after"], "Black", 58, WHITE, stroke=5)

    def draw_pov(self, img, t):
        if t < self.boom_at + 0.9:
            n = int(clamp01((t - 0.4) / (len(self.typed) * 0.035)) * len(self.typed))
            shown = self.typed[:n] + ("|" if int(t * 3) % 2 else "")
            put(img, text_block(shown, "Black", 82, WHITE, align="left"), W / 2, 760)
            if t >= self.boom_at:
                k = t - self.boom_at
                sh = 24 * (1 - clamp01(k / 0.4))
                put(img, emoji(self.spec["emoji"], 420), W / 2 + sh * math.sin(t * 90), 1300, back(k / 0.25, 3))
                flash(img, 0.6 * (1 - k / 0.15), (255, 40, 40))
        else:
            k = (t - self.boom_at - 0.9) / (self.cta_at - self.boom_at - 0.9)
            p = self.foot.panel(self.src_t(k), 1000, 1.1 + 0.15 * ease(k), focus=0.4)
            put(img, p, W / 2, 900, back((t - self.boom_at - 0.9) / 0.35))
            put(img, emoji(self.spec["emoji"], 130), 150, 330, 1)
            put(img, text_block("POV", "Black", 70, WHITE), 300, 330)
            put(img, self.after, W / 2, 1560, back((t - self.boom_at - 1.3) / 0.35))

    # ---------- nobody ----------
    def setup_nobody(self):
        s = self.spec
        self.white = Image.new("RGBA", (W, 760), (250, 250, 250, 255))
        self.lines = [text_block(x, "Bold" if i < 2 else "Black", 62 if i < 2 else 74, (15, 15, 18), align="left", width=W - 340 if i == 2 else W - 140)
                      for i, x in enumerate(s["lines"])]
        self.times = [0.3, 1.1, 1.9]
        self.events += [(x, "pop", 0.5) for x in self.times[:2]] + [(self.times[2], "vine", 1.0), (2.6, "whoosh", 0.5)]
        self.after = text_block(s["after"], "Black", 56, WHITE, stroke=6)

    def draw_nobody(self, img, t):
        img.alpha_composite(self.white, (0, 0))
        for i, (ln, at) in enumerate(zip(self.lines, self.times)):
            if t >= at:
                img.alpha_composite(ln, (50, 150 + i * 150))
        if t >= self.times[2]:
            put(img, emoji(self.spec["emoji"], 190), W - 160, 560, back((t - self.times[2]) / 0.25, 3))
        if t >= 2.5:
            k = (t - 2.5) / (self.cta_at - 2.5)
            p = self.foot.panel(self.src_t(k), 1040, 1.15 + 0.2 * ease(k), focus=0.45, radius=0)
            put(img, p, W / 2, 760 + p.height / 2 - 10, 1)
            if t > 4.5:
                put(img, self.after, W / 2, 1700, back((t - 4.5) / 0.3))

    # ---------- expect ----------
    def setup_expect(self):
        s = self.spec
        self.l1 = pill("ОЖИДАНИЕ", "Black", 54, (40, 110, 200), WHITE)
        self.l2 = pill("РЕАЛЬНОСТЬ", "Black", 54, (200, 40, 40), WHITE)
        self.exp = text_block(s["exp"], "ExtraBold", 64, WHITE)
        self.cut = 3.2
        self.events += [(0.2, "pop", 0.5), (self.cut, "scratch", 1.0), (self.cut + 0.05, "boom", 0.6)]
        self.after = text_block(s["after"], "Black", 56, WHITE, stroke=5)

    def draw_expect(self, img, t):
        put(img, self.l1, W / 2, 140, back(t / 0.3))
        put(img, self.exp, W / 2, 380, 1, ease((t - 0.2) / 0.3))
        put(img, emoji(self.spec["exp_emoji"], 180), W / 2, 620 + 10 * math.sin(t * 3), back((t - 0.5) / 0.3))
        ImageDraw.Draw(img).rectangle((0, 760, W, 768), fill=(255, 255, 255, 255))
        if t >= self.cut:
            k = (t - self.cut) / (self.cta_at - self.cut)
            p = self.foot.panel(self.src_t(k), 900, 1.1 + 0.12 * k, focus=0.45, border=(200, 40, 40, 255))
            put(img, p, W / 2, 1290 + 12 * math.sin(t * 60) * (1 - clamp01((t - self.cut) / 0.3)), 1)
            put(img, self.l2, W / 2, 840, back((t - self.cut) / 0.25))
            put(img, emoji(self.spec["real_emoji"], 170), W - 140, 870, back((t - self.cut - 0.2) / 0.3, 3))
            put(img, self.after, W / 2, 1770, back((t - self.cut - 1.5) / 0.35))
            flash(img, 0.5 * (1 - (t - self.cut) / 0.12), (255, 60, 60))

    # ---------- top3 ----------
    def setup_top3(self):
        s = self.spec
        self.head = text_block(s["title"], "Black", 70, WHITE)
        self.starts = [1.4, 4.4, 7.4]
        self.events += [(0.0, "boom", 0.6)] + [(x, "boom", 1.0) for x in self.starts] + [(x - 0.3, "whoosh", 0.6) for x in self.starts]
        self.items = [text_block(x, "Black", 66, self.accent, stroke=3) for x in s["items"]]

    def draw_top3(self, img, t):
        if t < self.starts[0]:
            put(img, self.head, W / 2, 900, back(t / 0.4))
            return
        i = max(j for j, x in enumerate(self.starts) if t >= x)
        k = t - self.starts[i]
        put(img, self.head.resize((int(self.head.width * 0.6), int(self.head.height * 0.6))), W / 2, 170)
        put(img, text_block(f"#{3 - i}", "Black", 240, WHITE, stroke=8, stroke_fill=self.accent), W / 2, 400, back(k / 0.25, 2.6))
        put(img, self.items[i], W / 2, 590, 1, ease((k - 0.15) / 0.3))
        dur = (self.starts[i + 1] if i < 2 else self.cta_at) - self.starts[i]
        p = self.foot.panel(self.src_t(k / dur, self.spec["src"][i]), 960, 1.05 + 0.1 * ease(k / dur), border=self.accent + (255,))
        put(img, p, W / 2, 1210, back(k / 0.35))
        flash(img, 0.7 * (1 - k / 0.1))

    # ---------- chat ----------
    def setup_chat(self):
        s = self.spec
        self.base = bg((14, 22, 33), (14, 22, 33))
        head = Image.new("RGBA", (W, 170), (23, 33, 43, 255))
        hd = ImageDraw.Draw(head)
        head.alpha_composite(self.emblem.resize((100, 100)), (40, 50))
        hd.text((170, 52), "DotaRazbor", font=font("Bold", 44), fill=WHITE)
        hd.text((170, 104), "бот", font=font("Medium", 32), fill=(110, 140, 170))
        self.head = head
        self.ask = self.bubble(s["ask"], (43, 82, 120))
        self.reply = self.bubble(s["reply"], (24, 37, 51))
        self.t_ask, self.t_type, self.t_reply, self.t_shot = 0.4, 1.3, 2.6, 4.4
        self.events += [(self.t_ask, "pop", 0.8), (self.t_reply, "ding", 0.7), (self.t_shot, "pop", 0.6)]
        for i in range(8):
            self.events.append((0.05 + i * 0.04, "type", 0.25))

    def bubble(self, text, fill):
        fnt = font("Medium", 54)
        lines = wrap(text, fnt, 760)
        h = 66 * len(lines) + 50
        w = int(max(ImageDraw.Draw(Image.new("L", (1, 1))).textlength(x, font=fnt) for x in lines)) + 64
        b = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(b)
        d.rounded_rectangle((0, 0, w - 1, h - 1), radius=30, fill=fill + (255,))
        for i, ln in enumerate(lines):
            d.text((32, 22 + i * 66), ln, font=fnt, fill=WHITE)
        return b

    def draw_chat(self, img, t):
        img.alpha_composite(self.head, (0, 0))
        y = 250
        if t >= self.t_ask:
            k = back((t - self.t_ask) / 0.3)
            put(img, self.ask, W - 50 - self.ask.width / 2, y + self.ask.height / 2, k)
            y += self.ask.height + 30
        if self.t_type <= t < self.t_reply:
            dots = "".join("•" if (int(t * 6) % 3) >= i else " " for i in range(3))
            put(img, self.bubble(f"печатает {dots}", (24, 37, 51)), 50 + 170, y + 50)
        if t >= self.t_reply:
            put(img, self.reply, 50 + self.reply.width / 2, y + self.reply.height / 2, back((t - self.t_reply) / 0.3))
            y += self.reply.height + 30
        if t >= self.t_shot:
            k = (t - self.t_shot) / (self.cta_at - self.t_shot)
            p = self.foot.panel(self.src_t(k), 940, 1.0 + 0.08 * k, radius=30)
            put(img, p, 50 + p.width / 2, y + p.height / 2, back((t - self.t_shot) / 0.3))

    # ---------- error ----------
    def setup_error(self):
        s = self.spec
        self.e1 = text_block("ОШИБКА", "Black", 170, RED)
        self.e2 = text_block(s["err"], "Black", 70, WHITE)
        self.fix_at = 6.4
        self.f1 = pill("✓ ИСПРАВЛЕНИЕ", "Black", 60, (30, 150, 80), WHITE)
        self.f2 = text_block(s["fix"], "ExtraBold", 58, WHITE)
        self.events += [(0.0, "buzz", 1.0), (0.6, "buzz", 0.7), (self.fix_at, "ding", 1.0), (self.fix_at - 0.3, "whoosh", 0.6)]

    def draw_error(self, img, t):
        if t < self.fix_at:
            g = 1 - clamp01(t / 0.8)
            for dx, col in ((-12 * g - 4, (255, 0, 60)), (12 * g + 4, (0, 220, 255))):
                ghost = self.e1.copy()
                ghost.putalpha(ghost.getchannel("A").point(lambda v: int(v * 0.5)))
                tint = Image.new("RGBA", ghost.size, col + (0,))
                tint.putalpha(ghost.getchannel("A"))
                put(img, tint, W / 2 + dx, 300)
            put(img, emoji("⚠️", 150), W / 2, 130, back(t / 0.3))
            put(img, self.e1, W / 2 + (8 * math.sin(t * 80) if t < 0.5 else 0), 300)
            put(img, self.e2, W / 2, 470, back((t - 0.4) / 0.3))
            k = clamp01((t - 1.0) / (self.fix_at - 1.0))
            if t > 1.0:
                p = self.foot.panel(self.src_t(k), 940, 1.08 + 0.1 * k, border=RED + (255,))
                if int(t * 10) % 7 == 0:          # глитч: сдвинутые полосы
                    for _ in range(4):
                        y = np.random.randint(0, p.height - 40)
                        strip = p.crop((0, y, p.width, y + 30))
                        p.paste(strip, (np.random.randint(-30, 30), y))
                put(img, p, W / 2, 1150, back((t - 1.0) / 0.3))
        else:
            k = t - self.fix_at
            put(img, self.f1, W / 2, 360, back(k / 0.3))
            put(img, self.f2, W / 2, 560, 1, ease((k - 0.2) / 0.3))
            p = self.foot.panel(self.src_t(1), 940, 1.15, border=GREEN + (255,))
            put(img, p, W / 2, 1200, 1)
            flash(img, 0.5 * (1 - k / 0.12), (120, 255, 160))

    # ---------- versus ----------
    def setup_versus(self):
        self.base = bg((60, 10, 14), (10, 10, 40))
        self.rows = self.spec["rows"]
        self.events += [(0.3, "boom", 1.0), (0.3, "horn", 0.5)] + [(1.3 + i * 0.9, "pop", 0.7) for i in range(len(self.rows))] + [(4.4, "whoosh", 0.7)]

    def draw_versus(self, img, t):
        d = ImageDraw.Draw(img)
        k = back(t / 0.35)
        put(img, text_block("ТЫ", "Black", 130, (255, 90, 80)), W / 4 - (1 - k) * 400, 200)
        put(img, text_block("ПРО", "Black", 130, (110, 170, 255)), 3 * W / 4 + (1 - k) * 400, 200)
        put(img, text_block("VS", "Black", 110, GOLD, stroke=6), W / 2, 200, back((t - 0.3) / 0.25, 3))
        for i, (item, you, pro) in enumerate(self.rows):
            kk = back((t - 1.3 - i * 0.9) / 0.3)
            if kk <= 0:
                continue
            y = 420 + i * 120
            d.rounded_rectangle((60, y - 48, W - 60, y + 48), radius=24, fill=(0, 0, 0, 140))
            put(img, text_block(you, "Black", 52, (255, 110, 100)), W / 4, y, kk)
            put(img, text_block(item, "Bold", 40, WHITE), W / 2, y, kk)
            put(img, text_block(pro, "Black", 52, (130, 190, 255)), 3 * W / 4, y, kk)
        if t > 4.4:
            kk = (t - 4.4) / (self.cta_at - 4.4)
            put(img, self.foot.panel(self.src_t(kk), 940, 1.05 + 0.1 * kk, border=GOLD + (255,)), W / 2, 1300, back((t - 4.4) / 0.35))

    # ---------- karaoke ----------
    def setup_karaoke(self):
        words = self.spec["text"].split()
        self.chunks = [" ".join(words[i:i + 3]) for i in range(0, len(words), 3)]
        self.step = (self.cta_at - 0.4) / len(self.chunks)
        self.events += [(0.4 + i * self.step, "pop", 0.45) for i in range(len(self.chunks))]

    def draw_karaoke(self, img, t):
        k = t / self.cta_at
        i = min(len(self.chunks) - 1, max(0, int((t - 0.4) / self.step)))
        local = (t - 0.4 - i * self.step) / self.step
        z = 1.15 + 0.12 * ((i % 2) * 2 - 1) * ease(local)       # наезд/отъезд на каждой фразе
        full = self.foot.panel(self.src_t(k), W, z, focus=0.35 + 0.1 * (i % 3), radius=0)
        blurred = full.resize((W // 8, full.height // 8)).resize((W, H)).filter(ImageFilter.GaussianBlur(4))
        img.alpha_composite(blurred)
        img.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 110)))
        put(img, full, W / 2, H / 2 - 120)
        if t >= 0.4:
            put(img, text_block(self.chunks[i].upper(), "Black", 96, (255, 220, 60) if i % 2 else WHITE, stroke=8), W / 2, 1520, back(local / 0.18, 2.4))

    # ---------- counter ----------
    def setup_counter(self):
        n = self.spec["n"]
        self.ticks = [0.6 + 3.6 * (1 - (1 - j / n) ** 1.6) for j in range(1, n + 1)]
        self.events += [(x, "tick", 0.7) for x in self.ticks] + [(self.ticks[-1] + 0.2, "vine", 1.0), (5.2, "whoosh", 0.6)]
        self.label = text_block(self.spec["label"], "Black", 64, WHITE)
        self.after = text_block(self.spec["after"], "ExtraBold", 52, self.accent)

    def draw_counter(self, img, t):
        cnt = sum(1 for x in self.ticks if t >= x)
        if t < 5.4:
            last = max([x for x in self.ticks if t >= x], default=0)
            put(img, text_block(str(cnt), "Black", 420, WHITE, stroke=10, stroke_fill=RED), W / 2, 800, 1 + 0.15 * (1 - clamp01((t - last) / 0.12)))
            put(img, self.label, W / 2, 1120)
            if t >= self.ticks[-1] + 0.2:
                put(img, emoji("💀", 260), W / 2, 1420, back((t - self.ticks[-1] - 0.2) / 0.25, 3))
        else:
            k = (t - 5.4) / (self.cta_at - 5.4)
            put(img, text_block(str(cnt), "Black", 130, WHITE), W / 2 - 70, 230)
            put(img, emoji("💀", 110), W / 2 + 90, 235)
            put(img, self.after, W / 2, 400, 1, ease((t - 5.4) / 0.3))
            put(img, self.foot.panel(self.src_t(k), 960, 1.05 + 0.1 * k, border=RED + (255,)), W / 2, 1120, back((t - 5.4) / 0.35))


def sfx(kind, rng):
    n = lambda s: np.arange(int(s * SR)) / SR  # noqa: E731
    if kind == "boom":
        return kick() + lowpass(rng.standard_normal(len(kick())), 0.04) * 0.5
    if kind == "vine":                         # глухой «бум» с падением высоты и перегрузом
        t = n(1.1)
        f = 70 * np.exp(-t * 1.5) + 38
        return np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6) * 3.5)
    if kind == "whoosh":
        return whoosh(rng, 0.35)
    if kind == "pop":
        t = n(0.09)
        return np.sin(2 * np.pi * (900 - 4000 * t) * t) * np.exp(-t * 45)
    if kind == "tick":
        t = n(0.04)
        return np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 120)
    if kind == "type":
        t = n(0.02)
        return rng.standard_normal(len(t)) * np.exp(-t * 300) * 0.6
    if kind == "ding":
        t = n(1.0)
        return (np.sin(2 * np.pi * 1318 * t) + 0.6 * np.sin(2 * np.pi * 1760 * t)) * np.exp(-t * 4) * 0.6
    if kind == "buzz":
        t = n(0.45)
        return np.sign(np.sin(2 * np.pi * 110 * t)) * 0.45 * np.minimum(1, (0.45 - t) * 20)
    if kind == "scratch":                       # «скретч» пластинки: шум с качающимся фильтром
        t = n(0.5)
        noise = rng.standard_normal(len(t))
        wob = 0.05 + 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * 9 * t))
        out, acc = np.empty(len(t)), 0.0
        for i in range(len(t)):
            acc += wob[i] * (noise[i] - acc)
            out[i] = acc
        return out * 1.6 * np.exp(-t * 3)
    if kind == "horn":
        t = n(0.6)
        s = sum(2 * ((t * f) % 1) - 1 for f in (349, 440, 523))
        return lowpass(s / 3, 0.2) * np.minimum(1, (0.6 - t) * 10)
    raise ValueError(kind)


def sound(short, path, seed):
    tmp = Path(path).with_suffix(".m.wav")
    make_track(tmp, short.seconds, seed)
    with wave.open(str(tmp)) as w:
        music = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2).astype(float) / 32767
    tmp.unlink()
    n = int(short.seconds * SR)
    music = np.pad(music, ((0, max(0, n - len(music))), (0, 0)))[:n]
    fx = np.zeros(n)
    rng = np.random.default_rng(seed)
    for at, kind, gain in short.events:
        sig = sfx(kind, rng)
        s = int(max(0, at) * SR)
        e = min(n, s + len(sig))
        if s < n:
            fx[s:e] += sig[: e - s] * gain
    gain = np.ones(n) * (0.55 if short.fmt in ("quiz", "chat", "counter") else 0.7)
    mix = music * gain[:, None] + fx[:, None]
    mix = np.tanh(mix * 1.15)
    mix = mix / np.max(np.abs(mix)) * 0.89
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())


def make(name):
    idx = list(SPECS).index(name)
    OUT.mkdir(parents=True, exist_ok=True)
    np.random.seed(idx)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        x0, y0, x1, y1 = CROP
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(SRC / f"{name}.mp4"), "-vf", f"crop={x1 - x0}:{y1 - y0}:{x0}:{y0}", "-r", str(FPS),
                        str(tmp / "s%04d.png")], check=True)
        short = Short(name, SPECS[name], tmp, idx)
        wav = tmp / "sound.wav"
        sound(short, wav, idx + 5)
        enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                                "-i", str(wav), "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-profile:v", "high",
                                "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-shortest", str(OUT / f"{name}.mp4")], stdin=subprocess.PIPE)
        for i in range(int(FPS * short.seconds)):
            enc.stdin.write(short.frame(i / FPS).tobytes())
        enc.stdin.close()
        if enc.wait():
            raise RuntimeError(f"ffmpeg упал на {name}")
    return name


if __name__ == "__main__":
    names = sys.argv[1:] or list(SPECS)
    with ProcessPoolExecutor() as pool:
        for n in pool.map(make, names):
            print("готово", n)
