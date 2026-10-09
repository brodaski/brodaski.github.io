// Shared light/dark toggle. Needs a <button id="theme"> on the page.
(function () {
  var btn = document.getElementById("theme");
  var root = document.documentElement;
  var mq = matchMedia("(prefers-color-scheme: dark)");
  function isDark() { return root.dataset.theme ? root.dataset.theme === "dark" : mq.matches; }
  function paint() {
    if (!btn) return;
    btn.textContent = isDark() ? "Light mode" : "Dark mode";
    btn.setAttribute("aria-pressed", String(isDark()));
  }
  try { var t = localStorage.getItem("theme"); if (t === "light" || t === "dark") root.dataset.theme = t; } catch (e) {}
  if (btn) btn.onclick = function () {
    var next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
    paint();
  };
  mq.addEventListener("change", paint);
  paint();
})();
