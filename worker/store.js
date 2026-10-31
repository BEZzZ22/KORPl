// Хранилище воркера с интерфейсом KV поверх D1.
// Бесплатный KV даёт 1000 записей и 1000 list в сутки на всё: счётчики, профили, подписки и очередь реплеев
// упираются в лимит уже при паре десятков активных юзеров. Бесплатная D1 даёт 100 000 записей в сутки.
// Код воркера не меняется: он ходит в env.COACH_KV, а здесь ключи разводятся — большие и редкие
// (карточки, кэш тренера) остаются в KV, остальное идёт в D1.
//
// Переезд без простоя: пока старые ключи не скопированы, чтение, не нашедшее ключ в D1, смотрит в KV
// и переносит найденное, удаление стирает в обоих местах, а крон понемногу копирует остальное (migrateStep).

const SCHEMA = "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v BLOB, meta TEXT, exp INTEGER)";
const KV_ONLY = /^(card:|coach:)/;          // остаются в KV
const MONEY = /^(wallet:|pay:|paid:|robo:|unl:)/; // кошельки и оплаты: без запасного пути в KV
const SKIP_COPY = /^(card:|coach:|hint:|ban:)/; // не переносим: живут в KV или своё отживут за часы
const MIG_CURSOR = "_mig:cursor", MIG_DONE = "_mig:done";
const MIG_BATCH = 20;                        // ключей за прогон крона: D1 на бесплатном плане — 50 запросов на вызов
const DONE_RECHECK = 60_000;
const COPY_TTL = 120 * 86400_000;           // срок ключа KV при чтении не узнать: берём самый долгий из наших (счётчики)

const ready = new WeakMap();   // db -> промис создания таблицы (раз на изолят)
const done = new WeakMap();    // db -> { done, t }: закончен ли перенос из KV

function init(db) {
  if (!ready.has(db)) ready.set(db, db.prepare(SCHEMA).run().catch((e) => { ready.delete(db); throw e; }));
  return ready.get(db);
}

const expOf = (opts, now) => (opts && opts.expirationTtl ? now + Number(opts.expirationTtl) * 1000
  : opts && opts.expiration ? Number(opts.expiration) * 1000 : null);

// D1 отдаёт BLOB массивом чисел или ArrayBuffer — приводим к тому, что вернул бы KV
function decode(v, type) {
  if (v == null) return null;
  const bytes = Array.isArray(v) ? Uint8Array.from(v) : v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null;
  if (type === "arrayBuffer") return bytes ? bytes.slice().buffer : new TextEncoder().encode(String(v)).buffer;
  const text = bytes ? new TextDecoder().decode(bytes) : String(v);
  return type === "json" ? JSON.parse(text) : text;
}
const encode = (v) => (typeof v === "string" ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : String(v));
const parseMeta = (m) => { if (m == null) return null; try { return JSON.parse(m); } catch { return null; } };

async function migrated(db, now) {
  const st = done.get(db);
  if (st && (st.done || now - st.t < DONE_RECHECK)) return st.done;
  await init(db);
  const row = await db.prepare("SELECT v FROM kv WHERE k = ?").bind(MIG_DONE).first();
  const ok = Boolean(row);
  done.set(db, { done: ok, t: now });
  return ok;
}

// KV-совместимый интерфейс над таблицей kv. kv — старый KV для переезда (может не быть)
export function d1kv(db, kv = null, clock = () => Date.now()) {
  const fallback = async () => kv && !(await migrated(db, clock()));
  const row = async (k) => {
    await init(db);
    return db.prepare("SELECT v, meta FROM kv WHERE k = ? AND (exp IS NULL OR exp > ?)").bind(k, clock()).first();
  };
  // ключ ещё в KV: отдаём и переносим, не перетирая то, что уже успели записать в D1
  const fromKV = async (k) => {
    if (SKIP_COPY.test(k) || !(await fallback())) return null;
    const got = await kv.getWithMetadata(k, "text");
    if (!got || got.value == null) return null;
    await db.prepare("INSERT OR IGNORE INTO kv (k, v, meta, exp) VALUES (?, ?, ?, ?)")
      // деньги и оплаты в KV бессрочные: со сроком копии кошелёк с купленными разборами пропал бы через 120 дней
      .bind(k, got.value, got.metadata == null ? null : JSON.stringify(got.metadata), MONEY.test(k) ? null : clock() + COPY_TTL).run();
    return { v: got.value, meta: got.metadata == null ? null : JSON.stringify(got.metadata) };
  };
  const store = {
    async get(k, type) {
      const r = (await row(k)) || (await fromKV(k));
      return r ? decode(r.v, typeof type === "object" ? type && type.type : type) : null;
    },
    async getWithMetadata(k, type) {
      const r = (await row(k)) || (await fromKV(k));
      return r ? { value: decode(r.v, typeof type === "object" ? type && type.type : type), metadata: parseMeta(r.meta) } : { value: null, metadata: null };
    },
    async put(k, v, opts = {}) {
      await init(db);
      const now = clock();
      await db.prepare("INSERT OR REPLACE INTO kv (k, v, meta, exp) VALUES (?, ?, ?, ?)")
        .bind(k, encode(v), opts.metadata == null ? null : JSON.stringify(opts.metadata), expOf(opts, now)).run();
    },
    // Сравнить и записать: v меняется, только если сейчас там expected (null — ключа нет). Для кошельков: два запроса
    // («списать разбор» и «зачислить оплату») читали одно и то же и последний затирал первого
    async cas(k, expected, next) {
      await init(db);
      const now = clock();
      const res = expected == null
        ? await db.prepare("INSERT INTO kv (k, v, meta, exp) VALUES (?, ?, NULL, NULL) ON CONFLICT(k) DO UPDATE SET v = excluded.v, meta = NULL, exp = NULL WHERE kv.exp IS NOT NULL AND kv.exp <= ?").bind(k, encode(next), now).run()
        : await db.prepare("UPDATE kv SET v = ?, meta = NULL, exp = NULL WHERE k = ? AND CAST(v AS TEXT) = ? AND (exp IS NULL OR exp > ?)").bind(encode(next), k, String(expected), now).run();
      return Boolean(res && res.meta && res.meta.changes);
    },
    async delete(k) {
      await init(db);
      await db.prepare("DELETE FROM kv WHERE k = ?").bind(k).run();
      if (await fallback()) await kv.delete(k);
    },
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      await init(db);
      const now = clock();
      const n = Math.min(Math.max(Number(limit) || 1000, 1), 1000);
      const { results } = await db.prepare("SELECT k, meta FROM kv WHERE k >= ? AND k < ? AND k > ? AND (exp IS NULL OR exp > ?) ORDER BY k LIMIT ?")
        .bind(prefix, `${prefix}￿`, cursor || "", now, n + 1).all();
      const rows = results || [];
      const keys = rows.slice(0, n).map((r) => ({ name: r.k, metadata: parseMeta(r.meta) }));
      const more = rows.length > n;
      // до конца переезда дописываем ключи, которые ещё лежат только в KV
      if (!cursor && !more && !SKIP_COPY.test(prefix) && (await fallback())) {
        const have = new Set(keys.map((x) => x.name));
        let c;
        for (let i = 0; i < 20; i++) {
          const page = await kv.list({ prefix, cursor: c });
          for (const x of page.keys) if (!have.has(x.name) && !SKIP_COPY.test(x.name)) keys.push({ name: x.name, metadata: x.metadata ?? null });
          if (page.list_complete || !page.cursor) break;
          c = page.cursor;
        }
        keys.sort((a, b) => (a.name < b.name ? -1 : 1));
      }
      return more ? { keys, list_complete: false, cursor: keys[keys.length - 1].name } : { keys, list_complete: true };
    },
  };
  return store;
}

// env с COACH_KV, который разводит ключи между KV и D1. Без D1 (база не создалась) — всё как было, в KV
export function withStore(env) {
  if (!env || !env.DB || !env.COACH_KV || env.COACH_KV.routed) return env;
  const kv = env.COACH_KV, d1 = d1kv(env.DB, kv);
  // D1 не ответила — делаем то же в KV: лучше старое хранилище, чем упавший запрос у юзера.
  // Кроме денег: оплата, записанная в KV, пропала бы, когда D1 вернётся (читаем-то её). Там — ошибка:
  // вебхук ответит 500 и Телеграм пришлёт оплату снова, тренер скажет «недоступен», а не спишет мимо
  const call = (k, op, ...args) => {
    if (KV_ONLY.test(String(k))) return kv[op](...args);
    return d1[op](...args).catch((e) => {
      if (MONEY.test(String(k))) throw e;
      console.log(`D1 ${op} ${String(k).split(":")[0]}: ${e && e.message || e}, беру KV`);
      return kv[op](...args);
    });
  };
  return {
    ...env,
    KV_RAW: kv,
    COACH_KV: {
      routed: true,
      get: (k, t) => call(k, "get", k, t),
      getWithMetadata: (k, t) => call(k, "getWithMetadata", k, t),
      put: (k, v, o) => call(k, "put", k, v, o),
      delete: (k) => call(k, "delete", k),
      list: (o = {}) => call(o.prefix || "", "list", o),
      // только в D1 и без запасного пути: это деньги
      cas: (k, expected, next) => d1.cas(k, expected, next),
    },
  };
}

// Крон: копируем из KV следующую пачку ключей. Уже записанное в D1 не трогаем (оно свежее)
export async function migrateStep(env, now = Date.now()) {
  if (!env.DB || !(env.KV_RAW || env.COACH_KV)) return null;
  const db = env.DB, kv = env.KV_RAW || env.COACH_KV;
  if (await migrated(db, now)) return { done: true };
  const cur = await db.prepare("SELECT v FROM kv WHERE k = ?").bind(MIG_CURSOR).first();
  const page = await kv.list({ cursor: cur ? String(cur.v) : undefined, limit: MIG_BATCH });
  const stmts = [];
  for (const x of page.keys) {
    if (SKIP_COPY.test(x.name)) continue;
    const got = await kv.getWithMetadata(x.name, "text");
    if (!got || got.value == null) continue;
    stmts.push(db.prepare("INSERT OR IGNORE INTO kv (k, v, meta, exp) VALUES (?, ?, ?, ?)")
      .bind(x.name, got.value, got.metadata == null ? null : JSON.stringify(got.metadata), x.expiration ? x.expiration * 1000 : null));
  }
  const finished = page.list_complete || !page.cursor;
  stmts.push(finished
    ? db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(MIG_DONE, String(now))
    : db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(MIG_CURSOR, page.cursor));
  await db.batch(stmts);
  if (finished) done.set(db, { done: true, t: now });
  return { done: finished, copied: stmts.length - 1 };
}

// Раз в час чистим просроченное: D1 сама не удаляет строки по сроку, как KV
export async function purgeExpired(env, now = Date.now()) {
  if (!env.DB) return 0;
  await init(env.DB);
  const res = await env.DB.prepare("DELETE FROM kv WHERE exp IS NOT NULL AND exp <= ?").bind(now).run();
  return (res && res.meta && res.meta.changes) || 0;
}
