// Телеграм на айфоне открывает приложение системным Safari. Синтаксис, которого нет в старых версиях, ломает разбор
// всего модуля: приложение не открывается вовсе. Lookbehind в регулярках появился только в iOS 16.4
// (iPhone 7 и старше на iOS 15 остаются без него), поэтому в docs/ его быть не должно.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DOCS = new URL("../docs/", import.meta.url);
const files = readdirSync(DOCS).filter((n) => n.endsWith(".js") && n !== "sw.js");

test("в коде приложения нет синтаксиса новее iOS 15", () => {
  const rules = [
    [/\(\?<[=!]/, "lookbehind в регулярке (iOS 16.4+)"],
    [/\bstatic\s*\{/, "статический блок класса (iOS 16.4+)"],
    [/\.(?:toSorted|toReversed|toSpliced|findLast|findLastIndex)\(/, "новые методы массивов (iOS 15.4–16+)"],
    [/\bstructuredClone\(|\bObject\.hasOwn\(|\.at\(-/, "structuredClone / Object.hasOwn / .at() (iOS 15.4+)"],
  ];
  for (const name of files) {
    const text = readFileSync(new URL(name, DOCS), "utf8");
    for (const [re, what] of rules) {
      const m = re.exec(text);
      if (m) assert.fail(`${name}:${text.slice(0, m.index).split("\n").length}: ${what}`);
    }
  }
});
