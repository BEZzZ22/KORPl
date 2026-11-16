// Сторож фона: пишет владельцу, когда выгрузка или очереди встали, и когда снова пошли
import { test } from "node:test";
import assert from "node:assert/strict";
import { problems, watchdog, LIMITS, ALERT_AGAIN } from "./watchdog.js";

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
  };
}
const T = Date.UTC(2026, 10, 17, 3, 0);
const MIN = 60_000;

test("норма — тишина, просрочка — проблема", () => {
  assert.deepEqual(problems({ relay: T - 5 * MIN, replays: { oldest: T - 20 * MIN, n: 3 }, video: null }, T), []);
  const p = problems({ relay: T - LIMITS.relay, replays: { oldest: T - LIMITS.replays - MIN, n: 2 }, video: { oldest: T - 2 * LIMITS.video, n: 1 } }, T);
  assert.deepEqual(p.map((x) => x.id), ["relay", "replays", "video"]);
  assert.match(p[1].text, /в очереди 2/);
  assert.match(problems({ relay: 0 }, T)[0].text, /больше суток/);
});

test("владельцу: раз при поломке, напоминание через 6 ч, «снова работает» после", async () => {
  const kv = fakeKV(), sent = [];
  const env = { COACH_KV: kv, OWNER_TG_IDS: "1, 2" };
  const tg = async (m, b) => { sent.push(b); return true; };
  const dead = { relay: T - 40 * MIN, replays: null, video: null };
  assert.deepEqual(await watchdog(env, tg, dead, T), ["relay"]);
  assert.equal(sent.length, 2); // обоим владельцам
  assert.deepEqual(await watchdog(env, tg, dead, T + 6 * MIN), []);
  assert.equal(sent.length, 2);
  assert.deepEqual(await watchdog(env, tg, dead, T + ALERT_AGAIN + MIN), ["relay"]);
  assert.match(sent.at(-1).text, /^Всё ещё/);
  assert.deepEqual(await watchdog(env, tg, { relay: T + ALERT_AGAIN + 2 * MIN }, T + ALERT_AGAIN + 3 * MIN), ["relay:ok"]);
  assert.match(sent.at(-1).text, /снова работает/);
  assert.equal(kv.m.size, 0);
});

test("без владельцев и базы — ничего не шлёт", async () => {
  assert.deepEqual(await watchdog({ COACH_KV: fakeKV() }, async () => true, { relay: 0 }, T), []);
  assert.deepEqual(await watchdog({ OWNER_TG_IDS: "1" }, async () => true, { relay: 0 }, T), []);
});
