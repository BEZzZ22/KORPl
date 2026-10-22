"""Одно личное сообщение с аккаунта проекта в УЖЕ существующий диалог (по части имени), по просьбе владельца.
Отправляет, только если подходящий диалог ровно один; иначе ничего не шлёт и имён в лог не пишет.
    python tools/tg_send_one.py "<часть имени>" "<текст>"
Нужны TG_API_ID, TG_API_HASH, TG_SESSION. Не для рассылок: за них Телеграм банит аккаунты."""
import asyncio
import os
import sys

from telethon import TelegramClient
from telethon.sessions import StringSession


async def main(part, text):
    env = {k: os.environ.get(k, "") for k in ("TG_API_ID", "TG_API_HASH", "TG_SESSION")}
    if not all(env.values()):
        print("Нет TG_API_ID, TG_API_HASH или TG_SESSION.")
        return
    async with TelegramClient(StringSession(env["TG_SESSION"]), int(env["TG_API_ID"]), env["TG_API_HASH"]) as client:
        found = [d async for d in client.iter_dialogs() if d.is_user and not d.entity.bot and part.lower() in (d.name or "").lower()]
        if len(found) != 1:
            print(f"Личных диалогов с такой частью имени: {len(found)}. Ничего не отправлено.")
            return
        await client.send_message(found[0].entity, text)
        print("Отправлено.")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
