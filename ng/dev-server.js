/* eslint-env node */
/**
 * dev-server.js — local development server for ng/ (Phase 1).
 *
 * Serves ng/ as static files and exposes a write-only JSON API scoped to
 * ng/data/, for future developer-mode data editors. Binds to 127.0.0.1 only
 * — this is a local dev tool, not a production server, and must never be
 * exposed publicly (plan §3.2).
 *
 * The dev server never serves data back out through /api/ — developer-mode
 * tools must read game data the same way the game itself does (a normal
 * static fetch() of ng/data/..., e.g. via DataLoader), not through this API.
 * This API exists purely so a developer can persist edits to disk.
 *
 * Usage:
 *   node dev-server.js [--port 8000]
 *   Then open: http://127.0.0.1:8000/
 *
 * API surface (all under /api/):
 *   POST /api/file?f=<name> → validates JSON body, then atomically
 *                             writes ng/data/<name>, creating it (and any
 *                             missing parent directories under data/) if it
 *                             does not already exist, or overwriting it
 *                             atomically if it does.
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DEFAULT_PORT = 8000;
const HOST = "127.0.0.1";

const port = (() => {
  const idx = process.argv.indexOf("--port");
  if (idx !== -1 && process.argv[idx + 1]) {
    const parsed = Number(process.argv[idx + 1]);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_PORT;
})();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
};

/** Resolve `name` inside DATA_DIR, rejecting any path traversal. */
function resolveDataFile(name) {
  if (typeof name !== "string" || !name || name.includes("\0")) return null;
  const resolved = path.resolve(DATA_DIR, name);
  const relative = path.relative(DATA_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(ROOT, relative);
  if (path.relative(ROOT, filePath).startsWith("..")) return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    const ext = path.extname(filePath);
    send(res, 200, data, MIME[ext] || "application/octet-stream");
  });
}

function handleApi(req, res, pathname, query) {
  if (pathname === "/api/file" && req.method === "POST") {
    const filePath = resolveDataFile(query.f);
    if (!filePath) {
      return send(res, 400, JSON.stringify({ error: "invalid or unknown file name" }));
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        JSON.parse(body);
      } catch {
        return send(res, 400, JSON.stringify({ error: "invalid JSON" }));
      }
      fs.mkdir(path.dirname(filePath), { recursive: true }, (mkdirErr) => {
        if (mkdirErr) return send(res, 500, JSON.stringify({ error: "write failed" }));
        const tmpPath = `${filePath}.tmp`;
        fs.writeFile(tmpPath, body, (writeErr) => {
          if (writeErr) return send(res, 500, JSON.stringify({ error: "write failed" }));
          fs.rename(tmpPath, filePath, (renameErr) => {
            if (renameErr) return send(res, 500, JSON.stringify({ error: "write failed" }));
            send(res, 200, JSON.stringify({ ok: true }));
          });
        });
      });
    });
    return;
  }

  send(res, 404, JSON.stringify({ error: "unknown API route" }));
}

const server = http.createServer((req, res) => {
  const { pathname, query } = url.parse(req.url, true);
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname, query);
  serveStatic(req, res, pathname);
});

server.listen(port, HOST, () => {
  console.log(`ng dev server listening on http://${HOST}:${port}/`);
});
