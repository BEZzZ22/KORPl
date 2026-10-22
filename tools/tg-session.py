"""Одноразовый вход в Телеграм-аккаунт проекта: печатает строку-сессию для секрета GitHub TG_SESSION.

Запускать на СВОЁМ устройстве (Google Colab в браузере, Termux на Android, любой компьютер), не в чате:
    pip install telethon
    python tg-session.py
Спросит api_id и api_hash (my.telegram.org -> API development tools), номер телефона аккаунта и код из Телеграма.
Код и пароль вводишь ты сам. Строка-сессия даёт полный доступ к аккаунту: клади её только в секрет GitHub,
в чат и в репозиторий не вставляй. Если строка утекла: Телеграм -> Настройки -> Устройства -> завершить сеанс.
"""
from telethon.sessions import StringSession
from telethon.sync import TelegramClient

api_id = int(input("api_id: ").strip())
api_hash = input("api_hash: ").strip()
with TelegramClient(StringSession(), api_id, api_hash) as client:
    me = client.get_me()
    print(f"\nВошли как {me.first_name} (id {me.id}). Строка-сессия, целиком в секрет TG_SESSION:\n")
    print(client.session.save())
