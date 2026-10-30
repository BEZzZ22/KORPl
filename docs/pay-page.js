// Оплата тренера картой или СБП (Робокасса) на сайте. Внутри Телеграма платят звёздами — там сторонние платёжки запрещены.
// Вход: Telegram Login Widget в режиме перехода (data-auth-url) — данные входа приходят в адресе этой страницы,
// воркер проверяет подпись токеном бота. После оплаты Робокасса возвращает сюда GET-ом: на Success URL с InvId и
// SignatureValue, на Fail URL — с InvId без подписи (параметры в самих URL она не принимает).
(() => {
  const WORKER = "https://dotacoach.2007rggg.workers.dev";
  const BOT = "DotaRazbor_bot";
  const KEY = "pay_login";
  const $ = (id) => document.getElementById(id);
  const store = {
    get() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; } },
    set(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* приватный режим */ } },
  };
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };
  const post = async (body) => {
    const res = await fetch(WORKER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Сервер не ответил. Попробуй ещё раз.");
    return data;
  };

  // данные входа из адреса (после виджета) → в sessionStorage, адрес чистим
  const q = new URLSearchParams(location.search);
  if (q.get("hash") && q.get("id")) {
    const login = {};
    for (const k of ["id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash"]) if (q.get(k) != null) login[k] = q.get(k);
    store.set(login);
  }
  // ссылка из бота: #t=<подписанный токен>, вход уже выполнен
  const tok = /^#t=([\w.%-]+)$/.exec(location.hash);
  if (tok) {
    const parts = tok[1].split(".");
    let name = "", username = "";
    try { name = decodeURIComponent(parts[2] || ""); username = decodeURIComponent(parts[3] || ""); } catch { /* */ }
    store.set({ token: tok[1], first_name: name, username });
    history.replaceState(null, "", location.pathname + location.search);
  }
  const robo = q.has("InvId") ? (q.has("SignatureValue") ? "ok" : "fail") : "";
  const result = q.get("ok") ? "ok" : q.get("fail") ? "fail" : robo;
  if (q.toString()) history.replaceState(null, "", location.pathname + location.hash);

  const saved = store.get();
  const auth = saved && saved.token ? { token: saved.token } : { login: saved };
  const login = saved;
  if (!login) {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.dataset.telegramLogin = BOT;
    s.dataset.size = "large";
    s.dataset.radius = "12";
    s.dataset.authUrl = location.origin + location.pathname;
    s.dataset.requestAccess = "write";
    $("login").append(s);
    return;
  }

  $("step-login").hidden = true;
  $("step-pay").hidden = false;
  const status = $("status");
  if (result === "ok") { status.className = "status ok"; status.textContent = "Оплата прошла. Разборы на счету — возвращайся в бота, бот тоже напишет."; }
  if (result === "fail") { status.className = "status bad"; status.textContent = "Оплата не прошла, деньги не списаны. Можно попробовать ещё раз."; }

  const show = (w) => {
    if (!w || !Array.isArray(w.packs)) { status.className = "status"; status.textContent = "Оплата сейчас выключена: тренер бесплатный, открывай бота."; return; }
    $("who").textContent = `Аккаунт: ${login.first_name || ""}${login.username ? ` (@${login.username})` : ""}`;
    $("balance").textContent = w.until ? `Подписка до ${new Date(w.until + 3 * 3600e3).toISOString().slice(0, 10).split("-").reverse().join(".")}.`
      : w.credits ? `На счету ${w.credits} ${plural(w.credits, "разбор", "разбора", "разборов")} тренера.`
        : w.free_left ? "Есть бесплатный разбор — попробуй его в боте." : "Бесплатный разбор уже использован.";
    $("packs").replaceChildren(...w.packs.map((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `pack${p.days ? " best" : ""}`;
      const title = document.createElement("span");
      title.textContent = p.days ? "Месяц тренера" : `${p.credits} ${plural(p.credits, "разбор", "разбора", "разборов")}`;
      const sub = document.createElement("small");
      sub.textContent = p.days ? "до 10 разборов в сутки" : "не сгорают";
      const price = document.createElement("b");
      price.textContent = `${p.rub} ₽`;
      b.append(title, sub, price);
      b.disabled = !w.cards;
      b.onclick = async () => {
        b.disabled = true;
        status.className = "status";
        status.textContent = "Открываю оплату…";
        try { location.href = (await post({ mode: "web_buy", pack: p.id, ...auth })).url; }
        catch (e) { b.disabled = false; status.className = "status bad"; status.textContent = e.message; }
      };
      return b;
    }));
    if (!w.cards && !result) { status.className = "status"; status.textContent = "Оплата картой скоро заработает. Пока можно платить звёздами в боте."; }
  };

  post({ mode: "web_wallet", ...auth }).then(show).catch((e) => {
    status.className = "status bad";
    status.textContent = e.message;
    // вход устарел (ссылка из бота живёт сутки): забываем его и показываем кнопку входа заново
    if (/Войди/.test(e.message)) {
      try { sessionStorage.removeItem(KEY); } catch { /* */ }
      status.textContent = "Вход устарел — сейчас покажу кнопку входа через Телеграм.";
      setTimeout(() => location.reload(), 1500);
    }
  });
})();
