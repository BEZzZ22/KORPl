"""Одноразовое получение YT_REFRESH_TOKEN для загрузки Shorts через официальный YouTube Data API.
Запускать на СВОЁМ компьютере (откроется браузер, войди в Google-аккаунт канала и разреши доступ):
    pip install google-auth-oauthlib
    python yt_token.py
Спросит Client ID и Client secret (из Google Cloud: Auth Platform -> Clients). В конце напечатает refresh token:
положи его в секрет GitHub YT_REFRESH_TOKEN. В чат и в репозиторий токен не вставляй."""
from google_auth_oauthlib.flow import InstalledAppFlow

client_id = input("Client ID: ").strip()
client_secret = input("Client secret: ").strip()
flow = InstalledAppFlow.from_client_config(
    {"installed": {"client_id": client_id, "client_secret": client_secret,
                   "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token",
                   "redirect_uris": ["http://localhost"]}},
    scopes=["https://www.googleapis.com/auth/youtube.upload"],
)
creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")
print("\nГотово. Refresh token, целиком в секрет YT_REFRESH_TOKEN:\n")
print(creds.refresh_token)
