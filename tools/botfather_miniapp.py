"""Включить Mini App у @DotaRazbor_bot через BotFather с основного аккаунта (владельца бота), по просьбе Ярика 08.11.
Путь в BotFather кнопками: /mybots → бот → Bot Settings → Configure Mini App → Enable Mini App → ссылка приложения.
Печатает ответы и кнопки BotFather (в них нет ни токенов, ни id). Нужны TG_API_ID, TG_API_HASH, TG_SESSION."""
import asyncio
import os

from telethon import TelegramClient
from telethon.sessions import StringSession

BOT = "DotaRazbor_bot"
APP = "https://bezzz22.github.io/KORPl/"
PATH = [BOT, "Bot Settings", "Configure Mini App", "Enable Mini App"]


def labels(msg):
    return [b.text for row in (msg.buttons or []) for b in row]


def show(msg):
    print(f"< {(msg.message or '')[:300]}")
    print(f"  кнопки: {labels(msg)}\n")


async def main():
    env = {k: os.environ.get(k, "") for k in ("TG_API_ID", "TG_API_HASH", "TG_SESSION")}
    if not all(env.values()):
        print("Нет TG_API_ID, TG_API_HASH или TG_SESSION.")
        return
    async with TelegramClient(StringSession(env["TG_SESSION"]), int(env["TG_API_ID"]), env["TG_API_HASH"]) as client:
        bf = await client.get_entity("BotFather")
        async with client.conversation(bf, timeout=30) as conv:
            await conv.send_message("/cancel")
            show(await conv.get_response())
            await conv.send_message("/mybots")
            msg = await conv.get_response()
            show(msg)
            for want in PATH:
                hit = next((b for b in labels(msg) if want.lower() in b.lower()), None)
                if not hit:
                    print(f"Нет кнопки «{want}». Остановился, ничего не нажимаю.")
                    return
                print(f"> жму «{hit}»")
                await msg.click(text=hit)
                await asyncio.sleep(2)
                fresh = await client.get_messages(bf, ids=msg.id)
                last = (await client.get_messages(bf, limit=1))[0]
                msg = last if last.id != fresh.id and last.out is False else fresh
                show(msg)
            # после «Enable Mini App» BotFather просит ссылку отдельным сообщением
            await conv.send_message(APP)
            print(f"> {APP}")
            show(await conv.get_response())


if __name__ == "__main__":
    asyncio.run(main())
