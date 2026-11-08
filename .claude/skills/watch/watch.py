#!/usr/bin/env python3
"""Посмотреть ролик по ссылке: скачать, нарезать кадры, расшифровать речь.

Всё бесплатно и локально: yt-dlp (скачать + субтитры), ffmpeg (кадры),
faster-whisper (речь, если субтитров нет).

    python watch.py URL [--out DIR] [--every 2] [--scene 0.3] [--max-frames 60]
                        [--cookies cookies.txt] [--whisper base] [--lang ru]
                        [--no-audio]

Можно передать и путь к локальному файлу вместо ссылки.
В конце печатает путь к report.md: там список кадров с таймкодами и текст.
"""
import argparse, glob, json, os, re, shutil, subprocess, sys, tempfile

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")  # xet-хранилище HF часто режут прокси


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def need(tool, hint):
    if not shutil.which(tool):
        sys.exit(f"нет {tool}: {hint}")


def ts(sec):
    sec = int(sec)
    return f"{sec // 60}:{sec % 60:02d}"


def download(url, out, cookies):
    base = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-warnings",
            "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4",
            "-o", os.path.join(out, "video.%(ext)s"), "--write-info-json",
            "--write-subs", "--write-auto-subs", "--sub-langs", "ru.*,en.*,ru,en",
            "--sub-format", "vtt", "--convert-subs", "vtt"]
    if cookies:
        base += ["--cookies", cookies]
    r = run(base + [url])
    if r.returncode != 0:
        # субтитры иногда валят всё скачивание (429 на автосабах) — пробуем без них
        i = base.index("--write-subs")
        nosubs = base[:i] + base[i + 8:]  # без --write-subs ... vtt
        r2 = run(nosubs + [url])
        if r2.returncode != 0:
            err = (r.stderr or r2.stderr).strip().splitlines()[-3:]
            msg = "\n".join(err)
            if re.search(r"login|cookies|rate-limit|private|sign in|not available", msg, re.I):
                msg += ("\n\nПохоже, площадка требует вход. Выгрузи cookies из браузера "
                        "(расширение «Get cookies.txt LOCALLY») и запусти с --cookies cookies.txt")
            sys.exit("не скачалось:\n" + msg)
    vids = [f for f in glob.glob(os.path.join(out, "video.*"))
            if f.rsplit(".", 1)[-1] in ("mp4", "webm", "mkv", "mov")]
    if not vids:
        sys.exit("yt-dlp отработал, но видео не найдено")
    info = {}
    j = os.path.join(out, "video.info.json")
    if os.path.exists(j):
        with open(j, encoding="utf-8") as f:
            d = json.load(f)
        info = {k: d.get(k) for k in ("title", "uploader", "duration", "view_count",
                                      "like_count", "upload_date", "description", "webpage_url")}
    return vids[0], info


def duration(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", path])
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def frames(video, out, every, scene, max_frames, dur):
    fdir = os.path.join(out, "frames")
    os.makedirs(fdir, exist_ok=True)
    # если ролик длинный, растягиваем шаг, чтобы уложиться в лимит
    if dur and dur / every > max_frames * 0.7:
        every = dur / (max_frames * 0.7)
    vf = (f"select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,{every:.3f})"
          f"+gt(scene\\,{scene})',scale='min(720,iw)':-2,showinfo")
    r = run(["ffmpeg", "-v", "info", "-i", video, "-vf", vf, "-vsync", "vfr",
             "-q:v", "4", os.path.join(fdir, "f_%04d.jpg")])
    times = [float(m) for m in re.findall(r"pts_time:([\d.]+)", r.stderr)]
    files = sorted(glob.glob(os.path.join(fdir, "f_*.jpg")))
    pairs = list(zip(files, times + [0.0] * (len(files) - len(times))))
    # прореживаем равномерно, если сцен оказалось слишком много
    if len(pairs) > max_frames:
        keep = {round(i * (len(pairs) - 1) / (max_frames - 1)) for i in range(max_frames)}
        for i, (f, _) in enumerate(pairs):
            if i not in keep:
                os.remove(f)
        pairs = [p for i, p in enumerate(pairs) if i in keep]
    final = []
    for f, t in pairs:
        new = os.path.join(fdir, f"t{int(t // 60):02d}m{t % 60:05.2f}s.jpg")
        os.rename(f, new)
        final.append((new, t))
    return final, every


def vtt_text(path):
    lines, last = [], None
    cur = None
    with open(path, encoding="utf-8", errors="ignore") as f:
        for raw in f:
            raw = raw.strip()
            m = re.match(r"(\d+):(\d+):(\d+)[.,]\d+\s+-->", raw) or re.match(r"(\d+):(\d+)[.,]\d+\s+-->", raw)
            if m:
                g = [int(x) for x in m.groups()]
                cur = g[0] * 3600 + g[1] * 60 + g[2] if len(g) == 3 else g[0] * 60 + g[1]
                continue
            if not raw or raw.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")) or raw.isdigit():
                continue
            txt = re.sub(r"<[^>]+>", "", raw).strip()
            if txt and txt != last:
                lines.append(f"[{ts(cur or 0)}] {txt}")
                last = txt
    return "\n".join(lines)


def whisper(video, model, lang):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None, "faster-whisper не стоит: pip install faster-whisper"
    import numpy as np
    # звук достаём сами через ffmpeg: встроенный декодер (PyAV) часто ломается от версий
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-ac", "1", "-ar", "16000",
                          "-f", "f32le", "-"], capture_output=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32)
    if not audio.size:
        return None, "звук не прочитался"
    m = WhisperModel(model, device="cpu", compute_type="int8")
    segs, info = m.transcribe(audio, language=lang, vad_filter=True, beam_size=1)
    out = [f"[{ts(s.start)}] {s.text.strip()}" for s in segs]
    return "\n".join(out), f"whisper {model}, язык {info.language}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--out", default=None)
    p.add_argument("--every", type=float, default=2.0, help="кадр не реже, чем раз в N секунд")
    p.add_argument("--scene", type=float, default=0.3, help="порог смены сцены 0..1")
    p.add_argument("--max-frames", type=int, default=60)
    p.add_argument("--cookies", default=os.environ.get("WATCH_COOKIES"))
    p.add_argument("--whisper", default="base", help="tiny/base/small")
    p.add_argument("--lang", default=None, help="язык речи, например ru; пусто = сам")
    p.add_argument("--no-audio", action="store_true")
    a = p.parse_args()

    need("ffmpeg", "поставь ffmpeg (apt install ffmpeg / winget install ffmpeg)")
    out = a.out or os.path.join(tempfile.gettempdir(), "watch",
                                re.sub(r"\W+", "_", a.url)[-60:])
    os.makedirs(out, exist_ok=True)

    if os.path.exists(a.url):
        video, info = a.url, {"title": os.path.basename(a.url)}
        side = os.path.join(os.path.dirname(a.url), "video.info.json")
        if os.path.exists(side):
            with open(side, encoding="utf-8") as f:
                info = {k: v for k, v in json.load(f).items() if k in ("title", "uploader", "description", "webpage_url")}
    else:
        try:
            import yt_dlp  # noqa: F401
        except ImportError:
            sys.exit("нет yt-dlp: pip install -U yt-dlp")
        video, info = download(a.url, out, a.cookies)

    dur = duration(video)
    shots, step = frames(video, out, a.every, a.scene, a.max_frames, dur)

    text, src = "", "нет"
    if not a.no_audio:
        subs = sorted(glob.glob(os.path.join(out, "video*.vtt")),
                      key=lambda s: (".ru" not in s, "orig" not in s))
        if subs:
            text, src = vtt_text(subs[0]), "субтитры " + os.path.basename(subs[0])
        if not text.strip():
            has_audio = run(["ffprobe", "-v", "error", "-select_streams", "a",
                             "-show_entries", "stream=index", "-of", "csv=p=0", video]).stdout.strip()
            if has_audio:
                text, src = whisper(video, a.whisper, a.lang)
                text = text or ""
            else:
                src = "в ролике нет звука"

    rep = os.path.join(out, "report.md")
    with open(rep, "w", encoding="utf-8") as f:
        f.write(f"# {info.get('title') or 'ролик'}\n\n")
        for k in ("uploader", "upload_date", "view_count", "like_count", "webpage_url"):
            if info.get(k):
                f.write(f"- {k}: {info[k]}\n")
        f.write(f"- длительность: {ts(dur)} ({dur:.1f} с)\n")
        f.write(f"- кадров: {len(shots)} (шаг ~{step:.1f} с + смены сцен)\n")
        f.write(f"- речь: {src}\n\n")
        if info.get("description"):
            f.write("## Описание\n\n" + info["description"].strip()[:2000] + "\n\n")
        f.write("## Кадры\n\n")
        for path, t in shots:
            f.write(f"- {ts(t)} — {path}\n")
        f.write("\n## Речь\n\n" + (text.strip() or "(пусто)") + "\n")
    print(rep)


if __name__ == "__main__":
    main()
