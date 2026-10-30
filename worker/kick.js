// Пинок загрузчику Shorts: расписание GitHub Actions на бесплатном тарифе запускается раз в 5–7 часов,
// поэтому крон воркера сам смотрит очередь и, когда ролик пора выкладывать, запускает yt.yml через workflow_dispatch.
// Токен тот же, что у kickReplays: секрет воркера GH_TOKEN (Actions: read and write). Очередь читаем с raw.githubusercontent (репо открытое).

const REPO = "BEZzZ22/KORPl";
const BRANCH = "claude/opus-55-capabilities-limits-ekkxhj";
const MIN_GAP = 5 * 3600 * 1000;       // как MIN_GAP в tools/promo_yt.py
const LOCK_TTL = 25 * 60;              // пока прогон идёт и коммитит yt_posted.json, повторно не дёргаем

export function ytDue(queue, posted, now) {
  const last = Math.max(0, ...Object.values(posted || {}).map((v) => Date.parse(v && v.at) || 0));
  if (last && now - last < MIN_GAP) return null;
  return (queue || []).find((p) => p && p.id && !(p.id in (posted || {})) && !p.retired && Date.parse(p.at) <= now) || null;
}

async function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "dotacoach",
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

async function readJson(file) {
  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${file}`, { cf: { cacheTtl: 60 } });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return r.json();
}

export async function kickShorts(env, now = Date.now()) {
  if (!env.GH_TOKEN || !env.COACH_KV) return;
  if (await env.COACH_KV.get("kick:yt")) return;
  const [queue, posted] = await Promise.all([readJson("promo/yt_queue.json"), readJson("promo/yt_posted.json")]);
  const post = ytDue(queue, posted, now);
  if (!post) return;
  const r = await gh(env, "actions/workflows/yt.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: BRANCH }) });
  if (!r.ok) throw new Error(`dispatch yt.yml: ${r.status}`);
  await env.COACH_KV.put("kick:yt", post.id, { expirationTtl: LOCK_TTL });
  console.log(`Shorts: запустил загрузку ${post.id}`);
}
