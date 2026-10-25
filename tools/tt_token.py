"""Одноразовое получение TT_REFRESH_TOKEN для загрузки роликов в TikTok через Content Posting API.
Запускать на СВОЁМ компьютере: pip install requests && python tt_token.py
Спросит Client key и Client secret (developers.tiktok.com -> твоё приложение). Откроется вход в TikTok: войди в аккаунт канала
и разреши доступ. Тебя перекинет на страницу «Код получен» — скопируй оттуда адрес целиком и вставь сюда.
В конце напечатает refresh token: положи его в секрет GitHub TT_REFRESH_TOKEN. В чат и в репозиторий токен не вставляй."""
import secrets
import webbrowser
from urllib.parse import parse_qs, urlencode, urlparse

import requests

REDIRECT = "https://bezzz22.github.io/KORPl/oauth.html"
key = input("Client key: ").strip()
secret = input("Client secret: ").strip()
state = secrets.token_urlsafe(16)
url = "https://www.tiktok.com/v2/auth/authorize/?" + urlencode({
    "client_key": key, "scope": "user.info.basic,video.upload,video.publish", "response_type": "code",
    "redirect_uri": REDIRECT, "state": state})
print("\nОткрываю вход в TikTok. Если браузер не открылся, перейди сам:\n" + url)
webbrowser.open(url)
back = parse_qs(urlparse(input("\nАдрес страницы «Код получен»: ").strip()).query)
if back.get("state", [""])[0] != state:
    raise SystemExit("state не совпал: начни заново.")
r = requests.post("https://open.tiktokapis.com/v2/oauth/token/", timeout=30, data={
    "client_key": key, "client_secret": secret, "code": back["code"][0], "grant_type": "authorization_code",
    "redirect_uri": REDIRECT}).json()
if "refresh_token" not in r:
    raise SystemExit(f"TikTok не выдал токен: {r}")
print(f"\nГотово (доступы: {r.get('scope')}). Refresh token, целиком в секрет TT_REFRESH_TOKEN:\n")
print(r["refresh_token"])
