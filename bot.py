"""Телеграм-бот, который разбирает матчи Dota 2."""
import asyncio
import logging
import os
import re
import time
from html import escape

from aiogram import BaseMiddleware, Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ChatAction, ChatType, ParseMode
from aiogram.filters import Command, CommandObject
from aiogram.types import (
    BotCommand,
    BufferedInputFile,
    CallbackQuery,
    ErrorEvent,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Message,
    WebAppInfo,
)
from dotenv import load_dotenv

import analysis
import chart
import coach_ai
import report
from opendota import OpenDota, OpenDotaError, is_parsed, to_account_id
from storage import Storage

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bot")

DB_PATH = os.getenv("DB_PATH", "bot.db")
AI_DAILY_LIMIT = int(os.getenv("AI_DAILY_LIMIT", "10"))
# Адрес Telegram Mini App (папка docs на GitHub Pages). Без него бот работает только текстом
WEBAPP_URL = os.getenv("WEBAPP_URL", "").rstrip("/")
MESSAGE_INTERVAL = 1.0  # не чаще одного сообщения в секунду от одного человека
ANALYSIS_COOLDOWN = 10.0  # и не чаще одного разбора в 10 секунд

MATCH_ID_RE = re.compile(r"(?<!\d)(\d{7,11})(?!\d)")
MAX_ACCOUNT_ID = 2**32 - 1

router = Router()
# Бот работает только в личке: в группах его могли бы спамить чужие люди
router.message.filter(F.chat.type == ChatType.PRIVATE)
router.callback_query.filter(F.message.chat.type == ChatType.PRIVATE)

od = OpenDota()
db: Storage | None = None


class ThrottleMiddleware(BaseMiddleware):
    """Молча отбрасывает флуд от одного пользователя."""

    def __init__(self):
        self.last_seen: dict[int, float] = {}

    async def __call__(self, handler, event, data):
        user = data.get("event_from_user")
        if user:
            now = time.monotonic()
            if now - self.last_seen.get(user.id, 0) < MESSAGE_INTERVAL:
                if isinstance(event, CallbackQuery):
                    await event.answer("Не так быстро")
                return None
            self.last_seen[user.id] = now
        return await handler(event, data)


class AnalysisGuard:
    """Один разбор за раз на пользователя и пауза между разборами."""

    def __init__(self):
        self.busy: set[int] = set()
        self.last_run: dict[int, float] = {}

    def try_start(self, user_id: int) -> str | None:
        if user_id in self.busy:
            return "Подожди, ещё разбираю прошлый матч."
        wait = ANALYSIS_COOLDOWN - (time.monotonic() - self.last_run.get(user_id, 0))
        if wait > 0:
            return f"Не так часто. Попробуй через {int(wait) + 1} сек."
        self.busy.add(user_id)
        return None

    def finish(self, user_id: int):
        self.busy.discard(user_id)
        self.last_run[user_id] = time.monotonic()


guard = AnalysisGuard()


def webapp_button(text: str, **params) -> InlineKeyboardButton:
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return InlineKeyboardButton(text=text, web_app=WebAppInfo(url=f"{WEBAPP_URL}/?{query}"))


def parse_match_id(text: str) -> int | None:
    m = MATCH_ID_RE.search(text or "")
    return int(m.group(1)) if m else None


def hero_keyboard(match: dict) -> InlineKeyboardMarkup:
    def button(p):
        return InlineKeyboardButton(
            text=od.hero_name(p["hero_id"]), callback_data=f"a:{match['match_id']}:{p['player_slot']}"
        )

    radiant = [p for p in match["players"] if p["isRadiant"]]
    dire = [p for p in match["players"] if not p["isRadiant"]]
    rows = [[button(r), button(d)] for r, d in zip(radiant, dire)]
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Свет", callback_data="noop"),
                                                  InlineKeyboardButton(text="Тьма", callback_data="noop")]] + rows)


# ---------- команды ----------

async def set_app_button(message: Message, account_id: int | None):
    """Кнопка «Приложение» у поля ввода. Ставим на каждый чат: общая по умолчанию применяется не всегда."""
    if not WEBAPP_URL:
        return
    url = f"{WEBAPP_URL}/?account={account_id}" if account_id else f"{WEBAPP_URL}/"
    await message.bot.set_chat_menu_button(
        chat_id=message.chat.id,
        menu_button=MenuButtonWebApp(text="Приложение", web_app=WebAppInfo(url=url)),
    )


@router.message(Command("start", "help"))
async def cmd_start(message: Message):
    await set_app_button(message, db.get_account(message.from_user.id))
    await message.answer(
        "<b>Dota-тренер</b>\n"
        "Разбираю твои катки: где ошибся, что получилось и над чем работать.\n\n"
        "<b>Как пользоваться</b>\n"
        "1. Привяжи аккаунт: <code>/me 123456789</code>\n"
        "    Friend ID есть в Доте в профиле, Steam ID тоже подойдёт.\n"
        "2. <code>/last</code> — разбор последней катки\n"
        "    <code>/recent</code> — последние 5 игр на выбор\n"
        "    Или просто кинь ID матча или ссылку с OpenDota, Dotabuff, Stratz.\n\n"
        "В Доте должно быть включено: Настройки → Социальное → «Открыть доступ к данным матчей»."
    )


@router.message(Command("me"))
async def cmd_me(message: Message, command: CommandObject):
    arg = (command.args or "").strip()
    if not arg.isdigit() or len(arg) > 20:
        await message.answer("Напиши так: <code>/me 123456789</code>\nFriend ID есть в Доте в профиле.")
        return
    account_id = to_account_id(int(arg))
    if not 0 < account_id <= MAX_ACCOUNT_ID:
        await message.answer("Это не похоже на Steam ID или Friend ID.")
        return

    player = await od.player(account_id)
    if not player:
        await message.answer("OpenDota не знает такой аккаунт. Проверь ID.")
        return
    db.set_account(message.from_user.id, account_id)
    await set_app_button(message, account_id)
    name = escape(player["profile"].get("personaname") or str(account_id))
    text = f"Привязал аккаунт <b>{name}</b>.\nТеперь пиши /last или /recent."
    if player["profile"].get("fh_unavailable"):
        text += (
            "\n\nУ тебя скрыта история матчей. Включи в Доте: Настройки → Социальное → "
            "«Открыть доступ к данным матчей», иначе я не увижу игры."
        )
    await message.answer(text)


async def require_account(message: Message, user_id: int) -> int | None:
    account_id = db.get_account(user_id)
    if not account_id:
        await message.answer("Сначала привяжи аккаунт: <code>/me Friend ID</code>")
    return account_id


@router.message(Command("last"))
async def cmd_last(message: Message):
    account_id = await require_account(message, message.from_user.id)
    if not account_id:
        return
    matches = await od.recent_matches(account_id)
    if not matches:
        await no_matches(message, account_id)
        return
    await run_analysis(message, message.from_user.id, matches[0]["match_id"], account_id=account_id)


@router.message(Command("recent"))
async def cmd_recent(message: Message):
    account_id = await require_account(message, message.from_user.id)
    if not account_id:
        return
    matches = (await od.recent_matches(account_id))[:5]
    if not matches:
        await no_matches(message, account_id)
        return
    rows = []
    for m in matches:
        won = (m["player_slot"] < 128) == m["radiant_win"]
        label = (f"{'W' if won else 'L'} · {od.hero_name(m['hero_id'])} · "
                 f"{m['kills']}/{m['deaths']}/{m['assists']} · {m['duration'] // 60} мин")
        rows.append([InlineKeyboardButton(text=label, callback_data=f"m:{m['match_id']}")])
    await message.answer("Какую игру разобрать?", reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))


async def no_matches(message: Message, account_id: int):
    await od.refresh_player(account_id)
    await message.answer(
        "Не нашёл матчей. Проверь, что в Доте включено: Настройки → Социальное → "
        "«Открыть доступ к данным матчей». Я попросил OpenDota обновить профиль, попробуй через пару минут."
    )


@router.message(F.text.func(parse_match_id))
async def on_match_id(message: Message):
    match_id = parse_match_id(message.text)
    await run_analysis(message, message.from_user.id, match_id, account_id=db.get_account(message.from_user.id))


@router.message()
async def on_unknown(message: Message):
    await message.answer("Не понял. Кинь ID матча, напиши /last или /help.")


# ---------- кнопки ----------

@router.callback_query(F.data == "noop")
async def on_noop(callback: CallbackQuery):
    await callback.answer()


@router.callback_query(F.data.regexp(r"^m:\d{7,11}$"))
async def on_recent_pick(callback: CallbackQuery):
    await callback.answer()
    match_id = int(callback.data.split(":")[1])
    await run_analysis(callback.message, callback.from_user.id, match_id,
                       account_id=db.get_account(callback.from_user.id))


@router.callback_query(F.data.regexp(r"^a:\d{7,11}:\d{1,3}$"))
async def on_hero_pick(callback: CallbackQuery):
    await callback.answer()
    _, match_id, slot = callback.data.split(":")
    await run_analysis(callback.message, callback.from_user.id, int(match_id), slot=int(slot))


@router.callback_query()
async def on_bad_callback(callback: CallbackQuery):
    await callback.answer("Кнопка устарела")


# ---------- разбор ----------

async def run_analysis(message: Message, user_id: int, match_id: int,
                       account_id: int | None = None, slot: int | None = None):
    refusal = guard.try_start(user_id)
    if refusal:
        await message.answer(refusal)
        return
    try:
        await analyze_match(message, user_id, match_id, account_id, slot)
    except OpenDotaError:
        await message.answer("OpenDota сейчас не отвечает. Попробуй через минуту.")
    finally:
        guard.finish(user_id)


async def analyze_match(message: Message, user_id: int, match_id: int, account_id: int | None, slot: int | None):
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)
    match = await od.match(match_id)
    if not match:
        await message.answer("Такого матча нет. Проверь ID.")
        return

    if not is_parsed(match):
        await od.request_parse(match_id)
        await message.answer(
            "Реплей этого матча ещё не разобран. Отправил его на разбор в OpenDota, "
            "это 1-5 минут. Потом кинь ID ещё раз."
        )
        return

    player = None
    if slot is not None:
        player = next((p for p in match["players"] if p["player_slot"] == slot), None)
    elif account_id:
        player = next((p for p in match["players"] if p.get("account_id") == account_id), None)

    if not player:
        await message.answer("За кого показать разбор?", reply_markup=hero_keyboard(match))
        return

    result = analysis.analyze(match, player, od)
    await message.bot.send_chat_action(message.chat.id, ChatAction.UPLOAD_PHOTO)
    png = await asyncio.to_thread(chart.networth_chart, result.timeline)
    markup = None
    if WEBAPP_URL:
        button = webapp_button("Открыть в приложении", match=match_id, slot=player["player_slot"])
        markup = InlineKeyboardMarkup(inline_keyboard=[[button]])
    await message.answer_photo(BufferedInputFile(png, f"{match_id}.png"), caption=report.caption(result),
                               reply_markup=markup)

    for chunk in report.split_message(report.full_report(result)):
        await message.answer(chunk)

    if coach_ai.enabled():
        await send_ai_review(message, user_id, result)


async def send_ai_review(message: Message, user_id: int, result: analysis.Analysis):
    if not db.take_ai_quota(user_id, AI_DAILY_LIMIT):
        await message.answer(f"Лимит ИИ-разборов на сегодня ({AI_DAILY_LIMIT}) закончился. Статистика выше всё равно твоя.")
        return
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)
    try:
        text = await coach_ai.analyze(result)
    except Exception:
        log.exception("Claude API error")
        await message.answer("ИИ-тренер сейчас недоступен, но разбор по цифрам выше в силе.")
        return
    # Ответ модели экранируем, чтобы он не сломал HTML-разметку
    for chunk in report.split_message("<b>Разбор тренера</b>\n\n" + escape(text)):
        await message.answer(chunk)


@router.errors()
async def on_error(event: ErrorEvent):
    log.exception("Unhandled error", exc_info=event.exception)
    update = event.update
    target = update.message or (update.callback_query.message if update.callback_query else None)
    if target:
        try:
            await target.answer("Что-то сломалось. Попробуй ещё раз чуть позже.")
        except Exception:
            pass


async def main():
    global db
    token = os.getenv("BOT_TOKEN")
    if not token:
        raise SystemExit("Нет BOT_TOKEN. Создай файл .env по примеру .env.example")
    db = Storage(DB_PATH)
    await od.start()

    bot = Bot(token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    await bot.set_my_commands([
        BotCommand(command="last", description="Разбор последней игры"),
        BotCommand(command="recent", description="Последние 5 игр"),
        BotCommand(command="me", description="Привязать аккаунт"),
        BotCommand(command="help", description="Как пользоваться"),
    ])
    if WEBAPP_URL:
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="Приложение", web_app=WebAppInfo(url=f"{WEBAPP_URL}/"))
        )
    dp = Dispatcher()
    throttle = ThrottleMiddleware()
    dp.message.outer_middleware(throttle)
    dp.callback_query.outer_middleware(throttle)
    dp.include_router(router)
    try:
        await dp.start_polling(bot, allowed_updates=["message", "callback_query"])
    finally:
        await od.close()
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
