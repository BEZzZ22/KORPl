"""Картинки для постов канала из настоящих скриншотов мини-аппа (4:5, 1080x1350): заголовок и кусок экрана.
Скриншоты берём из tests/ui/live: node tools/ui-live.mjs <match_id> overview,deaths,map,build и node tools/ui-live.mjs 0 home.
Запуск: python tools/promo_images.py <match_id>   -> promo/img/*.jpg
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LIVE, OUT = ROOT / "tests" / "ui" / "live", ROOT / "promo" / "img"
FONT = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
W, H, SHOT_W = 1080, 1350, 880
GOLD, TEXT, MUTED = (240, 200, 110), (240, 240, 245), (150, 152, 165)

# имя -> (экран, откуда резать по высоте исходника, заголовок, подзаголовок)
CARDS = {
    "launch": ("overview", 40, "Почему ты слил катку?", "Кинь Match ID и получи главную ошибку"),
    "items": ("build", 1100, "Что собирать против их пика", "По про-матчам этого патча"),
    "coach": ("overview", 1735, "ИИ-тренер разбирает смерти", "5 разборов и 5 вопросов в сутки бесплатно"),
    "mistake": ("deaths", 1060, "Где ты умираешь чаще всего", "Бот находит повторы сам"),
    "aegis": ("home", 0, "Аегис крутится пальцем", "Мини-апп прямо в Телеграме"),
    "mmr": ("map", 1100, "Где ты был на карте", "Варды, смерти и зоны"),
    "turbo": ("home", 1050, "Турбо разбираем отдельно", "Свои нормы, а не обычка"),
    "review": ("overview", 2230, "Что было не так в катке", "Главные ошибки и что делать дальше"),
    "lane": ("phases", 1090, "Линия против оппонента", "Крипы, золото и опыт по минутам"),
    "phases": ("phases", 2130, "Катка по фазам", "Линия, мидгейм и лейт отдельно"),
    "killers": ("deaths", 2150, "Кто тебя убивал", "Чем убили и что можно было сделать"),
    "deathmap": ("deaths", 2935, "Где ты умирал", "Точки на карте перед каждой смертью"),
    "farmzones": ("map", 2260, "Где ты добивал крипов", "Линия, лес и зоны карты"),
    "order": ("build", 1890, "Порядок предметов", "Что купил ты и что у про"),
    "early": ("build", 2530, "Ранняя игра по предметам", "Что брал про и когда"),
    "advantage": ("charts", 1200, "Преимущество команды", "Золото и опыт по минутам"),
    "networth": ("charts", 1980, "Нетворс против оппонента", "Кто кого обгонял и когда"),
    "farm": ("charts", 2620, "Добито крипов", "Твой фарм против нормы ранга"),
    "draft": ("home", 800, "Драфт перед игрой", "Кого пикнуть и что собирать"),
}


def wrap(draw, text, font, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


def card(shot, top, title, sub):
    bg = Image.new("RGB", (W, H), (11, 12, 16))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse((-200, -420, 760, 380), fill=(95, 66, 18))
    bg = Image.composite(glow.filter(ImageFilter.GaussianBlur(160)), bg, glow.filter(ImageFilter.GaussianBlur(160)).convert("L"))
    d = ImageDraw.Draw(bg)
    f_title, f_sub, f_foot = (ImageFont.truetype(FONT.format("ExtraBold"), 78), ImageFont.truetype(FONT.format("SemiBold"), 38),
                              ImageFont.truetype(FONT.format("Bold"), 34))
    y = 70
    for line in wrap(d, title, f_title, W - 140):
        d.text((70, y), line, font=f_title, fill=TEXT)
        y += 92
    d.text((70, y + 6), sub, font=f_sub, fill=GOLD)
    top_y = y + 90
    room = H - top_y - 90
    crop_h = int(room * shot.width / SHOT_W)
    piece = shot.crop((0, top, shot.width, min(top + crop_h, shot.height))).convert("RGB")
    piece = piece.resize((SHOT_W, int(piece.height * SHOT_W / piece.width)), Image.LANCZOS)
    mask = Image.new("L", piece.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, piece.width, piece.height), radius=38, fill=255)
    x = (W - SHOT_W) // 2
    d.rounded_rectangle((x - 3, top_y - 3, x + piece.width + 3, top_y + piece.height + 3), radius=41, outline=(70, 62, 40), width=3)
    bg.paste(piece, (x, top_y), mask)
    d.text((70, H - 70), "t.me/DotaRazbor_bot", font=f_foot, fill=MUTED)
    return bg


def main(match):
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (screen, top, title, sub) in CARDS.items():
        src = LIVE / ("0" if screen == "home" else str(match)) / f"{screen}.png"
        card(Image.open(src), top, title, sub).save(OUT / f"{name}.jpg", quality=88, optimize=True)
        print("готово", name)


if __name__ == "__main__":
    main(int(sys.argv[1]))
