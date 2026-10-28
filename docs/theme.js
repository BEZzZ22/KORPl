// Выбор дизайна до первой отрисовки: «Новый» (тёмный минимал с моушном) или «Классика» (ночная карта).
// ?design=v2 / ?design=classic в ссылке переключает и запоминает. Выбор живёт в браузере телефона.
(function () {
  var KEY = "design";
  var pick = null;
  try {
    var q = new URLSearchParams(location.search).get("design");
    if (q === "v2" || q === "classic") localStorage.setItem(KEY, q);
    pick = localStorage.getItem(KEY);
  } catch (e) { /* приватный режим: остаёмся на классике */ }
  if (pick !== "v2") return;
  var root = document.documentElement;
  root.classList.add("v2");
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", "#09090b");
  var font = document.createElement("link");
  font.rel = "stylesheet";
  font.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@500;600;700&display=swap";
  document.head.append(font);
})();
