import { test } from "node:test";
import assert from "node:assert/strict";
import { broadcastStep, BCAST_BATCH } from "./broadcast.js";

function kv() {
  const m = new Map();
  return { m, async get(k, t) { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; } };
}

test("рассылка: каждому один раз, без владельца и отписавшихся, частями", async () => {
  const store = kv(), env = { COACH_KV: store, OWNER_TG_IDS: "5" }, sent = [];
  for (let i = 10; i < 10 + BCAST_BATCH + 3; i++) await store.put(`seen:${i}`, "1");
  await store.put("seen:5", "1");
  await store.put("nodigest:11", "1");
  await store.put("bcast_job", JSON.stringify({ id: "party1", text: "Привет" }));
  const tg = async (m, b) => { sent.push(b.chat_id); return b.chat_id === 12 ? null : {}; };
  const a = await broadcastStep(env, tg);
  assert.equal(a.end, undefined);
  const b = await broadcastStep(env, tg);
  assert.ok(b.end);
  assert.equal(await store.get("bcast_job"), null);
  assert.ok(!sent.includes(5) && !sent.includes(11));
  assert.equal(new Set(sent).size, sent.length);
  assert.deepEqual([b.ok, b.fail, b.skip], [BCAST_BATCH + 3 - 2, 1, 1]);
  assert.equal(await broadcastStep(env, tg), null);
});
