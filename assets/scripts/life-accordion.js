(() => {
  "use strict";

  const accordion = document.querySelector("[data-life-accordion]");
  if (!accordion) return;

  const stage = accordion.closest(".life-stage");
  const panels = [...accordion.querySelectorAll("[data-life-panel]")];
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
  let activePanel = null;
  let pinnedPanel = null;

  const setContentState = (panel, expanded) => {
    const trigger = panel.querySelector(".panel-tab");
    const content = panel.querySelector("[data-panel-content]");

    trigger?.setAttribute("aria-expanded", String(expanded));
    if (!content) return;

    content.toggleAttribute("inert", !expanded);
    content.setAttribute("aria-hidden", String(!expanded));
  };

  const openPanel = (panel, pin = false) => {
    if (!panel) return;
    if (pin) pinnedPanel = panel;
    activePanel = panel;

    stage?.classList.add("has-open-panel");
    accordion.classList.add("has-open-panel");
    accordion.classList.remove("has-peek-panel");
    panels.forEach((candidate) => {
      const expanded = candidate === panel;
      candidate.classList.toggle("is-active", expanded);
      candidate.classList.remove("is-peeking");
      setContentState(candidate, expanded);
    });
  };

  const showPeek = (panel) => {
    if (!panel || pinnedPanel) return;
    if (panel.classList.contains("is-peeking")) return;

    accordion.classList.add("has-peek-panel");
    panels.forEach((candidate) => candidate.classList.toggle("is-peeking", candidate === panel));
  };

  const clearPeek = () => {
    accordion.classList.remove("has-peek-panel");
    panels.forEach((panel) => panel.classList.remove("is-peeking"));
  };

  const closePanel = (restoreFocus = false) => {
    const previousPanel = activePanel;
    activePanel = null;
    pinnedPanel = null;
    clearPeek();
    stage?.classList.remove("has-open-panel");
    accordion.classList.remove("has-open-panel");

    panels.forEach((panel) => {
      panel.classList.remove("is-active");
      setContentState(panel, false);
    });

    if (restoreFocus) previousPanel?.querySelector(".panel-tab")?.focus();
  };

  panels.forEach((panel) => {
    const trigger = panel.querySelector(".panel-tab");
    const close = panel.querySelector("[data-panel-close]");

    setContentState(panel, false);

    trigger?.addEventListener("focus", () => {
      showPeek(panel);
    });

    trigger?.addEventListener("click", () => {
      if (pinnedPanel === panel) {
        closePanel(true);
        return;
      }
      openPanel(panel, true);
    });

    close?.addEventListener("click", () => closePanel(true));
  });

  /*
   * Drive peeking from real pointer movement instead of translating the
   * growing panel. This keeps every panel in the flex flow, so neighbouring
   * clipped edges remain overlapped throughout the animation.
   */
  accordion.addEventListener("pointermove", (event) => {
    if (!canHover.matches || pinnedPanel) return;
    const panel = event.target.closest?.("[data-life-panel]");
    if (panel && accordion.contains(panel)) showPeek(panel);
  });

  accordion.addEventListener("pointerleave", () => {
    if (canHover.matches && !pinnedPanel) clearPeek();
  });

  accordion.addEventListener("focusout", (event) => {
    if (!pinnedPanel && !accordion.contains(event.relatedTarget)) clearPeek();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activePanel) closePanel(true);
  });

  document.addEventListener("pointerdown", (event) => {
    const isPageLink = event.target.closest?.("a[href]");
    if (activePanel && !accordion.contains(event.target) && !isPageLink) closePanel();
  });

  const openLinkedPanel = () => {
    const target = document.getElementById(window.location.hash.slice(1));
    const linkedPanel = target?.closest("[data-life-panel]");
    if (linkedPanel) openPanel(linkedPanel, true);
  };

  window.addEventListener("hashchange", openLinkedPanel);
  openLinkedPanel();
})();
