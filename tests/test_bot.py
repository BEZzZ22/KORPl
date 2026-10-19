import gzip
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import analysis  # noqa: E402
import chart  # noqa: E402
import report  # noqa: E402
from bot import parse_match_id  # noqa: E402
from opendota import OpenDota, damage_type, to_account_id  # noqa: E402
from storage import Storage  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"


def load(name):
    with gzip.open(FIXTURES / name, "rt") as f:
        return json.load(f)


def offline_od() -> OpenDota:
    """OpenDota со справочниками из фикстуры, без сети."""
    c = load("constants.json.gz")
    client = OpenDota()
    client.heroes = {int(h["id"]): h["localized_name"] for h in c["heroes"].values()}
    client.heroes_by_key = {h["name"]: h["localized_name"] for h in c["heroes"].values()}
    client.hero_keys = {int(h["id"]): h["name"] for h in c["heroes"].values()}
    client.items = c["items"]
    client.abilities = {k: {"dname": a["dname"], "dmg_type": damage_type(a["dmg_type"])} for k, a in c["abilities"].items()}
    return client


@pytest.fixture(scope="module")
def od():
    return offline_od()


@pytest.fixture(scope="module")
def match():
    return load("match_9052987576.json.gz")


def test_every_player_is_analyzed(match, od):
    for player in match["players"]:
        a = analysis.analyze(match, player, od)
        assert set(a.scores) == set(analysis.CATEGORIES)
        assert all(1 <= s <= 10 for s in a.scores.values())
        assert report.full_report(a)
        assert chart.networth_chart(a.timeline)[:4] == b"\x89PNG"


def test_feeding_support_gets_survival_problems(match, od):
    tusk = match["players"][0]  # 4/19/30 на пятой позиции
    a = analysis.analyze(match, tusk, od)
    survival = [f for f in a.findings if f.category == analysis.SURVIVAL and f.severity == analysis.BAD]
    assert survival
    assert a.scores[analysis.SURVIVAL] <= 2
    assert any("Tiny" in f.text for f in a.findings)


def test_strong_carry_scores_high(match, od):
    clinkz = match["players"][4]  # 21/11/16, 810 GPM
    a = analysis.analyze(match, clinkz, od)
    assert a.scores[analysis.FARM] >= 9
    assert a.overall > analysis.analyze(match, match["players"][0], od).overall


def test_report_escapes_html(match, od):
    a = analysis.analyze(match, match["players"][0], od)
    a.findings.append(analysis.Finding(analysis.ITEMS, analysis.WARN, "<script>alert(1)</script>"))
    assert "<script>" not in report.full_report(a)


def test_split_message_respects_limit():
    text = "\n\n".join("строка " * 50 for _ in range(30))
    chunks = report.split_message(text, limit=1000)
    assert all(len(c) <= 1000 for c in chunks)
    assert len(chunks) > 1


@pytest.mark.parametrize("text, expected", [
    ("9052987576", 9052987576),
    ("https://www.opendota.com/matches/9052987576", 9052987576),
    ("https://www.dotabuff.com/matches/9052987576/builds", 9052987576),
    ("глянь 9052987576 пж", 9052987576),
    ("привет", None),
    ("12345", None),
    ("123456789012345", None),
])
def test_parse_match_id(text, expected):
    assert parse_match_id(text) == expected


def test_steam64_is_converted():
    assert to_account_id(76561198761545766) == 801280038
    assert to_account_id(801280038) == 801280038


def test_plural():
    assert [analysis.plural(n, "смерть", "смерти", "смертей") for n in (1, 2, 5, 11, 21, 22)] == [
        "смерть", "смерти", "смертей", "смертей", "смерть", "смерти"]


def test_storage_and_ai_quota(tmp_path):
    db = Storage(tmp_path / "t.db")
    db.set_account(1, 100)
    db.set_account(1, 200)
    assert db.get_account(1) == 200
    assert db.get_account(2) is None
    assert db.take_ai_quota(1, 2)
    assert db.take_ai_quota(1, 2)
    assert not db.take_ai_quota(1, 2)
    db.close()
