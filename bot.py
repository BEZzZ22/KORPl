"""Телеграм-бот, который разбирает матчи Dota 2."""
import asyncio
import json
import logging
import os
import re
from pathlib import Path

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from dotenv import load_dotenv

import analysis
import coach_ai
from opendota import OpenDota, is_parsed, to_account_id

load_dotenv()
logging.basicConfig(level=logging.INFO)

USERS_FILE = Path(os.getenv("USERS_FILE", "users.json"))
MATCH_ID_RE = re.compile(r"\b(\d{9,11})\b")
TG_LIMIT = 4000

router = Router()
od = OpenDota()


def load_users() -> dict[str, int]:
    if USERS_FILE.exists():
        return json.loads(USERS_FILE.read_text())
    return {}


def save_user(tg_id: int, account_id: int):
    users = load_users()
    users[str(tg_id)] = account_id
    USERS_FILE.write_text(json.dumps(users))


async def send_long(message: Message, text: str):
    for i in range(0, len(text), TG_LIMIT):
        await message.answer(text[i : i + TG_LIMIT])


@router.message(Command("start", "help"))
async def cmd_start(message: Message):
    await message.answer(
        "Здарова. Я разбираю твои катки в Доте: где ошибся и над чем работать.\n\n"
        "1. Привяжи аккаунт: /me <Steam ID или Friend ID>\n"
        "2. Кидай ID матча или ссылку на него (OpenDota, Dotabuff, Stratz)\n"
        "   или пиши /last — разберу последнюю игру."
    )


@router.message(Command("me"))
async def cmd_me(message: Message, command: CommandObject):
    if not command.args or not command.args.strip().isdigit():
        await message.answer("Напиши так: /me 123456789\nFriend ID есть в Доте в профиле.")
        return
    account_id = to_account_id(int(command.args.strip()))
    save_user(message.from_user.id, account_id)
    await message.answer(f"Привязал аккаунт {account_id}. Кидай матч или пиши /last.")


@router.message(Command("last"))
async def cmd_last(message: Message):
    account_id = load_users().get(str(message.from_user.id))
    if not account_id:
        await message.answer("Сначала привяжи аккаунт: /me <Friend ID>")
        return
    match_id = await od.last_match_id(account_id)
    if not match_id:
        await message.answer("Не нашёл матчей. Проверь, что в Доте открыта публичная статистика.")
        return
    await analyze_match(message, match_id, account_id)


@router.message(F.text.regexp(MATCH_ID_RE))
async def on_match_id(message: Message):
    match_id = int(MATCH_ID_RE.search(message.text).group(1))
    await analyze_match(message, match_id, load_users().get(str(message.from_user.id)))


@router.callback_query(F.data.startswith("slot:"))
async def on_hero_pick(callback: CallbackQuery):
    _, match_id, slot = callback.data.split(":")
    await callback.answer()
    await analyze_match(callback.message, int(match_id), slot=int(slot))


async def analyze_match(message: Message, match_id: int, account_id: int | None = None, slot: int | None = None):
    match = await od.match(match_id)
    if not match:
        await message.answer("Такого матча нет. Проверь ID.")
        return

    if not is_parsed(match):
        await od.request_parse(match_id)
        await message.answer(
            "Реплей этого матча ещё не разобран. Отправил его на разбор в OpenDota, "
            "это занимает пару минут. Кинь ID ещё раз чуть позже."
        )
        return

    player = None
    if slot is not None:
        player = next((p for p in match["players"] if p["player_slot"] == slot), None)
    elif account_id:
        player = next((p for p in match["players"] if p.get("account_id") == account_id), None)

    if not player:
        buttons = [
            [InlineKeyboardButton(text=od.hero_name(p["hero_id"]), callback_data=f"slot:{match_id}:{p['player_slot']}")]
            for p in match["players"]
        ]
        await message.answer("За какого героя ты играл?", reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))
        return

    await message.answer("Смотрю матч...")
    facts = analysis.collect_facts(match, player, od)
    bad, good = analysis.find_mistakes(facts)
    report = analysis.format_report(facts, bad, good)

    if coach_ai.enabled():
        try:
            report += "\n\nРазбор тренера:\n" + await coach_ai.analyze(facts, bad + good)
        except Exception:
            logging.exception("Claude API error")
            report += "\n\n(ИИ-разбор сейчас недоступен, показал только статистику)"

    await send_long(message, report)


async def main():
    token = os.getenv("BOT_TOKEN")
    if not token:
        raise SystemExit("Нет BOT_TOKEN. Создай файл .env по примеру .env.example")
    await od.start()
    bot = Bot(token)
    dp = Dispatcher()
    dp.include_router(router)
    try:
        await dp.start_polling(bot)
    finally:
        await od.close()


if __name__ == "__main__":
    asyncio.run(main())
