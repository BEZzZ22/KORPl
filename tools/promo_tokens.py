"""Хранилище одноразовых refresh-токенов TikTok и VK.
Оба сервиса при каждом обновлении выдают НОВЫЙ refresh-токен, а старый умирает, поэтому держать его в секрете GitHub нельзя:
секрет из прогона не перезаписать. Свежий токен шифруется ключом из секрета PROMO_TOKEN_KEY и коммитится в promo/tokens/<имя>.enc.
Первый токен берётся из секрета (TT_REFRESH_TOKEN / VK_REFRESH_TOKEN), дальше живёт в файле.
Ключ: python tools/promo_tokens.py --new-key (один раз, кладётся в секрет PROMO_TOKEN_KEY)."""
import json
import os
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent.parent / "promo" / "tokens"


def _fernet():
    from cryptography.fernet import Fernet

    return Fernet(os.environ["PROMO_TOKEN_KEY"].encode())


def load(name, fallback):
    """Последний сохранённый токен или, если файла ещё нет, то, что лежит в секрете."""
    path = DIR / f"{name}.enc"
    if path.exists():
        return json.loads(_fernet().decrypt(path.read_bytes()))
    return fallback


def save(name, data):
    DIR.mkdir(parents=True, exist_ok=True)
    (DIR / f"{name}.enc").write_bytes(_fernet().encrypt(json.dumps(data).encode()))


def yt_env():
    """YouTube: токен, выпущенный кнопкой (yt-token.yml), лежит в promo/tokens/yt.enc и главнее секрета YT_REFRESH_TOKEN."""
    if os.environ.get("PROMO_TOKEN_KEY") and (DIR / "yt.enc").exists():
        os.environ["YT_REFRESH_TOKEN"] = load("yt", {})["refresh_token"]


if __name__ == "__main__" and "--new-key" in sys.argv:
    from cryptography.fernet import Fernet

    print(Fernet.generate_key().decode())
