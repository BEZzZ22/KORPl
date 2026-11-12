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
// подписи в витрине: коротко, пояснение одной строкой. «Выгоднее» — у месяца: до 300 разборов против 10
const SHOP_ROWS = { p10: ["10 разборов", "Не сгорают"], month: ["Месяц", "До 10 разборов в день, 30 дней"], video: ["Видеоразбор", "Ролик на минуту по одной катке"] };

// Вид — по брифу /mnt/project-files/app/widgets/design-prompt.md: тот же «тёмный минимал», что приложение (docs/v2.css).
// Своя тёмная карточка при любой теме Телеги, золото — только у главного действия и выбранного, без эмодзи и фиолетового
const EASE = "cubic-bezier(.16,1,.3,1)";
const CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.4 -apple-system,system-ui,sans-serif;color:#f4f4f5;background:#09090b;padding:16px;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.cap{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8d8d96}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.go{display:flex;align-items:center;justify-content:space-between;width:100%;height:46px;margin-top:14px;padding:0 16px;border:0;border-radius:12px;background:#e6b858;color:#121008;font:650 15px -apple-system,system-ui,sans-serif;transition:transform .4s ${EASE}}
.go:active{transform:scale(.97)}.go i{font-style:normal;font-weight:500;font-size:13px;opacity:.62}
.up{animation:up .5s ${EASE} both}@keyframes up{from{opacity:0;transform:translateY(6px)}}
.msg{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px}.msg:before{content:"";width:6px;height:6px;border-radius:50%;background:#e6b858;flex:none}`;
const JS_BASE = `var W=window.TelegramWidget,D={};function $(i){return document.getElementById(i)}
function hap(t){try{t?W.HapticFeedback.impactOccurred('light'):W.HapticFeedback.selectionChanged()}catch(e){}}`;

// ---------- карточка катки ----------

// статус ролика: [шаг 1–3, тон 0 золото / 1 готово / 2 ошибка, строка]. sent и fail ставит сам виджет до ответа бота
const MATCH_STATUS = {
  sent: [1, 0, "Принял заявку"],
  queued: [2, 0, "Собираю ролик, пришлю в чат через 5–10 минут"],
  busy: [2, 0, "Ролик по этой катке уже собирается"],
  pay: [1, 0, "Бесплатный ролик на неделе уже был, счёт в чате"],
  no_account: [1, 0, "Сначала привяжи аккаунт, как — написал в чате"],
  pick: [1, 0, "Выбери игрока в чате"],
  done: [3, 1, "Ролик в чате"],
  error: [3, 2, "Не собрался, причина в чате"],
  fail: [1, 2, "Не дошло, нажми ещё раз"],
};

export const MATCH_HTML = `<style>${CSS}
.tag{font-size:12px;font-weight:600;padding:3px 8px;border-radius:7px}.win{color:#3fcf8e;background:rgba(63,207,142,.12)}.loss{color:#f0585d;background:rgba(240,88,93,.12)}
h1{margin-top:12px;font-size:30px;font-weight:750;letter-spacing:-.04em;line-height:1.05}
.v{margin-top:6px;font-size:15px;color:#8d8d96}.v b{color:#f4f4f5;font-weight:600}
.g{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:14px}
.c{padding:10px 2px 8px;border-radius:12px;background:rgba(255,255,255,.025);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);text-align:center}
.c b{display:block;font-size:17px;font-weight:700;letter-spacing:-.02em;white-space:nowrap}.c>span{display:block;margin-top:3px;font-size:9px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#5a5a62}
.c:nth-child(2){animation-delay:40ms}.c:nth-child(3){animation-delay:80ms}.c:nth-child(4){animation-delay:.12s}
.c em{font-style:normal}.red{color:#f0585d}.dm{margin-top:10px;font-size:12px;color:#8d8d96}.dm b{color:#f4f4f5;font-weight:600}
.tr{display:none;margin-top:18px}.tr.on{display:block}
.ln{height:2px;margin:0 4px;border-radius:2px;background:rgba(255,255,255,.1)}.ln i{display:block;height:2px;width:0;border-radius:2px;background:#e6b858;transition:width .7s ${EASE}}
.st{display:flex;justify-content:space-between;margin-top:-5px}.st div{display:flex;flex-direction:column;align-items:center;gap:7px;font-size:11px;font-weight:600;color:#5a5a62}
.st div:first-child{align-items:flex-start}.st div:last-child{align-items:flex-end}.st u{width:8px;height:8px;border-radius:50%;background:#26262b;transition:background .3s}
.st .on{color:#f4f4f5}.st .on u{background:#e6b858}.ok .ln i,.ok .on u,.ok .msg:before{background:#3fcf8e}.bad .ln i,.bad .on u,.bad .msg:before{background:#f0585d}</style>
<div class="row"><div class="cap" id="meta"></div><div class="tag" id="tag"></div></div>
<h1 id="h"></h1><div class="v" id="v"></div><div class="g" id="g"></div><div class="dm" id="dm"></div>
<div class="tr" id="tr"><div class="ln"><i id="fill"></i></div><div class="st"><div id="d0"><u></u>Заявка</div><div id="d1"><u></u>Сборка</div><div id="d2"><u></u>В чате</div></div><div class="msg" id="msg"></div></div>
<button class="go" id="go"><span>Видеоразбор</span><i>ролик ~1 мин</i></button>
<script>${JS_BASE}
var S=${JSON.stringify(MATCH_STATUS)};
function n(v){v=+v||0;return v>=1000?(v/1000).toFixed(1).replace('.0','')+'k':String(v)}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
function track(k){var s=S[k];if(!s)return;$('tr').className='tr on'+(s[1]==1?' ok':s[1]==2?' bad':'');
$('fill').style.width=(s[0]-1)*50+'%';for(var i=0;i<3;i++)$('d'+i).className=i<s[0]?'on':'';$('msg').textContent=s[2];$('go').style.display=s[1]==2?'':'none'}
function render(){try{D=JSON.parse(W.chatData||'{}')||{}}catch(e){D={}}
$('meta').textContent='После катки · '+(+D.t||0)+' мин';$('tag').className='tag '+(D.w?'win':'loss');$('tag').textContent=D.w?'Победа':'Поражение';
$('h').textContent=D.h||'Катка';var m=/^([^:.]+[:.])\\s*(.*)$/.exec(D.s||'');$('v').innerHTML=m?'<b>'+esc(m[1])+'</b> '+esc(m[2]):esc(D.s);
var c=[[(+D.k||0)+'/<em'+((+D.d||0)>=8?' class="red"':'')+'>'+(+D.d||0)+'</em>/'+(+D.a||0),'KDA'],[n(D.g),'GPM'],[n(D.x),'XPM'],[n(D.l),'Добитые']],h='';
for(var i=0;i<4;i++)h+='<div class="c up"><b>'+c[i][0]+'</b><span>'+c[i][1]+'</span></div>';$('g').innerHTML=h;
$('dm').innerHTML='Урон по героям <b>'+n(D.hd)+'</b> · по строениям <b>'+n(D.td)+'</b>';if(D.v)track(D.v)}
$('go').addEventListener('click',function(){if(!D.m)return;hap(1);track('sent');W.request('vid:'+D.m).then(null,function(){track('fail')})});
W.onEvent('chatDataChanged',render);render();W.ready()</script>`;

// Одна фраза под карточкой: по KDA и итогу, без нейросети
export function matchVerdict(m) {
  const won = (m.player_slot < 128) === Boolean(m.radiant_win);
  const k = Number(m.kills) || 0, d = Number(m.deaths) || 0, a = Number(m.assists) || 0;
  const kda = (k + a) / Math.max(1, d);
  if (d >= 10) return `${d} смертей: тут и ушла игра. В разборе каждая смерть по минутам и что было не так.`;
  if (won && d <= 3) return `Чистая катка: ${["ни одной смерти", "одна смерть", "две смерти", "три смерти"][d]}. Глянь в разборе, где можно было закончить быстрее.`;
  if (!won && kda >= 3) return `Ты сделал своё (${k}/${d}/${a}), а игра всё равно ушла. Кто слил — в разборе.`;
  if (won) return "Победа. В разборе видно, что ещё подтянуть, чтобы такие катки шли чаще.";
  return "Разберём, где ушла игра: ошибки по минутам и кто слил.";
}

export function matchState(m, heroes = {}) {
  const hero = (heroes[m.hero_id] && heroes[m.hero_id][1]) || "";
  return {
    m: Number(m.match_id), h: hero || "Новая катка", w: (m.player_slot < 128) === Boolean(m.radiant_win) ? 1 : 0,
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
  const packs = SHOP_PACKS.map((id) => [id, PACKS[id].stars, PACKS[id].rub]);
  const rows = SHOP_PACKS.map((id, i) => `<div class="p${i ? "" : " on"}" id="p${i}"><u></u><div class="n"><b>${SHOP_ROWS[id][0]}</b>${id === "month" ? '<em class="x">Выгоднее</em>' : ""}<span>${SHOP_ROWS[id][1]}</span></div><div class="pr" id="r${i}"></div></div>`).join("");
  return `<style>${CSS}
.p{display:flex;align-items:center;gap:12px;margin-top:8px;padding:12px 14px;border-radius:14px;background:#111113;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);transition:box-shadow .3s ${EASE}}
.p.on{box-shadow:inset 0 0 0 1px #e6b858}.p u{flex:none;width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1.5px #5a5a62;transition:box-shadow .3s ${EASE}}.p.on u{box-shadow:inset 0 0 0 5px #e6b858}
.n{flex:1;min-width:0}.n b{font-size:15px;font-weight:650}.n span{display:block;margin-top:1px;font-size:12px;color:#8d8d96}
.x{margin-left:7px;font-style:normal;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#e6b858;vertical-align:2px}
.pr{text-align:right;font-size:16px;font-weight:650}.pr small{display:block;font-size:11px;font-weight:500;color:#8d8d96}
.sg{display:flex;margin-top:12px;padding:3px;border-radius:12px;background:#111113;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.sg div{flex:1;padding:8px;border-radius:9px;text-align:center;font-size:13px;font-weight:600;color:#8d8d96;transition:background .3s,color .3s}.sg .on{background:#f4f4f5;color:#09090b}</style>
<div class="cap">Полный разбор и видео</div>${rows}
<div class="sg"${card ? "" : ' style="display:none"'}><div class="on" id="m0">Звёзды</div><div id="m1">Карта или СБП</div></div>
<button class="go" id="go"><span>Оплатить</span><i id="gp"></i></button><div class="msg" id="msg" style="display:none"></div>
<script>${JS_BASE}
var P=${JSON.stringify(packs)},sel=0,pay=0;
function pr(p){return pay?p[2]+' ₽':p[1]+' звёзд'}
function render(){for(var i=0;i<P.length;i++){$('p'+i).className='p'+(i==sel?' on':'');$('r'+i).innerHTML=(pay?P[i][2]:P[i][1])+'<small>'+(pay?'₽':'звёзд')+'</small>'}
$('m0').className=pay?'':'on';$('m1').className=pay?'on':'';$('gp').textContent=pr(P[sel]);$('go').style.display='';$('msg').style.display='none'}
function say(t){$('msg').textContent=t;$('msg').style.display='';$('go').style.display='none'}
for(var i=0;i<P.length;i++)(function(i){$('p'+i).addEventListener('click',function(){sel=i;hap();render()})})(i);
$('m0').addEventListener('click',function(){pay=0;hap();render()});$('m1').addEventListener('click',function(){pay=1;hap();render()});
$('go').addEventListener('click',function(){hap(1);say('Отправляю счёт...');W.request('buy:'+P[sel][0]+':'+(pay?'c':'s')).then(function(){say('Счёт отправил ниже')},function(){$('go').style.display='';$('msg').textContent='Не дошло, нажми ещё раз'})});
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
