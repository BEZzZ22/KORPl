// Аегис чемпионов в настоящем 3D (WebGL): щит — сетка, выдавленная по карте высот из официальных фото
// (img/aegis_front.webp и aegis_back.webp, вырезаны tools/cut_aegis.py). Высоты считаются здесь же из фото:
// выгнутый щит, скруглённый край, чеканка по яркости (светлое выше), купол розетки и четыре заклёпки.
// Ребро — стенка по контуру силуэта (marching squares). Металл: свет, блики, отражение «студии» и радужный
// отлив по краю. Щит покачивается и раз в цикл делает полный оборот; пальцем крутится во все стороны с инерцией.

const N = 512; // сторона текстур и карты высот
const GRID = 150; // клеток сетки по стороне
const DEPTH = 0.24, BACK_DEPTH = 0.1, THICK = 0.12; // в единицах щита (он от -1 до 1)
const DIST = 5, FILL = 0.62; // камера и какую часть холста занимает щит (холст в 1,6 раза больше знака)
const S = N / 600; // координаты на фото 600×600 (tools/cut_aegis.py) -> N

// ---------- карта высот ----------

// Размытие окном радиуса r по строкам и столбцам, три прохода ≈ гауссово
function blur(src, r) {
  const k = Math.max(1, Math.round(r / 2));
  let a = Float32Array.from(src);
  const b = new Float32Array(N * N);
  const pass = (from, to, step, line) => {
    for (let l = 0; l < N; l++) {
      const base = l * line;
      let s = 0;
      for (let i = -k; i <= k; i++) s += from[base + Math.min(N - 1, Math.max(0, i)) * step];
      for (let i = 0; i < N; i++) {
        to[base + i * step] = s / (2 * k + 1);
        s += from[base + Math.min(N - 1, i + k + 1) * step] - from[base + Math.max(0, i - k) * step];
      }
    }
  };
  for (let n = 0; n < 3; n++) { pass(a, b, 1, N); pass(b, a, N, 1); }
  return a;
}

function pixels(img) {
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const lum = new Float32Array(N * N), alpha = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    alpha[i] = d[i * 4 + 3] / 255;
  }
  return { lum, alpha, canvas: c };
}

// Высота 0..1: щит выгнут, край скруглён, светлая чеканка выпуклая, купола — розетка и заклёпки
function heights({ lum, alpha }, domes, relief) {
  const e = blur(alpha, 24 * S), fine2 = blur(lum, 1), fine10 = blur(lum, 5 * S), plates = blur(lum, 8 * S), soft = blur(lum, 3 * S);
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const r2 = ((x - N / 2) ** 2 + (y - N / 2) ** 2) / (N / 2) ** 2;
      const bevel = Math.sqrt(Math.min(1, Math.max(0, (e[i] - 0.5) * 2))) * alpha[i];
      let v = 0.55 * Math.max(0, 1 - r2) + 0.35 * bevel + relief * (1.1 * (fine2[i] - fine10[i]) + 0.55 * plates[i]);
      for (const [cx, cy, rad, k, flange] of domes) {
        const d = Math.hypot(x - cx * S, y - cy * S) / (rad * S);
        if (d < 1 && (!flange || soft[i] > 0.28)) v += k * Math.sqrt(1 - d * d);
      }
      h[i] = v;
    }
  }
  const out = blur(h, 2 * S);
  let max = 0;
  for (let i = 0; i < N * N; i++) {
    const bevel = Math.sqrt(Math.min(1, Math.max(0, (e[i] - 0.5) * 2))) * alpha[i];
    out[i] *= bevel;
    if (out[i] > max) max = out[i];
  }
  for (let i = 0; i < N * N; i++) out[i] /= max || 1;
  return out;
}

const FRONT_DOMES = [
  [302, 262, 50, 0.75], [302, 262, 84, 0.22, true], // розетка и звезда под ней
  [33, 318, 24, 0.42], [568, 318, 24, 0.42], [160, 494, 24, 0.42], [452, 494, 24, 0.42], // заклёпки
];
const BACK_DOMES = [[300, 300, 170, 0.35]]; // центральный диск оборота

const sample = (arr, u, v) => {
  const x = Math.min(N - 1.001, Math.max(0, u * (N - 1))), y = Math.min(N - 1.001, Math.max(0, v * (N - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * N + x0;
  return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fy) + (arr[i + N] * (1 - fx) + arr[i + N + 1] * fx) * fy;
};

// ---------- сетка ----------

// Вершина: позиция (3), uv (2), нормаль (3), вид (1): 0 лицо, 1 оборот, 2 ребро
function mesh(hf, hb, mask) {
  const V = GRID + 1, verts = [], idx = [];
  const zf = (u, v) => THICK / 2 + DEPTH * sample(hf, u, v);
  const zb = (u, v) => -THICK / 2 - BACK_DEPTH * sample(hb, 1 - u, v);
  for (const kind of [0, 1]) {
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const u = i / GRID, v = j / GRID;
        verts.push(2 * u - 1, 1 - 2 * v, kind ? zb(u, v) : zf(u, v), u, v, 0, 0, sample(mask, u, v), kind); // в z нормали — маска для обрезки
      }
    }
  }
  const m = (i, j) => sample(mask, i / GRID, j / GRID);
  for (const kind of [0, 1]) {
    const o = kind * V * V;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        if (Math.max(m(i, j), m(i + 1, j), m(i, j + 1), m(i + 1, j + 1)) < 0.05) continue;
        const a = o + j * V + i, b = a + 1, c = a + V, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  // Ребро: контур силуэта на уровне 0.5, стенка от лица до оборота, нормаль — наружу по градиенту маски
  const wall = [];
  const grad = (u, v) => {
    const e = 2 / N;
    const gx = sample(mask, u + e, v) - sample(mask, u - e, v), gy = sample(mask, u, v + e) - sample(mask, u, v - e);
    const l = Math.hypot(gx, gy) || 1;
    return [-gx / l, gy / l]; // по v ось y перевёрнута
  };
  const edge = (i0, j0, i1, j1) => {
    const a = m(i0, j0), b = m(i1, j1), t = Math.abs(b - a) < 1e-6 ? 0.5 : (0.5 - a) / (b - a);
    return [(i0 + (i1 - i0) * t) / GRID, (j0 + (j1 - j0) * t) / GRID];
  };
  const seg = (p, q) => {
    // нормаль — перпендикуляр к отрезку наружу; в гладких местах берём градиент (плавный свет),
    // в углах выемок градиент врёт — там остаётся перпендикуляр
    const dx = 2 * (q[0] - p[0]), dy = -2 * (q[1] - p[1]), dl = Math.hypot(dx, dy) || 1;
    let sx = dy / dl, sy = -dx / dl;
    const mid = grad((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    if (sx * mid[0] + sy * mid[1] < 0) { sx = -sx; sy = -sy; }
    const top = (pt) => {
      let [nx, ny] = grad(pt[0], pt[1]);
      if (nx * sx + ny * sy < 0.8) { nx = sx; ny = sy; }
      return [2 * pt[0] - 1, 1 - 2 * pt[1], zf(pt[0], pt[1]), pt[0], pt[1], nx, ny, 0, 2];
    };
    const bot = (pt) => { const t = top(pt); t[2] = zb(pt[0], pt[1]); return t; };
    wall.push(...top(p), ...bot(p), ...top(q), ...top(q), ...bot(p), ...bot(q));
  };
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const c = (m(i, j) >= 0.5) * 8 + (m(i + 1, j) >= 0.5) * 4 + (m(i + 1, j + 1) >= 0.5) * 2 + (m(i, j + 1) >= 0.5);
      if (c === 0 || c === 15) continue;
      const T = edge(i, j, i + 1, j), R = edge(i + 1, j, i + 1, j + 1), B = edge(i, j + 1, i + 1, j + 1), L = edge(i, j, i, j + 1);
      const segs = { 1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]],
        8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]] }[c];
      for (const [p, q] of segs) seg(p, q);
    }
  }
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx), wall: new Float32Array(wall) };
}

// ---------- шейдеры ----------

const VS = `
attribute vec3 aPos; attribute vec2 aUv; attribute vec3 aNrm; attribute float aKind;
uniform mat3 uRot; uniform float uF;
varying vec2 vUv; varying vec3 vNrm; varying float vKind; varying vec3 vPos; varying float vMask;
void main() {
  vec3 p = uRot * aPos;
  vPos = p; vUv = aUv; vNrm = uRot * aNrm; vKind = aKind; vMask = aNrm.z;
  float w = ${DIST.toFixed(1)} - p.z, n = ${(DIST - 2).toFixed(1)}, f = ${(DIST + 2).toFixed(1)};
  gl_Position = vec4(p.xy * uF, (f + n) / (f - n) * w - 2.0 * f * n / (f - n), w);
}`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uFront, uBack, uDepth;
uniform mat3 uRot; uniform float uTime;
varying vec2 vUv; varying vec3 vNrm; varying float vKind; varying vec3 vPos; varying float vMask;
const float E = ${(1 / N).toFixed(6)};
float hF(vec2 uv) { vec4 d = texture2D(uDepth, uv); return (d.r * 65280.0 + d.g * 255.0) / 65535.0; }
float hB(vec2 uv) { vec4 d = texture2D(uDepth, uv); return (d.b * 65280.0 + d.a * 255.0) / 65535.0; }
// «Студия»: тёплый свет сверху, тёмный пол, полоса софтбокса медленно ходит по кругу — отсюда перелив
vec3 env(vec3 r) {
  vec3 c = mix(vec3(0.04, 0.035, 0.03), vec3(1.0, 0.9, 0.74), smoothstep(-0.35, 0.95, r.y));
  vec3 s = normalize(vec3(cos(uTime * 0.35), 0.35, sin(uTime * 0.35)));
  c += vec3(1.0, 0.95, 0.85) * smoothstep(0.86, 0.985, dot(r, s)) * 1.6;
  c += vec3(0.55, 0.65, 0.9) * smoothstep(0.7, 1.0, dot(r, normalize(vec3(0.9, -0.2, 0.4)))) * 0.35;
  return c;
}
void main() {
  vec3 base, n;
  float silver = 0.0;
  // лицо и оборот обрезаются по той же линии маски, по которой стоит ребро: без щелей между ними
  if (vKind < 1.5 && vMask < 0.5) discard;
  if (vKind < 0.5) {
    base = texture2D(uFront, vUv).rgb;
    float du = (hF(vUv + vec2(E, 0.0)) - hF(vUv - vec2(E, 0.0))) / (2.0 * E);
    float dv = (hF(vUv + vec2(0.0, E)) - hF(vUv - vec2(0.0, E))) / (2.0 * E);
    n = normalize(vec3(-${DEPTH.toFixed(2)} * du * 0.5 * 1.15, ${DEPTH.toFixed(2)} * dv * 0.5 * 1.15, 1.0));
  } else if (vKind < 1.5) {
    vec2 m = vec2(1.0 - vUv.x, vUv.y);
    vec4 b = texture2D(uBack, m);
    base = mix(vec3(0.36, 0.27, 0.15), b.rgb, smoothstep(0.3, 0.7, b.a));
    float du = (hB(m + vec2(E, 0.0)) - hB(m - vec2(E, 0.0))) / (2.0 * E);
    float dv = (hB(m + vec2(0.0, E)) - hB(m - vec2(0.0, E))) / (2.0 * E);
    n = normalize(vec3(${BACK_DEPTH.toFixed(2)} * du * 0.5 * 1.15, ${BACK_DEPTH.toFixed(2)} * dv * 0.5 * 1.15, -1.0));
  } else {
    // ребро — тёмная литая бронза, как обод на фото
    base = vec3(0.4, 0.29, 0.15);
  }
  vec3 N = vKind < 1.5 ? normalize(uRot * n) : normalize(vNrm);
  vec3 V = normalize(vec3(0.0, 0.0, ${DIST.toFixed(1)}) - vPos);
  float sat = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
  silver = smoothstep(0.12, 0.03, sat) * smoothstep(0.25, 0.55, dot(base, vec3(0.333)));
  vec3 L1 = normalize(vec3(-0.45, 0.75, 0.7)), L2 = normalize(vec3(0.7, -0.3, 0.5));
  float diff = max(dot(N, L1), 0.0), fill = max(dot(N, L2), 0.0);
  float shin = mix(28.0, 90.0, silver);
  float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), shin) + 0.4 * pow(max(dot(N, normalize(L2 + V)), 0.0), shin);
  vec3 tint = mix(base * 1.7 + 0.05, vec3(0.95), silver * 0.6);
  vec3 R = reflect(-V, N);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = base * (0.42 + 0.78 * diff + 0.2 * fill)
    + tint * (env(R) * (0.28 + 0.5 * fres) + spec * 0.9);
  // радужный отлив у краёв выпуклостей, как у Аегиса на свету
  vec3 rainbow = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + fres * 1.4 + uTime * 0.04));
  col += rainbow * fres * (0.1 + 0.2 * silver) * step(vKind, 1.5); // на ребре радуга даёт синюю кайму
  gl_FragColor = vec4(col / (1.0 + col * 0.12), 1.0);
}`;

// ---------- WebGL ----------

function program(gl) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function texture(gl, unit, src, { mip = true, nearest = false } = {}) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  if (src instanceof Uint8Array) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  const f = nearest ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Поворот: сначала вокруг вертикали (yaw), потом наклон (pitch), градусы
function rotation(yaw, pitch) {
  const a = (yaw * Math.PI) / 180, b = (pitch * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // столбцы mat3 для GLSL: Rx(pitch) * Ry(yaw)
  return new Float32Array([ca, sb * sa, -cb * sa, 0, cb, sb, sa, -sb * ca, cb * ca]);
}

// Монтирует 3D-щит в box. true — получилось (WebGL есть, картинки загрузились), иначе остаётся запасной вид
export async function mountAegis(box, { front, back, reduced = false, onGrab = () => {} }) {
  const canvas = document.createElement("canvas");
  canvas.className = "aegis-gl";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return false;
  try {
    const [fi, bi] = await Promise.all([loadImage(front), loadImage(back)]);
    const fp = pixels(fi), bp = pixels(bi);
    const hf = heights(fp, FRONT_DOMES, 1), hb = heights(bp, BACK_DOMES, 0.7);
    const mask = blur(fp.alpha, 1);
    const { verts, idx, wall } = mesh(hf, hb, mask);
    const depth = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      const f = Math.round(hf[i] * 65535), b = Math.round(hb[i] * 65535);
      depth[i * 4] = f >> 8; depth[i * 4 + 1] = f & 255; depth[i * 4 + 2] = b >> 8; depth[i * 4 + 3] = b & 255;
    }

    const prog = program(gl);
    gl.useProgram(prog);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    texture(gl, 0, fp.canvas);
    texture(gl, 1, bp.canvas);
    texture(gl, 2, depth, { mip: false, nearest: true });
    gl.uniform1i(gl.getUniformLocation(prog, "uFront"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uBack"), 1);
    gl.uniform1i(gl.getUniformLocation(prog, "uDepth"), 2);
    const uRot = gl.getUniformLocation(prog, "uRot"), uTime = gl.getUniformLocation(prog, "uTime"), uF = gl.getUniformLocation(prog, "uF");

    const buffer = (data, target = gl.ARRAY_BUFFER) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };
    const vb = buffer(verts), wb = buffer(wall), ib = buffer(idx, gl.ELEMENT_ARRAY_BUFFER);
    const attrs = [["aPos", 3, 0], ["aUv", 2, 3], ["aNrm", 3, 5], ["aKind", 1, 8]].map(([name, size, off]) => [gl.getAttribLocation(prog, name), size, off]);
    const bind = (b) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      for (const [loc, size, off] of attrs) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 36, off * 4);
      }
    };
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    // ---------- движение ----------
    const st = { yaw: 0, pitch: 0, vy: 0, vp: 0, drag: null, freeUntil: 0, pose: null };
    const t0 = performance.now();
    const idle = (t) => {
      if (reduced) return [0, -6];
      // покачивание и раз в 14 с полный оборот за 2,6 с
      const cycle = 14, k = Math.floor(t / cycle), ph = (t % cycle) - (cycle - 2.6);
      const turn = ph > 0 ? (1 - Math.cos((Math.PI * ph) / 2.6)) / 2 : 0;
      return [22 * Math.sin(t * 0.5) + 360 * (k + turn), 9 * Math.sin(t * 0.37) - 5];
    };

    const size = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.max(1, Math.round(r.width * dpr));
      if (canvas.width !== w) { canvas.width = canvas.height = w; gl.viewport(0, 0, w, w); }
    };
    let raf = 0, last = performance.now(), visible = true;
    const frame = (now) => {
      raf = 0;
      if (!box.isConnected) { stop(); return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      if (st.pose) [st.yaw, st.pitch] = st.pose;
      else if (!st.drag) {
        if (now < st.freeUntil) {
          // после броска щит крутится по инерции и тормозит
          st.yaw += st.vy * dt; st.pitch += st.vp * dt;
          const f = Math.exp(-dt * 2.4);
          st.vy *= f; st.vp *= f;
          if (Math.abs(st.vy) < 25 && Math.abs(st.vp) < 25) st.freeUntil = 0;
        } else {
          // мягко возвращается к покачиванию, по ближнему обороту
          const [ty, tp] = idle(t);
          const target = ty + 360 * Math.round((st.yaw - ty) / 360);
          st.vy += (40 * (target - st.yaw) - 11 * st.vy) * dt;
          st.vp += (40 * (tp - st.pitch) - 11 * st.vp) * dt;
          st.yaw += st.vy * dt; st.pitch += st.vp * dt;
        }
      }
      st.pitch = Math.max(-80, Math.min(80, st.pitch));
      size();
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix3fv(uRot, false, rotation(st.yaw, st.pitch));
      gl.uniform1f(uTime, reduced ? 0 : t);
      gl.uniform1f(uF, DIST * FILL);
      bind(vb);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      bind(wb);
      gl.drawArrays(gl.TRIANGLES, 0, wall.length / 9);
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const io = window.IntersectionObserver && new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); });
    if (io) io.observe(box);
    const onVis = () => { if (!document.hidden) start(); };
    // экран перерисовали — щит ушёл из DOM: освобождаем WebGL (браузер держит всего ~16 контекстов)
    const watch = setInterval(() => { if (!box.isConnected) stop(); }, 2000);
    document.addEventListener("visibilitychange", onVis);
    let stopped = false;
    function stop() {
      if (stopped) return;
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearInterval(watch);
      if (io) io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }

    // Палец: щит крутится за ним во все стороны, отпустил — летит по инерции
    let lastMove = 0;
    box.addEventListener("pointerdown", (e) => {
      st.drag = { x: e.clientX, y: e.clientY };
      st.vy = st.vp = 0;
      lastMove = performance.now();
      try { box.setPointerCapture(e.pointerId); } catch { /* не критично */ }
      onGrab();
      start();
    });
    box.addEventListener("pointermove", (e) => {
      if (!st.drag) return;
      const now = performance.now(), dt = Math.max(0.008, (now - lastMove) / 1000);
      const dx = (e.clientX - st.drag.x) * 0.7, dy = (e.clientY - st.drag.y) * 0.5;
      st.yaw += dx; st.pitch += dy;
      // скорость сглаживаем, чтобы последний рывок пальца не решал всё
      st.vy = st.vy * 0.6 + (dx / dt) * 0.4; st.vp = st.vp * 0.6 + (dy / dt) * 0.4;
      st.drag = { x: e.clientX, y: e.clientY };
      lastMove = now;
    });
    const release = () => {
      if (!st.drag) return;
      st.drag = null;
      if (performance.now() - lastMove > 80) st.vy = st.vp = 0; // палец остановился перед отпусканием
      st.vy = Math.max(-1400, Math.min(1400, st.vy)); st.vp = Math.max(-600, Math.min(600, st.vp));
      st.freeUntil = performance.now() + 4000;
    };
    box.addEventListener("pointerup", release);
    box.addEventListener("pointercancel", release);
    // для проверок: застыть в позе (yaw, pitch), null — снова живой
    box.aegisPose = (yaw, pitch) => { st.pose = yaw == null ? null : [yaw, pitch]; start(); };

    box.prepend(canvas);
    box.classList.add("gl");
    start();
    return true;
  } catch (e) {
    console.warn("Аегис 3D:", e);
    canvas.remove();
    return false;
  }
}
