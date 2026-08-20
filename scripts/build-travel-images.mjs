#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(siteRoot, ".travel-cache/gallery-images.json");
const outputDirectory = resolve(siteRoot, "assets/images/traveling/published");
const maximumDimension = 2560;
const quality = 82;
const concurrency = 4;
const forceRebuild = process.env.TRAVEL_FORCE_REBUILD === "1";

if (!existsSync(manifestPath)) {
  throw new Error(`Missing ${manifestPath}. Run scripts/travel-photos publish first.`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
mkdirSync(outputDirectory, { recursive: true });

const run = (command, argumentsList) => new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(command, argumentsList, { stdio: ["ignore", "ignore", "pipe"] });
  let errorOutput = "";
  child.stderr.on("data", (chunk) => { errorOutput += chunk; });
  child.on("error", rejectPromise);
  child.on("close", (code) => {
    if (code === 0) resolvePromise();
    else rejectPromise(new Error(`${command} failed: ${errorOutput.trim()}`));
  });
});

const convert = async (entry) => {
  if (!existsSync(entry.source)) {
    throw new Error(`Selected source is missing: ${entry.source}`);
  }
  const destination = resolve(outputDirectory, entry.filename);
  if (!forceRebuild && existsSync(destination) && statSync(destination).mtimeMs >= statSync(entry.source).mtimeMs) {
    return { generated: false, destination };
  }

  const temporary = `${destination}.tmp-${process.pid}`;
  const intermediate = `${temporary}.png`;
  const decoded = `${temporary}.decoded.jpg`;
  const isHeif = /\.(?:heic|heif)$/i.test(entry.source);
  if (isHeif) {
    await run("heif-convert", ["-q", "100", entry.source, decoded]);
  }
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-i", isHeif ? decoded : entry.source,
    "-map", "0:0",
    "-frames:v", "1",
    "-vf", `scale=w='min(${maximumDimension},iw)':h='min(${maximumDimension},ih)':force_original_aspect_ratio=decrease`,
    intermediate
  ]);
  const argumentsList = [
    "-quiet", "-mt", "-m", "6", "-q", String(quality), "-metadata", "none",
    intermediate,
    "-o", temporary
  ];
  try {
    await run("cwebp", argumentsList);
    renameSync(temporary, destination);
    return { generated: true, destination };
  } finally {
    if (existsSync(intermediate)) unlinkSync(intermediate);
    if (existsSync(decoded)) unlinkSync(decoded);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
};

let cursor = 0;
let generated = 0;
let skipped = 0;
const workers = Array.from({ length: Math.min(concurrency, manifest.length) }, async () => {
  while (cursor < manifest.length) {
    const entry = manifest[cursor];
    cursor += 1;
    const result = await convert(entry);
    if (result.generated) generated += 1;
    else skipped += 1;
  }
});
await Promise.all(workers);

const wantedFilenames = new Set(manifest.map((entry) => entry.filename));
let removed = 0;
for (const filename of readdirSync(outputDirectory).filter((name) => name.endsWith(".webp"))) {
  if (wantedFilenames.has(filename)) continue;
  unlinkSync(resolve(outputDirectory, filename));
  removed += 1;
}

const totalBytes = manifest.reduce((sum, entry) => sum + statSync(resolve(outputDirectory, entry.filename)).size, 0);
console.log(`Travel gallery: ${manifest.length} WebP files (${generated} generated, ${skipped} unchanged).`);
console.log(`Removed ${removed} stale local WebP file(s) outside the current manifest.`);
console.log(`Published image payload: ${(totalBytes / 1024 / 1024).toFixed(1)} MiB.`);
console.log("WebP outputs contain no copied EXIF, XMP, ICC, or GPS metadata.");
