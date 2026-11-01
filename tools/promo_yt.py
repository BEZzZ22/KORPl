"""Загрузка Shorts на YouTube из очереди promo/yt_queue.json через официальный YouTube Data API v3.
Секреты: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (токен получают один раз скриптом tools/yt_token.py).
Не больше одного ролика за прогон и не чаще раза в 5 часов. Состояние: promo/yt_posted.json (id -> id видео и время).
Важно: пока проект Google не прошёл аудит YouTube API, загруженные видео остаются приватными, их открывают вручную в YouTube Studio.
Каждый прогон сначала обменивает refresh-токен у Google: если токен умер, прогон красный сразу, а не в день загрузки.
Расписание GitHub на бесплатном тарифе срабатывает раз в 5–7 часов, поэтому с --wait прогон сам ждёт ролик,
который выходит в ближайшие WAIT_MAX, и грузит его минута в минуту (репо открытое, минуты Actions бесплатные).
Запуск: python tools/promo_yt.py [--dry | --check | --wait]  (--check: только проверить токен, ничего не загружать)"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE, POSTED = ROOT / "promo" / "yt_queue.json", ROOT / "promo" / "yt_posted.json"
MIN_GAP = timedelta(hours=5)
WAIT_MAX = timedelta(hours=5, minutes=30)


def due(queue, posted, now=None):
    """Один ролик за прогон; следующий не раньше чем через MIN_GAP после предыдущего."""
    now = now or datetime.now(timezone.utc)
    last = max((datetime.fromisoformat(v["at"]) for v in posted.values() if isinstance(v, dict) and v.get("at")), default=None)
    if last and now - last < MIN_GAP and not os.environ.get("PROMO_FORCE"):
        return []
    ready = [p for p in queue if p["id"] not in posted and not p.get("retired") and datetime.fromisoformat(p["at"]) <= now]
    ready.sort(key=lambda p: datetime.fromisoformat(p["at"]))
    return ready[:1]


def next_at(queue, posted, now=None):
    """Когда due() отдаст следующий ролик: время из очереди, но не раньше MIN_GAP после прошлого. None, если ждать нечего."""
    now = now or datetime.now(timezone.utc)
    left = [datetime.fromisoformat(p["at"]) for p in queue if p["id"] not in posted and not p.get("retired")]
    if not left:
        return None
    last = max((datetime.fromisoformat(v["at"]) for v in posted.values() if isinstance(v, dict) and v.get("at")), default=None)
    at = max([min(left)] + ([last + MIN_GAP] if last else []))
    return max(at, now)


def wait_for_next():
    queue = json.loads(QUEUE.read_text(encoding="utf-8"))
    posted = json.loads(POSTED.read_text(encoding="utf-8")) if POSTED.exists() else {}
    now = datetime.now(timezone.utc)
    at = next_at(queue, posted, now)
    if at and now < at <= now + WAIT_MAX:
        print(f"Следующий ролик в {at.isoformat(timespec='minutes')}, жду {int((at - now).total_seconds() // 60)} мин.", flush=True)
        time.sleep((at - now).total_seconds() + 30)


def main():
    dry = "--dry" in sys.argv
    env = {k: os.environ.get(k, "") for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN")}
    if not dry and not all(env.values()):
        print("Нет YT_CLIENT_ID, YT_CLIENT_SECRET или YT_REFRESH_TOKEN: загружать некуда, пропускаю.")
        return
    if not dry:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

        creds = Credentials(None, refresh_token=env["YT_REFRESH_TOKEN"], client_id=env["YT_CLIENT_ID"], client_secret=env["YT_CLIENT_SECRET"],
                            token_uri="https://oauth2.googleapis.com/token")
        from google.auth.exceptions import RefreshError

        try:
            creds.refresh(Request())
        except RefreshError as e:
            if "invalid_grant" not in str(e):
                raise
            # в статусе Testing Google гасит refresh-токен через 7 дней — так и было 30.10
            print("::error::Токен YouTube умер (invalid_grant). Google Cloud -> Auth Platform -> Audience: статус In production, "
                  "потом на компьютере python tools/yt_token.py и новый токен в секрет YT_REFRESH_TOKEN.")
            sys.exit(1)
        print("Токен YouTube живой.")
        if "--check" in sys.argv:
            return
    if "--wait" in sys.argv:
        wait_for_next()             # токен проверен до ожидания; протухший access-токен клиент Google обновит сам
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
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

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
