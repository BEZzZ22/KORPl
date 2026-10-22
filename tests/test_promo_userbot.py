import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from promo_userbot import body, channel_hash, due  # noqa: E402

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
