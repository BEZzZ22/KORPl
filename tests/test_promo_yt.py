import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from promo_yt import due  # noqa: E402

Q = [{"id": "a", "at": "2026-10-24T10:00:00+00:00"}, {"id": "b", "at": "2026-10-25T10:00:00+00:00"}]


def at(s):
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def test_due_one_at_a_time_with_gap():
    assert [p["id"] for p in due(Q, {}, at("2026-10-26T00:00:00+00:00"))] == ["a"]
    posted = {"a": {"video_id": "x", "at": "2026-10-26T00:00:00+00:00"}}
    assert due(Q, posted, at("2026-10-26T04:00:00+00:00")) == []
    assert [p["id"] for p in due(Q, posted, at("2026-10-26T06:00:00+00:00"))] == ["b"]


def test_yt_queue_valid():
    queue = json.loads((ROOT / "promo" / "yt_queue.json").read_text(encoding="utf-8"))
    assert len({p["id"] for p in queue}) == len(queue)
    for p in queue:
        assert (ROOT / p["video"]).exists(), p["id"]
        assert (ROOT / p["video"]).stat().st_size <= 30 * 2**20, p["id"]   # больше TikTok обрезает (см. promo_tt.MAX_FILE)
        assert len(p["title"]) <= 100 and "Shorts" in p["description"], p["id"]
    ats = [datetime.fromisoformat(p["at"]) for p in queue]
    assert all(b - a >= timedelta(hours=5) for a, b in zip(ats, ats[1:]))
