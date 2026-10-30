// Платный тренер: оплата звёздами Телеграма (XTR). Цифровое внутри Mini App Телеграм разрешает продавать только за звёзды.
// Сам разбор, карта и «Кто слил» бесплатные; платный — ИИ-тренер: разбор, чат по катке и сравнение каток.
//
// Доступ считается «единицами»: разбор тренера по матчу открывает этот матч (оба захода, fast и opus, и чат по нему),
// сравнение двух каток — отдельная единица. Откуда берётся единица, по порядку: подписка (до SUB_PER_DAY в сутки),
// бесплатные пробные (FREE_COACH на аккаунт навсегда), купленные пакеты. Владелец (OWNER_TG_IDS) не платит.
//
// Ключи: wallet:<tg id> — кошелёк { c: разборов в пакетах, until: подписка до (мс), free: потрачено пробных,
// d: день МСК, n: единиц подписки за этот день }; unl:<tg id>:<единица> — открытая единица (значение — сколько
// задано вопросов в чате); pay:<charge id> — оплата (для повторов вебхука и возврата); paid:<день>:<charge id> — для отчёта.

export const PACKS = {
  p10: { stars: 49, rub: 79, credits: 10, title: "10 разборов тренера", text: "Десять разборов ИИ-тренера с чатом по каждой катке. Не сгорают." },
  month: { stars: 129, rub: 199, days: 30, title: "Тренер на месяц", text: "30 дней ИИ-тренера: до 10 разборов в сутки, чат по каждой катке и сравнения." },
};
export const FREE_COACH = 1;
export const SUB_PER_DAY = 10;
export const CHAT_PER_UNIT = 15;   // вопросов в чате на одну открытую катку
const UNLOCK_TTL = 60 * 86400;
const DAY_MS = 86400_000;

const mskDay = (now) => new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
const walletKey = (id) => `wallet:${id}`;
const unlockKey = (id, unit) => `unl:${id}:${String(unit).slice(0, 64)}`;

export async function getWallet(env, id) {
  const w = await env.COACH_KV.get(walletKey(id), "json").catch(() => null);
  return { c: 0, until: 0, free: 0, d: "", n: 0, ...(w || {}) };
}
const putWallet = (env, id, w) => env.COACH_KV.put(walletKey(id), JSON.stringify(w));

// Что показать в приложении
export function walletView(w, now = Date.now()) {
  const sub = w.until > now;
  return {
    credits: w.c, free_left: Math.max(0, FREE_COACH - w.free), until: sub ? w.until : 0,
    sub_left: sub ? Math.max(0, SUB_PER_DAY - (w.d === mskDay(now) ? w.n : 0)) : 0,
    packs: Object.entries(PACKS).map(([id, p]) => ({ id, stars: p.stars, rub: p.rub, title: p.title, credits: p.credits || 0, days: p.days || 0 })),
  };
}

// Единица уже открыта (без списания): фоновый заход за Opus по старому разбору не должен тихо тратить разбор
export async function isOpen(env, id, unit) {
  return Boolean(await env.COACH_KV.get(unlockKey(id, unit)));
}

// Списать единицу. Вернёт { how, left, refund } или { paywall, wallet } / { limit, text }.
// Уже открытая единица не списывается повторно (второй заход за Opus, чат по той же катке)
export async function spendUnit(env, id, unit, now = Date.now()) {
  const ukey = unlockKey(id, unit);
  if (await env.COACH_KV.get(ukey)) return { how: "open", refund: async () => {} };
  const w = await getWallet(env, id);
  const day = mskDay(now);
  const before = { ...w };
  let how;
  if (w.until > now) {
    if (w.d !== day) { w.d = day; w.n = 0; }
    if (w.n >= SUB_PER_DAY) return { limit: true, text: `По подписке до ${SUB_PER_DAY} разборов в сутки. Новые после полуночи по Москве.` };
    w.n += 1; how = "sub";
  } else if (w.free < FREE_COACH) { w.free += 1; how = "free"; }
  else if (w.c > 0) { w.c -= 1; how = "credit"; }
  else return { paywall: true, wallet: walletView(w, now) };
  await putWallet(env, id, w);
  await env.COACH_KV.put(ukey, "0", { expirationTtl: UNLOCK_TTL });
  return {
    how, wallet: walletView(w, now),
    // ответ не получился — возвращаем ровно то, что списали
    refund: async () => {
      const cur = await getWallet(env, id);
      if (how === "sub" && cur.d === w.d) cur.n = Math.max(0, cur.n - 1);
      if (how === "free") cur.free = Math.max(0, cur.free - 1);
      if (how === "credit") cur.c += 1;
      await putWallet(env, id, cur);
      await env.COACH_KV.delete(ukey);
      return before;
    },
  };
}

// Вопрос в чате: катка должна быть открыта (если нет — открываем, это одна единица), дальше до CHAT_PER_UNIT вопросов
export async function spendChat(env, id, unit, now = Date.now()) {
  const ukey = unlockKey(id, unit);
  let asked = await env.COACH_KV.get(ukey);
  let opened = null;
  if (asked == null) {
    opened = await spendUnit(env, id, unit, now);
    if (!opened.refund) return opened;
    asked = "0";
  }
  const n = Number(asked) || 0;
  if (n >= CHAT_PER_UNIT) return { limit: true, text: `По одной катке до ${CHAT_PER_UNIT} вопросов. Открой другую катку.` };
  await env.COACH_KV.put(ukey, String(n + 1), { expirationTtl: UNLOCK_TTL });
  return {
    how: opened ? opened.how : "open", left: CHAT_PER_UNIT - n - 1, wallet: opened && opened.wallet,
    refund: async () => {
      if (opened) return opened.refund();
      await env.COACH_KV.put(ukey, String(n), { expirationTtl: UNLOCK_TTL });
    },
  };
}

// ---------- счёт и оплата ----------

// payload счёта: пакет и кому — проверяется в pre_checkout_query и при зачислении
const payloadOf = (pack, id) => `${pack}:${id}`;
export function parsePayload(s) {
  const m = /^([a-z0-9]{1,12}):(\d{1,20})$/.exec(String(s || ""));
  return m && PACKS[m[1]] ? { pack: m[1], id: m[2] } : null;
}

// tg(method, body) -> результат метода Bot API или null
export async function invoiceLink(tg, pack, id) {
  const p = PACKS[pack];
  if (!p) return null;
  return tg("createInvoiceLink", {
    title: p.title, description: p.text, payload: payloadOf(pack, id), provider_token: "", currency: "XTR",
    prices: [{ label: p.title, amount: p.stars }],
  });
}

// Телеграм ждёт ответа на pre_checkout_query до 10 секунд: проверяем, что пакет и сумма те же, что в счёте
export function checkout(q) {
  const p = parsePayload(q && q.invoice_payload);
  const ok = Boolean(p && q.currency === "XTR" && Number(q.total_amount) === PACKS[p.pack].stars && String(q.from && q.from.id) === p.id);
  return ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q && q.id, ok: false, error_message: "Счёт устарел. Открой оплату в приложении заново." };
}

// Зачислить пакет. Платёж (звёзды или Робокасса) может прийти повторно — второй раз ничего не добавляем
async function credit(env, id, pack, charge, rec, now) {
  if (await env.COACH_KV.get(`pay:${charge}`)) return { dup: true };
  const p = PACKS[pack];
  const w = await getWallet(env, id);
  if (p.credits) w.c += p.credits;
  if (p.days) w.until = Math.max(w.until, now) + p.days * DAY_MS;
  await putWallet(env, id, w);
  const full = { u: String(id), p: pack, t: now, ...rec };
  await env.COACH_KV.put(`pay:${charge}`, JSON.stringify(full));
  await env.COACH_KV.put(`paid:${mskDay(now)}:${charge}`, "1", { metadata: full, expirationTtl: 400 * 86400 });
  return { pack, wallet: walletView(w, now) };
}

export async function grant(env, msg, now = Date.now()) {
  const sp = msg && msg.successful_payment;
  const p = sp && parsePayload(sp.invoice_payload);
  if (!p || sp.currency !== "XTR") return null;
  return credit(env, String(msg.from.id), p.pack, sp.telegram_payment_charge_id,
    { s: sp.total_amount, n: msg.from.first_name || "", un: msg.from.username || "" }, now);
}

// ---------- карты и СБП через Робокассу (только на сайте, вне Телеграма: внутри — только звёзды) ----------
// Человек входит на сайте через Telegram Login Widget, воркер выдаёт ссылку на оплату, Робокасса стучится в
// /robokassa (Result URL) с подписью паролем 2. Чек самозанятого в «Мой налог» пробивают «Робочеки СМЗ»

const md5hex = async (s) => {
  // в Workers MD5 есть в crypto.subtle (нестандартно), в Node — через node:crypto
  if (globalThis.crypto && crypto.subtle) {
    try { return [...new Uint8Array(await crypto.subtle.digest("MD5", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join(""); } catch { /* Node */ }
  }
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(s).digest("hex");
};

// Вход через Telegram Login Widget: секрет — SHA-256 от токена бота (не как у Mini App)
export async function loginUser(data, botToken, now = Date.now()) {
  if (!data || typeof data !== "object" || !data.hash || !botToken) return null;
  const check = Object.keys(data).filter((k) => k !== "hash" && data[k] != null).sort().map((k) => `${k}=${data[k]}`).join("\n");
  const enc = new TextEncoder();
  const secret = await crypto.subtle.digest("SHA-256", enc.encode(botToken));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sign = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(check)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (sign !== String(data.hash)) return null;
  if (now / 1000 - Number(data.auth_date || 0) > 7 * 86400) return null;
  return { id: Number(data.id), first_name: data.first_name || "", username: data.username || "" };
}

// Ссылка на оплату картой из бота: вход уже выполнен — подписанный токен на сутки (id, срок, имя)
const PAY_PAGE = "https://bezzz22.github.io/KORPl/pay.html";
const TOKEN_TTL = 86400;
async function tokenSign(botToken, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(`paylink:${botToken}`)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
export async function payUrl(botToken, user, now = Date.now()) {
  const body = [user.id, Math.floor(now / 1000) + TOKEN_TTL, encodeURIComponent(String(user.first_name || "").slice(0, 32)), encodeURIComponent(String(user.username || "").slice(0, 32))].join(".");
  return `${PAY_PAGE}#t=${body}.${await tokenSign(botToken, body)}`;
}
export async function tokenUser(token, botToken, now = Date.now()) {
  const m = /^(\d{1,20})\.(\d{1,12})\.([^.]{0,200})\.([^.]{0,200})\.([0-9a-f]{32})$/.exec(String(token || ""));
  if (!m || !botToken || Number(m[2]) < now / 1000) return null;
  if (await tokenSign(botToken, `${m[1]}.${m[2]}.${m[3]}.${m[4]}`) !== m[5]) return null;
  try { return { id: Number(m[1]), first_name: decodeURIComponent(m[3]), username: decodeURIComponent(m[4]) }; } catch { return null; }
}

export const robokassaOn = (env) => Boolean(env.ROBOKASSA_LOGIN && env.ROBOKASSA_PASS1 && env.ROBOKASSA_PASS2);

export async function roboLink(env, pack, user, now = Date.now()) {
  const p = PACKS[pack];
  if (!p || !robokassaOn(env)) return null;
  // InvId — int32. Два счёта в одну секунду с одним хвостом перетёрли бы заказ: оплата ушла бы не тому
  let inv;
  for (let i = 0; i < 5; i++) {
    inv = Number(`${Math.floor(now / 1000)}${Math.floor(Math.random() * 90 + 10)}`) % 2147483647;
    if (!(await env.COACH_KV.get(`robo:${inv}`))) break;
  }
  // СБП и банк иногда подтверждают оплату через сутки и позже: заказ храним с запасом
  await env.COACH_KV.put(`robo:${inv}`, JSON.stringify({ u: String(user.id), p: pack, n: user.first_name, un: user.username }), { expirationTtl: 30 * 86400 });
  const sum = p.rub.toFixed(2);
  // чек для «Робочеков СМЗ»: одна позиция, без НДС
  const receipt = encodeURIComponent(JSON.stringify({ items: [{ name: p.title, quantity: 1, sum: p.rub, tax: "none" }] }));
  const sig = await md5hex(`${env.ROBOKASSA_LOGIN}:${sum}:${inv}:${receipt}:${env.ROBOKASSA_PASS1}`);
  const q = new URLSearchParams({ MerchantLogin: env.ROBOKASSA_LOGIN, OutSum: sum, InvId: String(inv), Description: p.title, Receipt: receipt, SignatureValue: sig, Culture: "ru" });
  if (env.ROBOKASSA_TEST === "1") q.set("IsTest", "1");
  return `https://auth.robokassa.ru/Merchant/Index.aspx?${q}`;
}

// Result URL: подпись OutSum:InvId:Пароль2. Ответ «OK<InvId>» — иначе Робокасса будет повторять
export async function roboResult(env, form, now = Date.now()) {
  const sum = String(form.get("OutSum") || ""), inv = String(form.get("InvId") || "");
  const sig = String(form.get("SignatureValue") || "").toLowerCase();
  if (!robokassaOn(env) || !sum || !/^\d{1,10}$/.test(inv)) return null;
  if (sig !== await md5hex(`${sum}:${inv}:${env.ROBOKASSA_PASS2}`)) return null;
  const order = await env.COACH_KV.get(`robo:${inv}`, "json");
  // подпись верна, а заказа нет или сумма не та: деньги уже списаны — не молчим, а зовём владельца разобраться руками.
  // Ответ OK, иначе Робокасса будет повторять, а владельцу прилетит по сообщению на каждый повтор
  if (!order || !PACKS[order.p] || Math.abs(Number(sum) - PACKS[order.p].rub) > 0.009) return { ok: `OK${inv}`, orphan: { inv, sum, order } };
  const got = await credit(env, order.u, order.p, `rk${inv}`, { r: Number(sum), n: order.n || "", un: order.un || "" }, now);
  return { ok: `OK${inv}`, user: order.u, ...got };
}

export function thanksText(pack, view) {
  const p = PACKS[pack];
  if (p.days) return `Оплата прошла, спасибо! Тренер открыт до ${new Date(view.until + 3 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join(".")}. Возвращайся в приложение и разбирай катки.`;
  return `Оплата прошла, спасибо! Разборов тренера на счету: ${view.credits}. Возвращайся в приложение и разбирай катки.`;
}

// Возврат звёзд (команда владельца «/refund <charge id>»): снимаем то, что дали, сколько осталось
export async function refund(env, tg, charge, now = Date.now()) {
  const rec = await env.COACH_KV.get(`pay:${charge}`, "json");
  if (!rec) return "Такой оплаты нет.";
  if (rec.refunded) return "Уже возвращено.";
  // оплата картой: деньги возвращаются в кабинете Робокассы, здесь только снимаем пакет
  const card = charge.startsWith("rk");
  if (!card && !(await tg("refundStarPayment", { user_id: Number(rec.u), telegram_payment_charge_id: charge }))) return "Телеграм не принял возврат.";
  const pack = PACKS[rec.p];
  const w = await getWallet(env, rec.u);
  if (pack.credits) w.c = Math.max(0, w.c - pack.credits);
  if (pack.days) w.until -= pack.days * DAY_MS;
  await putWallet(env, rec.u, w);
  await env.COACH_KV.put(`pay:${charge}`, JSON.stringify({ ...rec, refunded: now }));
  return card ? `Пакет снят. Деньги (${rec.r} ₽) верни в кабинете Робокассы, счёт ${charge.slice(2)}.` : `Вернул ${rec.s} звёзд.`;
}

export const PAYSUPPORT_TEXT = "По оплате пиши сюда же, в этот чат, одним сообщением: что купил и что не так. Ответим в течение суток. "
  + "Если тренер так и не открылся после оплаты, звёзды вернём.";
export const TERMS_TEXT = "Платный только ИИ-тренер: разбор катки, чат и сравнение. Разбор матча, карта и «Кто слил» бесплатные. "
  + "Пакеты разборов не сгорают, подписка действует 30 дней с момента оплаты. Оплата звёздами Телеграма. "
  + "Если тренер не ответил, разбор не списывается. Полные условия: https://bezzz22.github.io/KORPl/terms.html";
