// Cloudflare Worker: прокси между приложением и Gemini. Ключ лежит в секрете GEMINI_API_KEY и в приложение не попадает.
// Деплой: dashboard.cloudflare.com -> Workers & Pages -> Create -> Hello World -> Edit code -> вставить этот файл,
// затем Settings -> Variables and Secrets -> добавить секрет GEMINI_API_KEY. Модель можно сменить переменной GEMINI_MODEL.

const ALLOWED_ORIGINS = ["https://bezzz22.github.io"];
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const MAX_BODY = 6000;         // байт: сюда влезает вся сводка разбора
const PER_IP_PER_HOUR = 6;     // мягкий лимит на человека (память воркера, сбрасывается при перезапуске)
const GLOBAL_PER_DAY = 400;    // не даём выжечь бесплатный лимит ключа одному энтузиасту

const hits = new Map();
let day = { key: "", count: 0 };

const SYSTEM = `Ты тренер по Dota 2. Игрок прислал сводку своего разбора матча: проблемы, мелочи, совет по сборке, драфт.
Напиши коротко и по-дружески, на «ты», с доташным сленгом, без смайликов и без воды.
Формат строго такой:
Главное: одно-два предложения, что на самом деле решило эту катку.
План на следующую игру: ровно три пункта, каждый с новой строки через «—», по одному действию на пункт.
Правила: опирайся только на данные из сводки, не выдумывай числа, героев, предметы и события. Если данных мало, так и скажи. Не больше 110 слов.`;

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

function throttle(ip, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (day.key !== today) day = { key: today, count: 0 };
  if (day.count >= GLOBAL_PER_DAY) return "Тренер на сегодня устал, попробуй завтра.";
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= PER_IP_PER_HOUR) return "Слишком часто. Подожди немного.";
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  day.count += 1;
  return null;
}

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Сводка собирается заново из проверенных полей: лишнего в промпт не попадёт
export function buildPrompt(raw) {
  const lines = [];
  lines.push(`Герой: ${clip(raw.hero, 40)}. Роль: ${clip(raw.role, 40)}. Ранг: ${clip(raw.rank, 30) || "неизвестен"}.`);
  lines.push(`Итог: ${raw.won ? "победа" : "поражение"}, KDA ${clip(raw.kda, 20)}, длительность ${clip(raw.duration, 12)}.`);
  const list = (title, arr, n, each) => {
    const rows = (Array.isArray(arr) ? arr : []).slice(0, n).map(each).filter(Boolean);
    if (rows.length) lines.push(`${title}:\n${rows.map((r) => `- ${r}`).join("\n")}`);
  };
  list("Главные проблемы", raw.problems, 3, (p) => `${clip(p?.title, 80)}: ${clip(p?.fact, 200)}`);
  list("Мелочи", raw.micro, 4, (t) => clip(t, 200));
  list("Сборка под эту катку", raw.plan, 3, (p) => `${clip(p?.item, 40)}: ${clip(p?.why, 160)}`);
  list("Драфт", raw.draft, 2, (t) => clip(t, 200));
  return lines.join("\n");
}

async function askGemini(env, prompt) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 400 },
    }),
  });
  if (!res.ok) {
    const err = new Error(`gemini ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("empty answer");
  return text;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return reply(405, { error: "Только POST." }, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return reply(403, { error: "Нельзя." }, origin);
    if (!env.GEMINI_API_KEY) return reply(500, { error: "Тренер ещё не настроен." }, origin);

    const text = await request.text();
    if (text.length > MAX_BODY) return reply(413, { error: "Слишком большая сводка." }, origin);
    let raw;
    try { raw = JSON.parse(text); } catch { return reply(400, { error: "Не понял сводку." }, origin); }
    if (!raw || typeof raw !== "object" || !raw.hero) return reply(400, { error: "Не понял сводку." }, origin);

    const limited = throttle(request.headers.get("CF-Connecting-IP") || "anon", Date.now());
    if (limited) return reply(429, { error: limited }, origin);

    try {
      return reply(200, { text: await askGemini(env, buildPrompt(raw)) }, origin);
    } catch (e) {
      const busy = e.status === 429 || e.status === 503;
      return reply(502, { error: busy ? "Тренер перегружен, попробуй через минуту." : "Тренер сейчас недоступен." }, origin);
    }
  },
};
