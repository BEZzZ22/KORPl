"""Разбор матча через Claude. Включается, только если задан ANTHROPIC_API_KEY."""
import json
import os

import anthropic

MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-5-5")

SYSTEM = """Ты тренер по Dota 2. Тебе дают выжимку статистики одного игрока за матч.
Разбери, что было в игре: как прошла линия, где игрок ошибался, какие предметы и тайминги были плохими или хорошими.
Учитывай героя, позицию и вражеский пик. Опирайся только на данные, не выдумывай события, которых в них нет.
В конце дай 2-3 конкретных совета, над чем работать в следующих играх.
Пиши по-русски, просто и по делу, как друг, который шарит. Без markdown-разметки, до 2500 символов."""


def enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


async def analyze(facts: dict, rule_findings: list[str]) -> str:
    client = anthropic.AsyncAnthropic()
    prompt = (
        "Статистика игрока:\n"
        + json.dumps(facts, ensure_ascii=False, indent=1)
        + "\n\nАвтоматические замечания по цифрам:\n"
        + "\n".join(f"- {x}" for x in rule_findings or ["нет"])
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
