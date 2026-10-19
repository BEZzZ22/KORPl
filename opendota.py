"""Клиент OpenDota API: матчи, игроки и справочники героев/предметов."""
import aiohttp

API = "https://api.opendota.com/api"
STEAM64_OFFSET = 76561197960265728


class OpenDota:
    def __init__(self):
        self.session: aiohttp.ClientSession | None = None
        self.heroes: dict[int, str] = {}
        self.heroes_by_key: dict[str, str] = {}
        self.items: dict[str, dict] = {}

    async def start(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        heroes = await self._get("/constants/heroes")
        self.heroes = {int(h["id"]): h["localized_name"] for h in heroes.values()}
        self.heroes_by_key = {h["name"]: h["localized_name"] for h in heroes.values()}
        self.items = await self._get("/constants/items")

    async def close(self):
        if self.session:
            await self.session.close()

    async def _get(self, path: str):
        async with self.session.get(API + path) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def match(self, match_id: int) -> dict | None:
        async with self.session.get(f"{API}/matches/{match_id}") as resp:
            if resp.status == 404:
                return None
            resp.raise_for_status()
            return await resp.json()

    async def request_parse(self, match_id: int):
        """Просит OpenDota разобрать реплей. Без этого нет поминутных данных."""
        async with self.session.post(f"{API}/request/{match_id}") as resp:
            resp.raise_for_status()

    async def last_match_id(self, account_id: int) -> int | None:
        matches = await self._get(f"/players/{account_id}/recentMatches")
        return matches[0]["match_id"] if matches else None

    def hero_name(self, hero_id: int) -> str:
        return self.heroes.get(hero_id, f"герой #{hero_id}")

    def hero_name_by_key(self, key: str) -> str:
        """npc_dota_hero_tusk -> Tusk. Убийцей может быть и не герой (крипы, башня)."""
        return self.heroes_by_key.get(key, key.replace("npc_dota_", ""))

    def item_name(self, key: str) -> str:
        return self.items.get(key, {}).get("dname") or key

    def item_cost(self, key: str) -> int:
        return self.items.get(key, {}).get("cost") or 0


def to_account_id(steam_id: int) -> int:
    """Steam64 -> Steam32 (account_id, который использует OpenDota)."""
    return steam_id - STEAM64_OFFSET if steam_id > STEAM64_OFFSET else steam_id


def is_parsed(match: dict) -> bool:
    return bool(match["players"]) and match["players"][0].get("lh_t") is not None
