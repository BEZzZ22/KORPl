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
        self._limit = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        self._cache: OrderedDict[int, tuple[float, dict]] = OrderedDict()

    async def start(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        heroes = await self._request("GET", "/constants/heroes")
        self.heroes = {int(h["id"]): h["localized_name"] for h in heroes.values()}
        self.heroes_by_key = {h["name"]: h["localized_name"] for h in heroes.values()}
        self.hero_keys = {int(h["id"]): h["name"] for h in heroes.values()}
        self.items = await self._request("GET", "/constants/items")

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

    def item_name(self, key: str) -> str:
        return self.items.get(key, {}).get("dname") or key

    def item_cost(self, key: str) -> int:
        return self.items.get(key, {}).get("cost") or 0


def to_account_id(steam_id: int) -> int:
    """Steam64 -> Steam32 (account_id, который использует OpenDota)."""
    return steam_id - STEAM64_OFFSET if steam_id > STEAM64_OFFSET else steam_id


def is_parsed(match: dict) -> bool:
    return bool(match.get("players")) and match["players"][0].get("lh_t") is not None
