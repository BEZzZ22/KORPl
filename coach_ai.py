"""Разбор матча через Claude. Включается, только если задан ANTHROPIC_API_KEY."""
import json
import os

import anthropic

from analysis import Analysis

MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-5-5")

SYSTEM = """Ты опытный тренер по Dota 2. Тебе дают статистику одного игрока за матч и ошибки, которые уже нашла автоматика.
Твоя задача — объяснить игроку, почему так вышло и что конкретно делать иначе.

Правила:
- Учитывай героя, позицию, оппонента по линии и вражеский пик. Советы должны быть про этого героя в этом матче, а не общие.
- Свяжи ошибки между собой: например, проигранная линия -> поздний предмет -> смерти в драках.
- Оцени сборку предметов против вражеского пика: чего не хватало, что было лишним.
- Опирайся только на данные. Не выдумывай события, которых в них нет.
- Пиши по-русски, просто и по делу, как друг, который шарит. Без мата и без воды.
- Формат: 3-5 коротких абзацев, затем строка "Главное:" и 3 пронумерованных совета. Без markdown, без звёздочек и решёток.
- Не больше 2000 символов."""


def enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


async def analyze(a: Analysis) -> str:
    client = anthropic.AsyncAnthropic(timeout=60, max_retries=2)
    findings = [f"[{f.category}] {f.text}" for f in a.findings]
    prompt = (
        "Статистика игрока:\n"
        + json.dumps(a.facts, ensure_ascii=False, indent=1)
        + "\n\nОценки по разделам (1-10): "
        + json.dumps(a.scores, ensure_ascii=False)
        + "\n\nНайденные автоматикой ошибки и плюсы:\n"
        + "\n".join(f"- {x}" for x in findings or ["нет"])
    )
    response = await client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("модель отказалась отвечать")
    return "".join(b.text for b in response.content if b.type == "text").strip()
