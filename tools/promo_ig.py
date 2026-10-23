"""Публикация рилсов в Инстаграм из очереди promo/ig_queue.json (неофициальный Private API через instagrapi).
Это НЕ официальный API: вход по cookie sessionid, риск блокировки аккаунта принимает владелец. Постим только рилсы по расписанию,
без лайков, подписок и директа. Состояние: promo/ig_posted.json (id -> код публикации и время).
Нужен секрет IG_SESSIONID (cookie sessionid из браузера, где ты вошёл в Инстаграм). Запуск: python tools/promo_ig.py [--dry]"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE, POSTED = ROOT / "promo" / "ig_queue.json", ROOT / "promo" / "ig_posted.json"
MIN_GAP = timedelta(hours=20)  # не чаще одного рилса за 20 часов, как живой человек


def due(queue, posted, now=None):
    """Не больше одного рилса за прогон; следующий не раньше чем через MIN_GAP после предыдущего."""
    now = now or datetime.now(timezone.utc)
    last = max((datetime.fromisoformat(v["at"]) for v in posted.values() if isinstance(v, dict) and v.get("at")), default=None)
    if last and now - last < MIN_GAP:
        return []
    ready = [p for p in queue if p["id"] not in posted and datetime.fromisoformat(p["at"]) <= now]
    ready.sort(key=lambda p: datetime.fromisoformat(p["at"]))
    return ready[:1]


def main():
    dry = "--dry" in sys.argv
    sessionid = os.environ.get("IG_SESSIONID", "")
    if not dry and not sessionid:
        print("Нет IG_SESSIONID: публиковать некуда, пропускаю.")
        return
    queue = json.loads(QUEUE.read_text(encoding="utf-8"))
    posted = json.loads(POSTED.read_text(encoding="utf-8")) if POSTED.exists() else {}
    posts = due(queue, posted)
    if not posts:
        print("Пока нечего публиковать.")
        return
    post = posts[0]
    if dry:
        print(f"[dry] {post['id']}: {post['caption'][:60]}…")
        return
    from instagrapi import Client

    cl = Client()
    cl.delay_range = [2, 6]
    cl.set_locale("ru_RU")
    cl.set_timezone_offset(3 * 3600)
    cl.login_by_sessionid(sessionid)
    media = cl.clip_upload(ROOT / post["video"], post["caption"], thumbnail=ROOT / post["cover"])
    posted[post["id"]] = {"code": media.code, "at": datetime.now(timezone.utc).isoformat()}
    POSTED.write_text(json.dumps(posted, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Опубликован {post['id']}: {media.code}")


if __name__ == "__main__":
    main()
