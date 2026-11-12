# Моушн-ролики (плагин Motion Reel)

Каждый ролик — папка с `film.js`: кадр — чистая функция времени, 3D на three.js, бит и звуки синтезируются в коде.

- `spirit3/` — «Три Аегиса Spirit», первая версия (9:16, 22 с, 120 BPM). 3D-Аегис — та же геометрия и текстуры, что на главной (`docs/aegis.js`), телефон показывает настоящие экраны Mini App.
- Серия из 14 роликов на общем ките `common/` (шрифты, three.js-сеты: Аегис, телефон с экранами приложения, 3D-буквы; `kit.js` — типографика, карточки, эффекты, вставка про бота; `score.py` — бит):
  `spirit` (Spirit v2), `champs`, `prize`, `patch`, `horror`, `tier`, `guess`, `ranks`, `mapfails`, `habits`, `support`, `botshow`, `dilemma`, `hours`.
  Сетка у всех одна: хук 0–2 с, контент 2–12 с, вставка про бота 12–15 с, добивка 15–18 с, концовка с призывом в комменты 18–22 с.
- `reklama/` — реклама бота (9:16, 32 с, озвучка Vosk голос 3): 3-D буквы «ОПЯТЬ СЛИЛ?», телефон с полем для ID матча ныряет экраном в камеру, полёт камеры по галерее настоящих экранов (`reklama/gallery.js`: оценка, «Кто слил», Реплей, живая карта, кадры видеоразбора, тренер), 3-D «БЕСПЛАТНО» и финал. Озвучка: `python3 ../../tools/video/tts.py reklama/audio/script.json reklama/audio/sp3 --speaker 3 --tempo 1.08`, потом `python3 reklama/audio/vo_place.py` (из `reklama/`); бит `reklama/audio/score.py`.
- `new.sh <slug> "<title>"` — новая папка ролика, `render_full.sh <slug>` — картинка, звук, сведение и сжатие до ~16 МБ (6 Мбит/с), `render_queue.sh` — рендер по списку из `out/queue.txt`.
- `meta.py queue` дописывает ролики в `promo/yt_queue.json` (по 2 в день с 6.11), `meta.py insta` собирает пак с подписями для Инсты.

Сборка (из `promo/motion`, нужен скилл motion-reel, `npm i three opentype.js`):

```
MOTION_REEL_SKILL=<skill> uv run spirit3/audio/score.py      # бит + beats.json
node <skill>/scripts/render.mjs --film spirit3 --format 9x16 --fps 30 --video-only
node <skill>/scripts/sfx.mjs spirit3 && node <skill>/scripts/mix.mjs spirit3
```

Готовый файл держать ≤24 МБ (TikTok режет большие).
