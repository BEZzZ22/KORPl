"""Рилсы 9:16 (1080x1920, 14 с) из настоящих скриншотов мини-аппа: заголовок, плавная прокрутка экрана, финальная плашка.
Скриншоты: HIDE_NAV=1 OPEN=1 node tools/ui-live.mjs <match_id> overview,phases,deaths,map,build,charts; node tools/ui-live.mjs 0 home.
Запуск: python tools/promo_reels.py <match_id>  ->  promo/reels/<id>.mp4 и <id>.jpg (обложка). Нужен ffmpeg."""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LIVE, OUT = ROOT / "tests" / "ui" / "live", ROOT / "promo" / "reels"
FONT = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
W, H, FPS, SECONDS = 1080, 1920, 30, 14
SHOT_W, WIN_H = 940, 1180
GOLD, TEXT, MUTED = (240, 200, 110), (240, 240, 245), (150, 152, 165)

# id -> (экран, откуда в исходнике, насколько прокрутить, заголовок, подзаголовок)
REELS = {
    "review": ("overview", 2230, 1500, "Почему ты слил катку?", "Бот показывает главные ошибки"),
    "lane": ("phases", 1090, 700, "Линия против оппонента", "Крипы, золото и опыт по минутам"),
    "killers": ("deaths", 2150, 1500, "Кто тебя убивал", "Чем убили и что можно было сделать"),
    "deathmap": ("deaths", 2935, 900, "Где ты умираешь", "Карта смертей по катке"),
    "farmzones": ("map", 2260, 700, "Где ты фармишь", "Линия, лес и зоны карты"),
    "order": ("build", 1890, 1100, "Порядок предметов", "Ты против про"),
    "early": ("build", 2530, 1300, "Ранняя игра", "Что брал про и когда"),
    "advantage": ("charts", 1200, 700, "Где перевернулась катка", "Золото и опыт по минутам"),
    "networth": ("charts", 1980, 800, "Кто кого обгонял", "Нетворс против оппонента"),
    "draft": ("home", 800, 1000, "Что собирать против пика", "Драфт перед игрой"),
}


def ease(t):
    return t * t * (3 - 2 * t)


def background(title, sub):
    bg = Image.new("RGB", (W, H), (11, 12, 16))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse((-300, -500, 900, 500), fill=(95, 66, 18))
    glow = glow.filter(ImageFilter.GaussianBlur(180))
    bg = Image.composite(glow, bg, glow.convert("L"))
    d = ImageDraw.Draw(bg)
    f_title, f_sub, f_foot = (ImageFont.truetype(FONT.format("ExtraBold"), 88), ImageFont.truetype(FONT.format("SemiBold"), 42),
                              ImageFont.truetype(FONT.format("Bold"), 40))
    y = 150
    words, line, lines = title.split(), "", []
    for w in words:
        trial = f"{line} {w}".strip()
        if d.textlength(trial, font=f_title) <= W - 140 or not line:
            line = trial
        else:
            lines.append(line)
            line = w
    lines.append(line)
    for ln in lines:
        d.text((70, y), ln, font=f_title, fill=TEXT)
        y += 104
    d.text((70, y + 10), sub, font=f_sub, fill=GOLD)
    d.text((70, H - 150), "Бот: @DotaRazbor_bot", font=f_foot, fill=MUTED)
    return bg, y + 110


def frame(bg, top_y, shot, start, scroll, t):
    img = bg.copy()
    off = int(start + scroll * ease(min(1, max(0, (t - 1.5) / (SECONDS - 4.5)))))   # 1,5 с стоит, 9,5 с едет, 3 с стоит в конце
    off = min(off, max(0, shot.height - int(WIN_H * shot.width / SHOT_W)))
    crop_h = int(WIN_H * shot.width / SHOT_W)
    piece = shot.crop((0, off, shot.width, off + crop_h)).convert("RGB").resize((SHOT_W, WIN_H), Image.LANCZOS)
    mask = Image.new("L", piece.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SHOT_W, WIN_H), radius=42, fill=255)
    x = (W - SHOT_W) // 2
    ImageDraw.Draw(img).rounded_rectangle((x - 3, top_y - 3, x + SHOT_W + 3, top_y + WIN_H + 3), radius=45, outline=(70, 62, 40), width=3)
    img.paste(piece, (x, top_y), mask)
    return img


def make(match, name):
    screen, start, scroll, title, sub = REELS[name]
    shot = Image.open(LIVE / ("0" if screen == "home" else str(match)) / f"{screen}.png")
    bg, top_y = background(title, sub)
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(FPS * SECONDS):
            frame(bg, top_y, shot, start, scroll, i / FPS).save(Path(tmp) / f"f{i:04d}.jpg", quality=92)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(Path(tmp) / "f%04d.jpg"),
                        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest", "-c:v", "libx264", "-preset", "medium", "-crf", "24",
                        "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "64k", str(OUT / f"{name}.mp4")],
                       check=True)
    frame(bg, top_y, shot, start, scroll, 0).save(OUT / f"{name}.jpg", quality=90)
    print("готово", name)


if __name__ == "__main__":
    match = int(sys.argv[1])
    for n in (sys.argv[2:] or REELS):
        make(match, n)
