"""Включить инлайн-режим у @DotaRazbor_bot через BotFather с основного аккаунта (владельца бота), по просьбе Ярика 08.11.
Bot API это не умеет: только /setinline в BotFather. Диалог: /setinline → @DotaRazbor_bot → текст подсказки.
Печатает ответы BotFather (в них нет ни токенов, ни id). Нужны TG_API_ID, TG_API_HASH, TG_SESSION."""
import asyncio
import os

from telethon import TelegramClient
from telethon.sessions import StringSession

BOT = "@DotaRazbor_bot"
PLACEHOLDER = "ID катки"


async def main():
    env = {k: os.environ.get(k, "") for k in ("TG_API_ID", "TG_API_HASH", "TG_SESSION")}
    if not all(env.values()):
        print("Нет TG_API_ID, TG_API_HASH или TG_SESSION.")
        return
    async with TelegramClient(StringSession(env["TG_SESSION"]), int(env["TG_API_ID"]), env["TG_API_HASH"]) as client:
        async with client.conversation("BotFather", timeout=30) as conv:
            for text in ("/cancel", "/setinline", BOT, PLACEHOLDER):
                await conv.send_message(text)
                reply = await conv.get_response()
                print(f"> {text}\n< {(reply.message or '')[:300]}\n")


if __name__ == "__main__":
    asyncio.run(main())
