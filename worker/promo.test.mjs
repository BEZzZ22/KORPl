import test from "node:test";
import assert from "node:assert/strict";
import { due, channelHash, plain } from "../tools/promo-post.mjs";

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

test("promo: оформление канала применяется только после правки названия, описания или картинки", () => {
  const cfg = { title: "T", about: "A" };
  const base = channelHash(cfg, Buffer.from("img"));
  assert.equal(base, channelHash({ ...cfg }, Buffer.from("img")));
  assert.notEqual(base, channelHash({ ...cfg, about: "B" }, Buffer.from("img")));
  assert.notEqual(base, channelHash(cfg, Buffer.from("img2")));
});

test("promo: у бота {e:ключ} становится обычным символом, а теги разметки пропадают", () => {
  const emoji = { fire: { char: "🔥", id: 5 } };
  assert.equal(plain("{e:fire} <b>Тест</b> {e:нет}", emoji), "🔥 Тест {e:нет}");
});

import { ytDue } from "./kick.js";

test("пинок Shorts: только наступивший, не вышедший и не снятый ролик, и не раньше 5 ч после прошлого", () => {
  const queue = [
    { id: "old", at: "2026-10-28T15:00:00Z", retired: "снят" },
    { id: "a", at: "2026-10-30T15:33:00Z" },
    { id: "b", at: "2026-10-31T14:48:00Z" },
  ];
  const posted = { x: { at: "2026-10-29T20:19:00Z" } };
  assert.equal(ytDue(queue, posted, Date.parse("2026-10-30T15:00:00Z")), null);
  assert.equal(ytDue(queue, posted, Date.parse("2026-10-30T15:45:00Z")).id, "a");
  assert.equal(ytDue(queue, { ...posted, a: { at: "2026-10-30T15:46:00Z" } }, Date.parse("2026-10-30T18:00:00Z")), null);
});
