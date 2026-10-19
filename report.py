"""Оформление разбора для Telegram (HTML-разметка)."""
from functools import partial
from html import escape as _escape

from analysis import BAD, CATEGORIES, DAMAGE_TYPE_NAMES, GOOD, WARN, Analysis, mmss, num, plural

MAX_MAIN_PROBLEMS = 4
MAX_MOMENTS = 16

escape = partial(_escape, quote=False)

PHASE_MARK = {"good": "▲", "even": "◆", "bad": "▼"}
MOMENT_MARK = {BAD: "✖", WARN: "!", GOOD: "▲", "item": "◈", "info": "•"}


def bar(score: int) -> str:
    return "▰" * score + "▱" * (10 - score)


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
    return f"{header(a)}\n\n<b>Оценка: {a.overall}/10</b>\n<i>{escape(a.verdict)}</i>"


def scores_block(a: Analysis) -> str:
    width = max(len(c) for c in CATEGORIES)
    rows = [f"{c.ljust(width)}  {bar(s)}  {s}" for c, s in a.scores.items()]
    return "<pre>" + escape("\n".join(rows)) + "</pre>"


def finding_lines(findings, numbered: bool) -> list[str]:
    lines = []
    for i, f in enumerate(findings, 1):
        mark = f"{i}." if numbered else "•"
        lines.append(f"{mark} {escape(f.text)}")
        if f.tip:
            lines.append(f"    <i>→ {escape(f.tip)}</i>")
    return lines


def phases_block(a: Analysis) -> str:
    lines = ["<b>Игра по фазам</b>"]
    for ph in a.phases:
        lines.append(f"\n{PHASE_MARK[ph['verdict']]} <b>{escape(ph['title'])}</b>\n{escape(ph['text'])}")
    return "\n".join(lines)


def moments_block(a: Analysis) -> str:
    moments = a.moments
    if len(moments) > MAX_MOMENTS:
        # Смерти и провалы важнее покупок: если не влезает, сначала выкидываем предметы
        important = [m for m in moments if m["severity"] != "item"]
        moments = sorted(important[:MAX_MOMENTS], key=lambda m: m["time"])
    lines = ["<b>Ключевые моменты</b>"]
    for m in moments:
        lines.append(f"<code>{m['clock']:>5}</code> {MOMENT_MARK.get(m['severity'], '•')} {escape(m['text'])}")
    return "\n".join(lines)


def killers_block(a: Analysis) -> str:
    lines = ["<b>Кто тебя убивал и как</b>"]
    for k in a.killers:
        lines.append(f"\n<b>{escape(k['hero'])}</b> — {k['deaths']} {plural(k['deaths'], 'смерть', 'смерти', 'смертей')}")
        if k["damage"]:
            kind = f", {k['main_type_share']}% {DAMAGE_TYPE_NAMES[k['main_type']]}" if k["main_type"] else ""
            lines.append(f"Урон по тебе: {num(k['damage'])}{kind}")
            lines.append("Чем: " + escape(", ".join(f"{s['name']} {num(s['damage'])}" for s in k["sources"][:3])))
        if k["disables"]:
            lines.append("Контроль: " + escape(", ".join(f"{d['name']} ×{d['count']}" for d in k["disables"])))
        if k["mechanics"]:
            lines.append("Опасен: " + escape(", ".join(k["mechanics"])))
        for tip in k["tips"][:2]:
            lines.append(f"<i>→ {escape(tip)}</i>")
        if k["counters"]:
            lines.append("<i>→ На твоём герое против него берут: " + escape(", ".join(k["counters"])) + "</i>")
        if k["had_counters"]:
            lines.append("Уже было: " + escape(", ".join(k["had_counters"])))
    return "\n".join(lines)


def pro_build_block(a: Analysis) -> str:
    lines = [f"<b>Сборка против про-игроков на {escape(a.facts['hero'])}</b>"]
    for b in a.pro_build:
        if b["owned"]:
            when = f" — у тебя на {mmss(b['time'])}" if b["time"] is not None else " — было"
            lines.append(f"✔ {escape(b['item'])} <i>({b['share']}%)</i>{when}")
        else:
            lines.append(f"✘ {escape(b['item'])} <i>({b['share']}%)</i> — не было")
    lines.append("<i>% — как часто предмет берут на герое в про-матчах относительно самого популярного</i>")
    return "\n".join(lines)


def full_report(a: Analysis) -> str:
    parts = [f"<b>Оценка: {a.overall}/10</b>\n<i>{escape(a.verdict)}</i>", scores_block(a)]

    # Убийцы выводятся отдельным блоком, в общих списках их не дублируем
    bad = [f for f in a.by_severity(BAD) if f.kind != "killer"]
    warn = [f for f in a.by_severity(WARN) if f.kind != "killer"]
    good = a.by_severity(GOOD)

    if bad:
        parts.append("\n".join(["<b>Главные проблемы</b>"] + finding_lines(bad[:MAX_MAIN_PROBLEMS], True)))
        warn = bad[MAX_MAIN_PROBLEMS:] + warn
    if warn:
        parts.append("\n".join(["<b>Мелкие ошибки</b>"] + finding_lines(warn, False)))
    if not bad and not warn:
        parts.append("Явных ошибок по цифрам не нашёл. Красавчик.")

    if a.phases:
        parts.append(phases_block(a))
    if a.moments:
        parts.append(moments_block(a))
    if a.killers:
        parts.append(killers_block(a))
    if a.pro_build:
        parts.append(pro_build_block(a))
    if good:
        parts.append("<b>Что получилось</b>\n" + "\n".join(f"+ {escape(f.text)}" for f in good))

    focus = [f for f in a.by_severity(BAD) + a.by_severity(WARN) if f.tip and f.kind != "killer"][:3]
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
