"""Вход в Телеграм-аккаунт проекта по QR-коду: печатает строку-сессию для секрета GitHub TG_SESSION.

Нужен, когда код входа не приходит (СМС и сообщение от Telegram). QR сканируешь с телефона, где аккаунт уже открыт:
Настройки -> Устройства -> Подключить устройство.

Запускать на СВОЁМ компьютере, не в чате и без VPN:
    pip install telethon "qrcode[pil]"
    python tg-session-qr.py
Спросит api_id и api_hash (my.telegram.org). Откроет в браузере страницу qr.html с QR-кодом, она сама обновляет код.
Если стоит пароль двухфакторки, спросит его (ввод не виден). Строка-сессия даёт полный доступ к аккаунту:
клади её только в секрет GitHub, в чат и в репозиторий не вставляй. Утекла: Телеграм -> Настройки -> Устройства -> завершить сеанс.
"""
import asyncio
import base64
import getpass
import io
import webbrowser
from pathlib import Path

import qrcode
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.sessions import StringSession

PAGE = Path("qr.html")


def write_page(url):
    buf = io.BytesIO()
    qrcode.make(url).save(buf, format="PNG")
    png = base64.b64encode(buf.getvalue()).decode()
    PAGE.write_text(
        '<meta charset="utf-8"><meta http-equiv="refresh" content="2">'
        '<body style="font-family:sans-serif;text-align:center;background:#fff">'
        "<h2>Телеграм на телефоне: Настройки - Устройства - Подключить устройство - наведи камеру</h2>"
        f'<img src="data:image/png;base64,{png}" style="width:360px"></body>',
        encoding="utf-8",
    )


async def main():
    api_id = int(input("api_id: ").strip())
    api_hash = input("api_hash: ").strip()
    client = TelegramClient(StringSession(), api_id, api_hash)
    await client.connect()
    qr = await client.qr_login()
    write_page(qr.url)
    webbrowser.open(PAGE.resolve().as_uri())
    print("Открыл qr.html в браузере. Сканируй QR с телефона. Жду...")
    while True:
        try:
            await qr.wait(20)
            break
        except asyncio.TimeoutError:
            await qr.recreate()
            write_page(qr.url)
        except SessionPasswordNeededError:
            await client.sign_in(password=getpass.getpass("Пароль двухфакторки (не виден при вводе): "))
            break
    me = await client.get_me()
    PAGE.unlink(missing_ok=True)
    print(f"\nВошли как {me.first_name} (id {me.id}). Строка-сессия, целиком в секрет TG_SESSION:\n")
    print(client.session.save())
    await client.disconnect()


asyncio.run(main())
