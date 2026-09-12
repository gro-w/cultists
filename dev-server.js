/* eslint-env node */
/**
 * dev-server.js — Development server for "surrounded by cultists"
 *
 * Serves the game as static files AND exposes a tiny CGI-style API so the
 * in-browser developer panel can read/write JSON data files directly on
 * disk without a manual download/replace cycle.
 *
 * Usage:
 *   node dev-server.js [--port 8000]
 *   Then open: http://localhost:8000/?dev
 *
 * API surface (all under /api/):
 *   GET  /api/files            → JSON array of writable data filenames
 *   GET  /api/file?f=<name>    → raw JSON text of data/<lang>/<name>
 *   POST /api/file?f=<name>    → write JSON body to data/<lang>/<name>
 *                                (validates JSON, writes atomically via
 *                                 a .tmp file then rename)
 *   GET  /api/events           → SSE stream; emits "file-changed" events
 *                                when any watched file changes on disk
 *
 * All API routes set CORS headers so the page can call them even if the
 * origin differs (e.g. a browser opened from a different port).
 *
 * Existing files are writable, and the controlled custom-window namespace
 * (applist.json/app_*.json) may also be created by the visual editor.
 * Path traversal is rejected. This is a local-dev tool, not a production server.
 *
 * DEV-TOOLS blocks: this file is excluded from publish.js (it is listed in
 * the copy-tree skip list via its own name check) — but it contains no
 * DEV-TOOLS markers itself because it is a server-only Node script, not a
 * browser module.
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = __dirname;
const DEFAULT_PORT = 8000;
const DEFAULT_LANG = "zh-hans";

const port = (() => {
  const idx = process.argv.indexOf("--port");
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || DEFAULT_PORT : DEFAULT_PORT;
})();

const lang = (() => {
  const idx = process.argv.indexOf("--lang");
  return idx !== -1 ? process.argv[idx + 1] || DEFAULT_LANG : DEFAULT_LANG;
})();

/** Absolute path to the language-scoped data directory. */
const DATA_DIR = path.join(ROOT, "data", lang);

// ---------------------------------------------------------------------------
// MIME types for static serving
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".wav":  "audio/wav",
  ".mp3":  "audio/mpeg",
  ".ogg":  "audio/ogg",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
};

// ---------------------------------------------------------------------------
// SSE broadcaster
// ---------------------------------------------------------------------------

/** @type {Set<http.ServerResponse>} */
const sseClients = new Set();

function sseWrite(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {
    sseClients.delete(res);
  }
}

function broadcast(event, data) {
  for (const res of sseClients) {
    sseWrite(res, event, data);
  }
}

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

/** Debounce map: filename → timeout handle */
const _debounce = new Map();

function watchDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    console.warn(`[watch] Data directory not found: ${DATA_DIR}`);
    return;
  }
  // Watch the whole directory; individual file events are debounced 80 ms to
  // avoid double-firing on atomic writes (write + rename).
  fs.watch(DATA_DIR, { persistent: false }, (eventType, filename) => {
    if (!filename || !filename.endsWith(".json")) return;
    if (_debounce.has(filename)) clearTimeout(_debounce.get(filename));
    _debounce.set(filename, setTimeout(() => {
      _debounce.delete(filename);
      console.log(`[watch] ${filename} changed on disk → broadcasting`);
      broadcast("file-changed", { filename, ts: Date.now() });
    }, 80));
  });
  console.log(`[watch] Watching ${DATA_DIR}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a caller-supplied filename to a safe absolute path inside DATA_DIR.
 * Returns null if the name is missing, contains path separators, or resolves
 * outside DATA_DIR.
 */
function safeDataPath(filename) {
  if (!filename || typeof filename !== "string") return null;
  // Reject anything that looks like a path traversal
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  const resolved = path.resolve(DATA_DIR, filename);
  // Must still be inside DATA_DIR
  if (!resolved.startsWith(DATA_DIR + path.sep) && resolved !== DATA_DIR) return null;
  return resolved;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

/** GET /api/files → sorted list of .json filenames in DATA_DIR */
function handleListFiles(res) {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    jsonResponse(res, 200, { files, lang, dataDir: DATA_DIR });
  } catch (err) {
    jsonResponse(res, 500, { error: err.message });
  }
}

/** GET /api/file?f=<name> → raw file contents as JSON */
function handleReadFile(res, filename) {
  const filePath = safeDataPath(filename);
  if (!filePath) return jsonResponse(res, 400, { error: "Invalid filename." });
  if (!fs.existsSync(filePath)) return jsonResponse(res, 404, { error: `${filename} not found.` });
  try {
    const text = fs.readFileSync(filePath, "utf8");
    // Validate it is actually JSON before forwarding
    JSON.parse(text);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(text);
  } catch (err) {
    jsonResponse(res, 500, { error: err.message });
  }
}

/**
 * POST /api/file?f=<name>
 * Body: JSON text of the new file content.
 * Writes atomically: body → <name>.tmp → rename to <name>.
 */
async function handleWriteFile(req, res, filename) {
  const filePath = safeDataPath(filename);
  if (!filePath) return jsonResponse(res, 400, { error: "Invalid filename." });
  // The editor may create only its own two controlled data families.
  const canCreate = filename === "applist.json" || /^app_[a-z][a-z0-9_-]{1,48}\.json$/.test(filename);
  if (!fs.existsSync(filePath) && !canCreate) return jsonResponse(res, 404, { error: `${filename} not found.` });

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return jsonResponse(res, 400, { error: `Failed to read request body: ${err.message}` });
  }

  // Validate JSON before touching the file
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return jsonResponse(res, 422, { error: `Invalid JSON: ${err.message}` });
  }

  // Normalise to 2-space indented JSON (matches the project's own style)
  const normalised = `${JSON.stringify(parsed, null, 2)}\n`;

  // Atomic write via a sibling .tmp file
  const tmpPath = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, normalised, "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    return jsonResponse(res, 500, { error: `Write failed: ${err.message}` });
  }

  console.log(`[api] Written: ${filename} (${normalised.length} bytes)`);
  jsonResponse(res, 200, { ok: true, filename, bytes: normalised.length });
}

/** GET /api/events → Server-Sent Events stream */
function handleSSE(req, res) {
  res.writeHead(200, {
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.flushHeaders();

  // Heartbeat comment every 25 s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch (_) { /* ignore */ }
  }, 25_000);

  sseClients.add(res);
  console.log(`[sse] client connected (total: ${sseClients.size})`);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`[sse] client disconnected (total: ${sseClients.size})`);
  });
}

// ---------------------------------------------------------------------------
// Static file handler
// ---------------------------------------------------------------------------

function handleStatic(req, res, pathname) {
  // Default to index.html for bare "/"
  if (pathname === "/") pathname = "/index.html";

  // Prevent directory traversal
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`Not found: ${pathname}`);
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Server error: ${err.message}`);
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  // CORS pre-flight
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (pathname.startsWith("/api/")) {
    setCorsHeaders(res);

    if (pathname === "/api/files" && req.method === "GET") {
      return handleListFiles(res);
    }
    if (pathname === "/api/file" && req.method === "GET") {
      return handleReadFile(res, query.f);
    }
    if (pathname === "/api/file" && req.method === "POST") {
      return handleWriteFile(req, res, query.f).catch((err) => {
        console.error("[api] Unhandled error:", err);
        jsonResponse(res, 500, { error: err.message });
      });
    }
    if (pathname === "/api/events" && req.method === "GET") {
      return handleSSE(req, res);
    }

    // Unknown API endpoint
    jsonResponse(res, 404, { error: `Unknown API endpoint: ${req.method} ${pathname}` });
    return;
  }

  // Static files
  handleStatic(req, res, pathname);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(port, "127.0.0.1", () => {
  const w = 49;
  const line = "─".repeat(w);
  console.log(`\n┌${line}┐`);
  console.log(`│  surrounded by cultists — Dev Server${" ".repeat(w - 38)}│`);
  console.log(`├${line}┤`);
  console.log(`│  http://localhost:${port}/?dev${" ".repeat(w - 22 - String(port).length)}│`);
  console.log(`│${" ".repeat(w)}│`);
  console.log(`│  Static : /                           ${" ".repeat(w - 39)}│`);
  console.log(`│  API    : GET  /api/files             ${" ".repeat(w - 39)}│`);
  console.log(`│           GET  /api/file?f=<name>     ${" ".repeat(w - 39)}│`);
  console.log(`│           POST /api/file?f=<name>     ${" ".repeat(w - 39)}│`);
  console.log(`│           GET  /api/events  (SSE)     ${" ".repeat(w - 39)}│`);
  console.log(`│  Lang   : ${lang}${" ".repeat(w - 11 - lang.length)}│`);
  console.log(`└${line}┘\n`);
  watchDataDir();
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n✗ Port ${port} is already in use.`);
    console.error(`  Try: node dev-server.js --port ${port + 1}\n`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
