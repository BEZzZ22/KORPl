import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from promo_ig import due  # noqa: E402

Q = [{"id": "a", "at": "2026-10-24T10:00:00+00:00"}, {"id": "b", "at": "2026-10-25T10:00:00+00:00"}]


def at(s):
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def test_due_one_at_a_time_with_gap():
    assert [p["id"] for p in due(Q, {}, at("2026-10-26T00:00:00+00:00"))] == ["a"]
    posted = {"a": {"code": "x", "at": "2026-10-26T00:00:00+00:00"}}
    assert due(Q, posted, at("2026-10-26T10:00:00+00:00")) == []          # прошло меньше 20 часов
    assert [p["id"] for p in due(Q, posted, at("2026-10-26T21:00:00+00:00"))] == ["b"]


def test_ig_queue_files_and_captions():
    queue = json.loads((ROOT / "promo" / "ig_queue.json").read_text(encoding="utf-8"))
    assert len({p["id"] for p in queue}) == len(queue)
    for p in queue:
        assert (ROOT / p["video"]).exists() and (ROOT / p["cover"]).exists(), p["id"]
        assert len(p["caption"]) <= 2200 and p["caption"].count("#") <= 30, p["id"]
        datetime.fromisoformat(p["at"])
    ats = [datetime.fromisoformat(p["at"]) for p in queue]
    assert all(b - a >= timedelta(hours=20) for a, b in zip(ats, ats[1:]))
