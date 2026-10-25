"""Shorts в VK Клипы сообщества по той же очереди promo/yt_queue.json.
Секреты: VK_CLIENT_ID (приложение VK ID), VK_REFRESH_TOKEN и VK_DEVICE_ID (один раз, tools/vk_token.py), VK_GROUP_ID (число,
id сообщества без минуса), PROMO_TOKEN_KEY (tools/promo_tokens.py). Токен — от админа сообщества.
Клип грузится через shortVideo.create. Метод в документации VK не описан, поэтому если он откажет, ролик уходит обычным видео
сообщества (video.save, документирован) с постом на стене — прогон пишет, каким путём ушло.
Не больше одного ролика за прогон и не чаще раза в 5 часов. Что вышло — promo/vk_posted.json.
Запуск: python tools/promo_vk.py [--dry | --check]  (--check: только обновить токен)"""
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import promo_tokens  # noqa: E402
from promo_yt import due  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
QUEUE, POSTED = ROOT / "promo" / "yt_queue.json", ROOT / "promo" / "vk_posted.json"


class VkError(Exception):
    pass


def refresh(env):
    """VK ID: refresh-токен одноразовый, новый сразу сохраняем."""
    import requests

    old = promo_tokens.load("vk", {"refresh_token": env["VK_REFRESH_TOKEN"], "device_id": env["VK_DEVICE_ID"]})
    r = requests.post("https://id.vk.com/oauth2/auth", timeout=30, data={
        "grant_type": "refresh_token", "refresh_token": old["refresh_token"], "client_id": env["VK_CLIENT_ID"],
        "device_id": old["device_id"], "state": secrets.token_urlsafe(16)}).json()
    if "access_token" not in r:
        sys.exit(f"VK не обновил токен: {r}. Перевыпусти через tools/vk_token.py, обнови VK_REFRESH_TOKEN и VK_DEVICE_ID, удали promo/tokens/vk.enc.")
    promo_tokens.save("vk", {"refresh_token": r["refresh_token"], "device_id": old["device_id"]})
    return r["access_token"]


def call(token, method, v="5.199", **params):
    import requests

    r = requests.post(f"https://api.vk.com/method/{method}", timeout=60, data={**params, "access_token": token, "v": v}).json()
    if "error" in r:
        raise VkError(f"{method}: {r['error'].get('error_code')} {r['error'].get('error_msg')}")
    return r["response"]


def text(post):
    title = post["title"].replace("#Shorts", "").strip()
    return title, f"{title}\n\nРазбор твоей катки в Телеграме: @DotaRazbor_bot\nhttps://t.me/DotaRazbor_bot\n\n#dota2 #дота2 #доташка"


def as_clip(token, group, path, desc):
    import requests

    slot = call(token, "shortVideo.create", v="5.282", group_id=group, file_size=path.stat().st_size, description=desc, wallpost=1)
    with path.open("rb") as f:
        resp = requests.post(slot["upload_url"], files={"file": (path.name, f, "video/mp4")}, timeout=600)
    if resp.status_code != 200 or "error" in resp.text[:200].lower():
        raise VkError(f"загрузка клипа: {resp.status_code} {resp.text[:300]}")
    return f"clip{slot['owner_id']}_{slot['video_id']}"


def as_video(token, group, path, title, desc):
    import requests

    slot = call(token, "video.save", group_id=group, name=title, description=desc, wallpost=1, repeat=1)
    with path.open("rb") as f:
        resp = requests.post(slot["upload_url"], files={"video_file": (path.name, f, "video/mp4")}, timeout=600)
    if resp.status_code != 200 or "error" in resp.json():
        raise VkError(f"загрузка видео: {resp.status_code} {resp.text[:300]}")
    return f"video{slot['owner_id']}_{slot['video_id']}"


def main():
    dry = "--dry" in sys.argv
    env = {k: os.environ.get(k, "") for k in ("VK_CLIENT_ID", "VK_REFRESH_TOKEN", "VK_DEVICE_ID", "VK_GROUP_ID", "PROMO_TOKEN_KEY")}
    if not dry and not all(env.values()):
        print("Нет VK_CLIENT_ID, VK_REFRESH_TOKEN, VK_DEVICE_ID, VK_GROUP_ID или PROMO_TOKEN_KEY: в VK не грузим, пропускаю.")
        return
    if "--check" in sys.argv:
        refresh(env)
        print("Токен VK живой.")
        return
    queue = json.loads(QUEUE.read_text(encoding="utf-8"))
    posted = json.loads(POSTED.read_text(encoding="utf-8")) if POSTED.exists() else {}
    posts = due(queue, posted)
    if not posts:
        print("Пока нечего загружать.")
        return
    post = posts[0]
    title, desc = text(post)
    if dry:
        print(f"[dry] {post['id']}: {title}")
        return
    # токен обновляем только когда есть что грузить: каждый раз он новый и коммитится в репо
    token = refresh(env)
    group, path = env["VK_GROUP_ID"].lstrip("-"), ROOT / post["video"]
    try:
        ref, how = as_clip(token, group, path, desc), "clip"
    except VkError as e:
        print(f"Клипом не вышло ({e}), гружу обычным видео сообщества.")
        ref, how = as_video(token, group, path, title, desc), "video"
    posted[post["id"]] = {"ref": ref, "how": how, "at": datetime.now(timezone.utc).isoformat()}
    POSTED.write_text(json.dumps(posted, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{post['id']}: https://vk.com/{ref}")


if __name__ == "__main__":
    main()
