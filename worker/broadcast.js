// Разовая рассылка всем, кто открывал бота или приложение (seen:<id>). Запускает workflow «Рассылка юзерам»:
// кладёт в D1 bcast_job {id, text}, крон раз в 3 минуты шлёт по BCAST_BATCH человек, каждому один раз (bcast:<job>:<id>).
// Владельцу не шлём, кто отписался (/nodigest) — тоже. Итог в bcast_stat:<job>: ok, fail, skip, end.
import { APP_URL } from "./growth.js";
import { addUrl } from "./party.js";

export const BCAST_BATCH = 15;
const TTL = 30 * 86400;
const owners = (env) => String(env.OWNER_TG_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
export const bcastButtons = { inline_keyboard: [[{ text: "Добавить бота в чат пати", url: addUrl }], [{ text: "Открыть приложение", web_app: { url: APP_URL } }]] };

export async function broadcastStep(env, tg, now = Date.now()) {
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
      const res = await tg("sendMessage", { chat_id: Number(id), text: job.text, reply_markup: bcastButtons, disable_web_page_preview: true }).catch(() => null);
      if (res) stat.ok++; else stat.fail++;
    }
    if (got.list_complete || !got.cursor) break;
    cursor = got.cursor;
  }
  if (!left) { stat.end = now; await kv.delete("bcast_job"); }
  await kv.put(statKey, JSON.stringify(stat), { expirationTtl: TTL });
  return stat;
}
