(() => {
  const grid = document.querySelector("[data-music-wall]");
  const albums = window.MUSIC_WALL_ALBUMS || [];
  if (!grid || !albums.length) return;

  const trackCount = 7;
  const trackAngleDegrees = -10;
  const trackAngleRadians = trackAngleDegrees * Math.PI / 180;
  const tracks = [];

  const greatestCommonDivisor = (left, right) => {
    let a = left;
    let b = right;

    while (b) [a, b] = [b, a % b];
    return a;
  };

  let albumStride = Math.max(1, Math.round(albums.length * 0.382));
  while (greatestCommonDivisor(albumStride, albums.length) !== 1) albumStride += 1;

  const albumCycle = albums.map((_, index) => albums[(index * albumStride) % albums.length]);

  const createTile = (album, interactive, eager) => {
    const link = document.createElement("a");
    link.className = "album-tile";
    link.href = `https://music.163.com/#/album?id=${album.id}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.setAttribute("aria-label", `${album.name} by ${album.artist}`);

    if (!interactive) {
      link.tabIndex = -1;
      link.setAttribute("aria-hidden", "true");
    }

    const image = document.createElement("img");
    image.src = album.cover;
    image.alt = "";
    image.width = 420;
    image.height = 420;
    image.loading = eager ? "eager" : "lazy";
    if (eager) image.fetchPriority = "high";
    else image.fetchPriority = "low";
    image.decoding = "async";
    image.addEventListener("error", () => link.classList.add("has-image-error"));

    const details = document.createElement("span");
    details.className = "album-details";
    const context = album.plays ? `${album.plays} plays · ${album.song}` : album.song;
    details.innerHTML = `<strong></strong><span></span><small></small>`;
    details.querySelector("strong").textContent = album.name;
    details.querySelector("span").textContent = album.artist;
    details.querySelector("small").textContent = context;

    link.append(image, details);
    return link;
  };

  const createSequence = (trackIndex, trackAlbums, duplicate = false) => {
    const sequence = document.createElement("div");
    sequence.className = "album-sequence";

    if (duplicate || trackIndex > 0) sequence.setAttribute("aria-hidden", "true");

    trackAlbums.forEach((album, index) => {
      const interactive = trackIndex === 0 && !duplicate;
      const eager = trackIndex < 2 && !duplicate && index < 18;
      sequence.append(createTile(album, interactive, eager));
    });

    return sequence;
  };

  const fragment = document.createDocumentFragment();

  for (let index = 0; index < trackCount; index += 1) {
    const track = document.createElement("div");
    // Reverse both the album order and the animation direction on alternate
    // rows. They appear to travel the other way while advancing through the
    // same album timeline as the forward rows.
    const trackAlbums = index % 2 ? [...albumCycle].reverse() : albumCycle;
    track.className = `album-track${index % 2 ? " is-reverse" : ""}`;
    track.append(
      createSequence(index, trackAlbums),
      createSequence(index, trackAlbums, true)
    );
    tracks.push(track);
    fragment.append(track);
  }

  grid.append(fragment);
  grid.closest(".life-stage")?.classList.add("is-ready");

  const updateRoll = () => {
    const sequenceWidth = tracks[0]?.querySelector(".album-sequence")?.scrollWidth || 0;
    const duration = Math.min(300, Math.max(140, sequenceWidth / 65));
    const wall = grid.closest(".album-wall");
    const intro = document.querySelector(".music-intro");
    const tile = tracks[0]?.querySelector(".album-tile");
    const trackGap = parseFloat(getComputedStyle(grid).getPropertyValue("--track-gap")) || 0;

    if (!wall || !tile) return;

    const wallRect = wall.getBoundingClientRect();
    const introRight = intro?.getBoundingClientRect().right || wallRect.left;
    const visibleStart = Math.max(wallRect.left, introRight);
    const visibleCenter = (visibleStart + wallRect.right) / 2;
    const phaseCenter = (wallRect.left + wallRect.right) / 2;
    const gridRect = grid.getBoundingClientRect();
    const gridLeft = gridRect.left;
    const trackLeft = gridLeft + tracks[0].offsetLeft;
    const tilePitch = tile.offsetWidth + trackGap;
    const angleCosine = Math.cos(trackAngleRadians);
    const angleSine = Math.sin(trackAngleRadians);
    const localVisibleCenter = (visibleCenter - trackLeft) / angleCosine;
    const phaseAlbumOffset = (phaseCenter - trackLeft) / angleCosine / tilePitch;
    const verticalShiftAtCenter = angleSine * localVisibleCenter;
    const projectedTileHeight = tile.offsetHeight * (Math.abs(angleCosine) + Math.abs(angleSine));
    const verticalSweep = Math.abs(angleSine) * (wallRect.right - visibleStart) / 2;
    const firstCenter = projectedTileHeight / 2 - verticalSweep;
    const lastCenter = wallRect.height - projectedTileHeight / 2 + verticalSweep;
    const coveredHeight = Math.max(0, lastCenter - firstCenter);

    tracks.forEach((track, index) => {
      // Space the belts evenly around the shared 100-album timeline. The
      // center correction makes the phase refer to the visible screen center,
      // rather than the track's off-screen origin. Reversed arrays need one
      // extra album to account for their N - 1 - index mapping.
      const centerCorrection = (index % 2
        ? phaseAlbumOffset + 1
        : -phaseAlbumOffset) / albums.length;
      const beltPhase = index / trackCount;
      const correctedPhase = ((centerCorrection + beltPhase) % 1 + 1) % 1;
      const desiredCenter = wallRect.top
        + firstCenter
        + (coveredHeight * index) / (trackCount - 1);
      const trackTop = desiredCenter
        - gridRect.top
        - tile.offsetHeight / 2
        - verticalShiftAtCenter;

      track.style.setProperty("--track-top", `${trackTop}px`);
      track.style.setProperty("--track-duration", `${duration}s`);
      track.style.setProperty("--track-delay", `${-duration * correctedPhase}s`);
    });
  };

  const resizeObserver = new ResizeObserver(updateRoll);
  resizeObserver.observe(grid);
  updateRoll();

  const musicPanel = grid.closest("[data-life-panel]");

  const syncRollingState = () => {
    const shouldRoll = !document.hidden && musicPanel?.classList.contains("is-active");

    tracks.forEach((track) => {
      track.style.animationPlayState = shouldRoll ? "running" : "paused";
      track.getAnimations?.().forEach((animation) => {
        if (shouldRoll) animation.play();
        else animation.pause();
      });
    });

    grid.dataset.musicMotion = shouldRoll ? "running" : "paused";
  };

  const panelObserver = new MutationObserver(syncRollingState);
  if (musicPanel) panelObserver.observe(musicPanel, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("pageshow", syncRollingState);
  document.addEventListener("visibilitychange", syncRollingState);
  requestAnimationFrame(syncRollingState);
})();
