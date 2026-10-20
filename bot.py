"""Телеграм-бот Dota-тренера.

Бот ничего не пишет в чат: вся работа в Mini App (папка docs на GitHub Pages).
Бот только ставит кнопку «Приложение» в меню чата, а потом остаётся без ответов.
"""
import asyncio
import logging
import os
import re
from html import escape

from aiogram import BaseMiddleware, Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import CallbackQuery, MenuButtonWebApp, WebAppInfo
from dotenv import load_dotenv

from storage import Storage

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bot")

DB_PATH = os.getenv("DB_PATH", "bot.db")
# Ники через запятую, которым бот отвечает отказом (оставлено на случай, если бот снова начнёт отвечать)
BLOCKED_USERNAMES = {u.strip().lstrip("@").lower() for u in os.getenv("BLOCKED_USERNAMES", "").split(",") if u.strip()}
BLOCKED_MESSAGE = os.getenv("BLOCKED_MESSAGE", "Тебе сюда нельзя.")
# Адрес Telegram Mini App (папка docs на GitHub Pages)
WEBAPP_URL = os.getenv("WEBAPP_URL", "").rstrip("/")

MATCH_ID_RE = re.compile(r"(?<!\d)(\d{7,11})(?!\d)")

db: Storage | None = None


def parse_match_id(text: str) -> int | None:
    m = MATCH_ID_RE.search(text or "")
    return int(m.group(1)) if m else None


class BlocklistMiddleware(BaseMiddleware):
    """Пользователям из BLOCKED_USERNAMES отвечает BLOCKED_MESSAGE и дальше не пускает."""

    async def __call__(self, handler, event, data):
        user = data.get("event_from_user")
        if user and self.blocked(user):
            if isinstance(event, CallbackQuery):
                await event.answer(BLOCKED_MESSAGE[:200], show_alert=True)
            else:
                await event.answer(escape(BLOCKED_MESSAGE))
            return None
        return await handler(event, data)

    @staticmethod
    def blocked(user) -> bool:
        if user.username and user.username.lower() in BLOCKED_USERNAMES:
            # Запоминаем id: после смены ника блок останется
            if db is not None:
                db.block(user.id)
            return True
        return db is not None and db.is_blocked(user.id)


async def main():
    token = os.getenv("BOT_TOKEN")
    if not token:
        raise SystemExit("Нет BOT_TOKEN. Создай файл .env по примеру .env.example")
    if not WEBAPP_URL:
        raise SystemExit("Нет WEBAPP_URL: без адреса приложения бот ничего не делает")
    bot = Bot(token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    try:
        await bot.delete_my_commands()
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="Приложение", web_app=WebAppInfo(url=f"{WEBAPP_URL}/"))
        )
        log.info("Кнопка «Приложение» стоит, бот молчит: всё в приложении")
    finally:
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
