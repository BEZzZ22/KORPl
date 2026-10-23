"""Загрузка Shorts на YouTube из очереди promo/yt_queue.json через официальный YouTube Data API v3.
Секреты: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (токен получают один раз скриптом tools/yt_token.py).
Не больше одного ролика за прогон и не чаще раза в 5 часов. Состояние: promo/yt_posted.json (id -> id видео и время).
Важно: пока проект Google не прошёл аудит YouTube API, загруженные видео остаются приватными, их открывают вручную в YouTube Studio.
Запуск: python tools/promo_yt.py [--dry]"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE, POSTED = ROOT / "promo" / "yt_queue.json", ROOT / "promo" / "yt_posted.json"
MIN_GAP = timedelta(hours=5)


def due(queue, posted, now=None):
    """Один ролик за прогон; следующий не раньше чем через MIN_GAP после предыдущего."""
    now = now or datetime.now(timezone.utc)
    last = max((datetime.fromisoformat(v["at"]) for v in posted.values() if isinstance(v, dict) and v.get("at")), default=None)
    if last and now - last < MIN_GAP:
        return []
    ready = [p for p in queue if p["id"] not in posted and datetime.fromisoformat(p["at"]) <= now]
    ready.sort(key=lambda p: datetime.fromisoformat(p["at"]))
    return ready[:1]


def main():
    dry = "--dry" in sys.argv
    env = {k: os.environ.get(k, "") for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN")}
    if not dry and not all(env.values()):
        print("Нет YT_CLIENT_ID, YT_CLIENT_SECRET или YT_REFRESH_TOKEN: загружать некуда, пропускаю.")
        return
    queue = json.loads(QUEUE.read_text(encoding="utf-8"))
    posted = json.loads(POSTED.read_text(encoding="utf-8")) if POSTED.exists() else {}
    posts = due(queue, posted)
    if not posts:
        print("Пока нечего загружать.")
        return
    post = posts[0]
    if dry:
        print(f"[dry] {post['id']}: {post['title']}")
        return
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    creds = Credentials(None, refresh_token=env["YT_REFRESH_TOKEN"], client_id=env["YT_CLIENT_ID"], client_secret=env["YT_CLIENT_SECRET"],
                        token_uri="https://oauth2.googleapis.com/token")
    yt = build("youtube", "v3", credentials=creds, cache_discovery=False)
    body = {
        "snippet": {"title": post["title"], "description": post["description"], "tags": post.get("tags", []), "categoryId": "20"},
        "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
    }
    req = yt.videos().insert(part="snippet,status", body=body, media_body=MediaFileUpload(str(ROOT / post["video"]), mimetype="video/mp4", resumable=True))
    resp = None
    while resp is None:
        _, resp = req.next_chunk()
    posted[post["id"]] = {"video_id": resp["id"], "at": datetime.now(timezone.utc).isoformat()}
    POSTED.write_text(json.dumps(posted, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Загружен {post['id']}: https://youtube.com/shorts/{resp['id']}")


if __name__ == "__main__":
    main()
