/* Progressive enhancement only - every page works with JS disabled. */
(function () {
  "use strict";

  /* ---- Theme toggle ------------------------------------------------ */
  var toggle = document.querySelector(".theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var root = document.documentElement;
      var current = root.getAttribute("data-theme");
      if (!current) {
        current = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      var next = current === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
    });
  }

  /* ---- API directory: search + category filter --------------------- */
  var search = document.getElementById("api-search");
  var list = document.getElementById("api-list");
  if (!search || !list) return;

  var items = Array.prototype.slice.call(list.querySelectorAll(".api"));
  var chips = Array.prototype.slice.call(document.querySelectorAll(".chip"));
  var counter = document.getElementById("api-count");
  var emptyMsg = document.getElementById("api-empty");
  var activeCategory = "all";

  function apply() {
    var query = search.value.trim().toLowerCase();
    var terms = query ? query.split(/\s+/) : [];
    var shown = 0;

    items.forEach(function (item) {
      var haystack = item.getAttribute("data-search") || "";
      var matchesCategory =
        activeCategory === "all" || item.getAttribute("data-category") === activeCategory;
      var matchesQuery = terms.every(function (t) { return haystack.indexOf(t) !== -1; });
      var visible = matchesCategory && matchesQuery;
      item.hidden = !visible;
      if (visible) shown++;
    });

    if (counter) {
      counter.textContent =
        shown === items.length
          ? "Showing all " + items.length + " APIs"
          : "Showing " + shown + " of " + items.length + " APIs";
    }
    if (emptyMsg) emptyMsg.hidden = shown !== 0;
  }

  search.addEventListener("input", apply);

  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      chips.forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      activeCategory = chip.getAttribute("data-filter");
      apply();
    });
  });

  /* "/" focuses search, Escape clears it. */
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "/" && document.activeElement !== search) {
      ev.preventDefault();
      search.focus();
    } else if (ev.key === "Escape" && document.activeElement === search) {
      search.value = "";
      apply();
    }
  });

  apply();
})();
