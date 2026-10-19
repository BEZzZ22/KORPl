"""Оформление разбора для Telegram (HTML-разметка)."""
from functools import partial
from html import escape as _escape

from analysis import BAD, CATEGORIES, GOOD, WARN, Analysis

MAX_MAIN_PROBLEMS = 4

escape = partial(_escape, quote=False)


def bar(score: int) -> str:
    return "▰" * score + "▱" * (10 - score)


def grade(overall: float) -> str:
    if overall >= 8:
        return "отличная игра"
    if overall >= 6.5:
        return "хорошая игра"
    if overall >= 5:
        return "средне, есть над чем поработать"
    return "тяжёлая игра, много ошибок"


def header(a: Analysis) -> str:
    f = a.facts
    result = "Победа" if f["won"] else "Поражение"
    vs = f" против {escape(f['lane_opponent'])}" if f["lane_opponent"] else ""
    return (
        f"<b>{escape(f['hero'])}</b> · позиция {f['position']}{vs}\n"
        f"{result} · {f['duration']} · KDA {f['kda']}\n"
        f"GPM {f['gpm']} · XPM {f['xpm']} · LH {f['last_hits']}/{f['denies']}"
    )


def caption(a: Analysis) -> str:
    """Короткая подпись к графику."""
    return f"{header(a)}\n\n<b>Оценка: {a.overall}/10</b> — {grade(a.overall)}"


def scores_block(a: Analysis) -> str:
    width = max(len(c) for c in CATEGORIES)
    rows = [f"{c.ljust(width)}  {bar(s)}  {s}" for c, s in a.scores.items()]
    return "<pre>" + escape("\n".join(rows)) + "</pre>"


def full_report(a: Analysis) -> str:
    parts = [f"<b>Оценка: {a.overall}/10</b> — {grade(a.overall)}", scores_block(a)]

    bad, warn, good = a.by_severity(BAD), a.by_severity(WARN), a.by_severity(GOOD)

    if bad:
        lines = ["<b>Главные проблемы</b>"]
        for i, f in enumerate(bad[:MAX_MAIN_PROBLEMS], 1):
            lines.append(f"{i}. {escape(f.text)}")
            if f.tip:
                lines.append(f"    <i>→ {escape(f.tip)}</i>")
        warn = bad[MAX_MAIN_PROBLEMS:] + warn
        parts.append("\n".join(lines))

    if warn:
        lines = ["<b>Мелкие ошибки</b>"]
        for f in warn:
            lines.append(f"• {escape(f.text)}")
            if f.tip:
                lines.append(f"    <i>→ {escape(f.tip)}</i>")
        parts.append("\n".join(lines))

    if good:
        parts.append("<b>Что получилось</b>\n" + "\n".join(f"+ {escape(f.text)}" for f in good))

    if not bad and not warn:
        parts.append("Явных ошибок по цифрам не нашёл. Красавчик.")

    items = a.facts["items"]
    if items:
        parts.append("<b>Предметы</b>\n" + escape(" → ".join(items[:8])))

    focus = [f for f in a.by_severity(BAD) + a.by_severity(WARN) if f.tip][:3]
    if focus:
        parts.append(
            "<b>Над чем работать в следующих играх</b>\n"
            + "\n".join(f"{i}. {escape(f.tip)}" for i, f in enumerate(focus, 1))
        )

    return "\n\n".join(parts)


def split_message(text: str, limit: int = 4000) -> list[str]:
    """Режет длинный текст по абзацам, чтобы не порвать HTML-теги."""
    chunks, current = [], ""
    for block in text.split("\n\n"):
        candidate = f"{current}\n\n{block}" if current else block
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            chunks.append(current)
        current = block[:limit]
    if current:
        chunks.append(current)
    return chunks
