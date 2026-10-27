// Моушн дизайна «Новый» (GSAP, docs/vendor). Разметку не трогает: следит за #app и оживляет то, что в нём появилось.
// Плиты первого экрана въезжают лесенкой, остальные — когда до них докрутили. Цифры добегают до значения,
// полоски вырастают, линии графиков дорисовываются, кольцо оценки заполняется. Без GSAP, на классике
// и при «уменьшить движение» в системе ничего не делает — экран и так целиком виден.

let gsap = null;
const root = document.documentElement;
const app = document.getElementById("app");
const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

const EASE = "expo.out";
// что считается отдельной «плитой» при появлении экрана
const BLOCK = ".card, .match-item, .fresh-match, .draft-entry, .app-top, .tabs-wrap, h2, .row, .seg-row, .ach-grid, .hero-head, .page-head, .center, p, button";
const COUNT = ".stat b, .metric b, .medal b, .hero-stat .wr, .score-row b, .ip-score b";
const BARS = "[data-pct], [data-w], .dmg-bar > i";
const LINES = ".spark polyline, .chart polyline, .chart path";

// GSAP грузим только для нового дизайна: классике лишние 70 КБ ни к чему
if (app && root.classList.contains("v2") && !reduced) {
  const lib = document.createElement("script");
  lib.src = "vendor/gsap.min.js?v=3.15.0";
  lib.onload = () => { gsap = window.gsap; if (gsap) start(); };
  document.head.append(lib);
}

function start() {
  root.classList.add("motion");
  gsap.defaults({ ease: EASE, overwrite: "auto" });
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      reveal([e.target], 0);
    }
  }, { rootMargin: "0px 0px -8% 0px" });

  // Плиты контейнера: крупный контейнер (вкладка разбора, список) раскрываем до его детей
  function blocks(container) {
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (child.offsetParent === null && getComputedStyle(child).position !== "fixed") continue;
        const tall = child.offsetHeight > innerHeight * 1.1 && child.children.length > 1 && !child.matches(".card, .hero-head");
        if (tall) walk(child);
        else out.push(child);
      }
    };
    walk(container);
    return out;
  }

  function enter(container, { x = 0 } = {}) {
    const items = blocks(container);
    const now = [], later = [];
    for (const el of items) (el.getBoundingClientRect().top < innerHeight ? now : later).push(el);
    reveal(now, x);
    for (const el of later) { gsap.set(el, { opacity: 0, y: 28 }); seen.observe(el); }
  }

  function reveal(items, x) {
    if (!items.length) return;
    gsap.fromTo(items, { opacity: 0, y: x ? 0 : 22, x },
      { opacity: 1, y: 0, x: 0, duration: 0.9, stagger: 0.055, clearProps: "opacity,visibility,transform" });
    items.forEach((el, i) => details(el, 0.12 + i * 0.055));
  }

  // Детали внутри плиты: цифры, полоски, линии, кольцо оценки, форма
  function details(el, delay) {
    each(el, COUNT, (n) => countUp(n, delay));
    each(el, ".medal", (m) => gsap.from(m, { "--p": 0, duration: 1.6, delay, ease: "power4.out" }));
    each(el, BARS, (b) => gsap.from(b, { scaleX: 0, transformOrigin: "0 50%", duration: 1.2, delay: delay + 0.1, clearProps: "transform" }));
    each(el, LINES, (p) => draw(p, delay + 0.1));
    each(el, ".form-strip", (s) => gsap.from(s.children, { scale: 0, autoAlpha: 0, duration: 0.6, delay, stagger: 0.025, ease: "back.out(2)", clearProps: "transform,opacity,visibility" }));
    each(el, ".hero-banner > img", (img) => gsap.from(img, { scale: 1.16, duration: 2.2, ease: "power3.out", clearProps: "transform" }));
    each(el, ".app-top", (top) => {
      const tl = gsap.timeline({ delay });
      tl.from(top.querySelector(".aegis"), { scale: 0.86, autoAlpha: 0, duration: 1.4, clearProps: "transform,opacity,visibility" })
        .from(top.querySelectorAll("h1, p"), { y: 14, autoAlpha: 0, filter: "blur(8px)", duration: 1, stagger: 0.08, clearProps: "transform,opacity,visibility,filter" }, 0.15);
    });
  }

  function each(el, sel, fn) {
    if (el.matches && el.matches(sel)) fn(el);
    el.querySelectorAll && el.querySelectorAll(sel).forEach(fn);
  }

  function draw(path, delay) {
    if (getComputedStyle(path).fill !== "none" || !path.getTotalLength) return;
    let len = 0;
    try { len = path.getTotalLength(); } catch { return; }
    if (!len || len < 40) return;
    gsap.fromTo(path, { strokeDasharray: len, strokeDashoffset: len },
      { strokeDashoffset: 0, duration: 1.6, delay, ease: "power2.inOut", clearProps: "strokeDasharray,strokeDashoffset" });
  }

  // Экран целиком (render) — обёртка .fade-in; вкладка разбора — страница со slide-from-*; догруженные куски — всё остальное
  new MutationObserver((records) => {
    const batches = new Map();
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!(node instanceof HTMLElement) || !node.isConnected) continue;
        if (node.parentElement === app || node.matches(".fade-in, .slide-from-right, .slide-from-left")) {
          const x = node.classList.contains("slide-from-right") ? 28 : node.classList.contains("slide-from-left") ? -28 : 0;
          requestAnimationFrame(() => node.isConnected && enter(node, { x }));
          continue;
        }
        if (!node.matches(BLOCK) || node.closest(".chat")) continue;
        const list = batches.get(r.target) || [];
        list.push(node);
        batches.set(r.target, list);
      }
    }
    for (const list of batches.values()) requestAnimationFrame(() => reveal(list.filter((n) => n.isConnected), 0));
  }).observe(app, { childList: true, subtree: true });

  // экран мог отрисоваться, пока грузился GSAP
  if (app.firstElementChild) enter(app.firstElementChild);

  // Нижняя панель: иконка вкладки чуть подпрыгивает при выборе
  document.addEventListener("click", (e) => {
    const btn = e.target instanceof Element && e.target.closest(".tabbtn, .tab");
    if (btn) gsap.fromTo(btn.querySelector("svg") || btn, { scale: 0.86 }, { scale: 1, duration: 0.7, ease: "elastic.out(1, 0.45)", clearProps: "transform" });
  }, { capture: true });

  interactive();
}

// «4/19/30», «53%», «4.8», «−12» — бегут все числа в строке, формат (знаки после запятой, разделитель) сохраняется
function countUp(node, delay) {
  // повторный тап посреди счёта: берём итоговое значение, а не промежуточное
  if (!node.dataset.final || !node.dataset.counting) node.dataset.final = node.textContent;
  const text = node.dataset.final;
  if (!text || text.length > 16 || !/\d/.test(text)) return;
  const parts = text.split(/(\d+(?:[.,]\d+)?)/);
  const nums = parts.map((p, i) => (i % 2 ? Number(p.replace(",", ".")) : null));
  const digits = parts.map((p, i) => (i % 2 ? (p.split(/[.,]/)[1] || "").length : 0));
  const sep = parts.map((p) => (p.includes(",") ? "," : "."));
  const state = { t: 0 };
  gsap.killTweensOf(node.__count || {});
  node.__count = state;
  node.dataset.counting = "1";
  gsap.to(state, {
    t: 1, duration: 1.3, delay, ease: "power3.out",
    onUpdate: () => {
      if (!node.isConnected) return;
      node.textContent = parts.map((p, i) => (i % 2 ? (nums[i] * state.t).toFixed(digits[i]).replace(".", sep[i]) : p)).join("");
    },
    onComplete: () => { node.textContent = text; delete node.dataset.counting; },
  });
  node.textContent = parts.map((p, i) => (i % 2 ? (0).toFixed(digits[i]).replace(".", sep[i]) : p)).join("");
}

// ---------- интерактив: всё отвечает на палец ----------

const LIT = ".card, .fresh-match, .draft-entry, .match-item, .ach, .hero-stat, .compare-item, .week-match";
const PRESS = "button:not(.tab):not(.tabbtn):not(.coach-step):not(.seg), .match-item, .fresh-match, .draft-entry";

function interactive() {
  // Свет за пальцем: мягкое пятно на фоне всего экрана
  const glow = document.createElement("div");
  glow.className = "v2-glow";
  glow.setAttribute("aria-hidden", "true");
  document.body.append(glow);
  const gx = gsap.quickTo(glow, "x", { duration: 0.6, ease: "power3.out" });
  const gy = gsap.quickTo(glow, "y", { duration: 0.6, ease: "power3.out" });
  let lit = null;

  const move = (e) => {
    gx(e.clientX); gy(e.clientY);
    const card = e.target instanceof Element && e.target.closest(LIT);
    if (card !== lit) {
      if (lit) gsap.to(lit, { "--sa": 0, duration: 0.6 });
      lit = card;
      if (lit) gsap.to(lit, { "--sa": 1, duration: 0.35 });
    }
    // блик на плите идёт за пальцем
    if (lit) {
      const r = lit.getBoundingClientRect();
      lit.style.setProperty("--mx", `${e.clientX - r.left}px`);
      lit.style.setProperty("--my", `${e.clientY - r.top}px`);
    }
  };
  addEventListener("pointerdown", (e) => {
    gsap.set(glow, { x: e.clientX, y: e.clientY });
    gsap.to(glow, { autoAlpha: 1, scale: 1, duration: 0.4 });
    move(e);
    const el = e.target instanceof Element && e.target.closest(PRESS);
    if (el && !el.disabled) gsap.to(el, { scale: 0.965, duration: 0.18, ease: "power2.out" });
  }, { passive: true });
  addEventListener("pointermove", move, { passive: true });
  const release = () => {
    gsap.to(glow, { autoAlpha: 0, scale: 0.6, duration: 0.8 });
    if (lit) { gsap.to(lit, { "--sa": 0, duration: 0.8 }); lit = null; }
    gsap.utils.toArray(document.querySelectorAll(PRESS)).forEach((el) => {
      if (gsap.getProperty(el, "scale") !== 1) gsap.to(el, { scale: 1, duration: 0.9, ease: "elastic.out(1, 0.4)", clearProps: "transform" });
    });
  };
  addEventListener("pointerup", release, { passive: true });
  addEventListener("pointercancel", release, { passive: true });

  // Тап по цифрам и кольцу оценки: пересчитываются заново с пружинкой
  app.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const medal = t.closest(".medal");
    if (medal) {
      gsap.fromTo(medal, { "--p": 0 }, { "--p": medal.style.getPropertyValue("--p") || 50, duration: 1.4, ease: "power4.out" });
      gsap.fromTo(medal, { scale: 0.9 }, { scale: 1, duration: 1, ease: "elastic.out(1, 0.4)", clearProps: "transform" });
      const b = medal.querySelector("b");
      if (b) countUp(b, 0);
      buzz();
      return;
    }
    const tile = t.closest(".stat, .metric");
    if (tile) {
      gsap.fromTo(tile, { scale: 0.92 }, { scale: 1, duration: 0.9, ease: "elastic.out(1, 0.4)", clearProps: "transform" });
      const b = tile.querySelector("b");
      if (b) countUp(b, 0);
      buzz();
      return;
    }
    // форма: волна по квадратикам от того, по которому ткнули
    const strip = t.closest(".form-strip");
    if (strip) {
      const dots = [...strip.children];
      const from = Math.max(0, dots.indexOf(t.closest(".dot")));
      gsap.fromTo(dots, { y: 0 }, { y: -8, duration: 0.22, yoyo: true, repeat: 1, ease: "power2.out", stagger: { each: 0.03, from }, clearProps: "transform" });
      buzz();
      return;
    }
    // полоски: тап по строке с полоской — она дорастает заново
    const row = t.closest(".score-row, .zone-row, .build-row, .ach");
    if (row) row.querySelectorAll(BARS).forEach((bar) => gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, transformOrigin: "0 50%", duration: 1, clearProps: "transform" }));
  });

  // Скролл: Аегис на главной уходит в глубину, картинка героя в шапке разбора едет медленнее страницы
  let raf = 0;
  addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const y = scrollY;
      const shield = app.querySelector(".app-top .aegis");
      if (shield) {
        const k = Math.min(1, y / 260);
        gsap.set(shield, { scale: 1 - k * 0.22, y: y * 0.35, opacity: 1 - k * 0.7 });
      }
      const banner = app.querySelector(".hero-banner > img");
      if (banner) gsap.set(banner, { y: Math.min(y, 400) * 0.3 });
    });
  }, { passive: true });
}

function buzz() {
  const tg = window.Telegram && window.Telegram.WebApp;
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light"); } catch { /* старый клиент */ }
}
