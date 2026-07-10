#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptDirectory, "..");
const vaultDirectory = path.resolve(process.argv[2] || path.join(siteDirectory, "../../../miniWorldModel"));
const outputPath = path.resolve(process.argv[3] || path.join(siteDirectory, "assets/worldmodel-map-data.js"));
const toVaultPath = (absolutePath) => path.relative(vaultDirectory, absolutePath).split(path.sep).join("/");
const withoutMarkdownExtension = (value) => value.replace(/\.md$/i, "");
const basename = (value) => value.slice(value.lastIndexOf("/") + 1);
const parentPath = (value) => {
  const index = value.lastIndexOf("/");
  return index < 0 ? "" : value.slice(0, index);
};

function collectMarkdownFiles() {
  let output;
  try {
    // Let Git apply the vault's root and nested .gitignore files, including negated rules.
    output = execFileSync(
      "git",
      ["-C", vaultDirectory, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (error) {
    throw new Error(`Cannot read Git-tracked and non-ignored Markdown files from ${vaultDirectory}.`, { cause: error });
  }

  const relativePaths = output
    .split("\0")
    .filter(Boolean);
  const ignoreCheck = spawnSync(
    "git",
    ["-C", vaultDirectory, "check-ignore", "--no-index", "-z", "--stdin"],
    {
      input: `${relativePaths.join("\0")}\0`,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    }
  );
  if (ignoreCheck.error || ![0, 1].includes(ignoreCheck.status)) {
    throw new Error(`Cannot apply .gitignore rules from ${vaultDirectory}.`, { cause: ignoreCheck.error });
  }
  const ignoredPaths = new Set(ignoreCheck.stdout.split("\0").filter(Boolean));

  return relativePaths
    .filter((relativePath) => !ignoredPaths.has(relativePath))
    .map((relativePath) => path.join(vaultDirectory, ...relativePath.split("/")))
    .filter(existsSync)
    .sort((left, right) => left.localeCompare(right));
}

function indexNotes(notePaths) {
  const exact = new Map();
  const byBasename = new Map();

  for (const notePath of notePaths) {
    const key = withoutMarkdownExtension(notePath).toLowerCase();
    exact.set(key, notePath);
    const titleKey = basename(key);
    const matches = byBasename.get(titleKey) || [];
    matches.push(notePath);
    byBasename.set(titleKey, matches);
  }
  return { exact, byBasename };
}

function resolveWikiLink(rawTarget, sourcePath, noteIndex) {
  let target = rawTarget
    .split("|")[0]
    .split("#")[0]
    .split("^")[0]
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!target) return null;
  target = withoutMarkdownExtension(target);

  const exactTarget = noteIndex.exact.get(target.toLowerCase());
  if (exactTarget) return exactTarget;

  const relativeTarget = path.posix.normalize(path.posix.join(parentPath(sourcePath), target));
  const exactRelative = noteIndex.exact.get(relativeTarget.toLowerCase());
  if (exactRelative) return exactRelative;

  const candidates = noteIndex.byBasename.get(basename(target).toLowerCase()) || [];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const sourceDirectory = parentPath(sourcePath);
    return candidates
      .map((candidate) => ({ candidate, distance: directoryDistance(sourceDirectory, parentPath(candidate)) }))
      .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))[0].candidate;
  }
  return null;
}

function directoryDistance(left, right) {
  const leftParts = left.split("/").filter(Boolean);
  const rightParts = right.split("/").filter(Boolean);
  let shared = 0;
  while (shared < leftParts.length && shared < rightParts.length && leftParts[shared] === rightParts[shared]) shared += 1;
  return leftParts.length + rightParts.length - shared * 2;
}

function stripCodeBeforeFindingLinks(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/<!--([\s\S]*?)-->/g, "");
}

function markdownLinkTargets(markdown) {
  const targets = [];
  let searchFrom = 0;
  while (searchFrom < markdown.length) {
    const start = markdown.indexOf("](", searchFrom);
    if (start < 0) break;
    let cursor = start + 2;
    let depth = 1;
    let escaped = false;
    for (; cursor < markdown.length; cursor += 1) {
      const character = markdown[cursor];
      if (character === "\n" || character === "\r") break;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth === 0) {
        targets.push(markdown.slice(start + 2, cursor).trim());
        break;
      }
    }
    searchFrom = Math.max(start + 2, cursor + 1);
  }
  return targets;
}

function normalizeMarkdownTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.includes(">")) target = target.slice(1, target.indexOf(">"));
  if (!target || target.startsWith("#") || target.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(target)) return null;
  target = target.split("#")[0].split("?")[0].replace(/\\([() ])/g, "$1");
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep malformed percent escapes unchanged; resolution may still succeed.
  }
  return target.trim() || null;
}

function addWeightedLink(linkWeights, source, target) {
  if (!target || source === target) return;
  const key = `${source}\u0000${target}`;
  linkWeights.set(key, (linkWeights.get(key) || 0) + 1);
}

function buildHierarchy(notePaths) {
  const nodeById = new Map();
  const ensureFolder = (folderPath) => {
    if (nodeById.has(folderPath)) return;
    const parent = parentPath(folderPath);
    if (folderPath) ensureFolder(parent);
    nodeById.set(folderPath, {
      id: folderPath,
      title: folderPath ? basename(folderPath) : "miniWorldModel",
      type: "folder",
      parent: folderPath ? parent : null,
      depth: folderPath ? folderPath.split("/").length : 0,
      noteCount: 0,
      linkCount: 0
    });
  };

  ensureFolder("");
  for (const notePath of notePaths) {
    const folder = parentPath(notePath);
    ensureFolder(folder);
    nodeById.set(notePath, {
      id: notePath,
      title: basename(withoutMarkdownExtension(notePath)),
      type: "note",
      parent: folder,
      depth: notePath.split("/").length,
      noteCount: 1,
      linkCount: 0
    });
  }

  // Match the plugin's representative-note folding: `Topic/Topic.md` is represented by its folder node.
  const representativeNotes = new Map();
  for (const node of nodeById.values()) {
    if (node.type !== "note" || !node.parent) continue;
    const folder = nodeById.get(node.parent);
    if (folder && node.title.trim().toLowerCase() === folder.title.trim().toLowerCase()) {
      representativeNotes.set(node.id, folder.id);
    }
  }
  for (const noteId of representativeNotes.keys()) nodeById.delete(noteId);

  return { nodeById, representativeNotes };
}

function rollUpCounts(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of [...nodes].sort((left, right) => right.depth - left.depth)) {
    if (node.parent === null) continue;
    const parent = nodeById.get(node.parent);
    if (!parent) continue;
    parent.noteCount += node.noteCount;
    parent.linkCount += node.linkCount;
  }
}

async function main() {
  const markdownFiles = collectMarkdownFiles();
  const notePaths = markdownFiles.map(toVaultPath);
  const noteIndex = indexNotes(notePaths);
  const linkWeights = new Map();

  await Promise.all(markdownFiles.map(async (absolutePath, index) => {
    const source = notePaths[index];
    const markdown = await readFile(absolutePath, "utf8");
    const linkPattern = /!?\[\[([^\]\n]+)\]\]/g;
    const searchable = stripCodeBeforeFindingLinks(markdown);
    let match;
    while ((match = linkPattern.exec(searchable))) {
      addWeightedLink(linkWeights, source, resolveWikiLink(match[1], source, noteIndex));
    }
    for (const rawTarget of markdownLinkTargets(searchable)) {
      const target = normalizeMarkdownTarget(rawTarget);
      if (target) addWeightedLink(linkWeights, source, resolveWikiLink(target, source, noteIndex));
    }
  }));

  const { nodeById, representativeNotes } = buildHierarchy(notePaths);
  const canonicalId = (id) => representativeNotes.get(id) || id;
  const canonicalLinks = new Map();
  for (const [key, weight] of linkWeights) {
    const [rawSource, rawTarget] = key.split("\u0000");
    const source = canonicalId(rawSource);
    const target = canonicalId(rawTarget);
    if (source === target || !nodeById.has(source) || !nodeById.has(target)) continue;
    const canonicalKey = `${source}\u0000${target}`;
    canonicalLinks.set(canonicalKey, (canonicalLinks.get(canonicalKey) || 0) + weight);
    nodeById.get(source).linkCount += weight;
    nodeById.get(target).linkCount += weight;
  }

  const nodes = [...nodeById.values()].sort((left, right) => left.depth - right.depth || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
  rollUpCounts(nodes);
  const nodeIndexById = new Map(nodes.map((node, index) => [node.id, index]));
  const links = [...canonicalLinks.entries()]
    .map(([key, weight]) => {
      const [source, target] = key.split("\u0000");
      return [nodeIndexById.get(source), nodeIndexById.get(target), weight];
    })
    .filter(([source, target]) => Number.isInteger(source) && Number.isInteger(target))
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "Miro0o/miniWorldModel",
    counts: {
      notes: notePaths.length,
      folders: nodes.filter((node) => node.type === "folder").length,
      visibleNodes: nodes.length,
      links: links.length
    },
    nodes,
    links
  };

  await writeFile(outputPath, `window.WORLDMODEL_MAP_DATA=${JSON.stringify(payload)};\n`, "utf8");
  console.log(`Wrote ${nodes.length.toLocaleString()} nodes and ${links.length.toLocaleString()} links to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
