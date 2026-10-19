"""Бот (Python) и веб-приложение (JS) должны выдавать один и тот же разбор."""
import json
import shutil
import subprocess
from dataclasses import asdict
from pathlib import Path

import pytest

import analysis
from test_bot import load, offline_od

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="нужен Node.js")
def test_js_engine_matches_python():
    out = subprocess.run(["node", str(ROOT / "tests" / "parity.mjs")], capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    match, od = load("match_9052987576.json.gz"), offline_od()
    for i, player in enumerate(match["players"]):
        py = analysis.analyze(match, player, od)
        assert js[i]["scores"] == py.scores, f"оценки разошлись у игрока {i}"
        assert js[i]["findings"] == [asdict(f) for f in py.findings], f"находки разошлись у игрока {i}"
