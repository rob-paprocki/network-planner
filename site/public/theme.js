// Auto / Light / Dark theme choice, remembered in this browser. Loaded in <head> on every page so the
// saved choice applies before first paint. Auto follows the system setting.
(function () {
  var KEY = "netplanner.theme";
  var root = document.documentElement;
  function get() { try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; } }
  function apply(t) {
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme");
    var btns = document.querySelectorAll(".themes button");
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-pressed", String(btns[i].dataset.theme === t));
  }
  apply(get());
  document.addEventListener("DOMContentLoaded", function () {
    apply(get());
    var btns = document.querySelectorAll(".themes button");
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener("click", function () {
      var t = this.dataset.theme;
      try { localStorage.setItem(KEY, t); } catch (e) { /* private window: still switch for this visit */ }
      apply(t);
    });
  });
})();
