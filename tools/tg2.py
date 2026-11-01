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

    c = await connected(allow_main=True)
    n, unread = await dump_inbox(c, FROM_MAIN)
    await c.disconnect()
    print(f"Диалогов: {n}, непрочитанных: {unread}")


async def dump_inbox(c, main):
    """Пишет зашифрованную выгрузку лички. С основы — ТОЛЬКО диалоги с теми, кому писали по работе, личку Ярика не трогаем."""
    import datetime
    from telethon.tl.types import User

    work = {k.lower() for k in json.loads(SENT.read_text(encoding="utf-8"))} if SENT.exists() else set()
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=3)
    out = {}
    async for d in c.iter_dialogs(limit=200):
        if d.id == 777000 or not isinstance(d.entity, User) or d.entity.bot:
            continue
        if main and (d.entity.username or "").lower() not in work:
            continue
        if d.date and d.date < since:
            continue
        msgs = []
        async for m in c.iter_messages(d.entity, limit=30):
            msgs.append({"me": m.out, "t": m.date.isoformat(timespec="minutes"), "text": text_of(m)})
        out[d.entity.username or str(d.id)] = {"name": " ".join(filter(None, [d.entity.first_name, d.entity.last_name])),
                                               "unread": d.unread_count, "msgs": msgs[::-1]}
    (promo_tokens.DIR / ("inbox_main.enc" if main else "inbox.enc")).write_text(seal(out), encoding="utf-8")
    return len(out), sum(v["unread"] for v in out.values())


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


async def fix():
    """Переписывает уже отправленные письма: если в диалоге есть наше сообщение за последние 6 ч — правит его на новый текст
    из promo/outreach.json, иначе отправляет. Двойных писем не будет."""
    import datetime
    from telethon.tl.types import User

    queue = json.loads(OUTBOX.read_text(encoding="utf-8")) if OUTBOX.exists() else []
    sent = json.loads(SENT.read_text(encoding="utf-8")) if SENT.exists() else {}
    c = await connected(allow_main=True)
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=6)
    rest, new_sent = [], 0
    for item in queue:
        to = item["to"].lstrip("@")
        try:
            ent = await c.get_entity(to)
            if not isinstance(ent, User) or ent.bot:
                continue
            mine = None
            async for m in c.iter_messages(ent, limit=10):
                if m.out and m.date >= since:
                    mine = m
                    break
            if mine:
                from telethon.tl.functions.messages import GetPeerDialogsRequest
                pd = await c(GetPeerDialogsRequest(peers=[await c.get_input_entity(ent)]))
                if pd.dialogs and pd.dialogs[0].read_outbox_max_id >= mine.id:
                    print(f"Уже прочитано, не трогаю: @{to}")
                elif (mine.message or "") != item["text"]:
                    await c.edit_message(ent, mine, item["text"])
                print(f"Исправлено: @{to}")
            elif new_sent < 5:
                await c.send_message(ent, item["text"])
                new_sent += 1
                print(f"Отправлено: @{to}")
                await asyncio.sleep(SEND_GAP)
            else:
                rest.append(item)
                continue
            sent[to] = datetime.datetime.utcnow().isoformat(timespec="minutes")
        except Exception as e:
            print(f"{to}: {type(e).__name__}")
            rest.append(item)
    await c.disconnect()
    OUTBOX.write_text(json.dumps(rest, ensure_ascii=False, indent=1), encoding="utf-8")
    SENT.write_text(json.dumps(sent, ensure_ascii=False, indent=1), encoding="utf-8")


async def mute():
    """Глушит уведомления во всех чатах акка навсегда (кроме служебного Телеграма)."""
    from telethon.tl.functions.account import UpdateNotifySettingsRequest
    from telethon.tl.types import InputNotifyPeer, InputPeerNotifySettings

    c = await connected()
    n = 0
    async for d in c.iter_dialogs():
        if d.id == 777000:
            continue
        try:
            await c(UpdateNotifySettingsRequest(peer=InputNotifyPeer(d.input_entity),
                                                settings=InputPeerNotifySettings(mute_until=2**31 - 1)))
            n += 1
        except Exception as e:
            print(f"{d.name}: {type(e).__name__}")
        await asyncio.sleep(1)
    await c.disconnect()
    print(f"Заглушено чатов: {n}")


# ---------- дежурный на основе: сразу видит ответы админов и шлёт ответы из очереди ----------
# Отдельная сессия основы (promo/tokens/main_listen.enc), вход по коду, который Ярик присылает сам.
# TG_SESSION для постоянного онлайна не берём: один ключ с двух серверов одновременно Телега считает угоном
# (AUTH_KEY_DUPLICATED) и убивает сессию, а на TG_SESSION по крону ведётся канал.
QUEUE_BRANCH = "claude/project-thread-d0uspr"      # очередь ответов берётся отсюда, без мержа
DONE = ROOT / "promo" / "outreach_done.json"       # id уже отправленных элементов очереди
LISTEN_MIN = float(os.environ.get("LISTEN_MIN") or 340)
COLD_MAX = 5                                       # холодных писем (не ответов) за смену дежурного


def sh(*cmd):
    import subprocess

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(f"{cmd[0]} {cmd[1] if len(cmd) > 1 else ''}: код {r.returncode}")
    return r.stdout.strip()


async def main_code():
    """Шаг 1: Телега шлёт код входа на основу. Номер берём из сессии канала (короткое подключение)."""
    old = client(os.environ["TG_SESSION"])
    await old.connect()
    phone = "+" + (await old.get_me()).phone
    await old.disconnect()
    c = client()
    await c.connect()
    sent = await c.send_code_request(phone)
    promo_tokens.save("main_listen_pending", {"session": c.session.save(), "hash": sent.phone_code_hash, "phone": phone})
    await c.disconnect()
    print(f"Код отправлен, способ: {type(sent.type).__name__}, следующий: {type(sent.next_type).__name__ if sent.next_type else '-'}")


async def main_qr():
    """Вход дежурного без кода (Ярик разрешил 01.11): QR-токен нового входа подтверждаем старой сессией основы."""
    from telethon.errors import SessionPasswordNeededError
    from telethon.tl.functions.auth import AcceptLoginTokenRequest

    old = client(os.environ["TG_SESSION"])
    new = client()
    await old.connect()
    await new.connect()
    qr = await new.qr_login()
    await old(AcceptLoginTokenRequest(token=qr.token))
    await old.disconnect()
    try:
        await qr.wait(60)
    except SessionPasswordNeededError:
        pw = os.environ.get("MAIN_PASSWORD")
        if not pw:
            sys.exit("На основе облачный пароль: нужен секрет MAIN_PASSWORD.")
        await new.sign_in(password=pw)
    if not await new.is_user_authorized():
        sys.exit("Вход не подтвердился.")
    promo_tokens.save("main_listen", {"session": new.session.save()})
    await new.disconnect()
    print("Сессия дежурного сохранена.")


async def main_join():
    """Основа вступает в чат партнёра (TARGET), когда админ просит зайти для выдачи прав."""
    from telethon.tl.functions.channels import JoinChannelRequest

    target = os.environ.get("TARGET", "").strip().lstrip("@").replace("https://t.me/", "")
    if not target:
        sys.exit("Нужен target.")
    c = client(os.environ["TG_SESSION"])
    await c.connect()
    await c(JoinChannelRequest(await c.get_entity(target)))
    await c.disconnect()
    print(f"Вступил: @{target}")


async def main_whoami():
    """Диагностика: какой акк за TG_SESSION и дошёл ли код в служебный чат (сам код в лог не пишем)."""
    c = client(os.environ["TG_SESSION"])
    await c.connect()
    me = await c.get_me()
    u = me.username or "-"
    print(f"Акк: @{u[:3]}…{u[-2:]}, premium={bool(me.premium)}")
    async for m in c.iter_messages(777000, limit=3):
        t = (m.message or "")
        print(f"служебный чат: {m.date:%H:%M} UTC, похоже на код входа: {any(w in t.lower() for w in ('код', 'code'))}")
    await c.disconnect()


async def main_login():
    """Шаг 2: вход с кодом от Ярика (поле code)."""
    from telethon.errors import SessionPasswordNeededError

    pend = promo_tokens.load("main_listen_pending", None)
    if not pend:
        sys.exit("Сначала action=main_code.")
    c = client(pend["session"])
    await c.connect()
    try:
        await c.sign_in(pend["phone"], os.environ.get("CODE", "").strip(), phone_code_hash=pend["hash"])
    except SessionPasswordNeededError:
        pw = os.environ.get("MAIN_PASSWORD")
        if not pw:
            sys.exit("На основе облачный пароль: положи его в секрет MAIN_PASSWORD и повтори main_code.")
        await c.sign_in(password=pw)
    promo_tokens.save("main_listen", {"session": c.session.save()})
    (promo_tokens.DIR / "main_listen_pending.enc").unlink(missing_ok=True)
    await c.disconnect()
    print("Сессия дежурного сохранена.")


def git_save(msg):
    files = [str(f) for f in (promo_tokens.DIR / "inbox_main.enc", SENT, DONE) if f.exists()]
    sh("git", "add", *files)
    if not sh("git", "diff", "--cached", "--name-only"):
        return
    sh("git", "commit", "-q", "-m", msg)
    for _ in range(4):
        sh("git", "pull", "--rebase", "-q")
        sh("git", "push", "-q")
        if "ahead" not in sh("git", "status", "-sb"):
            return


def notify():
    """Комментарий в открытом PR очереди будит ассистента. Без имён и текста переписки."""
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    owner = repo.split("/")[0]
    num = sh("gh", "api", f"repos/{repo}/pulls?state=open&head={owner}:{QUEUE_BRANCH}", "--jq", ".[0].number")
    if num and num != "null":
        sh("gh", "api", f"repos/{repo}/issues/{num}/comments", "-f", "body=Новое сообщение в рабочей переписке.")
        print("Разбудил ассистента")
    else:
        print("Нет открытого PR очереди — будить некого")


async def process_queue(c, state):
    """Шлёт новые элементы очереди (с полем id) из ветки QUEUE_BRANCH. Ответы сразу, холодные — не больше COLD_MAX."""
    import datetime
    from telethon.tl.types import User

    sh("git", "fetch", "-q", "origin", f"+refs/heads/{QUEUE_BRANCH}:refs/remotes/origin/{QUEUE_BRANCH}")
    raw = sh("git", "show", f"origin/{QUEUE_BRANCH}:promo/outreach.json")
    try:
        queue = json.loads(raw) if raw else []
    except ValueError:
        return False
    done = set(json.loads(DONE.read_text(encoding="utf-8"))) if DONE.exists() else set()
    sent = json.loads(SENT.read_text(encoding="utf-8")) if SENT.exists() else {}
    changed = False
    for item in queue:
        iid = item.get("id")
        if not iid or iid in done:
            continue
        to = item["to"].lstrip("@")
        cold = not item.get("reply")
        if cold and (state["cold"] >= COLD_MAX or to.lower() in (k.lower() for k in sent)):
            continue
        try:
            ent = await c.get_entity(to)
            if isinstance(ent, User) and not ent.bot:
                await c.send_message(ent, item["text"])
                sent[to] = datetime.datetime.utcnow().isoformat(timespec="minutes")
                state["cold"] += cold
                print("Отправлено")
            else:
                print("не человек — пропуск")
        except Exception as e:
            print(f"ошибка отправки: {type(e).__name__}")
        done.add(iid)
        changed = True
        await asyncio.sleep(15)
    if changed:
        DONE.write_text(json.dumps(sorted(done), ensure_ascii=False, indent=1), encoding="utf-8")
        SENT.write_text(json.dumps(sent, ensure_ascii=False, indent=1), encoding="utf-8")
    return changed


async def listen():
    import time
    from telethon import events
    from telethon.tl.types import User

    saved = promo_tokens.load("main_listen", None)
    if not saved:
        sys.exit("Нет сессии дежурного: сначала main_code и main_login.")
    c = client(saved["session"])
    await c.connect()
    if not await c.is_user_authorized():
        sys.exit("Сессия дежурного слетела: нужен новый вход (main_code → main_login).")
    state = {"new": False, "cold": 0}

    @c.on(events.NewMessage(incoming=True))
    async def on_msg(ev):
        if not ev.is_private:
            return
        who = await ev.get_sender()
        work = {k.lower() for k in json.loads(SENT.read_text(encoding="utf-8"))} if SENT.exists() else set()
        if isinstance(who, User) and not who.bot and (who.username or "").lower() in work:
            state["new"] = True

    end = time.time() + LISTEN_MIN * 60
    print(f"Дежурю {LISTEN_MIN:.0f} мин")
    while time.time() < end:
        await asyncio.sleep(20)
        try:
            sent_any = await process_queue(c, state)
        except Exception as e:
            print(f"очередь: {type(e).__name__}")
            sent_any = False
        if state["new"]:
            state["new"] = False
            await asyncio.sleep(15)  # человек часто пишет несколькими сообщениями подряд
            await dump_inbox(c, True)
            git_save("Дежурный: входящие")
            notify()
        elif sent_any:
            git_save("Дежурный: отправлено")
    await c.disconnect()
    ref = os.environ.get("GITHUB_REF_NAME", "")
    if ref:  # следующая смена
        sh("gh", "workflow", "run", "tg2.yml", "--ref", ref, "-f", "action=listen", "-f", "from=main")
        print("Запустил следующую смену")


if __name__ == "__main__":
    act = os.environ.get("ACTION", "rules")
    if act == "code" and os.environ.get("CODE", "").strip():
        act = "login"
    if act == "main_code" and os.environ.get("CODE", "").strip():
        act = "main_login"  # код вбит в поле — значит, это вход, даже если action забыли переключить
    if act == "code":
        asyncio.run(send_code())
    elif act in ("discover", "send", "inbox", "folder", "test", "join", "fix", "mute", "main_code", "main_login", "main_whoami", "main_qr", "main_join", "listen"):
        asyncio.run(globals()[act]())
    elif act == "setup":
        asyncio.run(setup())
    elif act == "login":
        asyncio.run(login(os.environ.get("CODE", "")))
    else:
        asyncio.run(rules())
