"""Поиск анимированных премиум-эмодзи для постов: показывает id, которые идут в promo/emoji.json.
Нужны TG_API_ID, TG_API_HASH, TG_SESSION (те же секреты, что у автопостинга).
    python tools/promo_emoji.py search dota,fire,shield   - наборы эмодзи по запросам (название, short_name, сколько штук)
    python tools/promo_emoji.py pack <short_name>[,...]   - все эмодзи набора: id и обычный символ
Запускается из GitHub Actions: «Премиум-эмодзи (поиск id)». Постить кастомными эмодзи может только аккаунт с Telegram Premium.
"""
import asyncio
import os
import sys

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import GetStickerSetRequest, SearchEmojiStickerSetsRequest
from telethon.tl.types import DocumentAttributeCustomEmoji, InputStickerSetShortName


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
            if mode == "search":
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
