"""Одно личное сообщение с аккаунта проекта в УЖЕ существующий диалог, по просьбе владельца и с его «отправляй» на этот текст.
Диалог ищется по @юзернейму (или по части имени). Шлёт, только если подходит ровно один диалог; иначе ничего не отправляет.
    python tools/tg_send_one.py "@username" "<текст>"
Нужны TG_API_ID, TG_API_HASH, TG_SESSION. Не для рассылок и не для автоответов: за них Телеграм банит аккаунты."""
import asyncio
import os
import sys

from telethon import TelegramClient
from telethon.sessions import StringSession


def matches(dialog, query):
    if not dialog.is_user or getattr(dialog.entity, "bot", False):
        return False
    if query.startswith("@"):
        return (getattr(dialog.entity, "username", "") or "").lower() == query[1:].lower()
    return query.lower() in (dialog.name or "").lower()


async def main(query, text):
    env = {k: os.environ.get(k, "") for k in ("TG_API_ID", "TG_API_HASH", "TG_SESSION")}
    if not all(env.values()):
        print("Нет TG_API_ID, TG_API_HASH или TG_SESSION.")
        return
    async with TelegramClient(StringSession(env["TG_SESSION"]), int(env["TG_API_ID"]), env["TG_API_HASH"]) as client:
        found = [d async for d in client.iter_dialogs() if matches(d, query)]
        if len(found) != 1:
            print(f"Подходящих личных диалогов: {len(found)}. Ничего не отправлено.")
            return
        await client.send_message(found[0].entity, text)
        print("Отправлено.")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
