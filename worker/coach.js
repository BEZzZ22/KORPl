// Cloudflare Worker: прокси между приложением и нейросетью. Ключи лежат в секретах воркера и в приложение не попадают.
// Деплой: dashboard.cloudflare.com -> Workers & Pages -> Create -> Hello World -> Edit code -> вставить этот файл,
// затем Settings -> Variables and Secrets -> добавить секреты GROQ_API_KEY и/или GEMINI_API_KEY
// (хватит одного, второй будет запасным). Модели: переменные GROQ_MODEL и GEMINI_MODEL.
// Какой провайдер первый: переменная COACH_PRIMARY = groq (по умолчанию) или gemini.

const ALLOWED_ORIGINS = ["https://bezzz22.github.io"];
const GEMINI_MODEL = "gemini-flash-lite-latest";
const GROQ_MODEL = "openai/gpt-oss-120b";
const PROVIDER_TIMEOUT = 12000; // мс на один запрос к нейросети, чтобы не висеть минуту
const MAX_BODY = 6000;         // байт: сюда влезает вся сводка разбора
const PER_IP_PER_HOUR = 6;     // мягкий лимит на человека (память воркера, сбрасывается при перезапуске)
const GLOBAL_PER_DAY = 400;    // не даём выжечь бесплатный лимит ключей одному энтузиасту

const hits = new Map();
let day = { key: "", count: 0 };

const SYSTEM = `Ты тренер по Dota 2. Игрок прислал сводку своего разбора матча. В ней уже есть проверенные советы движка: «Действие» у проблем и «Совет» у мелочей.
Пиши по-русски, на «ты», коротко и дружески, простыми короткими фразами, без смайликов и без многоточий.
Формат строго такой:
Главное: одно-два предложения. Назови самую тяжёлую проблему (первая в блоке «Главные проблемы») вместе с её цифрой из сводки и скажи, чем она аукнулась в этой катке. Если проблем нет, похвали за «Сильные стороны» с их цифрой.
План на следующую игру: ровно три пункта, каждый с новой строки, начинается с «— », один пункт: одно конкретное действие.
Правила:
- Пункты плана пересказывай из «Действий» и «Советов» сводки своими словами. Ничего от себя не добавляй: ни приёмов, ни способностей, ни предметов, ни таймингов, ни числа. Любое число в ответе должно быть в сводке.
- Порядок пунктов: сначала то, что сильнее всего стоит игроку золота и жизней (смерти, драки), потом фарм, потом остальное. Пункты не повторяют друг друга и не дублируют «Главное».
- Предметы советуй только из блока «Сборка под эту катку» и с той же причиной. Предмет, которого там нет, не упоминай. Не отговаривай от предмета из этого блока. Время покупки не называй.
- Пиши про игрока на «ты»: «ты умирал», «у тебя было». Героя по имени не склоняй и не ставь рядом с глаголом прошедшего времени.
- Названия героев и предметов пиши так же, как в сводке. Слова пиши целиком, без «...» вместо пропусков. Не используй слова, в которых не уверен.
- Если в сводке почти пусто, не выдумывай проблем: скажи прямо, что серьёзных ошибок нет, и дай три пункта из «Мелочей» или «Сильных сторон».
- Не больше 90 слов.
Пример для другой игры (сводка: Герой Sven, поражение; проблема «Мало золота: 380 GPM -> Действие: добивай крипов на линии и фарми между драками»; мелочи «Смерть без прожатых кнопок -> Совет: жми способности до смерти»; сборка «Black King Bar: у врагов много контроля»):
Главное: у тебя было 380 GPM, золота не хватало на сборку, поэтому драки решали без тебя.
План на следующую игру:
— Перед смертью жми способности и предметы, не умирай с полными кнопками.
— Добивай крипов на линии и между драками уходи фармить.
— Собери Black King Bar: у врагов много контроля, без него тебя быстро выключают.`;

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function reply(status, body, origin) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}

function throttle(ip, now, perHour = PER_IP_PER_HOUR) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (day.key !== today) day = { key: today, count: 0 };
  if (day.count >= GLOBAL_PER_DAY) return "Тренер на сегодня устал, попробуй завтра.";
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= perHour) return "Слишком часто. Подожди немного.";
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  day.count += 1;
  return null;
}

const duration = (d) => (Number.isFinite(Number(d)) && Number(d) > 0 ? `${Math.round(Number(d) / 60)} мин` : clip(d, 12));
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Сводка собирается заново из проверенных полей: лишнего в промпт не попадёт
export function buildPrompt(raw) {
  const lines = [];
  lines.push(`Герой: ${clip(raw.hero, 40)}. Роль: ${clip(raw.role, 40)}. Ранг: ${clip(raw.rank, 30) || "неизвестен"}.`);
  lines.push(`Итог: ${raw.won ? "победа" : "поражение"}, KDA ${clip(raw.kda, 20)}, длительность ${duration(raw.duration)}.`);
  const list = (title, arr, n, each) => {
    const rows = (Array.isArray(arr) ? arr : []).slice(0, n).map(each).filter(Boolean);
    if (rows.length) lines.push(`${title}:\n${rows.map((r) => `- ${r}`).join("\n")}`);
  };
  list("Главные проблемы (по важности)", raw.problems, 3, (p) =>
    `${clip(p?.title, 80)}: ${clip(p?.fact, 200)}${p?.action ? ` -> Действие: ${clip(p.action, 260)}` : ""}`);
  list("Сильные стороны", raw.strengths, 2, (p) => `${clip(p?.title, 80)}${p?.fact ? `: ${clip(p.fact, 120)}` : ""}`);
  list("Мелочи", raw.micro, 4, (m) => {
    const o = typeof m === "string" ? { text: m } : m;
    return o?.text ? `${clip(o.text, 200)}${o.tip ? ` -> Совет: ${clip(o.tip, 240)}` : ""}` : "";
  });
  list("Сборка под эту катку", raw.plan, 3, (p) => `${clip(p?.item, 40)}: ${clip(p?.why, 160)}`);
  list("Драфт", raw.draft, 2, (t) => clip(t, 200));
  return lines.join("\n");
}

async function askGemini(env, prompt) {
  const model = env.GEMINI_MODEL || GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  // thinkingBudget: 0 отключает «размышления» (иначе ответ идёт 10+ секунд); не все версии модели его принимают
  const call = (generationConfig) => fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT),
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
  const base = { temperature: 0.2, maxOutputTokens: 700 };
  let res = await call({ ...base, thinkingConfig: { thinkingBudget: 0 } });
  if (res.status === 400 || res.status === 404) res = await call(base);
  if (!res.ok) throw Object.assign(new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 160)}`), { status: res.status });
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

// Groq: OpenAI-совместимый API, отвечает за секунду
async function askGroq(env, prompt) {
  const model = env.GROQ_MODEL || GROQ_MODEL;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 1500,
      ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`groq ${res.status}`), { status: res.status });
  const data = await res.json();
  if (data.choices?.[0]?.finish_reason === "length") throw Object.assign(new Error("groq cut"), { status: "cut" });
  return String(data.choices?.[0]?.message?.content || "").trim();
}

const HEADER = "План на следующую игру:";

// Приводит ответ к одному виду: заголовки, тире, пробелы
const LOOKALIKE = { a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х" };
// Латинская буква-двойник внутри русского слова («вардa») заменяется на русскую
const fixLookalikes = (t) => t.replace(/[а-яёА-ЯЁ][а-яёА-ЯЁa-zA-Z]*|[a-zA-Z]+[а-яёА-ЯЁ][а-яёА-ЯЁa-zA-Z]*/g, (w) => w.replace(/[a-zA-Z]/g, (ch) => LOOKALIKE[ch] || ch));

export function normalize(t) {
  const text = fixLookalikes(String(t || "")).replace(/[‐-―−]/g, "-").replace(/\*\*/g, "").replace(/[ \t]+\n/g, "\n").trim();
  const i = text.indexOf(HEADER);
  if (i < 0 || !/Главное:/.test(text)) return text;
  const main = text.slice(0, i).replace(/\s+/g, " ").trim();
  const bullets = text.slice(i + HEADER.length).split("\n").map((l) => l.trim().replace(/^[-•*]\s*/, "")).filter(Boolean);
  return `${main}\n\n${HEADER}\n${bullets.map((b) => `— ${b}`).join("\n")}`;
}

// Проверка ответа по сводке: возвращает список причин отказа (пусто: годится)
export function problemsOf(text, prompt) {
  const bad = [];
  const i = text.indexOf(HEADER);
  if (!/^Главное:/.test(text) || i < 0 || text.length > 1100) return ["формат"];
  const main = text.slice(0, i);
  const bullets = text.slice(i + HEADER.length).split("\n").map((l) => l.trim()).filter(Boolean);
  const joined = bullets.join(" ");
  if (bullets.length !== 3 || bullets.some((b) => !b.startsWith("— "))) bad.push("нужно ровно три пункта плана, каждый с «— »");
  if (/\.\.\.|…/.test(text)) bad.push("многоточия и пропущенные слова");
  const mixed = text.match(/\S*(?:[а-яё][a-z]|[a-z][а-яё])\S*/i);
  if (mixed) bad.push(`в слове смешаны русские и латинские буквы: ${mixed[0]}`);
  const words = (s) => s.toLowerCase().match(/[a-z][a-z'’-]{2,}/g) || [];
  const have = new Set(words(prompt));
  const foreign = words(text).filter((w) => !have.has(w));
  if (foreign.length) bad.push(`латиница не из сводки: ${[...new Set(foreign)].join(", ")}`);
  const nums = new Set(prompt.match(/\d+/g) || []);
  const extra = (text.match(/\d+/g) || []).filter((n) => !nums.has(n));
  if (extra.length) bad.push(`числа не из сводки: ${[...new Set(extra)].join(", ")}`);
  const top = (prompt.match(/Главные проблемы[^\n]*:\n- ([^\n]*)/) || [])[1] || "";
  const topNums = top.match(/\d+/g) || [];
  if (topNums.length && !topNums.some((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(main))) bad.push("в «Главном» нет цифры из первой проблемы");
  if (/не видно, что решил/i.test(main)) bad.push("отписка в «Главном»");
  if (bullets.some((b) => /\d+:\d+/.test(b) && /куп|собер|возьми/i.test(b))) bad.push("время покупки предмета");
  const hasItems = /Сборка под эту катку:/.test(prompt);
  if (!hasItems && /куп|собер/i.test(joined.replace(/вард|обс|сентр/gi, "")) && !/(куп|собер)\S*\s+(вард|обс|сентр)/i.test(joined)) bad.push("предметы, которых нет в сводке");
  if (/смерт|умир/i.test(prompt) && !/смерт|умир|умра|сейв|погиб|кнопк|драк/i.test(joined)) bad.push("ни один пункт не про смерти и драки");
  if (bullets.some((b) => !/[.!?»)]$/.test(b))) bad.push("ответ оборван");
  if (new Set(bullets.map((b) => b.slice(0, 25))).size < bullets.length) bad.push("пункты повторяются");
  return bad;
}

const providersOf = (env) => {
  const providers = [];
  if (env.GROQ_API_KEY) providers.push(askGroq);
  if (env.GEMINI_API_KEY) providers.push(askGemini);
  if (env.COACH_PRIMARY === "gemini") providers.reverse();
  return providers;
};

// Эти причины не делают совет неверным, ответ с ними можно отдать, если лучшего нет
const SOFT = ["в «Главном» нет цифры из первой проблемы", "ни один пункт не про смерти и драки"];

// Сначала провайдер из COACH_PRIMARY (по умолчанию groq), второй запасной.
// Плохой ответ отдаём назад модели с перечнем ошибок (одна попытка у первого провайдера)
export async function ask(env, prompt) {
  let lastStatus = 0, fallback = "";
  const log = [];
  const providers = providersOf(env);
  for (const [n, fn] of providers.entries()) {
    let user = prompt;
    for (let attempt = 0; attempt < (n === 0 ? 2 : 1); attempt++) {
      try {
        const text = normalize(await fn(env, user));
        const bad = problemsOf(text, prompt);
        log.push(`${fn.name}: ${bad.join("; ") || "ok"}`);
        if (!bad.length) return text;
        if (!fallback && bad.length === 1 && SOFT.includes(bad[0])) fallback = text;
        user = `${prompt}

Прошлый ответ не подошёл: ${bad.includes("формат") ? "не тот формат или слишком длинно (нужно «Главное:» и «План на следующую игру:» с тремя пунктами, до 90 слов)" : bad.join("; ")}. Перепиши по правилам.`;
      } catch (e) {
        lastStatus = e.status || lastStatus;
        log.push(`${fn.name}: ${e.message || e.name}`);
        break;
      }
    }
  }
  if (fallback) return fallback;
  throw Object.assign(new Error("no answer"), { status: lastStatus, log });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return reply(405, { error: "Только POST." }, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return reply(403, { error: "Нельзя." }, origin);
    if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) return reply(500, { error: "Тренер ещё не настроен." }, origin);

    const text = await request.text();
    if (text.length > MAX_BODY) return reply(413, { error: "Слишком большая сводка." }, origin);
    let raw;
    try { raw = JSON.parse(text); } catch { return reply(400, { error: "Не понял сводку." }, origin); }
    if (!raw || typeof raw !== "object" || !raw.hero) return reply(400, { error: "Не понял сводку." }, origin);

    const limited = throttle(request.headers.get("CF-Connecting-IP") || "anon", Date.now(), Number(env.COACH_IP_LIMIT) || PER_IP_PER_HOUR);
    if (limited) return reply(429, { error: limited }, origin);

    try {
      return reply(200, { text: await ask(env, buildPrompt(raw)) }, origin);
    } catch (e) {
      const busy = e.status === 429 || e.status === 503;
      const error = busy ? "Тренер перегружен, попробуй через минуту." : "Тренер сейчас недоступен.";
      return reply(502, env.COACH_DEBUG ? { error, log: e.log } : { error }, origin);
    }
  },
};
