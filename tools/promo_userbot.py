"""Автопостинг в канал от имени отдельного аккаунта проекта (Telethon). Очередь та же, что у tools/promo-post.mjs:
promo/queue.json, что вышло — promo/posted.json. Нужны TG_API_ID, TG_API_HASH, TG_SESSION и PROMO_CHAT (@канал или id).
Только посты в свой канал: ни массовых личных сообщений, ни рассылок по чужим чатам (за это Телеграм банит аккаунты).
Запуск: python tools/promo_userbot.py [--dry]
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE, POSTED = ROOT / "promo" / "queue.json", ROOT / "promo" / "posted.json"


def due(queue, posted, now=None, limit=2):
    """Какие посты пора выпускать: время наступило, ещё не выходили, не больше limit за раз."""
    now = now or datetime.now(timezone.utc)
    ready = [p for p in queue if p.get("id") and p.get("text") and p["id"] not in posted
             and datetime.fromisoformat(p["at"]) <= now]
    ready.sort(key=lambda p: datetime.fromisoformat(p["at"]))
    return ready[:limit]


def body(post):
    """У аккаунта нет кнопок под постом (они только у ботов): ссылка из кнопки уходит в конец текста."""
    text = post["text"]
    button = post.get("button")
    if button and button["url"] not in text:
        text += f"\n\n{button['text']}: {button['url']}"
    return text


async def main():
    dry = "--dry" in sys.argv
    env = {k: os.environ.get(k, "") for k in ("TG_API_ID", "TG_API_HASH", "TG_SESSION", "PROMO_CHAT")}
    if not dry and not all(env.values()):
        print("Нет TG_API_ID, TG_API_HASH, TG_SESSION или PROMO_CHAT: постить некуда, пропускаю.")
        return
    queue = json.loads(QUEUE.read_text(encoding="utf-8"))
    posted = json.loads(POSTED.read_text(encoding="utf-8")) if POSTED.exists() else {}
    posts = due(queue, posted)
    if not posts:
        print("Пока нечего постить.")
        return
    if dry:
        for p in posts:
            print(f"[dry] {p['id']}: {body(p)[:60]}…")
        return
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    chat = env["PROMO_CHAT"]
    async with TelegramClient(StringSession(env["TG_SESSION"]), int(env["TG_API_ID"]), env["TG_API_HASH"]) as client:
        target = await client.get_entity(int(chat) if chat.lstrip("-").isdigit() else chat)
        for p in posts:
            photo = ROOT / p["photo"] if p.get("photo") else None
            msg = await client.send_message(target, body(p), file=str(photo) if photo else None, link_preview=True)
            posted[p["id"]] = msg.id
            POSTED.write_text(json.dumps(posted, ensure_ascii=False, indent=1), encoding="utf-8")  # сразу: упавший следующий пост не повторит этот
            print(f"Отправлен {p['id']}, сообщение {msg.id}")


if __name__ == "__main__":
    asyncio.run(main())
