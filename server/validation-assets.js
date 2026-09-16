import fs from "node:fs";
import path from "node:path";

const SCREENSHOT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const AUDIO = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);
const VIDEO = new Set([".mp4", ".webm"]);
const TEXT = new Set([".txt", ".log", ".json", ".csv"]);

function inside(base, candidate) {
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

export function evidencePath(value) {
  return typeof value === "string" ? value : value?.path;
}

export function classifyEvidence(value) {
  const lower = value.toLowerCase();
  const extension = path.extname(lower);
  if (/\.transcript\.(txt|json|jsonl)$/.test(lower)) return "transcript";
  if (SCREENSHOT.has(extension)) return "screenshot";
  if (extension === ".gif") return "gif";
  if (VIDEO.has(extension)) return "video";
  if (AUDIO.has(extension)) return "audio";
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".html" || extension === ".htm") return "dom_snapshot";
  if (extension === ".srt" || extension === ".vtt") return "transcript";
  if (TEXT.has(extension)) return "text";
  return null;
}

export function resolveAsset(roundDir, reference) {
  if (typeof reference !== "string" || !reference.startsWith("assets/")) {
    return { error: "evidence path must start with assets/" };
  }
  if (reference.includes("\0") || reference.includes("\\") || path.isAbsolute(reference)) {
    return { error: "invalid evidence path" };
  }
  const relative = reference.slice("assets/".length);
  if (!relative || relative.split("/").includes("..")) {
    return { error: "invalid evidence path" };
  }
  const assetsDir = path.resolve(roundDir, "assets");
  const file = path.resolve(assetsDir, relative);
  if (!inside(assetsDir, file)) return { error: "evidence path escapes assets" };
  try {
    const realAssets = fs.realpathSync(assetsDir);
    const realFile = fs.realpathSync(file);
    if (!inside(realAssets, realFile)) return { error: "evidence path escapes assets through a symlink" };
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return { error: "evidence path is a symlink" };
    if (!stat.isFile()) return { error: "evidence path is not a regular file" };
    return { file, relative: `assets/${relative}`, size: stat.size };
  } catch {
    return { error: "evidence file does not exist" };
  }
}

function walk(directory, prefix, entries) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relative = `${prefix}/${entry.name}`;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      entries.push({ relative, file, kind: "symlink", size: 0 });
    } else if (stat.isDirectory()) {
      walk(file, relative, entries);
    } else {
      entries.push({
        relative,
        file,
        kind: stat.isFile() ? "file" : "other",
        size: stat.size,
      });
    }
  }
}

export function listAssets(roundDir) {
  const assetsDir = path.join(roundDir, "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const entries = [];
  walk(assetsDir, "assets", entries);
  return entries;
}

export function forbiddenName(relative) {
  const parts = relative.toLowerCase().split("/");
  return parts.some((part) => part === ".env" || part.startsWith(".env."))
    ? "environment file"
    : relative.toLowerCase().endsWith(".har")
      ? "HAR file"
      : null;
}

export function hasUnredactedSecret(file) {
  const size = fs.statSync(file).size;
  if (!size || size > 200_000) return false;
  const content = fs.readFileSync(file, "utf8");
  const match = content.match(/\b(authorization|cookie|set-cookie|access[_-]?token|api[_-]?key|secret)\b["']?\s*[:=]\s*([^\s,;}]+)/i);
  if (!match) return false;
  const value = match[2].replace(/^["']|["']$/g, "");
  return !/^(?:<redacted>|redacted|\*{3,}|\[redacted\]|null|false)$/i.test(value);
}
