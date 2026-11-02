"""Новый refresh-токен YouTube без Python на компьютере.
1. Открыть ссылку согласия (AUTH ниже, client_id — клиент «Client ID for Desktop» из Google Cloud dotarazborshorts),
   войти в аккаунт канала и разрешить. Браузер уйдёт на http://localhost/?code=... и покажет ошибку — так и надо.
2. Скопировать адрес этой страницы целиком, GitHub Actions -> «YouTube: новый токен» -> Run workflow -> вставить в поле.
Прогон меняет код на refresh-токен (YT_CLIENT_ID и YT_CLIENT_SECRET из секретов), шифрует PROMO_TOKEN_KEY и коммитит в
promo/tokens/yt.enc. promo_yt.py и yt_stats.py берут токен оттуда раньше секрета YT_REFRESH_TOKEN.
Код одноразовый и живёт несколько минут, сам по себе без секрета клиента бесполезен."""
import os
import sys
from urllib.parse import parse_qs, urlencode, urlparse

import promo_tokens

REDIRECT = "http://localhost"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly",
          "https://www.googleapis.com/auth/yt-analytics.readonly"]


def auth_url(client_id):
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": client_id, "redirect_uri": REDIRECT, "response_type": "code", "scope": " ".join(SCOPES),
        "access_type": "offline", "prompt": "consent"})


def code_from(text):
    text = text.strip()
    if "code=" in text:
        return parse_qs(urlparse(text).query).get("code", [""])[0]
    return text


def main():
    import requests

    code = code_from(os.environ.get("YT_CODE", ""))
    if not code:
        sys.exit("::error::Пустое поле: вставь адрес страницы localhost целиком.")
    r = requests.post("https://oauth2.googleapis.com/token", timeout=30, data={
        "code": code, "client_id": os.environ["YT_CLIENT_ID"], "client_secret": os.environ["YT_CLIENT_SECRET"],
        "redirect_uri": REDIRECT, "grant_type": "authorization_code"}).json()
    if "refresh_token" not in r:
        sys.exit(f"::error::Google не выдал токен: {r.get('error')} {r.get('error_description', '')}. "
                 "Код одноразовый и живёт минуты: открой ссылку согласия ещё раз и сразу запусти прогон.")
    missing = [s for s in SCOPES if s not in r.get("scope", "")]
    if missing:
        print(f"::warning::Разрешены не все доступы, нет: {', '.join(missing)}")
    promo_tokens.save("yt", {"refresh_token": r["refresh_token"]})
    print("Готово: токен YouTube сохранён, загрузка Shorts пойдёт со следующего прогона.")


if __name__ == "__main__":
    if "--url" in sys.argv:
        print(auth_url(sys.argv[-1]))
    else:
        main()
