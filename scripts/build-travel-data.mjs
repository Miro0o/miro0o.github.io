#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = resolve(siteRoot, ".travel-cache");
const mode = process.argv[2] || "audit";
const paths = {
  scan: resolve(cacheRoot, "photos.json"),
  cities: resolve(cacheRoot, "geodata/cities15000.txt"),
  candidates: resolve(cacheRoot, "candidates.json"),
  scores: resolve(cacheRoot, "vision-scores.json"),
  exports: resolve(cacheRoot, "representatives.json"),
  privacySuggestions: resolve(cacheRoot, "privacy-suggestions.json"),
  privateConfig: resolve(cacheRoot, "travel-private.json"),
  overrides: resolve(cacheRoot, "travel-overrides.json"),
  placeOverrides: resolve(siteRoot, "travel-place-overrides.json"),
  photoOverrides: resolve(siteRoot, "travel-photo-overrides.json"),
  config: resolve(siteRoot, "travel-config.json"),
  output: resolve(siteRoot, "assets/data/travel-data.js"),
  galleryManifest: resolve(cacheRoot, "gallery-images.json"),
  galleryOriginalExports: resolve(cacheRoot, "gallery-original-exports.json"),
  currentMatchReport: resolve(cacheRoot, "current-rematch-report.json"),
  imageDirectory: resolve(siteRoot, "assets/images/traveling"),
  favoriteDirectory: resolve(siteRoot, "assets/images/traveling/favorites"),
  originalDirectory: resolve(siteRoot, "assets/images/traveling/originals"),
  currentDirectory: resolve(siteRoot, "assets/images/traveling/current-rematched"),
  currentManualPhotos: resolve(siteRoot, "travel-current-manual-photos.json")
};

const readJson = (path, fallback = null) => {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
};

const scan = readJson(paths.scan);
const config = readJson(paths.config);
const privateConfig = readJson(paths.privateConfig, { privateZones: [], allowedRecurringAreas: [] });
const placeOverrides = readJson(paths.placeOverrides, {});
const photoOverrides = readJson(paths.photoOverrides, {});
const currentManualPhotos = readJson(paths.currentManualPhotos, []);
if (!scan) throw new Error(`Missing private Photos scan: ${paths.scan}`);
if (!config) throw new Error(`Missing travel config: ${paths.config}`);
if (!existsSync(paths.cities)) throw new Error(`Missing GeoNames city data: ${paths.cities}`);

const degreesToRadians = (value) => value * Math.PI / 180;
const haversineKm = (aLat, aLon, bLat, bLon) => {
  const latitudeDelta = degreesToRadians(bLat - aLat);
  const longitudeDelta = degreesToRadians(bLon - aLon);
  const latitudeA = degreesToRadians(aLat);
  const latitudeB = degreesToRadians(bLat);
  const h = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const gridKey = (latitude, longitude) => `${Math.floor(latitude)},${Math.floor(longitude)}`;
const cityGrid = new Map();
for (const line of readFileSync(paths.cities, "utf8").split("\n")) {
  if (!line) continue;
  const fields = line.split("\t");
  if (fields.length < 19) continue;
  const city = {
    id: fields[0],
    name: fields[1],
    asciiName: fields[2],
    latitude: Number(fields[4]),
    longitude: Number(fields[5]),
    countryCode: fields[8],
    admin1: fields[10],
    population: Number(fields[14]) || 0,
    timezone: fields[17]
  };
  const key = gridKey(city.latitude, city.longitude);
  const bucket = cityGrid.get(key) || [];
  bucket.push(city);
  cityGrid.set(key, bucket);
}

const cityCache = new Map();
const nearestCity = (latitude, longitude, maximumDistanceKm = config.nearestCityMaximumKm) => {
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)},${maximumDistanceKm}`;
  if (cityCache.has(cacheKey)) return cityCache.get(cacheKey);
  const baseLatitude = Math.floor(latitude);
  const baseLongitude = Math.floor(longitude);
  let winner = null;
  let winnerDistance = Infinity;
  const majorCandidates = [];
  for (let radius = 0; radius <= 2; radius += 1) {
    for (let latitudeOffset = -radius; latitudeOffset <= radius; latitudeOffset += 1) {
      for (let longitudeOffset = -radius; longitudeOffset <= radius; longitudeOffset += 1) {
        if (radius > 0 && Math.abs(latitudeOffset) !== radius && Math.abs(longitudeOffset) !== radius) continue;
        const bucket = cityGrid.get(`${baseLatitude + latitudeOffset},${baseLongitude + longitudeOffset}`) || [];
        for (const city of bucket) {
          const distance = haversineKm(latitude, longitude, city.latitude, city.longitude);
          if (distance < winnerDistance || (distance === winnerDistance && city.population > (winner?.population || 0))) {
            winner = city;
            winnerDistance = distance;
          }
          if (city.population >= config.majorCityMinimumPopulation && distance <= config.majorCityCaptureKm) {
            majorCandidates.push({ city, distance });
          }
        }
      }
    }
  }
  const metropolitanAnchor = majorCandidates
    .filter((candidate) => candidate.city.countryCode === winner?.countryCode)
    .sort((left, right) => right.city.population - left.city.population || left.distance - right.distance)[0];
  if (metropolitanAnchor) {
    winner = metropolitanAnchor.city;
    winnerDistance = metropolitanAnchor.distance;
  }
  const result = winner && winnerDistance <= maximumDistanceKm
    ? { ...winner, distanceKm: winnerDistance }
    : null;
  cityCache.set(cacheKey, result);
  return result;
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const localCountryNames = {
  AT: "Österreich",
  BE: "België",
  CN: "中国",
  DE: "Deutschland",
  DK: "Danmark",
  ES: "España",
  FR: "France",
  GB: "United Kingdom",
  IT: "Italia",
  NL: "Nederland",
  NO: "Norge",
  SE: "Sverige",
  SG: "Singapura",
  US: "United States",
  VA: "Città del Vaticano"
};
const groups = new Map();
const assignments = new Map();

for (const photo of scan.photos) {
  const city = nearestCity(photo.latitude, photo.longitude);
  if (!city) continue;
  const placeId = `geonames-${city.id}`;
  assignments.set(photo.id, placeId);
  const group = groups.get(placeId) || {
    id: placeId,
    city,
    photos: [],
    latest: "",
    earliest: "9999"
  };
  group.photos.push(photo);
  const date = photo.createdAt || "";
  if (date > group.latest) group.latest = date;
  if (date && date < group.earliest) group.earliest = date;
  groups.set(placeId, group);
}

const privateZones = Array.isArray(privateConfig.privateZones) ? privateConfig.privateZones : [];
const inPrivateZone = (photo) => privateZones.some((zone) => (
  Number.isFinite(zone.latitude)
  && Number.isFinite(zone.longitude)
  && haversineKm(photo.latitude, photo.longitude, zone.latitude, zone.longitude) <= (zone.radiusKm || 0.5)
));

const excluded = new Set(config.excludedPlaceIds || []);
const qualifiedGroups = [...groups.values()]
  .filter((group) => group.photos.length >= config.minimumPhotosPerPlace)
  .filter((group) => !excluded.has(group.id))
  .filter((group) => !group.photos.every(inPrivateZone))
  .sort((left, right) => right.latest.localeCompare(left.latest) || right.photos.length - left.photos.length)
  .slice(0, config.maximumPlaces);

const metadataScore = (photo) => {
  const megapixels = Math.max(1, photo.width * photo.height / 1_000_000);
  const ratio = photo.width / Math.max(1, photo.height);
  const landscapeBonus = ratio >= 1.25 && ratio <= 2.1 ? 1.2 : 0;
  return (photo.favorite ? 8 : 0) + Math.log2(megapixels + 1) + landscapeBonus;
};

const pickCandidates = (group) => {
  const eligible = group.photos
    .filter((photo) => !photo.hidden && !photo.screenshot && !inPrivateZone(photo))
    .sort((left, right) => metadataScore(right) - metadataScore(left));
  const picked = [];
  const usedDays = new Set();
  for (const photo of eligible) {
    const day = (photo.createdAt || photo.id).slice(0, 10);
    if (usedDays.has(day) && picked.length < Math.ceil(config.maximumCandidatesPerPlace * 0.7)) continue;
    picked.push(photo);
    usedDays.add(day);
    if (picked.length >= config.maximumCandidatesPerPlace) break;
  }
  if (picked.length < config.maximumCandidatesPerPlace) {
    for (const photo of eligible) {
      if (picked.includes(photo)) continue;
      picked.push(photo);
      if (picked.length >= config.maximumCandidatesPerPlace) break;
    }
  }
  return picked;
};

const placeLabel = (group) => {
  const country = regionNames.of(group.city.countryCode) || group.city.countryCode;
  const override = placeOverrides[group.id] || {};
  return {
    id: group.id,
    city: group.city.name,
    localName: override.localName || group.city.name,
    country,
    localCountry: localCountryNames[group.city.countryCode] || country,
    countryCode: group.city.countryCode,
    description: override.description || "",
    latitude: group.city.latitude,
    longitude: group.city.longitude,
    timezone: group.city.timezone,
    photoCount: group.photos.length,
    firstYear: group.earliest.slice(0, 4),
    latestYear: group.latest.slice(0, 4)
  };
};

const privacySuggestions = () => {
  const cellSize = 0.003;
  const cells = new Map();
  for (const photo of scan.photos.filter((item) => !item.hidden)) {
    const key = `${Math.floor(photo.latitude / cellSize)},${Math.floor(photo.longitude / cellSize)}`;
    const bucket = cells.get(key) || [];
    bucket.push(photo);
    cells.set(key, bucket);
  }

  const seeds = [...cells.entries()]
    .map(([key, photos]) => ({
      key,
      photos,
      days: new Set(photos.map((photo) => (photo.createdAt || "").slice(0, 10)).filter(Boolean)).size
    }))
    .filter((seed) => seed.photos.length >= 12 && seed.days >= 4)
    .sort((left, right) => right.days - left.days || right.photos.length - left.photos.length);
  const suggestions = [];

  for (const seed of seeds) {
    const [latitudeCell, longitudeCell] = seed.key.split(",").map(Number);
    const latitude = (latitudeCell + 0.5) * cellSize;
    const longitude = (longitudeCell + 0.5) * cellSize;
    if (suggestions.some((item) => haversineKm(latitude, longitude, item.latitude, item.longitude) < 1.2)) continue;

    const nearby = scan.photos.filter((photo) => (
      !photo.hidden && haversineKm(latitude, longitude, photo.latitude, photo.longitude) <= 0.8
    ));
    const dates = nearby.map((photo) => photo.createdAt || "").filter(Boolean).sort();
    const distinctDays = new Set(dates.map((date) => date.slice(0, 10))).size;
    const distinctMonths = new Set(dates.map((date) => date.slice(0, 7))).size;
    const spanDays = dates.length > 1
      ? Math.round((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86_400_000)
      : 0;
    if (nearby.length < 20 || distinctDays < 10 || distinctMonths < 3 || spanDays < 60) continue;

    const city = nearestCity(latitude, longitude);
    const cityName = city?.name || "Unknown area";
    const cityNumber = suggestions.filter((item) => item.city === cityName).length + 1;
    suggestions.push({
      id: `private-${suggestions.length + 1}`,
      name: `${cityName} recurring area ${cityNumber}`,
      city: cityName,
      country: city ? (regionNames.of(city.countryCode) || city.countryCode) : "Unknown",
      latitude: Number(latitude.toFixed(5)),
      longitude: Number(longitude.toFixed(5)),
      radiusKm: 0.8,
      photoCount: nearby.length,
      distinctDays,
      distinctMonths,
      firstDate: dates[0]?.slice(0, 10) || null,
      latestDate: dates.at(-1)?.slice(0, 10) || null
    });
    if (suggestions.length >= 20) break;
  }
  return suggestions;
};

if (mode === "finalize" && config.privacyReviewed) {
  const requiredZoneCount = Number(config.requiredPrivateZoneCount) || 0;
  if (privateZones.length < requiredZoneCount) {
    throw new Error(`Private location file is missing reviewed zones (${privateZones.length}/${requiredZoneCount}). Publishing stopped.`);
  }
  const allowed = Array.isArray(privateConfig.allowedRecurringAreas) ? privateConfig.allowedRecurringAreas : [];
  const unreviewed = privacySuggestions().filter((suggestion) => {
    const protectedByZone = privateZones.some((zone) => (
      Number.isFinite(zone.latitude)
      && Number.isFinite(zone.longitude)
      && haversineKm(suggestion.latitude, suggestion.longitude, zone.latitude, zone.longitude) <= Math.max(0.25, zone.radiusKm || 0)
    ));
    const explicitlyAllowed = allowed.some((area) => (
      Number.isFinite(area.latitude)
      && Number.isFinite(area.longitude)
      && haversineKm(suggestion.latitude, suggestion.longitude, area.latitude, area.longitude) <= (area.radiusKm || 0.4)
    ));
    return !protectedByZone && !explicitlyAllowed;
  });
  if (unreviewed.length) {
    writeFileSync(paths.privacySuggestions, `${JSON.stringify(unreviewed, null, 2)}\n`);
    throw new Error(`Privacy audit found ${unreviewed.length} new recurring area(s). Publishing stopped; run scripts/travel-photos privacy and review them.`);
  }
}

if (mode === "privacy") {
  const suggestions = privacySuggestions();
  writeFileSync(paths.privacySuggestions, `${JSON.stringify(suggestions, null, 2)}\n`);
  console.log(`Found ${suggestions.length} recurring areas that may be private.`);
  console.log("Exact centres stay in .travel-cache/privacy-suggestions.json.");
  console.log("");
  for (const suggestion of suggestions) {
    console.log(`${suggestion.id}  ${suggestion.city}, ${suggestion.country}  ${suggestion.photoCount} photos / ${suggestion.distinctDays} days  ${suggestion.firstDate}–${suggestion.latestDate}`);
  }
  process.exit(0);
}

if (mode === "audit") {
  console.log(`Apple Photos images: ${scan.totalImages.toLocaleString()}`);
  console.log(`Images with GPS: ${scan.locatedImages.toLocaleString()}`);
  console.log(`Automatically detected places (${config.minimumPhotosPerPlace}+ photos): ${qualifiedGroups.length}`);
  console.log("");
  for (const group of qualifiedGroups.slice(0, 30)) {
    const label = placeLabel(group);
    console.log(`${String(label.photoCount).padStart(6)}  ${label.city}, ${label.country}  ${label.firstYear}–${label.latestYear}  [${label.id}]`);
  }
  if (!config.privacyReviewed) {
    console.log("\nPublishing is locked: review privateZones/excludedPlaceIds and set privacyReviewed to true.");
  }
  process.exit(0);
}

if (mode === "candidates") {
  const candidates = qualifiedGroups.flatMap((group) => pickCandidates(group).map((photo) => ({
    id: photo.id,
    modifiedAt: photo.modifiedAt,
    placeId: group.id
  })));
  writeFileSync(paths.candidates, `${JSON.stringify(candidates, null, 2)}\n`);
  console.log(`Prepared ${candidates.length} Vision candidates across ${qualifiedGroups.length} places.`);
  process.exit(0);
}

if (mode !== "finalize") throw new Error(`Unknown mode: ${mode}`);

const scoreRows = readJson(paths.scores, []);
const scoreById = new Map(scoreRows.map((row) => [row.id, row]));
const overrides = readJson(paths.overrides, {});
const representatives = new Map();

for (const group of qualifiedGroups) {
  const candidates = pickCandidates(group);
  const override = overrides[group.id];
  const selected = candidates
    .map((photo) => {
      const vision = scoreById.get(photo.id);
      const ratio = photo.width / Math.max(1, photo.height);
      const landscapeBonus = ratio >= 1.25 && ratio <= 2.1 ? 0.08 : 0;
      const score = vision
        ? vision.aesthetics
          + (photo.favorite ? 0.22 : 0)
          + landscapeBonus
          - (vision.utility ? 1.6 : 0)
          - Math.min(0.7, vision.largestFaceShare * 1.4)
        : metadataScore(photo) / 20 - 1;
      return { photo, vision, score: photo.id === override ? Infinity : score };
    })
    .sort((left, right) => right.score - left.score)[0];
  if (selected) representatives.set(group.id, selected.photo);
}

const manualImageFilename = (placeId) => {
  const value = placeOverrides[placeId]?.imageFilename;
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(value)) return "";
  const filename = basename(value);
  return existsSync(resolve(siteRoot, "assets/images/traveling", filename)) ? filename : "";
};
const exportRequests = [...representatives.entries()]
  .filter(([placeId]) => !(config.excludedRepresentativePlaceIds || []).includes(placeId))
  .filter(([placeId]) => !manualImageFilename(placeId))
  .map(([placeId, photo]) => ({
    id: photo.id,
    filename: `${placeId}.jpg`
  }));
writeFileSync(paths.exports, `${JSON.stringify(exportRequests, null, 2)}\n`);

const precision = Math.max(2, Math.min(5, config.coordinatePrecision || 3));
const round = (value) => Number(value.toFixed(precision));
const photosById = new Map(scan.photos.map((photo) => [photo.id, photo]));
const photosByUUID = new Map(scan.photos.map((photo) => [photo.id.split("/")[0].toUpperCase(), photo]));
const representativeByFilename = new Map(
  readJson(paths.exports, []).map((request) => [request.filename, photosById.get(request.id)])
);

const selectedSources = [];
const currentReport = readJson(paths.currentMatchReport, { records: [] });
const currentPhotoIdByFilename = new Map(
  (currentReport.records || [])
    .filter((record) => record.status === "exported-current" && record.exportedFilename && record.photoId)
    .map((record) => [record.exportedFilename, record.photoId])
);
const manualCurrentByFilename = new Map(
  currentManualPhotos.map((photo) => [photo.filename, {
    id: `manual-current:${photo.filename}:${photo.createdAt || ""}`,
    latitude: Number(photo.latitude),
    longitude: Number(photo.longitude),
    createdAt: photo.createdAt || null,
    modifiedAt: photo.createdAt || null,
    width: Number(photo.width) || 0,
    height: Number(photo.height) || 0,
    favorite: false,
    hidden: false,
    screenshot: false,
    livePhoto: false
  }])
);
if (existsSync(paths.currentDirectory)) {
  const filenames = readdirSync(paths.currentDirectory)
    .filter((name) => !name.startsWith("."))
    .filter((name) => /\.(?:heic|heif|jpe?g|png)$/i.test(name))
    .sort();
  for (const filename of filenames) {
    const photoId = currentPhotoIdByFilename.get(filename);
    const photo = (photoId ? photosById.get(photoId) : null) || manualCurrentByFilename.get(filename);
    if (!photo) throw new Error(`Current selection has no private Photos or manual metadata mapping: ${filename}`);
    if (!Number.isFinite(photo.latitude) || !Number.isFinite(photo.longitude)) {
      throw new Error(`Current selection has invalid location metadata: ${filename}`);
    }
    selectedSources.push({ photo, source: resolve(paths.currentDirectory, filename), selectedAs: filename });
  }
}

const seenPhotoIds = new Set();
const gallerySources = config.privacyReviewed
  ? selectedSources.filter(({ photo }) => {
    if (seenPhotoIds.has(photo.id) || photo.hidden) return false;
    seenPhotoIds.add(photo.id);
    return true;
  })
  : [];

const galleryGroups = new Map();
const galleryAssignments = new Map(assignments);
const fallbackGroups = new Map();
for (const { photo } of gallerySources) {
  let placeId = galleryAssignments.get(photo.id);
  let group = groups.get(placeId);
  if (!group) {
    const city = nearestCity(photo.latitude, photo.longitude, 250);
    if (city) {
      placeId = `geonames-${city.id}`;
      galleryAssignments.set(photo.id, placeId);
      group = groups.get(placeId) || fallbackGroups.get(placeId);
      if (!group) {
        group = {
          id: placeId,
          city,
          photos: [],
          latest: "",
          earliest: "9999"
        };
        fallbackGroups.set(placeId, group);
      }
      if (!group.photos.includes(photo)) {
        group.photos.push(photo);
        const date = photo.createdAt || "";
        if (date > group.latest) group.latest = date;
        if (date && date < group.earliest) group.earliest = date;
      }
    }
  }
  if (group) galleryGroups.set(group.id, group);
}
const publishedGroups = [...galleryGroups.values()]
  .sort((left, right) => right.photos.length - left.photos.length || left.city.name.localeCompare(right.city.name));
const placeIndex = new Map(publishedGroups.map((group, index) => [group.id, index]));
const galleryCountByPlace = new Map();
for (const { photo } of gallerySources) {
  const placeId = galleryAssignments.get(photo.id);
  galleryCountByPlace.set(placeId, (galleryCountByPlace.get(placeId) || 0) + 1);
}
const places = publishedGroups.map((group) => ({
  ...placeLabel(group),
  photoCount: galleryCountByPlace.get(group.id) || 0
}));

const publicPhotoId = (photoId) => `photo-${createHash("sha256").update(photoId).digest("hex").slice(0, 16)}`;
const imageBaseUrl = typeof config.imageBaseUrl === "string" && config.imageBaseUrl.trim()
  ? config.imageBaseUrl.trim().replace(/\/?$/, "/")
  : "assets/images/traveling/published/";
const galleryManifest = [];
const galleryOriginalExports = [];
const photos = gallerySources.map(({ photo, source, selectedAs }) => {
  const id = publicPhotoId(photo.id);
  const filename = `${id}.webp`;
  const originalFilename = `${id}.jpg`;
  const assignedPlace = galleryAssignments.get(photo.id);
  const index = placeIndex.get(assignedPlace) ?? -1;
  const place = index >= 0 ? places[index] : null;
  const override = photoOverrides[id] || {};
  galleryManifest.push({
    id,
    source,
    selectedAs,
    filename
  });
  galleryOriginalExports.push({ id: photo.id, filename: originalFilename });
  return {
    id,
    filename,
    longitude: round(photo.longitude),
    latitude: round(photo.latitude),
    year: Number((photo.createdAt || "0000").slice(0, 4)) || 0,
    placeIndex: index,
    city: place?.city || "",
    localName: place?.localName || place?.city || "",
    country: place?.country || "",
    localCountry: place?.localCountry || place?.country || "",
    countryCode: place?.countryCode || "",
    description: typeof override.description === "string" ? override.description.trim() : ""
  };
});
writeFileSync(paths.galleryManifest, `${JSON.stringify(galleryManifest, null, 2)}\n`);
writeFileSync(paths.galleryOriginalExports, `${JSON.stringify(galleryOriginalExports, null, 2)}\n`);

const points = config.privacyReviewed
  ? scan.photos
    .filter((photo) => !photo.hidden && !inPrivateZone(photo))
    .map((photo) => {
      const assignedPlace = assignments.get(photo.id);
      return [
        round(photo.longitude),
        round(photo.latitude),
        Number((photo.createdAt || "0000").slice(0, 4)) || 0,
        placeIndex.get(assignedPlace) ?? -1
      ];
    })
    .filter((point) => !inPrivateZone({ longitude: point[0], latitude: point[1] }))
  : [];

const payload = {
  version: 2,
  generatedAt: scan.generatedAt,
  privacyReviewed: Boolean(config.privacyReviewed),
  imageBaseUrl,
  imageVersion: typeof config.imageVersion === "string" ? config.imageVersion : "",
  stats: {
    totalImages: scan.totalImages,
    locatedImages: scan.locatedImages,
    publishedPoints: points.length,
    publishedPhotos: photos.length,
    places: places.length
  },
  places,
  points,
  photos
};
const banner = "// Generated by scripts/travel-photos. Do not add private Photos identifiers here.\n";
writeFileSync(paths.output, `${banner}window.TRAVEL_DATA = ${JSON.stringify(payload)};\n`);
console.log(`Prepared ${exportRequests.length} representative exports.`);
console.log(config.privacyReviewed
  ? `Published ${points.length} sanitized location points plus ${photos.length} selected photos across ${places.length} places to ${paths.output}.`
  : "Public coordinates remain locked until privacyReviewed is true.");
