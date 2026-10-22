// Знак приложения — Аегис чемпионов с 3D-модели «Aegis of champions» (Sketchfab, автор msta2219, CC BY 4.0).
// На главной: настоящий 3D на WebGL — тонкий щит по контуру модели (docs/aegis_shape.js), лицо и спина из её
// рендеров (tools/aegis_shape.py), кант и блик считаются под светом. Крутится пальцем в любую сторону с инерцией,
// сам покачивается и раз в 12 с делает оборот, наклон телефона поворачивает щит. Двойной тап — «поднял Аегис»,
// долгое нажатие — показать обратную сторону. Тап открывает витрину с живой моделью. Без WebGL — картинка анфаса.
import { OUTLINE } from "./aegis_shape.js?v=1";

const UID = "be25c575619641c2a562cbbc7727da76";
const MODEL_URL = "https://sketchfab.com/3d-models/aegis-of-champions-be25c575619641c2a562cbbc7727da76";
const API_URL = "https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js";
const STILL = "img/aegis_still.webp?v=1", BACK = "img/aegis_back.webp?v=1";
const DEPTH = 0.075; // толщина щита в долях полукадра: тонкий, как щит, а не миска
const FOV = 0.5;     // поле зрения камеры, рад: лёгкая перспектива
const DEG = Math.PI / 180;
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

// ---------- кватернионы [x, y, z, w]: поворот без «шарнирного замка», крутится в любую сторону ----------

const qAxis = (x, y, z, a) => {
  const len = Math.hypot(x, y, z) || 1, s = Math.sin(a / 2) / len;
  return [x * s, y * s, z * s, Math.cos(a / 2)];
};
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qNorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };
// поворот, который переводит from в to, как вектор «ось × угол» (кратчайший путь)
function qDelta(to, from) {
  let d = qMul(to, [-from[0], -from[1], -from[2], from[3]]);
  if (d[3] < 0) d = d.map((v) => -v);
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-6) return [0, 0, 0];
  const a = 2 * Math.atan2(s, d[3]);
  return [d[0] / s * a, d[1] / s * a, d[2] / s * a];
}
// столбцы матрицы поворота 3×3
function qMat(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
}

// ---------- WebGL: лицо, спина и кант по контуру ----------

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv;
uniform mat3 uRot; uniform float uDist, uFocal;
varying vec3 vN; varying vec2 vUv; varying float vZ;
void main() {
  vec3 p = uRot * aPos;
  vN = uRot * aNrm; vUv = aUv; vZ = aPos.z;
  float z = uDist - p.z;
  gl_Position = vec4(p.xy * uFocal, (z - uDist) * 0.25, z);
}`;
// uMode: 0 — лицо, 1 — спина, 2 — кант. Текстуры с предумноженной альфой
const FS = `
precision mediump float;
uniform sampler2D uFront, uBack; uniform int uMode; uniform float uDepth;
varying vec3 vN; varying vec2 vUv; varying float vZ;
void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(vec3(-0.45, 0.65, 0.9));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  vec4 f = texture2D(uFront, vUv);
  if (uMode == 2) {
    // кант: бронза, к спине темнее
    vec3 bronze = mix(vec3(0.24, 0.17, 0.10), vec3(0.60, 0.44, 0.26), 0.35 + 0.65 * (0.5 + 0.5 * vZ / uDepth));
    float sheen = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 12.0);
    gl_FragColor = vec4(bronze * (0.32 + 0.8 * diff) + sheen * vec3(1.0, 0.86, 0.62) * 0.35, 1.0);
    return;
  }
  if (f.a < 0.03) discard;
  // свет в рендерах уже запечён под анфас: при повороте только притеняем и даём бегущий блик
  float k = 0.62 + 0.38 * diff / 0.75;
  vec3 c;
  if (uMode == 0) {
    float metal = dot(f.rgb, vec3(0.33)) / max(f.a, 0.01);
    c = f.rgb * k + spec * f.a * (0.15 + 0.55 * metal) * vec3(1.0, 0.95, 0.85);
  } else {
    vec4 b = texture2D(uBack, vUv);
    vec3 plate = vec3(0.30, 0.23, 0.15) * f.a;
    c = (mix(plate, b.rgb / max(b.a, 0.01) * f.a, b.a)) * k + spec * f.a * 0.25;
  }
  gl_FragColor = vec4(c, f.a);
}`;

function shieldGeometry() {
  const h = DEPTH / 2, out = [];
  // вершина: x y z, нормаль, uv (картинка: y вниз)
  const v = (x, y, z, nx, ny, nz) => out.push(x, y, z, nx, ny, nz, (x + 1) / 2, (1 - y) / 2);
  // лицо смотрит на +z, спина на −z (обход против часовой со своей стороны: невидимую сторону отсекаем)
  v(-1, -1, h, 0, 0, 1); v(1, -1, h, 0, 0, 1); v(1, 1, h, 0, 0, 1);
  v(-1, -1, h, 0, 0, 1); v(1, 1, h, 0, 0, 1); v(-1, 1, h, 0, 0, 1);
  v(-1, -1, -h, 0, 0, -1); v(1, 1, -h, 0, 0, -1); v(1, -1, -h, 0, 0, -1);
  v(-1, -1, -h, 0, 0, -1); v(-1, 1, -h, 0, 0, -1); v(1, 1, -h, 0, 0, -1);
  const n = OUTLINE.length / 2;
  const P = (i) => [OUTLINE[2 * (i % n)], OUTLINE[2 * (i % n) + 1]];
  // нормаль канта в вершине — среднее соседних граней: кант гладкий, а не в полоску
  const edge = (i) => { const [x0, y0] = P(i), [x1, y1] = P(i + 1), l = Math.hypot(x1 - x0, y1 - y0) || 1; return [(y1 - y0) / l, -(x1 - x0) / l]; };
  const nrm = [];
  for (let i = 0; i < n; i++) {
    const a = edge((i + n - 1) % n), b = edge(i), l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    nrm.push([(a[0] + b[0]) / l, (a[1] + b[1]) / l]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, [x0, y0] = P(i), [x1, y1] = P(j), [ax, ay] = nrm[i], [bx, by] = nrm[j];
    v(x0, y0, -h, ax, ay, 0); v(x1, y1, -h, bx, by, 0); v(x1, y1, h, bx, by, 0);
    v(x0, y0, -h, ax, ay, 0); v(x1, y1, h, bx, by, 0); v(x0, y0, h, ax, ay, 0);
  }
  return new Float32Array(out);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`нет ${src}`));
    img.src = src;
  });
}

// null — WebGL нет, остаётся картинка
function shieldRenderer(canvas) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, powerPreference: "low-power" });
  if (!gl) return null;
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const data = shieldGeometry();
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const attr = (name, size, offset) => {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, offset);
  };
  attr("aPos", 3, 0); attr("aNrm", 3, 12); attr("aUv", 2, 24);
  const u = (name) => gl.getUniformLocation(prog, name);
  const uRot = u("uRot"), uMode = u("uMode"), uDist = u("uDist"), uFocal = u("uFocal");
  gl.uniform1i(u("uFront"), 0);
  gl.uniform1i(u("uBack"), 1);
  gl.uniform1f(u("uDepth"), DEPTH / 2);
  const dist = 1 / Math.tan(FOV / 2) * 0.98;
  gl.uniform1f(uDist, dist);
  gl.uniform1f(uFocal, 1 / Math.tan(FOV / 2));
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const texture = (unit, img) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const rim = (OUTLINE.length / 2) * 6;
  return {
    gl,
    textures(front, back) { texture(0, front); texture(1, back); },
    draw(q, size) {
      if (canvas.width !== size) { canvas.width = canvas.height = size; }
      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix3fv(uRot, false, qMat(q));
      // сначала непрозрачный кант, потом видимая сторона с мягким краем
      gl.uniform1i(uMode, 2); gl.drawArrays(gl.TRIANGLES, 12, rim);
      gl.uniform1i(uMode, 1); gl.drawArrays(gl.TRIANGLES, 6, 6);
      gl.uniform1i(uMode, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
  };
}

export function aegisBadge({ reduced = false, haptic = () => {}, tick = () => {}, onOpen = () => {} } = {}) {
  const still = el("img", { class: "aegis-still", src: STILL, alt: "", draggable: "false" });
  const canvas = el("canvas", { class: "aegis-canvas", "aria-hidden": "true" });
  const box = el("div", { class: "aegis", role: "button", tabindex: "0", "aria-label": "Аегис чемпионов: открыть 3D-витрину" },
    still, canvas, el("i", { class: "aegis-flash", "aria-hidden": "true" }));
  const gfx = shieldRenderer(canvas);
  let live = false;

  // q — положение щита; w — угловая скорость (рад/с, ось × скорость) после броска пальцем
  const st = { q: [0, 0, 0, 1], w: [0, 0, 0], drag: null, freeUntil: 0, flip: 0, pose: null, tilt: [0, 0, 0, 1] };
  const t0 = performance.now();
  // само по себе: покачивается по двум осям и раз в 12 с делает оборот
  const idle = (t) => {
    if (reduced) return qAxis(0, 1, 0, st.flip * DEG);
    const cycle = 12, k = Math.floor(t / cycle), ph = (t % cycle) - (cycle - 2.4);
    const turn = ph > 0 ? (1 - Math.cos((Math.PI * ph) / 2.4)) / 2 : 0;
    const yaw = (24 * Math.sin(t * 0.55) + 360 * (k + turn) + st.flip) * DEG;
    const pitch = 9 * Math.sin(t * 0.43 + 1) * DEG;
    return qMul(qAxis(0, 1, 0, yaw), qAxis(1, 0, 0, pitch));
  };

  let raf = 0, last = performance.now(), visible = true, stopped = false, size = 0;
  // размер холста меряем при изменении, а не в каждом кадре: лишний пересчёт вёрстки на телефоне — это рывки
  const measure = () => { size = Math.max(1, Math.round(box.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 2))); };
  const ro = window.ResizeObserver && new ResizeObserver(measure);
  if (ro) ro.observe(box);
  const frame = (now) => {
    raf = 0;
    if (!box.isConnected) { stop(); return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (st.pose != null) {
      const [yaw, pitch = 0] = [].concat(st.pose);
      st.q = qMul(qAxis(0, 1, 0, yaw * DEG), qAxis(1, 0, 0, pitch * DEG));
      st.w = [0, 0, 0];
    } else if (!st.drag) {
      if (now < st.freeUntil) {
        // после броска крутится по инерции и тормозит
        const fade = Math.exp(-dt * 1.8);
        st.w = st.w.map((v) => v * fade);
        if (Math.hypot(...st.w) < 0.5) st.freeUntil = 0;
      } else {
        // мягко возвращается к покачиванию по кратчайшему пути
        const d = qDelta(idle((now - t0) / 1000), st.q);
        st.w = st.w.map((v, i) => v + (34 * d[i] - 10.5 * v) * dt);
      }
      const a = Math.hypot(...st.w);
      if (a > 1e-5) st.q = qNorm(qMul(qAxis(st.w[0], st.w[1], st.w[2], a * dt), st.q));
    }
    if (live) {
      if (!size || !ro) measure();
      gfx.draw(qMul(st.tilt, st.q), size);
    }
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf && !stopped && live) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  // события приходят пачкой («ещё не в DOM» и «уже на экране»): верит последнему, иначе анимация засыпает
  const io = window.IntersectionObserver && new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) start(); });
  if (io) io.observe(box);
  const onVis = () => { if (!document.hidden) start(); };
  document.addEventListener("visibilitychange", onVis);
  const stopGyro = reduced || !gfx ? () => {} : gyro((beta, gamma) => {
    // наклон телефона вперёд-назад и вбок поворачивает щит по двум осям
    const pitch = Math.max(-16, Math.min(16, beta * 0.5)) * DEG, yaw = Math.max(-28, Math.min(28, gamma * 0.9)) * DEG;
    st.tilt = qMul(qAxis(0, 1, 0, yaw), qAxis(1, 0, 0, pitch));
  });
  canvas.addEventListener("webglcontextlost", () => { live = false; box.classList.remove("ready"); });
  // экран перерисовали — знак ушёл из DOM: всё останавливаем
  const watch = setInterval(() => { if (!box.isConnected) stop(); }, 2000);
  function stop() {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(watch);
    if (io) io.disconnect();
    if (ro) ro.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    stopGyro();
    // контекстов WebGL у страницы мало: отдаём сразу
    const lose = gfx && gfx.gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  }

  // ---------- жесты ----------
  let lastMove = 0, longTimer = 0, tapTimer = 0, lastTap = 0, moved = 0, downAt = 0;
  const claim = () => {
    box.classList.remove("claim");
    void box.offsetWidth;
    box.classList.add("claim");
    haptic("success");
    st.w = [0, 1300 * DEG, 0]; // два быстрых оборота
    st.freeUntil = performance.now() + 4000;
    start();
  };
  box.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    st.drag = { x: e.clientX, y: e.clientY };
    st.w = [0, 0, 0];
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
    const dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y;
    const len = Math.hypot(dx, dy);
    moved += len;
    if (moved > 6) clearTimeout(longTimer);
    st.drag = { x: e.clientX, y: e.clientY };
    lastMove = now;
    if (len < 0.01) return;
    // щит катится под пальцем: ось поворота поперёк движения, 0,6° на пиксель
    const a = len * 0.6 * DEG, ax = dy / len, ay = dx / len;
    st.q = qNorm(qMul(qAxis(ax, ay, 0, a), st.q));
    const speed = a / dt;
    st.w = st.w.map((v, i) => v * 0.6 + [ax, ay, 0][i] * speed * 0.4);
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
    if (now - lastMove > 80) st.w = [0, 0, 0]; // палец остановился перед отпусканием
    const a = Math.hypot(...st.w), max = 1600 * DEG;
    if (a > max) st.w = st.w.map((v) => (v * max) / a);
    st.freeUntil = now + 4000;
  };
  box.addEventListener("pointerup", release);
  box.addEventListener("pointercancel", release);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } });
  // для проверок: застыть на угле (градусы вокруг вертикали или [вокруг вертикали, наклон]), null — снова живой
  box.aegisPose = (angle) => { st.pose = angle; start(); };
  box.aegisState = () => ({ q: st.q.map((v) => +v.toFixed(3)), drag: Boolean(st.drag), running: Boolean(raf), live, visible });

  if (gfx) {
    Promise.all([loadImage(STILL), loadImage(BACK)]).then(([front, back]) => {
      if (stopped) return;
      gfx.textures(front, back);
      live = true;
      box.classList.add("ready");
      start();
    }).catch(() => { /* остаётся анфас */ });
  }
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
