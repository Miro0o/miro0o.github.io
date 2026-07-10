(() => {
  "use strict";

  const storageKey = "miro0o-theme";
  const themes = new Set(["day", "night", "system"]);
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

  const readPreference = () => {
    try {
      const savedTheme = localStorage.getItem(storageKey);
      return themes.has(savedTheme) ? savedTheme : "system";
    } catch {
      return "system";
    }
  };

  const resolveTheme = (preference) => (
    preference === "system" ? (systemTheme.matches ? "night" : "day") : preference
  );

  const applyTheme = (preference, persist = false) => {
    const resolvedTheme = resolveTheme(preference);
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolvedTheme === "night" ? "dark" : "light";

    if (persist) {
      try {
        localStorage.setItem(storageKey, preference);
      } catch {
        // The theme still works when storage is unavailable.
      }
    }

    document.dispatchEvent(new CustomEvent("themechange", {
      detail: { preference, resolvedTheme }
    }));
  };

  applyTheme(readPreference());

  const updateControls = () => {
    const preference = document.documentElement.dataset.themePreference || "system";
    const label = `${preference[0].toUpperCase()}${preference.slice(1)} theme`;

    document.querySelectorAll("[data-theme-switcher]").forEach((switcher) => {
      const summary = switcher.querySelector("summary");
      if (summary) summary.setAttribute("aria-label", `Theme: ${label}`);

      switcher.querySelectorAll("[data-theme-option]").forEach((option) => {
        const selected = option.dataset.themeOption === preference;
        option.setAttribute("aria-checked", String(selected));
        option.classList.toggle("is-selected", selected);
      });
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    updateControls();

    document.querySelectorAll("[data-theme-option]").forEach((option) => {
      option.addEventListener("click", () => {
        const preference = option.dataset.themeOption;
        if (!themes.has(preference)) return;
        applyTheme(preference, true);
        updateControls();
        option.closest("details")?.removeAttribute("open");
      });
    });
  });

  systemTheme.addEventListener("change", () => {
    if (document.documentElement.dataset.themePreference !== "system") return;
    applyTheme("system");
    updateControls();
  });
})();
