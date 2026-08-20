(() => {
  "use strict";

  const panel = document.querySelector(".module-travel");
  const container = panel?.querySelector("[data-travel-map]");
  if (!panel || !container) return;

  let data = null;
  const years = panel.querySelector("[data-travel-years]");
  const count = panel.querySelector("[data-travel-photo-count]");
  const locked = panel.querySelector("[data-travel-locked]");
  const viewer = panel.querySelector("[data-travel-viewer]");
  const viewerImageWrap = panel.querySelector(".travel-viewer__image-wrap");
  const viewerImageButton = panel.querySelector("[data-travel-viewer-toggle]");
  const viewerPrevious = panel.querySelector("[data-travel-viewer-previous]");
  const viewerNext = panel.querySelector("[data-travel-viewer-next]");
  const viewerImage = panel.querySelector("[data-travel-viewer-image]");
  const viewerCaption = panel.querySelector(".travel-viewer__caption");
  const viewerCountry = panel.querySelector("[data-travel-viewer-country]");
  const viewerPlace = panel.querySelector("[data-travel-viewer-place]");
  const viewerDescription = panel.querySelector("[data-travel-viewer-description]");
  const viewerMeta = panel.querySelector("[data-travel-viewer-meta]");
  const viewerYear = panel.querySelector("[data-travel-viewer-year]");
  const viewerPositionLabel = panel.querySelector("[data-travel-viewer-position]");
  const format = new Intl.NumberFormat("en");
  const compactTravelWidth = 900;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let map = null;
  let activeYear = 0;
  let viewerPhotos = [];
  let viewerPosition = 0;
  let viewerImageToken = 0;
  let viewerCamera = null;
  let viewerLocation = null;
  let viewerSwipe = null;
  let suppressViewerClick = false;
  let suppressViewerClickTimer = 0;
  let viewerLoaderTimer = 0;
  let viewerScale = 1;
  let viewerPanX = 0;
  let viewerPanY = 0;
  let viewerGesture = null;
  const viewerPointers = new Map();
  let assetsPromise = null;

  const loadScript = (source, ready) => new Promise((resolve, reject) => {
    if (ready()) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[data-travel-source="${source}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    script.dataset.travelSource = source;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load ${source}`)), { once: true });
    document.head.append(script);
  });

  const loadTravelAssets = () => {
    if (data) return Promise.resolve(data);
    if (!assetsPromise) {
      assetsPromise = Promise.all([
        loadScript("assets/data/world-outline.js?v=20260820-1", () => Boolean(window.WORLD_MAP || window.WORLD_OUTLINE)),
        loadScript(`assets/data/travel-data.js?v=${Date.now()}`, () => Boolean(window.TRAVEL_DATA))
      ]).then(() => {
        data = window.TRAVEL_DATA || { points: [], photos: [], places: [], stats: {} };
        renderYears();
        updateCount();
        locked.hidden = Boolean(data.privacyReviewed && (data.points?.length || data.photos?.length));
        return data;
      });
    }
    return assetsPromise;
  };

  const normaliseName = (value) => String(value || "").trim();
  const namePair = (localName, englishName) => {
    const local = normaliseName(localName);
    const english = normaliseName(englishName);
    if (!local) return { english: "", local: english };
    if (!english || local.localeCompare(english, undefined, { sensitivity: "base" }) === 0) {
      return { english: "", local };
    }
    return { english, local };
  };
  const splitMapName = (value) => {
    const [local, ...englishParts] = normaliseName(value).split(" · ");
    return englishParts.length ? namePair(local, englishParts.join(" · ")) : namePair(local, local);
  };
  const renderNamePair = (element, localName, englishName, suffix = "") => {
    const names = namePair(localName, englishName);
    const english = document.createElement("span");
    const local = document.createElement("span");
    const flag = document.createElement("span");
    english.className = "travel-name-pair__english";
    local.className = "travel-name-pair__local";
    flag.className = "travel-name-pair__flag";
    english.textContent = names.english;
    local.textContent = names.local;
    flag.textContent = suffix.trim();
    english.hidden = !names.english;
    flag.hidden = !flag.textContent;
    element.classList.add("travel-name-pair");
    element.replaceChildren(local, english, flag);
  };
  const flagEmoji = (countryCode) => /^[A-Z]{2}$/.test(countryCode || "")
    ? [...countryCode].map((character) => String.fromCodePoint(character.charCodeAt(0) + 127397)).join("")
    : "";
  const sameName = (first, second) => {
    const left = normaliseName(first);
    const right = normaliseName(second);
    return Boolean(left && right && left.localeCompare(right, undefined, { sensitivity: "base" }) === 0);
  };
  const isSingleLevelPlace = (photo) => (
    sameName(photo.city, photo.country) || sameName(photo.localName, photo.localCountry)
  );

  class PhotoAtlasMap {
    constructor(element, cities, onPhotos, onBackground, onInteraction) {
      this.element = element;
      this.cities = Array.isArray(cities) ? cities : [];
      this.onPhotos = onPhotos;
      this.onBackground = onBackground;
      this.onInteraction = onInteraction;
      this.world = window.WORLD_MAP || { land: window.WORLD_OUTLINE || [] };
      this.outline = Array.isArray(this.world.land)
        ? this.world.land.filter((polygon) => polygon.some((ring) => ring.some((coordinate) => coordinate[1] >= -60)))
        : [];
      this.countryBorders = Array.isArray(this.world.countryBorders) ? this.world.countryBorders : [];
      this.countryLabels = Array.isArray(this.world.countries) ? this.world.countries : [];
      this.provinceBorders = Array.isArray(this.world.provinceBorders) ? this.world.provinceBorders : [];
      this.provinceLabels = Array.isArray(this.world.provinces) ? this.world.provinces : [];
      this.contextCities = Array.isArray(this.world.cities) ? this.world.cities : [];
      this.canvas = document.createElement("canvas");
      this.canvas.className = "travel-map-canvas";
      this.canvas.setAttribute("aria-hidden", "true");
      // Alpha lets the static preview sit above the canvas during startup.
      // resize() immediately paints the matching ocean colour before the next
      // detailed frame, so a backing-store reset can never expose black.
      this.context = this.canvas.getContext("2d", { alpha: true });
      this.center = { longitude: 8, latitude: 31 };
      this.zoom = 1.5;
      this.minZoom = 1;
      this.maxZoom = 12;
      this.points = [];
      this.photos = [];
      this.hits = [];
      this.drag = null;
      this.pointers = new Map();
      this.pinch = null;
      this.gestureMoved = false;
      this.gestureHadMultiplePointers = false;
      this.hasFitted = false;
      this.frame = 0;
      this.cameraFrame = 0;
      this.hoveredHit = null;
      this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      this.element.replaceChildren(this.canvas, this.controls());
      this.bindEvents();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.element);
      this.themeObserver = new MutationObserver(() => this.requestRender());
      this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      this.resize();
    }

    cancelCameraAnimation() {
      if (!this.cameraFrame) return;
      cancelAnimationFrame(this.cameraFrame);
      this.cameraFrame = 0;
    }

    controls() {
      const controls = document.createElement("div");
      controls.className = "travel-map-controls";
      controls.innerHTML = `
        <button type="button" data-map-zoom="1" aria-label="Zoom travel map in">+</button>
        <button type="button" data-map-zoom="-1" aria-label="Zoom travel map out">−</button>
        <button type="button" data-map-home aria-label="Show all travel photographs">⌂</button>`;
      controls.addEventListener("click", (event) => {
        const zoomButton = event.target.closest("[data-map-zoom]");
        if (zoomButton) {
          this.onInteraction?.();
          this.zoomBy(Number(zoomButton.dataset.mapZoom));
        }
        if (event.target.closest("[data-map-home]")) {
          this.onInteraction?.();
          this.fitToPoints();
        }
      });
      return controls;
    }

    bindEvents() {
      const pointerPosition = (event) => {
        const rect = this.canvas.getBoundingClientRect();
        return {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
      };
      const startPinch = () => {
        const [first, second] = [...this.pointers.values()];
        if (!first || !second) return;
        const midpoint = {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2
        };
        const center = this.project(this.center.longitude, this.center.latitude, this.zoom);
        this.pinch = {
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          midpointX: midpoint.x,
          midpointY: midpoint.y,
          zoom: this.zoom,
          anchor: this.unproject(
            center.x + midpoint.x - this.width / 2,
            center.y + midpoint.y - this.height / 2,
            this.zoom
          )
        };
      };
      this.canvas.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.cancelCameraAnimation();
        this.canvas.setPointerCapture(event.pointerId);
        const position = pointerPosition(event);
        this.pointers.set(event.pointerId, position);
        if (this.pointers.size === 1) {
          this.gestureMoved = false;
          this.gestureHadMultiplePointers = false;
          this.pinch = null;
          this.drag = {
            pointerId: event.pointerId,
            startX: position.x,
            startY: position.y,
            lastX: position.x,
            lastY: position.y
          };
        } else {
          this.gestureHadMultiplePointers = true;
          this.drag = null;
          startPinch();
        }
        this.canvas.classList.add("is-dragging");
      });
      this.canvas.addEventListener("pointermove", (event) => {
        if (!this.pointers.has(event.pointerId)) {
          const hit = this.hitAt(event.offsetX, event.offsetY);
          if (hit !== this.hoveredHit) {
            this.hoveredHit = hit;
            this.canvas.classList.toggle("has-interactive-hit", Boolean(hit));
            this.requestRender();
          }
          return;
        }
        const position = pointerPosition(event);
        this.pointers.set(event.pointerId, position);
        if (this.pointers.size >= 2) {
          if (!this.pinch) startPinch();
          const [first, second] = [...this.pointers.values()];
          const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
          const midpoint = {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2
          };
          const midpointMovement = Math.hypot(
            midpoint.x - this.pinch.midpointX,
            midpoint.y - this.pinch.midpointY
          );
          if (!this.gestureMoved && (Math.abs(distance - this.pinch.distance) > 2 || midpointMovement > 3)) {
            this.gestureMoved = true;
            this.onInteraction?.();
          }
          const zoom = Math.max(
            this.minZoom,
            Math.min(this.maxZoom, this.pinch.zoom + Math.log2(distance / this.pinch.distance))
          );
          const anchor = this.project(this.pinch.anchor.longitude, this.pinch.anchor.latitude, zoom);
          this.zoom = zoom;
          this.setCenterFromWorld(
            anchor.x - midpoint.x + this.width / 2,
            anchor.y - midpoint.y + this.height / 2,
            zoom
          );
          this.requestRender();
          event.preventDefault();
          return;
        }
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        const distance = Math.hypot(position.x - this.drag.startX, position.y - this.drag.startY);
        if (distance > 3 && !this.gestureMoved) {
          this.gestureMoved = true;
          this.onInteraction?.();
        }
        const center = this.project(this.center.longitude, this.center.latitude, this.zoom);
        this.setCenterFromWorld(
          center.x - (position.x - this.drag.lastX),
          center.y - (position.y - this.drag.lastY),
          this.zoom
        );
        this.drag.lastX = position.x;
        this.drag.lastY = position.y;
        this.requestRender();
      });
      const endGesture = (event, allowClick) => {
        if (!this.pointers.has(event.pointerId)) return;
        const position = pointerPosition(event);
        this.pointers.set(event.pointerId, position);
        const isClick = allowClick
          && this.pointers.size === 1
          && !this.gestureMoved
          && !this.gestureHadMultiplePointers;
        this.canvas.releasePointerCapture?.(event.pointerId);
        this.pointers.delete(event.pointerId);
        if (this.pointers.size >= 2) {
          this.drag = null;
          startPinch();
        } else if (this.pointers.size === 1) {
          const [pointerId, remaining] = [...this.pointers.entries()][0];
          this.pinch = null;
          this.drag = {
            pointerId,
            startX: remaining.x,
            startY: remaining.y,
            lastX: remaining.x,
            lastY: remaining.y
          };
        } else {
          this.drag = null;
          this.pinch = null;
          this.canvas.classList.remove("is-dragging");
        }
        if (isClick && !this.activateHit(position.x, position.y)) {
          this.onBackground?.();
        }
      };
      this.canvas.addEventListener("pointerup", (event) => endGesture(event, true));
      this.canvas.addEventListener("pointercancel", (event) => endGesture(event, false));
      this.canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        this.onInteraction?.();
        this.cancelCameraAnimation();
        const rect = this.canvas.getBoundingClientRect();
        this.zoomAt(-event.deltaY * 0.0022, event.clientX - rect.left, event.clientY - rect.top);
      }, { passive: false });
      this.canvas.addEventListener("dblclick", (event) => {
        event.preventDefault();
        this.onInteraction?.();
        this.easeZoomAt(1.5, event.offsetX, event.offsetY);
      });
      this.canvas.addEventListener("pointerleave", () => {
        if (this.pointers.size || !this.hoveredHit) return;
        this.hoveredHit = null;
        this.canvas.classList.remove("has-interactive-hit");
        this.requestRender();
      });
    }

    setData(pointFeatures, photoFeatures) {
      this.points = pointFeatures.map((feature) => ({
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        ...feature.properties
      }));
      this.photos = photoFeatures.map((feature) => ({
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        ...feature.properties
      }));
      this.element.dataset.travelPointCount = String(this.points.length);
      this.element.dataset.travelSelectedPhotoCount = String(this.photos.length);
      if (!this.hasFitted && this.width && this.height) this.fitToPoints();
      else this.requestRender();
    }

    resize() {
      const rect = this.element.getBoundingClientRect();
      this.width = Math.max(1, Math.round(rect.width));
      this.height = Math.max(1, Math.round(rect.height));
      this.canvas.width = Math.round(this.width * this.pixelRatio);
      this.canvas.height = Math.round(this.height * this.pixelRatio);
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      this.context.fillStyle = this.palette().ocean;
      this.context.fillRect(0, 0, this.width, this.height);
      // Portrait layouts must be allowed to letterbox the world vertically;
      // constraining by height alone cropped Asia from the mobile home view.
      this.minZoom = Math.max(0, Math.log2(Math.min(this.width, this.height) / 256));
      this.zoom = Math.max(this.minZoom, this.zoom);
      const center = this.project(this.center.longitude, this.center.latitude, this.zoom);
      this.setCenterFromWorld(center.x, center.y, this.zoom);
      if (!this.hasFitted && (this.points.length || this.photos.length)) this.fitToPoints();
      else this.requestRender();
    }

    project(longitude, latitude, zoom) {
      const size = 256 * (2 ** zoom);
      const safeLatitude = Math.max(-85.051129, Math.min(85.051129, latitude));
      const sine = Math.sin(safeLatitude * Math.PI / 180);
      return {
        x: (longitude + 180) / 360 * size,
        y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size
      };
    }

    unproject(x, y, zoom) {
      const size = 256 * (2 ** zoom);
      return {
        longitude: ((((x / size) * 360) % 360) + 360) % 360 - 180,
        latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI
      };
    }

    setCenterFromWorld(x, y, zoom) {
      const worldSize = 256 * (2 ** zoom);
      const verticalInset = Math.min(worldSize / 2, this.height / 2);
      const constrainedY = Math.max(verticalInset, Math.min(worldSize - verticalInset, y));
      this.center = this.unproject(x, constrainedY, zoom);
    }

    screenPoint(longitude, latitude) {
      const worldSize = 256 * (2 ** this.zoom);
      const center = this.project(this.center.longitude, this.center.latitude, this.zoom);
      const point = this.project(longitude, latitude, this.zoom);
      let differenceX = point.x - center.x;
      if (differenceX > worldSize / 2) differenceX -= worldSize;
      if (differenceX < -worldSize / 2) differenceX += worldSize;
      return { x: this.width / 2 + differenceX, y: this.height / 2 + point.y - center.y };
    }

    fitToPoints() {
      const source = this.points.length ? this.points : this.photos;
      if (!source.length || !this.width || !this.height) return;
      const projected = source.map((point) => this.project(point.longitude, point.latitude, 0));
      const bounds = projected.reduce((result, point) => ({
        minX: Math.min(result.minX, point.x), maxX: Math.max(result.maxX, point.x),
        minY: Math.min(result.minY, point.y), maxY: Math.max(result.maxY, point.y)
      }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      const padding = Math.min(92, Math.max(34, this.width * 0.07));
      const availableWidth = Math.max(1, this.width - padding * 2);
      const availableHeight = Math.max(1, this.height - padding * 2);
      const scale = Math.min(
        availableWidth / Math.max(1, bounds.maxX - bounds.minX),
        availableHeight / Math.max(1, bounds.maxY - bounds.minY)
      );
      const targetZoom = Math.max(this.minZoom, Math.min(4.5, Math.log2(scale)));
      const targetCenter = this.unproject((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0);
      if (this.hasFitted) {
        this.easeTo({ center: [targetCenter.longitude, targetCenter.latitude], zoom: targetZoom });
        return;
      }
      this.zoom = targetZoom;
      this.center = targetCenter;
      const center = this.project(targetCenter.longitude, targetCenter.latitude, targetZoom);
      this.setCenterFromWorld(center.x, center.y, targetZoom);
      this.hasFitted = true;
      this.requestRender();
    }

    zoomAt(delta, x = this.width / 2, y = this.height / 2) {
      const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + delta));
      if (nextZoom === this.zoom) return;
      const currentCenter = this.project(this.center.longitude, this.center.latitude, this.zoom);
      const geographic = this.unproject(
        currentCenter.x + x - this.width / 2,
        currentCenter.y + y - this.height / 2,
        this.zoom
      );
      const target = this.project(geographic.longitude, geographic.latitude, nextZoom);
      this.zoom = nextZoom;
      this.setCenterFromWorld(
        target.x - x + this.width / 2,
        target.y - y + this.height / 2,
        nextZoom
      );
      this.requestRender();
    }

    zoomBy(delta) {
      this.easeTo({
        center: [this.center.longitude, this.center.latitude],
        zoom: this.zoom + delta
      });
    }

    easeZoomAt(delta, x = this.width / 2, y = this.height / 2) {
      const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + delta));
      if (nextZoom === this.zoom) return;
      const currentCenter = this.project(this.center.longitude, this.center.latitude, this.zoom);
      const geographic = this.unproject(
        currentCenter.x + x - this.width / 2,
        currentCenter.y + y - this.height / 2,
        this.zoom
      );
      const target = this.project(geographic.longitude, geographic.latitude, nextZoom);
      const targetCenter = this.unproject(
        target.x - x + this.width / 2,
        target.y - y + this.height / 2,
        nextZoom
      );
      this.easeTo({ center: [targetCenter.longitude, targetCenter.latitude], zoom: nextZoom });
    }

    easeTo({ center, zoom }, duration = 420) {
      this.cancelCameraAnimation();
      const startCenter = { ...this.center };
      const startZoom = this.zoom;
      const targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
      if (reducedMotion.matches || duration <= 0) {
        this.zoom = targetZoom;
        const projected = this.project(center[0], center[1], targetZoom);
        this.setCenterFromWorld(projected.x, projected.y, targetZoom);
        this.requestRender();
        return;
      }
      let longitudeDistance = center[0] - startCenter.longitude;
      if (longitudeDistance > 180) longitudeDistance -= 360;
      if (longitudeDistance < -180) longitudeDistance += 360;
      const latitudeDistance = center[1] - startCenter.latitude;
      const startTime = performance.now();
      const animate = (time) => {
        const progress = Math.min(1, (time - startTime) / duration);
        const eased = 1 - ((1 - progress) ** 3);
        this.zoom = startZoom + (targetZoom - startZoom) * eased;
        const longitude = startCenter.longitude + longitudeDistance * eased;
        const latitude = startCenter.latitude + latitudeDistance * eased;
        const projected = this.project(longitude, latitude, this.zoom);
        this.setCenterFromWorld(projected.x, projected.y, this.zoom);
        this.requestRender();
        if (progress < 1) this.cameraFrame = requestAnimationFrame(animate);
        else this.cameraFrame = 0;
      };
      this.cameraFrame = requestAnimationFrame(animate);
    }

    cameraState() {
      return {
        center: [this.center.longitude, this.center.latitude],
        zoom: this.zoom
      };
    }

    visiblePhotoIndexes() {
      const margin = 8;
      return this.photos
        .map((photo) => ({ photo, screen: this.screenPoint(photo.longitude, photo.latitude) }))
        .filter(({ screen }) => (
          screen.x >= -margin && screen.x <= this.width + margin
          && screen.y >= -margin && screen.y <= this.height + margin
        ))
        .sort((left, right) => (
          left.screen.y - right.screen.y || left.screen.x - right.screen.x
        ))
        .map(({ photo }) => photo.photoIndex);
    }

    focusLocation(longitude, latitude) {
      const targetZoom = this.zoom;
      const point = this.project(longitude, latitude, targetZoom);
      const compact = this.width <= compactTravelWidth;
      const xRatio = compact ? 0.5 : 0.79;
      const yRatio = compact ? 0.24 : 0.5;
      const targetCenter = this.unproject(
        point.x - this.width * xRatio + this.width / 2,
        point.y - this.height * yRatio + this.height / 2,
        targetZoom
      );
      this.easeTo({ center: [targetCenter.longitude, targetCenter.latitude], zoom: targetZoom }, 520);
    }

    hitAt(x, y) {
      return [...this.hits].reverse().find((item) => (
        item.kind === "photo" && Math.hypot(x - item.x, y - item.y) <= item.radius + 6
      )) || null;
    }

    activateHit(x, y) {
      const hit = [...this.hits].reverse().find((item) => Math.hypot(x - item.x, y - item.y) <= item.radius + 5);
      if (!hit) return false;
      if (hit.kind === "photo") {
        if (hit.count > 1 && this.zoom < 7.75) {
          this.onInteraction?.();
          this.easeTo({ center: [hit.longitude, hit.latitude], zoom: Math.min(this.maxZoom, this.zoom + 2) });
        } else {
          this.onPhotos(hit.photoIndexes, {
            longitude: hit.longitude,
            latitude: hit.latitude
          });
        }
        return true;
      }
      if (this.zoom < this.maxZoom) {
        this.onInteraction?.();
        this.easeTo({ center: [hit.longitude, hit.latitude], zoom: Math.min(this.maxZoom, this.zoom + 2) });
      }
      return true;
    }

    requestRender() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
    }

    palette() {
      if (document.documentElement.dataset.theme === "night") {
        return {
          ocean: "#111512",
          land: "#202823",
          coast: "rgba(151, 170, 160, 0.48)",
          countryBorder: "rgba(174, 193, 183, 0.38)",
          provinceBorder: "rgba(132, 153, 143, 0.22)",
          countryLabel: "rgba(213, 220, 215, 0.74)",
          provinceLabel: "rgba(169, 183, 175, 0.56)",
          cityLabel: "rgba(187, 199, 192, 0.68)",
          travelLabel: "rgba(235, 236, 231, 0.9)",
          halo: "rgba(32, 40, 35, 0.96)",
          point: "rgba(139, 160, 149, 0.52)",
          cluster: "rgba(174, 190, 181, 0.66)",
          photo: "rgba(220, 121, 98, 0.96)",
          photoCluster: "rgba(226, 132, 107, 0.94)",
          pointStroke: "rgba(17, 21, 18, 0.92)",
          photoStroke: "rgba(239, 234, 226, 0.95)"
        };
      }
      return {
        ocean: "#e4ebe7",
        land: "#f3f0e8",
        coast: "rgba(91, 108, 100, 0.56)",
        countryBorder: "rgba(76, 94, 85, 0.5)",
        provinceBorder: "rgba(94, 112, 103, 0.28)",
        countryLabel: "rgba(53, 67, 61, 0.76)",
        provinceLabel: "rgba(76, 91, 84, 0.62)",
        cityLabel: "rgba(73, 88, 81, 0.72)",
        travelLabel: "rgba(42, 55, 49, 0.88)",
        halo: "rgba(243, 240, 232, 0.96)",
        point: "rgba(65, 82, 75, 0.52)",
        cluster: "rgba(87, 105, 96, 0.68)",
        photo: "rgba(174, 70, 51, 0.96)",
        photoCluster: "rgba(183, 76, 56, 0.94)",
        pointStroke: "rgba(248, 246, 239, 0.92)",
        photoStroke: "rgba(255, 252, 245, 0.98)"
      };
    }

    traceRings(context, rings, close = true) {
      const worldSize = 256 * (2 ** this.zoom);
      for (const ring of rings) {
        const points = [];
        let previousX = null;
        let minimumX = Infinity;
        let maximumX = -Infinity;
        for (const coordinate of ring) {
          const screen = this.screenPoint(coordinate[0], coordinate[1]);
          let x = screen.x;
          if (previousX !== null) {
            while (x - previousX > worldSize / 2) x -= worldSize;
            while (previousX - x > worldSize / 2) x += worldSize;
          }
          points.push({ x, y: screen.y });
          minimumX = Math.min(minimumX, x);
          maximumX = Math.max(maximumX, x);
          previousX = x;
        }
        if (points.length < 2) continue;
        for (const shift of [-worldSize, 0, worldSize]) {
          if (maximumX + shift < -4 || minimumX + shift > this.width + 4) continue;
          context.moveTo(points[0].x + shift, points[0].y);
          for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x + shift, points[index].y);
          if (close) context.closePath();
        }
      }
    }

    drawOutline(context, palette) {
      context.save();
      context.fillStyle = palette.land;
      context.strokeStyle = palette.coast;
      context.lineWidth = 0.7;
      for (const polygon of this.outline) {
        context.beginPath();
        this.traceRings(context, polygon);
        context.fill("evenodd");
        context.stroke();
      }
      context.restore();
    }

    drawBorders(context, palette) {
      context.save();
      context.beginPath();
      for (const country of this.countryBorders) this.traceRings(context, country, false);
      context.strokeStyle = palette.countryBorder;
      context.lineWidth = this.zoom < 3 ? 0.48 : 0.68;
      context.stroke();
      if (this.zoom >= 3.15) {
        context.beginPath();
        for (const province of this.provinceBorders) this.traceRings(context, [province]);
        context.strokeStyle = palette.provinceBorder;
        context.lineWidth = 0.48;
        context.stroke();
      }
      context.restore();
    }

    label(context, text, x, y, options) {
      context.font = options.font;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const width = context.measureText(text).width;
      const height = options.height || 11;
      const box = {
        left: x - width / 2 - 3, right: x + width / 2 + 3,
        top: y - height / 2 - 2, bottom: y + height / 2 + 2
      };
      if (this.labelBoxes.some((other) => !(
        box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom
      ))) return false;
      this.labelBoxes.push(box);
      context.lineJoin = "round";
      context.lineWidth = options.haloWidth || 3;
      context.strokeStyle = options.halo;
      context.strokeText(text, x, y);
      context.fillStyle = options.fill;
      context.fillText(text, x, y);
      return true;
    }

    bilingualLabel(context, names, x, y, options) {
      const lines = names.english
        ? [
          { text: names.english, font: options.englishFont, height: options.englishHeight || 8 },
          { text: names.local, font: options.localFont, height: options.localHeight || 11 }
        ]
        : [{ text: names.local, font: options.localFont, height: options.localHeight || 11 }];
      const gap = lines.length > 1 ? (options.gap ?? 1) : 0;
      const totalHeight = lines.reduce((sum, line) => sum + line.height, 0) + gap;
      let maximumWidth = 0;
      for (const line of lines) {
        context.font = line.font;
        maximumWidth = Math.max(maximumWidth, context.measureText(line.text).width);
      }
      const box = {
        left: x - maximumWidth / 2 - 4,
        right: x + maximumWidth / 2 + 4,
        top: y - totalHeight / 2 - 3,
        bottom: y + totalHeight / 2 + 3
      };
      if (this.labelBoxes.some((other) => !(
        box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom
      ))) return false;
      this.labelBoxes.push(box);
      context.save();
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "round";
      context.strokeStyle = options.halo;
      context.fillStyle = options.fill;
      context.globalAlpha *= options.opacity ?? 1;
      let lineY = y - totalHeight / 2;
      for (const line of lines) {
        context.font = line.font;
        lineY += line.height / 2;
        context.lineWidth = options.haloWidth || 3;
        context.strokeText(line.text, x, lineY);
        context.fillText(line.text, x, lineY);
        lineY += line.height / 2 + gap;
      }
      context.restore();
      return true;
    }

    drawCountryLabels(context, palette) {
      if (this.zoom > 8.2) return;
      const limit = this.zoom < 1.8 ? 22 : this.zoom < 2.8 ? 46 : 92;
      const selectedCountryCodes = new Set(this.photos.map((photo) => photo.countryCode).filter(Boolean));
      const candidates = this.countryLabels
        .map((country) => ({ ...country, selected: selectedCountryCodes.has(country.code) }))
        .filter((country) => country.minZoom <= this.zoom + (country.selected ? 1.8 : 0.85))
        .sort((left, right) => Number(right.selected) - Number(left.selected) || left.rank - right.rank || left.minZoom - right.minZoom)
        .slice(0, limit);
      context.save();
      for (const country of candidates) {
        const point = this.screenPoint(country.longitude, country.latitude);
        if (point.x < -70 || point.x > this.width + 70 || point.y < -10 || point.y > this.height + 10) continue;
        const parsed = splitMapName(country.name);
        const names = namePair(country.localName || parsed.local, country.englishName || parsed.english || parsed.local);
        const nearbyPhoto = this.hits
          .filter((hit) => hit.kind === "photo" && Math.hypot(point.x - hit.x, point.y - hit.y) < hit.radius + 18)
          .sort((left, right) => right.radius - left.radius)[0];
        const labelHeight = names.english ? 22 : 12;
        const labelY = nearbyPhoto
          ? point.y - nearbyPhoto.radius - 5 - labelHeight / 2
          : point.y;
        const selectedSize = this.zoom < 2 ? 10.6 : 11.4;
        const regularSize = this.zoom < 2 ? 8.9 : 9.8;
        this.bilingualLabel(context, names, point.x, labelY, {
          englishFont: `${country.selected ? 630 : 520} ${country.selected ? 7.8 : 7}px system-ui, sans-serif`,
          localFont: `${country.selected ? 690 : 590} ${country.selected ? selectedSize : regularSize}px system-ui, sans-serif`,
          englishHeight: country.selected ? 8.8 : 8,
          localHeight: country.selected ? 12.2 : 10.8,
          fill: palette.countryLabel,
          halo: palette.halo,
          haloWidth: 4,
          opacity: this.zoom > 7.3 ? Math.max(0, (8.2 - this.zoom) / 0.9) : 1
        });
      }
      context.restore();
    }

    drawProvinceLabels(context, palette) {
      if (this.zoom < 3.25) return;
      const limit = this.zoom < 5 ? 20 : this.zoom < 7 ? 60 : this.provinceLabels.length;
      const candidates = this.provinceLabels
        .map((province) => ({
          ...province,
          selected: this.hasPhotoNear(province.longitude, province.latitude, 9, 6)
        }))
        .filter((province) => province.minZoom <= this.zoom + (province.selected ? 3 : 2.15))
        .sort((left, right) => Number(right.selected) - Number(left.selected) || left.rank - right.rank || left.minZoom - right.minZoom)
        .slice(0, limit);
      context.save();
      for (const province of candidates) {
        const point = this.screenPoint(province.longitude, province.latitude);
        if (point.x < -60 || point.x > this.width + 60 || point.y < -10 || point.y > this.height + 10) continue;
        const parsed = splitMapName(province.name);
        const names = namePair(province.localName || parsed.local, province.englishName || parsed.english || parsed.local);
        this.bilingualLabel(context, names, point.x, point.y, {
          englishFont: `${province.selected ? 600 : 500} ${province.selected ? 6.9 : 6.2}px system-ui, sans-serif`,
          localFont: `${province.selected ? 640 : 540} ${province.selected ? 9 : 7.8}px system-ui, sans-serif`,
          englishHeight: 7,
          localHeight: province.selected ? 10 : 8.8,
          fill: palette.provinceLabel, halo: palette.halo, haloWidth: 3.2
        });
      }
      context.restore();
    }

    drawContextCities(context, palette) {
      if (this.zoom < 2.15) return;
      const limit = this.zoom < 3 ? 24 : this.zoom < 4.4 ? 60 : this.contextCities.length;
      const candidates = this.contextCities
        .map((city) => ({
          ...city,
          selected: this.hasPhotoNear(city.longitude, city.latitude, 4.5, 3.5)
        }))
        .filter((city) => city.minZoom <= this.zoom + (city.selected ? 1.5 : 0.4))
        .sort((left, right) => Number(right.selected) - Number(left.selected) || left.minZoom - right.minZoom || right.rank - left.rank)
        .slice(0, limit);
      context.save();
      for (const city of candidates) {
        const point = this.screenPoint(city.longitude, city.latitude);
        if (point.x < -50 || point.x > this.width + 50 || point.y < -10 || point.y > this.height + 10) continue;
        const parsed = splitMapName(city.name);
        const names = namePair(city.localName || parsed.local, city.englishName || parsed.english || parsed.local);
        if (!this.bilingualLabel(context, names, point.x, point.y - 7, {
          englishFont: `${city.selected ? 600 : 500} ${city.selected ? 6.7 : 6.1}px system-ui, sans-serif`,
          localFont: `${city.selected ? 640 : 530} ${city.selected ? 8.8 : 7.5}px system-ui, sans-serif`,
          englishHeight: 6.8,
          localHeight: city.selected ? 9.8 : 8.4,
          fill: palette.cityLabel, halo: palette.halo, haloWidth: 3.2
        })) continue;
        context.beginPath();
        context.arc(point.x, point.y, city.selected ? 1.5 : 1.15, 0, Math.PI * 2);
        context.fillStyle = palette.cityLabel;
        context.fill();
      }
      context.restore();
    }

    drawCities(context, palette) {
      const visiblePlaces = new Set([...this.points, ...this.photos].map((point) => point.placeIndex).filter((index) => index >= 0));
      const limit = this.zoom < 2 ? 10 : this.zoom < 3.4 ? 22 : this.cities.length;
      const candidates = this.cities
        .map((city, index) => ({ ...city, index }))
        .filter((city) => visiblePlaces.has(city.index))
        .sort((left, right) => right.photoCount - left.photoCount)
        .slice(0, limit);
      context.save();
      for (const city of candidates) {
        const point = this.screenPoint(city.longitude, city.latitude);
        if (point.x < -30 || point.x > this.width + 30 || point.y < -12 || point.y > this.height + 12) continue;
        const names = namePair(city.localName, city.city);
        const nearbyCluster = this.hits
          .filter((hit) => Math.hypot(point.x - hit.x, point.y - hit.y) < hit.radius + 10)
          .sort((left, right) => right.radius - left.radius)[0];
        const labelHeight = names.english ? 20 : 12;
        const labelY = point.y - (nearbyCluster?.radius || 2) - 5 - labelHeight / 2;
        if (!this.bilingualLabel(context, names, point.x, labelY, {
          englishFont: `620 ${this.zoom < 2.4 ? 7.2 : 7.8}px system-ui, sans-serif`,
          localFont: `700 ${this.zoom < 2.4 ? 9.7 : 10.6}px system-ui, sans-serif`,
          englishHeight: 8.2,
          localHeight: 11.4,
          fill: palette.travelLabel, halo: palette.halo, haloWidth: 4
        })) continue;
        context.beginPath();
        context.arc(point.x, point.y, nearbyCluster ? 1 : 1.6, 0, Math.PI * 2);
        context.fillStyle = palette.travelLabel;
        context.fill();
      }
      context.restore();
    }

    hasPhotoNear(longitude, latitude, longitudeRadius, latitudeRadius) {
      return this.photos.some((photo) => {
        const longitudeDifference = Math.abs(photo.longitude - longitude);
        const wrappedLongitudeDifference = Math.min(longitudeDifference, 360 - longitudeDifference);
        return wrappedLongitudeDifference <= longitudeRadius && Math.abs(photo.latitude - latitude) <= latitudeRadius;
      });
    }

    drawBackgroundPoints(context, palette) {
      const farZoom = this.zoom <= 3.5;
      const cellSize = this.zoom > 9 ? 9 : this.zoom > 6 ? 12 : this.zoom > 3.5 ? 18 : 27;
      const buckets = new Map();
      for (const point of this.points) {
        const screen = this.screenPoint(point.longitude, point.latitude);
        if (screen.x < -cellSize || screen.x > this.width + cellSize || screen.y < -cellSize || screen.y > this.height + cellSize) continue;
        const key = `${Math.floor(screen.x / cellSize)},${Math.floor(screen.y / cellSize)}`;
        const bucket = buckets.get(key) || { x: 0, y: 0, longitude: 0, latitude: 0, count: 0 };
        bucket.x += screen.x;
        bucket.y += screen.y;
        bucket.longitude += point.longitude;
        bucket.latitude += point.latitude;
        bucket.count += 1;
        buckets.set(key, bucket);
      }

      this.hits = [];
      for (const bucket of buckets.values()) {
        const x = bucket.x / bucket.count;
        const y = bucket.y / bucket.count;
        const isCluster = bucket.count > 1;
        const radius = isCluster
          ? Math.min(farZoom ? 11.5 : 10, (farZoom ? 4.15 : 3.55) + Math.log10(bucket.count) * 2.05)
          : (farZoom ? 1.35 : 1.2);
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = isCluster ? palette.cluster : palette.point;
        context.fill();
        context.strokeStyle = palette.pointStroke;
        context.lineWidth = isCluster ? 0.7 : 0.4;
        context.stroke();
        this.hits.push({
          kind: "background", x, y, radius, count: bucket.count,
          longitude: bucket.longitude / bucket.count,
          latitude: bucket.latitude / bucket.count
        });
      }
      this.element.dataset.travelClusterCount = String(buckets.size);
    }

    drawPhotoPins(context, palette) {
      const cellSize = this.zoom > 9 ? 12 : this.zoom > 6 ? 17 : this.zoom > 3.5 ? 23 : 38;
      const buckets = new Map();
      for (const photo of this.photos) {
        const screen = this.screenPoint(photo.longitude, photo.latitude);
        if (screen.x < -cellSize || screen.x > this.width + cellSize || screen.y < -cellSize || screen.y > this.height + cellSize) continue;
        const key = `${Math.floor(screen.x / cellSize)},${Math.floor(screen.y / cellSize)}`;
        const bucket = buckets.get(key) || {
          x: 0, y: 0, longitude: 0, latitude: 0, count: 0, photoIndexes: []
        };
        bucket.x += screen.x;
        bucket.y += screen.y;
        bucket.longitude += photo.longitude;
        bucket.latitude += photo.latitude;
        bucket.count += 1;
        bucket.photoIndexes.push(photo.photoIndex);
        buckets.set(key, bucket);
      }

      for (const bucket of buckets.values()) {
        const x = bucket.x / bucket.count;
        const y = bucket.y / bucket.count;
        const isCluster = bucket.count > 1;
        const isHovered = this.hoveredHit?.photoIndexes?.some((index) => bucket.photoIndexes.includes(index));
        const baseRadius = isCluster ? Math.min(9.2, 4.9 + Math.log10(bucket.count) * 1.85) : 3.15;
        const radius = baseRadius + (isHovered ? 1.6 : 0);
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = isCluster ? palette.photoCluster : palette.photo;
        context.fill();
        context.strokeStyle = palette.photoStroke;
        context.lineWidth = isHovered ? 2 : (isCluster ? 1.25 : 1.1);
        context.stroke();
        if (!isCluster) {
          context.beginPath();
          context.arc(x, y, 0.9, 0, Math.PI * 2);
          context.fillStyle = palette.photoStroke;
          context.fill();
        }
        this.hits.push({
          kind: "photo", x, y, radius, count: bucket.count,
          longitude: bucket.longitude / bucket.count,
          latitude: bucket.latitude / bucket.count,
          photoIndexes: bucket.photoIndexes
        });
      }
      this.element.dataset.travelSelectedClusterCount = String(buckets.size);
    }

    render() {
      if (!this.context || !this.width || !this.height) return;
      const context = this.context;
      this.element.dataset.travelZoom = this.zoom.toFixed(2);
      this.element.dataset.travelCenterLongitude = this.center.longitude.toFixed(3);
      this.element.dataset.travelCenterLatitude = this.center.latitude.toFixed(3);
      const palette = this.palette();
      this.labelBoxes = [];
      context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      context.fillStyle = palette.ocean;
      context.fillRect(0, 0, this.width, this.height);
      this.drawOutline(context, palette);
      this.drawBorders(context, palette);
      this.drawBackgroundPoints(context, palette);
      this.drawPhotoPins(context, palette);

      // Labels intentionally render above every marker. Countries reserve
      // collision space first so dense photo clusters cannot erase them.
      this.drawCountryLabels(context, palette);
      this.drawCities(context, palette);
      this.drawProvinceLabels(context, palette);
      this.drawContextCities(context, palette);
    }
  }

  function pointFeatures() {
    const source = Array.isArray(data.points) ? data.points : [];
    return source
      .filter((point) => !activeYear || point[2] === activeYear)
      .map((point) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point[0], point[1]] },
        properties: { year: point[2], placeIndex: point[3] }
      }));
  }

  function photoFeatures() {
    const source = Array.isArray(data.photos) ? data.photos : [];
    return source
      .map((photo, photoIndex) => ({ photo, photoIndex }))
      .filter(({ photo }) => !activeYear || photo.year === activeYear)
      .map(({ photo, photoIndex }) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [photo.longitude, photo.latitude] },
        properties: { year: photo.year, placeIndex: photo.placeIndex, photoIndex, countryCode: photo.countryCode }
      }));
  }

  function imageUrl(photo) {
    const source = `${data.imageBaseUrl || "assets/images/traveling/published/"}${photo.filename}`;
    return data.imageVersion ? `${source}?v=${encodeURIComponent(data.imageVersion)}` : source;
  }

  function applyViewerTransform() {
    const rect = viewerImageWrap.getBoundingClientRect();
    const viewport = viewer.getBoundingClientRect();
    const maximumX = Math.max(0, (rect.width * viewerScale - viewport.width) / 2);
    const maximumY = Math.max(0, (rect.height * viewerScale - viewport.height) / 2);
    viewerPanX = Math.max(-maximumX, Math.min(maximumX, viewerPanX));
    viewerPanY = Math.max(-maximumY, Math.min(maximumY, viewerPanY));
    viewerImage.style.transform = `translate3d(${viewerPanX}px, ${viewerPanY}px, 0) scale(${viewerScale})`;
    viewerImageButton.classList.toggle("is-zoomed", viewerScale > 1.01);
  }

  function setViewerZoom(scale, panX = viewerPanX, panY = viewerPanY) {
    viewerScale = Math.max(1, Math.min(8, scale));
    viewerPanX = viewerScale === 1 ? 0 : panX;
    viewerPanY = viewerScale === 1 ? 0 : panY;
    applyViewerTransform();
  }

  function resetViewerTransform() {
    viewerPointers.clear();
    viewerGesture = null;
    viewerImageButton.classList.remove("is-gesturing");
    setViewerZoom(1, 0, 0);
  }

  function suppressNextViewerClick() {
    window.clearTimeout(suppressViewerClickTimer);
    suppressViewerClick = true;
    suppressViewerClickTimer = window.setTimeout(() => {
      suppressViewerClick = false;
    }, 420);
  }

  function measureCaptionItem(element, maximumWidth = "none") {
    if (!element || element.hidden) return 0;
    const probe = element.cloneNode(true);
    probe.removeAttribute("hidden");
    probe.setAttribute("aria-hidden", "true");
    Object.assign(probe.style, {
      position: "absolute",
      inset: "auto",
      width: "max-content",
      minWidth: "0",
      maxWidth: maximumWidth,
      whiteSpace: "nowrap",
      visibility: "hidden",
      pointerEvents: "none",
      transform: "none",
      transition: "none"
    });
    probe.querySelectorAll(".travel-name-pair").forEach((name) => Object.assign(name.style, {
      maxWidth: "none",
      flexWrap: "nowrap",
      whiteSpace: "nowrap"
    }));
    viewerCaption.append(probe);
    const width = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    return width;
  }

  function updateCaptionLayoutMode(captionWidth) {
    const hasDescription = !viewerDescription.hidden && Boolean(viewerDescription.textContent.trim());
    viewer.classList.remove("is-caption-stacked");
    if (!hasDescription) return;

    const locationWidth = measureCaptionItem(viewerPlace.closest(".travel-viewer__location"));
    const descriptionWidth = measureCaptionItem(viewerDescription, "68ch");
    const metaWidth = measureCaptionItem(viewerMeta);
    const layout = viewerCaption.querySelector(".travel-viewer__caption-layout");
    const columnGap = Number.parseFloat(getComputedStyle(layout).columnGap) || 0;
    const outsideColumnWidth = Math.max(locationWidth, metaWidth);
    const requiredInlineWidth = outsideColumnWidth * 2 + descriptionWidth + columnGap * 2;
    let shouldStack = requiredInlineWidth > captionWidth;
    viewer.classList.toggle("is-caption-stacked", shouldStack);
    if (!shouldStack) {
      const renderedLocationWidth = viewerPlace.closest(".travel-viewer__location").getBoundingClientRect().width;
      shouldStack = renderedLocationWidth + 0.5 < locationWidth;
      viewer.classList.toggle("is-caption-stacked", shouldStack);
    }
  }

  function layoutViewerImage() {
    if (!viewerImage.naturalWidth || !viewerImage.naturalHeight) return;
    const bounds = viewer.getBoundingClientRect();
    const mobile = bounds.width <= compactTravelWidth;
    const expanded = viewer.classList.contains("is-expanded");
    const fit = (maximumWidth, maximumHeight) => {
      const scale = Math.min(
        maximumWidth / viewerImage.naturalWidth,
        maximumHeight / viewerImage.naturalHeight
      );
      return {
        width: Math.max(1, Math.round(viewerImage.naturalWidth * scale)),
        height: Math.max(1, Math.round(viewerImage.naturalHeight * scale))
      };
    };
    const maximumPreviewWidth = mobile ? bounds.width * 0.88 : Math.min(bounds.width * 0.62, 980);
    const maximumPreviewHeight = bounds.height * (mobile ? 0.52 : 0.82);
    let preview = fit(maximumPreviewWidth, maximumPreviewHeight);
    const large = fit(
      mobile ? bounds.width - 24 : Math.min(bounds.width * 0.94, 1400),
      bounds.height * (mobile ? 0.88 : 0.9)
    );
    const captionInset = mobile ? 16 : 40;
    const minimumCaptionWidth = mobile ? 288 : 360;
    const captionWidth = Math.min(
      Math.max(preview.width, minimumCaptionWidth),
      Math.max(1, bounds.width - captionInset * 2)
    );
    viewer.style.setProperty("--travel-caption-width", `${Math.round(captionWidth)}px`);
    updateCaptionLayoutMode(captionWidth);

    // Caption height changes with translated names, optional descriptions,
    // photo counts, and container-query layout. Reserve its real height before
    // fitting the photograph so neither long copy nor a narrow screen can push
    // the final line outside the map viewport.
    const captionHeight = viewerCaption?.scrollHeight || 0;
    const topInset = mobile ? 12 : 18;
    const bottomInset = mobile ? 9 : 12;
    const availableImageHeight = Math.max(1, bounds.height - topInset - captionHeight - bottomInset);
    if (preview.height > availableImageHeight) {
      preview = fit(maximumPreviewWidth, Math.min(maximumPreviewHeight, availableImageHeight));
    }
    const preferredCenterY = bounds.height * (mobile ? 0.59 : 0.44);
    const earliestCenterY = topInset + preview.height / 2;
    const latestCenterY = bounds.height - captionHeight - bottomInset - preview.height / 2;
    const previewCenterY = Math.max(earliestCenterY, Math.min(preferredCenterY, latestCenterY));
    const shown = expanded ? large : preview;
    viewer.style.setProperty("--travel-preview-width", `${preview.width}px`);
    viewer.style.setProperty("--travel-preview-height", `${preview.height}px`);
    viewer.style.setProperty("--travel-photo-width", `${shown.width}px`);
    viewer.style.setProperty("--travel-photo-height", `${shown.height}px`);
    viewer.style.setProperty("--travel-preview-center-y", `${Math.round(previewCenterY)}px`);
    viewer.style.setProperty("--travel-caption-top", `${Math.round(previewCenterY + preview.height / 2)}px`);
    applyViewerTransform();
  }

  function setViewerExpanded(expanded) {
    resetViewerTransform();
    viewer.classList.toggle("is-expanded", expanded);
    panel.classList.toggle("is-photo-expanded", expanded);
    viewerImageButton.setAttribute("aria-label", expanded ? "Return photograph to map" : "View photograph larger");
    requestAnimationFrame(layoutViewerImage);
  }

  function stopViewerLoader() {
    window.clearTimeout(viewerLoaderTimer);
    viewerLoaderTimer = 0;
    viewer.classList.remove("is-image-loading");
  }

  function renderViewer() {
    const photoIndex = viewerPhotos[viewerPosition];
    const photo = data.photos?.[photoIndex];
    if (!photo) return;
    const flag = flagEmoji(photo.countryCode);
    const imageToken = ++viewerImageToken;
    resetViewerTransform();
    stopViewerLoader();
    viewer.classList.remove("is-image-ready");
    viewerImage.classList.add("is-loading");
    viewerLoaderTimer = window.setTimeout(() => {
      if (imageToken === viewerImageToken && !viewer.classList.contains("is-image-ready")) {
        viewer.classList.add("is-image-loading");
      }
    }, 10);
    viewerImage.onload = () => {
      if (imageToken !== viewerImageToken) return;
      stopViewerLoader();
      layoutViewerImage();
      viewer.classList.add("is-image-ready");
      viewerImage.classList.remove("is-loading");
    };
    viewerImage.onerror = () => {
      if (imageToken !== viewerImageToken) return;
      stopViewerLoader();
      viewerImage.classList.remove("is-loading");
    };
    viewerImage.src = imageUrl(photo);
    viewerImage.alt = `Travel photograph from ${photo.city || photo.country || "a selected location"}`;
    if (isSingleLevelPlace(photo)) {
      renderNamePair(viewerPlace, photo.localName || photo.localCountry || "Unknown place", photo.city || photo.country, flag);
      viewerCountry.replaceChildren();
      viewerCountry.hidden = true;
    } else {
      renderNamePair(viewerPlace, photo.localName || "Unknown place", photo.city);
      renderNamePair(viewerCountry, photo.localCountry, photo.country, flag);
      viewerCountry.hidden = false;
    }
    viewerDescription.textContent = photo.description || "";
    viewerDescription.hidden = !photo.description;
    viewer.classList.toggle("has-caption-description", Boolean(photo.description));
    const hasMultiple = viewerPhotos.length > 1;
    const year = String(photo.year || "");
    const position = hasMultiple ? `${viewerPosition + 1} / ${viewerPhotos.length}` : "";
    viewerYear.textContent = year;
    viewerYear.hidden = !year;
    viewerPositionLabel.textContent = position;
    viewerPositionLabel.hidden = !position;
    viewerMeta.hidden = !year && !position;
    viewerMeta.setAttribute("aria-label", [year, position && `photograph ${position}`].filter(Boolean).join(", "));
    viewerPrevious.hidden = !hasMultiple;
    viewerNext.hidden = !hasMultiple;
    viewer.dataset.photoId = photo.id;
  }

  function openViewer(photoIndexes, location) {
    const selectedPhotos = [...new Set(photoIndexes)].filter((index) => data.photos?.[index]);
    const visiblePhotos = map?.visiblePhotoIndexes() || [];
    viewerPhotos = [
      ...selectedPhotos,
      ...visiblePhotos.filter((index) => !selectedPhotos.includes(index))
    ];
    if (!viewerPhotos.length) return;
    if (!panel.classList.contains("is-photo-open")) viewerCamera = map?.cameraState() || null;
    viewerPosition = 0;
    const firstPhoto = data.photos[viewerPhotos[0]];
    viewerLocation = location || {
      longitude: firstPhoto.longitude,
      latitude: firstPhoto.latitude
    };
    setViewerExpanded(false);
    renderViewer();
    panel.classList.add("is-photo-open");
    viewer.setAttribute("aria-hidden", "false");
    map?.focusLocation(viewerLocation.longitude, viewerLocation.latitude);
    viewerImageButton.focus({ preventScroll: true });
  }

  function closeViewer(restoreFocus = false, restoreCamera = true) {
    if (panel.classList.contains("is-photo-open")) panel.classList.remove("is-photo-open");
    panel.classList.remove("is-photo-expanded");
    viewer.classList.remove("is-expanded", "is-image-ready");
    stopViewerLoader();
    if (viewer.getAttribute("aria-hidden") !== "true") viewer.setAttribute("aria-hidden", "true");
    const camera = viewerCamera;
    viewerCamera = null;
    viewerLocation = null;
    if (restoreCamera && camera) map?.easeTo(camera, 520);
    viewerImageToken += 1;
    viewerImage.onload = null;
    viewerImage.onerror = null;
    viewerImage.classList.remove("is-loading");
    if (viewerImage.hasAttribute("src")) viewerImage.removeAttribute("src");
    viewerPrevious.hidden = true;
    viewerNext.hidden = true;
    window.clearTimeout(suppressViewerClickTimer);
    suppressViewerClick = false;
    resetViewerTransform();
    viewerPhotos = [];
    if (restoreFocus && panel.classList.contains("is-active")) {
      container.querySelector("[data-map-home]")?.focus({ preventScroll: true });
    }
  }

  function moveViewer(direction) {
    if (viewerPhotos.length < 2) return;
    viewerPosition = (viewerPosition + direction + viewerPhotos.length) % viewerPhotos.length;
    renderViewer();
    const photo = data.photos?.[viewerPhotos[viewerPosition]];
    if (!photo) return;
    viewerLocation = { longitude: photo.longitude, latitude: photo.latitude };
    map?.focusLocation(photo.longitude, photo.latitude);
  }

  function updateCount() {
    const selected = (data.photos || []).filter((photo) => !activeYear || photo.year === activeYear).length;
    count.textContent = `${format.format(selected)} selected photo${selected === 1 ? "" : "s"}`;
  }

  function setYear(year, button) {
    activeYear = year;
    years.querySelectorAll("button").forEach((candidate) => (
      candidate.setAttribute("aria-pressed", String(candidate === button))
    ));
    closeViewer();
    updateCount();
    map?.setData(pointFeatures(), photoFeatures());
  }

  function renderYears() {
    const available = [...new Set((data.points || []).map((point) => point[2]).filter(Boolean))].sort((a, b) => b - a);
    if (available.length < 2) {
      years.hidden = true;
      return;
    }
    years.innerHTML = [0, ...available].map((year) => (
      `<button type="button" data-travel-year="${year}" aria-pressed="${year === 0}"><span>${year || "All"}</span></button>`
    )).join("");
    years.addEventListener("click", (event) => {
      const button = event.target.closest("[data-travel-year]");
      if (button) setYear(Number(button.dataset.travelYear), button);
    });
  }

  async function initialiseMap() {
    if (map) {
      map.resize();
      map.render();
      requestAnimationFrame(() => {
        if (panel.classList.contains("is-active")) panel.classList.add("is-map-loaded");
      });
      return;
    }
    try {
      await loadTravelAssets();
    } catch (error) {
      locked.hidden = false;
      locked.querySelector("strong").textContent = "Atlas unavailable";
      locked.querySelector("span").textContent = "The map could not be loaded. Please try again.";
      console.error(error);
      return;
    }
    if (!panel.classList.contains("is-active")) return;
    if (!data.privacyReviewed || (!data.points?.length && !data.photos?.length)) {
      locked.hidden = false;
      return;
    }
    map = new PhotoAtlasMap(
      container,
      data.places,
      openViewer,
      () => closeViewer(false, true),
      () => closeViewer(false, false)
    );
    map.setData(pointFeatures(), photoFeatures());
    map.render();
    requestAnimationFrame(() => {
      if (panel.classList.contains("is-active")) panel.classList.add("is-map-loaded");
    });
    locked.hidden = true;
  }

  const startPinchGesture = () => {
    const pointers = [...viewerPointers.values()];
    if (pointers.length < 2) return;
    const [first, second] = pointers;
    viewerGesture = {
      mode: "pinch",
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      midpointX: (first.x + second.x) / 2,
      midpointY: (first.y + second.y) / 2,
      scale: viewerScale,
      panX: viewerPanX,
      panY: viewerPanY,
      moved: false
    };
  };

  viewerPrevious.addEventListener("click", (event) => {
    event.stopPropagation();
    moveViewer(-1);
  });
  viewerNext.addEventListener("click", (event) => {
    event.stopPropagation();
    moveViewer(1);
  });

  viewerImageButton.addEventListener("pointerdown", (event) => {
    viewerImageButton.setPointerCapture?.(event.pointerId);
    if (!viewer.classList.contains("is-expanded")) {
      if (event.isPrimary) viewerSwipe = { x: event.clientX, y: event.clientY };
      return;
    }
    viewerPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewerImageButton.classList.add("is-gesturing");
    if (viewerPointers.size >= 2) {
      startPinchGesture();
      return;
    }
    viewerGesture = {
      mode: "pan",
      x: event.clientX,
      y: event.clientY,
      panX: viewerPanX,
      panY: viewerPanY,
      moved: false
    };
  });
  viewerImageButton.addEventListener("pointermove", (event) => {
    if (!viewer.classList.contains("is-expanded") || !viewerPointers.has(event.pointerId)) return;
    viewerPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (viewerPointers.size >= 2) {
      if (viewerGesture?.mode !== "pinch") startPinchGesture();
      const [first, second] = [...viewerPointers.values()];
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midpointX = (first.x + second.x) / 2;
      const midpointY = (first.y + second.y) / 2;
      const movement = Math.hypot(midpointX - viewerGesture.midpointX, midpointY - viewerGesture.midpointY);
      if (Math.abs(distance - viewerGesture.distance) > 3 || movement > 3) viewerGesture.moved = true;
      setViewerZoom(
        viewerGesture.scale * distance / viewerGesture.distance,
        viewerGesture.panX + midpointX - viewerGesture.midpointX,
        viewerGesture.panY + midpointY - viewerGesture.midpointY
      );
      event.preventDefault();
      return;
    }
    if (viewerGesture?.mode !== "pan") return;
    const differenceX = event.clientX - viewerGesture.x;
    const differenceY = event.clientY - viewerGesture.y;
    if (Math.hypot(differenceX, differenceY) > 3) viewerGesture.moved = true;
    if (viewerScale > 1) {
      setViewerZoom(viewerScale, viewerGesture.panX + differenceX, viewerGesture.panY + differenceY);
      event.preventDefault();
    }
  });
  viewerImageButton.addEventListener("pointerup", (event) => {
    if (!viewer.classList.contains("is-expanded")) {
      if (!viewerSwipe) return;
      const differenceX = event.clientX - viewerSwipe.x;
      const differenceY = event.clientY - viewerSwipe.y;
      viewerSwipe = null;
      if (viewerPhotos.length > 1 && Math.abs(differenceX) > 44 && Math.abs(differenceX) > Math.abs(differenceY)) {
        suppressNextViewerClick();
        moveViewer(differenceX < 0 ? 1 : -1);
      }
      return;
    }
    if (viewerGesture?.moved) suppressNextViewerClick();
    viewerPointers.delete(event.pointerId);
    if (viewerPointers.size >= 2) startPinchGesture();
    else if (viewerPointers.size === 1) {
      const pointer = [...viewerPointers.values()][0];
      viewerGesture = {
        mode: "pan", x: pointer.x, y: pointer.y,
        panX: viewerPanX, panY: viewerPanY, moved: false
      };
    } else {
      viewerGesture = null;
      viewerImageButton.classList.remove("is-gesturing");
    }
  });
  viewerImageButton.addEventListener("pointercancel", (event) => {
    viewerSwipe = null;
    viewerPointers.delete(event.pointerId);
    if (!viewerPointers.size) {
      viewerGesture = null;
      viewerImageButton.classList.remove("is-gesturing");
    }
  });
  viewerImageButton.addEventListener("wheel", (event) => {
    if (!viewer.classList.contains("is-expanded")) return;
    event.preventDefault();
    event.stopPropagation();
    setViewerZoom(viewerScale * Math.exp(-event.deltaY * 0.0018));
  }, { passive: false });
  viewerImageButton.addEventListener("click", (event) => {
    if (suppressViewerClick) {
      window.clearTimeout(suppressViewerClickTimer);
      suppressViewerClick = false;
      event.preventDefault();
      return;
    }
    setViewerExpanded(!viewer.classList.contains("is-expanded"));
  });
  document.addEventListener("keydown", (event) => {
    if (viewer.getAttribute("aria-hidden") === "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (viewer.classList.contains("is-expanded")) setViewerExpanded(false);
      else closeViewer(true, true);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveViewer(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveViewer(1);
    }
    if (viewer.classList.contains("is-expanded") && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      setViewerZoom(viewerScale * 1.25);
    }
    if (viewer.classList.contains("is-expanded") && event.key === "-") {
      event.preventDefault();
      setViewerZoom(viewerScale / 1.25);
    }
    if (viewer.classList.contains("is-expanded") && event.key === "0") {
      event.preventDefault();
      resetViewerTransform();
    }
  });

  new ResizeObserver(() => {
    if (viewer.getAttribute("aria-hidden") === "false") layoutViewerImage();
  }).observe(viewer);

  const warmTravelAssets = () => void loadTravelAssets().catch(() => {});
  panel.querySelector(".panel-tab")?.addEventListener("pointerenter", warmTravelAssets, { once: true });
  panel.querySelector(".panel-tab")?.addEventListener("focus", warmTravelAssets, { once: true });

  let activationTimer = 0;
  const activationDelay = reducedMotion.matches ? 0 : 480;
  const scheduleMap = () => {
    window.clearTimeout(activationTimer);
    activationTimer = window.setTimeout(() => {
      if (panel.classList.contains("is-active")) void initialiseMap();
    }, activationDelay);
  };
  let wasActive = panel.classList.contains("is-active");
  const activationObserver = new MutationObserver(() => {
    const isActive = panel.classList.contains("is-active");
    if (isActive === wasActive) return;
    wasActive = isActive;
    if (isActive) scheduleMap();
    else {
      window.clearTimeout(activationTimer);
      panel.classList.remove("is-map-loaded");
      closeViewer();
    }
  });
  activationObserver.observe(panel, { attributes: true, attributeFilter: ["class"] });
  if (panel.classList.contains("is-active")) scheduleMap();
})();
