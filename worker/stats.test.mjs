import test from "node:test";
import assert from "node:assert/strict";
import { mergeAct, trackUser, buildReport, reportOnRequest } from "./coach.js";

// KV в памяти: get, getWithMetadata, put с metadata, list по префиксу
function memKV() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k).value : null),
    getWithMetadata: async (k) => (m.has(k) ? { value: m.get(k).value, metadata: m.get(k).metadata ?? null } : { value: null, metadata: null }),
    put: async (k, value, opts = {}) => { m.set(k, { value, metadata: opts.metadata }); },
    list: async ({ prefix }) => ({ keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({ name, metadata: v.metadata })), list_complete: true }),
  };
}

const at = (day, hh = 12) => Date.parse(`${day}T${String(hh).padStart(2, "0")}:00:00+03:00`);

test("mergeAct складывает и отсекает мусор", () => {
  let a = mergeAct(null, { open: true, secs: 90, events: { analysis: 2, "BAD key": 5, coach: -3 } });
  a = mergeAct(a, { secs: 1e9, events: { analysis: 1 } });
  assert.equal(a.o, 1);
  assert.equal(a.s, 90 + 3 * 3600);
  assert.deepEqual(a.e, { analysis: 3 });
});

test("путь, ошибка и платформа: мусор отсекается, путь режется с начала", () => {
  const a = mergeAct(null, { open: true, path: "home:0,link:40,BAD,home_empty:45", jserr: "x is undefined", ua: "android" });
  assert.equal(a.p, "home:0,link:40,home_empty:45");
  assert.equal(a.j, "x is undefined");
  assert.equal(a.pl, "android");
  const long = mergeAct(null, { path: Array.from({ length: 30 }, (_, i) => `hero_stats_long_name:${i}`).join(","), events: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`ev_${"x".repeat(i % 20)}${String.fromCharCode(97 + (i % 26))}`, 99])) });
  assert.ok(JSON.stringify(long).length <= 1000);
  assert.ok(long.p.endsWith(":29"));
});

test("отчёт показывает путь, где закрыли и где застряли", async () => {
  const kv = memKV(), env = { COACH_KV: kv };
  await trackUser(env, { id: 5, first_name: "MuMu", username: "mumu" }, { open: true, secs: 240, events: { home: 1, link: 1, home_empty: 1 }, path: "home:0,link:40,home_empty:45", ua: "ios" }, at("2026-10-25"));
  const text = await buildReport(env, at("2026-10-26", 9));
  assert.match(text, /— MuMu @mumu \(ios\): 1 откр\., 4 мин, привязали аккаунт 1/);
  assert.match(text, /путь: главная 0 с → привязал аккаунт 40 с → «матчей не видно» 45 с/);
  assert.match(text, /Где закрыли приложение: «матчей не видно» 1/);
  assert.match(text, /Застряли: видели «матчей не видно» \(закрыт профиль в Доте\) — 1/);
});

test("Script error — не ошибка в коде, неверный ID расшифрован", async () => {
  const kv = memKV(), env = { COACH_KV: kv };
  await trackUser(env, { id: 6, first_name: "Asnar" }, { open: true, secs: 60, events: { link_bad: 1, link_bad_text: 1, err_ext: 1 }, path: "home:0,link_bad:54", jserr: "Script error." }, at("2026-10-25"));
  const text = await buildReport(env, at("2026-10-26", 9));
  assert.match(text, /неверный ID: ввёл ник/);
  assert.match(text, /ошибка в чужом скрипте \(Телеграм\), приложению не мешала/);
  assert.match(text, /Ошибки: в чужом скрипте \(Телеграм, не мешает\) 1/);
  assert.doesNotMatch(text, /ошибка в коде/);
});

test("первый заход пишется один раз, дни — отдельно", async () => {
  const kv = memKV(), env = { COACH_KV: kv };
  await trackUser(env, { id: 1, first_name: "Вася", username: "vasya" }, { open: true, src: "promo" }, at("2026-10-23"));
  await trackUser(env, { id: 1, first_name: "Другое" }, { open: true }, at("2026-10-24"));
  assert.equal(kv.m.get("seen:1").metadata.n, "Вася");
  assert.equal(kv.m.get("seen:1").metadata.src, "promo");
  assert.ok(kv.m.has("act:2026-10-23:1") && kv.m.has("act:2026-10-24:1"));
});

test("отчёт: приток, вернувшиеся, удержание, владелец не считается", async () => {
  const kv = memKV(), env = { COACH_KV: kv, OWNER_TG_IDS: "99" };
  const u = (id) => ({ id, first_name: `Игрок${id}` });
  await trackUser(env, u(1), { open: true, secs: 120, events: { analysis: 2 } }, at("2026-10-23"));
  await trackUser(env, u(2), { open: true }, at("2026-10-23"));
  await trackUser(env, u(1), { open: true, secs: 60, events: { coach: 1 } }, at("2026-10-24"));
  await trackUser(env, u(3), { open: true, secs: 300, events: { analysis: 1, chat: 2 } }, at("2026-10-24"));
  await trackUser(env, u(99), { open: true }, at("2026-10-24"));
  await kv.put("user:1", "{}");
  const text = await buildReport(env, at("2026-10-25", 9));
  assert.match(text, /Отчёт за 24\.10/);
  assert.match(text, /Всего юзеров: 3, новых за день: 1/);
  assert.match(text, /23\.10 2 · 24\.10 1/);
  assert.match(text, /Активных за день: 2 \(новых 1, вернулись 1\)/);
  assert.match(text, /23\.10: 2 → на след\. день 1, за неделю 1/);
  assert.match(text, /— Игрок3: 1 откр\., 5 мин, вопросов тренеру 2, разборов 1/);
  assert.match(text, /Профилей с привязанным аккаунтом: 1/);
  assert.doesNotMatch(text, /Игрок99/);
  assert.match(text, /Вернулись:\n— Игрок1: 1 откр\., 1 мин, с тренером 1/);
});

test("отчёт называет старые профили по getChat", async () => {
  const kv = memKV(), env = { COACH_KV: kv, BOT_TOKEN: "x" };
  await kv.put("user:7", "{}");
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: { first_name: "Петя", username: "petya" } }) });
  try {
    assert.match(await buildReport(env, at("2026-10-25", 9)), /Привязали раньше, с тех пор не заходили: Петя @petya/);
  } finally { globalThis.fetch = real; }
});

test("заявка report_now отправляет отчёт один раз", async () => {
  const kv = memKV(), sent = [];
  kv.delete = async (k) => { kv.m.delete(k); };
  const env = { COACH_KV: kv, BOT_TOKEN: "x", OWNER_TG_IDS: "5" };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, text: async () => "{}" }; };
  try {
    await kv.put("report_now", "2026-10-24");
    assert.equal((await reportOnRequest(env, at("2026-10-25"))).sent, 1);
    assert.equal(JSON.parse(kv.m.get("report_last").value).sent, 1);
    assert.equal(await reportOnRequest(env, at("2026-10-25")), null);
  } finally { globalThis.fetch = real; }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, "5");
  assert.match(sent[0].text, /Отчёт за 24\.10/);
});

test("«не согласен»: сохраняется и попадает в отчёт за день", async () => {
  const { saveFeedback } = await import("./coach.js");
  const kv = memKV(), env = { COACH_KV: kv };
  await trackUser(env, { id: 7, first_name: "Аксель" }, { open: true, events: { blame: 1, disagree_blame: 1 } }, at("2026-10-25"));
  await saveFeedback(env, { id: 7, first_name: "Аксель", username: "axel" }, { match_id: 9052987576, kind: "blame", text: "Слил, похоже, Beastmaster" }, at("2026-10-25"));
  const text = await buildReport(env, at("2026-10-26", 9));
  assert.match(text, /Не согласны с выводом: 1\n— Аксель @axel, матч 9052987576: «Слил, похоже, Beastmaster»/);
  assert.match(text, /не согласны с «кто слил» 1/);
});

import worker, { dailyReport, reportCommandDay, handleBotUpdate } from "./coach.js";

test("утренний отчёт — за вчера и один раз на день", async () => {
  const kv = memKV(), sent = [];
  const env = { COACH_KV: kv, BOT_TOKEN: "x", OWNER_TG_IDS: "5" };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, text: async () => "{}" }; };
  try {
    await dailyReport(env, at("2026-10-27", 9));
    assert.equal(await dailyReport(env, at("2026-10-27", 9)), null);
    await dailyReport(env, at("2026-10-28", 9));
  } finally { globalThis.fetch = real; }
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /^Отчёт за 26\.10 /);
  assert.match(sent[1].text, /^Отчёт за 27\.10 /);
});

test("команда «отчёт»: сегодня, вчера, дата; остальное — не команда", () => {
  const now = at("2026-10-28", 7);
  assert.equal(reportCommandDay("отчёт", now), "2026-10-28");
  assert.equal(reportCommandDay("Отчет", now), "2026-10-28");
  assert.equal(reportCommandDay("/report@DotaRazbor_bot", now), "2026-10-28");
  assert.equal(reportCommandDay("отчёт вчера", now), "2026-10-27");
  assert.equal(reportCommandDay("отчёт 26.10", now), "2026-10-26");
  assert.equal(reportCommandDay("отчёт 40.13", now), "2026-10-28");
  assert.equal(reportCommandDay("отчётность", now), null);
  assert.equal(reportCommandDay("привет", now), null);
});

test("«отчёт» в личке работает только у владельца, отчёт за сегодня", async () => {
  const kv = memKV(), sent = [];
  const env = { COACH_KV: kv, BOT_TOKEN: "x", OWNER_TG_IDS: "5" };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, text: async () => "{}" }; };
  const msg = (id, text, type = "private") => ({ message: { from: { id }, chat: { id, type }, text } });
  try {
    assert.equal(await handleBotUpdate(env, msg(5, "отчёт", "supergroup"), at("2026-10-28", 7)), null);
    assert.equal((await handleBotUpdate(env, msg(5, "отчёт"), at("2026-10-28", 7))).sent, 1);
  } finally { globalThis.fetch = real; }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, 5);
  assert.match(sent[0].text, /^Отчёт за 28\.10, сегодня на 07:00 МСК/);
});

test("новичку на /start — приветствие с кнопкой, на прочее — подсказка раз в час", async () => {
  const kv = memKV(), sent = [];
  const env = { COACH_KV: kv, BOT_TOKEN: "x", OWNER_TG_IDS: "5" };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, text: async () => "{}" }; };
  const msg = (id, text, type = "private") => ({ message: { from: { id }, chat: { id, type }, text } });
  try {
    assert.equal((await handleBotUpdate(env, msg(7, "/start"))).greeted, 1);
    assert.equal((await handleBotUpdate(env, msg(7, "/start ref_tt"))).greeted, 1);
    assert.equal((await handleBotUpdate(env, msg(7, "отчёт"))).greeted, 1);
    assert.deepEqual(await handleBotUpdate(env, msg(7, "1111111")), { forwarded: 1 });
    assert.equal(await handleBotUpdate(env, msg(7, "/start", "group")), null);
  } finally { globalThis.fetch = real; }
  // письма человека ушли владельцу (id 5) с его id, подсказка — человеку
  const toOwner = sent.filter((m) => m.chat_id === 5);
  assert.equal(toOwner.length, 2);
  assert.match(toOwner[1].text, /\(id 7\):\n\n1111111/);
  const toUser = sent.filter((m) => m.chat_id === 7);
  assert.equal(toUser.length, 3);
  assert.ok(toUser.every((m) => m.reply_markup.inline_keyboard[0][0].web_app.url));
  assert.match(toUser[0].text, /^Привет!/);
  assert.match(toUser[2].text, /передам разработчику/);
  // владелец отвечает реплаем — уходит человеку
  sent.length = 0;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, text: async () => "{}" }; };
  try {
    const reply = { message: { from: { id: 5 }, chat: { id: 5, type: "private" }, text: "Звёзды вернул", reply_to_message: { text: toOwner[1].text } } };
    assert.equal((await handleBotUpdate(env, reply)).answered, 1);
  } finally { globalThis.fetch = real; }
  assert.deepEqual(sent.map((m) => [m.chat_id, m.text]), [[7, "Звёзды вернул"], [5, "Отправил."]]);
  assert.ok(!sent.some((m) => /^Отчёт/.test(m.text)));
});

test("вебхук без секрета не пускает", async () => {
  const res = await worker.fetch(new Request("https://coach.example/tg", { method: "POST", body: "{}" }), { BOT_TOKEN: "x" }, { waitUntil() {} });
  assert.equal(res.status, 403);
});

test("вебхук: оплата не зачислилась (база упала) — 500, Телеграм пришлёт ещё раз", async () => {
  const token = "1:x";
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tg-hook:${token}`)));
  const secret = [...hash.slice(0, 20)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const paid = { message: { chat: { id: 8, type: "private" }, from: { id: 8 }, successful_payment: { currency: "XTR", total_amount: 49, invoice_payload: "p10:8", telegram_payment_charge_id: "c1" } } };
  const broken = { get: async () => { throw new Error("db down"); }, put: async () => { throw new Error("db down"); } };
  const send = (kv) => worker.fetch(new Request("https://coach.example/tg", { method: "POST", body: JSON.stringify(paid), headers: { "X-Telegram-Bot-Api-Secret-Token": secret } }),
    { BOT_TOKEN: token, COACH_KV: kv }, { waitUntil() {} });
  const log = console.log;
  console.log = () => {};
  try { assert.equal((await send(broken)).status, 500); } finally { console.log = log; }
  const store = new Map();
  const ok = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}");
  try { assert.equal((await send(ok)).status, 200); } finally { globalThis.fetch = real; }
  assert.equal(JSON.parse(store.get("wallet:8")).c, 10);
});
