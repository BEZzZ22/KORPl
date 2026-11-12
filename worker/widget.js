// Виджеты в чате (Bot API 10.4, 09.11.2026): живая карточка прямо в сообщении бота, как мини-приложение без открытия.
// Пока работают только в личке с ботом. Сам виджет — одна HTML-страница до 4 КБ после сжатия, без сети: всё, что
// показывает, лежит в его состоянии chat_data (до 1024 байт, строка с JSON). Нажатие в виджете — TelegramWidget.request(data),
// боту приходит апдейт widget_query, на него надо ответить answerWidgetQuery за 15 с. Новое состояние —
// editMessageWidgetData, виджет перерисуется сам (событие chatDataChanged).
//
// Две карточки:
// - катка: пуш после игры (relay.js). Герой, итог, KDA, вкладки «Итог» и «Цифры», кнопка «Видеоразбор» со статусом ролика;
// - витрина: /pay. Выбор пакета и способа оплаты, «Купить» — счёт приходит следующим сообщением.
// Старые приложения Телеги показывают вместо виджета подпись (caption), поэтому в ней весь смысл. Не принял Телеграм
// виджет вообще — шлём прежнее обычное сообщение. Выключить всё разом: переменная воркера WIDGETS = "0".
//
// Ключ wgt:<tg id>:<матч> — { m: message_id, d: состояние } карточки катки, чтобы потом дописать в неё статус ролика.
import { PACKS, invoiceParams, roboLink, robokassaOn } from "./pay.js";
import { matchButton } from "./growth.js";

export const WIDGET_TTL = 7 * 86400;
const wgtKey = (user, match) => `wgt:${user}:${match}`;
export const widgetsOn = (env) => String((env && env.WIDGETS) || "1") !== "0";
export const SHOP_PACKS = ["p10", "month", "video"];
const SHORT = { p10: "10 разборов", month: "Месяц", video: "Видеоразбор" }; // подписи на выборе пакета

// Общий вид: цвета темы Телеги, акцент оранжевый, победа зелёная, поражение красное. Без эмодзи и фиолетового
const CSS = `*{box-sizing:border-box;margin:0}body{font:14px/1.35 -apple-system,system-ui,sans-serif;color:var(--tg-theme-text-color,#e8eaed);background:transparent;padding:12px}
.m{color:var(--tg-theme-hint-color,#8a929c);font-size:12px}.r{display:flex;gap:6px;align-items:center}.c{flex:1}
.t{padding:7px 10px;border-radius:10px;background:var(--tg-theme-secondary-bg-color,#1f2730);text-align:center;font-weight:600;font-size:13px}
.t.on{background:#e8743b;color:#fff}.b{display:block;width:100%;margin-top:10px;padding:11px;border:0;border-radius:12px;background:#e8743b;color:#fff;font:600 15px system-ui,sans-serif}
.p{margin-top:10px;padding:10px;border-radius:12px;background:var(--tg-theme-secondary-bg-color,#1f2730)}.s{margin-top:6px;text-align:center}`;
const JS_BASE = `var W=window.TelegramWidget,D={};function $(i){return document.getElementById(i)}
function hap(){try{W.HapticFeedback.selectionChanged()}catch(e){}}
function ask(q,el,ok){el.textContent='Отправляю...';W.request(q).then(function(){el.textContent=ok},function(e){el.textContent=e&&(e.code==='RATE_LIMITED'||e.code==='BUSY')?'Подожди пару секунд и нажми ещё раз':'Не вышло, нажми ещё раз'})}`;

// ---------- карточка катки ----------

const MATCH_STATUS = {
  queued: "Ролик делается, пришлю в чат минут через 5–10",
  busy: "Ролик по этой катке уже делается",
  pay: "Бесплатный ролик на этой неделе уже был: счёт в чате",
  no_account: "Сначала привяжи аккаунт: как — написал в чате",
  pick: "Выбери игрока в чате",
  done: "Ролик готов, он в чате",
  error: "Ролик не собрался, причина в чате",
};

export const MATCH_HTML = `<style>${CSS}
.k{font-size:22px;font-weight:700}.w{color:#4cb36b}.l{color:#e5533d}.g{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin-top:4px}</style>
<div class="r"><div class="c"><div class="k" id="h"></div><div class="m" id="i"></div></div><div class="k" id="kda"></div></div>
<div class="r" style="margin-top:10px"><div class="t c on" id="t0">Итог</div><div class="t c" id="t1">Цифры</div></div>
<div class="p" id="p0"></div><div class="p g" id="p1" style="display:none"></div>
<button class="b" id="vb">Видеоразбор</button><div class="m s" id="vs">Ролик на минуту: главные моменты на карте, с озвучкой</div>
<script>${JS_BASE}
var S=${JSON.stringify(MATCH_STATUS)};
function n(v){v=+v||0;return v>=1000?(v/1000).toFixed(1).replace('.0','')+'k':String(v)}
function tab(i){$('t0').className='t c'+(i?'':' on');$('t1').className='t c'+(i?' on':'');$('p0').style.display=i?'none':'';$('p1').style.display=i?'':'none'}
function render(){try{D=JSON.parse(W.chatData||'{}')||{}}catch(e){D={}}
$('h').textContent=D.h||'Катка';$('i').innerHTML='<b class="'+(D.w?'w':'l')+'">'+(D.w?'Победа':'Поражение')+'</b> · '+(D.t||0)+' мин';
$('kda').textContent=(D.k||0)+'/'+(D.d||0)+'/'+(D.a||0);$('p0').textContent=D.s||'';
var r=[['Золото в минуту',D.g],['Опыт в минуту',D.x],['Добитые крипы',D.l],['Урон по героям',D.hd],['Урон по строениям',D.td]],h='';
for(var j=0;j<r.length;j++)h+='<div class="m">'+r[j][0]+'</div><div style="text-align:right;font-weight:600">'+n(r[j][1])+'</div>';
$('p1').innerHTML=h;if(D.v&&S[D.v])$('vs').textContent=S[D.v]}
$('t0').addEventListener('click',function(){hap();tab(0)});$('t1').addEventListener('click',function(){hap();tab(1)});
$('vb').addEventListener('click',function(){if(D.m)ask('vid:'+D.m,$('vs'),'Принял, смотри чат')});
W.onEvent('chatDataChanged',render);render();W.ready()</script>`;

// Одна фраза под карточкой: по KDA и итогу, без нейросети
export function matchVerdict(m) {
  const won = (m.player_slot < 128) === Boolean(m.radiant_win);
  const k = Number(m.kills) || 0, d = Number(m.deaths) || 0, a = Number(m.assists) || 0;
  const kda = (k + a) / Math.max(1, d);
  if (d >= 10) return `${d} смертей: тут и ушла игра. В разборе каждая смерть по минутам и что было не так.`;
  if (won && d <= 3) return `Чистая катка, всего ${d} смертей. Глянь в разборе, где можно было закончить быстрее.`;
  if (!won && kda >= 3) return `Ты сделал своё (${k}/${d}/${a}), а игра всё равно ушла. Кто слил — в разборе.`;
  if (won) return "Победа. В разборе видно, что ещё подтянуть, чтобы такие катки шли чаще.";
  return "Разберём, где ушла игра: ошибки по минутам и кто слил.";
}

export function matchState(m, heroes = {}) {
  const hero = (heroes[m.hero_id] && heroes[m.hero_id][1]) || "";
  return {
    m: Number(m.match_id), h: hero ? `Катка на ${hero}` : "Новая катка", w: (m.player_slot < 128) === Boolean(m.radiant_win) ? 1 : 0,
    k: Number(m.kills) || 0, d: Number(m.deaths) || 0, a: Number(m.assists) || 0, t: Math.round((Number(m.duration) || 0) / 60),
    g: Number(m.gold_per_min) || 0, x: Number(m.xp_per_min) || 0, l: Number(m.last_hits) || 0,
    hd: Number(m.hero_damage) || 0, td: Number(m.tower_damage) || 0, s: matchVerdict(m),
  };
}

// Пуш после катки виджетом. tg(method, body) -> результат Bot API или null. Не вышло — false, тогда шлют обычным текстом
export async function sendMatchWidget(env, tg, chatId, m, heroes, caption) {
  if (!widgetsOn(env)) return false;
  const state = matchState(m, heroes);
  const res = await Promise.resolve(tg("sendWidget", {
    chat_id: Number(chatId), html: MATCH_HTML, caption, chat_data: JSON.stringify(state), allow_queries: true,
    reply_markup: matchButton(m.match_id, "Разобрать катку"),
  })).catch(() => null);
  if (!res) return false;
  if (res.message_id && env.COACH_KV) await env.COACH_KV.put(wgtKey(chatId, state.m), JSON.stringify({ m: res.message_id, d: state }), { expirationTtl: WIDGET_TTL });
  return true;
}

// Статус ролика в карточке катки, если она есть: «делается», «готов», «не собрался»
export async function matchWidgetStatus(env, tg, user, match, v) {
  if (!env.COACH_KV || !MATCH_STATUS[v]) return false;
  const key = wgtKey(user, match);
  const w = await env.COACH_KV.get(key, "json").catch(() => null);
  if (!w || !w.m || !w.d) return false;
  if (w.d.v === v) return true;
  w.d.v = v;
  await env.COACH_KV.put(key, JSON.stringify(w), { expirationTtl: WIDGET_TTL });
  return Boolean(await Promise.resolve(tg("editMessageWidgetData", { chat_id: Number(user), message_id: w.m, chat_data: JSON.stringify(w.d) })).catch(() => null));
}

// ---------- витрина ----------

export function shopHtml(card) {
  const packs = SHOP_PACKS.map((id) => [id, PACKS[id].title, PACKS[id].stars, PACKS[id].rub, PACKS[id].text, SHORT[id]]);
  return `<style>${CSS}.h{font-size:17px;font-weight:700;margin-top:2px}.wr{flex-wrap:wrap}</style>
<div class="r wr" id="ps"></div><div class="p"><div class="h" id="pt"></div><div class="m" style="margin-top:4px" id="px"></div></div>
<div class="r" style="margin-top:10px${card ? "" : ";display:none"}"><div class="t c on" id="m0">Звёзды</div><div class="t c" id="m1">Карта или СБП</div></div>
<button class="b" id="bb"></button><div class="m s" id="bs">Счёт придёт следующим сообщением</div>
<script>${JS_BASE}
var P=${JSON.stringify(packs)},sel=0,pay=0;
function render(){var h='';for(var i=0;i<P.length;i++)h+='<div class="t'+(i===sel?' on':'')+'" data-i="'+i+'">'+P[i][5]+'</div>';$('ps').innerHTML=h;
var p=P[sel];$('pt').textContent=p[1];$('px').textContent=p[4];$('m0').className='t c'+(pay?'':' on');$('m1').className='t c'+(pay?' on':'');
$('bb').textContent='Купить · '+(pay?p[3]+' ₽':p[2]+' звёзд')}
$('ps').addEventListener('click',function(e){var i=e.target&&e.target.getAttribute&&e.target.getAttribute('data-i');if(i!==null&&i!==undefined&&i!==''){sel=+i;hap();render()}});
$('m0').addEventListener('click',function(){pay=0;hap();render()});$('m1').addEventListener('click',function(){pay=1;hap();render()});
$('bb').addEventListener('click',function(){ask('buy:'+P[sel][0]+':'+(pay?'c':'s'),$('bs'),'Счёт ниже в чате')});
render();W.ready()</script>`;
}

export async function sendShopWidget(env, tg, chatId, caption) {
  if (!widgetsOn(env)) return false;
  const res = await Promise.resolve(tg("sendWidget", { chat_id: Number(chatId), html: shopHtml(robokassaOn(env)), caption, allow_queries: true })).catch(() => null);
  return Boolean(res);
}

// ---------- нажатия в виджетах ----------

// Апдейт widget_query. Отвечаем сразу (Телеграм ждёт 15 с, а заявка на ролик будит GitHub и может идти дольше),
// дальше делаем дело: счёт, ролик. deps.requestVideo — из video.js (без кольцевого импорта), deps.owner — владелец ли
export async function handleWidgetQuery(env, tg, q, now = Date.now(), deps = {}) {
  if (!q || !q.id) return null;
  await Promise.resolve(tg("answerWidgetQuery", { widget_query_id: q.id })).catch(() => null);
  const from = q.from && q.from.id;
  if (!from || (q.chat && q.chat.type && q.chat.type !== "private")) return { widget: "skip" };
  const data = String(q.data || "");
  const vid = /^vid:(\d{7,11})$/.exec(data);
  if (vid && deps.requestVideo) {
    // статус в карточке дописывает сам requestVideo
    const r = await deps.requestVideo(env, tg, { user: from, match: Number(vid[1]), owner: Boolean(deps.owner) }, now);
    return { widget: "vid", ...(r || {}) };
  }
  const buy = /^buy:([a-z0-9]{1,12}):([sc])$/.exec(data);
  if (buy && SHOP_PACKS.includes(buy[1])) {
    const pack = buy[1], p = PACKS[pack];
    if (buy[2] === "c" && robokassaOn(env)) {
      const url = await roboLink(env, pack, q.from, now).catch(() => null);
      if (url) {
        await tg("sendMessage", { chat_id: from, text: `${p.title}: ${p.rub} ₽ картой или через СБП. Жми кнопку — откроется оплата Робокассы.`, reply_markup: { inline_keyboard: [[{ text: `Оплатить ${p.rub} ₽`, url }]] } });
        return { widget: "buy", pack, how: "card" };
      }
    }
    await tg("sendInvoice", { chat_id: from, ...invoiceParams(pack, String(from)) });
    return { widget: "buy", pack, how: "stars" };
  }
  return { widget: "unknown" };
}
