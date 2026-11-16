// Сторож фона: выгрузка OpenDota, разбор реплеев и видеоразбор живут в GitHub Actions, и если они встают,
// никто не узнаёт: пуши и «реплей разобран» просто перестают приходить. Крон воркера смотрит, не висит ли что-то
// дольше нормы, и пишет владельцу (OWNER_TG_IDS): один раз, когда встало, напоминание раз в ALERT_AGAIN и
// «заработало», когда очередь снова пошла. Состояние — ключи wd:<что> со значением { since, told }.

export const WD_PREFIX = "wd:";
export const ALERT_AGAIN = 6 * 3600_000;
export const LIMITS = {
  relay: 30 * 60_000,    // выгрузка спрашивает раз в 20 с, воркер перезапускает её через 1,5 мин тишины
  replays: 90 * 60_000,  // заявку на реплей workflow берёт за минуты, воркер пинает его раз в 15 мин
  video: 60 * 60_000,    // ролик собирается 5–15 мин
};
const NAMES = { relay: "Выгрузка OpenDota", replays: "Разбор реплеев", video: "Видеоразбор" };

const mins = (ms) => {
  const m = Math.round(ms / 60_000);
  return m < 120 ? `${m} мин` : `${Math.round(m / 60)} ч`;
};

// Что сейчас висит. probe: relaySeen — когда выгрузка последний раз спрашивала (0 — ключа нет больше суток);
// replays / video — { oldest: время самой старой заявки, n: сколько их } или null, если очередь пуста
export function problems(probe, now) {
  const out = [];
  if (probe.relay !== undefined) {
    const age = probe.relay ? now - probe.relay : Infinity;
    if (age >= LIMITS.relay) out.push({ id: "relay", text: `${NAMES.relay} молчит ${probe.relay ? mins(age) : "больше суток"}: пуши после катки, «реплей разобран» и сводка недели не уходят. Смотри Actions → «Выгрузка OpenDota».` });
  }
  for (const id of ["replays", "video"]) {
    const q = probe[id];
    if (!q || !q.n) continue;
    const age = now - q.oldest;
    if (age >= LIMITS[id]) out.push({ id, text: `${NAMES[id]}: заявка висит ${mins(age)}, в очереди ${q.n}. Смотри Actions → «${NAMES[id]}».` });
  }
  return out;
}

export async function watchdog(env, tg, probe, now = Date.now()) {
  const kv = env.COACH_KV;
  const owners = String(env.OWNER_TG_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!kv || !owners.length) return [];
  const say = async (text) => { for (const id of owners) await tg("sendMessage", { chat_id: id, text }).catch(() => false); };
  const found = problems(probe, now);
  const sent = [];
  for (const id of Object.keys(LIMITS)) {
    if (probe[id] === undefined) continue; // эту часть в этот раз не проверяли
    const p = found.find((x) => x.id === id);
    const st = await kv.get(WD_PREFIX + id, "json").catch(() => null);
    if (p) {
      if (st && now - st.told < ALERT_AGAIN) continue;
      await kv.put(WD_PREFIX + id, JSON.stringify({ since: st ? st.since : now, told: now }), { expirationTtl: 7 * 86400 });
      await say(`${st ? "Всё ещё не работает. " : ""}${p.text}`);
      sent.push(id);
    } else if (st) {
      await kv.delete(WD_PREFIX + id);
      await say(`${NAMES[id]} снова работает (простой около ${mins(now - st.since + LIMITS[id])}).`);
      sent.push(`${id}:ok`);
    }
  }
  return sent;
}
