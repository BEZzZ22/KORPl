"""Чат при канале и бот-админ: один раз создаёт группу-обсуждение канала, оформляет её и делает @DotaRazbor_bot админом
в канале и в чате (без этого бот не может проверить подписку). Повторный запуск ничего не создаёт заново, только
досинхронизирует оформление и права. Итог — docs/community.json: ссылки на канал и чат для приложения и воркера.
Нужны TG_API_ID, TG_API_HASH, TG_SESSION (аккаунт-владелец канала) и PROMO_CHAT (@канал или id).
Запуск: python tools/tg_community.py
"""
import asyncio
import json
import os
from pathlib import Path

from telethon import TelegramClient, errors
from telethon.sessions import StringSession
from telethon.tl.functions.channels import (CheckUsernameRequest, CreateChannelRequest, EditAdminRequest, EditPhotoRequest,
                                            GetFullChannelRequest, SetDiscussionGroupRequest, ToggleSlowModeRequest,
                                            UpdateUsernameRequest)
from telethon.tl.functions.messages import EditChatAboutRequest
from telethon.tl.types import ChatAdminRights, InputChatUploadedPhoto

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "community.json"
PHOTO = ROOT / "promo" / "avatar.png"
BOT = "DotaRazbor_bot"
TITLE = "DotaRazbor | Чат"
USERNAMES = ["dotarazbor_chat", "DotaRazborChat", "dotarazbor_talk", "razbor_dota_chat"]


def about(channel):
    return ("Чат канала DotaRazbor: разборы каток, вопросы по Доте, сборки и мемы. "
            f"Разбор своей игры: @{BOT}" + (f" · Новости: @{channel}" if channel else ""))


def welcome(channel):
    return ("<b>Добро пожаловать в чат DotaRazbor</b>\n\n"
            "Тут обсуждаем катки, разборы и патчи. Скидывай свой разбор из бота — посмотрим вместе, где слил и как поднять игру.\n\n"
            "<b>Правила</b>\n"
            "— Без оскорблений и токсичности: все мы иногда фидим.\n"
            "— Без рекламы, продажи аккаунтов и бустов.\n"
            "— Спам и флуд — бан без предупреждения.\n\n"
            f"Разобрать свою катку: @{BOT}" + (f"\nНовости и советы: @{channel}" if channel else ""))


async def main():
    env = {k: os.environ.get(k, "") for k in ("TG_API_ID", "TG_API_HASH", "TG_SESSION", "PROMO_CHAT")}
    if not all(env.values()):
        print("Нет TG_API_ID, TG_API_HASH, TG_SESSION или PROMO_CHAT.")
        return
    state = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    chat_ref = env["PROMO_CHAT"]
    async with TelegramClient(StringSession(env["TG_SESSION"]), int(env["TG_API_ID"]), env["TG_API_HASH"]) as client:
        channel = await client.get_entity(int(chat_ref) if chat_ref.lstrip("-").isdigit() else chat_ref)
        channel_name = getattr(channel, "username", None)
        bot = await client.get_entity(BOT)

        # группа: берём уже привязанную к каналу, иначе создаём
        full = await client(GetFullChannelRequest(channel))
        linked = full.full_chat.linked_chat_id
        group = None
        if linked:
            group = await client.get_entity(linked)
            print(f"Чат уже привязан: {group.title}")
        else:
            res = await client(CreateChannelRequest(title=TITLE, about=about(channel_name), megagroup=True))
            group = res.chats[0]
            print(f"Создан чат: {group.title}")
            await client(SetDiscussionGroupRequest(broadcast=channel, group=group))
            print("Чат привязан к каналу как обсуждение.")

        group_name = getattr(group, "username", None)
        if not group_name:
            for name in USERNAMES:
                try:
                    if await client(CheckUsernameRequest(group, name)):
                        await client(UpdateUsernameRequest(group, name))
                        group_name = name
                        print(f"Публичная ссылка чата: @{name}")
                        break
                except (errors.UsernameOccupiedError, errors.UsernameInvalidError):
                    continue
                except errors.FloodWaitError as e:
                    print(f"Телеграм просит подождать {e.seconds} с со ссылкой чата.")
                    break

        # оформление: описание и аватарка (как у канала), медленный режим против флуда
        try:
            await client(EditChatAboutRequest(group, about(channel_name)))
        except errors.ChatAboutNotModifiedError:
            pass
        if not state.get("photo") and PHOTO.exists():
            await client(EditPhotoRequest(group, InputChatUploadedPhoto(await client.upload_file(str(PHOTO)))))
            state["photo"] = True
        try:
            await client(ToggleSlowModeRequest(group, 10))
        except errors.RPCError as e:
            print(f"Медленный режим не включился: {e}")

        # бот — админ и в канале, и в чате: только так getChatMember отвечает про подписчиков
        for target, rights in ((channel, ChatAdminRights(invite_users=True)),
                               (group, ChatAdminRights(delete_messages=True, ban_users=True, invite_users=True, pin_messages=True))):
            try:
                await client(EditAdminRequest(target, bot, rights, rank="бот" if target is group else ""))
                print(f"@{BOT} — админ в «{target.title}».")
            except errors.RPCError as e:
                print(f"Не смог сделать @{BOT} админом в «{target.title}»: {e}")

        if not state.get("welcome_id"):
            msg = await client.send_message(group, welcome(channel_name), parse_mode="html", link_preview=False)
            await client.pin_message(group, msg, notify=False)
            state["welcome_id"] = msg.id
            print("Приветствие с правилами закреплено.")

        state.update({
            "channel_id": int(f"-100{channel.id}"), "channel": channel_name, "channel_url": f"https://t.me/{channel_name}" if channel_name else None,
            "chat_id": int(f"-100{group.id}"), "chat": group_name, "chat_url": f"https://t.me/{group_name}" if group_name else None,
        })
        OUT.write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(json.dumps(state, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
