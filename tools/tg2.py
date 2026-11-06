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


async def password():
    pend = promo_tokens.load("tg2_pending", None)
    if not pend:
        sys.exit("Нет начатого входа: action=code.")
    c = client(pend["session"])
    await c.connect()
    await c.sign_in(password=os.environ["TG2_PASSWORD"])
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


PROFILE = {"first_name": "Менеджер", "last_name": "| DotaRazbor",
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
            "дота 7.", "dota патч", "дота билды", "dota builds", "дота аккаунты",
            "мемы дота", "дота юмор", "дота клипы", "дота нарезки", "дота хайлайты", "dota clips", "dota memes", "дотка",
            "дотеры чат", "дота канал", "дота 2 приколы", "дота 2 мемы", "дота 2 новости", "дота сборки", "дота мид",
            "дота керри", "дота саппорт", "пудж", "инвокер", "дота рейтинг", "дота турниры", "дота лор", "дота арт",
            "дота 2 гайды", "дота 2 чат", "дота 2 пати", "dota 2 ru", "дота ру", "дота блог", "дота тима", "дота кастомки"]
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


async def expand():
    """Только чтение: «похожие каналы» от каждого Дота-канала из базы + контакты админов из закрепа и последних постов."""
    import re
    import time
    from telethon.tl.functions.channels import GetChannelRecommendationsRequest, GetFullChannelRequest
    from telethon.tl.types import Channel

    c = await connected()
    known = json.loads(TARGETS.read_text(encoding="utf-8")) if TARGETS.exists() else {}
    stop = time.time() + int(os.environ.get("EXPAND_MIN", "25")) * 60

    async def add(ch):
        full = await c(GetFullChannelRequest(ch))
        about = full.full_chat.about or ""
        known[ch.username] = {"title": ch.title, "kind": "group" if ch.megagroup else "channel",
                              "members": full.full_chat.participants_count, "about": about[:600],
                              "contacts": contacts_in(about)}

    new = 0
    for name in [k for k, v in known.items() if is_dota(v) and not v.get("rec") and "error" not in v]:
        if time.time() > stop:
            break
        try:
            res = await c(GetChannelRecommendationsRequest(channel=await c.get_input_entity(name)))
            for ch in res.chats:
                if isinstance(ch, Channel) and ch.username and ch.username not in known:
                    try:
                        await add(ch)
                        new += 1
                    except Exception as e:
                        known[ch.username] = {"title": ch.title, "error": type(e).__name__}
                    await asyncio.sleep(2)
        except Exception as e:
            print(f"похожие: {type(e).__name__}")
            if "Flood" in type(e).__name__:
                break
        known[name]["rec"] = 1
        await asyncio.sleep(3)
    print(f"Новых площадок через «похожие»: {new}")

    found = 0
    for name, v in sorted(known.items(), key=lambda kv: kv[1].get("members") or 0):
        if time.time() > stop:
            break
        if "error" in v or v.get("contacts") or v.get("scanned") or not is_dota(v) or not 100 <= (v.get("members") or 0) <= 5000:
            continue
        try:
            text = []
            async for m in c.iter_messages(name, limit=20):
                text.append(text_of(m))
            from telethon.tl.types import InputMessagesFilterPinned
            pin = await c.get_messages(name, limit=3, filter=InputMessagesFilterPinned)
            text += [text_of(m) for m in pin]
            blob = "\n".join(text)
            cont = contacts_in(blob)
            cont += [u for u in re.findall(r"(?:реклам|сотрудн|по вопросам|админ)[^\n]{0,40}?@([A-Za-z0-9_]{5,32})", blob, re.I)]
            cont = [u for u in dict.fromkeys(cont) if u.lower() != name.lower() and not u.lower().endswith("bot")]
            v["contacts"] = cont[:3]
            found += bool(cont)
        except Exception as e:
            print(f"посты: {type(e).__name__}")
            if "Flood" in type(e).__name__:
                break
        v["scanned"] = 1
        await asyncio.sleep(2)
    print(f"Нашёл контакты в постах: {found}")
    await c.disconnect()
    TARGETS.write_text(json.dumps(known, ensure_ascii=False, indent=1), encoding="utf-8")
    small = [k for k, v in known.items() if is_dota(v) and v.get("contacts") and 100 <= (v.get("members") or 0) <= 5000]
    print(f"Всего в базе: {len(known)}, мелких Дота-площадок с контактом: {len(small)}")


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


OUR_CHATS = ["dotarazbor_chat"]  # наш чат: менеджер отвечает там на вопросы про бота


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
    if not main:  # акк менеджера ещё и дежурит в нашем чате (туда же падают комменты канала)
        for name in OUR_CHATS:
            try:
                msgs = []
                async for m in c.iter_messages(name, limit=30):
                    who = m.sender
                    msgs.append({"me": m.out, "id": m.id, "reply_to": m.reply_to_msg_id, "t": m.date.isoformat(timespec="minutes"),
                                 "from": getattr(who, "username", None) or getattr(who, "first_name", None) or getattr(who, "title", ""),
                                 "text": text_of(m)})
                out["#" + name] = {"name": name, "unread": 0, "msgs": msgs[::-1]}
            except Exception as e:
                print(f"чат {name}: {type(e).__name__}")
    (promo_tokens.DIR / ("inbox_main.enc" if main else "inbox.enc")).write_text(seal(out), encoding="utf-8")
    return len(out), sum(v["unread"] for v in out.values())


async def people_folder(c):
    """Папка «Люди» (id 4): все личные диалоги с живыми людьми (админы, ответившие). Боты и каналы сюда не попадают."""
    from telethon.tl.functions.messages import UpdateDialogFilterRequest
    from telethon.tl.types import DialogFilter, TextWithEntities, User

    peers = []
    async for d in c.iter_dialogs(limit=300):
        e = d.entity
        if isinstance(e, User) and not e.bot and not e.is_self and e.id != 777000:
            peers.append(d.input_entity)
    if not peers:
        return 0
    peers = peers[:100]
    try:
        f = DialogFilter(id=4, title=TextWithEntities(text="Люди", entities=[]), pinned_peers=[],
                         include_peers=peers, exclude_peers=[])
    except TypeError:
        f = DialogFilter(id=4, title="Люди", pinned_peers=[], include_peers=peers, exclude_peers=[])
    await c(UpdateDialogFilterRequest(id=4, filter=f))
    return len(peers)


async def folder():
    """Папка «DotaRazbor»: наш канал, чат, бот. Папка «Люди»: личные диалоги с людьми."""
    from telethon.tl.functions.messages import UpdateDialogFilterRequest
    from telethon.tl.types import DialogFilter, TextWithEntities

    c = await connected()
    names = ["Dota_Razbor", "dotarazbor_chat", "DotaRazbor_bot"]  # люди живут в отдельной папке «Люди»
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
    print(f"Папка «{title}»: {len(peers)} чатов")
    print(f"Папка «Люди»: {await people_folder(c)} диалогов")
    await c.disconnect()


TEST_TEXT = ("Всем привет! Я менеджер DotaRazbor. Если бот где-то тупит или есть идея, что добавить в разбор, "
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
    lo, hi = int(os.environ.get("JOIN_MIN", "150")), int(os.environ.get("JOIN_MAX_MEMBERS", "3000"))
    # бартер с ноунеймом берут каналы нашего размера, крупные — только за деньги (Ярик 02.11)
    pool = sorted(((k, v) for k, v in targets.items() if "error" not in v and is_dota(v) and k not in joined
                   and lo <= (v.get("members") or 0) <= hi),
                  key=lambda kv: (not kv[1].get("contacts"), -(kv[1].get("members") or 0)))
    c = await connected()
    done = dead = 0
    for name, v in pool:
        if done >= JOIN_MAX:
            break
        try:
            ent = await c.get_entity(name)
            if not await alive(c, ent):
                joined.append(name)  # дохлый: больше не проверяем
                dead += 1
                print(f"Пропуск, дохлый: {v.get('kind')} {v.get('members')}")
                await asyncio.sleep(5)
                continue
            await c(JoinChannelRequest(ent))
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
    print(f"Вступил за прогон: {done}, дохлых пропущено: {dead}, осталось в базе: {len(pool) - done - dead}")


ALIVE_DAYS = 14      # канал без постов дольше — дохлый, там нечего делать


async def alive(c, ent):
    """Последнее сообщение в канале или группе свежее ALIVE_DAYS дней."""
    import datetime
    msgs = await c.get_messages(ent, limit=1)
    if not msgs or not msgs[0].date:
        return False
    return msgs[0].date > datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=ALIVE_DAYS)


async def prune():
    """Выходит из дохлых каналов и групп (кроме наших) и переписывает joined.json по тому, где акк реально сидит."""
    from telethon.tl.types import Channel, Chat

    c = await connected()
    keep, left = [], 0
    async for d in c.iter_dialogs():
        ent = d.entity
        if not isinstance(ent, (Channel, Chat)):
            continue
        name = getattr(ent, "username", None) or str(d.id)
        if name.lower() in ("dota_razbor", "dotarazbor_chat"):
            keep.append(name)
            continue
        if await alive(c, ent):
            keep.append(name)
        else:
            await c.delete_dialog(ent)
            left += 1
            print(f"Вышел из дохлого: {d.name}")
        await asyncio.sleep(2)
    old = json.loads(JOINED.read_text(encoding="utf-8")) if JOINED.exists() else []
    targets = json.loads(TARGETS.read_text(encoding="utf-8")) if TARGETS.exists() else {}
    # старые записи (прошлого акка) снимаем, чтобы join снова их проверил; дохлые из базы помечаем
    JOINED.write_text(json.dumps(keep, ensure_ascii=False, indent=1), encoding="utf-8")
    await make_folder(c, 3, "Дота-чаты", [k for k in keep if k in targets])
    await c.disconnect()
    print(f"Вышел из дохлых: {left}, осталось каналов и групп: {len(keep)} (было в joined.json: {len(old)})")


GROUP_TEXT = ("Всем привет. Я из команды DotaRazbor: сделали бесплатного бота, который по ID матча разбирает катку — "
              "где слил лайн, от чего умирал, что не так со сборкой. Если интересно глянуть свою игру: @DotaRazbor_bot. "
              "Если тут такое не к месту, скажите, удалю.")
NO_ADS = ("реклам", "ссылк", "пиар", "спам", "сторонн", "ботов", "promo", "ads")
GROUP_MAX = 3


async def group_post():
    """Один открытый пост от менеджера в группы из TARGET (через запятую), где в описании и закрепе нет запрета рекламы.
    Не больше GROUP_MAX за прогон, пауза между постами. Куда уже писали — повторно не пишем."""
    import datetime
    from telethon.tl.functions.channels import GetFullChannelRequest
    from telethon.tl.types import Channel

    log_f = ROOT / "promo" / "group_posts.json"
    done = json.loads(log_f.read_text(encoding="utf-8")) if log_f.exists() else {}
    names = [n.strip().lstrip("@") for n in os.environ.get("TARGET", "").split(",") if n.strip()]
    c = await connected()
    posted = 0
    for name in names:
        if posted >= GROUP_MAX:
            break
        force = name.startswith("!")  # "!чат" — пост без проверки правил, только по прямому решению владельца
        name = name.lstrip("!")
        if name in done and done[name] != "skip":
            print("уже писали — пропуск")
            continue
        try:
            ent = await c.get_entity(name)
            if not (isinstance(ent, Channel) and ent.megagroup):
                print("не группа — пропуск")
                continue
            full = await c(GetFullChannelRequest(ent))
            rules_text = (full.full_chat.about or "").lower()
            if full.full_chat.pinned_msg_id:
                m = await c.get_messages(ent, ids=full.full_chat.pinned_msg_id)
                rules_text += " " + (text_of(m) if m else "").lower()
            if not force and any(w in rules_text for w in NO_ADS):
                print("в правилах запрет или реклама через админа — пропуск")
                done[name] = "skip"
                continue
            if getattr(ent, "left", False):
                from telethon.tl.functions.channels import JoinChannelRequest
                await c(JoinChannelRequest(ent))
                print("вступил")
                await asyncio.sleep(30)
            await c.send_message(ent, GROUP_TEXT, link_preview=False)
            done[name] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes")
            posted += 1
            print("пост отправлен")
        except Exception as e:
            print(f"ошибка: {type(e).__name__}: {str(e)[:120]}")
        await asyncio.sleep(90)
    await c.disconnect()
    log_f.write_text(json.dumps(done, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Постов за прогон: {posted}")


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


PARTNERS = ROOT / "promo" / "partners.json"   # чаты, где админ дал добро на наши посты


async def main_post():
    """Пост с основы в чат партнёра (TARGET) — только если он в promo/partners.json.
    Текст — promo/posts/<TARGET>.txt; файла нет — только показать инфо о чате (название, участники, описание)."""
    from telethon.tl.functions.channels import GetFullChannelRequest

    target = os.environ.get("TARGET", "").strip().lstrip("@").replace("https://t.me/", "")
    allowed = {x.lower() for x in json.loads(PARTNERS.read_text(encoding="utf-8"))} if PARTNERS.exists() else set()
    if target.lower() not in allowed:
        sys.exit(f"@{target} нет в promo/partners.json — без добра админа не постим.")
    c = client(os.environ["TG_SESSION"])
    await c.connect()
    ent = await c.get_entity(target)
    full = await c(GetFullChannelRequest(ent))
    print(f"Чат: {ent.title}, участников: {full.full_chat.participants_count}")
    print("Описание:", (full.full_chat.about or "-")[:500])
    post = ROOT / "promo" / "posts" / f"{target}.txt"
    if post.exists() and post.read_text(encoding="utf-8").strip():
        m = await c.send_message(ent, post.read_text(encoding="utf-8").strip(), link_preview=False)
        print(f"Опубликовано, id {m.id}")
        if os.environ.get("PIN") == "1":
            try:
                await c.pin_message(ent, m, notify=False)
                print("Закреплено")
            except Exception as e:
                print(f"закреп: {type(e).__name__}")
        post.unlink()
    await c.disconnect()


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
    files = [str(f) for f in (promo_tokens.DIR / "inbox_main.enc", INBOX, SENT, DONE) if f.exists()]
    sh("git", "add", *files)
    if not sh("git", "diff", "--cached", "--name-only"):
        return
    sh("git", "commit", "-q", "-m", msg)
    for _ in range(4):
        sh("git", "pull", "--rebase", "-q")
        sh("git", "push", "-q")
        if "ahead" not in sh("git", "status", "-sb"):
            return


def notify(text="Новое сообщение в рабочей переписке."):
    """Комментарий в открытом PR очереди будит ассистента. Без имён и текста переписки."""
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    owner = repo.split("/")[0]
    num = sh("gh", "api", f"repos/{repo}/pulls?state=open&head={owner}:{QUEUE_BRANCH}", "--jq", ".[0].number")
    if num and num != "null":
        sh("gh", "api", f"repos/{repo}/issues/{num}/comments", "-f", f"body={text}")
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
        if not iid or iid in done or item.get("from", "main") != state.get("acc", "main"):
            continue
        to = item["to"].lstrip("@")
        cold = not item.get("reply")
        if cold and (state["cold"] >= COLD_MAX or to.lower() in (k.lower() for k in sent)):
            continue
        try:
            ent = await c.get_entity(to)
            if to in OUR_CHATS:  # ответ в нашем чате, можно реплаем на сообщение
                await c.send_message(ent, item["text"], reply_to=item.get("reply_to"), link_preview=False)
                print("Отправлено в наш чат")
            elif isinstance(ent, User) and not ent.bot:
                await c.send_message(ent, item["text"])
                sent[to] = datetime.datetime.utcnow().isoformat(timespec="minutes")
                state["cold"] += cold
                print("Отправлено")
            else:
                print(f"не человек — пропуск: {type(ent).__name__} bot={getattr(ent, 'bot', None)}")
        except Exception as e:
            print(f"ошибка отправки: {type(e).__name__}: {str(e)[:120]}")
            if type(e).__name__ in ("PeerFloodError", "FloodWaitError"):
                # лимит Телеги: письмо остаётся в очереди, смену не долбим дальше
                state["cold"] = COLD_MAX
                break
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

    global SENT, DONE
    acc = "tg2" if os.environ.get("FROM") == "tg2" else "main"
    if acc == "tg2":  # акк менеджера: вся его личка рабочая, свои файлы очереди, чтобы не драться с основой
        SENT = ROOT / "promo" / "outreach_sent_tg2.json"
        DONE = ROOT / "promo" / "outreach_done_tg2.json"
    saved = promo_tokens.load("main_listen" if acc == "main" else "tg2", None)
    if not saved:
        sys.exit("Нет сессии дежурного.")
    c = client(saved["session"])
    await c.connect()
    if not await c.is_user_authorized():
        sys.exit("Сессия дежурного слетела: нужен новый вход.")
    state = {"new": False, "cold": 0, "acc": acc}
    our_ids = set()
    if acc == "tg2":
        from telethon.tl.functions.channels import JoinChannelRequest
        for name in OUR_CHATS:
            try:
                ent = await c.get_entity(name)
                await c(JoinChannelRequest(ent))
                from telethon.utils import get_peer_id
                our_ids.add(get_peer_id(ent))
            except Exception as e:
                print(f"вход в {name}: {type(e).__name__}")

    @c.on(events.NewMessage(incoming=True))
    async def on_msg(ev):
        if not ev.is_private:
            # будим только на живой текст от людей: без вступлений, без автопостов канала и своих сообщений
            if acc == "tg2" and ev.chat_id in our_ids and (ev.raw_text or "").strip() and not ev.out:
                snd = await ev.get_sender()
                if isinstance(snd, User) and not snd.bot:
                    state["new"] = True
            return
        who = await ev.get_sender()
        work = {k.lower() for k in json.loads(SENT.read_text(encoding="utf-8"))} if SENT.exists() else set()
        if isinstance(who, User) and not who.bot and who.id != 777000 and (acc == "tg2" or (who.username or "").lower() in work):
            state["new"] = True

    end = time.time() + LISTEN_MIN * 60
    print(f"Дежурю {LISTEN_MIN:.0f} мин")
    next_folder = 0
    try:  # при старте смены сразу выгружаем личку, чтобы ничего не пропустить между сменами
        await dump_inbox(c, acc == "main")
        git_save("Дежурный: входящие")
    except Exception as e:
        print(f"выгрузка при старте: {type(e).__name__}")
    while time.time() < end:
        await asyncio.sleep(20)
        if acc == "tg2" and time.time() >= next_folder:  # папка «Люди» обновляется прямо из дежурного, второй клиент на сессии не нужен
            next_folder = time.time() + 1800
            try:
                print(f"Папка «Люди»: {await people_folder(c)}")
            except Exception as e:
                print(f"папка: {type(e).__name__}")
        try:
            sent_any = await process_queue(c, state)
        except Exception as e:
            print(f"очередь: {type(e).__name__}")
            sent_any = False
        if state["new"]:
            state["new"] = False
            await asyncio.sleep(15)  # человек часто пишет несколькими сообщениями подряд
            await dump_inbox(c, acc == "main")
            git_save("Дежурный: входящие")
            notify("Новое сообщение в рабочей переписке." if acc == "main" else "Новое сообщение на акке менеджера.")
        elif sent_any:
            git_save("Дежурный: отправлено")
    await c.disconnect()
    ref = os.environ.get("GITHUB_REF_NAME", "")
    if ref:  # следующая смена
        sh("gh", "workflow", "run", "tg2.yml", "--ref", ref, "-f", "action=listen", "-f", f"from={acc}")
        print("Запустил следующую смену")


async def forget():
    """Отвязка акка менеджера (Ярик 02.11): выходим из его сессии и стираем всё, что с ним связано. Сам акк не удаляем."""
    saved = promo_tokens.load("tg2", None)
    if saved:
        from telethon.tl.functions.auth import LogOutRequest
        c = client(saved["session"])
        try:
            await c.connect()
            await c(LogOutRequest())
            print("Сессия акка менеджера закрыта.")
        except Exception as e:
            print("Выйти не вышло (сессия уже мертва?):", type(e).__name__)
        finally:
            await c.disconnect()
    for f in (promo_tokens.DIR / "tg2.enc", promo_tokens.DIR / "tg2_pending.enc", INBOX):
        f.unlink(missing_ok=True)
    print("Файлы акка менеджера удалены.")


if __name__ == "__main__":
    act = os.environ.get("ACTION", "rules")
    if act == "code" and os.environ.get("CODE", "").strip():
        act = "login"
    if act == "main_code" and os.environ.get("CODE", "").strip():
        act = "main_login"  # код вбит в поле — значит, это вход, даже если action забыли переключить
    if act == "code":
        asyncio.run(send_code())
    elif act in ("discover", "send", "inbox", "folder", "test", "join", "fix", "mute", "main_code", "main_login", "main_whoami", "main_qr", "main_join", "main_post", "listen", "forget", "expand", "prune", "group_post"):
        asyncio.run(globals()[act]())
    elif act == "setup":
        asyncio.run(setup())
    elif act == "password":  # код уже принят, не подошёл только облачный пароль: повтор с новым TG2_PASSWORD
        asyncio.run(password())
    elif act == "login":
        asyncio.run(login(os.environ.get("CODE", "")))
    else:
        asyncio.run(rules())
