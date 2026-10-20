// Cloudflare Worker: прокси между приложением и нейросетью. Ключи лежат в секретах воркера и в приложение не попадают.
// Деплой: dashboard.cloudflare.com -> Workers & Pages -> Create -> Hello World -> Edit code -> вставить этот файл,
// затем Settings -> Variables and Secrets -> добавить секреты GROQ_API_KEY и/или GEMINI_API_KEY
// (хватит одного, второй будет запасным). Модели: переменные GROQ_MODEL и GEMINI_MODEL.
// Какой провайдер первый: переменная COACH_PRIMARY = groq (по умолчанию) или gemini.

const ALLOWED_ORIGINS = ["https://bezzz22.github.io"];
const GEMINI_MODEL = "gemini-flash-lite-latest";
const GROQ_MODEL = "openai/gpt-oss-120b";
const PROVIDER_TIMEOUT = 12000; // мс на один запрос к нейросети, чтобы не висеть минуту
const MAX_BODY = 10000;        // байт: сюда влезает вся сводка разбора вместе с моментами
const PER_IP_PER_HOUR = 6;     // мягкий лимит на человека (память воркера, сбрасывается при перезапуске)
const GLOBAL_PER_DAY = 400;    // не даём выжечь бесплатный лимит ключей одному энтузиасту

const hits = new Map();
let day = { key: "", count: 0 };

const SYSTEM = `Ты тренер по Dota 2 и разбираешь катку игрока как живой тренер: по конкретным моментам, а не по итоговой статистике.
В сводке есть «Ключевые моменты»: время и проверенные факты (кто убил, драка или один, на чьей половине, сколько обсов стояло, нажаты ли кнопки, какой был перевес, что команда потеряла следом). Ещё есть проблемы с «Действием», мелочи с «Советом» и сборка.
Пиши по-русски, на «ты», коротко, прямо и дружески, без смайликов и без многоточий.
Формат строго такой:
Главное: одно предложение: что сильнее всего стоило тебе этой игры, без новых цифр.
Моменты:
— 23:40 Ошибка: одна фраза. Надо было: одна фраза.
План на следующую игру:
— три пункта, каждый с новой строки, один пункт: одно конкретное действие.
Правила:
- В «Моментах» разбери 2 или 3 самых дорогих момента из блока «Ключевые моменты» (если момент один, то один). Каждый пункт начинается с его времени из сводки.
- Факты момента НЕ пересказывай: игрок видит их рядом. Пиши только диагноз тренера: «Ошибка:» и «Надо было:», до 35 слов на момент.
- Диагноз строго из фактов этого момента: полез без видимости, умер один, когда команда вела и могла давить вышки, фармил, пока команда дралась, умер первым или без кнопок, после смерти команда отдала вышки или Рошана. В моменте упоминай только героев, предметы и числа из фактов этого же момента; в «Надо было» можно ещё предмет из «Сборки под эту катку». Названия способностей не пиши вовсе. Не выдумывай маршрут, позиции врагов и предметы, которых нет в сводке.
- План на следующую игру вытекает из моментов, проблем и «Советов». Предметы советуй только из блока «Сборка под эту катку» с той же причиной, время покупки не называй.
- Любое число и время в ответе должно быть в сводке. Цифры не складывай и не округляй.
- Пиши про игрока на «ты». Героя по имени не склоняй и не ставь рядом с глаголом прошедшего времени. Названия героев и предметов как в сводке. Слова целиком.
- Не больше 130 слов.
Пример момента (факты: «убил Tiny; в командной драке; обсов вашей команды на карте: 1; за 2 минуты враги сломали: T2 на боте»): «— 18:38 Ошибка: зашёл в драку первым почти без видимости, и команда осталась без тебя у вышки. Надо было: сначала поставить обс у входа в лес и драться вместе с командой».`;

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
    const rows = (Array.isArray(arr) ? arr : []).map(each).filter(Boolean).slice(0, n);
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
  list("Ключевые моменты (время: факты)", raw.episodes, 4, (e) => {
    const time = /^\d{1,2}:\d{2}$/.test(String(e?.clock || "")) ? e.clock : "";
    const facts = (Array.isArray(e?.facts) ? e.facts : []).slice(0, 10).map((f) => clip(f, 140)).filter(Boolean);
    return time && facts.length ? `${time} ${e.kind === "missed_fight" ? "пропущенная драка" : "смерть"}: ${facts.join("; ")}` : "";
  });
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

const MOMENTS = "Моменты:";
const asBullets = (s) => s.split("\n").map((l) => l.trim().replace(/^[-•*—–]\s*/, "")).filter(Boolean);

// Режет ответ на «Главное», пункты «Моментов» (может не быть) и пункты плана
function sections(text) {
  const i = text.indexOf(HEADER);
  if (i < 0) return null;
  const m = text.indexOf(MOMENTS);
  const hasMoments = m >= 0 && m < i;
  return {
    main: text.slice(0, hasMoments ? m : i).replace(/\s+/g, " ").trim(),
    moments: hasMoments ? asBullets(text.slice(m + MOMENTS.length, i)) : null,
    plan: asBullets(text.slice(i + HEADER.length)),
  };
}

export function normalize(t) {
  const text = fixLookalikes(String(t || "")).replace(/[‐-―−]/g, "-").replace(/\*\*/g, "").replace(/[ \t]+\n/g, "\n").trim();
  const s = sections(text);
  if (!s || !/Главное:/.test(text)) return text;
  const list = (xs) => xs.map((b) => `— ${b}`).join("\n");
  return `${s.main}\n\n${s.moments ? `${MOMENTS}\n${list(s.moments)}\n\n` : ""}${HEADER}\n${list(s.plan)}`;
}

// Общепринятые сокращения предметов: если в сводке есть полное имя, сокращение тоже своё
const ALIASES = { "black king bar": "bkb", "blink dagger": "blink", "hurricane pike": "pike", "force staff": "force", "aghanim's scepter": "aghanim aghs" };
const aliases = (s) => {
  const low = s.toLowerCase();
  return s + " " + Object.entries(ALIASES).filter(([full]) => low.includes(full)).map(([, short]) => short).join(" ");
};

// Проверка ответа по сводке: возвращает список причин отказа (пусто: годится)
export function problemsOf(text, prompt) {
  const bad = [];
  const s = sections(text);
  if (!/^Главное:/.test(text) || !s || text.length > 1800) return ["формат"];
  const main = s.main;
  const bullets = s.plan.map((b) => `— ${b}`);
  const moments = (s.moments || []).map((b) => `— ${b}`);
  const joined = [...moments, ...bullets].join(" ");
  if (bullets.length !== 3) bad.push("нужно ровно три пункта плана, каждый с «— »");
  const episodes = (prompt.match(/Ключевые моменты[^\n]*:\n((?:- [^\n]*\n?)+)/) || [])[1];
  if (episodes) {
    const times = new Set(episodes.match(/^- (\d{1,2}:\d{2})/gm).map((x) => x.slice(2)));
    const need = Math.min(2, times.size);
    if (moments.length < need || moments.length > 3) bad.push(`в «Моментах» нужно ${need === 1 ? "1 пункт" : "2 или 3 пункта"}`);
    else if (moments.some((b) => !times.has((/^— (\d{1,2}:\d{2})/.exec(b) || [])[1]))) bad.push("каждый момент должен начинаться со своего времени из сводки");
    if (moments.some((b) => b.split(/\s+/).length > 45)) bad.push("момент слишком длинный: только «Ошибка:» и «Надо было:», до 35 слов");
    if (moments.some((b) => !/Ошибка:.+Надо было:/.test(b))) bad.push("в каждом моменте нужны «Ошибка:» и «Надо было:»");
    // В моменте только герои, предметы и числа из фактов этого же момента: так нельзя приписать чужой предмет или цифру
    // Исключение: предметы из блока сборки можно советовать в «Надо было»
    const lines = new Map(episodes.split("\n").map((l) => [(/^- (\d{1,2}:\d{2})/.exec(l) || [])[1], l]));
    const build = ((prompt.match(/Сборка под эту катку:\n((?:- [^\n]*\n?)+)/) || [])[1] || "").toLowerCase();
    for (const b of moments) {
      const [, time, body] = /^— (\d{1,2}:\d{2})\s*(.*)$/.exec(b) || [];
      const line = (lines.get(time) || "").toLowerCase() + " " + aliases(build);
      const alien = [...(body || "").toLowerCase().matchAll(/[a-z][a-z'’-]{2,}/g)].map((m) => m[0]).filter((w) => !line.includes(w));
      const alienNums = ((body || "").match(/\d+/g) || []).filter((n) => !new RegExp(`(^|\\D)${n}(\\D|$)`).test(line));
      if (alien.length || alienNums.length) { bad.push(`в моменте ${time} то, чего нет в его фактах: ${[...alien, ...alienNums].join(", ")}`); break; }
    }
  }
  if (/\.\.\.|…/.test(text)) bad.push("многоточия и пропущенные слова");
  const mixed = text.match(/\S*(?:[а-яё][a-z]|[a-z][а-яё])\S*/i);
  if (mixed) bad.push(`в слове смешаны русские и латинские буквы: ${mixed[0]}`);
  const words = (s) => s.toLowerCase().match(/[a-z][a-z'’-]{2,}/g) || [];
  const have = new Set(words(aliases(prompt)));
  const foreign = words(text).filter((w) => !have.has(w));
  if (foreign.length) bad.push(`латиница не из сводки: ${[...new Set(foreign)].join(", ")}`);
  const nums = new Set(prompt.match(/\d+/g) || []);
  const extra = (text.match(/\d+/g) || []).filter((n) => !nums.has(n));
  if (extra.length) bad.push(`числа не из сводки: ${[...new Set(extra)].join(", ")}`);
  const top = (prompt.match(/Главные проблемы[^\n]*:\n- ([^\n]*)/) || [])[1] || "";
  const topNums = top.match(/\d+/g) || [];
  if (!episodes && topNums.length && !topNums.some((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(main))) bad.push("в «Главном» нет цифры из первой проблемы");
  if (/не видно, что решил/i.test(main)) bad.push("отписка в «Главном»");
  if (bullets.some((b) => /\d+:\d+/.test(b) && /куп|собер|возьми/i.test(b))) bad.push("время покупки предмета");
  const hasItems = /Сборка под эту катку:/.test(prompt);
  // покупка вардов в одном пункте не прикрывает выдуманный предмет в другом
  const buysItem = (b) => /куп|собер/i.test(b) && !/(куп|собер)\S*\s+(вард|обс|сентр)/i.test(b);
  if (!hasItems && bullets.some(buysItem)) bad.push("предметы, которых нет в сводке");
  if (/смерт|умир/i.test(prompt) && !/смерт|умир|умра|сейв|погиб|кнопк|драк/i.test(joined)) bad.push("ни один пункт не про смерти и драки");
  if ([...moments, ...bullets].some((b) => !/[.!?»)]$/.test(b))) bad.push("ответ оборван");
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
const SOFT = ["в «Главном» нет цифры из первой проблемы", "в «Главном» нет цифры или времени из сводки", "ни один пункт не про смерти и драки"];

// Сначала провайдер из COACH_PRIMARY (по умолчанию groq), второй запасной.
// Плохой ответ отдаём назад модели с перечнем ошибок (одна попытка у первого провайдера)
export async function ask(env, prompt) {
  let lastStatus = 0, fallback = "";
  const log = [];
  const providers = providersOf(env);
  for (const [n, fn] of providers.entries()) {
    let user = prompt;
    for (let attempt = 0; attempt < (n === 0 ? 3 : 1); attempt++) {
      try {
        const text = normalize(await fn(env, user));
        const bad = problemsOf(text, prompt);
        log.push(`${fn.name}: ${bad.join("; ") || "ok"}`);
        if (!bad.length) return text;
        if (!fallback && bad.length === 1 && SOFT.includes(bad[0])) fallback = text;
        user = `${prompt}

Прошлый ответ не подошёл: ${bad.includes("формат") ? "не тот формат или слишком длинно (нужно «Главное:», при моментах в сводке «Моменты:» с пунктами от их времени, и «План на следующую игру:» с тремя пунктами)" : bad.join("; ")}. Перепиши по правилам.`;
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
