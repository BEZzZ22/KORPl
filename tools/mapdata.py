# Снимает с реплея разметку карты: где стоят кемпы нейтралов, где умирают нейтралы, где ходят герои,
# и какие ещё сущности с координатами есть (башни, аутпосты, Рошан, Торментор, лотосы).
# Нужен python-manta. Запуск: python tools/mapdata.py replay.dem > out.json
# Координаты — мировые единицы Доты (как у парсера), клетка OpenDota = 128 + world / 128.
import base64, json, sys
from collections import Counter

import python_manta as pm

path = sys.argv[1]
p = pm.Parser(path)
out = {"errors": []}

# Нейтралы и герои: снимки раз в секунду (30 тиков), крипы только в первые минуты
try:
    res = p.parse(entities={"interval_ticks": 30, "include_creeps": True}, entity_deaths={"include_creeps": True, "creeps_only": True})
    snaps = res.entities.snapshots if res.entities else []
    out["snapshots"] = len(snaps)
    camps = []  # нейтралы, стоящие на месте спавна до первого захода героев
    grid = bytearray(256 * 256 // 8)
    seen = set()
    for s in snaps:
        t = s.game_time
        if 25 <= t <= 75:
            for c in s.creeps:
                if c.is_neutral and c.entity_id not in seen:
                    seen.add(c.entity_id)
                    camps.append([round(c.x), round(c.y), c.name, round(t)])
        for h in s.heroes:
            if not h.is_alive or h.is_illusion or h.is_clone:
                continue
            # сетка 256x256 по 64 единицы на мир -8192..8192
            gx, gy = int((h.x + 8192) // 64), int((h.y + 8192) // 64)
            if 0 <= gx < 256 and 0 <= gy < 256:
                n = gy * 256 + gx
                grid[n >> 3] |= 1 << (n & 7)
    out["camps"] = camps
    out["walk256"] = base64.b64encode(bytes(grid)).decode()
    deaths = res.entity_deaths.events if res.entity_deaths else []
    out["neutral_deaths"] = [[round(d.x), round(d.y), d.name, round(d.game_time)] for d in deaths if d.is_neutral]
    out["building_deaths"] = [[round(d.x), round(d.y), d.name or d.class_name, round(d.game_time)] for d in deaths if d.is_building]
    # пробные позиции героев для сверки осей
    if snaps:
        mid = snaps[len(snaps) // 2]
        out["hero_sample"] = [[round(h.x), round(h.y), h.hero_name] for h in mid.heroes]
except Exception as e:  # разбор частями: одна сломанная часть не роняет остальные
    out["errors"].append(f"snapshots: {e!r}")

# Сырые сущности на 10-й минуте: какие классы есть и где стоят
try:
    res = p.parse(entities={"interval_ticks": 18000, "max_snapshots": 3, "include_raw": True})
    snaps = res.entities.snapshots if res.entities else []
    raw = snaps[-1].raw_entities if snaps else None
    out["raw_type"] = type(raw).__name__
    if isinstance(raw, dict):
        classes = Counter()
        sample = {}
        for k, v in raw.items():
            cls = v.get("class_name") if isinstance(v, dict) else str(k)
            classes[cls] += 1
            if isinstance(v, dict):
                props = v.get("properties", v)
                pos = {pk: pv for pk, pv in props.items() if any(w in pk for w in ("cellX", "cellY", "vecX", "vecY", "m_vecOrigin", "m_iszUnitName", "m_iTeamNum"))}
                sample.setdefault(cls, []).append(pos)
        out["raw_classes"] = classes.most_common()
        keep = ("Tower", "Fort", "Barracks", "Watch", "Roshan", "Miniboss", "Mango", "Lantern", "Lotus", "Shop", "Fountain", "Twin", "Effigy", "Healer", "Filler", "Tormentor", "Rune", "Neutral")
        out["raw_sample"] = {c: v[:40] for c, v in sample.items() if any(w in c for w in keep)}
        if not out["raw_sample"]:
            out["raw_keys"] = list(raw.items())[:3]
except Exception as e:
    out["errors"].append(f"raw: {e!r}")

json.dump(out, sys.stdout, ensure_ascii=False, default=str)
