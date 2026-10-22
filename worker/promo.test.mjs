import test from "node:test";
import assert from "node:assert/strict";
import { due } from "../tools/promo-post.mjs";

const q = [
  { id: "a", at: "2026-10-23T09:00:00Z", text: "A" },
  { id: "b", at: "2026-10-24T09:00:00Z", text: "B" },
  { id: "c", at: "2026-10-25T09:00:00Z", text: "C" },
  { id: "d", at: "2026-10-22T09:00:00Z", text: "D" },
];

test("promo: выходят только наступившие и ещё не вышедшие, по порядку времени", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  assert.deepEqual(due(q, { d: 1 }, now).map((p) => p.id), ["a", "b"]);
  assert.deepEqual(due(q, { a: 1, b: 2, d: 3 }, now), []);
});

test("promo: после долгого простоя не заливаем канал — не больше двух за раз", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  assert.deepEqual(due(q, {}, now).map((p) => p.id), ["d", "a"]);
});
