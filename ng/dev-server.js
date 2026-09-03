import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const host = "127.0.0.1";
const port = Number(process.env.PORT || 8000);
const mime = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".md":"text/markdown; charset=utf-8"};
const allowed = (name) => name === "engine.json" || /^windows\/[A-Za-z0-9_-]+\.json$/.test(name) || /^activity-lists\/[A-Za-z0-9_-]+\.json$/.test(name) || /^activities\/[A-Za-z0-9_-]+\.json$/.test(name);

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {"Content-Type": type, "Cache-Control":"no-store"});
  res.end(body);
}
function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const target = path.resolve(root, `.${decoded}`);
  return target.startsWith(root + path.sep) ? target : null;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/api/files") {
      const entries = await fs.readdir(path.join(root, "data/windows"));
      return send(res, 200, JSON.stringify(["engine.json", ...entries.map((x) => `windows/${x}`)]), "application/json; charset=utf-8");
    }
    if (req.method === "POST" && url.pathname === "/api/file") {
      const name = url.searchParams.get("f") || "";
      if (!allowed(name)) return send(res, 400, "File is outside the allowed data namespace");
      const target = path.resolve(root, "data", name);
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      const temp = `${target}.tmp`;
      await fs.writeFile(temp, JSON.stringify(parsed, null, 2) + String.fromCharCode(10), "utf8");
      try { await fs.rename(temp, target); } catch (error) { if (!['EEXIST', 'EPERM'].includes(error.code)) throw error; await fs.rm(target, { force: true }); await fs.rename(temp, target); }
      return send(res, 200, JSON.stringify({ok:true, file:name}), "application/json; charset=utf-8");
    }
    if (req.method !== "GET") return send(res, 405, "Method not allowed");
    const target = safePath(url.pathname === "/" ? "/index.html" : url.pathname);
    if (!target) return send(res, 403, "Forbidden");
    const stat = await fs.stat(target);
    if (!stat.isFile()) return send(res, 404, "Not found");
    return send(res, 200, await fs.readFile(target), mime[path.extname(target)] || "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT") return send(res, 404, "Not found");
    return send(res, 500, error.message);
  }
});
server.listen(port, host, () => console.log(`cultists NG dev server: http://${host}:${port}/`));
