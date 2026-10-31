"""Второй Телеграм-аккаунт для Дота-чатов: вход с телефона через GitHub и чтение правил чатов.

Вход в два прогона workflow «Акк для чатов» (tg2.yml), компьютер не нужен:
  1) action=code  — Телеграм шлёт код входа в приложение на номер из секрета TG2_PHONE;
  2) action=login, code=<код> — входим (облачный пароль берётся из секрета TG2_PASSWORD).
Сессия шифруется ключом PROMO_TOKEN_KEY и лежит в promo/tokens/tg2.enc, в логи ничего личного не пишется.

action=rules — только чтение, ничего не пишет и никуда не вступает: ищет публичные Дота-группы
и для каждой из promo/chats.json и найденных снимает описание и закреп (там обычно правила про рекламу).
Итог — promo/chats_rules.json.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import promo_tokens  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CHATS = ROOT / "promo" / "chats.json"
RULES = ROOT / "promo" / "chats_rules.json"
SEARCH = ["dota", "дота", "dota 2 чат", "дота чат", "dota пати", "дота пати", "dota2"]


def client(session=""):
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    return TelegramClient(StringSession(session), int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"])


async def send_code():
    c = client()
    await c.connect()
    sent = await c.send_code_request(os.environ["TG2_PHONE"])
    promo_tokens.save("tg2_pending", {"session": c.session.save(), "hash": sent.phone_code_hash})
    await c.disconnect()
    print("Код отправлен в Телеграм. Запусти workflow ещё раз: action=login и этот код.")


async def login(code):
    from telethon.errors import SessionPasswordNeededError

    pend = promo_tokens.load("tg2_pending", None)
    if not pend:
        sys.exit("Сначала прогон action=code.")
    c = client(pend["session"])
    await c.connect()
    try:
        await c.sign_in(os.environ["TG2_PHONE"], code.strip(), phone_code_hash=pend["hash"])
    except SessionPasswordNeededError:
        pw = os.environ.get("TG2_PASSWORD")
        if not pw:
            sys.exit("На акке облачный пароль: положи его в секрет TG2_PASSWORD и повтори с action=code.")
        await c.sign_in(password=pw)
    promo_tokens.save("tg2", {"session": c.session.save()})
    (promo_tokens.DIR / "tg2_pending.enc").unlink(missing_ok=True)
    await c.disconnect()
    print("Вход ок, сессия сохранена.")


def text_of(m):
    return (getattr(m, "message", "") or "").strip()


async def rules():
    from telethon.tl.functions.channels import GetFullChannelRequest
    from telethon.tl.functions.contacts import SearchRequest
    from telethon.tl.types import Channel

    saved = promo_tokens.load("tg2", None)
    if not saved:
        sys.exit("Акк не подключён: сначала action=code и action=login.")
    c = client(saved["session"])
    await c.connect()
    names = set(json.loads(CHATS.read_text(encoding="utf-8"))) if CHATS.exists() else set()
    for q in SEARCH:
        try:
            res = await c(SearchRequest(q=q, limit=50))
        except Exception as e:  # поиск может упереться в лимиты — не страшно
            print(f"поиск «{q}»: {type(e).__name__}")
            continue
        for ch in res.chats:
            if isinstance(ch, Channel) and ch.megagroup and ch.username:
                names.add(ch.username)
        await asyncio.sleep(3)
    out = {}
    for name in sorted(names, key=str.lower):
        try:
            ent = await c.get_entity(name)
            if not (isinstance(ent, Channel) and ent.megagroup):
                continue
            full = await c(GetFullChannelRequest(ent))
            pinned = ""
            if full.full_chat.pinned_msg_id:
                m = await c.get_messages(ent, ids=full.full_chat.pinned_msg_id)
                pinned = text_of(m) if m else ""
            out[name] = {"title": ent.title, "members": full.full_chat.participants_count,
                         "about": full.full_chat.about or "", "pinned": pinned[:3000]}
        except Exception as e:
            out[name] = {"error": type(e).__name__}
        await asyncio.sleep(4)
    await c.disconnect()
    RULES.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Групп разобрано: {sum(1 for v in out.values() if 'error' not in v)}, ошибок: {sum(1 for v in out.values() if 'error' in v)}")


PROFILE = {"first_name": "Аксель", "last_name": "| DotaRazbor",
           "about": "Менеджер DotaRazbor. Разбор катки Dota 2 за минуту: @DotaRazbor_bot. Сотрудничество и взаимопиар — пиши."}
USERNAMES = ["dotarazbor_manager", "dotarazbor_axel", "axel_dotarazbor"]


async def setup():
    """Чистит все чаты акка (кроме служебного чата Telegram с кодами входа) и оформляет профиль менеджера."""
    from telethon.errors import UsernameNotModifiedError, UsernameOccupiedError
    from telethon.tl.functions.account import UpdateProfileRequest, UpdateUsernameRequest
    from telethon.tl.functions.photos import DeletePhotosRequest, UploadProfilePhotoRequest

    saved = promo_tokens.load("tg2", None)
    if not saved:
        sys.exit("Акк не подключён.")
    c = client(saved["session"])
    await c.connect()
    gone = 0
    async for d in c.iter_dialogs():
        if d.id == 777000:  # Telegram: сюда приходят коды входа
            continue
        try:
            await c.delete_dialog(d.entity)  # группы и каналы — выйти, личка — удалить у себя
            gone += 1
        except Exception as e:
            print(f"не удалился чат: {type(e).__name__}")
        await asyncio.sleep(1.5)
    print(f"Чатов удалено: {gone}")
    await c(UpdateProfileRequest(**PROFILE))
    old = await c.get_profile_photos("me")
    if old:
        await c(DeletePhotosRequest(old))
    await c(UploadProfilePhotoRequest(file=await c.upload_file(str(ROOT / "promo" / "avatar.png"))))
    for name in USERNAMES:
        try:
            await c(UpdateUsernameRequest(name))
            print(f"Ник: @{name}")
            break
        except UsernameNotModifiedError:
            print(f"Ник уже @{name}")
            break
        except UsernameOccupiedError:
            continue
        except Exception as e:
            print(f"ник {name}: {type(e).__name__}")
    print("Профиль оформлен.")
    await c.disconnect()


if __name__ == "__main__":
    act = os.environ.get("ACTION", "rules")
    if act == "code" and os.environ.get("CODE", "").strip():
        act = "login"  # код вбит в поле — значит, это вход, даже если action забыли переключить
    if act == "code":
        asyncio.run(send_code())
    elif act == "setup":
        asyncio.run(setup())
    elif act == "login":
        asyncio.run(login(os.environ.get("CODE", "")))
    else:
        asyncio.run(rules())
