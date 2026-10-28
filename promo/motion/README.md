# Моушн-ролики (плагин Motion Reel)

Каждый ролик — папка с `film.js`: кадр — чистая функция времени, 3D на three.js, бит и звуки синтезируются в коде.

- `spirit3/` — «Три Аегиса Spirit» (9:16, 22 с, 120 BPM). 3D-Аегис — та же геометрия и текстуры, что на главной (`docs/aegis.js`), телефон показывает настоящие экраны Mini App.

Сборка (из `promo/motion`, нужен скилл motion-reel, `npm i three opentype.js`):

```
MOTION_REEL_SKILL=<skill> uv run spirit3/audio/score.py      # бит + beats.json
node <skill>/scripts/render.mjs --film spirit3 --format 9x16 --fps 30 --video-only
node <skill>/scripts/sfx.mjs spirit3 && node <skill>/scripts/mix.mjs spirit3
```

Готовый файл держать ≤24 МБ (TikTok режет большие).
