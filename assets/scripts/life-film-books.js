(() => {
  "use strict";

  const data = window.LIFE_LIBRARY_DATA;
  if (!data) return;

  const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const normalSearch = (value) => value.normalize("NFKD").toLocaleLowerCase().replace(/\s+/g, " ");

  const mediumColours = {
    Documentary: "#667f76",
    "TV Shows": "#705d89",
    Films: "#9a6049",
    Animation: "#477e9b",
    "News Reports (Ongoing)": "#3d708d",
    "Variety /Reality Shows": "#9a5f78",
  };

  const renderFilmWall = () => {
    const grid = document.querySelector("[data-film-wall]");
    const toolbar = document.querySelector("[data-film-toolbar]");
    const search = document.querySelector("[data-film-search]");
    const count = document.querySelector("[data-film-count]");
    if (!grid || !toolbar) return;

    const addPlaceholder = (card, work) => {
      if (card.querySelector(".film-poster-placeholder")) return;
      const displayTitle = work.title;
      const words = displayTitle.match(/[\p{L}\p{N}]+/gu) || [displayTitle];
      const mark = words.length > 1 && words.every((word) => /^\p{Script=Latin}/u.test(word))
        ? words.slice(0, 3).map((word) => word[0]).join("")
        : [...displayTitle.replace(/[^\p{L}\p{N}]/gu, "")].slice(0, 2).join("");
      const placeholder = document.createElement("div");
      placeholder.className = "film-poster-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      const monogram = document.createElement("b");
      monogram.textContent = mark || "•";
      const medium = document.createElement("span");
      medium.textContent = `${work.medium} · ${work.country.replace(/（.+?）/g, "")}`;
      placeholder.append(monogram, medium);
      card.prepend(placeholder);
    };

    const fragment = document.createDocumentFragment();
    const cards = data.watched.map((work, index) => {
      const card = document.createElement("article");
      card.className = `film-poster-card${work.favourite ? " is-favourite" : ""}${work.poster ? " has-poster" : ""}`;
      card.dataset.medium = work.medium;
      card.dataset.favourite = String(work.favourite);
      card.dataset.search = normalSearch(`${work.title} ${work.translatedTitle || ""} ${work.country}`);
      card.style.setProperty("--poster-accent", mediumColours[work.medium] || "#8a684c");

      if (work.poster) {
        card.classList.add("is-loading");
        const image = document.createElement("img");
        if (index < 24) image.src = work.poster;
        else image.dataset.src = work.poster;
        image.alt = "";
        image.width = 500;
        image.height = 741;
        image.loading = "eager";
        image.decoding = "async";
        image.addEventListener("load", () => card.classList.remove("is-loading"), { once: true });
        image.addEventListener("error", () => {
          image.remove();
          card.classList.remove("has-poster", "is-loading");
          addPlaceholder(card, work);
        }, { once: true });
        card.append(image);
      } else {
        addPlaceholder(card, work);
      }

      const copy = document.createElement("div");
      copy.className = "film-poster-copy";
      const title = document.createElement("strong");
      title.textContent = work.title;
      const meta = document.createElement("small");
      meta.textContent = [work.translatedTitle, work.year].filter(Boolean).join(" · ");
      copy.append(title, meta);
      card.append(copy);

      const sourceUrl = work.sourceUrl || (work.imdbId ? `https://www.imdb.com/title/${work.imdbId}/` : "");
      const sourceLabel = work.sourceLabel || "IMDb";
      if (sourceUrl) {
        const link = document.createElement("a");
        link.className = "film-poster-link";
        link.href = sourceUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `${work.title}${work.favourite ? ", favourite" : ""} on ${sourceLabel}`);
        card.append(link);
      }

      fragment.append(card);
      return card;
    });
    grid.append(fragment);

    const deferredImages = [...grid.querySelectorAll("img[data-src]")];
    const loadImage = (image) => {
      if (!image.dataset.src) return;
      image.src = image.dataset.src;
      delete image.dataset.src;
    };
    if ("IntersectionObserver" in window) {
      const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          loadImage(entry.target);
          imageObserver.unobserve(entry.target);
        });
      }, { root: grid.closest(".film-scroll"), rootMargin: "900px 0px" });
      deferredImages.forEach((image) => imageObserver.observe(image));
    } else {
      deferredImages.forEach(loadImage);
    }

    let activeFilter = "all";
    const applyFilter = () => {
      const query = normalSearch(search?.value || "").trim();
      let visible = 0;
      grid.classList.toggle("is-favourites-view", activeFilter === "favourites");
      cards.forEach((card) => {
        const inCategory = activeFilter === "all"
          || (activeFilter === "favourites" && card.dataset.favourite === "true")
          || card.dataset.medium === activeFilter;
        const matchesSearch = !query || card.dataset.search.includes(query);
        card.hidden = !(inCategory && matchesSearch);
        if (!card.hidden) visible += 1;
      });
      if (count) count.textContent = `${visible} of ${cards.length} watched works`;
    };

    toolbar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-film-filter]");
      if (!button) return;
      activeFilter = button.dataset.filmFilter;
      toolbar.querySelectorAll("[data-film-filter]").forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      applyFilter();
    });
    search?.addEventListener("input", applyFilter);
    applyFilter();
  };

  const genres = [
    ["Fiction, Poetry & Literary Memoir", "Fiction & memoir"],
    ["Humanities & Social Sciences", "Humanities & society"],
    ["Economics, Politics & History", "Economics, politics & history"],
    ["Mathematics, Statistics & Machine Learning", "Math, statistics & ML"],
    ["Computer Science, Software & Engineering", "CS, software & engineering"],
    ["Cybersecurity", "Cybersecurity"],
    ["Language, Writing & Academic Study", "Language & study"],
    ["Articles, Reports, Manuals & Course Materials", "Reports & course material"],
  ];

  const renderBookShelfPreview = () => {
    const preview = document.querySelector("[data-book-shelf-preview]");
    const shelves = document.querySelector("[data-book-preview-shelves]");
    const summary = document.querySelector("[data-book-preview-summary]");
    if (!preview || !shelves) return;

    const fragment = document.createDocumentFragment();
    genres.forEach(([genre, label], shelfIndex) => {
      const shelf = document.createElement("div");
      shelf.className = "book-preview-shelf";
      shelf.dataset.domain = label;

      data.books
        .filter((book) => book.genre === genre)
        .forEach((book, bookIndex) => {
          const spine = document.createElement("i");
          const seed = [...book.title].reduce((total, character) => total + character.codePointAt(0), shelfIndex * 31 + bookIndex * 17);
          spine.className = `book-preview-spine lang-${slug(book.language)}${book.favourite ? " is-favourite" : ""}`;
          spine.style.setProperty("--spine-height", `${54 + (seed % 43)}%`);
          spine.style.setProperty("--spine-width", `${3 + (seed % 7)}px`);
          spine.style.setProperty("--spine-shift", `${seed % 13 === 0 ? (seed % 2 ? -3 : 3) : 0}deg`);
          shelf.append(spine);
        });

      fragment.append(shelf);
    });
    shelves.append(fragment);

    if (summary) summary.textContent = `${data.books.length} volumes · ${genres.length} shelves`;
  };

  const formatAdded = (value) => {
    if (!value) return "Date unavailable";
    return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value}Z`));
  };

  const formatAxisAdded = (value) => {
    const date = new Date(`${value}Z`);
    const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "2-digit" }).format(date);
    const time = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    return `${day} · ${time}`;
  };

  const renderBookTimeline = () => {
    const labels = document.querySelector("[data-book-y-axis]");
    const plot = document.querySelector("[data-book-plot]");
    const xAxis = document.querySelector("[data-book-x-axis]");
    const summary = document.querySelector("[data-book-summary]");
    if (!labels || !plot || !xAxis) return;

    const axisTitle = document.createElement("span");
    axisTitle.className = "book-axis-title";
    axisTitle.textContent = "Reading domain ↓";
    labels.append(axisTitle);
    genres.forEach(([, shortLabel]) => {
      const label = document.createElement("span");
      label.className = "book-genre-label";
      label.textContent = shortLabel;
      labels.append(label);
    });

    const datedBooks = data.books
      .map((book, sourceIndex) => ({ book, sourceIndex, timestamp: book.added ? Date.parse(`${book.added}Z`) : null }))
      .filter((entry) => Number.isFinite(entry.timestamp))
      .sort((left, right) => left.timestamp - right.timestamp || left.sourceIndex - right.sourceIndex);
    const chronologicalIndex = new Map(datedBooks.map((entry, index) => [entry.sourceIndex, index]));
    const tickIndexes = [...new Set([0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round((datedBooks.length - 1) * ratio)))];
    tickIndexes.forEach((index) => {
      const entry = datedBooks[index];
      if (!entry) return;
      const tick = document.createElement("span");
      tick.className = "book-tick";
      tick.style.left = `${4 + (index / Math.max(1, datedBooks.length - 1)) * 87}%`;
      tick.textContent = formatAxisAdded(entry.book.added);
      xAxis.append(tick);
    });
    const unmatchedTick = document.createElement("span");
    unmatchedTick.className = "book-tick is-unmatched";
    unmatchedTick.textContent = "Date unavailable";
    xAxis.append(unmatchedTick);

    const tooltip = document.createElement("div");
    tooltip.className = "book-tooltip";
    tooltip.hidden = true;
    document.body.append(tooltip);

    const positionTooltip = (dot) => {
      const rect = dot.getBoundingClientRect();
      tooltip.hidden = false;
      const tipRect = tooltip.getBoundingClientRect();
      const left = Math.min(window.innerWidth - tipRect.width - 12, Math.max(12, rect.left + rect.width / 2 - tipRect.width / 2));
      const preferAbove = rect.top > tipRect.height + 20;
      const top = preferAbove ? rect.top - tipRect.height - 11 : rect.bottom + 11;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(8, top)}px`;
    };

    const hideTooltip = () => { tooltip.hidden = true; };
    const fragment = document.createDocumentFragment();
    data.books.forEach((book, sourceIndex) => {
      const genreIndex = Math.max(0, genres.findIndex(([genre]) => genre === book.genre));
      const knownIndex = chronologicalIndex.get(sourceIndex);
      const x = knownIndex === undefined
        ? 96 + ((sourceIndex % 7) - 3) * 0.22
        : 4 + (knownIndex / Math.max(1, datedBooks.length - 1)) * 87;
      const jitter = (((sourceIndex * 37) % 17) - 8) * 1.65;
      const y = ((48 + genreIndex * 58 + 29 + jitter) / 512) * 100;
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = `book-dot lang-${slug(book.language)}${book.read ? "" : " is-unread"}${book.favourite ? " is-favourite" : ""}`;
      dot.style.left = `${x}%`;
      dot.style.top = `${y}%`;
      dot.setAttribute("aria-label", `${book.title}, ${book.language}, ${book.read ? "marked read" : "reading status uncertain"}, added ${formatAdded(book.added)}`);

      const showTooltip = () => {
        const author = book.author ? ` · ${book.author}` : "";
        tooltip.replaceChildren();
        const heading = document.createElement("strong");
        heading.textContent = book.title;
        const details = document.createElement("span");
        details.textContent = `${book.language} · ${book.country}${author}\n${book.read ? "Marked read" : "Reading status uncertain"} · ${formatAdded(book.added)}`;
        tooltip.append(heading, details);
        positionTooltip(dot);
      };
      dot.addEventListener("pointerenter", showTooltip);
      dot.addEventListener("pointerleave", hideTooltip);
      dot.addEventListener("focus", showTooltip);
      dot.addEventListener("blur", hideTooltip);
      fragment.append(dot);
    });
    plot.append(fragment);

    if (summary) {
      const uncertain = data.books.filter((book) => !book.read).length;
      summary.textContent = `${data.books.length} books · ${datedBooks.length} matched to Apple Books · ${uncertain} with uncertain reading status`;
    }
  };

  renderFilmWall();
  renderBookShelfPreview();
  renderBookTimeline();
})();
