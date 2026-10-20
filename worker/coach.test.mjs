import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildPrompt, normalize, problemsOf, ask } from "./coach.js";

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

// Ответ, у которого единственная беда мягкая: нет цифры из первой проблемы
const soft = good.replace("у тебя было 62 крипа к 20:00, поэтому золота", "золота");
const garbage = "Ну короче играй лучше";

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

// ---------- buildPrompt ----------

test("buildPrompt: секунды переводятся в минуты", () => {
  assert.match(prompt, /длительность 35 мин\./);
  assert.match(buildPrompt({ ...raw, duration: "1830" }), /длительность 31 мин\./);
  assert.match(buildPrompt({ ...raw, duration: "35:12" }), /длительность 35:12\./);
  assert.match(buildPrompt({ ...raw, duration: 0 }), /длительность 0\./);
  assert.match(buildPrompt({ ...raw, duration: undefined }), /длительность \./);
});

test("buildPrompt: шапка, итог и KDA", () => {
  assert.match(prompt, /^Герой: Phantom Assassin\. Роль: керри\. Ранг: Рекрут\./);
  assert.match(prompt, /Итог: поражение, KDA 2\/11\/3/);
  assert.match(buildPrompt({ ...raw, won: true }), /Итог: победа/);
});

test("buildPrompt: обрезка длинных полей и сжатие пробелов", () => {
  const p = buildPrompt({ ...raw, hero: "A".repeat(100), role: "  керри \n\t мид  ", kda: "1".repeat(50) });
  assert.match(p, new RegExp(`Герой: ${"A".repeat(40)}\\.`));
  assert.match(p, /Роль: керри мид\./);
  assert.match(p, new RegExp(`KDA ${"1".repeat(20)},`));
  const long = buildPrompt({ ...raw, problems: [{ title: "Т".repeat(200), fact: "ф".repeat(500), action: "д".repeat(500) }] });
  assert.ok(long.includes(`- ${"Т".repeat(80)}: ${"ф".repeat(200)} -> Действие: ${"д".repeat(260)}\n`) || long.includes(`- ${"Т".repeat(80)}: ${"ф".repeat(200)} -> Действие: ${"д".repeat(260)}`));
  assert.ok(!long.includes("Т".repeat(81)));
  assert.ok(!long.includes("ф".repeat(201)));
  assert.ok(!long.includes("д".repeat(261)));
});

test("buildPrompt: проблемы с действием, максимум три", () => {
  const p = buildPrompt({ ...raw, problems: [
    { title: "П1", fact: "ф1", action: "делай раз" },
    { title: "П2", fact: "ф2" },
    { title: "П3", fact: "ф3" },
    { title: "П4", fact: "ф4" },
  ] });
  assert.match(p, /Главные проблемы \(по важности\):\n- П1: ф1 -> Действие: делай раз\n- П2: ф2\n- П3: ф3/);
  assert.ok(!p.includes("П4"));
  assert.ok(!/П2: ф2 -> Действие/.test(p));
});

test("buildPrompt: мелочи строками и объектами {text, tip}", () => {
  const p = buildPrompt({ ...raw, micro: ["строка", { text: "объект", tip: "совет" }, { text: "без совета" }, { tip: "без текста" }, "пятая", "шестая"] });
  assert.match(p, /Мелочи:\n- строка\n- объект -> Совет: совет\n- без совета\n- пятая/);
  assert.ok(!p.includes("без текста"));
  assert.ok(!p.includes("шестая"));
});

test("buildPrompt: сильные стороны, сборка и драфт с лимитами", () => {
  const p = buildPrompt({ ...raw,
    strengths: [{ title: "Фарм", fact: "700 GPM" }, { title: "Варды" }, { title: "Третья" }],
    plan: [{ item: "A", why: "1" }, { item: "B", why: "2" }, { item: "C", why: "3" }, { item: "D", why: "4" }],
    draft: ["д1", "д2", "д3"],
  });
  assert.match(p, /Сильные стороны:\n- Фарм: 700 GPM\n- Варды\n/);
  assert.ok(!p.includes("Третья"));
  assert.match(p, /Сборка под эту катку:\n- A: 1\n- B: 2\n- C: 3/);
  assert.ok(!p.includes("- D: 4"));
  assert.match(p, /Драфт:\n- д1\n- д2$/);
});

test("buildPrompt: пустые и кривые поля не ломают сводку", () => {
  const p = buildPrompt({ hero: "Sven" });
  assert.equal(p, "Герой: Sven. Роль: . Ранг: неизвестен.\nИтог: поражение, KDA , длительность .");
  const q = buildPrompt({ hero: "Sven", problems: "не массив", micro: [null, 5], plan: null, strengths: [null] });
  assert.ok(!/Главные проблемы|Мелочи|Сборка/.test(q));
  assert.ok(!/undefined|null/.test(q.replace(/Сильные стороны:\n- $/, "")));
});

// ---------- normalize ----------

test("normalize: латиница в русских словах чинится, английские названия не трогаются", () => {
  const t = normalize("Главное: у тебя было 62 крипa.\n\nПлан на следующую игру:\n— Ставь вардa.\n— Coбери Black King Bar сразу.\n— Жми кнопки.");
  assert.match(t, /крипа\./);
  assert.match(t, /варда\./);
  assert.match(t, /Собери Black King Bar/);
  assert.ok(t.includes("Black King Bar"));
  assert.ok(!/[a-z][а-яё]|[а-яё][a-z]/i.test(t));
});

test("normalize: маркеры пунктов приводятся к «— », ** вырезаются", () => {
  const t = normalize("**Главное:** у тебя было 62 крипа.\n\n**План на следующую игру:**\n* раз.\n- два.\n• три.");
  assert.equal(t, "Главное: у тебя было 62 крипа.\n\nПлан на следующую игру:\n— раз.\n— два.\n— три.");
});

test("normalize: «Главное» склеивается в одну строку, пустые строки в плане выкидываются", () => {
  const t = normalize("Главное: раз\nдва   три\nПлан на следующую игру:\n\n— а.\n\n— б.\n— в.   ");
  assert.equal(t, "Главное: раз два три\n\nПлан на следующую игру:\n— а.\n— б.\n— в.");
});

test("normalize: без заголовков возвращает просто почищенный текст", () => {
  assert.equal(normalize("**привет**  "), "привет");
  assert.equal(normalize(undefined), "");
  assert.equal(normalize(null), "");
});

// ---------- problemsOf ----------

const reasons = (text) => problemsOf(normalize(text), prompt);

test("problemsOf: формат", () => {
  assert.deepEqual(problemsOf("Привет\n" + good, prompt), ["формат"]);
  assert.deepEqual(problemsOf(good.replace("План на следующую игру:", "План:"), prompt), ["формат"]);
  assert.deepEqual(problemsOf(good + "\n" + "а".repeat(1100), prompt), ["формат"]);
});

test("problemsOf: число пунктов", () => {
  assert.ok(reasons(good.replace(/\n— Собери[^\n]*/, "")).some((r) => /ровно три пункта/.test(r)));
  assert.ok(reasons(good + "\n— Ставь варды на линии.").some((r) => /ровно три пункта/.test(r)));
  // без normalize пункт без тире тоже ловится
  assert.ok(problemsOf(good.replace("— Добивай", "Добивай"), prompt).some((r) => /ровно три пункта/.test(r)));
});

test("problemsOf: многоточие", () => {
  assert.ok(reasons(good.replace("на линии,", "на линии…")).includes("многоточия и пропущенные слова"));
  assert.ok(reasons(good.replace("на линии,", "на линии...")).includes("многоточия и пропущенные слова"));
});

test("problemsOf: латиница не из сводки", () => {
  const r = reasons(good.replace("Black King Bar", "Black King Bar и Blink Dagger"));
  assert.ok(r.some((x) => /латиница не из сводки: blink, dagger/.test(x)), r.join(" | "));
});

test("problemsOf: смешанные буквы в слове ловятся без normalize", () => {
  const r = problemsOf(good.replace("крипа", "крипa"), prompt);
  assert.ok(r.some((x) => /смешаны русские и латинские/.test(x)));
});

test("problemsOf: числа не из сводки", () => {
  const r = reasons(good.replace("на линии,", "на линии до 99 крипов,"));
  assert.ok(r.some((x) => /числа не из сводки: 99/.test(x)));
});

test("problemsOf: нет цифры первой проблемы в «Главном»", () => {
  assert.deepEqual(reasons(soft), ["в «Главном» нет цифры из первой проблемы"]);
  // цифра второй проблемы не засчитывается
  assert.deepEqual(reasons(soft.replace("Главное: золота", "Главное: 11 смертей, золота")), ["в «Главном» нет цифры из первой проблемы"]);
  // если у первой проблемы нет цифр, правило не срабатывает
  const p = buildPrompt({ ...raw, problems: [{ title: "Плохой фарм", fact: "мало крипов" }] });
  assert.ok(!problemsOf(normalize(soft), p).includes("в «Главном» нет цифры из первой проблемы"));
});

test("problemsOf: отписка в «Главном»", () => {
  assert.ok(reasons(good.replace("поэтому", "не видно, что решил, поэтому")).includes("отписка в «Главном»"));
});

test("problemsOf: время покупки предмета в пункте", () => {
  assert.ok(reasons(good.replace("Собери Black King Bar:", "Собери Black King Bar к 20:00:")).includes("время покупки предмета"));
  // время без покупки и покупка без времени в разных пунктах не считаются
  const t = good.replace("Добивай крипов на линии,", "Добивай крипов до 20:00,");
  assert.ok(!reasons(t).includes("время покупки предмета"));
});

test("problemsOf: предметы без блока сборки, но варды можно", () => {
  const p = buildPrompt({ ...raw, plan: [] });
  const wards = normalize(good.replace("Собери Black King Bar: враги ставят много оглушений.", "Купи варды и ставь их у леса."));
  assert.ok(!problemsOf(wards, p).includes("предметы, которых нет в сводке"));
  const sentries = normalize(good.replace("Собери Black King Bar: враги ставят много оглушений.", "Собери сентри и обс к выходу в лес."));
  assert.ok(!problemsOf(sentries, p).includes("предметы, которых нет в сводке"));
  const items = normalize(good.replace("Собери Black King Bar: враги ставят много оглушений.", "Собери посох и ботинки."));
  assert.ok(problemsOf(items, p).includes("предметы, которых нет в сводке"));
  // покупка вардов в одном пункте не прикрывает чужой предмет в другом
  const both = normalize(good
    .replace("Добивай крипов на линии, пока не уйдёшь в лес.", "Купи варды и ставь их у леса.")
    .replace("Собери Black King Bar: враги ставят много оглушений.", "Собери посох и ботинки."));
  assert.ok(problemsOf(both, p).includes("предметы, которых нет в сводке"));
  // с блоком сборки предметы можно
  assert.ok(!problemsOf(items, prompt).includes("предметы, которых нет в сводке"));
});

test("problemsOf: смерти в сводке требуют пункта про смерти или драки", () => {
  const noDeaths = good.replace("Перед дракой нажимай кнопки, а не умирай с полными.", "Ставь варды у своего леса.");
  assert.deepEqual(reasons(noDeaths), ["ни один пункт не про смерти и драки"]);
  const calm = buildPrompt({ hero: "Sven", problems: [{ title: "Мало фарма", fact: "62 крипа к 20:00" }], plan: raw.plan });
  assert.ok(!problemsOf(normalize(noDeaths), calm).includes("ни один пункт не про смерти и драки"));
});

test("problemsOf: оборванный пункт", () => {
  assert.ok(reasons(good.replace("много оглушений.", "много оглушений и")).includes("ответ оборван"));
  // закрывающая кавычка и скобка годятся как конец
  assert.ok(!reasons(good.replace("много оглушений.", "много оглушений (стан)")).includes("ответ оборван"));
});

test("problemsOf: повторяющиеся пункты", () => {
  const dup = good.replace("Перед дракой нажимай кнопки, а не умирай с полными.", "Добивай крипов на линии, а умирай реже в драках.");
  assert.ok(reasons(dup).includes("пункты повторяются"));
});

// ---------- ask() с подменённым fetch ----------

const realFetch = globalThis.fetch;
const groqOk = (content, finish = "stop") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { status: 200 });
const geminiOk = (text) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

// Подменяет fetch: каждый вызов берёт следующий ответ из очереди своего провайдера
function mockFetch(queues) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const who = String(url).includes("groq") ? "groq" : "gemini";
    const body = JSON.parse(init.body);
    calls.push({ who, url: String(url), body, headers: init.headers });
    const next = queues[who]?.shift();
    if (!next) throw new Error(`лишний вызов ${who}`);
    return typeof next === "function" ? next() : next;
  };
  return calls;
}
const restore = () => { globalThis.fetch = realFetch; };
const both = { GROQ_API_KEY: "g", GEMINI_API_KEY: "m" };

test("ask: groq первый, хороший ответ сразу отдаётся", async (t) => {
  t.after(restore);
  const calls = mockFetch({ groq: [groqOk(good)] });
  assert.equal(await ask(both, prompt), normalize(good));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].who, "groq");
  assert.equal(calls[0].headers.Authorization, "Bearer g");
  assert.equal(calls[0].body.model, "openai/gpt-oss-120b");
  assert.equal(calls[0].body.reasoning_effort, "low");
  assert.equal(calls[0].body.messages[1].content, prompt);
});

test("ask: GROQ_MODEL без gpt-oss не шлёт reasoning_effort", async (t) => {
  t.after(restore);
  const calls = mockFetch({ groq: [groqOk(good)] });
  await ask({ GROQ_API_KEY: "g", GROQ_MODEL: "llama-3.3-70b" }, prompt);
  assert.equal(calls[0].body.model, "llama-3.3-70b");
  assert.ok(!("reasoning_effort" in calls[0].body));
});

test("ask: плохой ответ уходит обратно с перечнем ошибок", async (t) => {
  t.after(restore);
  const bad = good.replace("Black King Bar", "Black King Bar и Blink Dagger");
  const calls = mockFetch({ groq: [groqOk(bad), groqOk(good)] });
  assert.equal(await ask(both, prompt), normalize(good));
  assert.equal(calls.length, 2);
  const retry = calls[1].body.messages[1].content;
  assert.ok(retry.startsWith(prompt));
  assert.match(retry, /Прошлый ответ не подошёл: латиница не из сводки: blink, dagger\. Перепиши по правилам\./);
});

test("ask: при формате в подсказке объяснение формата", async (t) => {
  t.after(restore);
  const calls = mockFetch({ groq: [groqOk(garbage), groqOk(good)] });
  await ask(both, prompt);
  assert.match(calls[1].body.messages[1].content, /не тот формат или слишком длинно/);
});

test("ask: groq дважды плох, запасной gemini", async (t) => {
  t.after(restore);
  const calls = mockFetch({ groq: [groqOk(garbage), groqOk(garbage)], gemini: [geminiOk(good)] });
  assert.equal(await ask(both, prompt), normalize(good));
  assert.deepEqual(calls.map((c) => c.who), ["groq", "groq", "gemini"]);
  // gemini получает чистую сводку, без жалоб на groq
  assert.equal(calls[2].body.contents[0].parts[0].text, prompt);
  assert.equal(calls[2].headers["x-goog-api-key"], "m");
  assert.deepEqual(calls[2].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test("ask: ошибка groq сразу переходит на gemini без повтора", async (t) => {
  t.after(restore);
  const calls = mockFetch({ groq: [new Response("busy", { status: 429 })], gemini: [geminiOk(good)] });
  assert.equal(await ask(both, prompt), normalize(good));
  assert.deepEqual(calls.map((c) => c.who), ["groq", "gemini"]);
});

test("ask: groq обрезан по длине считается ошибкой", async (t) => {
  t.after(restore);
  mockFetch({ groq: [groqOk(good, "length")], gemini: [new Response("x", { status: 500 })] });
  await assert.rejects(ask(both, prompt), (e) => e.status === 500 && e.log[0] === "askGroq: groq cut");
});

test("ask: COACH_PRIMARY=gemini меняет порядок", async (t) => {
  t.after(restore);
  const calls = mockFetch({ gemini: [geminiOk(garbage), geminiOk(good)] });
  assert.equal(await ask({ ...both, COACH_PRIMARY: "gemini" }, prompt), normalize(good));
  assert.deepEqual(calls.map((c) => c.who), ["gemini", "gemini"]);
  assert.match(calls[1].body.contents[0].parts[0].text, /Прошлый ответ не подошёл/);
});

test("ask: gemini 400 — повтор без thinkingConfig", async (t) => {
  t.after(restore);
  const calls = mockFetch({ gemini: [new Response("bad", { status: 400 }), geminiOk(good)] });
  assert.equal(await ask({ GEMINI_API_KEY: "m", GEMINI_MODEL: "gemini-x" }, prompt), normalize(good));
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.generationConfig.thinkingConfig);
  assert.ok(!("thinkingConfig" in calls[1].body.generationConfig));
  assert.match(calls[0].url, /models\/gemini-x:generateContent$/);
});

test("ask: gemini 404 тоже повторяется без thinkingConfig", async (t) => {
  t.after(restore);
  const calls = mockFetch({ gemini: [new Response("nf", { status: 404 }), geminiOk(good)] });
  assert.equal(await ask({ GEMINI_API_KEY: "m" }, prompt), normalize(good));
  assert.equal(calls.length, 2);
});

test("ask: мягкий ответ отдаётся, если лучшего нет", async (t) => {
  t.after(restore);
  mockFetch({ groq: [groqOk(soft), groqOk(soft)], gemini: [geminiOk(garbage)] });
  assert.equal(await ask(both, prompt), normalize(soft));
});

test("ask: жёсткая ошибка не годится в запасной ответ", async (t) => {
  t.after(restore);
  const hard = good.replace("на линии,", "на линии…");
  mockFetch({ groq: [groqOk(hard), groqOk(hard)], gemini: [geminiOk(hard)] });
  await assert.rejects(ask(both, prompt), (e) => e.message === "no answer" && e.log.length === 3);
});

test("ask: все упали — ошибка со статусом и логом", async (t) => {
  t.after(restore);
  mockFetch({ groq: [new Response("x", { status: 500 })], gemini: [new Response("busy", { status: 503 })] });
  await assert.rejects(ask(both, prompt), (e) => {
    assert.equal(e.message, "no answer");
    assert.equal(e.status, 503);
    assert.equal(e.log.length, 2);
    assert.match(e.log[0], /^askGroq: groq 500/);
    assert.match(e.log[1], /^askGemini: gemini 503: busy/);
    return true;
  });
});

test("ask: сетевой сбой без статуса оставляет прошлый статус", async (t) => {
  t.after(restore);
  mockFetch({ groq: [new Response("x", { status: 429 })], gemini: [() => { throw new TypeError("network"); }] });
  await assert.rejects(ask(both, prompt), (e) => e.status === 429 && /network/.test(e.log[1]));
});

test("ask: без ключей сразу ошибка", async () => {
  await assert.rejects(ask({}, prompt), (e) => e.status === 0 && e.log.length === 0);
});

// ---------- fetch-обработчик воркера ----------

const ORIGIN = "https://bezzz22.github.io";
let ipSeq = 0;
const nextIp = () => `10.0.0.${++ipSeq}`;
const req = (opts = {}) => new Request("https://coach.example/", {
  method: opts.method || "POST",
  headers: { Origin: opts.origin ?? ORIGIN, "CF-Connecting-IP": opts.ip || nextIp(), ...(opts.headers || {}) },
  body: (opts.method || "POST") === "POST" ? (opts.body ?? JSON.stringify(raw)) : undefined,
});
const json = async (res) => res.json();

test("fetch: OPTIONS отвечает 204 с CORS", async () => {
  const res = await worker.fetch(req({ method: "OPTIONS" }), both);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(res.headers.get("Access-Control-Allow-Methods"), /POST/);
});

test("fetch: не POST — 405", async () => {
  const res = await worker.fetch(req({ method: "GET" }), both);
  assert.equal(res.status, 405);
  assert.equal((await json(res)).error, "Только POST.");
});

test("fetch: чужой origin — 403, CORS не отдаёт чужой адрес", async () => {
  const res = await worker.fetch(req({ origin: "https://evil.example" }), both);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("fetch: без ключей — 500", async () => {
  const res = await worker.fetch(req(), {});
  assert.equal(res.status, 500);
  assert.equal((await json(res)).error, "Тренер ещё не настроен.");
});

test("fetch: кривой JSON и сводка без героя — 400", async () => {
  assert.equal((await worker.fetch(req({ body: "{нет" }), both)).status, 400);
  assert.equal((await worker.fetch(req({ body: "null" }), both)).status, 400);
  assert.equal((await worker.fetch(req({ body: JSON.stringify({ role: "керри" }) }), both)).status, 400);
});

test("fetch: слишком большая сводка — 413", async () => {
  const res = await worker.fetch(req({ body: JSON.stringify({ hero: "x".repeat(7000) }) }), both);
  assert.equal(res.status, 413);
});

test("fetch: хороший ответ — 200 с текстом", async (t) => {
  t.after(restore);
  mockFetch({ groq: [groqOk(good)] });
  const res = await worker.fetch(req(), both);
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { text: normalize(good) });
});

test("fetch: лимит 6 запросов в час на IP, седьмой — 429", async (t) => {
  t.after(restore);
  mockFetch({ groq: Array.from({ length: 6 }, () => groqOk(good)) });
  const ip = nextIp();
  for (let i = 0; i < 6; i++) assert.equal((await worker.fetch(req({ ip }), both)).status, 200, `запрос ${i + 1}`);
  const res = await worker.fetch(req({ ip }), both);
  assert.equal(res.status, 429);
  assert.equal((await json(res)).error, "Слишком часто. Подожди немного.");
  // другой IP не задет
  mockFetch({ groq: [groqOk(good)] });
  assert.equal((await worker.fetch(req(), both)).status, 200);
});

test("fetch: COACH_IP_LIMIT меняет лимит", async (t) => {
  t.after(restore);
  mockFetch({ groq: [groqOk(good), groqOk(good)] });
  const env = { ...both, COACH_IP_LIMIT: "2" };
  const ip = nextIp();
  assert.equal((await worker.fetch(req({ ip }), env)).status, 200);
  assert.equal((await worker.fetch(req({ ip }), env)).status, 200);
  assert.equal((await worker.fetch(req({ ip }), env)).status, 429);
});

test("fetch: все провайдеры упали — 502, лог только с COACH_DEBUG", async (t) => {
  t.after(restore);
  mockFetch({ groq: [new Response("x", { status: 500 })], gemini: [new Response("x", { status: 500 })] });
  let res = await worker.fetch(req(), both);
  assert.equal(res.status, 502);
  assert.deepEqual(await json(res), { error: "Тренер сейчас недоступен." });

  mockFetch({ groq: [new Response("x", { status: 500 })], gemini: [new Response("x", { status: 503 })] });
  res = await worker.fetch(req(), { ...both, COACH_DEBUG: "1" });
  const body = await json(res);
  assert.equal(res.status, 502);
  assert.equal(body.error, "Тренер перегружен, попробуй через минуту.");
  assert.equal(body.log.length, 2);
});
