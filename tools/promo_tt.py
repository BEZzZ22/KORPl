"""Shorts в TikTok по той же очереди promo/yt_queue.json через официальный Content Posting API.
Секреты: TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_REFRESH_TOKEN (один раз, tools/tt_token.py), PROMO_TOKEN_KEY (tools/promo_tokens.py).
Режимы (переменная TT_MODE):
  inbox  (по умолчанию) — ролик падает черновиком во «Входящие» TikTok, публикуешь сам в приложении. Работает без аудита.
  direct — сразу публикация. Пока приложение не прошло аудит TikTok, видно только тебе, а аккаунт должен быть закрытым.
TikTok идёт быстрее YouTube: даты из очереди не ждёт, берёт следующий не залитый ролик по порядку,
раз в TT_GAP_HOURS часов (по умолчанию 3) и только днём по Москве (9:00–23:00). Что вышло — promo/tt_posted.json.
Запуск: python tools/promo_tt.py [--dry | --check]"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import promo_tokens  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
QUEUE, POSTED = ROOT / "promo" / "yt_queue.json", ROOT / "promo" / "tt_posted.json"
API = "https://open.tiktokapis.com/v2"
SINGLE_MAX, CHUNK = 64 * 1024 * 1024, 10 * 1024 * 1024
MAX_FILE = 30 * 1024 * 1024    # ролики по 50–65 МБ (12 Мбит/с) TikTok обрабатывал часами и отдавал обрезанными на середине
MSK, DAY = timezone(timedelta(hours=3)), range(9, 23)


def due(queue, posted, now=None):
    """Следующий ролик для TikTok: по порядку очереди, не чаще раза в TT_GAP_HOURS и только днём по Москве."""
    now = now or datetime.now(timezone.utc)
    force = os.environ.get("PROMO_FORCE")
    if now.astimezone(MSK).hour not in DAY and not force:
        return []
    gap = timedelta(hours=float(os.environ.get("TT_GAP_HOURS") or 3))
    last = max((datetime.fromisoformat(v["at"]) for v in posted.values() if isinstance(v, dict) and v.get("at")), default=None)
    if last and now - last < gap - timedelta(minutes=10) and not force:   # запас на сдвиг крона
        return []
    return [p for p in queue if p["id"] not in posted and (ROOT / p["video"]).exists()][:1]


def refresh(env):
    """Новый access-токен. TikTok может выдать новый refresh-токен — тогда сохраняем его."""
    import requests

    old = promo_tokens.load("tt", {"refresh_token": env["TT_REFRESH_TOKEN"]})
    r = requests.post(f"{API}/oauth/token/", timeout=30, data={
        "client_key": env["TT_CLIENT_KEY"], "client_secret": env["TT_CLIENT_SECRET"],
        "grant_type": "refresh_token", "refresh_token": old["refresh_token"]}).json()
    if "access_token" not in r:
        sys.exit(f"TikTok не обновил токен: {r}. Перевыпусти через tools/tt_token.py и обнови TT_REFRESH_TOKEN, удалив promo/tokens/tt.enc.")
    if r.get("refresh_token") and r["refresh_token"] != old["refresh_token"]:
        promo_tokens.save("tt", {"refresh_token": r["refresh_token"]})
    return r["access_token"]


def caption(post):
    """Подпись: заголовок без #Shorts, ссылка на бота и теги."""
    title = post["title"].replace("#Shorts", "").strip()
    return f"{title}\n\nБот в Телеграме: @DotaRazbor_bot\n\n#dota2 #дота2 #доташка #разбор #dota"


def chunks(size):
    """Правила TikTok: до 64 МБ одним куском, иначе куски по 10 МБ, остаток уходит в последний."""
    if size <= SINGLE_MAX:
        return size, 1
    return CHUNK, size // CHUNK


def upload(token, post, mode):
    import requests

    head = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"}
    path = ROOT / post["video"]
    size = path.stat().st_size
    if size > MAX_FILE:
        sys.exit(f"{post['video']}: {size // 2**20} МБ, больше {MAX_FILE // 2**20}. Пережми (promo_hero.py держит битрейт до 5 Мбит/с), иначе TikTok режет ролик.")
    chunk, count = chunks(size)
    body = {"source_info": {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk, "total_chunk_count": count}}
    if mode == "direct":
        info = requests.post(f"{API}/post/publish/creator_info/query/", headers=head, timeout=30).json()["data"]
        options = info.get("privacy_level_options", [])
        privacy = "PUBLIC_TO_EVERYONE" if "PUBLIC_TO_EVERYONE" in options else "SELF_ONLY"
        body["post_info"] = {"title": caption(post), "privacy_level": privacy, "disable_duet": False,
                             "disable_stitch": False, "disable_comment": False, "video_cover_timestamp_ms": 1000}
        url = f"{API}/post/publish/video/init/"
    else:
        url = f"{API}/post/publish/inbox/video/init/"
    r = requests.post(url, headers=head, json=body, timeout=30).json()
    if r.get("error", {}).get("code") != "ok":
        sys.exit(f"TikTok не принял ролик: {r.get('error')}")
    publish_id, upload_url = r["data"]["publish_id"], r["data"]["upload_url"]
    data = path.read_bytes()
    for i in range(count):
        start = i * chunk
        end = size if i == count - 1 else start + chunk
        resp = requests.put(upload_url, data=data[start:end], timeout=300, headers={
            "Content-Type": "video/mp4", "Content-Length": str(end - start), "Content-Range": f"bytes {start}-{end - 1}/{size}"})
        if resp.status_code not in (200, 201, 206):
            sys.exit(f"TikTok оборвал загрузку на куске {i + 1}/{count}: {resp.status_code} {resp.text[:300]}")
    status = "UPLOADED"
    for _ in range(40):
        time.sleep(15)
        try:
            s = requests.post(f"{API}/post/publish/status/fetch/", headers=head, json={"publish_id": publish_id}, timeout=30).json()
        except ValueError:
            continue  # TikTok иногда отвечает пустым телом: ролик уже залит, просто спросим ещё раз
        status = s.get("data", {}).get("status") or status
        if status in ("PUBLISH_COMPLETE", "SEND_TO_USER_INBOX"):
            return publish_id, status
        if status == "FAILED":
            sys.exit(f"TikTok не опубликовал ролик: {s['data'].get('fail_reason')}")
    return publish_id, status


def main():
    dry = "--dry" in sys.argv
    env = {k: os.environ.get(k, "") for k in ("TT_CLIENT_KEY", "TT_CLIENT_SECRET", "TT_REFRESH_TOKEN", "PROMO_TOKEN_KEY")}
    if not dry and not all(env.values()):
        print("Нет TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_REFRESH_TOKEN или PROMO_TOKEN_KEY: в TikTok не грузим, пропускаю.")
        return
    token = None if dry else refresh(env)
    if token:
        print("Токен TikTok живой.")
    if "--check" in sys.argv:
        return
    queue = json.loads(QUEUE.read_text(encoding="utf-8"))
    posted = json.loads(POSTED.read_text(encoding="utf-8")) if POSTED.exists() else {}
    posts = due(queue, posted)
    if not posts:
        print("Пока нечего загружать.")
        return
    post, mode = posts[0], os.environ.get("TT_MODE", "inbox")
    if dry:
        print(f"[dry] {post['id']} ({mode}): {caption(post)!r}")
        return
    publish_id, status = upload(token, post, mode)
    posted[post["id"]] = {"publish_id": publish_id, "status": status, "mode": mode, "at": datetime.now(timezone.utc).isoformat()}
    POSTED.write_text(json.dumps(posted, ensure_ascii=False, indent=1), encoding="utf-8")
    where = "во «Входящие» TikTok, допубликуй в приложении" if status == "SEND_TO_USER_INBOX" else "опубликован"
    print(f"{post['id']}: {where} ({status}).")
    if mode == "inbox":
        print("Подпись для TikTok:\n" + caption(post))


if __name__ == "__main__":
    main()
