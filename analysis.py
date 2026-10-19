"""Разбор матча для бота. Сама логика живёт в docs/engine.js — её же использует веб-приложение.

Бот вызывает движок через Node (engine_cli.mjs), поэтому выводы в чате и в приложении всегда совпадают.
"""
import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from opendota import OpenDota

ROOT = Path(__file__).parent
ENGINE_CLI = ROOT / "engine_cli.mjs"
NODE = shutil.which("node") or "node"
ENGINE_TIMEOUT = 30

LANE, FARM, FIGHTS, SURVIVAL, ITEMS, VISION = "Линия", "Фарм", "Драки", "Выживание", "Предметы", "Видение"
CATEGORIES = [LANE, FARM, FIGHTS, SURVIVAL, ITEMS, VISION]
BAD, WARN, GOOD = "bad", "warn", "good"
TURBO_MODE = 23
DAMAGE_TYPE_NAMES = {
    k: v["name"]
    for k, v in json.loads((ROOT / "docs" / "knowledge.json").read_text(encoding="utf-8"))["damage_types"].items()
}


class EngineError(Exception):
    """Движок разбора упал или не установлен Node.js."""


@dataclass
class Finding:
    category: str
    severity: str
    text: str
    tip: str = ""
    kind: str = ""
    roast: str = ""


@dataclass
class Analysis:
    facts: dict
    findings: list[Finding] = field(default_factory=list)
    scores: dict[str, int] = field(default_factory=dict)
    overall: float = 0.0
    timeline: dict = field(default_factory=dict)
    killers: list[dict] = field(default_factory=list)
    phases: list[dict] = field(default_factory=list)
    moments: list[dict] = field(default_factory=list)
    pro_build: list[dict] = field(default_factory=list)
    compare: list[dict] = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    verdict: str = ""
    items: list[dict] = field(default_factory=list)

    def by_severity(self, severity: str) -> list[Finding]:
        return [f for f in self.findings if f.severity == severity]


def plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def mmss(seconds: int | float) -> str:
    sign = "-" if seconds < 0 else ""
    seconds = abs(int(seconds))
    return f"{sign}{seconds // 60}:{seconds % 60:02d}"


def num(n: int | float) -> str:
    """1234567 -> «1 234 567» с неразрывными пробелами."""
    n = int(n)
    return ("-" if n < 0 else "") + f"{abs(n):,}".replace(",", " ")


def from_engine(data: dict) -> Analysis:
    findings = [Finding(**f) for f in data.pop("findings", [])]
    known = Analysis.__dataclass_fields__.keys()
    return Analysis(findings=findings, **{k: v for k, v in data.items() if k in known})


def analyze(match: dict, player: dict, od: OpenDota, pro_items: dict[str, int] | None = None,
            hero_bench: dict | None = None) -> Analysis:
    payload = json.dumps({
        "match": match,
        "slot": player["player_slot"],
        "pro_items": pro_items or {},
        "hero_bench": hero_bench or {},
        "constants": od.constants,
    })
    try:
        proc = subprocess.run([NODE, str(ENGINE_CLI)], input=payload, capture_output=True, text=True,
                              timeout=ENGINE_TIMEOUT, check=False)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise EngineError(f"движок разбора не запустился: {e}") from e
    if proc.returncode != 0:
        raise EngineError(proc.stderr.strip()[:500] or f"код {proc.returncode}")
    return from_engine(json.loads(proc.stdout))
