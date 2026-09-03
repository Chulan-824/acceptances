import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assetFile,
  listRounds,
  listSubjects,
} from "./acceptances.js";
import {
  isAliveRoot,
  listRoots,
  requireCatalogRoot,
  unregister,
} from "./catalog.js";
import { buildDelivery } from "./delivery.js";
import { writeReview } from "./reviews.js";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "cache-control": "no-store", ...headers });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, `${JSON.stringify(value)}\n`, {
    "content-type": MIME[".json"],
  });
}

export function isLocalHost(value) {
  try {
    return LOCAL_HOSTS.has(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
}

export function isLocalOrigin(value) {
  if (!value) return true;
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function jsonBody(request) {
  const raw = await readBody(request);
  try {
    return JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("invalid json"), { status: 400 });
  }
}

function query(url) {
  return Object.fromEntries(url.searchParams.entries());
}

function registeredRoot(value) {
  const root = requireCatalogRoot(value);
  if (!isAliveRoot(root)) {
    throw Object.assign(new Error("root path is gone"), { status: 404 });
  }
  return root;
}

function sendFile(response, file) {
  const extension = path.extname(file).toLowerCase();
  send(response, 200, fs.readFileSync(file), {
    "content-type": MIME[extension] || "application/octet-stream",
  });
}

function serveApp(response, pathname) {
  if (!fs.existsSync(DIST)) {
    send(response, 503, "Run `bun run build` first.\n", {
      "content-type": "text/plain; charset=utf-8",
    });
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(DIST, relative);
  const file =
    candidate.startsWith(`${DIST}${path.sep}`) && fs.existsSync(candidate)
      ? candidate
      : path.join(DIST, "index.html");
  sendFile(response, file);
}

async function handleApi(request, response, url) {
  const params = query(url);
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/catalog") {
    sendJson(response, 200, { roots: listRoots() });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/subjects") {
    const root = registeredRoot(params.root);
    const subjects = listSubjects(root).map((name) => ({
      name,
      rounds: listRounds(root, name),
    }));
    sendJson(response, 200, { root, subjects });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/delivery") {
    const root = registeredRoot(params.root);
    sendJson(
      response,
      200,
      buildDelivery(root, params.subject, {
        round: params.round,
        r: params.r,
      }),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/asset") {
    const root = registeredRoot(params.root);
    sendFile(
      response,
      assetFile(root, params.subject, params.round, params.name),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/review") {
    const body = await jsonBody(request);
    const root = registeredRoot(body.root);
    sendJson(
      response,
      200,
      writeReview(root, body.subject, body.round, body),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/unregister") {
    const body = await jsonBody(request);
    sendJson(response, 200, unregister(body.root));
    return;
  }
  throw Object.assign(new Error("not found"), { status: 404 });
}

export function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    try {
      if (!isLocalHost(request.headers.host)) {
        throw Object.assign(new Error("forbidden host"), { status: 403 });
      }
      if (request.method !== "GET" && !isLocalOrigin(request.headers.origin)) {
        throw Object.assign(new Error("forbidden origin"), { status: 403 });
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
        return;
      }
      if (request.method === "GET") {
        serveApp(response, url.pathname);
        return;
      }
      throw Object.assign(new Error("not found"), { status: 404 });
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      if (url.pathname.startsWith("/api/")) {
        sendJson(response, status, { error: error.message || "error" });
      } else {
        send(response, status, `${error.message || "error"}\n`, {
          "content-type": "text/plain; charset=utf-8",
        });
      }
    }
  });
}

export function listen({ port = 8765 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("port must be an integer between 1 and 65535");
  }
  if (port === 8005) {
    throw new Error("port 8005 is reserved for cpp-admin; pick another");
  }
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}
