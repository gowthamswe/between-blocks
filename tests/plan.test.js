import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayFor, dayItems, findItem, pickDay, targetText, entryText, entriesFor, logDefaults, dayStatus, coachSet, coachEntry, progress, logText } from "../js/plan.js";
import { setProgress, tickSet, undoSet, manualEntry, timerState } from "../js/plan.js";
import { createLocalStore } from "../js/store.js";
import { EXERCISES } from "../js/exercises.js";

const load = (p) => JSON.parse(readFileSync(new URL("../data/" + p, import.meta.url)));
const plan = load("plan.json");
const hist = load("history.json");

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const fetchData = async (url) => load(url.replace(/^data\//, ""));

test("the copied plan has every day from Between Blocks and only exercises the app knows", () => {
  assert.equal(plan.days.length, 10);
  assert.equal(plan.days[0].date, "2026-10-14");
  assert.equal(plan.days.at(-1).date, "2026-10-23");
  assert.equal(plan.undo, undefined, "the one-time skip snapshot is left behind");
  for (const d of plan.days) for (const it of dayItems(d)) assert.ok(EXERCISES[it.ex], `${d.date}: unknown exercise ${it.ex}`);
  const today = dayFor(plan, "2026-10-23");
  const push = dayItems(today).find((it) => it.ex === "pushup");
  assert.equal(targetText(push), "3 × 8");
  assert.equal(push.rest, 60);
});

test("skipped days stay skipped", () => {
  assert.equal(dayFor(plan, "2026-10-22").skipped, true);
  assert.equal(dayStatus(dayFor(plan, "2026-10-22"), [], []), "skipped");
});

test("opens today, else the next planned day, else the last", () => {
  assert.equal(pickDay(plan, "2026-10-19"), "2026-10-19");
  assert.equal(pickDay(plan, "2026-10-01"), "2026-10-14");
  assert.equal(pickDay(plan, "2026-11-01"), "2026-10-23");
});

test("finds an item from a coach link", () => {
  const f = findItem(plan, "2026-10-23", 0, 4);
  assert.equal(f.item.ex, "pushup");
  assert.equal(f.item.reps, 8);
  assert.equal(findItem(plan, "2026-10-23", 0, 99), null);
  assert.equal(findItem(plan, "2030-01-01", 0, 0), null);
});

test("history from Between Blocks matches planned items by day and exercise", () => {
  const d = dayFor(plan, "2026-10-19");
  const items = dayItems(d);
  for (const it of items) assert.equal(entriesFor(hist.entries, d.date, it).length, 1, it.ex);
  assert.equal(dayStatus(d, hist.entries, hist.done), "done");
  assert.equal(dayStatus(dayFor(plan, "2026-10-23"), hist.entries, hist.done), "todo");
});

test("log form starts at the target with the last weight used", () => {
  const d = dayFor(plan, "2026-10-20");
  const goblet = dayItems(d).find((it) => it.ex === "goblet");
  assert.deepEqual(logDefaults(goblet, hist.entries, d.date), { sets: 3, reps: 12, w: 10 });
  const hang = dayItems(dayFor(plan, "2026-10-23")).find((it) => it.ex === "hang");
  assert.deepEqual(logDefaults(hang, hist.entries, "2026-10-23"), { sets: 2, reps: 20, w: 0 });
});

test("coach sets become one entry: lowest set as reps, detail kept", () => {
  const r = (score, faults = []) => ({ score, faults, lowerMs: 2000, minElbow: 90 });
  const s1 = coachSet([r(100), r(100), r(80, ["sag"])]);
  const s2 = coachSet([r(90), r(70, ["shallow"])]);
  assert.equal(s1.reps, 3); assert.deepEqual(s1.faults, { sag: 1 }); assert.equal(s1.lowerS, 2);
  const { item } = findItem(plan, "2026-10-23", 0, 4);
  const e = coachEntry([s1, s2], { day: "2026-10-23", item, ts: 1 });
  assert.deepEqual({ ex: e.ex, sets: e.sets, reps: e.reps, perSet: e.perSet, item: e.item, src: e.src, form: e.form, faults: e.faults },
    { ex: "pushup", sets: 2, reps: 2, perSet: [3, 2], item: 4, src: "coach", form: 88, faults: { sag: 1, shallow: 1 } });
  assert.equal(entryText(e), "2 sets: 3, 2");
  assert.equal(entryText({ ...e, perSet: [8, 8, 8], sets: 3, reps: 8 }), "3 × 8");
  assert.equal(entriesFor([e], "2026-10-23", item).length, 1);
});

test("progress shows the trail and the trend", () => {
  const p = progress(hist.entries);
  const push = p.find((x) => x.ex === "pushup");
  assert.equal(push.trail.join(" "), "5 6 6 6 7 7");
  assert.equal(push.trend, "same");
  const more = { ex: "pushup", sets: 3, reps: 7, perSet: [8, 8, 7], w: 0, ts: Date.now(), day: "2026-10-23" };
  assert.equal(progress([...hist.entries, more]).find((x) => x.ex === "pushup").trend, "up", "8, 8, 7 beats 3 × 7");
  const goblet = p.find((x) => x.ex === "goblet");
  assert.equal(goblet.trail.at(-1), "12@10");
});

test("log text for Claude includes the coach's form details", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 4);
  const e = coachEntry([coachSet([{ score: 90, faults: ["sag"], lowerMs: 1900, minElbow: 91 }])], { day: "2026-10-23", item, ts: 2 });
  const t = logText([...hist.entries, e], hist.done, { since: "2026-10-20" });
  assert.match(t, /^2026-10-20 · session done, 33 min/);
  assert.match(t, /2026-10-23\n- Push-up: 1 × 1 \(camera coach: form 90\/100, faults sag 1, lowering 1.9s, depth 91°\)/);
  assert.doesNotMatch(t, /2026-10-19/);
});

test("local store seeds once from the export, then keeps its own log", async () => {
  const storage = memStorage();
  const s = createLocalStore({ storage, fetchJson: fetchData });
  assert.equal((await s.entries()).length, 73);
  assert.equal((await s.done()).length, 10);
  const e = await s.addEntry({ ex: "pushup", sets: 3, reps: 8, w: 0, day: "2026-10-23", block: 0, item: 4 });
  assert.ok(e.id && e.ts);
  await s.markDone({ date: "2026-10-23" });
  // a second app instance (the coach page) sees the same log and doesn't re-seed
  const s2 = createLocalStore({ storage, fetchJson: fetchData });
  assert.equal((await s2.entries()).length, 74);
  await s2.removeEntry(e.id);
  assert.equal((await s.entries()).length, 73);
  await s.unmarkDone("2026-10-23");
  assert.equal((await s.done()).length, 10);
});

test("coach drafts survive a reload and clear after saving", async () => {
  const storage = memStorage();
  const s = createLocalStore({ storage, fetchJson: fetchData });
  await s.saveDraft("2026-10-23.0.4", { sets: [{ reps: 8 }] });
  const s2 = createLocalStore({ storage, fetchJson: fetchData });
  assert.deepEqual(await s2.draft("2026-10-23.0.4"), { sets: [{ reps: 8 }] });
  await s2.clearDraft("2026-10-23.0.4");
  assert.equal(await s.draft("2026-10-23.0.4"), null);
});

test("export holds everything needed to move to another store", async () => {
  const s = createLocalStore({ storage: memStorage(), fetchJson: fetchData });
  const x = await s.exportAll();
  assert.equal(x.plan.days.length, 10);
  assert.equal(x.entries.length, 73);
  assert.equal(x.seeded.from, "2026-10-23");
});

test("a missing history export starts empty instead of failing", async () => {
  const s = createLocalStore({ storage: memStorage(), fetchJson: async (u) => { if (u.endsWith("history.json")) throw new Error("404"); return fetchData(u); } });
  assert.deepEqual(await s.entries(), []);
  assert.equal((await s.plan()).days.length, 10);
});

test("sets fill one at a time, rest starts between sets, the last set logs the exercise", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 3);            // band pull-up 3 × 5, rest 90
  assert.deepEqual(setProgress(item, null), { done: 0, total: 3, logged: false });
  let r = tickSet(item, null, { now: 1000 });
  assert.equal(r.complete, false);
  assert.deepEqual(r.draft, { manual: 1, held: [], restEnd: 91000, holdStart: null });
  assert.equal(setProgress(item, r.draft).done, 1);
  r = tickSet(item, r.draft, { now: 200000 });
  assert.equal(setProgress(item, r.draft).done, 2);
  assert.deepEqual(setProgress(item, undoSet(r.draft)), { done: 1, total: 3, logged: false });
  assert.equal(undoSet({ manual: 1 }), null);
  r = tickSet(item, r.draft);
  assert.equal(r.complete, true); assert.equal(r.draft, null);
  const e = manualEntry(item, r, { day: "2026-10-23", ts: 5 });
  assert.deepEqual(e, { ex: "pullup_b", sets: 3, reps: 5, w: 0, ts: 5, day: "2026-10-23", block: 0, item: 3, src: "sets" });
  assert.deepEqual(setProgress(item, null, [e]), { done: 3, total: 3, logged: true });
  assert.equal(entriesFor([e], "2026-10-23", item).length, 1);
});

test("timed holds log the shortest hold", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 0);            // dead hang 2 × 20 s
  const r1 = tickSet(item, { manual: 0, held: [], holdStart: 1 }, { held: 22.4 });
  const r2 = tickSet(item, r1.draft, { held: 19.6 });
  assert.equal(r2.complete, true);
  const e = manualEntry(item, r2, { day: "2026-10-23", ts: 1 });
  assert.equal(e.reps, 20); assert.deepEqual(e.perSet, [22, 20]);
  assert.equal(entryText(e), "2 sets: 22, 20 s");
});

test("camera coach sets fill the bars too", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 4);
  assert.deepEqual(setProgress(item, { sets: [{ reps: 8 }, { reps: 7 }] }), { done: 2, total: 3, logged: false });
});

test("the timer tile shows rest, then go, or a running hold", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 3);
  assert.deepEqual(timerState(item, null), { mode: "idle", text: "1:30", label: "rest", tone: "idle" });
  assert.deepEqual(timerState(item, { restEnd: 100000 }, 28000), { mode: "rest", text: "1:12", label: "rest", tone: "rest" });
  assert.equal(timerState(item, { restEnd: 100000 }, 100500).text, "Go");
  const hang = findItem(plan, "2026-10-23", 0, 0).item;
  assert.deepEqual(timerState(hang, { holdStart: 1000 }, 13300), { mode: "hold", text: "12s", label: "hold · goal 20s", tone: "live" });
  assert.equal(timerState(hang, { holdStart: 1000 }, 21000).tone, "go");
});
