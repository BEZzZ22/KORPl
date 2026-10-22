"""Автопостинг в канал от имени отдельного аккаунта проекта (Telethon). Очередь та же, что у tools/promo-post.mjs:
promo/queue.json, что вышло — promo/posted.json. Нужны TG_API_ID, TG_API_HASH, TG_SESSION и PROMO_CHAT (@канал или id).
Только посты в свой канал: ни массовых личных сообщений, ни рассылок по чужим чатам (за это Телеграм банит аккаунты).
Запуск: python tools/promo_userbot.py [--dry]
"""
import asyncio
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE, POSTED = ROOT / "promo" / "queue.json", ROOT / "promo" / "posted.json"
CHANNEL, CHANNEL_STATE = ROOT / "promo" / "channel.json", ROOT / "promo" / "channel-state.json"
EMOJI = ROOT / "promo" / "emoji.json"
EMOJI_TAG = re.compile(r"\{e:([a-z0-9_]+)\}")
HTML_TAG = re.compile(r"</?(?:b|i|u|s|code)>")


def load_emoji():
    """promo/emoji.json: ключ -> {"char": обычный эмодзи, "id": id премиум-эмодзи или null}."""
    return json.loads(EMOJI.read_text(encoding="utf-8")) if EMOJI.exists() else {}


def render(text, emoji):
    """Текст поста для Телеграма (HTML): {e:ключ} -> анимированный эмодзи, если известен id, иначе обычный символ."""
    def sub(m):
        e = emoji.get(m.group(1))
        if not e:
            return ""
        return f'<tg-emoji emoji-id="{e["id"]}">{e["char"]}</tg-emoji>' if e.get("id") else e["char"]
    return EMOJI_TAG.sub(sub, text)


def plain(text, emoji):
    """Тот же текст без разметки и без премиум-эмодзи (для лога и для бота)."""
    return HTML_TAG.sub("", EMOJI_TAG.sub(lambda m: emoji.get(m.group(1), {}).get("char", ""), text))


def channel_hash(config, photo_bytes=b""):
    """Хеш оформления канала (название, описание, картинка): правка promo/channel.json или аватарки подхватывается сама."""
    raw = json.dumps([config.get("title"), config.get("about")], ensure_ascii=False).encode() + (photo_bytes or b"")
    return hashlib.sha256(raw).hexdigest()[:16]


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


async def setup_channel(client, target):
    """Название, описание и аватарка из promo/channel.json; применяются один раз на каждое изменение."""
    if not CHANNEL.exists():
        return
    from telethon.tl.functions.channels import EditPhotoRequest, EditTitleRequest
    from telethon.tl.functions.messages import EditChatAboutRequest

    config = json.loads(CHANNEL.read_text(encoding="utf-8"))
    photo_path = ROOT / config["photo"] if config.get("photo") else None
    photo = photo_path.read_bytes() if photo_path and photo_path.exists() else b""
    video_path = ROOT / config["video"] if config.get("video") else None
    video = video_path.read_bytes() if video_path and video_path.exists() else b""
    digest = channel_hash(config, photo + video)
    state = json.loads(CHANNEL_STATE.read_text(encoding="utf-8")) if CHANNEL_STATE.exists() else {}
    if state.get("hash") == digest:
        return
    from telethon.errors import RPCError

    async def apply(coro):
        try:
            await coro
        except RPCError as e:  # «ничего не изменилось» (название, описание, фото те же) — не ошибка
            if "NotModified" not in type(e).__name__ and "NOT_MODIFIED" not in str(e).upper():
                raise

    if config.get("title"):
        await apply(client(EditTitleRequest(target, config["title"])))
    if config.get("about"):
        await apply(client(EditChatAboutRequest(target, config["about"])))
    if video:  # анимированная аватарка (mp4 до 10 с); у бота такой нет, он ставит статичную картинку
        from telethon.tl.types import InputChatUploadedPhoto
        uploaded = await client.upload_file(str(video_path))
        await apply(client(EditPhotoRequest(target, InputChatUploadedPhoto(video=uploaded, video_start_ts=0.0))))
    elif photo:
        from telethon.tl.types import InputChatUploadedPhoto
        await apply(client(EditPhotoRequest(target, InputChatUploadedPhoto(file=await client.upload_file(str(photo_path))))))
    CHANNEL_STATE.write_text(json.dumps({"hash": digest}, indent=1), encoding="utf-8")
    print("Оформление канала обновлено")


async def main():
    dry = "--dry" in sys.argv
    env = {k: os.environ.get(k, "") for k in ("TG_API_ID", "TG_API_HASH", "TG_SESSION", "PROMO_CHAT")}
    if not dry and not all(env.values()):
        print("Нет TG_API_ID, TG_API_HASH, TG_SESSION или PROMO_CHAT: постить некуда, пропускаю.")
        return
    queue = json.loads(QUEUE.read_text(encoding="utf-8"))
    posted = json.loads(POSTED.read_text(encoding="utf-8")) if POSTED.exists() else {}
    posts = due(queue, posted)
    if dry:
        for p in posts:
            print(f"[dry] {p['id']}: {plain(body(p), load_emoji())[:60]}…")
        return
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    chat = env["PROMO_CHAT"]
    async with TelegramClient(StringSession(env["TG_SESSION"]), int(env["TG_API_ID"]), env["TG_API_HASH"]) as client:
        target = await client.get_entity(int(chat) if chat.lstrip("-").isdigit() else chat)
        emoji = load_emoji()
        try:
            await setup_channel(client, target)
        except Exception as e:  # оформление не должно мешать постам
            print(f"Оформление канала не вышло (нужны права админа на изменение профиля): {e}")
        if not posts:
            print("Пока нечего постить.")
        for p in posts:
            photo = ROOT / p["photo"] if p.get("photo") else None
            msg = await client.send_message(target, render(body(p), emoji), parse_mode="html",
                                            file=str(photo) if photo else None, link_preview=True)
            posted[p["id"]] = msg.id
            if p.get("pin"):
                try:
                    await client.pin_message(target, msg, notify=False)
                except Exception as e:
                    print(f"Закрепить не вышло: {e}")
            POSTED.write_text(json.dumps(posted, ensure_ascii=False, indent=1), encoding="utf-8")  # сразу: упавший следующий пост не повторит этот
            print(f"Отправлен {p['id']}, сообщение {msg.id}")


if __name__ == "__main__":
    asyncio.run(main())
