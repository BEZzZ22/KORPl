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


PROFILE = {"first_name": "Максим", "last_name": "| DotaRazbor",
           "about": "Менеджер по партнёрствам @DotaRazbor_bot. Реклама, коллабы — в ЛС"}  # лимит био 70
USERNAMES = ["dotarazbor_manager", "dotarazbor_partners", "dotarazbor_biz"]


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

# ---------- поиск площадок, письма админам, входящие ----------
TARGETS = ROOT / "promo" / "targets.json"          # найденные Дота-чаты и каналы (публичная инфа)
OUTBOX = ROOT / "promo" / "outreach.json"          # очередь писем: [{"to": "username", "text": "..."}]
SENT = ROOT / "promo" / "outreach_sent.json"       # кому уже написали (ник -> дата)
INBOX = promo_tokens.DIR / "inbox.enc"             # входящие, зашифрованы открытым ключом ассистента
PUB = promo_tokens.DIR / "inbox_pub.pem"
DISCOVER = ["dota", "dota 2", "dota2", "дота", "дота 2", "доту", "дотеры", "дотер", "дота мемы", "dota мемы",
            "дота новости", "dota новости", "дота гайды", "dota гайд", "дота стрим", "dota стримы", "дота киберспорт",
            "dota киберспорт", "дота пати", "dota пати", "dota чат", "дота чат", "доташка", "дота приколы", "dota ranked",
            "дота 7.", "dota патч", "дота билды", "dota builds", "дота аккаунты"]
AD_WORDS = ("реклам", "сотрудн", "пиар", "по вопросам", "ads", "promo", "владел", "админ", "менеджер", "связь", "вп")
MAX_SEND = 6          # писем за прогон: свежий акк режут за холодные сообщения пачкой
SEND_GAP = 90         # секунд между письмами


def contacts_in(text):
    import re

    found = []
    for line in (text or "").splitlines():
        if any(w in line.lower() for w in AD_WORDS):
            found += re.findall(r"@([A-Za-z0-9_]{5,32})", line)
    return list(dict.fromkeys(found))


FROM_MAIN = os.environ.get("FROM") == "main"   # слать с основного акка Ярика (секрет TG_SESSION, тот же, что ведёт канал)


async def connected(allow_main=False):
    if FROM_MAIN and allow_main:  # основу — только для send, личку и чаты Ярика не трогаем
        c = client(os.environ["TG_SESSION"])
        await c.connect()
        return c
    saved = promo_tokens.load("tg2", None)
    if not saved:
        sys.exit("Акк не подключён.")
    c = client(saved["session"])
    await c.connect()
    return c


async def discover():
    """Только чтение: ищет публичные Дота-каналы и группы, снимает размер, описание и контакты по рекламе."""
    from telethon.tl.functions.channels import GetFullChannelRequest
    from telethon.tl.functions.contacts import SearchRequest
    from telethon.tl.types import Channel

    c = await connected()
    known = json.loads(TARGETS.read_text(encoding="utf-8")) if TARGETS.exists() else {}
    found = {}
    for q in DISCOVER:
        try:
            res = await c(SearchRequest(q=q, limit=100))
        except Exception as e:
            print(f"поиск «{q}»: {type(e).__name__}")
            await asyncio.sleep(30)
            continue
        for ch in res.chats:
            if isinstance(ch, Channel) and ch.username:
                found[ch.username] = ch
        await asyncio.sleep(4)
    for name, ch in found.items():
        if name in known:
            continue
        try:
            full = await c(GetFullChannelRequest(ch))
            about = full.full_chat.about or ""
            known[name] = {"title": ch.title, "kind": "group" if ch.megagroup else "channel",
                           "members": full.full_chat.participants_count, "about": about[:600],
                           "contacts": contacts_in(about)}
        except Exception as e:
            known[name] = {"title": ch.title, "error": type(e).__name__}
        await asyncio.sleep(3)
    await c.disconnect()
    TARGETS.write_text(json.dumps(known, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Площадок в базе: {len(known)}, с контактом по рекламе: {sum(1 for v in known.values() if v.get('contacts'))}")


async def send():
    """Шлёт письма из очереди promo/outreach.json — только людям (админам и контактам по рекламе), не в группы и каналы."""
    import datetime
    from telethon.errors import FloodWaitError, PeerFloodError
    from telethon.tl.types import User

    queue = json.loads(OUTBOX.read_text(encoding="utf-8")) if OUTBOX.exists() else []
    sent = json.loads(SENT.read_text(encoding="utf-8")) if SENT.exists() else {}
    c = await connected(allow_main=True)
    done = 0
    rest = []
    for item in queue:
        to = item["to"].lstrip("@")
        if done >= (5 if FROM_MAIN else MAX_SEND):  # основу бережём: на ней канал
            rest.append(item)
            continue
        if to.lower() in (k.lower() for k in sent) and not item.get("reply"):
            continue
        try:
            ent = await c.get_entity(to)
            if not isinstance(ent, User) or ent.bot:
                print(f"{to}: не человек — пропуск (в группы и каналы не пишем)")
                continue
            await c.send_message(ent, item["text"])
            sent[to] = datetime.datetime.utcnow().isoformat(timespec="minutes")
            done += 1
            print(f"Отправлено: @{to}")
        except PeerFloodError:
            print("Телега ограничила холодные сообщения (PeerFlood) — стоп до завтра")
            rest.append(item)
            rest += queue[queue.index(item) + 1:]
            break
        except FloodWaitError as e:
            print(f"FloodWait {e.seconds} с — стоп")
            rest.append(item)
            rest += queue[queue.index(item) + 1:]
            break
        except Exception as e:
            print(f"{to}: {type(e).__name__}")
        await asyncio.sleep(SEND_GAP)
    await c.disconnect()
    OUTBOX.write_text(json.dumps(rest, ensure_ascii=False, indent=1), encoding="utf-8")
    SENT.write_text(json.dumps(sent, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Отправлено за прогон: {done}, в очереди: {len(rest)}")


def seal(data):
    """Шифрует открытым ключом ассистента: прочитать может только тот, у кого закрытый ключ (не в репо)."""
    import base64
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    key = Fernet.generate_key()
    pub = serialization.load_pem_public_key(PUB.read_bytes())
    wrapped = pub.encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    return json.dumps({"k": base64.b64encode(wrapped).decode(), "d": Fernet(key).encrypt(json.dumps(data, ensure_ascii=False).encode()).decode()})


async def inbox():
    """Личка акка за последние 3 суток (кроме служебного чата) — в зашифрованный promo/tokens/inbox.enc."""
    import datetime
    from telethon.tl.types import User

    c = await connected()
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=3)
    out = {}
    async for d in c.iter_dialogs(limit=100):
        if d.id == 777000 or not isinstance(d.entity, User) or d.entity.bot:
            continue
        if d.date and d.date < since:
            continue
        msgs = []
        async for m in c.iter_messages(d.entity, limit=30):
            msgs.append({"me": m.out, "t": m.date.isoformat(timespec="minutes"), "text": text_of(m)})
        out[d.entity.username or str(d.id)] = {"name": " ".join(filter(None, [d.entity.first_name, d.entity.last_name])),
                                               "unread": d.unread_count, "msgs": msgs[::-1]}
    await c.disconnect()
    INBOX.write_text(seal(out), encoding="utf-8")
    print(f"Диалогов: {len(out)}, непрочитанных: {sum(v['unread'] for v in out.values())}")


async def folder():
    """Папка «DotaRazbor» с важным: наш канал, чат, бот и все диалоги с админами из outreach_sent.json."""
    from telethon.tl.functions.messages import UpdateDialogFilterRequest
    from telethon.tl.types import DialogFilter, TextWithEntities

    c = await connected()
    names = ["Dota_Razbor", "dotarazbor_chat", "DotaRazbor_bot"]
    if SENT.exists():
        names += list(json.loads(SENT.read_text(encoding="utf-8")))
    peers = []
    for n in names:
        try:
            peers.append(await c.get_input_entity(n))
        except Exception as e:
            print(f"{n}: {type(e).__name__}")
    title = "DotaRazbor"
    try:
        f = DialogFilter(id=2, title=TextWithEntities(text=title, entities=[]), pinned_peers=peers[:3],
                         include_peers=peers[3:], exclude_peers=[])
    except TypeError:  # старые версии Telethon: title строкой
        f = DialogFilter(id=2, title=title, pinned_peers=peers[:3], include_peers=peers[3:], exclude_peers=[])
    await c(UpdateDialogFilterRequest(id=2, filter=f))
    await c.disconnect()
    print(f"Папка «{title}»: {len(peers)} чатов")


TEST_TEXT = ("Всем привет! Я Максим, менеджер DotaRazbor. Если бот где-то тупит или есть идея, что добавить в разбор, "
             "пишите сюда или мне в личку. Кто хочет разбор своей катки — кидайте ID матча в @DotaRazbor_bot.")


async def test():
    """Проверка, что акк пишет: вступает в НАШ чат @dotarazbor_chat и здоровается. И закрывает добавление в левые группы."""
    from telethon.tl.functions.account import SetPrivacyRequest
    from telethon.tl.functions.channels import JoinChannelRequest
    from telethon.tl.types import InputPrivacyKeyChatInvite, InputPrivacyValueAllowContacts

    c = await connected()
    await c(SetPrivacyRequest(key=InputPrivacyKeyChatInvite(), rules=[InputPrivacyValueAllowContacts()]))
    print("Добавлять в группы: только контакты")
    chat = await c.get_entity("dotarazbor_chat")
    await c(JoinChannelRequest(chat))
    await c.send_message(chat, TEST_TEXT)
    print("Сообщение в @dotarazbor_chat отправлено")
    await c.disconnect()


JOIN_MAX = 15        # вступлений за прогон
JOIN_GAP = 60        # секунд между вступлениями
JOINED = ROOT / "promo" / "joined.json"


def is_dota(v):
    t = (v.get("title", "") + " " + v.get("about", "")).lower()
    return any(w in t for w in ("dota", "дота", "доту", "доте", "дотер", "доташ"))


async def join():
    """Вступает в крупнейшие Дота-группы и каналы из promo/targets.json (по JOIN_MAX за прогон) и складывает в папки."""
    from telethon.errors import ChannelsTooMuchError, FloodWaitError, InviteRequestSentError
    from telethon.tl.functions.channels import JoinChannelRequest

    targets = json.loads(TARGETS.read_text(encoding="utf-8")) if TARGETS.exists() else {}
    joined = json.loads(JOINED.read_text(encoding="utf-8")) if JOINED.exists() else []
    pool = sorted(((k, v) for k, v in targets.items() if "error" not in v and is_dota(v) and k not in joined),
                  key=lambda kv: -(kv[1].get("members") or 0))
    c = await connected()
    done = 0
    for name, v in pool:
        if done >= JOIN_MAX:
            break
        try:
            await c(JoinChannelRequest(await c.get_entity(name)))
            joined.append(name)
            done += 1
            print(f"Вступил: {v.get('kind')} {v.get('members')}")
        except InviteRequestSentError:
            joined.append(name)
            print("Заявка на вступление отправлена")
        except FloodWaitError as e:
            print(f"FloodWait {e.seconds} с — стоп")
            break
        except ChannelsTooMuchError:
            print("Лимит групп на акк — стоп")
            break
        except Exception as e:
            print(f"{type(e).__name__}")
        await asyncio.sleep(JOIN_GAP)
    JOINED.write_text(json.dumps(joined, ensure_ascii=False, indent=1), encoding="utf-8")
    await make_folder(c, 3, "Дота-чаты", joined)
    await c.disconnect()
    print(f"Вступил за прогон: {done}, всего: {len(joined)}, осталось в базе: {len(pool) - done}")


async def make_folder(c, fid, title, names, pinned=0):
    from telethon.tl.functions.messages import UpdateDialogFilterRequest
    from telethon.tl.types import DialogFilter, TextWithEntities

    peers = []
    for n in names[:100]:
        try:
            peers.append(await c.get_input_entity(n))
        except Exception:
            pass
    if not peers:
        return
    try:
        f = DialogFilter(id=fid, title=TextWithEntities(text=title, entities=[]), pinned_peers=peers[:pinned],
                         include_peers=peers[pinned:], exclude_peers=[])
    except TypeError:
        f = DialogFilter(id=fid, title=title, pinned_peers=peers[:pinned], include_peers=peers[pinned:], exclude_peers=[])
    await c(UpdateDialogFilterRequest(id=fid, filter=f))
    print(f"Папка «{title}»: {len(peers)}")


if __name__ == "__main__":
    act = os.environ.get("ACTION", "rules")
    if act == "code" and os.environ.get("CODE", "").strip():
        act = "login"  # код вбит в поле — значит, это вход, даже если action забыли переключить
    if act == "code":
        asyncio.run(send_code())
    elif act in ("discover", "send", "inbox", "folder", "test", "join"):
        asyncio.run(globals()[act]())
    elif act == "setup":
        asyncio.run(setup())
    elif act == "login":
        asyncio.run(login(os.environ.get("CODE", "")))
    else:
        asyncio.run(rules())
