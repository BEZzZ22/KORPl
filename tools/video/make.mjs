// Видеоразбор катки: весь конвейер одной командой. Без нейросетей в рантайме: правила, шаблоны, синтез речи на CPU.
//   node tools/video/make.mjs --parsed parsed.jsonl [--match match.json] (--slot 0..9 | --account <id> | --hero <ключ>) --out video.mp4 [--work dir]
// Шаги: extract (данные реплея) → plan (моменты и текст под 60–90 с) → tts.py (озвучка) → timeline (раскадровка)
//       → render (кадры в Chromium) → audio.py (музыка и эффекты) → ffmpeg (сведение).
// В work остаются data.json, script.json, film.json — по ним видно, что и почему попало в ролик.
// Коды выхода: 0 — готово, 2 — плохой вход, 4 — в катке не нашлось моментов.
import { createReadStream, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "./extract.mjs";
import { plan, MAX_SECONDS } from "./plan.mjs";
import { buildTimeline } from "./timeline.mjs";
import { renderVideo } from "./render.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const log = (m) => process.stderr.write(`${m}\n`);

export function resolveSlot(data, { slot, account, hero }) {
  if (slot !== undefined && slot !== null && slot !== "") {
    const n = Number(slot);
    // player_slot OpenDota (128..132) тоже принимаем
    const s = n >= 128 ? n - 123 : n;
    return Number.isInteger(s) && s >= 0 && s <= 9 ? s : -1;
  }
  if (account) { const p = data.players.find((x) => String(x.account_id) === String(account)); return p ? p.slot : -1; }
  if (hero) { const p = data.players.find((x) => x.key === hero || String(x.hero_id) === String(hero)); return p ? p.slot : -1; }
  return -1;
}

export async function make(opts) {
  const work = resolve(opts.work || `${opts.out}.work`);
  mkdirSync(work, { recursive: true });
  let match = null;
  if (opts.match && existsSync(opts.match)) { try { match = JSON.parse(readFileSync(opts.match, "utf8")); } catch { match = null; } }
  const t0 = Date.now();
  const data = await extract(createInterface({ input: createReadStream(opts.parsed), crlfDelay: Infinity }), match);
  writeFileSync(join(work, "data.json"), JSON.stringify(data));
  const me = resolveSlot(data, opts);
  if (me < 0) { const e = new Error("игрок не найден в матче"); e.code = 2; throw e; }

  let p = plan(data, me), film = null, durations = null;
  if (!p.found.moments.length) { const e = new Error("в катке не нашлось моментов для разбора"); e.code = 4; throw e; }
  for (let attempt = 0; attempt < 2; attempt++) {
    writeFileSync(join(work, "script.json"), JSON.stringify(p.script, null, 1));
    durations = null;
    if (!opts.mute) {
      // тот же текст уже озвучен в этой рабочей папке — второй раз не синтезируем
      const says = JSON.stringify(p.script.segments.map((g) => g.lines.map((l) => l.say)));
      const voFile = join(work, "vo.json");
      let vo = null;
      if (existsSync(voFile)) { try { vo = JSON.parse(readFileSync(voFile, "utf8")); } catch { vo = null; } }
      if (!vo || vo.says !== says) {
        const r = spawnSync("python3", [join(HERE, "tts.py"), join(work, "script.json"), work], { stdio: ["ignore", "inherit", "inherit"] });
        vo = r.status === 0 ? { ...JSON.parse(readFileSync(voFile, "utf8")), says } : null;
        if (vo) writeFileSync(voFile, JSON.stringify(vo));
      }
      if (vo) durations = vo.durations; else log("озвучки нет: ролик будет с субтитрами и музыкой");
    }
    film = buildTimeline(data, p.found, p.script, durations);
    // диктор прочитал медленнее оценки и ролик вышел длиннее полутора минут: ужимаем план и озвучиваем заново
    if (film.duration <= MAX_SECONDS + 3 || attempt === 1) break;
    p = plan(data, me, { maxSeconds: Math.floor((MAX_SECONDS * p.seconds) / film.duration) - 1 });
  }
  writeFileSync(join(work, "film.json"), JSON.stringify(film));
  log(`план: ${film.moments} моментов, ${film.duration.toFixed(1)} с, ${film.frames} кадров (${((Date.now() - t0) / 1000).toFixed(0)} с на подготовку)`);
  if (opts.planOnly) return { film, work };

  const silent = join(work, "silent.mp4"), wav = join(work, "audio.wav");
  const r = await renderVideo(join(work, "film.json"), silent, { workers: opts.workers, log });
  log(`кадры: ${r.frames} за ${r.seconds.toFixed(0)} с`);
  const a = spawnSync("python3", [join(HERE, "audio.py"), join(work, "film.json"), work, wav], { stdio: ["ignore", "inherit", "inherit"] });
  const args = ["-y", "-loglevel", "error", "-i", silent];
  if (a.status === 0) args.push("-i", wav, "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest"); else log("звук не собрался: ролик без звука");
  args.push("-c:v", "copy", "-movflags", "+faststart", opts.out);
  const m = spawnSync("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
  if (m.status !== 0) throw new Error("ffmpeg не свёл ролик");
  log(`готово: ${opts.out}, ${(statSync(opts.out).size / 1e6).toFixed(1)} МБ, всего ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  return { film, work };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i].replace(/^--/, "");
    if (k === "mute" || k === "plan-only") opts[k === "plan-only" ? "planOnly" : k] = true; else opts[k] = args[++i];
  }
  if (opts.workers) opts.workers = Number(opts.workers);
  if (!opts.parsed || !opts.out) { log("нужны --parsed и --out"); process.exit(2); }
  try { await make(opts); } catch (e) { log(e.message); process.exit(e.code || 1); }
}
