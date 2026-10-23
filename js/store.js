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

const P = "bb.";

export function createLocalStore({ storage = globalThis.localStorage, fetchJson = defaultFetch, base = "data/" } = {}) {
  const get = (k, d) => { try { const v = storage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { storage.setItem(P + k, JSON.stringify(v)); };
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
      const list = get("entries", []); list.push(rec); set("entries", list);
      return rec;
    },
    async removeEntry(id) { await ready; set("entries", get("entries", []).filter((e) => e.id !== id)); },
    async done() { await ready; return get("done", []); },
    async markDone(rec) {
      await ready;
      const list = get("done", []).filter((d) => d.date !== rec.date);
      list.push({ block: 0, ts: Date.now(), ...rec }); set("done", list);
    },
    async unmarkDone(date) { await ready; set("done", get("done", []).filter((d) => d.date !== date)); },
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

async function defaultFetch(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}
