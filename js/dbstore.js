// The plan and progress in the Between Blocks artifact's cloud database (the `db` capability), behind
// the same interface as the browser store (js/store.js), so the plan screen runs on either.
//
//   plan/week        the plan (Claude writes it; skipping a day rewrites it)
//   entries/<id>     one logged exercise each
//   done/<date>_0    a finished session
//   skips/<date>     a record of each skipped day
//   state/current    Claude's notes: block label, per-exercise trail and note, coach's notes
//
// Everything is live: the store subscribes once and keeps a copy; onChange fires when anything changes
// (a write from this page, another device, or Claude). In-progress sets stay in this browser (drafts).
import { skipPlan, undoSkipPlan, swapWhere } from "./plan.js";

const P = "bb.";

export function createDbStore(db, { storage = globalThis.localStorage } = {}) {
  let planDoc = null, entries = [], done = [], coach = null, loaded = { plan: false, entries: false, done: false };
  let notify = () => {};
  const firsts = {};
  const first = (k) => new Promise((r) => { firsts[k] = r; });
  const ready = Promise.all([first("plan"), first("entries"), first("done")]);
  const got = (k) => { if (!loaded[k]) { loaded[k] = true; firsts[k](); } else notify(); };
  let syncError = null;
  const fail = (k) => (e) => { syncError = (e && e.code) || "unavailable"; if (!loaded[k]) { loaded[k] = true; firsts[k](); } else notify(); };

  db.doc("plan/week").onSnapshot((s) => { planDoc = s.exists ? s.data() : null; got("plan"); }, fail("plan"));
  db.collection("entries").limit(1000).onSnapshot((s) => {
    entries = s.docs.map((d) => ({ ...d.data(), id: d.id })).filter((e) => e.ex && e.ts).sort((a, b) => a.ts - b.ts);
    got("entries");
  }, fail("entries"));
  db.collection("done").limit(1000).onSnapshot((s) => { done = s.docs.map((d) => ({ ...d.data() })); got("done"); }, fail("done"));
  db.doc("state/current").onSnapshot((s) => { coach = s.exists ? s.data() : null; if (loaded.plan) notify(); }, () => {});

  const get = (k, d) => { try { const v = storage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { storage.setItem(P + k, JSON.stringify(v)); } catch { /* private mode */ } };
  const newId = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    kind: "cloud",
    ready,
    set onChange(fn) { notify = fn; },
    async plan() { await ready; return planDoc; },
    async entries() { await ready; return entries; },
    async addEntry(e) {
      await ready;
      const rec = { ...e, id: e.id || newId(), ts: e.ts || Date.now() };
      const { id, ...body } = rec;
      entries = [...entries.filter((x) => x.id !== id), rec].sort((a, b) => a.ts - b.ts);   // show it now; the snapshot confirms
      await db.collection("entries").doc(id).set(body);
      return rec;
    },
    async removeEntry(id) { await ready; entries = entries.filter((x) => x.id !== id); await db.doc("entries/" + id).delete(); },
    async done() { await ready; return done; },
    async markDone(rec) {
      await ready;
      const body = { block: 0, ts: Date.now(), ...rec };
      done = [...done.filter((d) => d.date !== rec.date), body];
      await db.doc(`done/${rec.date}_0`).set(body);
    },
    async unmarkDone(date) { await ready; done = done.filter((d) => d.date !== date); await db.doc(`done/${date}_0`).delete(); },
    async draft(key) { return get("draft." + key, null); },
    async saveDraft(key, value) { set("draft." + key, value); },
    async clearDraft(key) { try { storage.removeItem(P + "draft." + key); } catch { /* ignore */ } },
    // cloud-only extras
    coach() { return coach; },
    status() { return syncError ? `Live sync stopped (${syncError}). Reload the page.` : "Connected. Everything saves automatically."; },
    async skipDay(date) {
      const r = skipPlan(planDoc, date);
      if (!r) return;
      planDoc = r.plan;
      await db.doc("plan/week").set(r.plan);
      await db.doc("skips/" + date).set(r.record).catch(() => {});
    },
    async undoSkip(date) {
      planDoc = undoSkipPlan(planDoc);
      await db.doc("plan/week").set(planDoc);
      await db.doc("skips/" + date).delete().catch(() => {});
    },
    // home <-> cable machine for one day (the plan carries both versions)
    async swapDay(date) {
      const next = swapWhere(planDoc, date);
      if (!next) return;
      planDoc = next;
      await db.doc("plan/week").set(next);
    },
    async exportAll() { await ready; return { version: 1, exported: new Date().toISOString(), store: "cloud", plan: planDoc, entries, done }; },
  };
}
