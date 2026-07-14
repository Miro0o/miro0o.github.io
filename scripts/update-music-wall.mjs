import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const runNcm = (...args) => {
  const output = execFileSync("ncm-cli", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  return JSON.parse(output);
};

const ranking = runNcm(
  "user", "listen-ranking", "--type", "0", "--offset", "0", "--limit", "100", "--output", "json"
).data;
const recent = runNcm(
  "user", "album-history", "--limit", "100", "--output", "json"
).data.records;

const albums = [];
const seen = new Set();

for (const entry of ranking) {
  const album = entry.song?.album;
  if (!album?.originalId || !entry.song?.coverImgUrl || seen.has(album.originalId)) continue;
  seen.add(album.originalId);
  albums.push({
    id: album.originalId,
    name: album.name,
    artist: entry.song.artists?.map(({ name }) => name).join(" / ") || "Unknown artist",
    cover: entry.song.coverImgUrl.replace(/^http:/, "https:") + "?param=420y420",
    song: entry.song.name,
    plays: entry.playCount,
    source: "all-time"
  });
}

for (const { record } of recent) {
  if (albums.length >= 100) break;
  if (!record?.originalId || !record.coverImgUrl || seen.has(record.originalId)) continue;
  seen.add(record.originalId);
  albums.push({
    id: record.originalId,
    name: record.name,
    artist: record.artists?.map(({ name }) => name).join(" / ") || "Unknown artist",
    cover: record.coverImgUrl.replace(/^http:/, "https:") + "?param=420y420",
    song: "Recently played album",
    plays: null,
    source: "recent"
  });
}

const banner = "// Generated from Miro's NetEase Cloud Music listening data.\n";
const payload = `window.MUSIC_WALL_ALBUMS = ${JSON.stringify(albums, null, 2)};\n`;
writeFileSync(resolve(root, "assets/data/music-wall-data.js"), banner + payload);
console.log(`Wrote ${albums.length} albums to assets/data/music-wall-data.js`);
