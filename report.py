"""Оформление разбора для Telegram (HTML-разметка)."""
from functools import partial
from html import escape as _escape

from analysis import BAD, CATEGORIES, DAMAGE_TYPE_NAMES, GOOD, TURBO_MODE, WARN, Analysis, mmss, num, plural

MAX_MOMENTS = 16
TURBO_NOTE = "⚠ Это Турбо: золото и опыт идут быстрее, а нормы разбора рассчитаны на обычную игру. Оценки могут быть неточными."

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
    text = f"{header(a)}\n\n<b>Оценка: {a.overall}/10</b>\n<i>{escape(a.verdict)}</i>"
    if a.facts.get("game_mode") == TURBO_MODE:
        text += f"\n\n{TURBO_NOTE}"
    return text


def scores_block(a: Analysis) -> str:
    width = max(len(c) for c in CATEGORIES)
    rows = [f"{c.ljust(width)}  {bar(s)}  {s}" for c, s in a.scores.items()]
    return "<pre>" + escape("\n".join(rows)) + "</pre>"


def finding_lines(findings, numbered: bool) -> list[str]:
    lines = []
    for i, f in enumerate(findings, 1):
        mark = f"{i}." if numbered else "•"
        lines.append(f"{mark} {escape(f.text)}")
        if f.roast:
            lines.append(f"    <i>«{escape(f.roast)}»</i>")
        if f.tip:
            lines.append(f"    <i>→ {escape(f.tip)}</i>")
    return lines


# Короткие подписи, чтобы таблица влезала в экран телефона
COMPARE_SHORT = {
    "gold_per_min": "GPM",
    "xp_per_min": "XPM",
    "last_hits_per_min": "Крипы/10м",
    "hero_damage_per_min": "Урон/мин",
    "kills_per_min": "Убийства/10м",
    "assists_per_min": "Ассисты/10м",
    "deaths_per_min": "Смерти/10м",
    "tower_damage": "По вышкам",
}


def compare_block(a: Analysis) -> str:
    rows = [("", "ты", "средн", "топ")]
    for c in a.compare:
        mark = "▲" if c["pct"] >= 50 else "▼"
        rows.append((f"{mark} {COMPARE_SHORT.get(c['key'], c['name'])}", c["you"], c["median"], c["top"]))
    widths = [max(len(r[i]) for r in rows) for i in range(4)]
    lines = [" ".join(r[0].ljust(widths[0]) if i == 0 else r[i].rjust(widths[i]) for i in range(4)) for r in rows]
    return (
        f"<b>Ты против других игроков на {escape(a.facts['hero'])}</b>\n"
        "<pre>" + escape("\n".join(lines)) + "</pre>\n"
        "<i>средн — медиана всех игроков на герое, топ — лучший 1%</i>"
    )


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
    roasts = [f.roast for f in a.findings if f.kind == "killer"]
    for k, roast in zip(a.killers, roasts + [""] * len(a.killers)):
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
        if roast:
            lines.append(f"<i>«{escape(roast)}»</i>")
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


def summary_block(a: Analysis) -> str:
    s = a.summary or {}
    who = s.get("role") or ""
    if s.get("rank"):
        who += f" · ранг {s['rank']}"
    if not s.get("role_sure", True):
        who += " · роль определена неточно"
    lines = [f"<b>Сводка</b> <i>({escape(who)})</i>" if who else "<b>Сводка</b>"]
    problems = s.get("problems") or []
    if problems:
        lines.append("\n<b>Что было не так</b>")
        for i, p in enumerate(problems, 1):
            lines.append(f"{i}. <b>{escape(p['title'])}</b>\n{escape(p['fact'])}\n<i>→ {escape(p['action'])}</i>")
    else:
        lines.append("\nСерьёзных ошибок не нашёл.")
    strengths = s.get("strengths") or []
    if strengths:
        lines.append("\n<b>Что получилось</b>")
        for st in strengths:
            lines.append(f"+ {escape(st['title'])}" + (f" — {escape(st['fact'])}" if st.get("fact") else ""))
    if s.get("goal"):
        lines.append(f"\n<b>{escape(s['goal'])}</b>")
    return "\n".join(lines)


MAX_DETAILS = 6


def full_report(a: Analysis) -> str:
    parts = [f"<b>Оценка: {a.overall}/10</b>\n<i>{escape(a.verdict)}</i>", summary_block(a), scores_block(a)]

    # Убийцы выводятся отдельным блоком, в общих списках их не дублируем
    rest = [f for f in a.by_severity(BAD) + a.by_severity(WARN) if f.kind != "killer"]
    good = a.by_severity(GOOD)
    if rest:
        parts.append("\n".join(["<b>Остальные замечания</b>"] + finding_lines(rest[:MAX_DETAILS], False)))

    if a.compare:
        parts.append(compare_block(a))
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
