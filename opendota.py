"""Клиент OpenDota API: матчи, игроки и справочники героев/предметов."""
import asyncio
import logging
import time
from collections import OrderedDict

import aiohttp

API = "https://api.opendota.com/api"
STEAM64_OFFSET = 76561197960265728

# Бесплатный OpenDota пускает ~60 запросов в минуту, держимся с запасом
MAX_CONCURRENT_REQUESTS = 4
MATCH_CACHE_SIZE = 200
UNPARSED_CACHE_TTL = 60
PRO_ITEMS_TTL = 24 * 3600
PRO_ITEM_PHASES = ("early_game_items", "mid_game_items", "late_game_items")

log = logging.getLogger(__name__)


class OpenDotaError(Exception):
    """OpenDota недоступна или ответила ошибкой."""


class OpenDota:
    def __init__(self):
        self.session: aiohttp.ClientSession | None = None
        self.heroes: dict[int, str] = {}
        self.heroes_by_key: dict[str, str] = {}
        self.hero_keys: dict[int, str] = {}
        self.items: dict[str, dict] = {}
        self.abilities: dict[str, dict] = {}
        self.constants: dict = {}
        self._limit = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        self._cache: OrderedDict[int, tuple[float, dict]] = OrderedDict()
        self.item_ids: dict[str, str] = {}
        self._pro_items: dict[int, tuple[float, dict[str, int]]] = {}
        self._hero_bench: dict[int, tuple[float, dict]] = {}

    async def start(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        heroes = await self._request("GET", "/constants/heroes")
        # Компактные справочники для движка разбора (engine_cli.mjs)
        self.constants = {
            "heroes": {k: {f: h.get(f) for f in ("id", "name", "localized_name", "img")} for k, h in heroes.items()},
        }
        self.heroes = {int(h["id"]): h["localized_name"] for h in heroes.values()}
        self.heroes_by_key = {h["name"]: h["localized_name"] for h in heroes.values()}
        self.hero_keys = {int(h["id"]): h["name"] for h in heroes.values()}
        self.items = await self._request("GET", "/constants/items")
        self.item_ids = await self._request("GET", "/constants/item_ids")
        abilities = await self._request("GET", "/constants/abilities")
        # Храним только то, что нужно для разбора: справочник большой
        self.abilities = {
            key: {"dname": a.get("dname"), "dmg_type": damage_type(a.get("dmg_type"))}
            for key, a in abilities.items()
            if a.get("dname")
        }
        self.constants["items"] = {
            k: {f: v.get(f) for f in ("dname", "cost", "components", "img")} for k, v in self.items.items()
        }
        self.constants["abilities"] = self.abilities

    async def close(self):
        if self.session:
            await self.session.close()

    async def _request(self, method: str, path: str, allow_404: bool = False):
        for attempt in range(3):
            try:
                async with self._limit, self.session.request(method, API + path) as resp:
                    if resp.status == 404 and allow_404:
                        return None
                    if resp.status == 429 or resp.status >= 500:
                        raise OpenDotaError(f"HTTP {resp.status}")
                    resp.raise_for_status()
                    return await resp.json()
            except (aiohttp.ClientError, asyncio.TimeoutError, OpenDotaError) as e:
                log.warning("OpenDota %s %s failed (attempt %d): %s", method, path, attempt + 1, e)
                await asyncio.sleep(2**attempt)
        raise OpenDotaError(f"{method} {path} failed")

    async def match(self, match_id: int) -> dict | None:
        cached = self._cache.get(match_id)
        if cached:
            stored_at, match = cached
            # Разобранный матч уже не изменится, неразобранный перепроверяем
            if is_parsed(match) or time.monotonic() - stored_at < UNPARSED_CACHE_TTL:
                self._cache.move_to_end(match_id)
                return match

        match = await self._request("GET", f"/matches/{match_id}", allow_404=True)
        if match and match.get("players"):
            self._cache[match_id] = (time.monotonic(), match)
            if len(self._cache) > MATCH_CACHE_SIZE:
                self._cache.popitem(last=False)
            return match
        return None

    async def pro_items(self, hero_id: int) -> dict[str, int]:
        """Какие предметы и как часто берут на герое в про-матчах (после стартовой закупки)."""
        cached = self._pro_items.get(hero_id)
        if cached and time.monotonic() - cached[0] < PRO_ITEMS_TTL:
            return cached[1]
        try:
            data = await self._request("GET", f"/heroes/{hero_id}/itemPopularity", allow_404=True) or {}
        except OpenDotaError:
            # Без про-сборок разбор всё равно работает, просто советы по предметам общие
            return cached[1] if cached else {}
        counts = pro_item_counts(data, self.item_ids)
        self._pro_items[hero_id] = (time.monotonic(), counts)
        return counts

    async def hero_bench(self, hero_id: int) -> dict:
        """Распределение показателей всех игроков на герое: процентиль -> значение."""
        cached = self._hero_bench.get(hero_id)
        if cached and time.monotonic() - cached[0] < PRO_ITEMS_TTL:
            return cached[1]
        try:
            data = await self._request("GET", f"/benchmarks?hero_id={hero_id}", allow_404=True) or {}
        except OpenDotaError:
            return cached[1] if cached else {}
        result = data.get("result") or {}
        self._hero_bench[hero_id] = (time.monotonic(), result)
        return result

    async def request_parse(self, match_id: int):
        """Просит OpenDota разобрать реплей. Без этого нет поминутных данных."""
        await self._request("POST", f"/request/{match_id}")

    async def refresh_player(self, account_id: int):
        """Просит OpenDota заново подтянуть историю матчей игрока."""
        await self._request("POST", f"/players/{account_id}/refresh")

    async def player(self, account_id: int) -> dict | None:
        data = await self._request("GET", f"/players/{account_id}", allow_404=True)
        return data if data and data.get("profile") else None

    async def recent_matches(self, account_id: int) -> list[dict]:
        return await self._request("GET", f"/players/{account_id}/recentMatches") or []

    def hero_name(self, hero_id: int) -> str:
        return self.heroes.get(hero_id, f"герой #{hero_id}")

    def hero_key(self, hero_id: int) -> str:
        return self.hero_keys.get(hero_id, "")

    def hero_name_by_key(self, key: str) -> str:
        """npc_dota_hero_tusk -> Tusk. Убийцей может быть и не герой (крипы, башня)."""
        if key in self.heroes_by_key:
            return self.heroes_by_key[key]
        if "tower" in key:
            return "башня"
        if "creep" in key or "neutral" in key:
            return "крипы"
        return key.replace("npc_dota_", "")

    def source_name(self, key: str) -> str:
        """Название источника урона: скилл, предмет или автоатака."""
        if key in ("null", ""):
            return "Автоатаки"
        if key in self.abilities:
            return self.abilities[key]["dname"]
        if key in self.items:
            return self.item_name(key)
        return key

    def source_type(self, key: str) -> str | None:
        if key in ("null", ""):
            return "Physical"
        return self.abilities.get(key, {}).get("dmg_type")

    def item_name(self, key: str) -> str:
        return self.items.get(key, {}).get("dname") or key

    def item_cost(self, key: str) -> int:
        return self.items.get(key, {}).get("cost") or 0


def pro_item_counts(popularity: dict, item_ids: dict[str, str]) -> dict[str, int]:
    """itemPopularity (id предмета -> сколько раз) -> {ключ предмета: сумма по ранней, средней и поздней игре}."""
    counts: dict[str, int] = {}
    for phase in PRO_ITEM_PHASES:
        for item_id, n in (popularity.get(phase) or {}).items():
            key = item_ids.get(str(item_id))
            if key:
                counts[key] = counts.get(key, 0) + n
    return counts


def damage_type(value) -> str | None:
    """В справочнике тип урона бывает строкой или списком."""
    if isinstance(value, list):
        value = value[0] if value else None
    return value if value in ("Physical", "Magical", "Pure") else None


def to_account_id(steam_id: int) -> int:
    """Steam64 -> Steam32 (account_id, который использует OpenDota)."""
    return steam_id - STEAM64_OFFSET if steam_id > STEAM64_OFFSET else steam_id


def is_parsed(match: dict) -> bool:
    return bool(match.get("players")) and match["players"][0].get("lh_t") is not None
