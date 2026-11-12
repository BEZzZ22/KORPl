// Разовая рассылка всем, кто открывал бота или приложение (seen:<id>). Запускает workflow «Рассылка юзерам»:
// кладёт в D1 bcast_job {id, text}, крон раз в 3 минуты шлёт по BCAST_BATCH человек, каждому один раз (bcast:<job>:<id>).
// Владельцу не шлём, кто отписался (/nodigest) — тоже. Итог в bcast_stat:<job>: ok, fail, skip, end.
import { APP_URL } from "./growth.js";
import { addUrl } from "./party.js";

export const BCAST_BATCH = 15;
const TTL = 30 * 86400;
const owners = (env) => String(env.OWNER_TG_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
export const bcastButtons = { inline_keyboard: [[{ text: "Добавить бота в чат пати", url: addUrl }], [{ text: "Открыть приложение", web_app: { url: APP_URL } }]] };

// keyboards — клавиатуры для рассылок по имени: рассылка menu* ставит кнопки меню под полем ввода (menuKeyboard из coach.js)
// и помечает menu:<id>, чтобы приветствие их не повторяло
export async function broadcastStep(env, tg, now = Date.now(), keyboards = {}) {
  const kv = env.COACH_KV;
  const job = kv && await kv.get("bcast_job", "json").catch(() => null);
  if (!job || !/^[a-z0-9_-]{1,32}$/i.test(String(job.id || "")) || !String(job.text || "").trim()) return null;
  const statKey = `bcast_stat:${job.id}`;
  const stat = (await kv.get(statKey, "json").catch(() => null)) || { ok: 0, fail: 0, skip: 0, t: now };
  if (stat.end) { await kv.delete("bcast_job"); return stat; }
  const own = owners(env);
  let done = 0, left = false, cursor;
  for (let page = 0; page < 20 && !left; page++) {
    const got = await kv.list({ prefix: "seen:", cursor });
    for (const k of got.keys) {
      const id = k.name.slice(5);
      if (!/^\d{1,20}$/.test(id) || own.includes(id)) continue;
      const mark = `bcast:${job.id}:${id}`;
      if (await kv.get(mark)) continue;
      if (done >= BCAST_BATCH) { left = true; break; }
      done++;
      await kv.put(mark, "1", { expirationTtl: TTL });
      if (await kv.get(`nodigest:${id}`)) { stat.skip++; continue; }
      const menu = /^menu/i.test(job.id) && keyboards.menu;
      const res = await tg("sendMessage", { chat_id: Number(id), text: job.text, reply_markup: menu ? keyboards.menu.markup : bcastButtons, disable_web_page_preview: true }).catch(() => null);
      if (res) stat.ok++; else stat.fail++;
      if (res && menu) await kv.put(`menu:${id}`, keyboards.menu.version);
    }
    if (got.list_complete || !got.cursor) break;
    cursor = got.cursor;
  }
  if (!left) { stat.end = now; await kv.delete("bcast_job"); }
  await kv.put(statKey, JSON.stringify(stat), { expirationTtl: TTL });
  return stat;
}

// Ответ одному юзеру от бота (workflow «Ответ от бота»): reply_job {to, text} в D1, крон шлёт и пишет итог в reply_stat.
// Нужен, потому что токен бота живёт только в секретах воркера, а в Actions его нет
export async function replyStep(env, tg, now = Date.now()) {
  const kv = env.COACH_KV;
  const job = kv && await kv.get("reply_job", "json").catch(() => null);
  if (!job) return null;
  await kv.delete("reply_job");
  const to = String(job.to || ""), text = String(job.text || "").trim();
  const ok = /^\d{1,20}$/.test(to) && !!text && !!(await tg("sendMessage", { chat_id: Number(to), text: text.slice(0, 4000), disable_web_page_preview: true }).catch(() => null));
  await kv.put("reply_stat", JSON.stringify({ ok, t: now }), { expirationTtl: TTL });
  return { ok };
}
