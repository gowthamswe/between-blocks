// Local dev server: serves the app, and keeps a copy of the browser's progress on disk.
// The app PUTs its log to /api/progress after every change; it lands in data/progress.json,
// where Claude reads it to sync progress into the Between Blocks artifact (until there's shared storage).
//
//   node tools/serve.mjs [port]      (default 8000, localhost only)
import { createServer } from "node:http";
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROGRESS = join(ROOT, "data", "progress.json");
const PORT = Number(process.argv[2] || 8000);
const MAX_BODY = 5 * 1024 * 1024;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

async function saveProgress(req, res) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413).end(); return; } chunks.push(c); }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { res.writeHead(400).end("bad json"); return; }
  if (!data || !Array.isArray(data.entries) || !Array.isArray(data.done)) { res.writeHead(400).end("need entries and done"); return; }
  const out = { saved: new Date().toISOString(), seeded: data.seeded || null, entries: data.entries, done: data.done };
  await writeFile(PROGRESS + ".tmp", JSON.stringify(out, null, 1));
  await rename(PROGRESS + ".tmp", PROGRESS);
  res.writeHead(204).end();
}

async function serveFile(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || file.split(sep).some((p) => p.startsWith(".") && p.length > 1)) { res.writeHead(403).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch { res.writeHead(404).end("not found"); }
}

createServer(async (req, res) => {
  try {
    if (req.url === "/api/progress" && req.method === "PUT") return await saveProgress(req, res);
    if (req.method === "GET" || req.method === "HEAD") return await serveFile(req, res);
    res.writeHead(405).end();
  } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500).end(); }
}).listen(PORT, "127.0.0.1", () => console.log(`Between Blocks on http://localhost:${PORT}  (progress copy: data/progress.json)`));
