"""ИИ-тренер: текстовый разбор матча через Gemini или Claude.

Провайдер выбирается переменной AI_PROVIDER (gemini / anthropic). Если она не задана,
берётся тот, чей ключ есть в окружении: GEMINI_API_KEY или ANTHROPIC_API_KEY.
"""
import json
import os

from analysis import Analysis

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-5-5")
MAX_OUTPUT_TOKENS = 4000
TIMEOUT_SECONDS = 60

SYSTEM = """Ты опытный тренер по Dota 2. Тебе дают статистику одного игрока за матч и ошибки, которые уже нашла автоматика.
Твоя задача — объяснить игроку, почему так вышло и что конкретно делать иначе.

Правила:
- Учитывай героя, позицию, оппонента по линии и вражеский пик. Советы должны быть про этого героя в этом матче, а не общие.
- Свяжи ошибки между собой: например, проигранная линия -> поздний предмет -> смерти в драках.
- Разбирай мелкие ошибки как тренер по реплею: называй минуту и что именно надо было нажать или сделать в этот момент.
- Оцени сборку предметов против вражеского пика: чего не хватало, что было лишним.
- Опирайся только на данные. Не выдумывай события, которых в них нет.
- Пиши по-русски, просто и по делу, как друг, который шарит. Без мата и без воды.
- Формат: 3-5 коротких абзацев, затем строка "Главное:" и 3 пронумерованных совета. Без markdown, без звёздочек и решёток.
- Не больше 2000 символов."""


def provider() -> str | None:
    chosen = os.getenv("AI_PROVIDER", "").strip().lower()
    if chosen in ("gemini", "anthropic"):
        return chosen
    if os.getenv("GEMINI_API_KEY"):
        return "gemini"
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    return None


def enabled() -> bool:
    return provider() is not None


# Номера героев модели ни о чём не говорят, вместо них передаём имена
HIDDEN_FACTS = {"allies", "enemies", "hero_id", "lane_opponent_id", "slot", "benchmarks_percentile"}


def build_prompt(a: Analysis) -> str:
    facts = {k: v for k, v in a.facts.items() if k not in HIDDEN_FACTS}
    s = a.summary or {}
    problems = [f"{p['title']}: {p['fact']}" for p in s.get("problems", [])]
    micro = [f"[{f.category}] {f.text}" for f in a.findings if f.kind == "micro"]
    findings = [f"[{f.category}] {f.text}" for f in a.findings if f.kind != "micro"]
    return (
        f"Роль: {s.get('role') or '?'}, ранг: {s.get('rank') or 'неизвестен'}\n"
        "Статистика игрока:\n"
        + json.dumps(facts, ensure_ascii=False, indent=1)
        + "\n\nОценки по разделам (1-10): "
        + json.dumps(a.scores, ensure_ascii=False)
        + "\n\nГлавные проблемы (по убыванию цены в золоте):\n"
        + "\n".join(f"- {x}" for x in problems or ["нет"])
        + "\n\nМелкие ошибки с точным временем:\n"
        + "\n".join(f"- {x}" for x in micro or ["нет"])
        + "\n\nОстальные находки автоматики:\n"
        + "\n".join(f"- {x}" for x in findings or ["нет"])
    )


async def analyze(a: Analysis) -> str:
    prompt = build_prompt(a)
    if provider() == "gemini":
        text = await _gemini(prompt)
    else:
        text = await _claude(prompt)
    if not text:
        raise RuntimeError("модель вернула пустой ответ")
    return text.strip()


async def _gemini(prompt: str) -> str:
    from google import genai
    from google.genai import types

    client = genai.Client(
        api_key=os.environ["GEMINI_API_KEY"],
        http_options=types.HttpOptions(timeout=TIMEOUT_SECONDS * 1000),
    )
    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=SYSTEM, max_output_tokens=MAX_OUTPUT_TOKENS),
    )
    return response.text or ""


async def _claude(prompt: str) -> str:
    import anthropic

    client = anthropic.AsyncAnthropic(timeout=TIMEOUT_SECONDS, max_retries=2)
    response = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("модель отказалась отвечать")
    return "".join(b.text for b in response.content if b.type == "text")
