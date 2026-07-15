#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(siteRoot, "../../..");
const listPath = resolve(
  workspaceRoot,
  "miniWorldModel/Other Networks of Knowledge/Arts & Humanities/My Info Lists.md",
);
const booksDb =
  "/Users/mir0/Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/BKLibrary-1-091020131601.sqlite";
const outputPath = resolve(siteRoot, "assets/data/life-library-data.js");
const cachePath = resolve(siteRoot, "assets/data/imdb-poster-cache.json");
const refreshPosters = process.argv.includes("--refresh-posters");

const lines = readFileSync(listPath, "utf8").split(/\r?\n/);

const cleanMarkdown = (value) => value
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/<[^>]+>/g, "")
  .replace(/\s*⭐\s*/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const normalize = (value) => cleanMarkdown(value)
  .normalize("NFKD")
  .toLocaleLowerCase("en")
  .replace(/&/g, "and")
  .replace(/\b(the|a|an)\b/g, " ")
  .replace(/[^\p{L}\p{N}]+/gu, "")
  .replace(/(english|chinese|edition|ed|volume|vol|copy|copies|版本|第[一二三四五六七八九十\d]+版|上下册|全\d+册)/gu, "");

const bigrams = (value) => {
  const result = new Map();
  for (let index = 0; index < value.length - 1; index += 1) {
    const gram = value.slice(index, index + 2);
    result.set(gram, (result.get(gram) || 0) + 1);
  }
  return result;
};

const similarity = (left, right) => {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (Math.min(left.length, right.length) >= 7 && (left.includes(right) || right.includes(left))) {
    return 0.9 * Math.min(left.length, right.length) / Math.max(left.length, right.length) + 0.1;
  }
  const a = bigrams(left);
  const b = bigrams(right);
  let intersection = 0;
  for (const [gram, count] of a) intersection += Math.min(count, b.get(gram) || 0);
  return (2 * intersection) / Math.max(1, left.length + right.length - 2);
};

const parseSection = (startHeading, endHeading, onEntry) => {
  let active = false;
  let section = "";
  let country = "";
  let listParents = [];

  const indentWidth = (prefix) => [...prefix].reduce((width, character) => (
    width + (character === "\t" ? 4 : 1)
  ), 0);

  for (const line of lines) {
    if (line.startsWith(startHeading)) {
      active = true;
      continue;
    }
    if (active && line.startsWith(endHeading)) break;
    if (!active) continue;

    const levelThree = line.match(/^###\s+(.+)/);
    const levelFour = line.match(/^####\s+(.+)/);
    if (levelThree) {
      section = cleanMarkdown(levelThree[1]);
      country = "";
      listParents = [];
      continue;
    }
    if (levelFour) {
      country = cleanMarkdown(levelFour[1]);
      listParents = [];
      continue;
    }

    const entry = line.match(/^(\s*)- \[([ xX])\]\s+(.+)/);
    if (entry) {
      const indent = indentWidth(entry[1]);
      const inheritedFavourite = listParents.some((parent) => parent.indent < indent && parent.favourite);
      listParents = listParents.filter((parent) => parent.indent < indent);
      onEntry({
        checked: entry[2].toLowerCase() === "x",
        raw: entry[3],
        section,
        country,
        inheritedFavourite,
      });
      continue;
    }

    const parent = line.match(/^(\s*)-\s+(?!\[[ xX]\])(.+)/);
    if (parent) {
      const indent = indentWidth(parent[1]);
      listParents = listParents.filter((candidate) => candidate.indent < indent);
      listParents.push({ indent, favourite: parent[2].includes("⭐") });
    }
  }
};

const books = [];
parseSection("## ✍ Texts Based", "## 🎬 Videos Based", ({ checked, raw, section, country, inheritedFavourite }) => {
  const favourite = raw.includes("⭐") || inheritedFavourite;
  const cleaned = cleanMarkdown(raw);
  const divider = cleaned.search(/\s*[—｜]\s*/);
  const title = divider >= 0 ? cleaned.slice(0, divider).trim() : cleaned;
  const author = divider >= 0 ? cleaned.slice(divider).replace(/^\s*[—｜]\s*/, "").trim() : "";
  books.push({ title, author, genre: section, country, read: checked, favourite });
});

const watched = [];
const parseMediaTitle = (raw) => {
  const cleaned = cleanMarkdown(raw);
  const divider = cleaned.indexOf(" — ");
  return {
    title: (divider >= 0 ? cleaned.slice(0, divider) : cleaned).trim(),
    translatedTitle: (divider >= 0 ? cleaned.slice(divider + 3) : "").trim(),
  };
};

parseSection("## 🎬 Videos Based", "## Others", ({ checked, raw, section, country, inheritedFavourite }) => {
  if (!checked) return;
  const favourite = raw.includes("⭐") || inheritedFavourite;
  const { title, translatedTitle } = parseMediaTitle(raw);
  watched.push({ title, translatedTitle, medium: section, country, favourite });
});

/*
 * News and variety entries are intentionally ongoing rather than checkbox
 * items. Import only leaf bullets so network labels such as NBC and NPR do
 * not become poster cards themselves.
 */
const ongoingMediaSections = new Set(["News Reports (Ongoing)", "Variety /Reality Shows"]);
const indentWidth = (prefix) => [...prefix].reduce((width, character) => (
  width + (character === "\t" ? 4 : 1)
), 0);
let inVideoSection = false;
let ongoingSection = "";
let ongoingCountry = "";
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (line.startsWith("## 🎬 Videos Based")) {
    inVideoSection = true;
    continue;
  }
  if (inVideoSection && line.startsWith("## Others")) break;
  if (!inVideoSection) continue;

  const levelThree = line.match(/^###\s+(.+)/);
  const levelFour = line.match(/^####\s+(.+)/);
  if (levelThree) {
    ongoingSection = cleanMarkdown(levelThree[1]);
    ongoingCountry = "";
    continue;
  }
  if (levelFour) {
    ongoingCountry = cleanMarkdown(levelFour[1]);
    continue;
  }
  if (!ongoingMediaSections.has(ongoingSection)) continue;

  const entry = line.match(/^(\s*)-\s+(?!\[[ xX]\])(.+)/);
  if (!entry) continue;
  const entryIndent = indentWidth(entry[1]);
  let nextContent = index + 1;
  while (nextContent < lines.length && !lines[nextContent].trim()) nextContent += 1;
  const child = lines[nextContent]?.match(/^(\s*)-\s+(?:\[[ xX]\]\s+)?(.+)/);
  if (child && indentWidth(child[1]) > entryIndent) continue;

  const { title, translatedTitle } = parseMediaTitle(entry[2]);
  watched.push({
    title,
    translatedTitle,
    medium: ongoingSection,
    country: ongoingCountry,
    favourite: entry[2].includes("⭐"),
  });
}

const sqliteJson = execFileSync("sqlite3", [
  "-json",
  booksDb,
  `select
    ZTITLE as title,
    ZAUTHOR as author,
    ZLANGUAGE as language,
    ZGENRE as genre,
    datetime(ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') as added,
    ZISFINISHED as finished,
    ZREADINGPROGRESS as progress
  from ZBKLIBRARYASSET
  where ZTITLE is not null`,
], { encoding: "utf8" });
const libraryAssets = JSON.parse(sqliteJson);

const inferLanguage = (book, match) => {
  const stored = (match?.language || "").toLowerCase();
  if (stored.startsWith("zh")) return "Chinese";
  if (stored.startsWith("ja")) return "Japanese";
  if (stored.startsWith("fr")) return "French";
  if (stored.startsWith("de")) return "German";
  if (stored.startsWith("ru")) return "Russian";
  if (stored.startsWith("en")) return "English";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(book.title)) return "Japanese";
  const hasHan = /\p{Script=Han}/u.test(book.title);
  const hasLatin = /\p{Script=Latin}/u.test(book.title);
  if (hasHan && hasLatin && /[/／]|英中|中英|English.+Chinese/i.test(book.title)) return "Bilingual";
  if (hasHan) return "Chinese";
  return "English";
};

for (const book of books) {
  const titleKey = normalize(book.title);
  const authorKey = normalize(book.author);
  let best = null;
  let bestScore = 0;

  for (const asset of libraryAssets) {
    const titleScore = similarity(titleKey, normalize(asset.title || ""));
    const authorScore = authorKey && asset.author ? similarity(authorKey, normalize(asset.author)) : 0;
    const score = titleScore + Math.min(0.12, authorScore * 0.12);
    if (score > bestScore) {
      best = asset;
      bestScore = score;
    }
  }

  const match = bestScore >= 0.56 ? best : null;
  book.added = match?.added || null;
  book.language = inferLanguage(book, match);
  book.libraryMatch = match ? Number(bestScore.toFixed(2)) : null;
}

let posterCache = {};
try {
  posterCache = JSON.parse(readFileSync(cachePath, "utf8"));
} catch {
  posterCache = {};
}

const imdbKinds = {
  Documentary: new Set(["documentary", "TV series", "TV mini-series", "feature", "TV movie"]),
  "TV Shows": new Set(["TV series", "TV mini-series", "TV movie"]),
  Films: new Set(["feature", "TV movie", "TV special"]),
  Animation: new Set(["feature", "TV series", "TV mini-series", "TV movie"]),
  "News Reports (Ongoing)": new Set(["TV series", "TV mini-series", "TV movie", "podcastSeries"]),
  "Variety /Reality Shows": new Set(["TV series", "TV mini-series", "TV movie", "TV special", "podcastSeries"]),
};

/* Localized titles for which IMDb's first suggestion is known to be wrong. */
const posterQueryOverrides = new Map([
  ["中国市长", "tt4056808"],
  ["西游记（1986年电视剧）", "tt1163129"],
  ["武林外传（电视剧）", "tt1353771"],
  ["倚天屠龙记（苏有朋版）", "tt1471140"],
  ["三国演义（1994年电视剧）", "tt0108914"],
  ["天龙八部（黄日华、陈浩民版）", "tt0827972"],
  ["隋唐英雄传", null],
  ["爆丸小子", null],
  ["功夫足球", "tt0439940"],
  ["新白娘子传奇", "tt2162790"],
  ["爱情公寓（电影）", "tt8893870"],
  ["Mission: Impossible 2", "tt0120755"],
  ["Mission: Impossible – Dead Reckoning", "tt9603212"],
  ["非诚勿扰2", "tt1810602"],
  ["人在囧途", "tt1737237"],
  ["英雄本色", "tt0092263"],
  ["英雄本色II", "tt0094357"],
  ["赌圣", "tt0104147"],
  ["赌圣2：街头赌圣", "tt0112909"],
  ["Les Choristes", "tt0372824"],
  ["La Grande Vadrouille", "tt0060474"],
  ["La leggenda del pianista sull'oceano", "tt0120731"],
  ["飞驰人生", "tt9597190"],
  ["这个杀手不太冷静", "tt16254308"],
  ["龙虎风云", "tt0093435"],
  ["盲井（李杨）", "tt0351299"],
  ["올림포스 가디언", "tt6523816"],
  ["魁拔之十万火急", "tt2557868"],
  ["神厨小福贵", null],
  ["小牛向前冲", null],
  ["阿凡提的故事", null],
  ["CNN 10", "tt33303306"],
  ["Meet the Press", "tt0149490"],
  ["NBC News NOW", "tt15507730"],
  ["NBC Nightly News", "tt0231035"],
  ["Daniel Sloss", "tt8858472"],
  ["Jimmy O. Yang", "tt11250926"],
  ["Last Week Tonight with John Oliver", "tt3530232"],
  ["Ronny Chieng", "tt18830896"],
  ["The Late Show with Stephen Colbert", "tt3697842"],
  ["The Tonight Show Starring Jimmy Fallon", "tt3444938"],
]);

const imdbPoster = (url) => url.replace(/\._V1_.*\.jpg$/, "._V1_QL75_UX500_CR0,0,500,741_.jpg");

/*
 * IMDb models these seasons under one title ID. Distinct artwork from the
 * title's IMDb gallery keeps adjacent season cards visually identifiable.
 */
const posterArtworkOverrides = new Map([
  ["爱情公寓2", { imdbId: "tt1862521", imdbTitle: "iPartment 2", year: 2011,
    poster: imdbPoster("https://m.media-amazon.com/images/M/MV5BMTk0NmQ4ZjYtODZhYi00ZWNhLTlhYzAtOTI1ZDczMDY3MTVhXkEyXkFqcGc@._V1_.jpg") }],
  ["爱情公寓3", { imdbId: "tt1862521", imdbTitle: "iPartment 3", year: 2012,
    poster: imdbPoster("https://m.media-amazon.com/images/M/MV5BNzQzMmVhNjUtZTkzOC00MzZmLTlmMjQtMTIwM2JkN2Y2NmU4XkEyXkFqcGc@._V1_.jpg") }],
  ["爱情公寓4", { imdbId: "tt1862521", imdbTitle: "iPartment 4", year: 2014,
    poster: imdbPoster("https://m.media-amazon.com/images/M/MV5BNWY5YTQ1YmQtZjQxMC00N2EzLTg0NmEtOGUxYzBhMTkzN2RmXkEyXkFqcGc@._V1_.jpg") }],
  ["铁齿铜牙纪晓岚2", { imdbId: "tt3803310", imdbTitle: "The Eloquent Ji Xiaolan 2", year: 2002,
    poster: imdbPoster("https://m.media-amazon.com/images/M/MV5BYWJiNjE0OTctYjNjYi00ZTE3LTg1ODEtMTI0YzFlN2FiYjk5XkEyXkFqcGc@._V1_.jpg") }],
  ["铁齿铜牙纪晓岚3", { imdbId: "tt3803310", imdbTitle: "The Eloquent Ji Xiaolan 3", year: 2004,
    poster: imdbPoster("https://m.media-amazon.com/images/M/MV5BNThmZmNkMGItMGIyYS00YzQ5LTkxNjYtMGFkMDQ0YmUxNmIxXkEyXkFqcGc@._V1_.jpg") }],
  ["铁齿铜牙纪晓岚4", { imdbId: "tt3803310", imdbTitle: "The Eloquent Ji Xiaolan 4", year: 2009,
    poster: imdbPoster("https://m.media-amazon.com/images/M/MV5BNzAzNWY4NDAtZDRiZC00OGQ5LTllZjktY2YyYzA3ZjY0NTA3XkEyXkFqcGc@._V1_.jpg") }],
  ["Talk of the Nation", {
    poster: "https://i.ytimg.com/vi/YnEyXmpL7Zc/maxresdefault.jpg",
    sourceUrl: "https://www.youtube.com/watch?v=YnEyXmpL7Zc",
    sourceLabel: "YouTube",
  }],
  ["The Honest Drink", {
    poster: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/22/79/41/227941c6-8782-be92-04d9-e871e54be31a/mza_11546107634199334575.jpeg/1200x1200bf-60.jpg",
    sourceUrl: "https://podcasts.apple.com/us/podcast/the-honest-drink/id1471327566",
    sourceLabel: "Apple Podcasts",
  }],
]);

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const getPoster = async (work) => {
  const cacheKey = `${work.medium}|${work.title}`;
  const artworkOverride = posterArtworkOverrides.get(work.title);
  if (artworkOverride) {
    posterCache[cacheKey] = artworkOverride;
    return artworkOverride;
  }

  const overrideQuery = posterQueryOverrides.get(work.title);
  const cached = posterCache[cacheKey];
  const overrideChanged = typeof overrideQuery === "string"
    && overrideQuery.startsWith("tt")
    && cached?.imdbId !== overrideQuery;
  if (!refreshPosters && !overrideChanged && Object.hasOwn(posterCache, cacheKey)) return cached;

  if (overrideQuery === null) {
    posterCache[cacheKey] = null;
    return null;
  }

  const query = (overrideQuery || work.title)
    .replace(/（/g, " ")
    .replace(/）/g, " ")
    .replace(/\([^)]*(?:版|年动画版|李杨|杜海滨)[^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const endpoint = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`;

  try {
    const response = await fetch(endpoint, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`IMDb returned ${response.status}`);
    const payload = await response.json();
    const desiredKinds = imdbKinds[work.medium] || new Set();
    const titleKey = normalize(query);
    const candidates = (payload.d || []).filter((candidate) => candidate.i?.imageUrl && candidate.id?.startsWith("tt"));
    const ranked = candidates.map((candidate) => {
      const candidateTitles = [candidate.l, ...(candidate.akas || [])].filter(Boolean);
      const titleScore = Math.max(...candidateTitles.map((title) => similarity(titleKey, normalize(title))), 0);
      const kindBonus = desiredKinds.has(candidate.q) ? 0.28 : 0;
      const imageBonus = candidate.i.height > candidate.i.width ? 0.06 : 0;
      return { candidate, score: titleScore + kindBonus + imageBonus };
    }).sort((a, b) => b.score - a.score);
    /*
     * IMDb's suggestion service searches localized AKA titles but usually
     * returns only the English display title. Its first result is therefore
     * valuable for CJK and translated queries even when string similarity is
     * low. Prefer a high-confidence scored result, then its top ranked result.
     */
    const chosen = ranked[0]?.score >= 0.48
      ? ranked[0].candidate
      : candidates.find((candidate) => desiredKinds.has(candidate.q)) || candidates[0] || null;
    const result = chosen ? {
      imdbId: chosen.id,
      poster: imdbPoster(chosen.i.imageUrl),
      year: chosen.y || null,
      imdbTitle: chosen.l,
    } : null;
    posterCache[cacheKey] = result;
    await delay(70);
    return result;
  } catch (error) {
    console.warn(`Poster lookup failed for ${work.title}: ${error.message}`);
    posterCache[cacheKey] = null;
    return null;
  }
};

let completed = 0;
const workers = Array.from({ length: 5 }, async (_, workerIndex) => {
  for (let index = workerIndex; index < watched.length; index += 5) {
    const metadata = await getPoster(watched[index]);
    Object.assign(watched[index], metadata || {});
    completed += 1;
    if (completed % 20 === 0 || completed === watched.length) {
      console.log(`IMDb posters: ${completed}/${watched.length}`);
    }
  }
});
await Promise.all(workers);

/*
 * Use published international, distributor, or established catalogue titles
 * for Chinese-language works. Do not manufacture literal translations when a
 * work already has an English release title. The explicit entries also correct
 * unrelated IMDb suggestions returned for titles with ambiguous Chinese names.
 */
const englishTitleOverrides = new Map([
  ["铁路沿线（2000，杜海滨）", "Along the Railway"],
  ["铁齿铜牙纪晓岚", "The Eloquent Ji Xiaolan"],
  ["康熙微服私访记", "Records of Kangxi's Travel Incognito"],
  ["神医喜来乐", "The Great Doctor: Xi Laile"],
  ["大宅门", "The Grand Mansion Gate"],
  ["水浒传", "The Water Margin"],
  ["妙手神捕俏佳人", "The Legendary Catcher and the Lady"],
  ["隋唐英雄传", "Heroes of Sui and Tang Dynasties"],
  ["快乐星球", "Happy Planet"],
  ["快乐星球2", "Happy Planet 2"],
  ["神探狄仁杰", "Amazing Detective Di Renjie"],
  ["神探狄仁杰2", "Amazing Detective Di Renjie 2"],
  ["神探狄仁杰3", "Amazing Detective Di Renjie 3"],
  ["爆丸小子", "Baowan Boy"],
  ["唐人街探案", "Detective Chinatown"],
  ["无间道", "Infernal Affairs"],
  ["喜剧之王", "King of Comedy"],
  ["神兵小将", "ShenBing Kids"],
  ["虹猫蓝兔七侠传", "Rainbow Cat and Blue Rabbit: Legend of the Seven Swords"],
  ["超兽武装之仁者无敌", "RevEvolution"],
  ["西游记（1999年动画版）", "Journey to the West"],
  ["果宝特攻", "Fruity Robo"],
  ["电击小子", "Electro Boy"],
  ["百变机兽之洛洛历险记", "RoboWarriors"],
  ["快乐东西", "Happy Stuff"],
  ["生肖传奇之十二生肖闯江湖", "Kung Fu Masters of the Zodiac"],
  ["开心超人（电影）", "Happy Heroes"],
  ["蓝猫龙骑团", "Blue Cat Dragon Rider"],
  ["快乐星猫 第一季", "The Adventures of Star Cat"],
  ["魔角侦探", "The Magic Horn Detective"],
  ["三国演义（2009年动画版）", "Romance of the Three Kingdoms"],
  ["西游记（2010年动画版）", "Journey to the West"],
  ["恐龙宝贝之龙神勇士", "Dinosaur Baby: Holy Heroes"],
  ["魁拔之十万火急", "Kuiba"],
  ["喜羊羊与灰太狼", "Pleasant Goat and Big Big Wolf"],
  ["猪猪侠之魔幻猪猡纪", "GG Bond"],
  ["神厨小福贵", "Fugui the Little Magic Cook"],
  ["大耳朵图图", "Big-Eared Tutu"],
  ["小牛向前冲", "Brave Calf"],
  ["熊出没", "Boonie Bears"],
  ["奇奇颗颗历险记", "The Adventures of Qiqi and Keke"],
  ["小鸡不好惹", "Chicken Stew"],
  ["海尔兄弟", "Haier Brothers"],
  ["福五鼠之孙子兵法", "Five Lucky Mouse"],
  ["摩尔庄园", "Mole's World"],
  ["天上掉下个猪八戒", "Pig King"],
  ["宋代足球小将", "The Young Football Players of Song Dynasty"],
  ["葫芦小金刚", "Little Calabash Warriors"],
  ["大头儿子和小头爸爸", "Big-Headed Kid and Small-Headed Father"],
  ["海宝来了", "Haibao Is Coming"],
  ["星际精灵蓝多多", "Star Elf Blue"],
  ["Q版三国（又名Q版刘关张）", "Q-Version Three Kingdoms"],
  ["阿凡提的故事", "The Story of Afanti"],
]);

const isChineseLanguageWork = (work) => (
  /China|Hong Kong|Taiwan|中国|香港|台湾/.test(work.country || "")
  && /\p{Script=Han}/u.test(work.title)
);

for (const work of watched) {
  if (!isChineseLanguageWork(work) || work.translatedTitle) continue;
  work.translatedTitle = englishTitleOverrides.get(work.title) || work.imdbTitle || "";
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(cachePath, `${JSON.stringify(posterCache, null, 2)}\n`);

const matchedBooks = books.filter((book) => book.added).length;
const coveredWorks = watched.filter((work) => work.poster).length;
const generated = `/* Generated by scripts/build-life-sections.mjs from My Info Lists.md and Apple Books. */\nwindow.LIFE_LIBRARY_DATA = ${JSON.stringify({
  generatedAt: new Date().toISOString(),
  stats: {
    books: books.length,
    booksWithAddedDate: matchedBooks,
    watched: watched.length,
    watchedWithPoster: coveredWorks,
  },
  watched,
  books,
}, null, 2)};\n`;
writeFileSync(outputPath, generated);

console.log(`Books matched to Apple Books: ${matchedBooks}/${books.length}`);
console.log(`IMDb posters found: ${coveredWorks}/${watched.length}`);
console.log(`Wrote ${outputPath}`);
