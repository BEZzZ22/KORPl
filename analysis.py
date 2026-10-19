"""Разбор игрока в матче: собирает факты, ищет ошибки и ставит оценки по разделам."""
import json
from dataclasses import dataclass, field
from pathlib import Path

from opendota import OpenDota

# База механик героев и контр-предметов. Её же читает веб-приложение из docs/
KNOWLEDGE = json.loads((Path(__file__).parent / "docs" / "knowledge.json").read_text(encoding="utf-8"))
DAMAGE_TYPE_NAMES = {k: v["name"] for k, v in KNOWLEDGE["damage_types"].items()}
DAMAGE_TYPE_INSTR = {"Physical": "физическим", "Magical": "магическим", "Pure": "чистым"}
# Улучшенная версия предмета тоже считается: Wind Waker закрывает Eul's и т.д.
ITEM_UPGRADES = {
    "cyclone": ["wind_waker"],
    "force_staff": ["hurricane_pike"],
    "ghost": ["ethereal_blade"],
    "maelstrom": ["mjollnir", "gleipnir"],
    "ward_sentry": ["ward_dispenser"],
    "orchid": ["bloodthorn"],
}
MAX_COUNTER_ITEMS = 3
# Эти предметы не прожимаются, а ставятся или носятся
DETECTION_ITEMS = {"dust", "ward_sentry", "gem"}

# Разделы разбора в порядке вывода
LANE, FARM, FIGHTS, SURVIVAL, ITEMS, VISION = "Линия", "Фарм", "Драки", "Выживание", "Предметы", "Видение"
CATEGORIES = [LANE, FARM, FIGHTS, SURVIVAL, ITEMS, VISION]

BAD, WARN, GOOD = "bad", "warn", "good"

# С кем обычно стоишь на линии: керри против оффлейнера, мид против мида и т.д.
LANE_OPPONENT = {1: 3, 2: 2, 3: 1, 4: 5, 5: 4}
# Сколько ластхитов к 10 минуте стоит иметь на позиции
LH_TARGET_10 = {1: 50, 2: 50, 3: 35}
# Предметы дешевле этой суммы не считаем ключевыми в таймингах
CORE_ITEM_MIN_COST = 1800
OBSERVER_LIFETIME = 360
TEAMFIGHT_MARGIN = 10


@dataclass
class Finding:
    category: str
    severity: str
    text: str
    tip: str = ""
    kind: str = ""


@dataclass
class Analysis:
    facts: dict
    findings: list[Finding] = field(default_factory=list)
    scores: dict[str, int] = field(default_factory=dict)
    timeline: dict = field(default_factory=dict)
    killers: list[dict] = field(default_factory=list)

    @property
    def overall(self) -> float:
        return round(sum(self.scores.values()) / len(self.scores), 1) if self.scores else 0.0

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


def position(player: dict) -> int:
    return player.get("position_est") or {1: 1, 2: 2, 3: 3}.get(player.get("lane_role"), 4)


def at_minute(series: list | None, minute: int) -> int | None:
    if not series:
        return None
    return series[minute] if minute < len(series) else series[-1]


class MatchAnalyzer:
    def __init__(self, match: dict, player: dict, od: OpenDota):
        self.match = match
        self.p = player
        self.od = od
        self.duration = match["duration"]
        self.minutes = self.duration // 60
        self.pos = position(player)
        self.core = self.pos <= 3
        self.won = player["isRadiant"] == match["radiant_win"]
        self.allies = [x for x in match["players"] if x["isRadiant"] == player["isRadiant"]]
        self.enemies = [x for x in match["players"] if x["isRadiant"] != player["isRadiant"]]
        self.opponent = next((e for e in self.enemies if position(e) == LANE_OPPONENT[self.pos]), None)
        self.bench = {k: round(v["pct"] * 100) for k, v in (player.get("benchmarks") or {}).items()}
        self.findings: list[Finding] = []
        self.penalty: dict[str, float] = {c: 0.0 for c in CATEGORIES}

    def add(self, category: str, severity: str, text: str, tip: str = "", kind: str = ""):
        self.findings.append(Finding(category, severity, text, tip, kind))
        self.penalty[category] += {BAD: 1.0, WARN: 0.5, GOOD: -0.5}[severity]

    def run(self) -> Analysis:
        self.check_lane()
        self.check_farm()
        self.check_fights()
        self.check_survival()
        self.check_items()
        self.check_vision()
        self.check_game()
        killers = self.check_killers()
        self.check_itemization()
        return Analysis(
            facts=self.collect_facts(killers),
            findings=self.findings,
            scores=self.compute_scores(),
            timeline=self.collect_timeline(),
            killers=killers,
        )

    # ---------- линия (0-10 минута) ----------

    def check_lane(self):
        p, pos = self.p, self.pos
        lh10, dn10 = at_minute(p["lh_t"], 10), at_minute(p["dn_t"], 10)

        if self.core and self.minutes >= 10:
            target = LH_TARGET_10[pos]
            if lh10 < target * 0.7:
                self.add(LANE, BAD, f"Ластхиты к 10:00: {lh10} при норме {target}+",
                         "Тренируй добивание в демке: 5 минут на линии без скиллов, цель 40+ крипов")
            elif lh10 < target:
                self.add(LANE, WARN, f"Ластхиты к 10:00: {lh10}, чуть ниже нормы {target}")
            elif lh10 >= target * 1.25:
                self.add(LANE, GOOD, f"Отличное добивание: {lh10} крипов к 10:00")

            if pos == 2 and dn10 < 6:
                self.add(LANE, WARN, f"Денаев на миде к 10:00 всего {dn10}",
                         "На миде денай важен почти как ластхит: так ты отбираешь у врага опыт и золото")

        if self.opponent and self.minutes >= 10:
            diff = at_minute(p["networth_t"], 10) - at_minute(self.opponent["networth_t"], 10)
            opp = self.od.hero_name(self.opponent["hero_id"])
            if diff <= -1000:
                self.add(LANE, BAD, f"Проиграл линию: к 10:00 отставал от {opp} на {-diff} золота",
                         f"Посмотри реплей первых 10 минут и найди, в какие моменты {opp} тебя наказывал")
            elif diff >= 1000:
                self.add(LANE, GOOD, f"Выиграл линию: к 10:00 впереди {opp} на {diff} золота")

        early = [d for d in p.get("deaths_log") or [] if d["time"] < 600]
        if len(early) >= 2:
            times = ", ".join(mmss(d["time"]) for d in early)
            self.add(LANE, BAD, f"{len(early)} {plural(len(early), 'смерть', 'смерти', 'смертей')} на линии ({times})",
                     "На линии не заходи за свою крипволну, если не видишь всех врагов. Следи за ранами и не жадничай")

    # ---------- фарм ----------

    def check_farm(self):
        p = self.p
        if self.core:
            for key, name in (("gold_per_min", "GPM"), ("last_hits_per_min", "Ластхиты в минуту")):
                pct = self.bench.get(key)
                if pct is None:
                    continue
                if pct < 25:
                    self.add(FARM, BAD, f"{name}: хуже, чем у {100 - pct}% игроков на этом герое")
                elif pct >= 80:
                    self.add(FARM, GOOD, f"{name}: лучше, чем у {pct}% игроков на этом герое")

            for start, end, lh in self.idle_windows():
                self.add(FARM, WARN, f"Простой с {mmss(start * 60)} по {mmss(end * 60)}: всего {lh} крипов за {end - start} мин",
                         "Если нечего делать, фарми лес или пушь линию. Минута без фарма — минус 300-500 золота")

            if self.pos == 1 and self.minutes >= 25 and p["last_hits"] > 0:
                share = p.get("neutral_kills", 0) / p["last_hits"]
                if share < 0.15:
                    self.add(FARM, WARN, f"Лесных крипов всего {round(share * 100)}% от фарма",
                             "Между волнами заходи в лес: линия, лагерь, линия. Так фарм растёт в разы")

        if self.opponent and self.minutes >= 20:
            diff = at_minute(p["networth_t"], 20) - at_minute(self.opponent["networth_t"], 20)
            opp = self.od.hero_name(self.opponent["hero_id"])
            if self.core and diff <= -3000:
                self.add(FARM, BAD, f"К 20:00 отставал от {opp} на {-diff} нетворса")
            elif self.core and diff >= 3000:
                self.add(FARM, GOOD, f"К 20:00 обогнал {opp} на {diff} нетворса")

    def idle_windows(self) -> list[tuple[int, int, int]]:
        """Отрезки по 3+ минуты, где почти не было ластхитов (не считая минут, когда был мёртв)."""
        lh = self.p["lh_t"]
        dead_minutes = set()
        for d in self.p.get("deaths_log") or []:
            for m in range(int(d["time"] // 60), int((d["time"] + d.get("time_dead", 30)) // 60) + 1):
                dead_minutes.add(m)

        windows, start = [], None
        last = min(len(lh) - 1, 40)
        for m in range(10, last + 1):
            idle = m < len(lh) and lh[m] - lh[m - 1] <= 1 and m not in dead_minutes
            if idle and start is None:
                start = m - 1
            if (not idle or m == last) and start is not None:
                end = m - 1 if not idle else m
                if end - start >= 3:
                    windows.append((start, end, lh[end] - lh[start]))
                start = None
        return windows[:2]

    # ---------- драки ----------

    def check_fights(self):
        p = self.p
        team_kills = sum(a["kills"] for a in self.allies)
        if team_kills >= 10:
            kp = round((p["kills"] + p["assists"]) / team_kills * 100)
            if kp < 45:
                self.add(FIGHTS, BAD, f"Участие в убийствах {kp}%: команда воюет без тебя",
                         "Чаще смотри на миникарту и иди на драки с ТП, особенно после 15 минуты")
            elif kp >= 70:
                self.add(FIGHTS, GOOD, f"Участие в убийствах {kp}%")

        missed = self.missed_fights()
        if missed:
            times = ", ".join(f"{mmss(t)} (-{n})" for t, n in missed[:3])
            self.add(FIGHTS, BAD if len(missed) >= 3 else WARN,
                     f"{len(missed)} {plural(len(missed), 'драку', 'драки', 'драк')} пропустил, пока был жив: {times}",
                     "В скобках сколько союзников погибло. Если не успеваешь, не фарми далеко, держи ТП")

        if self.core:
            pct = self.bench.get("hero_damage_per_min")
            if pct is not None and pct < 25:
                self.add(FIGHTS, WARN, f"Урон по героям ниже, чем у {100 - pct}% игроков на этом герое",
                         "Бей тех, до кого достаёшь, а не только цель для убийства. Урон по танку тоже помогает")
            elif pct is not None and pct >= 80:
                self.add(FIGHTS, GOOD, f"Урон по героям выше, чем у {pct}% игроков на этом герое")

    def missed_fights(self) -> list[tuple[int, int]]:
        """Драки, где у команды погибли 2+ героя, а игрок не участвовал и не был мёртв."""
        idx = self.match["players"].index(self.p)
        ally_idx = [self.match["players"].index(a) for a in self.allies]
        dead = [(d["time"], d["time"] + d.get("time_dead", 0)) for d in self.p.get("deaths_log") or []]
        result = []
        for tf in self.match.get("teamfights") or []:
            players = tf.get("players") or []
            if len(players) <= idx:
                continue
            me = players[idx]
            took_part = me["damage"] > 0 or me["healing"] > 0 or me["deaths"] > 0 or me["ability_uses"]
            was_dead = any(s <= tf["start"] <= e for s, e in dead)
            ally_deaths = sum(players[i]["deaths"] for i in ally_idx if i < len(players))
            if not took_part and not was_dead and ally_deaths >= 2:
                result.append((tf["start"], ally_deaths))
        return result

    # ---------- выживание ----------

    def check_survival(self):
        p = self.p
        deaths = p.get("deaths_log") or []
        pct = self.bench.get("deaths_per_min")
        if pct is not None and pct < 25:
            self.add(SURVIVAL, BAD, f"{p['deaths']} {plural(p['deaths'], 'смерть', 'смерти', 'смертей')}: "
                                    f"умираешь чаще, чем {100 - pct}% игроков на этом герое")
        elif pct is not None and pct >= 80 and self.minutes >= 20:
            self.add(SURVIVAL, GOOD, f"Всего {p['deaths']} {plural(p['deaths'], 'смерть', 'смерти', 'смертей')} за игру")

        fights = [(tf["start"] - TEAMFIGHT_MARGIN, tf["end"] + TEAMFIGHT_MARGIN) for tf in self.match.get("teamfights") or []]
        solo = [d for d in deaths if d["time"] >= 600 and not any(s <= d["time"] <= e for s, e in fights)]
        if len(solo) >= 2:
            times = ", ".join(mmss(d["time"]) for d in solo[:5])
            self.add(SURVIVAL, BAD, f"Пойман в одиночку {len(solo)} {plural(len(solo), 'раз', 'раза', 'раз')} вне драк: {times}",
                     "Перед фармом опасной зоны глянь миникарту: кого из врагов не видно. Нет 3+ врагов — отходи ближе к своим")

        dead_share = (p.get("life_state_dead") or 0) / max(self.duration, 1)
        if dead_share >= 0.15:
            self.add(SURVIVAL, BAD, f"Провёл мёртвым {mmss(p['life_state_dead'])}, это {round(dead_share * 100)}% игры",
                     "Каждая минута в таверне — это минута без фарма и опыта")

        lost = sum(d.get("gold_lost", 0) for d in deaths)
        if lost >= 1000 and lost / max(p.get("total_gold") or 1, 1) >= 0.1:
            self.add(SURVIVAL, WARN, f"Потерял {lost} золота на смертях",
                     "Перед рискованным моментом трать золото: купи предмет или хотя бы компонент")

    # ---------- предметы ----------

    def core_items(self) -> list[dict]:
        return [
            {"key": x["key"], "item": self.od.item_name(x["key"]), "time": x["time"]}
            for x in self.p.get("purchase_log") or []
            if self.od.item_cost(x["key"]) >= CORE_ITEM_MIN_COST and not x["key"].startswith("recipe_")
        ]

    def check_items(self):
        p, items = self.p, self.core_items()
        if self.core and items:
            first = items[0]
            minute = first["time"] / 60
            if minute >= 20:
                self.add(ITEMS, BAD, f"Первый крупный предмет ({first['item']}) только на {mmss(first['time'])}",
                         "Для кора первый ключевой предмет должен быть к 14-17 минуте. Не трать золото на ситуативщину раньше")
            elif minute >= 17:
                self.add(ITEMS, WARN, f"Первый крупный предмет ({first['item']}) на {mmss(first['time'])}, можно быстрее")
            elif minute <= 13:
                self.add(ITEMS, GOOD, f"Быстрый {first['item']} на {mmss(first['time'])}")
        elif self.core and self.minutes >= 20:
            self.add(ITEMS, BAD, "За 20+ минут ни одного крупного предмета")

        if self.pos in (1, 2) and self.minutes >= 30:
            bkb = next((x for x in items if x["key"] == "black_king_bar"), None)
            if bkb is None:
                self.add(ITEMS, WARN, "Не было BKB за всю игру",
                         "Если у врагов много контроля или магии, BKB чаще всего обязателен к 25 минуте")

        tps = (p.get("item_uses") or {}).get("tpscroll", 0)
        if self.minutes >= 20 and tps < self.minutes / 10:
            self.add(ITEMS, WARN, f"Всего {tps} ТП за {self.minutes} мин",
                     "ТП должен быть в слоте всегда: спасает вышки, союзников и экономит время на ходьбу")

        boots = next((x for x in p.get("purchase_log") or [] if x["key"] == "boots"), None)
        if self.core and boots and boots["time"] > 360:
            self.add(ITEMS, WARN, f"Сапоги только на {mmss(boots['time'])}",
                     "Сапоги нужны к 4-5 минуте: без них проще поймать и сложнее размениваться")

        if not self.won and p.get("gold", 0) >= 2500:
            self.add(ITEMS, WARN, f"Закончил проигранную игру с {p['gold']} золота в кармане",
                     "Неиспользованное золото — это предмет, которого не было в последней драке")

    # ---------- видение ----------

    def check_vision(self):
        p = self.p
        obs, sen = p.get("obs_placed", 0), p.get("sen_placed", 0)
        dewards = p.get("observer_kills", 0) + p.get("sentry_kills", 0)
        if self.pos >= 4 and self.minutes >= 15:
            per10 = obs / self.minutes * 10
            if per10 < 2.5:
                self.add(VISION, BAD, f"Всего {obs} обсов за {self.minutes} мин",
                         "Саппорт должен ставить обс каждый раз, как он есть в лавке. Видение выигрывает драки")
            elif per10 >= 4:
                self.add(VISION, GOOD, f"Хорошо варил: {obs} обсов")

            short, total = self.dewarded_observers()
            if total >= 4 and short / total >= 0.4:
                self.add(VISION, WARN, f"{short} из {total} обсов враги быстро сносили",
                         "Не ставь на самые очевидные точки. Сдвигай вард на пару шагов или на соседнюю высоту")

            if sen < obs / 2:
                self.add(VISION, WARN, f"Мало сентри: {sen} при {obs} обсах, снял {dewards} вардов",
                         "Сентри у своих вышек и рун ломают вражеское видение и спасают от гангов")

            if self.pos == 5 and self.minutes >= 25 and p.get("camps_stacked", 0) < 2:
                self.add(VISION, WARN, "Почти не стакал лес",
                         "На x:53-x:55 оттяни лагерь: керри потом сразу заберёт двойной стак")
        elif self.core and dewards >= 3:
            self.add(VISION, GOOD, f"Снял {dewards} вражеских вардов, хорошо для кора")

        if self.pos == 2 and self.minutes >= 20:
            runes = p.get("rune_pickups", 0)
            if runes < self.minutes / 5:
                self.add(VISION, WARN, f"Мало рун для мида: {runes} за игру",
                         "Руны на миде — это бесплатные ганги и реген. Контролируй их каждые 2 минуты")

    def dewarded_observers(self) -> tuple[int, int]:
        """Сколько обсов игрока враги снесли раньше чем через 2/3 срока жизни."""
        placed = {w["ehandle"]: w["time"] for w in self.p.get("obs_log") or [] if "ehandle" in w}
        # Если вард "снёс" сам игрок, значит он просто истёк или его переставили
        own_hero = self.od.hero_key(self.p["hero_id"])
        short = 0
        for w in self.p.get("obs_left_log") or []:
            start = placed.get(w.get("ehandle"))
            if start is None:
                continue
            killed_by_enemy = w.get("attackername") and w["attackername"] != own_hero
            if killed_by_enemy and w["time"] - start < OBSERVER_LIFETIME * 2 / 3:
                short += 1
        return short, len(placed)

    # ---------- кто убивал и чем ----------

    def owned_items(self) -> set[str]:
        owned = {x["key"] for x in self.p.get("purchase_log") or []}
        for base, upgrades in ITEM_UPGRADES.items():
            if owned & set(upgrades):
                owned.add(base)
        return owned

    def role(self) -> str:
        return "core" if self.core else "support"

    def damage_from(self, enemy: dict) -> tuple[int, list[dict]]:
        """Сколько урона враг нанёс игроку и какими скиллами/предметами."""
        my_key = self.od.hero_key(self.p["hero_id"])
        sources = []
        for inflictor, targets in (enemy.get("damage_targets") or {}).items():
            dmg = (targets or {}).get(my_key, 0)
            if dmg > 0:
                sources.append({
                    "key": inflictor,
                    "name": self.od.source_name(inflictor),
                    "damage": dmg,
                    "type": self.od.source_type(inflictor),
                })
        sources.sort(key=lambda s: -s["damage"])
        return sum(s["damage"] for s in sources), sources

    def disables_from(self, enemy: dict) -> list[dict]:
        """Сколько раз враг кастовал в игрока точечные скиллы."""
        my_key = self.od.hero_key(self.p["hero_id"])
        result = []
        for ability, targets in (enemy.get("ability_targets") or {}).items():
            count = (targets or {}).get(my_key, 0)
            if count > 0:
                result.append({"name": self.od.source_name(ability), "count": count})
        return sorted(result, key=lambda d: -d["count"])

    def pick_counters(self, mechanics: list[str], main_type: str | None, owned: set[str]) -> tuple[list[str], list[str]]:
        """Контр-предметы под роль игрока: каких не хватало и какие уже были."""
        candidates: list[str] = []
        for m in mechanics:
            candidates += KNOWLEDGE["mechanics"][m][self.role()]
        if main_type in KNOWLEDGE["damage_types"]:
            candidates += KNOWLEDGE["damage_types"][main_type][self.role()]
        seen, missing, had = set(), [], []
        for key in candidates:
            if key in seen:
                continue
            seen.add(key)
            (had if key in owned else missing).append(key)
        return missing[:MAX_COUNTER_ITEMS], had

    def check_killers(self) -> list[dict]:
        deaths = self.p.get("deaths_log") or []
        counts: dict[str, int] = {}
        for d in deaths:
            counts[d["key"]] = counts.get(d["key"], 0) + 1

        owned = self.owned_items()
        enemies_by_key = {self.od.hero_key(e["hero_id"]): e for e in self.enemies}
        killers = []
        for key, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            enemy = enemies_by_key.get(key)
            if not enemy or n < 2:
                continue
            total, sources = self.damage_from(enemy)
            by_type: dict[str, int] = {}
            for s in sources:
                if s["type"]:
                    by_type[s["type"]] = by_type.get(s["type"], 0) + s["damage"]
            main_type = max(by_type, key=by_type.get) if by_type else None
            share = round(by_type[main_type] / total * 100) if main_type and total else 0
            mechanics = self.relevant_mechanics(KNOWLEDGE["heroes"].get(key, []), main_type)
            missing, had = self.pick_counters(mechanics, main_type, owned)
            name = self.od.hero_name(enemy["hero_id"])
            killer = {
                "hero": name,
                "key": key,
                "deaths": n,
                "damage": total,
                "main_type": main_type,
                "main_type_share": share,
                "sources": sources[:4],
                "disables": self.disables_from(enemy)[:3],
                "mechanics": [KNOWLEDGE["mechanics"][m]["name"] for m in mechanics],
                "tips": [KNOWLEDGE["mechanics"][m]["tip"].replace("{hero}", name) for m in mechanics],
                "counters": [self.od.item_name(k) for k in missing],
                "had_counters": [self.od.item_name(k) for k in had],
                "had_counter_keys": had,
            }
            killers.append(killer)
            self.add_killer_finding(killer)
        return killers[:3]

    def relevant_mechanics(self, mechanics: list[str], main_type: str | None) -> list[str]:
        """Оставляет механики, которые подтверждаются цифрами матча и важны для роли игрока."""
        result = []
        for m in mechanics:
            if m == "burst_physical" and main_type != "Physical":
                continue
            if m == "burst_magic" and main_type not in ("Magical", "Pure"):
                continue
            if self.role() not in KNOWLEDGE["mechanics"][m]["roles"]:
                continue
            result.append(m)
        return result

    def add_killer_finding(self, k: dict):
        how = ", ".join(f"{s['name']} {s['damage']}" for s in k["sources"][:3])
        text = f"{k['hero']} убил тебя {k['deaths']} {plural(k['deaths'], 'раз', 'раза', 'раз')}"
        if k["damage"]:
            text += f": {k['damage']} урона"
            if k["main_type"]:
                text += f", {k['main_type_share']}% {DAMAGE_TYPE_NAMES[k['main_type']]}"
            text += f" ({how})"
        if k["disables"]:
            text += ". Контроль: " + ", ".join(f"{d['name']} ×{d['count']}" for d in k["disables"])

        tip_parts = k["tips"][:2]
        if k["counters"]:
            tip_parts.append("Возьми: " + ", ".join(k["counters"]))
        if k["deaths"] >= 3:
            had = set(k["had_counter_keys"])
            if had & DETECTION_ITEMS:
                tip_parts.append("Детект у тебя был, но не там: ставь сентри и кидай Dust в местах, где умирал")
            active = [self.od.item_name(x) for x in k["had_counter_keys"] if x not in DETECTION_ITEMS]
            if active:
                verb = "были" if len(active) > 1 else "был"
                tip_parts.append(f"{', '.join(active[:2])} у тебя {verb} — используй заранее, а не когда уже в контроле")
        self.add(SURVIVAL, BAD if k["deaths"] >= 4 else WARN, text, ". ".join(tip_parts), kind="killer")

    # ---------- сборка против вражеского пика ----------

    def check_itemization(self):
        if self.minutes < 20:
            return
        owned = self.owned_items()
        role = self.role()

        received = self.p.get("damage_inflictor_received") or {}
        total = sum(received.values())
        if total >= 5000:
            by_type: dict[str, int] = {}
            for key, dmg in received.items():
                t = self.od.source_type(key)
                if t:
                    by_type[t] = by_type.get(t, 0) + dmg
            for dmg_type, threshold in (("Magical", 0.5), ("Physical", 0.65)):
                share = by_type.get(dmg_type, 0) / total
                counters = KNOWLEDGE["damage_types"][dmg_type][role]
                if share >= threshold and not owned & set(counters):
                    names = ", ".join(self.od.item_name(k) for k in counters[:3])
                    self.add(ITEMS, WARN,
                             f"{round(share * 100)}% урона по тебе было {DAMAGE_TYPE_INSTR[dmg_type]}, а защиты от него не было",
                             f"Против такого урона на твоей роли работают: {names}")

        enemy_tags: dict[str, list[str]] = {}
        for e in self.enemies:
            for tag in KNOWLEDGE["heroes"].get(self.od.hero_key(e["hero_id"]), []):
                enemy_tags.setdefault(tag, []).append(self.od.hero_name(e["hero_id"]))

        if "invis" in enemy_tags and self.pos >= 4 and not owned & {"dust", "ward_sentry", "gem"}:
            self.add(VISION, BAD, f"Против {', '.join(enemy_tags['invis'])} не купил ни Dust, ни сентри",
                     "Против невидимых героев саппорт всегда носит Dust и ставит сентри в ключевых местах")

        if "evasion" in enemy_tags and self.pos == 1 and self.minutes >= 30 and not owned & {"monkey_king_bar", "bloodthorn"}:
            self.add(ITEMS, WARN, f"Против уклонения {', '.join(enemy_tags['evasion'])} не было MKB или Bloodthorn",
                     "Без точности часть твоих атак просто промахивается")

        if len(enemy_tags.get("heal", [])) >= 2 and self.pos in (3, 4) and not owned & {"spirit_vessel", "shivas_guard", "skadi"}:
            self.add(ITEMS, WARN, f"У врагов много хила ({', '.join(enemy_tags['heal'])}), а антихила у тебя не было",
                     "Spirit Vessel на оффлейне или четвёрке режет лечение и добивает тех, кто убегает")

    # ---------- игра в целом ----------

    def check_game(self):
        adv = self.match.get("radiant_gold_adv") or []
        if not adv or self.won:
            return
        sign = 1 if self.p["isRadiant"] else -1
        best_minute, best = max(enumerate(a * sign for a in adv), key=lambda x: x[1])
        if best >= 8000:
            self.add(FIGHTS, WARN, f"Команда была впереди на {best} золота на {best_minute}-й минуте и слила игру",
                     "Когда впереди, не ломитесь на хайграунд без Рошана и аегиса, а давите картой и забирайте объекты")

    # ---------- оценки и факты ----------

    def compute_scores(self) -> dict[str, int]:
        def pct(key, default=50):
            # Процентиль среди игроков на этом герое -> 2..9, чтобы оценки не улетали в крайности
            return 2 + self.bench.get(key, default) / 100 * 7

        base = {
            LANE: 2 + min(self.p.get("lane_efficiency_pct") or 50, 100) / 100 * 7 if self.core else 6,
            FARM: (pct("gold_per_min") + pct("last_hits_per_min")) / 2 if self.core else pct("gold_per_min") * 0.5 + 3.5,
            FIGHTS: (2 + min(self.p.get("teamfight_participation") or 0.5, 1) * 7 + pct("hero_damage_per_min")) / 2,
            SURVIVAL: pct("deaths_per_min"),
            ITEMS: 7,
            VISION: 6 if self.pos >= 4 else 7,
        }
        return {c: max(1, min(10, round(base[c] + 1 - self.penalty[c]))) for c in CATEGORIES}

    def collect_facts(self, killers: list[dict]) -> dict:
        p = self.p
        return {
            "match_id": self.match["match_id"],
            "hero": self.od.hero_name(p["hero_id"]),
            "position": self.pos,
            "won": self.won,
            "duration": mmss(self.duration),
            "kda": f'{p["kills"]}/{p["deaths"]}/{p["assists"]}',
            "gpm": p["gold_per_min"],
            "xpm": p["xp_per_min"],
            "last_hits": p["last_hits"],
            "denies": p["denies"],
            "last_hits_10": at_minute(p["lh_t"], 10),
            "net_worth": p["net_worth"],
            "hero_damage": p["hero_damage"],
            "tower_damage": p["tower_damage"],
            "level": p["level"],
            "lane_opponent": self.od.hero_name(self.opponent["hero_id"]) if self.opponent else None,
            "allies": [self.od.hero_name(a["hero_id"]) for a in self.allies if a is not p],
            "enemies": [self.od.hero_name(e["hero_id"]) for e in self.enemies],
            "items": [f"{x['item']} {mmss(x['time'])}" for x in self.core_items()],
            "benchmarks_percentile": self.bench,
            "deaths": [
                f"{mmss(d['time'])} от {self.od.hero_name_by_key(d['key'])}" for d in p.get("deaths_log") or []
            ],
            "killers": [
                {k: v for k, v in killer.items() if k in ("hero", "deaths", "damage", "main_type", "sources",
                                                          "disables", "mechanics", "counters", "had_counters")}
                for killer in killers
            ],
        }

    def collect_timeline(self) -> dict:
        return {
            "player": self.p["networth_t"],
            "opponent": self.opponent["networth_t"] if self.opponent else None,
            "opponent_name": self.od.hero_name(self.opponent["hero_id"]) if self.opponent else None,
            "hero": self.od.hero_name(self.p["hero_id"]),
            "deaths": [d["time"] for d in self.p.get("deaths_log") or []],
        }


def analyze(match: dict, player: dict, od: OpenDota) -> Analysis:
    return MatchAnalyzer(match, player, od).run()
