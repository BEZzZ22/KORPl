// Знак приложения — Аегис чемпионов с 3D-модели «Aegis of champions» (Sketchfab, автор msta2219, CC BY 4.0).
// На главной: 48 кадров по кругу (tools/capture_aegis.mjs, tools/pack_aegis.py) на холсте с плавным переходом между кадрами.
// Щит покачивается и раз в 12 с делает оборот. Пальцем крутится с инерцией, двойной тап — «поднял Аегис»,
// долгое нажатие — показать оборот, наклон телефона поворачивает щит. Тап открывает витрину с живой моделью.

const UID = "be25c575619641c2a562cbbc7727da76";
const MODEL_URL = "https://sketchfab.com/3d-models/aegis-of-champions-be25c575619641c2a562cbbc7727da76";
const API_URL = "https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js";
const FRAMES = 48, COLS = 8, FRAME = 360, STEP = 360 / FRAMES;
const SHEET = "img/aegis_spin.webp?v=1", STILL = "img/aegis_still.webp?v=1";
// Камера витрины из калибровки tools/capture_aegis.mjs: центр щита, угол анфаса, расстояние на 86% кадра
const CAM = { target: [-1.753, 6.539, 50.627], radius: 152.27, front: 4.5664, elev: 8 };
const ENV_ROTATION = 2.5403;
const LIGHTS = {
  studio: { exposure: 0.8, lightIntensity: 4, rotation: ENV_ROTATION },
  gold: { exposure: 1.05, lightIntensity: 6, rotation: ENV_ROTATION + 1.1 },
  night: { exposure: 0.42, lightIntensity: 2.2, rotation: ENV_ROTATION + 2.6 },
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

let sheet = null;
function loadSheet() {
  if (!sheet) {
    sheet = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { sheet = null; reject(new Error("нет раскадровки")); };
      img.src = SHEET;
    });
  }
  return sheet;
}

// Наклон телефона: Telegram (Bot API 8.0) или браузер. Ноль — то положение, в котором телефон держат обычно
function gyro(onTilt) {
  const base = { b: null, g: null };
  const feed = (beta, gamma) => {
    if (beta == null || gamma == null) return;
    if (base.b == null) { base.b = beta; base.g = gamma; }
    base.b += (beta - base.b) * 0.01;
    base.g += (gamma - base.g) * 0.01;
    onTilt(beta - base.b, gamma - base.g);
  };
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.DeviceOrientation && tg.isVersionAtLeast && tg.isVersionAtLeast("8.0")) {
    const deg = 180 / Math.PI;
    const on = () => feed(tg.DeviceOrientation.beta * deg, tg.DeviceOrientation.gamma * deg);
    try {
      tg.DeviceOrientation.start({ refresh_rate: 50 });
      tg.onEvent("deviceOrientationChanged", on);
      return () => { tg.offEvent("deviceOrientationChanged", on); try { tg.DeviceOrientation.stop(); } catch { /* уже остановлен */ } };
    } catch { /* старый клиент — пробуем браузер */ }
  }
  const on = (e) => feed(e.beta, e.gamma);
  window.addEventListener("deviceorientation", on);
  return () => window.removeEventListener("deviceorientation", on);
}

export function aegisBadge({ reduced = false, haptic = () => {}, tick = () => {}, onOpen = () => {} } = {}) {
  const still = el("img", { class: "aegis-still", src: STILL, alt: "", draggable: "false" });
  const canvas = el("canvas", { class: "aegis-canvas", "aria-hidden": "true" });
  const box = el("div", { class: "aegis", role: "button", tabindex: "0", "aria-label": "Аегис чемпионов: открыть 3D-витрину" },
    still, canvas, el("i", { class: "aegis-flash", "aria-hidden": "true" }));
  const ctx = canvas.getContext("2d");
  let img = null;

  // angle — поворот в градусах (0 — анфас), растёт при движении пальца влево
  const st = { angle: 0, vel: 0, drag: null, freeUntil: 0, flip: 0, pose: null, gyroYaw: 0, tilt: 0 };
  const t0 = performance.now();
  const idle = (t) => {
    if (reduced) return st.flip;
    const cycle = 12, k = Math.floor(t / cycle), ph = (t % cycle) - (cycle - 2.4);
    const turn = ph > 0 ? (1 - Math.cos((Math.PI * ph) / 2.4)) / 2 : 0;
    return 24 * Math.sin(t * 0.55) + 360 * (k + turn) + st.flip;
  };

  const draw = (angle) => {
    const r = box.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(r.width * dpr));
    if (canvas.width !== w) { canvas.width = canvas.height = w; }
    const a = ((angle % 360) + 360) % 360, f = a / STEP;
    const i = Math.floor(f) % FRAMES, j = (i + 1) % FRAMES, k = f - Math.floor(f);
    const frame = (n, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, (n % COLS) * FRAME, Math.floor(n / COLS) * FRAME, FRAME, FRAME, 0, 0, w, w);
    };
    ctx.clearRect(0, 0, w, w);
    frame(i, 1);
    if (k > 0.02) frame(j, k); // между кадрами — плавный переход, 7,5° не видно ступенькой
    canvas.style.setProperty("--tx", `${st.tilt.toFixed(2)}deg`);
    still.style.setProperty("--tx", `${st.tilt.toFixed(2)}deg`);
  };

  let raf = 0, last = performance.now(), visible = true, stopped = false;
  const frame = (now) => {
    raf = 0;
    if (!box.isConnected) { stop(); return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (st.pose != null) st.angle = st.pose;
    else if (!st.drag) {
      if (now < st.freeUntil) {
        // после броска крутится по инерции и тормозит
        st.angle += st.vel * dt;
        st.vel *= Math.exp(-dt * 1.8);
        if (Math.abs(st.vel) < 30) st.freeUntil = 0;
      } else {
        // мягко возвращается к покачиванию, по ближнему обороту
        const ty = idle((now - t0) / 1000);
        const target = ty + 360 * Math.round((st.angle - ty) / 360);
        st.vel += (34 * (target - st.angle) - 10.5 * st.vel) * dt;
        st.angle += st.vel * dt;
      }
    }
    if (img) draw(st.angle + st.gyroYaw);
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf && !stopped) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const io = window.IntersectionObserver && new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); });
  if (io) io.observe(box);
  const onVis = () => { if (!document.hidden) start(); };
  document.addEventListener("visibilitychange", onVis);
  const stopGyro = reduced ? () => {} : gyro((beta, gamma) => {
    st.gyroYaw = -Math.max(-30, Math.min(30, gamma)) * 0.9;
    st.tilt = Math.max(-14, Math.min(14, beta * 0.45));
  });
  // экран перерисовали — знак ушёл из DOM: всё останавливаем
  const watch = setInterval(() => { if (!box.isConnected) stop(); }, 2000);
  function stop() {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(watch);
    if (io) io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    stopGyro();
  }

  // ---------- жесты ----------
  let lastMove = 0, longTimer = 0, tapTimer = 0, lastTap = 0, moved = 0, downAt = 0;
  const claim = () => {
    box.classList.remove("claim");
    void box.offsetWidth;
    box.classList.add("claim");
    haptic("success");
    st.vel = 1300; // два быстрых оборота
    st.freeUntil = performance.now() + 4000;
    start();
  };
  box.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    st.drag = { x: e.clientX };
    st.vel = 0;
    moved = 0;
    downAt = lastMove = performance.now();
    box.classList.add("held");
    try { box.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    // долгое нажатие — перевернуть щит обратной стороной (и назад)
    longTimer = setTimeout(() => { st.flip = st.flip ? 0 : 180; st.drag = null; moved = 99; haptic("medium"); }, 550);
    tick();
    start();
  });
  box.addEventListener("pointermove", (e) => {
    if (!st.drag) return;
    const now = performance.now(), dt = Math.max(0.008, (now - lastMove) / 1000);
    const dx = e.clientX - st.drag.x;
    moved += Math.abs(dx);
    if (moved > 6) clearTimeout(longTimer);
    st.angle -= dx * 0.6;
    st.vel = st.vel * 0.6 + (-dx * 0.6 / dt) * 0.4;
    st.drag = { x: e.clientX };
    lastMove = now;
  });
  const release = (e) => {
    clearTimeout(longTimer);
    box.classList.remove("held");
    const wasDrag = st.drag;
    st.drag = null;
    const now = performance.now();
    if (e.type === "pointerup" && moved < 6 && now - downAt < 350) {
      // тап или двойной тап
      if (now - lastTap < 320) { clearTimeout(tapTimer); lastTap = 0; claim(); return; }
      lastTap = now;
      tapTimer = setTimeout(() => { if (box.isConnected) onOpen(); }, 320);
      return;
    }
    if (!wasDrag) return;
    if (now - lastMove > 80) st.vel = 0; // палец остановился перед отпусканием
    st.vel = Math.max(-1600, Math.min(1600, st.vel));
    st.freeUntil = now + 4000;
  };
  box.addEventListener("pointerup", release);
  box.addEventListener("pointercancel", release);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } });
  // для проверок: застыть на угле (градусы), null — снова живой
  box.aegisPose = (angle) => { st.pose = angle; start(); };

  loadSheet().then((image) => { img = image; box.classList.add("ready"); start(); }).catch(() => { /* остаётся анфас */ });
  start();
  return box;
}

// ---------- витрина: живая модель на весь экран ----------

let api = null;
function loadApi() {
  if (!api) {
    api = new Promise((resolve, reject) => {
      if (window.Sketchfab) { resolve(); return; }
      const s = document.createElement("script");
      s.src = API_URL;
      s.onload = () => resolve();
      s.onerror = () => { api = null; s.remove(); reject(new Error("нет API Sketchfab")); };
      document.head.append(s);
    });
  }
  return api;
}

export function openShowcase({ haptic = () => {}, openLink = (url) => window.open(url, "_blank") } = {}) {
  if (document.querySelector(".showcase")) return;
  const iframe = el("iframe", { title: "3D-модель Аегиса", allow: "autoplay; fullscreen; xr-spatial-tracking" });
  const waitText = el("p", { class: "muted small", role: "status" }, "Загружаю 3D-модель…");
  const stage = el("div", { class: "sc-stage" }, iframe, el("div", { class: "sc-wait" }, el("img", { src: STILL, alt: "" }), waitText));
  let viewer = null, light = "studio", view = "front";

  const camera = (name, duration = 1.1) => {
    view = name;
    if (!viewer) return;
    const r = stage.getBoundingClientRect();
    // узкая сцена: отходим дальше, чтобы щит влез по ширине
    const R = CAM.radius * Math.max(1, r.height / Math.max(1, r.width)) * 1.06;
    const a = CAM.front + { front: 0, side: Math.PI / 2, back: Math.PI }[name];
    const e = (CAM.elev * Math.PI) / 180, t = CAM.target;
    viewer.setCameraLookAt([t[0] + R * Math.cos(e) * Math.cos(a), t[1] + R * Math.cos(e) * Math.sin(a), t[2] + R * Math.sin(e)], t, duration);
  };
  const seg = (items, current, pick) => el("div", { class: "seg-row" }, ...items.map(([value, label]) => el("button", {
    type: "button", class: "seg", "aria-pressed": String(value === current),
    onclick: (e) => {
      for (const b of e.currentTarget.parentNode.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
      haptic("light");
      pick(value);
    },
  }, label)));
  const views = seg([["front", "Спереди"], ["side", "Сбоку"], ["back", "Сзади"]], view, (v) => camera(v));
  const lights = seg([["studio", "Студия"], ["gold", "Золото"], ["night", "Ночь"]], light, (v) => {
    light = v;
    overlay.classList.remove("light-studio", "light-gold", "light-night");
    overlay.classList.add(`light-${v}`);
    if (viewer) viewer.setEnvironment(LIGHTS[v]);
  });
  // «Поднять Аегис»: вспышка и быстрый оборот камеры вокруг щита
  const claim = el("button", { type: "button", class: "sc-claim", onclick: () => {
    overlay.classList.remove("claim");
    void overlay.offsetWidth;
    overlay.classList.add("claim");
    haptic("success");
    if (!viewer) return;
    const order = ["side", "back", "front"];
    order.forEach((v, i) => setTimeout(() => camera(v, 0.35), i * 360));
  } }, "Поднять Аегис");
  const close = () => {
    overlay.remove();
    document.documentElement.classList.remove("sc-open");
    document.removeEventListener("keydown", onKey);
    clearTimeout(timer);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const overlay = el("div", { class: "showcase light-studio", role: "dialog", "aria-modal": "true", "aria-label": "Аегис чемпионов в 3D" },
    el("div", { class: "sc-head" }, el("h2", {}, "Аегис чемпионов"), el("button", { type: "button", class: "ghost", onclick: close }, "Закрыть")),
    stage,
    el("div", { class: "sc-controls" }, views, lights, claim),
    el("p", { class: "sc-credit" }, "Крути пальцем, щипок — приблизить. 3D-модель «Aegis of champions» — ",
      el("button", { type: "button", onclick: () => openLink(MODEL_URL) }, "msta2219"), ", CC BY 4.0"));
  document.body.append(overlay);
  document.documentElement.classList.add("sc-open"); // страница под витриной не листается
  document.addEventListener("keydown", onKey);

  const fail = () => {
    if (!overlay.isConnected || viewer) return;
    waitText.textContent = "3D-модель не загрузилась. Проверь интернет и открой ещё раз.";
  };
  const timer = setTimeout(fail, 30000);
  loadApi().then(() => {
    if (!overlay.isConnected) return;
    const client = new window.Sketchfab("1.12.1", iframe);
    client.init(UID, {
      // без автовращения: оно сбивает кнопки видов («Сзади» показывало бок)
      autostart: 1, preload: 1, transparent: 1, autospin: 0, camera: 0, dnt: 1,
      ui_controls: 0, ui_infos: 0, ui_stop: 0, ui_inspector: 0, ui_hint: 0, ui_watermark: 0, ui_watermark_link: 0,
      ui_settings: 0, ui_help: 0, ui_annotations: 0, ui_loading: 0, ui_fullscreen: 0, ui_vr: 0, ui_ar: 0,
      success(v) {
        v.start();
        v.addEventListener("viewerready", () => {
          if (!overlay.isConnected) return;
          viewer = v;
          clearTimeout(timer);
          v.setEnvironment(LIGHTS[light]);
          camera(view, 0);
          stage.classList.add("ready");
        });
      },
      error: fail,
    });
  }).catch(fail);
}
