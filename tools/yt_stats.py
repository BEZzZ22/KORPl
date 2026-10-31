"""Что заходит людям: статистика наших Shorts на YouTube и отчёт владельцу в Телеграм.
Берёт ролики из promo/yt_posted.json, тянет просмотры и лайки (YouTube Data API) и досмотры (YouTube Analytics API),
сортирует по проценту досмотра, пишет историю в promo/yt_stats.json и шлёт сводку от бота владельцу.
Секреты: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (токен с правами на чтение, см. tools/yt_token.py), BOT_TOKEN.
Владелец: STATS_CHAT (по умолчанию тот же, что OWNER_TG_IDS в worker/wrangler.toml).
Запуск: python tools/yt_stats.py [--dry]  (--dry: собрать отчёт из promo/yt_stats.json и напечатать, без сети)"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE, POSTED, STATS = ROOT / "promo" / "yt_queue.json", ROOT / "promo" / "yt_posted.json", ROOT / "promo" / "yt_stats.json"
OWNER = "6603684388"
METRICS = "views,averageViewDuration,averageViewPercentage,likes,shares,subscribersGained"
DEAD_HINT = ("Токен YouTube умер: Shorts не загружаются. Google Cloud -> Auth Platform -> Audience -> In production, "
             "потом на компьютере python tools/yt_token.py и новый токен в секрет YT_REFRESH_TOKEN.")
SCOPE_HINT = ("Токену YouTube не хватает прав на чтение статистики. Один раз: включи YouTube Analytics API в Google Cloud, "
              "запусти tools/yt_token.py на ПК и положи новый токен в секрет YT_REFRESH_TOKEN.")


def seconds(iso):
    """PT1M5S -> 65."""
    m = re.fullmatch(r"PT(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    return int(m[1] or 0) * 60 + int(m[2] or 0) if m else 0


def fetch(posted, titles):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(None, refresh_token=os.environ["YT_REFRESH_TOKEN"], client_id=os.environ["YT_CLIENT_ID"],
                        client_secret=os.environ["YT_CLIENT_SECRET"], token_uri="https://oauth2.googleapis.com/token")
    creds.refresh(Request())
    ids = {v["video_id"]: k for k, v in posted.items() if isinstance(v, dict) and v.get("video_id")}
    yt = build("youtube", "v3", credentials=creds, cache_discovery=False)
    rows = {}
    for item in yt.videos().list(part="statistics,contentDetails", id=",".join(ids), maxResults=50).execute().get("items", []):
        st = item.get("statistics", {})
        rows[item["id"]] = {"id": ids[item["id"]], "title": titles.get(ids[item["id"]], ""), "len": seconds(item["contentDetails"].get("duration")),
                            "views": int(st.get("viewCount", 0)), "likes": int(st.get("likeCount", 0)), "comments": int(st.get("commentCount", 0))}
    # Analytics отстаёт на 2-3 дня: у свежих роликов досмотра ещё нет, тогда в отчёте прочерк
    ya = build("youtubeAnalytics", "v2", credentials=creds, cache_discovery=False)
    start = min(v["at"] for v in posted.values() if isinstance(v, dict) and v.get("at"))[:10]
    rep = ya.reports().query(ids="channel==MINE", startDate=start, endDate=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                             metrics=METRICS, dimensions="video", filters="video==" + ",".join(ids)).execute()
    cols = [h["name"] for h in rep.get("columnHeaders", [])]
    for r in rep.get("rows", []):
        d = dict(zip(cols, r))
        if d["video"] in rows:
            rows[d["video"]].update(avg_pct=round(float(d["averageViewPercentage"]), 1), avg_sec=int(d["averageViewDuration"]),
                                    shares=int(d["shares"]), subs=int(d["subscribersGained"]))
    return list(rows.values())


def report(rows, prev=None):
    """Сводка: лучшие по досмотру сверху, прирост просмотров к прошлому отчёту в скобках."""
    prev = {r["id"]: r for r in (prev or [])}
    rows = sorted(rows, key=lambda r: (r.get("avg_pct", -1), r["views"]), reverse=True)
    lines = [f"Shorts на YouTube: {len(rows)} шт., {sum(r['views'] for r in rows)} просмотров", ""]
    for r in rows:
        grow = r["views"] - prev[r["id"]]["views"] if r["id"] in prev else 0
        pct = f"досмотр {r['avg_pct']}%" if "avg_pct" in r else "досмотр ещё считается"
        line = f"{r['id']}: {r['views']} просм.{f' (+{grow})' if grow > 0 else ''}, {pct}, лайков {r['likes']}"
        lines.append(line + (f", подписок +{r['subs']}" if r.get("subs") else ""))
    rated = [r for r in rows if "avg_pct" in r]
    if len(rated) >= 2:
        best, worst = rated[0], rated[-1]
        lines += ["", f"Лучше всего досматривают «{best['id']}» ({best['avg_pct']}%), хуже всего «{worst['id']}» ({worst['avg_pct']}%).",
                  "Чем выше досмотр, тем дальше YouTube крутит ролик: формат и хук лидера стоит повторять."]
    return "\n".join(lines)


def send(text):
    import requests

    chat = os.environ.get("STATS_CHAT") or OWNER
    r = requests.post(f"https://api.telegram.org/bot{os.environ['BOT_TOKEN']}/sendMessage", json={"chat_id": chat, "text": text}, timeout=15)
    print("отправлено" if r.ok else f"Телеграм не принял: {r.text[:200]}")


def main():
    history = json.loads(STATS.read_text(encoding="utf-8")) if STATS.exists() else []
    prev = history[-1]["rows"] if history else None
    if "--dry" in sys.argv:
        print(report(prev or []))
        return
    if not all(os.environ.get(k) for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN")):
        print("Нет секретов YouTube, пропускаю.")
        return
    posted = json.loads(POSTED.read_text(encoding="utf-8"))
    titles = {p["id"]: p["title"] for p in json.loads(QUEUE.read_text(encoding="utf-8"))}
    try:
        rows = fetch(posted, titles)
    except Exception as e:
        # токен умер (приложение Google в Testing гасит его через 7 дней): Shorts не грузятся — говорим в личку раз в день
        if "invalid_grant" in str(e):
            print(DEAD_HINT)
            if os.environ.get("BOT_TOKEN"):
                send(DEAD_HINT)
            return
        # 403 insufficientPermissions / accessNotConfigured: старый токен только на загрузку или API не включён
        if "insufficient" in str(e).lower() or "accessNotConfigured" in str(e) or "403" in str(e):
            print(SCOPE_HINT, "\n", str(e)[:300])
            if os.environ.get("BOT_TOKEN"):
                send(SCOPE_HINT)
            return
        raise
    text = report(rows, prev)
    print(text)
    history.append({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rows": rows})
    STATS.write_text(json.dumps(history[-60:], ensure_ascii=False, indent=1), encoding="utf-8")
    if os.environ.get("BOT_TOKEN"):
        send(text)


if __name__ == "__main__":
    main()
