// Файлы приложения с версией в адресе (app.js?v=82) service worker отдаёт из кэша сразу, а свежие качает в фоне.
// Поменял файл и не поднял ?v= — у людей ещё запуск работает старый файл, а новый app.js со старым engine.js
// может не найти нужный экспорт и показать белый экран. Тест сверяет содержимое с прошлым снимком.
// Поднял версию — обнови снимок: node tests/versions.test.mjs --update
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const DOCS = new URL("../docs/", import.meta.url);
const SNAP = new URL("./fixtures/versions.json", import.meta.url);
// данные, которые раз в неделю обновляет workflow «Сборки героев» без смены версии: старый файл на один запуск не страшен
const SKIP = new Set(["builds.json", "khan_builds.json"]);

function current() {
  const refs = new Map(); // файл -> Set версий
  for (const name of ["index.html", ...readdirSync(DOCS).filter((n) => n.endsWith(".js"))]) {
    const text = readFileSync(new URL(name, DOCS), "utf8");
    for (const m of text.matchAll(/(?:\.\/|["'\s=])([a-z0-9_]+\.(?:js|css|json))\?v=([0-9.]+)/g)) {
      if (SKIP.has(m[1])) continue;
      if (!refs.has(m[1])) refs.set(m[1], new Set());
      refs.get(m[1]).add(m[2]);
    }
  }
  const out = {};
  for (const [file, versions] of [...refs].sort()) {
    let sha = null;
    try { sha = createHash("sha256").update(readFileSync(new URL(file, DOCS))).digest("hex").slice(0, 16); } catch { /* vendor/ и пр. */ }
    out[file] = { v: [...versions].sort().join(","), sha };
  }
  return out;
}

if (process.argv.includes("--update")) {
  // снимок не примет файл, который изменился без новой версии (например, модуль, где поменялась версия импорта)
  let snap = {};
  try { snap = JSON.parse(readFileSync(SNAP, "utf8")); } catch { /* первый снимок */ }
  const now = current();
  const same = Object.keys(now).filter((f) => snap[f] && now[f].sha && now[f].sha !== snap[f].sha && now[f].v === snap[f].v);
  if (same.length) { console.error(`изменились без новой ?v=: ${same.join(", ")} — сначала подними версии`); process.exit(1); }
  writeFileSync(SNAP, JSON.stringify(now, null, 1) + "\n");
  console.log("снимок версий обновлён");
} else {
  test("у каждого файла одна версия во всех ссылках", () => {
    for (const [file, { v }] of Object.entries(current())) assert.ok(!v.includes(","), `${file} подключён с разными версиями: ${v} — получатся два экземпляра модуля`);
  });

  test("изменённый файл приложения — с новой ?v=", () => {
    const snap = JSON.parse(readFileSync(SNAP, "utf8"));
    for (const [file, now] of Object.entries(current())) {
      const was = snap[file];
      if (!was || !now.sha) continue;
      if (now.sha !== was.sha) assert.notEqual(now.v, was.v, `${file} изменился, а версия та же (?v=${now.v}): подними её во всех ссылках`);
      if (now.v !== was.v || now.sha !== was.sha) assert.fail(`${file}: версия или содержимое новые — обнови снимок: node tests/versions.test.mjs --update`);
    }
  });
}
