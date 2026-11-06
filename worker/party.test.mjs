// Бот в пати-чатах: когда отвечать, текст карточки, лимит по чату
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { partyTrigger, partyText, handlePartyMessage, PARTY_GAP, fullUrl } from "./party.js";

const gz = (n) => JSON.parse(gunzipSync(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url))).toString("utf8"));
const match = gz("match_9052987576.json.gz");
const heroes = Object.fromEntries(Object.values(gz("constants.json.gz").heroes).map((h) => [h.id, [h.name, h.localized_name]]));

const kv = () => { const m = new Map(); return { m, async get(k, t) { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } }; };
const grp = (text, extra = {}) => ({ message_id: 7, chat: { id: -100, type: "supergroup" }, from: { id: 1 }, text, ...extra });

test("пати-чат: на что бот отвечает", () => {
  assert.deepEqual(partyTrigger(grp("9052987576")), { match: 9052987576 });
  assert.deepEqual(partyTrigger(grp("глянь https://www.dotabuff.com/matches/9052987576")), { match: 9052987576 });
  assert.deepEqual(partyTrigger(grp("/razbor 9052987576")), { match: 9052987576 });
  assert.deepEqual(partyTrigger(grp("/razbor@DotaRazbor_bot 905298757")), { match: 905298757 });
  assert.deepEqual(partyTrigger(grp("@DotaRazbor_bot 9052987576")), { match: 9052987576 });
  assert.deepEqual(partyTrigger(grp("/razbor")), { intro: true });
  assert.deepEqual(partyTrigger(grp("", { new_chat_members: [{ is_bot: true, username: "DotaRazbor_bot" }] })), { intro: true });
  assert.equal(partyTrigger(grp("го пати в 9")), null);
  assert.equal(partyTrigger(grp("123456789")), null);              // Friend ID и короткие числа без команды — не катка
  assert.equal(partyTrigger(grp("/razbor@other_bot 9052987576")), null);
  assert.equal(partyTrigger({ ...grp("9052987576"), chat: { id: 5, type: "private" } }), null);
});

test("пати-чат: карточка с победителем, MVP и кнопкой", () => {
  const t = partyText(match, heroes);
  assert.match(t, /^Катка 9052987576: победа (Света|Тьмы), \d+:\d\d/);
  assert.match(t, /Тащил: /);
  assert.match(t, /Слил: /);
  assert.ok(!/undefined|NaN|null/.test(t));
});

test("пати-чат: отвечает карточкой и не флудит чаще раза в 20 с", async () => {
  const env = { COACH_KV: kv() }, sent = [];
  const tg = async (m, b) => { sent.push([m, b]); return {}; };
  const fetcher = async (url) => ({ ok: true, status: 200, json: async () => (url.includes("constants") ? gz("constants.json.gz").heroes : match) });
  const r = await handlePartyMessage(env, tg, grp("9052987576"), 1_000_000, fetcher);
  assert.equal(r.party, "card");
  const msg = sent.find(([m]) => m === "sendMessage")[1];
  assert.equal(msg.reply_markup.inline_keyboard[0][0].url, fullUrl(9052987576));
  assert.equal((await handlePartyMessage(env, tg, grp("9052987576"), 1_000_000 + PARTY_GAP - 1, fetcher)).party, "gap");
  assert.equal((await handlePartyMessage(env, tg, grp("9052987576"), 1_000_000 + PARTY_GAP, fetcher)).party, "card");
});

test("пати-чат: OpenDota не знает катку — честно говорим", async () => {
  const env = { COACH_KV: kv() }, sent = [];
  const r = await handlePartyMessage(env, async (m, b) => { sent.push(b); }, grp("9052987576"), 0, async () => ({ ok: false, status: 404 }));
  assert.equal(r.party, "nomatch");
  assert.match(sent.at(-1).text, /OpenDota не знает/);
});
