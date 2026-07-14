(() => {
  "use strict";

  const world = document.querySelector(".games-world");
  const scroller = world?.querySelector("[data-games-scroll]");
  if (!world || !scroller) return;

  const panel = world.closest("[data-life-panel]");
  const features = [...world.querySelectorAll("[data-game-feature]")];
  const archive = world.querySelector("#games-archive");
  const sections = archive ? [...features, archive] : features;
  const jumpLinks = [...world.querySelectorAll("[data-game-jump]")];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const visibility = new Map(sections.map((section) => [section, 0]));
  let visibleFeature = null;

  world.querySelectorAll(".game-media img").forEach((image) => {
    image.addEventListener("error", () => {
      const videoId = image.closest("[data-video-id]")?.dataset.videoId;
      if (videoId && !image.src.includes("hqdefault")) image.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    });
  });

  const setViewportHeight = () => {
    scroller.style.setProperty("--games-viewport", `${scroller.clientHeight}px`);
  };

  const panelIsVisible = () => panel.classList.contains("is-active") || panel.classList.contains("is-peeking");

  const pauseMontage = (feature, unload = false) => {
    const video = feature?.querySelector(".game-montage");
    if (!video) return;
    video.pause();
    if (unload) {
      feature.classList.remove("has-live-video");
      if (video.hasAttribute("src")) {
        video.removeAttribute("src");
        video.load();
      }
    }
  };

  const unloadMontages = () => {
    features.forEach((feature) => {
      pauseMontage(feature, true);
      feature.classList.remove("is-current");
    });
    visibleFeature = null;
  };

  const playMontage = (feature) => {
    if (!feature || !panelIsVisible()) return;
    const video = feature.querySelector(".game-montage");
    if (!video?.dataset.src) return;
    if (!video.hasAttribute("src")) {
      video.src = video.dataset.src;
      video.load();
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      feature.classList.add("has-live-video");
    } else {
      video.addEventListener("loadeddata", () => {
        if (feature.classList.contains("is-current") && panelIsVisible()) {
          feature.classList.add("has-live-video");
        }
      }, { once: true });
    }
    video.play().catch(() => {});
  };

  const selectFeature = (feature) => {
    if (visibleFeature === feature) return;
    world.classList.toggle("is-archive-current", feature === archive);
    features.forEach((candidate) => {
      candidate.classList.toggle("is-current", candidate === feature);
    });
    jumpLinks.forEach((link) => link.classList.toggle("is-current", link.hash === `#${feature.id}`));
    visibleFeature = feature;
    if (features.includes(feature)) playMontage(feature);
  };

  features.forEach((feature) => {
    const video = feature.querySelector(".game-montage");
    video?.addEventListener("playing", () => feature.classList.add("has-live-video"));
    video?.addEventListener("error", () => feature.classList.remove("has-live-video"));
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
      if (!entry.isIntersecting && features.includes(entry.target)) pauseMontage(entry.target);
    });
    const mostVisible = sections.reduce((best, section) => (
      visibility.get(section) > visibility.get(best) ? section : best
    ), sections[0]);
    if (visibility.get(mostVisible) > 0) selectFeature(mostVisible);
  }, { root: scroller, threshold: [0, 0.28, 0.55, 0.78] });

  sections.forEach((section) => observer.observe(section));
  new ResizeObserver(setViewportHeight).observe(scroller);
  setViewportHeight();

  jumpLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = world.querySelector(link.hash);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
    });
  });

  new MutationObserver(() => {
    if (panelIsVisible()) {
      const linkedSection = window.location.hash ? world.querySelector(window.location.hash) : null;
      const destination = panel.classList.contains("is-active") && sections.includes(linkedSection)
        ? linkedSection
        : features[0];
      if (destination) {
        if (panel.classList.contains("is-active")) {
          if (destination === features[0]) scroller.scrollTo({ top: 0, behavior: "auto" });
          else destination.scrollIntoView({ behavior: "auto", block: "start" });
        }
        selectFeature(destination);
        playMontage(destination);
      }
    } else {
      unloadMontages();
    }
  }).observe(panel, { attributes: true, attributeFilter: ["class"] });

})();
