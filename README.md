# Dota Разбор — карта проекта

Telegram-бот [@DotaRazbor_bot](https://t.me/DotaRazbor_bot) и Mini App для разбора матчей Dota 2, платный ИИ-тренер и автопостинг промо (YouTube Shorts, TikTok, VK, Instagram, Telegram-канал). Своего сервера нет: сайт на GitHub Pages, бэкенд — Cloudflare Worker, всё фоновое — GitHub Actions.

- Приложение: https://bezzz22.github.io/KORPl/ — папка `docs/`, выкатывается само при пуше в основную ветку.
- Воркер: https://dotacoach.2007rggg.workers.dev — папка `worker/`, деплоится сам при пуше в `worker/` (workflow «Воркер тренера»).
- Основная ветка `claude/opus-55-capabilities-limits-ekkxhj`, все PR в неё. Ветка `replays` служебная (туда пишет «Разбор реплеев»), руками не трогать.
- История решений по датам — `HANDOFF.md`. Целиком не читать: `grep -n "^## " HANDOFF.md`, потом нужный раздел. Итоги дописывать в конец разделом с датой. Поведение юзеров — `ANALYTICS_NOTES.md`.

## Как это работает

```
Телеграм ─ кнопка «Приложение» ─> docs/index.html + app.js (Mini App)
   │                                 │  матчи и профили: OpenDota напрямую (api() в app.js),
   │                                 │  при 429/5xx — через воркер GET /od/<путь>
   │                                 │  разбор: engine.js (analyze) прямо в браузере
   │                                 └─ POST воркеру {mode: ...}: тренер, оплата, подписки, счётчики
   │
   └─ сообщения боту ─> вебхук воркера POST /tg (handleBotUpdate в coach.js; чат-защита — chatguard.js)

Воркер (coach.js), крон */3 мин: реплеи, пинок Shorts и выгрузки OpenDota, «серия сгорит», отчёт владельцу в 09:00 МСК
OpenDota режет воркер (429 с IP Cloudflare) → всё, что воркеру нужно от неё, приносит «Выгрузка OpenDota»:
  od-relay.yml раз в 20 с: GET /relay (что принести) → OpenDota → POST /relay (worker/relay.js): карточки в пати-чатах,
  «реплей разобран», пуш после катки, сводка недели
Хранилище воркера: D1 (база dotacoach, таблица kv) через store.js; KV — запасной путь, кроме денег

GitHub Actions ─> tools/*.py|mjs ─> YouTube / TikTok / VK / Instagram / TG-канал
                  состояние (что вышло) коммитится обратно в promo/*_posted.json
```

## Где менять что

| Хочу поменять | Где |
|---|---|
| Логику разбора, новую проверку ошибки | `docs/engine.js`: класс `MatchAnalyzer`, вход `analyze(...)` в конце файла. Проверки — методы `check*`, мелкие ошибки — `checkMicro()` и `micro(...)`. Сборка — `threatProfile`, `rankCounters`, `itemPlan`, драфт — `draftAdvice` |
| Ход игры: драки с последствиями, переломы, причины проигрыша, личные ошибки по минутам | `docs/story.js` (`gameStory`), вызывается из `engine.js` → `a.story`. Показ: верх «Обзора» и вкладка «Ход игры» (`storyTab` в `app.js`), тренеру уходит в `story` (`buildPrompt`, блок «Ход игры») |
| Тексты разбора и подсказок | `docs/texts.json` (несколько вариантов на ключ). Механики героев и контрпредметы — `docs/knowledge.json` |
| Откуда знания (источники, что взяли, как обновляется) | `docs/sources.md`. Сила героев в патче по рангам — `docs/hero_meta.json` (`tools/fetch-hero-meta.mjs`, раз в неделю) |
| Экраны приложения | `docs/app.js`: `boot()` — старт, `go(screen)` — переходы, `homeScreen`, `matchScreen` → `analysisScreen` (вкладки Обзор, Кто слил, Фазы, Смерти, Карта, Сборка, Графики), `profileScreen`, `draftScreen`, `heroStatsScreen`, `bonusScreen`. Адрес воркера — `COACH_URL` |
| Вид и анимации | `docs/style.css` + `docs/v2.css` (текущий дизайн), `motion.js` (GSAP), 3D: `aegis.js`, `map3d.js`, `medal3d.js`, `herocard3d.js` |
| Карту матча и «Кто слил» | `docs/dotamap.js` (кемпы `CAMPS`), `docs/blame.js` |
| Офлайн-кэш | `docs/sw.js` |
| Оплату на сайте (Робокасса) | `docs/pay.html` + `pay-page.js`; на воркере — `worker/pay.js` (цены `PACKS`, пробник `FREE_COACH`) |
| ИИ-тренер (промпт, проверка ответа) | `worker/coach.js`: `buildPrompt`, `ask`, `problemsOf`, `chat`, `compare`. Модели: Claude (тир `opus`, платный разбор), Groq и Gemini (быстрые), порядок — `COACH_PRIMARY` |
| Ответы бота, команды владельца | `worker/coach.js` → `handleBotUpdate` |
| Рефералку, серию дней, сводку недели, «серия сгорит» | `worker/growth.js` |
| Пуш после катки, выгрузку OpenDota через Actions | `worker/relay.js` + `tools/od-relay.mjs` |
| Вход через Steam | кнопка `steamButton` в `docs/app.js`, возврат — `docs/steam.html` (ссылка `startapp=l<steamID64>`) |
| Видеоразбор катки (ролик 60–90 с, без нейросетей) | `tools/video/` (`make.mjs` — весь конвейер: `extract` → `moments` → `script` + `texts.json` → `tts.py` → `timeline` → `film/` → `audio.py`), заявки и очередь — `worker/video.js`, сборка — workflow «Видеоразбор» |
| Виджеты в чате (Bot API 10.4): карточка катки в пуше после игры, витрина на /pay | `worker/widget.js` (HTML виджетов, `handleWidgetQuery` — нажатия). Выключить: переменная воркера `WIDGETS=0` |
| Защиту чата @dotarazbor_chat | `worker/chatguard.js` |
| Ежедневный отчёт по юзерам | `worker/coach.js` → `buildReport` / `dailyReport` |
| Справочники OpenDota (`items.json`, `abilities.json`, `builds.json`, `counterpick.json`) | генераторы `tools/fetch-*.mjs`, обновляет workflow «Сборки героев» |
| Очередь роликов | `promo/yt_queue.json`, `ig_queue.json`, `queue.json` (TG-канал); TikTok/VK берут из YT-очереди. Ролики — `promo/shorts/`, `promo/reels/`, исходники моушна — `promo/motion/` |
| Загрузку на площадки | `tools/promo_yt.py`, `promo_tt.py`, `promo_vk.py`, `promo_ig.py`, `promo-post.mjs` / `promo_userbot.py` (TG-канал) |
| Посмотреть чужой ролик по ссылке (кадры + речь) | скилл `.claude/skills/watch/` (`watch.py`: yt-dlp, ffmpeg, faster-whisper) |

Маршруты воркера (`worker/coach.js`, `fetch`): `POST /` с `mode` = `card`, `sync`, `track`, `gate`, `vanity`, `feedback`, `replay`, `watch`, `wallet`, `buy`, `pay_link`, `open`, `ref_match`, `web_wallet`, `web_buy`, `chat`, `compare` (без `mode` — разбор тренером); `POST /tg` — вебхук бота; `GET`/`POST /relay` — выгрузка OpenDota (ключ — RELAY_KEY из токена Cloudflare); `POST /robokassa` — оплата картой; `GET`/`POST /video-queue` — очередь видеоразборов для Actions (тот же ключ), `POST /video-send` — готовый ролик человеку через воркер; `GET /od/*` — запасной путь к OpenDota; `GET /stats`, `/replay-queue`, `/card/<id>.png`; `POST /report`.

Ключи хранилища (префиксы): `user:` профиль, `seen:` первый заход и источник, `wallet:` `pay:` `paid:` `robo:` `unl:` деньги (только D1, без запасного KV — `MONEY` в `store.js`), `ask:` лимиты вопросов, `watch:` подписки «разбор готов», `rq:` очередь реплеев, `streak:` серия, `refm:` катка, которую откроет бонус за друга, `top:` `topdone:` `notop:` топ недели в чате, `digest:` сводка недели, `pq:` `odreq:` `relay_*` выгрузка OpenDota, `lastm:` `pushlast:` `nopush:` пуш после катки (не чаще раза в 60 ч), `cg*:` защита чата, `wgt:` карточка катки виджетом (чтобы дописать статус ролика).

## Секреты

Значения нигде в репо не лежат. Где они:

- **Secrets репозитория** (Settings → Secrets → Actions). Воркер: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BOT_TOKEN`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `GH_TOKEN`, `OPENDOTA_KEY`, `ROBOKASSA_LOGIN`/`PASS1`/`PASS2` — workflow «Воркер тренера» сам перекладывает их в секреты Cloudflare. Промо: `YT_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN`, `TT_CLIENT_KEY`/`SECRET`/`REFRESH_TOKEN`, `VK_CLIENT_ID`/`DEVICE_ID`/`GROUP_ID`/`REFRESH_TOKEN`, `IG_SESSIONID`, `PROMO_CHAT`. Телеграм-аккаунты: `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`, `TG2_PHONE`, `TG2_PASSWORD`, `MAIN_PASSWORD`.
- **`promo/tokens/*.enc`** — одноразовые refresh-токены TikTok/VK и сессии, которые меняются на каждом прогоне. Зашифрованы ключом из секрета `PROMO_TOKEN_KEY` (`tools/promo_tokens.py`).
- **`worker/wrangler.toml`** — только несекретное: `OWNER_TG_IDS`, id KV, кроны.

## Команды

```bash
npm ci                                   # один раз
npm test                                 # тесты движка, приложения и воркера (должно быть 0 fail)
node tests/versions.test.mjs --update    # после правки файлов в docs/: поднять ?v=
PW_EXEC=/opt/pw-browsers/chromium node tests/ui/run.mjs   # UI-прогон в Chromium
```

Python-скрипты в `tools/` ставят свои зависимости сами, в своих workflow (`pip install ...` в yml). Клон тяжёлый (~600 МБ из-за роликов): если ролики не нужны, `git clone --depth=1 --filter=blob:limit=5m`.

## Правила кода

- Репо публичный: никаких токенов, ников, Telegram id и id матчей юзеров в коде, коммитах и логах workflow (в логах — только числа).
- В коде, коммитах и PR — без мата.
- Тексты для юзера — только в `docs/texts.json`. Герои по роду не склоняются, «выкуп» вместо «байбек», «добитые крипы» вместо «ластхиты».
- Изменил файл в `docs/` — подними его `?v=` (тест `versions` ловит).
- `docs/*.js` должны работать в Safari до 16.4 (без lookbehind и прочего нового синтаксиса) — `tests/compat.test.mjs`.
- Экран с rAF, датчиками или слушателями на `document`/`window` убирает за собой: `whenGone(el, fn)` из `aegis.js`; датчик наклона — только через `gyro()`.
- Дизайн без эмодзи-иконок, цветных пятен и фиолетового.
- `wrangler` запускать только из `worker/` (`-c wrangler.toml`), из корня он выкатит `docs/` отдельным воркером.

## Чего не трогать без прямого «да» владельца

- `tools/tg2.py`, `.github/workflows/tg2.yml` (второй TG-аккаунт для чатов) и `prod-check.yml`.
- Чтение и запись прод-данных воркера (D1/KV) из сессии. Диагностика — через готовые workflow.
- Публикации от имени владельца и сообщения людям вне проекта.
- Удаление веток, роликов и workflow.

## Workflow (Actions → имя → Run workflow)

| Имя | Файл | Когда | Что делает |
|---|---|---|---|
| Автопостинг | `promo.yml` | каждый час | пост в TG-канал из `promo/queue.json` |
| YouTube Shorts | `yt.yml` | каждый час (+ пинок от воркера) | выкладывает ролики из `yt_queue.json` |
| TikTok | `tt.yml` | каждый час | черновики в TikTok (Sandbox, публикует владелец) |
| VK Клипы | `vk.yml` | каждый час | клипы в VK |
| Инстаграм рилсы | `ig.yml` | вручную | рилсы из `ig_queue.json` |
| Выгрузка OpenDota | `od-relay.yml` | дежурит постоянно (воркер сам запускает) | приносит воркеру данные OpenDota: пати-чаты, «разобран», пуши, сводка |
| Разбор реплеев | `replays.yml` | каждые 10 мин | парсит реплеи из очереди воркера, итог в ветку `replays` |
| Видеоразбор | `video.yml` | по заявке из бота (воркер сам запускает); вручную с номером матча — проверка, ролик в артефактах | качает реплей, собирает ролик и шлёт человеку |
| Статистика Shorts | `yt-stats.yml` | 09:20 МСК | просмотры и досмотр владельцу в Телеграм |
| Сборки героев | `builds.yml` | по понедельникам | обновляет справочники в `docs/` |
| Воркер тренера | `worker.yml` | при пуше в `worker/` | деплой воркера и его секретов |
| Отчёт по юзерам | `report.yml` | вручную | отчёт сейчас (сам приходит в 09:00 МСК) |
| YouTube: новый токен | `yt-token.yml` | вручную, раз в 7 дней | перевыпуск токена YouTube |
| Акк для чатов | `tg2.yml` | вручную | второй TG-аккаунт, не трогать |
| Проверка прода | `prod-check.yml` | вручную | сайт и воркер отвечают, не трогать |
| Уборка веток | `branches-cleanup.yml` | вручную | удаляет ветки, уже влитые через PR |
| Проверка юзера, Воронка тренера, Проверка OpenDota, Проверка разбора реплеев, Генеральная проверка разбора | `user-check.yml`, `coach-funnel.yml`, `opendota-check.yml`, `parse-check.yml`, `general-check.yml` | вручную | диагностика |
| Рассылка юзерам | `broadcast.yml` | вручную, только с «да» Ярика | разовое письмо всем юзерам бота, текст в `promo/broadcast/<job>.txt` |
| Чат канала, Одно сообщение, Ответ от бота, Премиум-эмодзи, Разметка карты | `community.yml`, `send-one.yml`, `bot-reply.yml`, `emoji.yml`, `mapdata.yml` | вручную | разовые задачи |
