// Видеоразбор: дежурный для GitHub Actions (.github/workflows/video.yml). Берёт заявки у воркера (GET /video-queue),
// на каждую: реплей → ролик (make.mjs) → sendVideo человеку → отметка воркеру (POST /video-queue).
// Проверочный прогон: TEST_MATCH и TEST_SLOT (1–10) — ролик остаётся в out/, никому не уходит.
// В логах только номера матчей: репозиторий публичный, Telegram id и ники сюда не пишем.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { make } from "./make.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = process.env.WORKER_URL || "https://dotacoach.2007rggg.workers.dev";
const KEY = process.env.RELAY_KEY || (process.env.CLOUDFLARE_API_TOKEN ? createHash("sha256").update(`dotarazbor-relay:${process.env.CLOUDFLARE_API_TOKEN}`).digest("hex") : "");
const BOT = process.env.BOT_TOKEN || "";
const OUT = process.env.VIDEO_OUT || "out";
const log = (m) => console.log(m);

async function api(method, body) {
  const res = await fetch(`${WORKER}/video-queue`, { method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`воркер ответил ${res.status}`);
  return res.json();
}
export const caption = (film, match) => {
  const me = film.players[film.me];
  return `Видеоразбор матча ${match}: ${me.ru}, ${film.match.k}/${film.match.d}/${film.match.a}. ${film.moments} ${film.moments === 1 ? "момент" : film.moments < 5 ? "момента" : "моментов"}, на которых решилась катка.\n\nПолный разбор по минутам и тренер — по кнопке.`;
};
async function sendVideo(chat, file, film, match) {
  const form = new FormData();
  form.set("chat_id", String(chat));
  form.set("video", new Blob([readFileSync(file)], { type: "video/mp4" }), `razbor-${match}.mp4`);
  form.set("caption", caption(film, match));
  form.set("width", String(film.W)); form.set("height", String(film.H)); form.set("duration", String(Math.round(film.duration)));
  form.set("supports_streaming", "true");
  form.set("reply_markup", JSON.stringify({ inline_keyboard: [[{ text: "Открыть разбор катки", url: `https://t.me/DotaRazbor_bot?startapp=m${match}` }]] }));
  // токена бота в секретах Actions может не быть (он живёт в воркере): тогда ролик уходит через воркер, тем же ключом, что очередь
  const res = BOT && chat !== "owner"
    ? await fetch(`https://api.telegram.org/bot${BOT}/sendVideo`, { method: "POST", body: form, signal: AbortSignal.timeout(180000) })
    : await fetch(`${WORKER}/video-send${chat === "owner" ? "?owner=1" : ""}`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form, signal: AbortSignal.timeout(180000) });
  if (!res.ok) log(`отправка: ответ ${res.status}`);
  return res.ok;
}

// Одна заявка: возвращает { ok } или { ok: false, why }
export async function runJob(job, { send = true } = {}) {
  const dir = join(OUT, String(job.match));
  mkdirSync(dir, { recursive: true });
  const r = spawnSync("bash", [join(HERE, "fetch-replay.sh"), String(job.match), dir], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) return { ok: false, why: r.status === 3 ? "no_replay" : "parse" };
  const file = join(dir, `razbor-${job.match}.mp4`);
  let film;
  try {
    ({ film } = await make({ parsed: join(dir, "parsed.jsonl"), match: join(dir, "match.json"), out: file, work: join(dir, "work"),
      slot: Number.isInteger(job.slot) ? job.slot : undefined, account: job.account || undefined }));
  } catch (e) {
    log(`матч ${job.match}: ${e.message}`);
    return { ok: false, why: e.code === 2 ? "not_in_match" : e.code === 4 ? "no_moments" : "failed" };
  } finally { rmSync(join(dir, "parsed.jsonl"), { force: true }); }
  if (send && !(await sendVideo(job.user, file, film, job.match).catch(() => false))) return { ok: false, why: "send" };
  return { ok: true, file };
}

async function main() {
  if (process.env.TEST_MATCH) {
    const slot = Number(process.env.TEST_SLOT || 1) - 1;
    // «владельцу»: ролик уходит через воркер тому, кто записан владельцем бота, — проверка доставки целиком
    const toOwner = process.env.TEST_TO_OWNER === "да";
    const r = await runJob({ match: Number(process.env.TEST_MATCH), slot, user: "owner" }, { send: toOwner });
    log(r.ok ? "проверочный ролик готов" : `не вышло: ${r.why}`);
    process.exit(r.ok ? 0 : 1);
  }
  if (!KEY) { log("нет ключа воркера"); process.exit(1); }
  const tried = new Set();
  // после последней заявки ещё пару минут слушаем очередь: вторая просьба не ждёт нового запуска
  let idleUntil = Date.now() + 2 * 60 * 1000;
  while (Date.now() < idleUntil) {
    const { jobs = [] } = await api("GET").catch((e) => { log(`очередь: ${e.message}`); return {}; });
    const job = jobs.find((j) => !tried.has(`${j.match}:${j.user}`));
    if (!job) { await new Promise((ok) => setTimeout(ok, 20000)); continue; }
    tried.add(`${job.match}:${job.user}`);
    // id в логах Actions прячем: репозиторий публичный
    console.log(`::add-mask::${job.user}`);
    if (job.account) console.log(`::add-mask::${job.account}`);
    log(`::group::Матч ${job.match}`);
    const r = await runJob(job).catch((e) => { log(`сбой: ${e.message}`); return { ok: false, why: "failed" }; });
    log(r.ok ? "ролик отправлен" : `не вышло: ${r.why}`);
    log("::endgroup::");
    await api("POST", { match: job.match, user: job.user, status: r.ok ? "done" : "error", why: r.why }).catch((e) => log(`отметка: ${e.message}`));
    if (r.ok && existsSync(r.file)) rmSync(join(OUT, String(job.match)), { recursive: true, force: true });
    idleUntil = Date.now() + 2 * 60 * 1000;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
