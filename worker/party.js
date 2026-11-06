// Бот в пати-чатах: кинули ID катки (или /razbor <id>) — бот отвечает итогом «Кто слил, кто тащил» на всю пачку
// и кнопкой полного разбора. Каждая такая карточка — живая реклама бота друзьям игрока.
// Вердикты — те же, что в приложении (docs/blame.js), по данным OpenDota без реплея.
import { matchVerdicts } from "../docs/blame.js";
import { matchFromText, OD_HEADERS } from "./growth.js";

const BOT = "DotaRazbor_bot";
const OD = "https://api.opendota.com/api";
export const PARTY_GAP = 20_000;          // в одном чате не чаще раза в 20 секунд: защита от флуда
const HEROES_KEY = "party_heroes", HEROES_TTL = 7 * 86400;

export const fullUrl = (id) => `https://t.me/${BOT}?startapp=m${id}`;
export const addUrl = `https://t.me/${BOT}?startgroup=party`;
const buttons = (id) => ({ inline_keyboard: [[{ text: "Полный разбор", url: fullUrl(id) }], [{ text: "Добавить бота в свой чат", url: addUrl }]] });

export const INTRO_TEXT = "Привет! Я разбираю катки Dota 2.\n"
  + "Киньте сюда ID матча или ссылку с OpenDota/Dotabuff/Stratz (или /razbor <ID>) — скажу, кто тащил, кто слил и почему.\n"
  + "Если в группе я не вижу обычные сообщения, пишите командой /razbor <ID>.";

const isGroup = (msg) => msg && msg.chat && (msg.chat.type === "group" || msg.chat.type === "supergroup");

// Что в сообщении: { intro } — бота добавили или позвали без ID, { match } — катка, null — не нам
export function partyTrigger(msg, botName = BOT) {
  if (!isGroup(msg)) return null;
  if ((msg.new_chat_members || []).some((u) => u && u.is_bot && String(u.username || "").toLowerCase() === botName.toLowerCase())) return { intro: true };
  const text = String(msg.text || "").trim();
  if (!text) return null;
  const at = new RegExp(`@${botName}\\b`, "i");
  const cmd = new RegExp(`^/(?:razbor|blame|start|help)(?:@${botName})?(?:\\s+|$)`, "i");
  const isCmd = cmd.test(text), mention = at.test(text);
  // чужие команды (/razbor@другой_бот) — не нам
  if (/^\/\w+@\w+/.test(text) && !new RegExp(`^/\\w+@${botName}\\b`, "i").test(text)) return null;
  const rest = text.replace(cmd, "").replace(at, "").trim();
  const id = matchFromText(rest) || ((isCmd || mention) && /^\d{7,11}$/.test(rest) ? Number(rest) : null);
  if (id) return { match: id };
  return isCmd || mention ? { intro: true } : null;
}

const plusMinus = (r) => [r.plus, r.minus && `минус: ${r.minus}`].filter(Boolean).join("; ");
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, "0")}`;

// Текст карточки. heroes: { id: [ключ npc_dota_hero_…, имя] }
export function partyText(match, heroes) {
  const heroName = (id) => (heroes[id] && heroes[id][1]) || `герой #${id}`;
  const heroKey = (id) => (heroes[id] && heroes[id][0]) || "";
  const v = matchVerdicts(match, null, { heroName, heroKey });
  const who = (r) => `${r.name}${r.p.personaname ? ` (${String(r.p.personaname).slice(0, 24)})` : ""}, ${r.kda}`;
  const lines = [`Катка ${match.match_id}: победа ${v.radiantWin ? "Света" : "Тьмы"}, ${mmss(match.duration)}`, ""];
  lines.push(`Тащил: ${who(v.mvp)} — ${plusMinus(v.mvp) || `вклад ${v.mvp.impact}`}`);
  if (v.anchor) lines.push(`Слил: ${who(v.anchor)} — ${plusMinus(v.anchor) || `вклад ${v.anchor.impact}`}`);
  else lines.push("Слил: явного нет, вина на всех проигравших поровну");
  const carry = v.rows.find((r) => r.tag === "carry");
  if (carry) lines.push(`Тащил, но не вытащил: ${who(carry)}`);
  const pass = v.rows.find((r) => r.tag === "passenger");
  if (pass) lines.push(`Выиграл на плечах команды: ${who(pass)}`);
  const aw = v.awards.slice(0, 3).map((a) => `${a.title} — ${a.row.name}, ${a.text}`);
  if (aw.length) lines.push("", ...aw);
  lines.push("", "Ошибки по таймкодам и разбор каждого — по кнопке.");
  return lines.join("\n");
}

// Справочник героев из OpenDota, в KV на неделю в сжатом виде
export async function partyHeroes(env, fetcher = fetch) {
  const kv = env.COACH_KV;
  const cached = await kv.get(HEROES_KEY, "json").catch(() => null);
  if (cached) return cached;
  const res = await fetcher(`${OD}/constants/heroes`, { headers: OD_HEADERS, signal: AbortSignal.timeout(10000) }).catch(() => null);
  const raw = res && res.ok ? await res.json().catch(() => null) : null;
  if (!raw) return {};
  const out = {};
  for (const h of Object.values(raw)) if (h && h.id) out[h.id] = [h.name, h.localized_name];
  await kv.put(HEROES_KEY, JSON.stringify(out), { expirationTtl: HEROES_TTL }).catch(() => {});
  return out;
}

export async function handlePartyMessage(env, tg, msg, now = Date.now(), fetcher = fetch) {
  const t = partyTrigger(msg);
  if (!t) return null;
  const chat = msg.chat.id, reply = { message_id: msg.message_id, allow_sending_without_reply: true };
  if (t.intro) {
    await tg("sendMessage", { chat_id: chat, text: INTRO_TEXT, reply_markup: { inline_keyboard: [[{ text: "Открыть бота", url: `https://t.me/${BOT}?start=party` }]] } });
    return { party: "intro" };
  }
  const gapKey = `partygap:${chat}`;
  const last = Number(await env.COACH_KV.get(gapKey).catch(() => 0)) || 0;
  if (last && now - last < PARTY_GAP) return { party: "gap" };
  await env.COACH_KV.put(gapKey, String(now), { expirationTtl: 3600 });
  await tg("sendChatAction", { chat_id: chat, action: "typing" });
  const res = await fetcher(`${OD}/matches/${t.match}${env.OPENDOTA_KEY ? `?api_key=${encodeURIComponent(env.OPENDOTA_KEY)}` : ""}`,
    { headers: OD_HEADERS, signal: AbortSignal.timeout(15000) }).catch(() => null);
  const match = res && res.ok ? await res.json().catch(() => null) : null;
  if (!match || !match.duration || !Array.isArray(match.players) || match.players.length !== 10) {
    const text = res && res.status === 404
      ? `Катку ${t.match} OpenDota не знает. Если она только что закончилась — кинь ещё раз через пару минут.`
      : `OpenDota пока не отдала катку ${t.match}. Попробуй через пару минут или открой разбор по кнопке.`;
    await tg("sendMessage", { chat_id: chat, text, reply_parameters: reply, reply_markup: buttons(t.match) });
    return { party: "nomatch", match: t.match };
  }
  const heroes = await partyHeroes(env, fetcher);
  await tg("sendMessage", { chat_id: chat, text: partyText(match, heroes), reply_parameters: reply, reply_markup: buttons(t.match), disable_web_page_preview: true });
  await env.COACH_KV.put(`party:${new Date(now + 3 * 3600_000).toISOString().slice(0, 10)}:${chat}:${t.match}`, "1", { expirationTtl: 30 * 86400 }).catch(() => {});
  return { party: "card", match: t.match };
}
