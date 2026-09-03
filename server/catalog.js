import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { shanghaiNow } from "./time.js";

export const DATA_HOME = path.join(os.homedir(), ".local", "share", "acceptances");
export const CATALOG_PATH = path.join(DATA_HOME, "catalog.json");

export function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) return { updatedAt: null, roots: {} };
  return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
}

export function saveCatalog(catalog) {
  fs.mkdirSync(DATA_HOME, { recursive: true });
  const next = { ...catalog, updatedAt: shanghaiNow() };
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function resolveAcceptancesDir(input) {
  const absolute = path.resolve(input);
  return path.basename(absolute) === ".acceptances"
    ? absolute
    : path.join(absolute, ".acceptances");
}

export function register(input) {
  const root = resolveAcceptancesDir(input);
  const stat = fs.existsSync(root) ? fs.statSync(root) : null;
  if (!stat?.isDirectory()) {
    throw Object.assign(new Error(`not a directory: ${root}`), { status: 400 });
  }
  const catalog = loadCatalog();
  const now = shanghaiNow();
  const previous = catalog.roots?.[root];
  catalog.roots = catalog.roots || {};
  catalog.roots[root] = {
    registeredAt: previous?.registeredAt ?? now,
    updatedAt: now,
  };
  saveCatalog(catalog);
  return { root, created: !previous };
}

export function unregister(input) {
  const root = resolveAcceptancesDir(input);
  const catalog = loadCatalog();
  if (!catalog.roots?.[root]) {
    throw Object.assign(new Error(`not in catalog: ${root}`), { status: 404 });
  }
  delete catalog.roots[root];
  saveCatalog(catalog);
  return { root };
}

export function isAliveRoot(root) {
  try {
    return fs.existsSync(root) && fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

export function listRoots() {
  const catalog = loadCatalog();
  return Object.entries(catalog.roots || {}).map(([root, meta]) => ({
    root,
    registeredAt: meta.registeredAt,
    updatedAt: meta.updatedAt,
    alive: isAliveRoot(root),
  }));
}

export function requireCatalogRoot(root) {
  const catalog = loadCatalog();
  if (!root || !catalog.roots?.[root]) {
    throw Object.assign(new Error("root is not in catalog"), { status: 404 });
  }
  return root;
}
