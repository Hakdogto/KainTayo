(function () {
  const STORAGE_KEY = "kainTayoThemeV1";
  const META_LIGHT = "#fffaf3";
  const META_DARK = "#0f1218";

  function prefersDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function resolveTheme(stored) {
    if (stored === "dark" || stored === "light") return stored;
    return prefersDark() ? "dark" : "light";
  }

  function updateToggleIcons(isDark) {
    document.querySelectorAll(".theme-toggle").forEach((btn) => {
      btn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
      const moon = btn.querySelector(".theme-icon-moon");
      const sun = btn.querySelector(".theme-icon-sun");
      if (moon) moon.hidden = isDark;
      if (sun) sun.hidden = !isDark;
    });
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isDark ? META_DARK : META_LIGHT);
    updateToggleIcons(isDark);
  }

  const api = {
    get() {
      return resolveTheme(localStorage.getItem(STORAGE_KEY));
    },
    set(theme) {
      const next = theme === "dark" ? "dark" : "light";
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      window.dispatchEvent(new CustomEvent("kainTayoThemeChange", { detail: { theme: next } }));
      return next;
    },
    toggle() {
      return api.set(api.get() === "dark" ? "light" : "dark");
    },
    getMapboxStyleId() {
      return api.get() === "dark" ? "dark-v11" : "streets-v12";
    },
  };

  window.kainTayoTheme = api;

  applyTheme(api.get());

  document.addEventListener("click", (event) => {
    const btn = event.target.closest(".theme-toggle");
    if (!btn) return;
    event.preventDefault();
    api.toggle();
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const theme = resolveTheme(null);
    applyTheme(theme);
    window.dispatchEvent(new CustomEvent("kainTayoThemeChange", { detail: { theme } }));
  });
})();
