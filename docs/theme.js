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
  // Первый запуск: справочники и тексты качаются вместе со скриптами, а не после них. Со второго запуска их
  // отдаёт service worker из кэша, а предзагрузка мимо него только мешает
  if (!(navigator.serviceWorker && navigator.serviceWorker.controller)) {
    ["https://api.opendota.com/api/constants/heroes", "https://api.opendota.com/api/constants/items",
      "https://api.opendota.com/api/constants/item_ids", "abilities.json", "knowledge.json?v=12", "texts.json?v=19"].forEach(function (href) {
      var link = document.createElement("link");
      link.rel = "preload";
      link.as = "fetch";
      link.crossOrigin = "anonymous";
      link.href = href;
      document.head.append(link);
    });
  }
})();
