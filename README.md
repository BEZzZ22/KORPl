# Dota Разбор

Telegram-бот [@DotaRazbor_bot](https://t.me/DotaRazbor_bot) и Mini App для разбора матчей Dota 2, плюс автопостинг промо (YouTube Shorts, TikTok, VK, Instagram, Telegram-канал).

- Приложение: https://bezzz22.github.io/KORPl/ (GitHub Pages из `docs/`).
- Воркер: https://dotacoach.2007rggg.workers.dev (Cloudflare, `worker/`). Бот отвечает через его вебхук `/tg`.
- Основная ветка: `claude/opus-55-capabilities-limits-ekkxhj`. Ветка `replays` служебная, в неё пишет workflow «Разбор реплеев», руками её не трогать.

## Где что лежит

| Папка | Что там |
|---|---|
| `docs/` | Mini App (публичный сайт). `engine.js` — весь разбор, `app.js` — экраны, `texts.json` — все тексты, `knowledge.json` — механики героев, остальные `*.json` — справочники. Файлы `tiktok*.txt` подтверждают домен для TikTok, их не удалять. |
| `worker/` | Cloudflare Worker: тренер на ИИ (`coach.js`), оплата звёздами и Робокассой (`pay.js`), хранилище D1/KV (`store.js`), рост и рефералка (`growth.js`), защита чата (`chatguard.js`). Тесты лежат рядом: `*.test.mjs`. |
| `tools/` | Скрипты для workflow и ручного запуска: `promo_*` — промо-ролики и автопостинг, `yt_*`/`tt_*`/`vk_*` — токены и загрузка, `tg*` — Телеграм-аккаунты, `fetch-*` — справочники OpenDota, `*-check.mjs` — проверки. |
| `promo/` | Очереди и журналы постинга (`*_queue.json`, `*_posted.json`), готовые ролики (`shorts/`, `reels/`), исходники моушн-роликов (`motion/`), картинки. Ролики весят около 600 МБ. |
| `tests/` | Тесты движка и приложения (`*.test.mjs`), UI-прогон в Chromium (`tests/ui/run.mjs`), фикстуры матчей. |
| `.github/workflows/` | Автоматика, таблица ниже. |

Журнал всего сделанного — `HANDOFF.md` (большой, по датам). Целиком его читать не нужно: список разделов даёт `grep -n "^## " HANDOFF.md`. Новые итоги дописываются в конец отдельным разделом с датой. Наблюдения по поведению юзеров — `ANALYTICS_NOTES.md`.

## Команды

```bash
npm ci                                   # один раз
npm test                                 # тесты движка, приложения и воркера
node tests/versions.test.mjs --update    # после правки файлов приложения: поднять ?v=
PW_EXEC=/opt/pw-browsers/chromium node tests/ui/run.mjs   # UI-прогон в Chromium
```

Перед PR `npm test` должен быть зелёным. Python-скрипты в `tools/` ставят свои зависимости сами, в своих workflow (`pip install ...` в yml).

## Правила кода

- Репозиторий публичный: никаких токенов, ников, Telegram id и id матчей юзеров в коде, коммитах и логах workflow. Секреты хранятся только в Secrets репозитория и в Cloudflare.
- Тексты для юзера живут только в `docs/texts.json`. Герои по роду не склоняются, пишем «выкуп», а не «байбек», и «добитые крипы», а не «ластхиты».
- Изменил файл в `docs/` — подними его `?v=` (тест `versions` это ловит).
- `docs/*.js` должны работать в Safari до 16.4 (без lookbehind и прочего нового синтаксиса), за этим следит `tests/compat.test.mjs`.
- Экран с rAF, датчиками или слушателями на `document`/`window` должен убирать за собой: `whenGone(el, fn)` из `aegis.js`.
- Дизайн без эмодзи-иконок, цветных пятен и фиолетового.
- Воркер деплоится сам при пуше в `worker/` на основной ветке (workflow «Воркер тренера»). Из корня репо `wrangler` не запускать.

## Чего не трогать без прямого согласия владельца

- `tools/tg2.py`, `.github/workflows/tg2.yml` (второй TG-аккаунт для чатов) и `prod-check.yml`.
- Чтение и запись прод-данных воркера (D1/KV) из сессии. Диагностика идёт через готовые workflow.
- Публикации от имени владельца и сообщения людям вне проекта.
- Удаление веток, роликов и workflow.

## Workflow (Actions → имя → Run workflow)

| Имя | Файл | Когда |
|---|---|---|
| Автопостинг (TG-канал) | `promo.yml` | каждый час |
| YouTube Shorts | `yt.yml` | каждый час |
| TikTok | `tt.yml` | каждый час |
| VK Клипы | `vk.yml` | каждый час |
| Инстаграм рилсы | `ig.yml` | вручную |
| Разбор реплеев | `replays.yml` | каждые 10 минут |
| Статистика Shorts | `yt-stats.yml` | раз в день |
| Сборки героев | `builds.yml` | по понедельникам |
| Воркер тренера | `worker.yml` | при пуше в `worker/` |
| Отчёт по юзерам | `report.yml` | вручную (сам приходит в 09:00 МСК от воркера) |
| YouTube: новый токен | `yt-token.yml` | вручную, раз в 7 дней |
| Акк для чатов | `tg2.yml` | вручную |
| Проверка прода | `prod-check.yml` | вручную |
| Проверка юзера, Воронка тренера, Проверка OpenDota, Проверка разбора реплеев, Генеральная проверка разбора | `user-check.yml`, `coach-funnel.yml`, `opendota-check.yml`, `parse-check.yml`, `general-check.yml` | диагностика, вручную |
| Чат канала, Одно сообщение, Премиум-эмодзи, Разметка карты | `community.yml`, `send-one.yml`, `emoji.yml`, `mapdata.yml` | разовые, вручную |
