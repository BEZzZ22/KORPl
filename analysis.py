"""Разбор игрока в матче: факты, ошибки, оценки, фазы игры и ключевые моменты.

Логика один в один повторена в docs/engine.js для веб-приложения, тексты общие в docs/texts.json.
tests/test_parity.py проверяет, что оба движка выдают одинаковый разбор.
"""
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from opendota import OpenDota

DOCS = Path(__file__).parent / "docs"
# База механик героев и контр-предметов
KNOWLEDGE = json.loads((DOCS / "knowledge.json").read_text(encoding="utf-8"))
# Варианты формулировок для всех сообщений разбора
TEXTS = json.loads((DOCS / "texts.json").read_text(encoding="utf-8"))

LANE, FARM, FIGHTS, SURVIVAL, ITEMS, VISION = "Линия", "Фарм", "Драки", "Выживание", "Предметы", "Видение"
CATEGORIES = [LANE, FARM, FIGHTS, SURVIVAL, ITEMS, VISION]
BAD, WARN, GOOD = "bad", "warn", "good"

DAMAGE_TYPE_NAMES = {k: v["name"] for k, v in KNOWLEDGE["damage_types"].items()}
DAMAGE_TYPE_ADJ = {"Physical": "физическим", "Magical": "магическим", "Pure": "чистым"}

# С кем обычно стоишь на линии: керри против оффлейнера, мид против мида и т.д.
LANE_OPPONENT = {1: 3, 2: 2, 3: 1, 4: 5, 5: 4}
LH_TARGET_10 = {1: 50, 2: 50, 3: 35}
CORE_ITEM_MIN_COST = 1800
OBSERVER_LIFETIME = 360
TEAMFIGHT_MARGIN = 10
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
DETECTION_ITEMS = {"dust", "ward_sentry", "gem"}
# Сколько раз предмет должен встретиться в про-матчах на герое, чтобы его советовать
PRO_MIN_COUNT = 3
PRO_BUILD_SIZE = 6
# Дешёвые собранные предметы (Bracer, Wand) в про-сборку не берём, кроме сапог
PRO_BUILD_MIN_COST = 1200
UPGRADED_BOOTS = ("tranquil_boots", "arcane_boots", "phase_boots", "power_treads", "boots_of_bearing", "guardian_greaves", "travel_boots")
# Отрезки игры в минутах: линия, мидгейм, лейт
PHASES = [("lane", "Линия", 0, 10), ("mid", "Мидгейм", 10, 25), ("late", "Лейт", 25, None)]
SWING_WINDOW = 5
SWING_MIN_GOLD = 3000


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
    phases: list[dict] = field(default_factory=list)
    moments: list[dict] = field(default_factory=list)
    pro_build: list[dict] = field(default_factory=list)
    verdict: str = ""

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


def num(n: int | float) -> str:
    """1234567 -> «1 234 567» с неразрывными пробелами."""
    n = int(n)
    return ("-" if n < 0 else "") + f"{abs(n):,}".replace(",", " ")


def signed(n: int | float) -> str:
    n = int(n)
    return f"+{num(n)}" if n > 0 else num(n)


def text_hash(s: str) -> int:
    """Простой хеш, который одинаково считается в Python и JS."""
    h = 0
    for ch in s:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def fill(template: str, params: dict) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: str(params[m.group(1)]), template)


def position(player: dict) -> int:
    return player.get("position_est") or {1: 1, 2: 2, 3: 3}.get(player.get("lane_role"), 4)


def at_minute(series: list | None, minute: int) -> int | None:
    if not series:
        return None
    return series[minute] if minute < len(series) else series[-1]


def deaths_word(n: int) -> str:
    return plural(n, "смерть", "смерти", "смертей")


def times_word(n: int) -> str:
    return plural(n, "раз", "раза", "раз")


class MatchAnalyzer:
    def __init__(self, match: dict, player: dict, od: OpenDota, pro_items: dict[str, int] | None = None):
        self.match = match
        self.p = player
        self.od = od
        self.pro = pro_items or {}
        self.duration = match["duration"]
        self.minutes = self.duration // 60
        self.pos = position(player)
        self.core = self.pos <= 3
        self.won = player["isRadiant"] == match["radiant_win"]
        self.allies = [x for x in match["players"] if x["isRadiant"] == player["isRadiant"]]
        self.enemies = [x for x in match["players"] if x["isRadiant"] != player["isRadiant"]]
        self.opponent = next((e for e in self.enemies if position(e) == LANE_OPPONENT[self.pos]), None)
        self.opp_name = self.od.hero_name(self.opponent["hero_id"]) if self.opponent else None
        self.hero = self.od.hero_name(player["hero_id"])
        self.bench = {k: round(v["pct"] * 100) for k, v in (player.get("benchmarks") or {}).items()}
        sign = 1 if player["isRadiant"] else -1
        self.team_adv = [a * sign for a in match.get("radiant_gold_adv") or []]
        self.fight_windows = [(tf["start"] - TEAMFIGHT_MARGIN, tf["end"] + TEAMFIGHT_MARGIN)
                              for tf in match.get("teamfights") or []]
        self.findings: list[Finding] = []
        self.penalty: dict[str, float] = {c: 0.0 for c in CATEGORIES}

    # ---------- тексты ----------

    def say(self, key: str, seed: str = "", **params) -> str:
        """Текст по шаблону. Вариант зависит от матча, игрока и seed, чтобы фразы не повторялись."""
        variants = TEXTS[key]
        seed = f"{self.match['match_id']}:{self.p['player_slot']}:{key}:{seed}"
        # Слова при числах склоняются сами: «2 крипа», «5 минут»
        if "lh" in params:
            params["creeps"] = plural(params["lh"], "крип", "крипа", "крипов")
            params["lasthits"] = plural(params["lh"], "ластхит", "ластхита", "ластхитов")
        if "mins" in params:
            params["mins_word"] = plural(params["mins"], "минуту", "минуты", "минут")
        return fill(variants[text_hash(seed) % len(variants)], params)

    def add(self, category: str, severity: str, key: str, tip_key: str | None = None, kind: str = "", **params):
        text = self.say(key, **params)
        tip = self.say(tip_key, **params) if tip_key else ""
        self.add_raw(category, severity, text, tip, kind)

    def add_raw(self, category: str, severity: str, text: str, tip: str = "", kind: str = ""):
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
        pro_build = self.pro_build()
        self.check_pro_build(pro_build)
        scores = self.compute_scores()
        phases = self.phases()
        return Analysis(
            facts=self.collect_facts(killers, phases, pro_build),
            findings=self.findings,
            scores=scores,
            timeline=self.collect_timeline(),
            killers=killers,
            phases=phases,
            moments=self.moments(),
            pro_build=pro_build,
            verdict=self.verdict(scores),
        )

    # ---------- про-сборки ----------

    def pro_count(self, key: str) -> int:
        return self.pro.get(key, 0)

    def is_final_item(self, key: str) -> bool:
        item = self.od.items.get(key) or {}
        return bool(item.get("components")) or key in ("blink", "aghanims_shard")

    def pro_filter(self, keys: list[str]) -> list[str] | None:
        """Оставляет предметы, которые про-игроки реально берут на этом герое. None — данных нет."""
        if not self.pro:
            return None
        kept = [k for k in keys if self.pro_count(k) >= PRO_MIN_COUNT]
        return sorted(kept, key=lambda k: -self.pro_count(k))

    def pro_build(self) -> list[dict]:
        finals = [
            (k, c) for k, c in self.pro.items()
            if self.is_final_item(k) and c >= PRO_MIN_COUNT
            and (self.od.item_cost(k) >= PRO_BUILD_MIN_COST or k in UPGRADED_BOOTS)
        ]
        finals.sort(key=lambda kc: (-kc[1], kc[0]))
        if not finals:
            return []
        top = finals[0][1]
        purchases = {}
        for x in self.p.get("purchase_log") or []:
            purchases.setdefault(x["key"], x["time"])
        owned = self.owned_items()
        return [
            {
                "key": k,
                "item": self.od.item_name(k),
                "share": round(c / top * 100),
                "owned": k in owned,
                "time": purchases.get(k),
            }
            for k, c in finals[:PRO_BUILD_SIZE]
        ]

    def check_pro_build(self, build: list[dict]):
        if self.minutes < 25 or len(build) < 3:
            return
        top5 = build[:5]
        have = sum(1 for b in top5 if b["owned"])
        missing = [b["item"] for b in build[:3] if not b["owned"]]
        if have <= 1 and missing:
            self.add(ITEMS, WARN, "items_pro_missing", "items_pro_missing_tip",
                     hero=self.hero, items=", ".join(missing[:2]))
        elif have >= 3:
            self.add(ITEMS, GOOD, "items_pro_match", hero=self.hero, n=have)

    # ---------- линия (0-10 минута) ----------

    def check_lane(self):
        p, pos = self.p, self.pos
        lh10, dn10 = at_minute(p["lh_t"], 10), at_minute(p["dn_t"], 10)

        if self.core and self.minutes >= 10:
            target = LH_TARGET_10[pos]
            if lh10 < target * 0.7:
                self.add(LANE, BAD, "lane_lh_bad", "lane_lh_bad_tip", lh=lh10, target=target)
            elif lh10 < target:
                self.add(LANE, WARN, "lane_lh_warn", lh=lh10, target=target)
            elif lh10 >= target * 1.25:
                self.add(LANE, GOOD, "lane_lh_good", lh=lh10)
            if pos == 2 and dn10 < 6:
                self.add(LANE, WARN, "lane_denies_warn", "lane_denies_warn_tip", dn=dn10)

        if self.opponent and self.minutes >= 10:
            diff = at_minute(p["networth_t"], 10) - at_minute(self.opponent["networth_t"], 10)
            if diff <= -1000:
                self.add(LANE, BAD, "lane_lost", "lane_lost_tip", opp=self.opp_name, gold=num(-diff))
            elif diff >= 1000:
                self.add(LANE, GOOD, "lane_won", opp=self.opp_name, gold=num(diff))

        early = [d for d in p.get("deaths_log") or [] if d["time"] < 600]
        if len(early) >= 2:
            n = len(early)
            self.add(LANE, BAD, "lane_deaths", "lane_deaths_tip", n=n, deaths_word=deaths_word(n),
                     times_word=times_word(n), times=", ".join(mmss(d["time"]) for d in early))

    # ---------- фарм ----------

    def check_farm(self):
        p = self.p
        if self.core:
            for key, name in (("gold_per_min", "GPM"), ("last_hits_per_min", "Ластхиты в минуту")):
                pct = self.bench.get(key)
                if pct is None:
                    continue
                if pct < 25:
                    self.add(FARM, BAD, "farm_bench_bad", name=name, pct=100 - pct)
                elif pct >= 80:
                    self.add(FARM, GOOD, "farm_bench_good", name=name, pct=pct)

            for start, end, lh in self.idle_windows():
                self.add(FARM, WARN, "farm_idle", "farm_idle_tip",
                         **{"from": mmss(start * 60), "to": mmss(end * 60), "lh": lh, "mins": end - start})

            if self.pos == 1 and self.minutes >= 25 and p["last_hits"] > 0:
                share = p.get("neutral_kills", 0) / p["last_hits"]
                if share < 0.15:
                    self.add(FARM, WARN, "farm_jungle", "farm_jungle_tip", share=round(share * 100))

            towers = self.bench.get("tower_damage")
            if self.pos in (1, 3) and self.minutes >= 25 and towers is not None and towers < 20:
                self.add(FARM, WARN, "farm_towers", "farm_towers_tip", pct=100 - towers)

        if self.opponent and self.minutes >= 20 and self.core:
            diff = at_minute(p["networth_t"], 20) - at_minute(self.opponent["networth_t"], 20)
            if diff <= -3000:
                self.add(FARM, BAD, "farm_nw_behind", opp=self.opp_name, gold=num(-diff))
            elif diff >= 3000:
                self.add(FARM, GOOD, "farm_nw_ahead", opp=self.opp_name, gold=num(diff))

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
                self.add(FIGHTS, BAD, "fights_kp_bad", "fights_kp_bad_tip", kp=kp)
            elif kp >= 70:
                self.add(FIGHTS, GOOD, "fights_kp_good", kp=kp)

        missed = self.missed_fights()
        if missed:
            n = len(missed)
            times = ", ".join(f"{mmss(t)} (-{k})" for t, k in missed[:3])
            self.add(FIGHTS, BAD if n >= 3 else WARN, "fights_missed", "fights_missed_tip",
                     n=n, fights_word=plural(n, "драку", "драки", "драк"), times=times)

        if self.core:
            pct = self.bench.get("hero_damage_per_min")
            if pct is not None and pct < 25:
                self.add(FIGHTS, WARN, "fights_dmg_bad", "fights_dmg_bad_tip", pct=100 - pct)
            elif pct is not None and pct >= 80:
                self.add(FIGHTS, GOOD, "fights_dmg_good", pct=pct)

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
            took_part = me["damage"] > 0 or me["healing"] > 0 or me["deaths"] > 0 or bool(me["ability_uses"])
            was_dead = any(s <= tf["start"] <= e for s, e in dead)
            ally_deaths = sum(players[i]["deaths"] for i in ally_idx if i < len(players))
            if not took_part and not was_dead and ally_deaths >= 2:
                result.append((tf["start"], ally_deaths))
        return result

    # ---------- выживание ----------

    def in_fight(self, t: int) -> bool:
        return any(s <= t <= e for s, e in self.fight_windows)

    def check_survival(self):
        p = self.p
        deaths = p.get("deaths_log") or []
        pct = self.bench.get("deaths_per_min")
        n = p["deaths"]
        if pct is not None and pct < 25:
            self.add(SURVIVAL, BAD, "surv_deaths_bad", n=n, deaths_word=deaths_word(n), pct=100 - pct)
        elif pct is not None and pct >= 80 and self.minutes >= 20:
            self.add(SURVIVAL, GOOD, "surv_deaths_good", n=n, deaths_word=deaths_word(n))

        solo = [d for d in deaths if d["time"] >= 600 and not self.in_fight(d["time"])]
        if len(solo) >= 2:
            k = len(solo)
            self.add(SURVIVAL, BAD, "surv_solo", "surv_solo_tip", n=k, times_word=times_word(k),
                     times=", ".join(mmss(d["time"]) for d in solo[:5]))

        dead_share = (p.get("life_state_dead") or 0) / max(self.duration, 1)
        if dead_share >= 0.15:
            self.add(SURVIVAL, BAD, "surv_dead_time", "surv_dead_time_tip",
                     time=mmss(p["life_state_dead"]), pct=round(dead_share * 100))

        lost = sum(d.get("gold_lost", 0) for d in deaths)
        if lost >= 1000 and lost / max(p.get("total_gold") or 1, 1) >= 0.1:
            self.add(SURVIVAL, WARN, "surv_gold_lost", "surv_gold_lost_tip", gold=num(lost))

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
            params = {"item": first["item"], "time": mmss(first["time"])}
            if minute >= 20:
                self.add(ITEMS, BAD, "items_first_bad", "items_first_bad_tip", **params)
            elif minute >= 17:
                self.add(ITEMS, WARN, "items_first_warn", **params)
            elif minute <= 13:
                self.add(ITEMS, GOOD, "items_first_good", **params)
        elif self.core and self.minutes >= 20:
            self.add(ITEMS, BAD, "items_none")

        # BKB советуем, только если про-игроки на этом герое его реально собирают
        bkb_popular = self.pro_count("black_king_bar") >= PRO_MIN_COUNT
        if self.pos in (1, 2) and self.minutes >= 30 and bkb_popular:
            if not any(x["key"] == "black_king_bar" for x in items):
                self.add(ITEMS, WARN, "items_no_bkb", "items_no_bkb_tip")

        tps = (p.get("item_uses") or {}).get("tpscroll", 0)
        if self.minutes >= 20 and tps < self.minutes / 10:
            self.add(ITEMS, WARN, "items_tp", "items_tp_tip", n=tps, mins=self.minutes)

        boots = next((x for x in p.get("purchase_log") or [] if x["key"] == "boots"), None)
        if self.core and boots and boots["time"] > 360:
            self.add(ITEMS, WARN, "items_boots", "items_boots_tip", time=mmss(boots["time"]))

        if not self.won and p.get("gold", 0) >= 2500:
            self.add(ITEMS, WARN, "items_gold_left", "items_gold_left_tip", gold=num(p["gold"]))

    # ---------- видение ----------

    def check_vision(self):
        p = self.p
        obs, sen = p.get("obs_placed", 0), p.get("sen_placed", 0)
        dewards = p.get("observer_kills", 0) + p.get("sentry_kills", 0)
        if self.pos >= 4 and self.minutes >= 15:
            per10 = obs / self.minutes * 10
            if per10 < 2.5:
                self.add(VISION, BAD, "vision_obs_bad", "vision_obs_bad_tip", n=obs, mins=self.minutes)
            elif per10 >= 4:
                self.add(VISION, GOOD, "vision_obs_good", n=obs)

            short, total = self.dewarded_observers()
            if total >= 4 and short / total >= 0.4:
                self.add(VISION, WARN, "vision_dewarded", "vision_dewarded_tip", short=short, total=total)

            if sen < obs / 2:
                self.add(VISION, WARN, "vision_sentries", "vision_sentries_tip", sen=sen, obs=obs, dewards=dewards)

            if self.pos == 5 and self.minutes >= 25 and p.get("camps_stacked", 0) < 2:
                self.add(VISION, WARN, "vision_stacks", "vision_stacks_tip")

            smokes = (p.get("item_uses") or {}).get("smoke_of_deceit", 0)
            if self.minutes >= 30 and smokes == 0:
                self.add(VISION, WARN, "vision_smoke", "vision_smoke_tip", mins=self.minutes)
        elif self.core and dewards >= 3:
            self.add(VISION, GOOD, "vision_dewards_good", n=dewards)

        if self.pos == 2 and self.minutes >= 20:
            runes = p.get("rune_pickups", 0)
            if runes < self.minutes / 5:
                self.add(VISION, WARN, "vision_runes", "vision_runes_tip", n=runes)

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
        """Контр-предметы под роль: каких не хватало (только из про-сборок героя) и какие уже были."""
        candidates: list[str] = []
        for m in mechanics:
            candidates += KNOWLEDGE["mechanics"][m][self.role()]
        if main_type in KNOWLEDGE["damage_types"]:
            candidates += KNOWLEDGE["damage_types"][main_type][self.role()]
        unique: list[str] = []
        for key in candidates:
            if key not in unique:
                unique.append(key)
        had = [k for k in unique if k in owned]
        missing = [k for k in unique if k not in owned]
        popular = self.pro_filter(missing)
        if popular is not None:
            missing = popular
        return missing[:MAX_COUNTER_ITEMS], had

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

    def check_killers(self) -> list[dict]:
        counts: dict[str, int] = {}
        for d in self.p.get("deaths_log") or []:
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
                "hero_id": enemy["hero_id"],
                "key": key,
                "deaths": n,
                "damage": total,
                "main_type": main_type,
                "main_type_share": share,
                "damage_by_type": by_type,
                "sources": sources[:4],
                "disables": self.disables_from(enemy)[:3],
                "mechanics": [KNOWLEDGE["mechanics"][m]["name"] for m in mechanics],
                "tips": [KNOWLEDGE["mechanics"][m]["tip"].replace("{hero}", name) for m in mechanics],
                "counters": [self.od.item_name(k) for k in missing],
                "counter_keys": missing,
                "had_counters": [self.od.item_name(k) for k in had],
                "had_counter_keys": had,
            }
            killers.append(killer)
        # Подробно разбираем трёх самых опасных: остальные утонули бы в тексте
        for killer in killers[:3]:
            self.add_killer_finding(killer)
        return killers[:3]

    def add_killer_finding(self, k: dict):
        n = k["deaths"]
        text = self.say("killer_head", seed=k["key"], hero=k["hero"], n=n, times_word=times_word(n))
        if k["damage"]:
            how = ", ".join(f"{s['name']} {num(s['damage'])}" for s in k["sources"][:3])
            text += f": {num(k['damage'])} урона"
            if k["main_type"]:
                text += f", {k['main_type_share']}% {DAMAGE_TYPE_NAMES[k['main_type']]}"
            text += f" ({how})"
        if k["disables"]:
            text += ". Контроль: " + ", ".join(f"{d['name']} ×{d['count']}" for d in k["disables"])

        tip_parts = k["tips"][:2]
        if k["counters"]:
            tip_parts.append(self.say("killer_buy", seed=k["key"], items=", ".join(k["counters"])))
        elif self.pro and not k["had_counters"]:
            tip_parts.append(self.say("killer_no_items", seed=k["key"]))
        if n >= 3:
            had = set(k["had_counter_keys"])
            if had & DETECTION_ITEMS:
                tip_parts.append(self.say("killer_had_detect", seed=k["key"]))
            active = [self.od.item_name(x) for x in k["had_counter_keys"] if x not in DETECTION_ITEMS]
            if active:
                tip_parts.append(self.say("killer_had_active", seed=k["key"], items=", ".join(active[:2]),
                                          verb="были" if len(active) > 1 else "был"))
        self.add_raw(SURVIVAL, BAD if n >= 4 else WARN, text, ". ".join(tip_parts), "killer")

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
                if share < threshold or owned & set(counters):
                    continue
                popular = self.pro_filter(counters)
                options = (popular if popular is not None else counters)[:3]
                if options:
                    self.add(ITEMS, WARN, "items_dmg_type", "items_dmg_type_tip", pct=round(share * 100),
                             type=DAMAGE_TYPE_ADJ[dmg_type], items=", ".join(self.od.item_name(k) for k in options))

        enemy_tags: dict[str, list[str]] = {}
        for e in self.enemies:
            for tag in KNOWLEDGE["heroes"].get(self.od.hero_key(e["hero_id"]), []):
                enemy_tags.setdefault(tag, []).append(self.od.hero_name(e["hero_id"]))

        if "invis" in enemy_tags and self.pos >= 4 and not owned & DETECTION_ITEMS:
            self.add(VISION, BAD, "vision_invis", "vision_invis_tip", heroes=", ".join(enemy_tags["invis"]))

        accuracy_popular = self.pro_filter(["monkey_king_bar", "bloodthorn"])
        if ("evasion" in enemy_tags and self.pos == 1 and self.minutes >= 30
                and not owned & {"monkey_king_bar", "bloodthorn"} and accuracy_popular != []):
            self.add(ITEMS, WARN, "items_evasion", "items_evasion_tip", heroes=", ".join(enemy_tags["evasion"]))

        antiheal_popular = self.pro_filter(["spirit_vessel", "shivas_guard", "skadi"])
        if (len(enemy_tags.get("heal", [])) >= 2 and self.pos in (3, 4)
                and not owned & {"spirit_vessel", "shivas_guard", "skadi"} and antiheal_popular != []):
            self.add(ITEMS, WARN, "items_heal", "items_heal_tip", heroes=", ".join(enemy_tags["heal"]))

    # ---------- игра в целом ----------

    def check_game(self):
        adv = self.team_adv
        if not adv or self.won:
            return
        best_minute, best = max(enumerate(adv), key=lambda x: x[1])
        if best >= 8000:
            self.add(FIGHTS, WARN, "game_throw", "game_throw_tip", gold=num(best), minute=best_minute)

    # ---------- фазы игры ----------

    def phases(self) -> list[dict]:
        p = self.p
        lh = p["lh_t"]
        kills = [k["time"] for k in p.get("kills_log") or [] if k["key"].startswith("npc_dota_hero_")]
        deaths = [d["time"] for d in p.get("deaths_log") or []]
        result = []
        for key, title, start, end in PHASES:
            if self.minutes <= start + 2:
                break
            stop = min(end if end is not None else self.minutes, len(lh) - 1)
            t0, t1 = start * 60, (stop * 60 if end is not None else self.duration + 1)
            n_kills = sum(1 for t in kills if t0 <= t < t1)
            n_deaths = sum(1 for t in deaths if t0 <= t < t1)
            lh_gain = lh[stop] - lh[start]
            team_delta = (at_minute(self.team_adv, stop) - at_minute(self.team_adv, start)) if self.team_adv else 0
            if self.opponent:
                onw = self.opponent["networth_t"]
                pnw = p["networth_t"]
                nw_delta = (at_minute(pnw, stop) - at_minute(onw, stop)) - (at_minute(pnw, start) - at_minute(onw, start))
                nw_text = f"По нетворсу против {self.opp_name}: {signed(nw_delta)}."
                swing = nw_delta / 1000
            else:
                nw_delta = None
                nw_text = f"Команда за этот отрезок: {signed(team_delta)} золота."
                swing = team_delta / 2000
            score = n_kills - n_deaths * 1.5 + swing
            verdict = "good" if score >= 2 else "bad" if score <= -2 else "even"
            kills_text = f"{n_kills} {plural(n_kills, 'убийство', 'убийства', 'убийств')}"
            deaths_text = "без смертей" if n_deaths == 0 else f"{n_deaths} {deaths_word(n_deaths)}"
            result.append({
                "key": key,
                "title": f"{title} · {start}–{stop} мин",
                "verdict": verdict,
                "text": self.say(f"phase_{key}_{verdict}", lh=lh_gain, kills_text=kills_text,
                                 deaths_text=deaths_text, nw_text=nw_text),
                "kills": n_kills,
                "deaths": n_deaths,
                "last_hits": lh_gain,
                "nw_delta": nw_delta,
                "team_delta": team_delta,
            })
        return result

    # ---------- ключевые моменты ----------

    def moments(self) -> list[dict]:
        p = self.p
        out = []

        def add(t, severity, text):
            out.append({"time": t, "clock": mmss(t), "severity": severity, "text": text})

        kills = [k for k in p.get("kills_log") or [] if k["key"].startswith("npc_dota_hero_")]
        if kills:
            add(kills[0]["time"], GOOD, self.say("moment_first_kill", seed=str(kills[0]["time"]), victim=self.od.hero_name_by_key(kills[0]["key"])))

        for d in p.get("deaths_log") or []:
            killer = self.od.hero_name_by_key(d["key"])
            if killer == "башня":
                key = "moment_death_tower"
            elif not d["key"].startswith("npc_dota_hero_"):
                key = "moment_death_creeps"
            else:
                key = "moment_death_fight" if self.in_fight(d["time"]) else "moment_death_solo"
            add(d["time"], BAD, self.say(key, seed=str(d["time"]), killer=killer))

        for x in p.get("purchase_log") or []:
            if self.is_final_item(x["key"]) and self.od.item_cost(x["key"]) >= 2000:
                add(x["time"], "item", self.say("moment_item", seed=str(x["time"]), item=self.od.item_name(x["key"])))

        for t, n in self.missed_fights():
            add(t, WARN, self.say("moment_missed_fight", seed=str(t), n=n))

        for b in p.get("buyback_log") or []:
            add(b["time"], "info", self.say("moment_buyback", seed=str(b["time"])))

        adv = self.team_adv
        if len(adv) > SWING_WINDOW:
            deltas = [(adv[i + SWING_WINDOW] - adv[i], i) for i in range(len(adv) - SWING_WINDOW)]
            worst = min(deltas, key=lambda d: d[0])
            best = max(deltas, key=lambda d: d[0])
            for (delta, i), key, sev in ((worst, "moment_swing_down", BAD), (best, "moment_swing_up", GOOD)):
                if abs(delta) >= SWING_MIN_GOLD and (delta < 0) == (key == "moment_swing_down"):
                    add(i * 60, sev, self.say(key, gold=num(abs(delta)), **{"from": f"{i}:00", "to": f"{i + SWING_WINDOW}:00"}))

        out.sort(key=lambda m: m["time"])
        return out

    # ---------- оценки и итоги ----------

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

    def verdict(self, scores: dict[str, int]) -> str:
        mean = sum(scores.values()) / len(scores)
        key = "verdict_top" if mean >= 8 else "verdict_good" if mean >= 6.5 else "verdict_mid" if mean >= 5 else "verdict_bad"
        return self.say(key)

    def collect_facts(self, killers: list[dict], phases: list[dict], pro_build: list[dict]) -> dict:
        p = self.p
        return {
            "match_id": self.match["match_id"],
            "hero": self.hero,
            "hero_id": p["hero_id"],
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
            "lane_opponent": self.opp_name,
            "lane_opponent_id": self.opponent["hero_id"] if self.opponent else None,
            "allies": [self.od.hero_name(a["hero_id"]) for a in self.allies if a is not p],
            "enemies": [self.od.hero_name(e["hero_id"]) for e in self.enemies],
            "items": [f"{x['item']} {mmss(x['time'])}" for x in self.core_items()],
            "pro_build": [f"{b['item']} ({b['share']}%){' — был' if b['owned'] else ''}" for b in pro_build],
            "phases": [f"{ph['title']}: {ph['text']}" for ph in phases],
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
            "opponent_name": self.opp_name,
            "hero": self.hero,
            "deaths": [d["time"] for d in self.p.get("deaths_log") or []],
            "last_hits": self.p["lh_t"],
            "team_gold_adv": self.team_adv,
        }


def analyze(match: dict, player: dict, od: OpenDota, pro_items: dict[str, int] | None = None) -> Analysis:
    return MatchAnalyzer(match, player, od, pro_items).run()
