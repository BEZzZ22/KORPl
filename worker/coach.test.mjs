import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, normalize, problemsOf } from "./coach.js";

const raw = {
  hero: "Phantom Assassin", role: "керри", rank: "Рекрут", won: false, kda: "2/11/3", duration: 2100,
  problems: [{ title: "Мало фарма", fact: "62 крипа к 20:00" }, { title: "Много смертей", fact: "11 смертей, 6 из них одиночные" }],
  micro: ["Смерть без прожатых кнопок"],
  plan: [{ item: "Black King Bar", why: "враги ставят много оглушений" }],
  draft: [],
};
const prompt = buildPrompt(raw);

const good = `Главное: у тебя было 62 крипа к 20:00, поэтому золота на сборку не хватило.

План на следующую игру:
— Добивай крипов на линии, пока не уйдёшь в лес.
— Перед дракой нажимай кнопки, а не умирай с полными.
— Собери Black King Bar: враги ставят много оглушений.`;

test("хороший ответ проходит", () => assert.deepEqual(problemsOf(normalize(good), prompt), []));

test("старый плохой ответ отклоняется", () => {
  const bad = normalize(`Главное: самая тяжёлая проблема — 62 ... к 20:00.\n\nПлан на следующую игру:\n— До 10:00 купи BKB.\n— Фарми 70 крипов.\n— Ставь варды.`);
  const reasons = problemsOf(bad, prompt).join(" | ");
  assert.match(reasons, /многоточия/);
  assert.match(reasons, /латиница/);
  assert.match(reasons, /числа не из сводки/);
});

test("normalize чинит тире и пробелы", () => {
  const t = normalize("Главное:  х 62\nПлан на следующую игру:\n- а\n– б\n• в");
  assert.equal(t.split("\n").filter((l) => l.startsWith("— ")).length, 3);
});

test("латинские двойники в русских словах чинятся", () => {
  const t = normalize(good.replace("крипа", "крипa"));
  assert.ok(!/[a-z][а-я]|[а-я][a-z]/i.test(t));
  assert.deepEqual(problemsOf(t, prompt), []);
});
