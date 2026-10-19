"""Разбор игрока в матче: собирает ключевые факты и ищет ошибки по цифрам."""
from opendota import OpenDota

BENCH_NAMES = {
    "gold_per_min": "золото в минуту",
    "xp_per_min": "опыт в минуту",
    "last_hits_per_min": "ластхиты в минуту",
    "hero_damage_per_min": "урон по героям в минуту",
    "deaths_per_min": "смерти",
    "kills_per_min": "убийства в минуту",
    "tower_damage": "урон по башням",
}

# Расходники и мелочь, которые не интересны в таймингах предметов
CORE_ITEM_MIN_COST = 1800


def plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def mmss(seconds: int) -> str:
    sign = "-" if seconds < 0 else ""
    seconds = abs(int(seconds))
    return f"{sign}{seconds // 60}:{seconds % 60:02d}"


def position(player: dict) -> int:
    return player.get("position_est") or {1: 1, 2: 2, 3: 3}.get(player.get("lane_role"), 4)


def collect_facts(match: dict, player: dict, od: OpenDota) -> dict:
    """Компактная выжимка из матча — её же отдаём ИИ на анализ."""
    duration = match["duration"]
    pos = position(player)
    won = player["isRadiant"] == match["radiant_win"]

    allies = [p for p in match["players"] if p["isRadiant"] == player["isRadiant"]]
    enemies = [p for p in match["players"] if p["isRadiant"] != player["isRadiant"]]

    facts = {
        "hero": od.hero_name(player["hero_id"]),
        "position": pos,
        "result": "победа" if won else "поражение",
        "duration": mmss(duration),
        "kda": f'{player["kills"]}/{player["deaths"]}/{player["assists"]}',
        "gpm": player["gold_per_min"],
        "xpm": player["xp_per_min"],
        "last_hits": player["last_hits"],
        "denies": player["denies"],
        "net_worth": player["net_worth"],
        "hero_damage": player["hero_damage"],
        "tower_damage": player["tower_damage"],
        "level": player["level"],
        "allies": [od.hero_name(p["hero_id"]) for p in allies if p is not player],
        "enemies": [od.hero_name(p["hero_id"]) for p in enemies],
        "benchmarks_percentile": {
            k: round(v["pct"] * 100) for k, v in (player.get("benchmarks") or {}).items()
        },
    }

    lh_t = player.get("lh_t")
    if lh_t:
        facts["last_hits_at"] = {f"{m} мин": lh_t[m] for m in (5, 10, 15, 20) if m < len(lh_t)}
        facts["net_worth_at"] = {
            f"{m} мин": player["networth_t"][m] for m in (10, 20, 30) if m < len(player["networth_t"])
        }
        facts["lane_efficiency_pct"] = player.get("lane_efficiency_pct")
        facts["teamfight_participation_pct"] = round((player.get("teamfight_participation") or 0) * 100)
        facts["time_dead"] = mmss(player.get("life_state_dead") or 0)
        facts["deaths"] = [
            {
                "time": mmss(d["time"]),
                "killer": od.hero_name_by_key(d["key"]),
                "gold_lost": d.get("gold_lost", 0),
            }
            for d in player.get("deaths_log") or []
        ]
        facts["core_items"] = [
            {"item": od.item_name(p["key"]), "time": mmss(p["time"])}
            for p in player.get("purchase_log") or []
            if od.item_cost(p["key"]) >= CORE_ITEM_MIN_COST
        ]
        facts["wards"] = {
            "observers": player.get("obs_placed", 0),
            "sentries": player.get("sen_placed", 0),
            "dewards": player.get("observer_kills", 0) + player.get("sentry_kills", 0),
        }
        facts["buybacks"] = player.get("buyback_count", 0)
        facts["stacks"] = player.get("camps_stacked", 0)
    return facts


def find_mistakes(facts: dict) -> tuple[list[str], list[str]]:
    """Простые правила: что плохо и что хорошо. Работает без ИИ."""
    bad, good = [], []
    pos = facts["position"]
    core = pos <= 3
    bench = facts["benchmarks_percentile"]

    for key, name in BENCH_NAMES.items():
        if key not in bench:
            continue
        pct = bench[key]
        # Для саппортов фарм и ластхиты не так важны
        if not core and key in ("gold_per_min", "last_hits_per_min", "tower_damage"):
            continue
        if pct < 30:
            bad.append(f"{name}: хуже, чем у {100 - pct}% игроков на этом герое")
        elif pct >= 75:
            good.append(f"{name}: лучше, чем у {pct}% игроков на этом герое")

    lh = facts.get("last_hits_at", {})
    if core and "10 мин" in lh:
        lh10 = lh["10 мин"]
        target = 50 if pos == 1 else 40
        if lh10 < target:
            bad.append(f"ластхиты к 10 минуте: {lh10}, а стоит целиться в {target}+. Это главный источник фарма")

    deaths = facts.get("deaths", [])
    early = [d for d in deaths if int(d["time"].split(":")[0]) < 15]
    if len(early) >= 3:
        times = ", ".join(d["time"] for d in early)
        bad.append(f"{len(early)} {plural(len(early), 'смерть', 'смерти', 'смертей')} до 15 минуты ({times}). Ранние смерти ломают весь тайминг")
    killers: dict[str, int] = {}
    for d in deaths:
        killers[d["killer"]] = killers.get(d["killer"], 0) + 1
    if killers:
        top, cnt = max(killers.items(), key=lambda kv: kv[1])
        if cnt >= 3:
            bad.append(f"{cnt} {plural(cnt, 'раз', 'раза', 'раз')} умер от {top}. Стоит понять, чем он тебя ловит, и купить контр-предмет")

    tf = facts.get("teamfight_participation_pct")
    if tf is not None:
        if tf < 50:
            bad.append(f"участие в драках {tf}%. Команда часто дерётся без тебя")
        elif tf >= 70:
            good.append(f"участие в драках {tf}%")

    wards = facts.get("wards")
    if wards and pos >= 4:
        minutes = max(1, int(facts["duration"].split(":")[0]))
        if wards["observers"] < minutes / 4:
            bad.append(f"всего {wards['observers']} обсов за игру. Саппорту нужно больше видения")

    items = facts.get("core_items", [])
    if core and items:
        first = items[0]
        if int(first["time"].split(":")[0]) >= 20:
            bad.append(f"первый крупный предмет ({first['item']}) только на {first['time']}. Слишком поздно")

    return bad, good


def format_report(facts: dict, bad: list[str], good: list[str]) -> str:
    lines = [
        f"{facts['hero']} (позиция {facts['position']}), {facts['result']}, {facts['duration']}",
        f"KDA {facts['kda']} | GPM {facts['gpm']} | XPM {facts['xpm']} | LH/DN {facts['last_hits']}/{facts['denies']}",
    ]
    if facts.get("core_items"):
        items = ", ".join(f"{i['item']} {i['time']}" for i in facts["core_items"][:6])
        lines.append(f"Предметы: {items}")
    if bad:
        lines.append("\nНад чем работать:")
        lines += [f"- {x}" for x in bad]
    if good:
        lines.append("\nЧто получилось:")
        lines += [f"+ {x}" for x in good]
    if not bad and not good:
        lines.append("\nПо цифрам явных косяков нет.")
    return "\n".join(lines)
