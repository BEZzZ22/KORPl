"""Бот (Python) и веб-приложение (JS) должны выдавать один и тот же разбор."""
import json
import shutil
import subprocess
from dataclasses import asdict
from pathlib import Path

import pytest

from test_bot import load, offline_od, run

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="нужен Node.js")
def test_js_engine_matches_python():
    out = subprocess.run(["node", str(ROOT / "tests" / "parity.mjs")], capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    match, od = load("match_9052987576.json.gz"), offline_od()
    for i, player in enumerate(match["players"]):
        py = run(match, player, od)
        assert js[i]["scores"] == py.scores, f"оценки разошлись у игрока {i}"
        assert js[i]["findings"] == [asdict(f) for f in py.findings], f"находки разошлись у игрока {i}"
        assert js[i]["phases"] == py.phases, f"фазы разошлись у игрока {i}"
        assert js[i]["moments"] == py.moments, f"хронология разошлась у игрока {i}"
        assert js[i]["pro_build"] == py.pro_build, f"про-сборка разошлась у игрока {i}"
        assert js[i]["verdict"] == py.verdict, f"вердикт разошёлся у игрока {i}"
        assert js[i]["killers"] == json.loads(json.dumps(py.killers)), f"убийцы разошлись у игрока {i}"
