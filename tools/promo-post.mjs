// Автопостинг в Телеграм-канал через бота: берёт посты из promo/queue.json, которые пора выпускать, и отправляет.
// Что уже вышло, лежит в promo/posted.json (id -> message_id), повторно не шлётся.
// Нужны переменные: BOT_TOKEN (токен бота) и PROMO_CHAT (@канал или числовой id; бот должен быть админом канала).
// Запуск: node tools/promo-post.mjs [--dry]; --next печатает время следующего поста. Без токена или канала ничего не делает.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const QUEUE = new URL("../promo/queue.json", import.meta.url);
const POSTED = new URL("../promo/posted.json", import.meta.url);
const EMOJI = new URL("../promo/emoji.json", import.meta.url);

// Бот не умеет премиум-эмодзи и разметку: {e:ключ} -> обычный символ, теги <b>, <i> убираем
export function plain(text, emoji = {}) {
  return text.replace(/\{e:([a-z0-9_]+)\}/g, (_, k) => emoji[k]?.char ?? "").replace(/<\/?(?:b|i|u|s|code)>/g, "");
}
const CHANNEL = new URL("../promo/channel.json", import.meta.url);
const CHANNEL_STATE = new URL("../promo/channel-state.json", import.meta.url);

// Оформление канала (название, описание, аватарка) из promo/channel.json; хеш применённого лежит в channel-state.json,
// так что правка файла или картинки подхватывается сама, а без правок канал не трогаем
export function channelHash(config, photoBytes) {
  return createHash("sha256").update(JSON.stringify([config.title, config.about])).update(photoBytes || "").digest("hex").slice(0, 16);
}

async function setupChannel(token, chat) {
  if (!existsSync(CHANNEL)) return;
  const config = JSON.parse(readFileSync(CHANNEL, "utf8"));
  const photoUrl = config.photo ? new URL(`../${config.photo}`, import.meta.url) : null;
  const photo = photoUrl && existsSync(photoUrl) ? readFileSync(photoUrl) : null;
  const hash = channelHash(config, photo);
  const state = existsSync(CHANNEL_STATE) ? JSON.parse(readFileSync(CHANNEL_STATE, "utf8")) : {};
  if (state.hash === hash) return;
  const call = async (method, body) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const data = await res.json();
    if (!data.ok && !/not modified/i.test(data.description || "")) throw new Error(`${method}: ${data.description || res.status}`);
  };
  if (config.title) await call("setChatTitle", { chat_id: chat, title: config.title });
  if (config.about) await call("setChatDescription", { chat_id: chat, description: config.about });
  if (photo) {
    const form = new FormData();
    form.set("chat_id", chat);
    form.set("photo", JSON.stringify({ type: "static", photo: "attach://file" }));
    form.set("file", new Blob([photo]), "avatar.png");
    await call("setChatPhoto", form);
  }
  writeFileSync(CHANNEL_STATE, JSON.stringify({ hash }, null, 1));
  console.log("Оформление канала обновлено");
}


// Какие посты пора выпускать: время наступило, ещё не выходили, не больше max за раз (чтобы не залить канал после простоя)
export function due(queue, posted, now = Date.now(), max = 2) {
  return queue
    .filter((p) => p && p.id && p.text && !(p.id in posted) && Date.parse(p.at) <= now)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, max);
}

// Когда следующий невышедший пост (unix-секунды) или null: по нему прогон ждёт внутри себя, потому что крон GitHub запаздывает на часы
export function nextAt(queue, posted) {
  const times = queue.filter((p) => p && p.id && p.text && !(p.id in posted)).map((p) => Date.parse(p.at)).filter((t) => !Number.isNaN(t));
  return times.length ? Math.floor(Math.min(...times) / 1000) : null;
}

async function send(token, chat, post0) {
  const emoji = existsSync(EMOJI) ? JSON.parse(readFileSync(EMOJI, "utf8")) : {};
  const post = { ...post0, text: plain(post0.text, emoji) };
  const base = `https://api.telegram.org/bot${token}`;
  const markup = post.button ? { inline_keyboard: [[{ text: post.button.text, url: post.button.url }]] } : undefined;
  let res;
  if (post.photo) {
    const form = new FormData();
    form.set("chat_id", chat);
    form.set("caption", post.text.slice(0, 1024));
    if (markup) form.set("reply_markup", JSON.stringify(markup));
    form.set("photo", new Blob([readFileSync(new URL(`../${post.photo}`, import.meta.url))]), "photo.png");
    res = await fetch(`${base}/sendPhoto`, { method: "POST", body: form });
  } else {
    res = await fetch(`${base}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: post.text, disable_web_page_preview: false, ...(markup ? { reply_markup: markup } : {}) }),
    });
  }
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram: ${data.description || res.status}`);
  return data.result.message_id;
}

async function main() {
  if (process.argv.includes("--next")) {
    const posted = existsSync(POSTED) ? JSON.parse(readFileSync(POSTED, "utf8")) : {};
    console.log(nextAt(JSON.parse(readFileSync(QUEUE, "utf8")), posted) ?? "");
    return;
  }
  const dry = process.argv.includes("--dry");
  const token = process.env.BOT_TOKEN, chat = process.env.PROMO_CHAT;
  if (!dry && (!token || !chat)) { console.log("Нет BOT_TOKEN или PROMO_CHAT: постить некуда, пропускаю."); return; }
  const queue = JSON.parse(readFileSync(QUEUE, "utf8"));
  const posted = existsSync(POSTED) ? JSON.parse(readFileSync(POSTED, "utf8")) : {};
  if (!dry) await setupChannel(token, chat).catch((e) => console.log(`Оформление канала не вышло (нужно право «Изменение профиля» у бота): ${e.message}`));
  const list = due(queue, posted);
  if (!list.length) { console.log("Пока нечего постить."); return; }
  for (const post of list) {
    if (dry) { console.log(`[dry] ${post.id}: ${post.text.slice(0, 60)}…`); continue; }
    posted[post.id] = await send(token, chat, post);
    if (post.pin) await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, message_id: posted[post.id], disable_notification: true }) }).catch(() => {});
    writeFileSync(POSTED, JSON.stringify(posted, null, 1)); // сразу, чтобы упавший следующий пост не вызвал повтор этого
    console.log(`Отправлен ${post.id}, сообщение ${posted[post.id]}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
