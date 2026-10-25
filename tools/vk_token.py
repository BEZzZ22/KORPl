"""Одноразовое получение VK_REFRESH_TOKEN и VK_DEVICE_ID для загрузки клипов в сообщество VK (VK ID, OAuth 2.1 + PKCE).
Запускать на СВОЁМ компьютере: pip install requests && python vk_token.py
Спросит ID приложения VK ID. Откроется вход VK: войди аккаунтом АДМИНА сообщества и разреши доступ. Тебя перекинет
на страницу «Код получен» — скопируй оттуда адрес целиком и вставь сюда.
В конце напечатает два значения для секретов GitHub VK_REFRESH_TOKEN и VK_DEVICE_ID. В чат и в репозиторий их не вставляй."""
import base64
import hashlib
import secrets
import webbrowser
from urllib.parse import parse_qs, urlencode, urlparse

import requests

REDIRECT = "https://bezzz22.github.io/KORPl/oauth.html"
client_id = input("ID приложения VK ID: ").strip()
verifier = secrets.token_urlsafe(48)
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
state = secrets.token_urlsafe(16)
url = "https://id.vk.com/authorize?" + urlencode({
    "response_type": "code", "client_id": client_id, "scope": "video wall groups", "redirect_uri": REDIRECT,
    "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
print("\nОткрываю вход VK. Если браузер не открылся, перейди сам:\n" + url)
webbrowser.open(url)
back = parse_qs(urlparse(input("\nАдрес страницы «Код получен»: ").strip()).query)
if back.get("state", [""])[0] != state:
    raise SystemExit("state не совпал: начни заново.")
device = back["device_id"][0]
r = requests.post("https://id.vk.com/oauth2/auth", timeout=30, data={
    "grant_type": "authorization_code", "code": back["code"][0], "code_verifier": verifier, "client_id": client_id,
    "device_id": device, "redirect_uri": REDIRECT, "state": state}).json()
if "refresh_token" not in r:
    raise SystemExit(f"VK не выдал токен: {r}")
print(f"\nГотово (доступы: {r.get('scope')}).\nVK_REFRESH_TOKEN:\n{r['refresh_token']}\n\nVK_DEVICE_ID:\n{device}")
