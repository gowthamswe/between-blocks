// Plans a one-way sync of local progress into the Between Blocks artifact's database (stopgap
// until there's shared storage). Claude runs it, then applies the writes with its ArtifactData tool.
//
//   node tools/bb-sync.mjs <bb-dump-dir> [out.json]
//
// <bb-dump-dir> holds a fresh dump of the artifact: entries/<id>.json and done/<id>.json.
// Reads data/progress.json (written by tools/serve.mjs) and data/history.json (what was already there).
//
// Rules:
//  - local entries that aren't from the export are created in Between Blocks with the same id
//  - finished sessions are created as done/<date>_<block>
//  - anything this sync wrote earlier (marked via: "bb-coach") that's gone locally is deleted there
//  - anything logged directly in Between Blocks is left alone and reported, never deleted
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [dump, outPath] = process.argv.slice(2);
if (!dump) { console.error("usage: node tools/bb-sync.mjs <bb-dump-dir> [out.json]"); process.exit(2); }

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const readDir = (d) => {
  const dir = join(dump, d), m = new Map();
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".json")) { const j = readJson(join(dir, f)); m.set(f.slice(0, -5), j.data || j); }
  return m;
};
const progressFile = join(ROOT, "data", "progress.json");
if (!existsSync(progressFile)) { console.error("No data/progress.json yet. Run `npm run serve` and open the app once."); process.exit(1); }
const local = readJson(progressFile);
const hist = readJson(join(ROOT, "data", "history.json"));
const bbEntries = readDir("entries"), bbDone = readDir("done");

const exportedIds = new Set(hist.entries.map((e) => e.id));
const exportedDone = new Set(hist.done.map((d) => `${d.date}_${d.block ?? 0}`));
const VIA = "bb-coach";
const KEEP = ["ex", "w", "reps", "sets", "ts", "day", "block", "item", "src", "perSet", "form", "faults", "lowerS", "depth", "edited", "corrected"];
const clean = (e) => { const o = { via: VIA }; for (const k of KEEP) if (e[k] !== undefined) o[k] = e[k]; return o; };
// compare by content: key order (at any depth) doesn't matter; Between Blocks may store fields in another order
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const writes = [], report = { create: [], update: [], delete: [], onlyInBB: [], unchanged: 0 };
const label = (e) => `${e.day || "?"} ${e.ex} ${e.sets}×${e.reps}${e.w ? ` @${e.w}` : ""}`;

// entries
const localIds = new Set();
for (const e of local.entries) {
  localIds.add(e.id);
  if (exportedIds.has(e.id)) continue;
  const doc = clean(e), have = bbEntries.get(e.id);
  if (!have) { writes.push({ op: "set", collection: "entries", doc_id: e.id, data: doc }); report.create.push(label(e)); }
  else if (!same(have, doc)) { writes.push({ op: "set", collection: "entries", doc_id: e.id, data: doc, if_version: 1 }); report.update.push(label(e)); }
  else report.unchanged++;
}
for (const [id, e] of bbEntries) {
  if (localIds.has(id) || exportedIds.has(id)) continue;
  if (e.via === VIA) { writes.push({ op: "delete", collection: "entries", doc_id: id, if_version: 1 }); report.delete.push(label(e)); }
  else report.onlyInBB.push(label({ ...e, day: e.day || new Date(e.ts).toISOString().slice(0, 10) }));
}

// finished sessions
const localDone = new Set();
for (const d of local.done) {
  const id = `${d.date}_${d.block ?? 0}`; localDone.add(id);
  if (exportedDone.has(id)) continue;
  const doc = { date: d.date, block: d.block ?? 0, ts: d.ts, via: VIA, ...(d.mins ? { mins: d.mins } : {}) };
  const have = bbDone.get(id);
  if (!have) { writes.push({ op: "set", collection: "done", doc_id: id, data: doc }); report.create.push(`${d.date} session done`); }
  else if (have.via !== VIA) report.unchanged++;   // marked done in Between Blocks already; leave it
  else if (!same(have, doc)) { writes.push({ op: "set", collection: "done", doc_id: id, data: doc, if_version: 1 }); report.update.push(`${d.date} session done`); }
  else report.unchanged++;
}
for (const [id, d] of bbDone) {
  if (localDone.has(id) || exportedDone.has(id)) continue;
  if (d.via === VIA) { writes.push({ op: "delete", collection: "done", doc_id: id, if_version: 1 }); report.delete.push(`${d.date} session done`); }
  else report.onlyInBB.push(`${d.date} session done`);
}

if (outPath) writeFileSync(outPath, JSON.stringify(writes, null, 1));
console.log(JSON.stringify({ progressSaved: local.saved, writes: writes.length, ...report }, null, 1));
