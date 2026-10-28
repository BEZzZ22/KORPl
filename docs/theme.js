// Дизайн до первой отрисовки: тёмный минимал с моушном. Классика (style.css без html.v2) больше не включается,
// код её лежит как есть — вернуть можно, если снова читать выбор отсюда.
(function () {
  var root = document.documentElement;
  root.classList.add("v2");
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", "#09090b");
  var font = document.createElement("link");
  font.rel = "stylesheet";
  font.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@500;600;700&display=swap";
  document.head.append(font);
})();
