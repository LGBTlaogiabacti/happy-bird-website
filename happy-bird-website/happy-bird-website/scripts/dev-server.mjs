// Zero-dependency local preview: serves /public, mirrors the Netlify redirects and runs the
// real function handlers against a JSON file (.dev-data/). Use `netlify dev` for a closer replica.
//   ADMIN_PASSWORD=secret npm run dev
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setStoreFactory } from "../netlify/functions/_lib.js";
import auth from "../netlify/functions/auth.js";
import releases from "../netlify/functions/releases.js";
import platforms from "../netlify/functions/platforms.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const dataDir = process.env.DEV_DATA_DIR || path.join(root, ".dev-data");
fs.mkdirSync(dataDir, { recursive: true });
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = "dev-password";
  console.log("ℹ ADMIN_PASSWORD not set — using 'dev-password' for local preview only.");
}
setStoreFactory((name) => {
  const f = (k) => path.join(dataDir, `${name}__${k}.json`);
  return {
    async get(k) { try { return JSON.parse(fs.readFileSync(f(k), "utf8")); } catch { return null; } },
    async setJSON(k, v) { fs.writeFileSync(f(k), JSON.stringify(v, null, 2)); },
  };
});

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ogg": "audio/ogg", ".wav": "audio/wav", ".woff2": "font/woff2" };
const routes = [
  [/^\/api\/auth\//, auth], [/^\/api\/releases(\/|$)/, releases], [/^\/api\/platforms(\/|$)/, platforms],
];

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = routes.find(([re]) => re.test(url.pathname));
  if (route) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await route[1](new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), { ip: req.socket.remoteAddress });
    const headers = {}; r.headers.forEach((v, k) => (headers[k] = v));
    const sc = r.headers.getSetCookie?.(); if (sc?.length) headers["set-cookie"] = sc;
    res.writeHead(r.status, headers); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = url.pathname.replace(/\/+$/, "") || "/";
  if (p === "/new/releases" || p === "/new/base") p = "/admin.html";
  if (p === "/") p = "/index.html";
  const file = path.join(pub, decodeURIComponent(p));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(pub, "404.html"))); return;
  }
  res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 8888, () => console.log(`Happy Bird dev server → http://localhost:${process.env.PORT || 8888}`));
