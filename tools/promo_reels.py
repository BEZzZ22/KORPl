"""Рилсы 9:16 (1080x1920, 15 с) из настоящих скриншотов мини-аппа: анимированный заголовок, плавная прокрутка экрана в «телефонной» рамке,
плашки-аргументы, золотые искры на тёмном фоне, финальная плашка с Аегисом и ботом, своя музыка (tools/promo_sound.py).
Безопасные зоны Инстаграма соблюдены: верх 250 и низ 380 пикселей оставлены под интерфейс.
Скриншоты: HIDE_NAV=1 OPEN=1 node tools/ui-live.mjs <match_id> overview,phases,deaths,map,build,charts; node tools/ui-live.mjs 0 home.
Запуск: python tools/promo_reels.py <match_id> [id ...]  ->  promo/reels/<id>.mp4 и <id>.jpg (обложка). Нужен ffmpeg."""
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from promo_sound import make_track  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LIVE, OUT = ROOT / "tests" / "ui" / "live", ROOT / "promo" / "reels"
FONT = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
W, H, FPS, SECONDS = 1080, 1920, 30, 15
SHOT_W, WIN_H, WIN_Y = 900, 860, 600
GOLD, TEXT, MUTED = (240, 200, 110), (244, 244, 248), (160, 162, 175)
END_AT = 12.0

# id -> (экран, откуда в исходнике, насколько прокрутить, заголовок, подзаголовок, плашки[, id матча])
REELS = {
    "review": ("overview", 2230, 1500, "Почему ты слил катку?", "Бот показывает главные ошибки", ["Бесплатно", "Без регистрации", "По Match ID"]),
    "lane": ("phases", 1090, 700, "Линия против оппонента", "Крипы, золото и опыт по минутам", ["Видно минуту провала", "Сравнение с оппонентом", "Нормы твоего ранга"]),
    "killers": ("deaths", 2150, 1500, "Кто тебя убивал", "Чем убили и что можно было сделать", ["Урон по героям", "Что пробивает BKB", "Советы по смертям"]),
    "deathmap": ("deaths", 2935, 900, "Где ты умираешь", "Карта смертей по катке", ["Точки на карте", "Видимость вардов", "Повторы по катке"]),
    "farmzones": ("map", 2260, 700, "Где ты фармишь", "Линия, лес и зоны карты", ["Фарм по зонам", "Линия и лес", "Где потерял крипов"]),
    "order": ("build", 1890, 1100, "Порядок предметов", "Ты против про", ["Ты и про по времени", "Что купил раньше", "Что не собрал"]),
    "early": ("build", 2530, 1300, "Ранняя игра", "Что брал про и когда", ["Старт и ранние предметы", "Время покупки", "Как часто берут"]),
    "advantage": ("charts", 1200, 700, "Где перевернулась катка", "Золото и опыт по минутам", ["Золото и опыт", "Метки: вышки, Рошан", "Твои смерти на графике"]),
    "networth": ("charts", 1980, 800, "Кто кого обгонял", "Нетворс против оппонента", ["Нетворс по минутам", "Готовые предметы", "Точка перелома"]),
    "draft": ("home", 800, 1000, "Что собирать против пика", "Драфт перед игрой", ["Про-матчи патча", "Пять врагов — готовая сборка", "Бесплатно"]),
    "repeat": ("deaths", 1460, 1100, "Что повторилось в смертях", "Бот находит твои повторы", ["Повторы по катке", "Цель на следующую игру", "Без регистрации"], 9054284490),
    "missing": ("overview", 2690, 1300, "Что надо было собрать", "Бот называет предмет и почему", ["Совет под твой пик", "У про на позиции", "Что делать"], 9054284490),
    "fightmap": ("map", 1500, 900, "Где умирал в драках", "Точки на карте", ["Красные точки", "Район смертей", "Видимость"], 9054284490),
    "phases2": ("phases", 2110, 1300, "Три фазы катки", "Линия, мидгейм и лейт", ["Вердикт по фазе", "Убийства и смерти", "Нетворс"], 9054284490),
    "farmzones2": ("map", 2570, 700, "Где стояли варды", "Видимость команды", ["Варды и сентри", "Где была видимость", "Без видимости умираешь"], 9054284490),
    "build2": ("build", 1120, 1000, "Главное по сборке", "Чего не было в твоей сборке", ["Под этот пик", "Про-данные патча", "Что взять раньше"], 9054284490),
    "lane2": ("phases", 1100, 800, "Проигранная линия", "Когда и почему ушёл в минус", ["Минута провала", "Крипы и опыт", "Что менять"], 9054284490),
    "deathlist": ("deaths", 2230, 1400, "Все смерти по порядку", "Минута, место и причина", ["Минута и место", "В драке или один", "Есть ли видимость"], 9054284490),
    "firsterr": ("overview", 2380, 1500, "Частые смерти от одного героя", "И что с этим делать", ["Кто убивает чаще всего", "Что делать", "Советы бота"], 9054284490),
    "farm2": ("charts", 2730, 500, "Твой фарм против нормы", "Где ты отстал по минутам", ["Норма твоего ранга", "Минута отставания", "Фарм по времени"], 9054284490),
}


def clamp01(x):
    return max(0.0, min(1.0, x))


def ease(t):
    t = clamp01(t)
    return t * t * (3 - 2 * t)


def out_back(t):
    t = clamp01(t)
    c = 1.70158
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def font(weight, size):
    return ImageFont.truetype(FONT.format(weight), size)


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


class Scene:
    """Всё, что можно посчитать один раз: фон, тень, текст, аватар."""

    def __init__(self, shot, title, sub, chips, start, scroll, seed):
        self.shot, self.title, self.sub, self.chips, self.start, self.scroll = shot, title, sub, chips, start, scroll
        rng = np.random.default_rng(seed)
        base = Image.new("RGB", (W, H), (9, 10, 15))
        blob = Image.new("RGB", (W + 400, H + 400), (0, 0, 0))
        d = ImageDraw.Draw(blob)
        d.ellipse((60, 60, 720, 720), fill=(105, 72, 20))
        d.ellipse((480, 900, 1200, 1620), fill=(90, 28, 24))
        self.blob = blob.filter(ImageFilter.GaussianBlur(170))
        self.base = base
        shadow = Image.new("L", (SHOT_W + 160, WIN_H + 160), 0)
        ImageDraw.Draw(shadow).rounded_rectangle((80, 90, 80 + SHOT_W, 90 + WIN_H), radius=46, fill=190)
        self.shadow = shadow.filter(ImageFilter.GaussianBlur(34))
        self.mask = Image.new("L", (SHOT_W, WIN_H), 0)
        ImageDraw.Draw(self.mask).rounded_rectangle((0, 0, SHOT_W, WIN_H), radius=40, fill=255)
        self.sparks = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.2, 3.4), rng.uniform(60, 190), rng.uniform(0, 6.28)) for _ in range(55)]
        avatar = Image.open(ROOT / "promo" / "avatar.png").convert("RGB").resize((330, 330), Image.LANCZOS)
        circle = Image.new("L", (330, 330), 0)
        ImageDraw.Draw(circle).ellipse((0, 0, 329, 329), fill=255)
        self.avatar, self.circle = avatar, circle
        tmp = ImageDraw.Draw(Image.new("RGB", (10, 10)))
        self.f_title, self.f_sub = font("ExtraBold", 84), font("SemiBold", 40)
        self.f_chip, self.f_end, self.f_end2, self.f_small = font("Bold", 38), font("ExtraBold", 92), font("SemiBold", 44), font("Bold", 34)
        self.title_lines = wrap(tmp, title, self.f_title, W - 150)

    def background(self, t):
        ox, oy = int(180 + 70 * math.sin(t * 0.7)), int(180 + 60 * math.cos(t * 0.55))
        img = Image.blend(self.base, self.blob.crop((ox, oy, ox + W, oy + H)), 0.9)
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dl = ImageDraw.Draw(layer)
        for x, y, r, speed, ph in self.sparks:
            yy = (y - speed * t) % H
            a = int(90 + 90 * math.sin(t * 2.2 + ph))
            dl.ellipse((x - r, yy - r, x + r, yy + r), fill=(255, 214, 120, max(25, a)))
        layer = layer.filter(ImageFilter.GaussianBlur(1.1))
        img = img.convert("RGBA")
        img.alpha_composite(layer)
        return img

    def frame(self, t):
        img = self.background(t)
        d = ImageDraw.Draw(img)
        # заголовок: выезжает снизу с прозрачностью, затем подзаголовок и золотая линия
        y0 = 270
        k = ease((t - 0.1) / 0.7)
        for i, ln in enumerate(self.title_lines):
            kk = ease((t - 0.1 - i * 0.12) / 0.7)
            ov = Image.new("RGBA", (W, 130), (0, 0, 0, 0))
            ImageDraw.Draw(ov).text((75, 8), ln, font=self.f_title, fill=TEXT + (int(255 * kk),))
            img.alpha_composite(ov, (0, int(y0 + i * 100 + (1 - kk) * 46)))
        yb = y0 + len(self.title_lines) * 100 + 8
        ks = ease((t - 0.5) / 0.6)
        ov = Image.new("RGBA", (W, 70), (0, 0, 0, 0))
        ImageDraw.Draw(ov).text((75, 6), self.sub, font=self.f_sub, fill=GOLD + (int(255 * ks),))
        img.alpha_composite(ov, (0, int(yb + (1 - ks) * 24)))
        line_w = int(280 * ease((t - 0.8) / 0.6))
        d.rounded_rectangle((75, yb + 62, 75 + line_w, yb + 68), radius=3, fill=GOLD)
        # окно со скриншотом: плавный въезд, прокрутка, лёгкий зум
        kin = out_back((t - 0.4) / 0.9)
        scroll_t = ease((t - 1.8) / (END_AT - 2.6))
        zoom = 1.0 + 0.045 * ease((t - 1.0) / (END_AT - 1.0))
        crop_w = self.shot.width / zoom
        crop_h = WIN_H * crop_w / SHOT_W
        off = self.start + self.scroll * scroll_t
        off = max(0, min(off, self.shot.height - crop_h))
        x0 = (self.shot.width - crop_w) / 2
        piece = self.shot.crop((int(x0), int(off), int(x0 + crop_w), int(off + crop_h))).convert("RGB").resize((SHOT_W, WIN_H), Image.LANCZOS)
        wx, wy = (W - SHOT_W) // 2, WIN_Y + int((1 - kin) * 220)
        alpha = clamp01((t - 0.3) / 0.5)
        sh = self.shadow.point(lambda v: int(v * alpha))
        img.paste((0, 0, 0), (wx - 80, wy - 90 + 30), sh)
        mask = self.mask.point(lambda v: int(v * alpha))
        img.paste(piece, (wx, wy), mask)
        ImageDraw.Draw(img).rounded_rectangle((wx - 2, wy - 2, wx + SHOT_W + 2, wy + WIN_H + 2), radius=42, outline=(120, 100, 50, int(255 * alpha)), width=3)
        # плашки-аргументы: выскакивают по очереди
        cy = WIN_Y + WIN_H + 50
        for i, text in enumerate(self.chips):
            ti = 2.8 + i * 2.6
            kc = out_back((t - ti) / 0.45)
            if kc <= 0:
                continue
            tw = d.textlength(text, font=self.f_chip)
            cw, ch = int(tw + 70), 74
            px = (W - cw) // 2
            py = cy + i * 0 + int((1 - min(1, kc)) * 30)
            ov = Image.new("RGBA", (cw + 4, ch + 4), (0, 0, 0, 0))
            od = ImageDraw.Draw(ov)
            a = int(255 * clamp01(kc))
            od.rounded_rectangle((2, 2, cw, ch), radius=37, fill=(36, 30, 14, int(a * 0.92)), outline=GOLD + (a,), width=3)
            od.text((35, 14), text, font=self.f_chip, fill=GOLD + (a,))
            fade_out = 1 - clamp01((t - (ti + 2.4)) / 0.3) if i < len(self.chips) - 1 else 1
            if fade_out < 1:
                ov.putalpha(ov.getchannel("A").point(lambda v: int(v * fade_out)))
            img.alpha_composite(ov, (px, py))
        # финальная плашка
        ke = ease((t - END_AT) / 0.5)
        if ke > 0:
            scrim = Image.new("RGBA", (W, H), (7, 8, 12, int(252 * ke)))
            img.alpha_composite(scrim)
            ks2 = out_back((t - END_AT - 0.1) / 0.7)
            sz = max(10, int(330 * ks2))
            av = self.avatar.resize((sz, sz), Image.LANCZOS)
            cm = self.circle.resize((sz, sz), Image.LANCZOS)
            img.paste(av, ((W - sz) // 2, 560 + (330 - sz) // 2), cm)
            de = ImageDraw.Draw(img)
            for txt, fnt, yy, col, dl in (("DotaRazbor", self.f_end, 940, TEXT, 0.3), ("Разбор катки Dota 2 за секунды", self.f_end2, 1060, GOLD, 0.5),
                                          ("Бот в Телеграме: @DotaRazbor_bot", self.f_small, 1150, MUTED, 0.7), ("Ссылка в шапке профиля", self.f_small, 1200, MUTED, 0.85)):
                kt = ease((t - END_AT - dl) / 0.4)
                if kt <= 0:
                    continue
                ov = Image.new("RGBA", (W, 130), (0, 0, 0, 0))
                tw = de.textlength(txt, font=fnt)
                ImageDraw.Draw(ov).text(((W - tw) / 2, 4), txt, font=fnt, fill=col + (int(255 * kt),))
                img.alpha_composite(ov, (0, int(yy + (1 - kt) * 20)))
        return img.convert("RGB")


def make(match, name, seed=None):
    screen, start, scroll, title, sub, chips, *own = REELS[name]
    match = own[0] if own else match
    shot = Image.open(LIVE / ("0" if screen == "home" else str(match)) / f"{screen}.png")
    idx = list(REELS).index(name)
    scene = Scene(shot, title, sub, chips, start, scroll, seed or idx + 11)
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "music.wav"
        make_track(wav, SECONDS, idx + 1)
        for i in range(FPS * SECONDS):
            scene.frame(i / FPS).save(Path(tmp) / f"f{i:04d}.jpg", quality=93)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(Path(tmp) / "f%04d.jpg"), "-i", str(wav),
                        "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart",
                        "-c:a", "aac", "-b:a", "160k", "-shortest", str(OUT / f"{name}.mp4")], check=True)
    scene.frame(3.4).save(OUT / f"{name}.jpg", quality=90)
    print("готово", name)


if __name__ == "__main__":
    match = int(sys.argv[1])
    for n in (sys.argv[2:] or REELS):
        make(match, n)
