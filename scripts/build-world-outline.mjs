#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const geodataRoot = resolve(siteRoot, ".travel-cache/geodata");
const paths = {
  land: resolve(geodataRoot, "ne_50m_land.geojson"),
  countries: resolve(geodataRoot, "ne_50m_admin_0_countries.geojson"),
  countryBoundaries: resolve(geodataRoot, "ne_50m_admin_0_boundary_lines_land.geojson"),
  provincesShp: resolve(geodataRoot, "ne_10m_admin_1_states_provinces/ne_10m_admin_1_states_provinces.shp"),
  provincesDbf: resolve(geodataRoot, "ne_10m_admin_1_states_provinces/ne_10m_admin_1_states_provinces.dbf"),
  cities: resolve(geodataRoot, "ne_110m_populated_places_simple.geojson"),
  travelData: resolve(siteRoot, "assets/data/travel-data.js"),
  output: resolve(siteRoot, "assets/data/world-outline.js")
};

const round = (value, precision = 2) => Number(value.toFixed(precision));
const squaredSegmentDistance = (point, start, end) => {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;
  if (dx || dy) {
    const projection = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (projection > 1) {
      x = end[0];
      y = end[1];
    } else if (projection > 0) {
      x += dx * projection;
      y += dy * projection;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
};

const simplify = (points, tolerance) => {
  if (!tolerance || points.length <= 4) return points;
  const squareTolerance = tolerance * tolerance;
  const markers = new Uint8Array(points.length);
  const stack = [[0, points.length - 1]];
  markers[0] = 1;
  markers[points.length - 1] = 1;
  while (stack.length) {
    const [first, last] = stack.pop();
    let maximumDistance = squareTolerance;
    let nextIndex = 0;
    for (let index = first + 1; index < last; index += 1) {
      const distance = squaredSegmentDistance(points[index], points[first], points[last]);
      if (distance > maximumDistance) {
        maximumDistance = distance;
        nextIndex = index;
      }
    }
    if (nextIndex) {
      markers[nextIndex] = 1;
      if (nextIndex - first > 1) stack.push([first, nextIndex]);
      if (last - nextIndex > 1) stack.push([nextIndex, last]);
    }
  }
  return points.filter((_, index) => markers[index]);
};

const compactRing = (ring, precision = 2, tolerance = 0) => {
  const result = [];
  for (const coordinate of ring) {
    const point = [round(coordinate[0], precision), round(coordinate[1], precision)];
    const previous = result.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) result.push(point);
  }
  return simplify(result, tolerance);
};

const geometryRings = (geometry, precision = 2, tolerance = 0) => {
  if (geometry?.type === "Polygon") return geometry.coordinates.map((ring) => compactRing(ring, precision, tolerance));
  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => polygon.map((ring) => compactRing(ring, precision, tolerance)));
  }
  return [];
};

const geometryLines = (geometry, precision = 2, tolerance = 0) => {
  if (geometry?.type === "LineString") return [compactRing(geometry.coordinates, precision, tolerance)];
  if (geometry?.type === "MultiLineString") {
    return geometry.coordinates.map((line) => compactRing(line, precision, tolerance));
  }
  return [];
};

function readDbf(path) {
  const source = readFileSync(path);
  const recordCount = source.readUInt32LE(4);
  const headerLength = source.readUInt16LE(8);
  const recordLength = source.readUInt16LE(10);
  const fields = [];
  let fieldOffset = 1;
  for (let offset = 32; source[offset] !== 0x0d; offset += 32) {
    const end = source.indexOf(0, offset);
    const name = source.toString("ascii", offset, Math.min(end < 0 ? offset + 11 : end, offset + 11)).toLowerCase();
    const length = source[offset + 16];
    fields.push({ name, offset: fieldOffset, length });
    fieldOffset += length;
  }
  const records = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    if (source[start] === 0x2a) {
      records.push({});
      continue;
    }
    const record = {};
    for (const field of fields) {
      record[field.name] = source
        .toString("utf8", start + field.offset, start + field.offset + field.length)
        .replaceAll("\0", "")
        .trim();
    }
    records.push(record);
  }
  return records;
}

function readPolygonShapefile(shpPath, dbfPath, precision = 2, tolerance = 0) {
  const source = readFileSync(shpPath);
  const properties = readDbf(dbfPath);
  const features = [];
  let offset = 100;
  let recordIndex = 0;
  while (offset + 12 <= source.length) {
    const contentLength = source.readUInt32BE(offset + 4) * 2;
    const contentStart = offset + 8;
    const shapeType = source.readUInt32LE(contentStart);
    const rings = [];
    if (shapeType === 5 || shapeType === 15 || shapeType === 25) {
      const partCount = source.readUInt32LE(contentStart + 36);
      const pointCount = source.readUInt32LE(contentStart + 40);
      const partStart = contentStart + 44;
      const pointStart = partStart + partCount * 4;
      for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
        const firstPoint = source.readUInt32LE(partStart + partIndex * 4);
        const lastPoint = partIndex + 1 < partCount
          ? source.readUInt32LE(partStart + (partIndex + 1) * 4)
          : pointCount;
        const ring = [];
        for (let pointIndex = firstPoint; pointIndex < lastPoint; pointIndex += 1) {
          const pointOffset = pointStart + pointIndex * 16;
          ring.push([source.readDoubleLE(pointOffset), source.readDoubleLE(pointOffset + 8)]);
        }
        const compacted = compactRing(ring, precision, tolerance);
        if (compacted.length > 1) rings.push(compacted);
      }
    }
    features.push({ properties: properties[recordIndex] || {}, rings });
    offset = contentStart + contentLength;
    recordIndex += 1;
  }
  return features;
}

const readTravelData = () => {
  const source = readFileSync(paths.travelData, "utf8");
  const match = source.match(/window\.TRAVEL_DATA\s*=\s*(\{.*\});\s*$/s);
  if (!match) throw new Error(`Could not parse ${paths.travelData}`);
  return JSON.parse(match[1]);
};

const travelData = readTravelData();
const relevantCountries = new Set(travelData.places.map((place) => place.countryCode));
const preferredLocalName = (value) => String(value || "").split("|").at(-1).trim();
const countryLocalOverrides = {
  AT: "Österreich",
  CN: "中国",
  DE: "Deutschland",
  DK: "Danmark",
  ES: "España",
  IT: "Italia",
  SG: "Singapura",
  VA: "Città del Vaticano"
};

const landSource = JSON.parse(readFileSync(paths.land, "utf8"));
const land = landSource.features.flatMap((feature) => {
  if (feature.geometry?.type === "Polygon") return [feature.geometry.coordinates.map((ring) => compactRing(ring, 3, 0.0025))];
  if (feature.geometry?.type === "MultiPolygon") {
    return feature.geometry.coordinates.map((polygon) => polygon.map((ring) => compactRing(ring, 3, 0.0025)));
  }
  return [];
});

const countrySource = JSON.parse(readFileSync(paths.countries, "utf8"));
const countryBoundarySource = JSON.parse(readFileSync(paths.countryBoundaries, "utf8"));
const countryBorders = countryBoundarySource.features
  .map((feature) => geometryLines(feature.geometry, 3, 0.0025))
  .filter((lines) => lines.length);
const countries = countrySource.features.map(({ properties = {} }) => {
  const code = properties.ISO_A2 || properties.ISO_A2_EH;
  const english = properties.NAME || properties.NAME_EN || properties.ADMIN || code;
  const native = countryLocalOverrides[code] || preferredLocalName(properties.NAME_LOCAL) || english;
  return {
    code,
    name: native && native !== english ? `${native} · ${english}` : english,
    longitude: Number(properties.LABEL_X),
    latitude: Number(properties.LABEL_Y),
    rank: Number(properties.LABELRANK) || 9,
    minZoom: Number(properties.MIN_LABEL) || 1.5
  };
}).filter((country) => Number.isFinite(country.longitude) && Number.isFinite(country.latitude));

const provinceFeatures = readPolygonShapefile(paths.provincesShp, paths.provincesDbf, 2, 0.025)
  .filter(({ properties }) => relevantCountries.has(properties.iso_a2));
const provinceBorders = provinceFeatures.flatMap((feature) => feature.rings);
const provinces = provinceFeatures.map(({ properties }) => {
  const english = properties.name_en || properties.name || properties.gn_name;
  const native = preferredLocalName(properties.name_local) || english;
  return {
    name: native && native !== english ? `${native} · ${english}` : english,
    longitude: Number(properties.longitude),
    latitude: Number(properties.latitude),
    rank: Number(properties.labelrank) || 9,
    minZoom: Number(properties.min_label) || Number(properties.min_zoom) || 4
  };
}).filter((province) => province.name && Number.isFinite(province.longitude) && Number.isFinite(province.latitude));

const citySource = JSON.parse(readFileSync(paths.cities, "utf8"));
const cities = citySource.features.map((feature) => {
  const properties = feature.properties || {};
  const english = properties.ls_name || properties.name || properties.nameascii;
  const possibleNative = properties.name !== english ? properties.name : properties.namepar;
  return {
    name: possibleNative && possibleNative !== english ? `${possibleNative} · ${english}` : english,
    longitude: Number(properties.longitude ?? feature.geometry?.coordinates?.[0]),
    latitude: Number(properties.latitude ?? feature.geometry?.coordinates?.[1]),
    rank: Number(properties.rank_max) || 1,
    minZoom: Number(properties.min_zoom) || 4
  };
}).filter((city) => city.name && Number.isFinite(city.longitude) && Number.isFinite(city.latitude));

const payload = { land, countryBorders, countries, provinceBorders, provinces, cities };
const banner = "// Natural Earth public-domain boundaries and labels, compacted for the local travel canvas.\n";
writeFileSync(paths.output, `${banner}window.WORLD_MAP = ${JSON.stringify(payload)};\nwindow.WORLD_OUTLINE = window.WORLD_MAP.land;\n`);
console.log(`Prepared ${countryBorders.length} country-boundary features, ${provinceBorders.length} province rings and ${cities.length} cities in ${paths.output}.`);
