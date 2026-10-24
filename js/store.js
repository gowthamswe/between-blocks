// Where the plan and progress live. Everything goes through this module so the backend can change
// (today: plan from data/plan.json, progress in this browser's localStorage; later: a shared store
// Claude writes the plan to and the app reads from). Every method is async for that reason.
//
//   plan()            the current plan (read-only here; Claude writes it)
//   entries()         every logged exercise, oldest first
//   addEntry(e)       log one; returns it with an id
//   removeEntry(id)
//   done()            finished sessions: [{ date, block, ts, mins? }]
//   markDone(rec) / unmarkDone(date)
//   draft(key) / saveDraft(key, value) / clearDraft(key)   coach sets in progress, survive a reload
//   exportAll()       everything, as one JSON object, for moving to another store
//
// On first run the local store is seeded from data/history.json (the log exported from Between Blocks).
//
// Mirror: on localhost, after every change the whole log is PUT to the dev server (tools/serve.mjs),
// which writes data/progress.json. Claude syncs that file into the Between Blocks artifact.
// Best effort: if the server isn't there (plain http.server, hosted copy), nothing breaks.

const P = "bb.";
const onLocalhost = () => { try { return ["localhost", "127.0.0.1", "[::1]"].includes(globalThis.location.hostname); } catch { return false; } };

export function createLocalStore({ storage = globalThis.localStorage, fetchJson = defaultFetch, base = "data/",
  mirror = onLocalhost() ? defaultMirror : null } = {}) {
  const get = (k, d) => { try { const v = storage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { storage.setItem(P + k, JSON.stringify(v)); };
  // One save in flight at a time, always the latest state, so an older save can't land after a newer one.
  let sending = false, again = false;
  const push = async () => {
    if (!mirror) return;
    if (sending) { again = true; return; }
    sending = true;
    try {
      do { again = false; await mirror({ seeded: get("seeded", null), entries: get("entries", []), done: get("done", []) }).catch(() => {}); } while (again);
    } finally { sending = false; }
  };
  let planCache = null;

  async function seed() {
    if (get("seeded", null)) return;
    let hist = null;
    try { hist = await fetchJson(base + "history.json"); } catch { /* no export: start empty */ }
    const have = get("entries", []);
    const ids = new Set(have.map((e) => e.id));
    const entries = have.concat(((hist && hist.entries) || []).filter((e) => !ids.has(e.id)));
    entries.sort((a, b) => a.ts - b.ts);
    const done = get("done", []);
    ((hist && hist.done) || []).forEach((d) => { if (!done.some((x) => x.date === d.date)) done.push(d); });
    set("entries", entries); set("done", done);
    set("seeded", { at: Date.now(), from: (hist && hist.exported) || null, count: entries.length });
  }
  const ready = seed();
  ready.then(() => push());   // send what's already here when the page opens, without making anything wait for it

  const newId = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    kind: "local",
    ready,
    async plan({ fresh = false } = {}) {
      if (!planCache || fresh) planCache = await fetchJson(base + "plan.json");
      return planCache;
    },
    async entries() { await ready; return get("entries", []); },
    async addEntry(e) {
      await ready;
      const rec = { ...e, id: e.id || newId(), ts: e.ts || Date.now() };
      const list = get("entries", []); list.push(rec); set("entries", list); push();
      return rec;
    },
    async removeEntry(id) { await ready; set("entries", get("entries", []).filter((e) => e.id !== id)); push(); },
    async done() { await ready; return get("done", []); },
    async markDone(rec) {
      await ready;
      const list = get("done", []).filter((d) => d.date !== rec.date);
      list.push({ block: 0, ts: Date.now(), ...rec }); set("done", list); push();
    },
    async unmarkDone(date) { await ready; set("done", get("done", []).filter((d) => d.date !== date)); push(); },
    async draft(key) { return get("draft." + key, null); },
    async saveDraft(key, value) { set("draft." + key, value); },
    async clearDraft(key) { try { storage.removeItem(P + "draft." + key); } catch { /* ignore */ } },
    async exportAll() {
      await ready;
      const plan = await this.plan().catch(() => null);
      return { version: 1, exported: new Date().toISOString(), store: "local", seeded: get("seeded", null),
        plan, entries: get("entries", []), done: get("done", []) };
    },
  };
}

async function defaultMirror(data) {
  const res = await fetch("api/progress", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error("mirror: " + res.status);
}

async function defaultFetch(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}
