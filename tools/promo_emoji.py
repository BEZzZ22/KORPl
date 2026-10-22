"""Поиск анимированных премиум-эмодзи для постов: показывает id, которые идут в promo/emoji.json.
Нужны TG_API_ID, TG_API_HASH, TG_SESSION (те же секреты, что у автопостинга).
    python tools/promo_emoji.py search dota,fire,shield   - наборы эмодзи по запросам (название, short_name, сколько штук)
    python tools/promo_emoji.py pack <short_name>[,...]   - все эмодзи набора: id и обычный символ
    python tools/promo_emoji.py chat <часть названия чата> - какие премиум-эмодзи и наборы стикеров есть в чате (последние 300 сообщений):
                                                             печатаются только id, символы и названия наборов, текст сообщений не выводится
Запускается из GitHub Actions: «Премиум-эмодзи (поиск id)». Постить кастомными эмодзи может только аккаунт с Telegram Premium.
"""
import asyncio
import os
import sys

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import GetCustomEmojiDocumentsRequest, GetStickerSetRequest, SearchEmojiStickerSetsRequest
from telethon.tl.types import (DocumentAttributeCustomEmoji, DocumentAttributeSticker, InputStickerSetShortName,
                               MessageEntityCustomEmoji)

CHAT_LIMIT = 300


async def scan_chat(client, part):
    """Премиум-эмодзи (id, символ, сколько раз) и наборы стикеров из чата: из текста и подписей берём только сущности эмодзи."""
    target = None
    async for dialog in client.iter_dialogs():
        if part.lower() in (dialog.name or "").lower():
            target = dialog
            break
    if not target:
        print(f"Чат с «{part}» в названии не найден среди диалогов этого аккаунта.")
        return
    print(f"Чат: {target.name}")
    emoji, sets = {}, {}
    async for msg in client.iter_messages(target.entity, limit=CHAT_LIMIT):
        for ent in msg.entities or []:
            if isinstance(ent, MessageEntityCustomEmoji):
                emoji[ent.document_id] = emoji.get(ent.document_id, 0) + 1
        doc = getattr(msg, "sticker", None)
        if doc:
            attr = next((a for a in doc.attributes if isinstance(a, DocumentAttributeSticker)), None)
            if attr and getattr(attr.stickerset, "id", None):
                sets[attr.stickerset.id] = attr.stickerset
    print(f"\nПремиум-эмодзи в тексте: {len(emoji)}")
    ids = list(emoji)
    for i in range(0, len(ids), 100):
        for doc in await client(GetCustomEmojiDocumentsRequest(document_id=ids[i:i + 100])):
            alt = next((a.alt for a in doc.attributes if isinstance(a, DocumentAttributeCustomEmoji)), "?")
            print(f"{doc.id}\t{alt}\tраз: {emoji.get(doc.id, 0)}")
    print(f"\nНаборы стикеров: {len(sets)}")
    for ref in sets.values():
        got = await client(GetStickerSetRequest(ref, 0))
        print(f"{got.set.short_name}\t{got.set.title}\t{got.set.count} шт.{' (эмодзи-набор)' if got.set.emojis else ''}")


async def main(mode, names):
    env = {k: os.environ.get(k, "") for k in ("TG_API_ID", "TG_API_HASH", "TG_SESSION")}
    if not all(env.values()):
        print("Нет TG_API_ID, TG_API_HASH или TG_SESSION.")
        return
    async with TelegramClient(StringSession(env["TG_SESSION"]), int(env["TG_API_ID"]), env["TG_API_HASH"]) as client:
        me = await client.get_me()
        print(f"Аккаунт: {me.first_name}, Premium: {'да' if getattr(me, 'premium', False) else 'НЕТ (кастомные эмодзи не отправятся)'}")
        for name in names:
            print(f"\n== {mode} {name}")
            if mode == "chat":
                await scan_chat(client, name)
            elif mode == "search":
                found = await client(SearchEmojiStickerSetsRequest(q=name, hash=0))
                for covered in getattr(found, "sets", [])[:12]:
                    s = covered.set
                    print(f"{s.short_name}\t{s.title}\t{s.count} шт.")
            else:
                got = await client(GetStickerSetRequest(InputStickerSetShortName(name), 0))
                for doc in got.documents:
                    alt = next((a.alt for a in doc.attributes if isinstance(a, DocumentAttributeCustomEmoji)), "?")
                    print(f"{doc.id}\t{alt}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], [n.strip() for n in sys.argv[2].split(",") if n.strip()]))
