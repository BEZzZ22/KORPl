import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from promo_userbot import body, channel_hash, due, plain, render  # noqa: E402

Q = [
    {"id": "a", "at": "2026-10-23T09:00:00+00:00", "text": "A"},
    {"id": "b", "at": "2026-10-24T09:00:00+00:00", "text": "B"},
    {"id": "c", "at": "2026-10-25T09:00:00+00:00", "text": "C"},
    {"id": "d", "at": "2026-10-22T09:00:00+00:00", "text": "D"},
]


def at(s):
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def test_due_only_arrived_and_not_posted():
    assert [p["id"] for p in due(Q, {"d": 1}, at("2026-10-24T12:00:00+00:00"))] == ["a", "b"]
    assert due(Q, {"a": 1, "b": 2, "d": 3}, at("2026-10-24T12:00:00+00:00")) == []


def test_due_limit_after_downtime():
    assert [p["id"] for p in due(Q, {}, at("2026-11-01T00:00:00+00:00"))] == ["d", "a"]


def test_button_becomes_link_in_text():
    post = {"id": "x", "at": "2026-10-23T09:00:00+00:00", "text": "Привет", "button": {"text": "Разобрать катку", "url": "https://t.me/DotaRazbor_bot"}}
    assert body(post).endswith("Разобрать катку: https://t.me/DotaRazbor_bot")
    assert body({"text": "t.me/DotaRazbor_bot", "button": {"text": "x", "url": "t.me/DotaRazbor_bot"}}) == "t.me/DotaRazbor_bot"


def test_channel_hash_changes_only_with_content():
    cfg = {"title": "T", "about": "A"}
    base = channel_hash(cfg, b"img")
    assert base == channel_hash(dict(cfg), b"img")
    assert base != channel_hash({**cfg, "title": "T2"}, b"img")
    assert base != channel_hash(cfg, b"img2")


def test_render_uses_premium_emoji_only_when_id_known():
    emoji = {"fire": {"char": "F", "id": 77}, "shield": {"char": "S", "id": None}}
    assert render("{e:fire} <b>x</b> {e:shield} {e:nope}", emoji) == '<tg-emoji emoji-id="77">F</tg-emoji> <b>x</b> S '
    assert plain("{e:fire} <b>x</b> {e:shield}", emoji) == "F x S"


def test_queue_is_valid_and_human_paced():
    import json
    root = Path(__file__).resolve().parent.parent
    queue = json.loads((root / "promo" / "queue.json").read_text(encoding="utf-8"))
    emoji = json.loads((root / "promo" / "emoji.json").read_text(encoding="utf-8"))
    assert len({p["id"] for p in queue}) == len(queue)
    for p in queue:
        text = plain(body(p), emoji)
        assert "{e:" not in text, p["id"]                      # все ключи эмодзи известны
        assert len(text) <= (1024 if p.get("photo") else 4096), p["id"]
        if p.get("photo"):
            assert (root / p["photo"]).exists(), p["id"]
        datetime.fromisoformat(p["at"])
    posts = sorted((datetime.fromisoformat(p["at"]) for p in queue if p["id"] != "launch"))
    per_day = {}
    for d in posts:
        per_day[d.date()] = per_day.get(d.date(), 0) + 1
    assert set(per_day.values()) == {3}                         # три поста в день
    assert all((b - a).total_seconds() >= 2 * 3600 for a, b in zip(posts, posts[1:]))   # не пачкой
    assert len({d.minute for d in posts}) >= 25                 # время каждый день разное, не «ровно в час»
    assert len({d.hour * 60 + d.minute for d in posts}) >= 50  # время суток почти не повторяется
