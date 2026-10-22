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
  const bad = normalize(`Главное: самая тяжёлая проблема — 62 ... к 20:00.\n\nПлан на следующую игру:\n— До 10:00 купи Manta.\n— Фарми 70 крипов.\n— Ставь варды.`);
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
  assert.deepEqual(problemsOf(good + "\n" + "а".repeat(1800), prompt), ["формат"]);
});

test("problemsOf: число пунктов", () => {
  assert.ok(reasons(good.replace(/\n— Собери[^\n]*/, "")).some((r) => /ровно три пункта/.test(r)));
  assert.ok(reasons(good + "\n— Ставь варды на линии.").some((r) => /ровно три пункта/.test(r)));
  // пункт без тире всё равно считается пунктом: normalize его выровняет
  assert.ok(!problemsOf(good.replace("— Добивай", "Добивай"), prompt).some((r) => /ровно три пункта/.test(r)));
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
    const u = String(url);
    const who = u.includes("groq") ? "groq" : u.includes("dreamn") ? "claude" : u.includes("telegram") ? "tg"
      : u.includes("opendota") ? "od" : "gemini";
    const body = init && init.body ? JSON.parse(init.body) : null;
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

test("ask: groq пять раз плох, запасной gemini", async (t) => {
  t.after(restore);
  const calls = mockFetch({ groq: Array.from({ length: 5 }, () => groqOk(garbage)), gemini: [geminiOk(good)] });
  assert.equal(await ask(both, prompt), normalize(good));
  assert.deepEqual(calls.map((c) => c.who), ["groq", "groq", "groq", "groq", "groq", "gemini"]);
  // gemini получает чистую сводку, без жалоб на groq
  assert.equal(calls[5].body.contents[0].parts[0].text, prompt);
  assert.equal(calls[5].headers["x-goog-api-key"], "m");
  assert.deepEqual(calls[5].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
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
  await assert.rejects(ask(both, prompt), (e) => e.status === 500 && /^askGroq \d+ с: groq cut$/.test(e.log[0]));
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
  mockFetch({ groq: Array.from({ length: 5 }, () => groqOk(hard)), gemini: [geminiOk(hard), geminiOk(hard)] });
  await assert.rejects(ask(both, prompt), (e) => e.message === "no answer" && e.log.length === 7);
});

test("ask: все упали — ошибка со статусом и логом", async (t) => {
  t.after(restore);
  mockFetch({ groq: [new Response("x", { status: 500 })], gemini: [new Response("busy", { status: 503 })] });
  await assert.rejects(ask(both, prompt), (e) => {
    assert.equal(e.message, "no answer");
    assert.equal(e.status, 503);
    assert.equal(e.log.length, 2);
    assert.match(e.log[0], /^askGroq \d+ с: groq 500/);
    assert.match(e.log[1], /^askGemini \d+ с: gemini 503: busy/);
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
  const res = await worker.fetch(req({ body: JSON.stringify({ hero: "x".repeat(11000) }) }), both);
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

// ---------- моменты ----------

const withEpisodes = buildPrompt({ ...raw, episodes: [
  { clock: "18:38", kind: "death", facts: ["тебя убил Tiny", "в командной драке", "обсов вашей команды на карте: 1", "за 2 минуты враги сломали: T2 на боте"] },
  { clock: "31:08", kind: "death", facts: ["тебя убил Enigma", "команда отставала на 8 444 золота"] },
  { clock: "nope", kind: "death", facts: ["битое время"] },
] });
const momentsGood = `Главное: смерти в драках без видимости стоили команде вышек.

Моменты:
— 18:38 Ошибка: зашёл в драку почти без видимости, и команда отдала T2 на боте. Надо было: сначала поставить обс у входа в лес.
— 31:08 Ошибка: умер, когда команда и так отставала. Надо было: стоять у вышки с командой.

План на следующую игру:
— Перед дракой ставь обс у входа в лес.
— Добивай крипов на линии, пока не уйдёшь в лес.
— Собери Black King Bar: враги ставят много оглушений.`;

test("buildPrompt: моменты с валидным временем", () => {
  assert.match(withEpisodes, /Ключевые моменты \(время: факты\):\n- 18:38 смерть: тебя убил Tiny; в командной драке/);
  assert.ok(!withEpisodes.includes("битое время"));
});

test("problemsOf: хороший ответ с моментами проходит", () => {
  assert.deepEqual(problemsOf(normalize(momentsGood), withEpisodes), []);
});

test("problemsOf: моменты обязательны и с временем из сводки", () => {
  const none = normalize(momentsGood.replace(/Моменты:\n(— [^\n]*\n)+\n/, ""));
  assert.ok(problemsOf(none, withEpisodes).some((r) => /Моментах/.test(r)));
  const wrongTime = normalize(momentsGood.replace("— 31:08", "— 32:00"));
  assert.ok(problemsOf(wrongTime, withEpisodes).some((r) => /со своего времени/.test(r)));
  const noLabels = normalize(momentsGood.replace("Ошибка: умер", "Умер"));
  assert.ok(problemsOf(noLabels, withEpisodes).some((r) => /Ошибка:/.test(r)));
});

test("problemsOf: в моменте нельзя чужой предмет или цифру", () => {
  // T2 на боте есть в фактах 18:38, но не 31:08
  const alienItem = normalize(momentsGood.replace("стоять у вышки с командой", "защищать T2 на боте"));
  assert.ok(problemsOf(alienItem, withEpisodes).some((r) => /31:08/.test(r)));
  // предмет из сборки в «Надо было» можно, сокращение тоже
  const buildItem = normalize(momentsGood.replace("стоять у вышки с командой", "собрать BKB и стоять с командой"));
  assert.deepEqual(problemsOf(buildItem, withEpisodes), []);
  // 8 444 есть в фактах 31:08, но не 18:38
  const alienNum = normalize(momentsGood.replace("почти без видимости", "при отставании 8 444"));
  assert.ok(problemsOf(alienNum, withEpisodes).some((r) => /18:38.*8/.test(r)));
  const ownNum = normalize(momentsGood.replace("и так отставала", "отставала на 8 444"));
  assert.deepEqual(problemsOf(ownNum, withEpisodes), []);
});

test("normalize: секция моментов сохраняется", () => {
  const t = normalize(momentsGood.replace("— 18:38", "- 18:38"));
  assert.match(t, /Моменты:\n— 18:38/);
  assert.match(t, /План на следующую игру:\n— Перед дракой/);
});

test("problemsOf: «без обсов» и «один» только при таких фактах", () => {
  const solo = buildPrompt({ ...raw, episodes: [
    { clock: "6:28", kind: "death", facts: ["тебя убил Kez", "стадия линий, твоя линия: мид", "размен: ты тоже убил Kez", "обсов вашей команды на карте: 1"] },
    { clock: "25:10", kind: "death", facts: ["тебя убил Enigma", "один, рядом своих не было", "ни одного обса вашей команды на карте"] },
  ] });
  const answer = (a, b) => normalize(`Главное: смерти без видимости стоили игры.

Моменты:
— 6:28 Ошибка: ${a} Надо было: следить за хп и волной.
— 25:10 Ошибка: ${b} Надо было: фармить ближе к своим.

План на следующую игру:
— Следи за хп на линии.
— Фарми ближе к своим, когда врагов не видно.
— Перед дракой ставь обс у входа в лес.`);
  const ok = answer("отдал размен на линии при низком хп.", "фармил один без обсов.");
  assert.deepEqual(problemsOf(ok, solo), []);
  assert.ok(problemsOf(answer("играл один без союзников и обсов.", "фармил один без обсов."), solo).some((r) => /6:28/.test(r)));
  assert.ok(problemsOf(answer("полез на линии без видимости.", "фармил один без обсов."), solo).some((r) => /6:28.*обс/.test(r)));
  assert.deepEqual(problemsOf(answer("полез на линии почти без видимости.", "фармил один без обсов."), solo), []);
});

test("problemsOf: «фармил один» в пропущенной драке можно", () => {
  const missed = buildPrompt({ ...raw, episodes: [
    { clock: "21:30", kind: "missed_fight", facts: ["драка без тебя: союзников погибло 3, врагов 0", "ты в это время добил 14 крипов"] },
  ] });
  const t = normalize(`Главное: команда дралась без тебя.

Моменты:
— 21:30 Ошибка: фармил один, пока команда дралась. Надо было: идти к своим по ТП.

План на следующую игру:
— Смотри на миникарту каждые пару секунд.
— Иди к команде, когда она собирается на драку.
— Перед дракой ставь обс у входа в лес.`);
  assert.deepEqual(problemsOf(t, missed), []);
});

test("problemsOf: «один» в «Ошибке» требует факта, в «Надо было» — нет", () => {
  const p = buildPrompt({ ...raw, episodes: [
    { clock: "36:07", kind: "death", facts: ["тебя убил Invoker", "в мелкой стычке", "обсов вашей команды на карте: 2"] },
  ] });
  const t = (moment) => normalize(`Главное: смерти при перевесе стоили игры.

Моменты:
— 36:07 ${moment}

План на следующую игру:
— С перевесом стой с командой.
— Бери объекты после выигранной драки.
— Перед дракой ставь обс у входа в лес.`);
  const bad = (m) => problemsOf(t(m), p).some((r) => /36:07 написано «один»/.test(r));
  assert.ok(bad("Ошибка: полез в мелкую стычку один с перевесом. Надо было: стоять с командой."));
  assert.ok(bad("Ошибка: пошёл фармить в одиночку. Надо было: стоять с командой."));
  assert.ok(!bad("Ошибка: полез в стычку при перевесе. Надо было: не лезть в туман одному."));
  assert.ok(!bad("Ошибка: проиграл драку один на один. Надо было: стоять с командой."));
  assert.ok(!bad("Ошибка: ни один обс не стоял у входа. Надо было: стоять с командой."));
});

test("problemsOf: в выигранной катке «Главное» не называет игру проигранной", () => {
  const won = buildPrompt({ ...raw, won: true });
  const lost = (main) => good.replace(/^Главное: [^\n]*/, `Главное: ${main}`);
  for (const main of ["Игру тебе стоили смерти в одиночку на 62 крипах к 20:00.", "62 крипа к 20:00 стоили тебе этой игры.", "Ты проиграл из-за 62 крипов к 20:00."])
    assert.ok(problemsOf(lost(main), won).some((r) => /проигранной/.test(r)), main);
  assert.ok(!problemsOf(good, won).some((r) => /проигранной/.test(r)));
  // в проигранной то же самое можно
  assert.ok(!problemsOf(lost("Игру тебе стоили 62 крипа к 20:00."), prompt).some((r) => /проигранной/.test(r)));
});

test("проверка: свой герой в моменте и предмет из главных проблем — не чужие факты", () => {
  const p = buildPrompt({
    hero: "Lifestealer", role: "керри", won: false, kda: "9/8/14", duration: 2040,
    problems: [{ title: "Не было Black King Bar", fact: "Black King Bar так и не собрал", action: "Собирай Black King Bar" }],
    episodes: [
      { clock: "16:44", kind: "death", facts: ["тебя убил Necrophos", "в командной драке"] },
      { clock: "33:27", kind: "death", facts: ["тебя убил Axe", "один"] },
    ],
  });
  const text = `Главное: в драках тебя ловили первым, и без Black King Bar ты не успевал ничего нажать.
Моменты:
— 16:44 Ошибка: Lifestealer зашёл в драку первым. Надо было: заходить вторым после инициации.
— 33:27 Ошибка: пошёл один против Axe. Надо было: собрать Black King Bar и ходить с командой.
План на следующую игру:
— Заходи в драку вторым, когда враги потратили контроль.
— Не ходи один на чужую половину без вижна.
— Смотри на миникарту перед тем, как идти фармить.`;
  const bad = problemsOf(text, p).filter((b) => /то, чего нет в его фактах/.test(b));
  assert.deepEqual(bad, []);
});
