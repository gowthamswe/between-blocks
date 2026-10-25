import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayFor, dayItems, findItem, pickDay, targetText, entryText, entriesFor, logDefaults, dayStatus, coachSet, coachEntry, progress, logText } from "../js/plan.js";
import { itemKey } from "../js/plan.js";
import { setProgress, tickSet, undoSet, entryFromSets, timerState, nextReps, adjustReps, setsFromEntry, holdState, startHold, heldSecs, HOLD_LEAD_MS, beepFor } from "../js/plan.js";
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
  assert.equal(plan.days.filter((d) => d.date <= "2026-10-23").length, 10, "the 10 days copied from Between Blocks");
  assert.equal(plan.days[0].date, "2026-10-14");
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
  assert.equal(pickDay(plan, "2026-11-01"), plan.days.at(-1).date);
});

test("finds an item from a coach link", () => {
  const f = findItem(plan, "2026-10-23", 0, 5);
  assert.equal(f.item.ex, "pushup");
  assert.equal(f.item.reps, 8);
  assert.equal(findItem(plan, "2026-10-23", 0, 100), null);
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
  const { item } = findItem(plan, "2026-10-23", 0, 5);
  const e = coachEntry([s1, s2], { day: "2026-10-23", item, ts: 1 });
  assert.deepEqual({ ex: e.ex, sets: e.sets, reps: e.reps, perSet: e.perSet, item: e.item, src: e.src, form: e.form, faults: e.faults },
    { ex: "pushup", sets: 2, reps: 2, perSet: [3, 2], item: 5, src: "coach", form: 88, faults: { sag: 1, shallow: 1 } });
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
  const { item } = findItem(plan, "2026-10-23", 0, 5);
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
  assert.equal(x.plan.days.length, plan.days.length);
  assert.equal(x.entries.length, 73);
  assert.equal(x.seeded.from, "2026-10-23");
});

test("a missing history export starts empty instead of failing", async () => {
  const s = createLocalStore({ storage: memStorage(), fetchJson: async (u) => { if (u.endsWith("history.json")) throw new Error("404"); return fetchData(u); } });
  assert.deepEqual(await s.entries(), []);
  assert.equal((await s.plan()).days.length, plan.days.length);
});

test("sets fill one at a time, rest starts between sets, the last set logs the exercise", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 4);            // band pull-up 3 × 5, rest 90
  assert.deepEqual(setProgress(item, null), { done: 0, total: 3, logged: false });
  let r = tickSet(item, null, { now: 1000 });
  assert.equal(r.complete, false);
  assert.deepEqual(r.draft, { sets: [{ reps: 5, ts: 1000, manual: true }], restEnd: 91000, holdStart: null });
  assert.equal(setProgress(item, r.draft).done, 1);
  r = tickSet(item, r.draft, { now: 200000 });
  assert.equal(setProgress(item, r.draft).done, 2);
  assert.equal(setProgress(item, undoSet(r.draft)).done, 1);
  assert.equal(undoSet({ sets: [{ reps: 5, manual: true }] }), null);
  r = tickSet(item, r.draft, { now: 300000 });
  assert.equal(r.complete, true); assert.equal(r.draft, null);
  const e = entryFromSets(item, r.sets, { day: "2026-10-23", ts: 5 });
  assert.deepEqual(e, { ex: "pullup_b", sets: 3, reps: 5, w: 0, ts: 5, day: "2026-10-23", block: 0, item: 4, src: "sets" });
  assert.deepEqual(setProgress(item, null, [e]), { done: 3, total: 3, logged: true });
  assert.equal(entriesFor([e], "2026-10-23", item).length, 1);
});

test("the arrows change reps for the set you're on; each set keeps its own reps", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 2);            // scapular pull 2 × 6
  assert.equal(nextReps(item, null), 6);
  let dr = adjustReps(item, null, -1); dr = adjustReps(item, dr, -1);
  assert.equal(nextReps(item, dr), 4);
  assert.equal(adjustReps(item, dr, 2).next, undefined, "back at the plan's number");
  assert.equal(nextReps(item, adjustReps(item, { next: 0 }, -1)), 0, "never below 0");
  const r1 = tickSet(item, { sets: [], next: 7 }, { now: 1 });     // went one over
  assert.equal(r1.draft.next, undefined, "next set starts at the plan's reps again");
  const r2 = tickSet(item, adjustReps(item, r1.draft, -2), { now: 2 });
  assert.equal(r2.complete, true);
  const e = entryFromSets(item, r2.sets, { day: "2026-10-23", ts: 3 });
  assert.deepEqual([e.sets, e.reps, e.perSet], [2, 4, [7, 4]]);
  assert.equal(entryText(e), "2 sets: 7, 4");
});

test("timed holds log the shortest hold", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 1);            // dead hang 2 × 20 s
  const r1 = tickSet(item, { sets: [], holdStart: 1 }, { held: 22.4 });
  const r2 = tickSet(item, r1.draft, { held: 19.6 });
  assert.equal(r2.complete, true);
  const e = entryFromSets(item, r2.sets, { day: "2026-10-23", ts: 1 });
  assert.equal(e.reps, 20); assert.deepEqual(e.perSet, [22, 20]);
  assert.equal(entryText(e), "2 sets: 22, 20 s");
});

test("camera and hand-ticked sets mix: form comes from the camera sets only", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 5);            // push-up 3 × 8
  const cam = coachSet([{ score: 90, faults: ["sag"], lowerMs: 2000, minElbow: 90 }, { score: 100, faults: [], lowerMs: 2000, minElbow: 90 }]);
  const r = tickSet(item, tickSet(item, { sets: [cam] }).draft);
  assert.equal(r.complete, true);
  const e = entryFromSets(item, r.sets, { day: "2026-10-23", ts: 1 });
  assert.equal(e.src, "coach"); assert.deepEqual(e.perSet, [2, 8, 8]); assert.equal(e.form, 95); assert.equal(e.lowerS, 2); assert.deepEqual(e.faults, { sag: 1 });
});

test("drafts saved as a count (before sets were a list) still work", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 4);
  assert.equal(setProgress(item, { manual: 2 }).done, 2);
  const r = tickSet(item, { manual: 2 });
  assert.equal(r.complete, true);
  assert.deepEqual(r.sets.map((x) => x.reps), [5, 5, 5]);
});

test("camera coach sets fill the bars too", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 5);
  assert.deepEqual(setProgress(item, { sets: [{ reps: 8 }, { reps: 7 }] }), { done: 2, total: 3, logged: false });
});

test("the timer tile shows rest, then go", () => {
  const { item } = findItem(plan, "2026-10-23", 0, 4);
  assert.deepEqual(timerState(item, null), { mode: "idle", text: "1:30", label: "rest", tone: "idle" });
  assert.deepEqual(timerState(item, { restEnd: 100000 }, 28000), { mode: "rest", text: "1:12", label: "rest", tone: "rest" });
  assert.equal(timerState(item, { restEnd: 100000 }, 100500).text, "Go");
  const hang = findItem(plan, "2026-10-23", 0, 1).item;
  assert.equal(timerState(hang, startHold(null, 0), 3000).mode, "idle", "a hold doesn't take over the rest tile");
});

test("timed holds: 5 s to get ready, then the middle tile counts the hold down to 0", () => {
  const hang = findItem(plan, "2026-10-23", 0, 1).item;          // 20 s
  const dr = startHold({ sets: [{ reps: 21, manual: true }] }, 1000);
  assert.equal(dr.holdStart, 1000 + HOLD_LEAD_MS); assert.equal(dr.sets.length, 1);
  assert.equal(holdState(hang, null), null);
  assert.deepEqual(holdState(hang, dr, 1000), { mode: "ready", text: "5", label: "get ready", tone: "ready" });
  assert.equal(holdState(hang, dr, 5500).text, "1");
  assert.deepEqual(holdState(hang, dr, 6000), { mode: "hold", text: "20", label: "sec left", tone: "live", held: 0 });
  assert.equal(holdState(hang, dr, 6000 + 12400).text, "8");
  assert.deepEqual(holdState(hang, dr, 6000 + 20000), { mode: "over", text: "0", label: "time! tap done", tone: "go", held: 20 });
  assert.deepEqual(holdState(hang, dr, 6000 + 23200), { mode: "over", text: "0", label: "time! tap done", tone: "go", held: 20 }, "stays at 0");
  assert.equal(heldSecs(dr, 6000 + 23200, hang.secs), 20, "logged time is capped at the goal");
  assert.equal(heldSecs(dr, 4000), 0, "Done during the lead-in holds nothing");
  assert.equal(heldSecs(dr, 6000 + 17000), 17);
  const r = tickSet(hang, dr, { held: heldSecs(dr, 6000 + 17000) });
  assert.equal(r.complete, true); assert.deepEqual(r.sets.map((x) => x.reps), [21, 17]);
});

test("the mirror sends one save at a time and finishes on the latest state", async () => {
  const sent = []; let release;
  const mirror = (data) => { sent.push(data.entries.length); return new Promise((r) => { release = r; }); };
  const s = createLocalStore({ storage: memStorage(), fetchJson: fetchData, mirror });
  await new Promise((r) => setTimeout(r, 0));                         // seeding sends the first save
  const adds = [s.addEntry({ ex: "pushup", sets: 1, reps: 1 }), s.addEntry({ ex: "pushup", sets: 1, reps: 2 }), s.addEntry({ ex: "pushup", sets: 1, reps: 3 })];
  await Promise.all(adds);
  assert.deepEqual(sent, [73], "nothing else is sent while the first save is in flight");
  release(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [73, 76], "then one save with everything");
  release(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [73, 76]);
});

test("a logged result turns back into sets, so the last one can be undone", () => {
  assert.deepEqual(setsFromEntry({ sets: 2, reps: 4, perSet: [7, 4] }).map((x) => x.reps), [7, 4]);
  assert.deepEqual(setsFromEntry({ sets: 3, reps: 6 }).map((x) => x.reps), [6, 6, 6]);
  const back = undoSet({ sets: setsFromEntry({ sets: 2, reps: 6 }) });
  const { item } = findItem(plan, "2026-10-23", 0, 2);
  assert.deepEqual(setProgress(item, back), { done: 1, total: 2, logged: false });
  assert.equal(undoSet({ sets: setsFromEntry({ sets: 1, reps: 6 }) }), null);
});

test("today starts with an explicit warm-up", () => {
  const items = dayItems(dayFor(plan, "2026-10-23"));
  assert.equal(items[0].ex, "arm_circles"); assert.equal(targetText(items[0]), "1 × 60 s"); assert.equal(items[0].rest, 0);
  assert.equal(items[1].ex, "hang"); assert.equal(items[1].note, "warm-up for the bar");
  assert.equal(EXERCISES.arm_circles.name, "Arm circles");
});

test("results stay with their exercise when an item is added above them", () => {
  const before = { blocks: [{ items: [{ ex: "hang", sets: 2, secs: 20 }, { ex: "scap_pull", sets: 2, reps: 6 }] }] };
  const after = { blocks: [{ items: [{ ex: "arm_circles", sets: 1, secs: 60 }, ...before.blocks[0].items] }] };
  const scapBefore = dayItems(before)[1], scapAfter = dayItems(after)[2];
  const logged = [{ ex: "scap_pull", sets: 2, reps: 6, day: "D", block: 0, item: scapBefore.idx }];
  assert.equal(entriesFor(logged, "D", scapAfter).length, 1);
  assert.equal(itemKey("D", scapBefore), itemKey("D", scapAfter), "in-progress sets keep the same key");
  assert.equal(itemKey("D", scapAfter), "D.scap_pull");
});

test("an exercise twice in one day is told apart by position", () => {
  const day = { blocks: [{ items: [{ ex: "bw_squat", sets: 1, reps: 10 }, { ex: "goblet", sets: 3, reps: 12 }, { ex: "bw_squat", sets: 3, reps: 15 }] }] };
  const [warm, , main] = dayItems(day);
  assert.ok(warm.dup && main.dup);
  assert.notEqual(itemKey("D", warm), itemKey("D", main));
  const logged = [{ ex: "bw_squat", sets: 3, reps: 15, day: "D", block: 0, item: 2 }];
  assert.equal(entriesFor(logged, "D", warm).length, 0);
  assert.equal(entriesFor(logged, "D", main).length, 1);
});

test("beeps: 3-2-1 in the get-ready and at the end of the hold, a long one at go and at time's up", () => {
  const hang = findItem(plan, "2026-10-23", 0, 1).item;          // 20 s
  const dr = startHold(null, 0), at = (ms) => beepFor(holdState(hang, dr, ms));
  const timeline = [];
  for (let ms = 0; ms <= 5000 + 21000; ms += 250) { const b = at(ms); if (b && !timeline.some((x) => x.key === b.key)) timeline.push(b); }
  assert.deepEqual(timeline.map((b) => b.key + (b.long ? "!" : "")), ["ready:3", "ready:2", "ready:1", "go!", "hold:3", "hold:2", "hold:1", "end!"]);
  assert.equal(at(500), null, "5 and 4 are silent");
  assert.equal(beepFor(null), null);
});

test("rest beeps: 3-2-1 then a long one at 0, once each; an old finished rest stays quiet", async () => {
  const { restBeep } = await import("../js/beep.js");
  const end = 100000, keys = [];
  for (let t = end - 6000; t <= end + 3000; t += 250) { const b = restBeep(end, t); if (b && !keys.includes(b.key + (b.long ? "!" : ""))) keys.push(b.key + (b.long ? "!" : "")); }
  assert.deepEqual(keys, ["rest:100000:3", "rest:100000:2", "rest:100000:1", "rest:100000:go!"]);
  assert.equal(restBeep(end, end + 60000), null);
  assert.equal(restBeep(null), null);
});

test("rest is per session: every set starts the plan's rest, none if the plan has none", async () => {
  const { restKey, restAfter } = await import("../js/plan.js");
  assert.equal(restKey("2026-10-23"), "2026-10-23.rest");
  const pull = findItem(plan, "2026-10-23", 0, 4).item, circles = findItem(plan, "2026-10-23", 0, 0).item;
  assert.deepEqual(restAfter(pull, 1000), { restEnd: 91000 });
  assert.equal(restAfter(circles, 1000), null, "arm circles: straight into the dead hang");
});

test("after the last set: the next unlogged exercise, wrapping round, none when all are done", async () => {
  const { nextToDo } = await import("../js/plan.js");
  const items = dayItems(dayFor(plan, "2026-10-23"));
  const log = (...idx) => idx.map((i) => ({ ex: items[i].ex, day: "2026-10-23", sets: 1, reps: 1 }));
  assert.equal(nextToDo(items, log(0), "2026-10-23", 0).ex, "hang");
  assert.equal(nextToDo(items, log(0, 1, 2, 4), "2026-10-23", 2).ex, "pullup_neg", "skips nothing that's still to do");
  assert.equal(nextToDo(items, log(4), "2026-10-23", 4).ex, "pushup");
  assert.equal(nextToDo(items, log(...[1, 2, 3, 4, 5, 6, 7, 8]), "2026-10-23", 8).ex, "arm_circles", "wraps to the first one left");
  assert.equal(nextToDo(items, log(...items.map((_, i) => i)), "2026-10-23", 8), null);
});

test("camera sets end by themselves: target reached + a moment, or out of position after a rep", async () => {
  const { shouldEndSet, AUTO_END } = await import("../js/plan.js");
  const base = { running: true, count: 8, target: 8, lastRepT: 10000, invalidSince: null };
  assert.equal(shouldEndSet({ ...base, now: 10000 + AUTO_END.afterTargetMs - 1 }), false, "a rep in progress gets to finish");
  assert.equal(shouldEndSet({ ...base, now: 10000 + AUTO_END.afterTargetMs }), true);
  assert.equal(shouldEndSet({ ...base, count: 5, now: 60000 }), false, "short of the target and still in position: keep counting");
  assert.equal(shouldEndSet({ ...base, count: 5, invalidSince: 20000, now: 20000 + AUTO_END.outOfPositionMs }), true, "got up early");
  assert.equal(shouldEndSet({ ...base, count: 5, invalidSince: 20000, now: 21000 }), false, "a moment out of view isn't the end");
  assert.equal(shouldEndSet({ ...base, count: 0, invalidSince: 0, now: 99999 }), false, "no reps yet: never");
  assert.equal(shouldEndSet({ ...base, running: false, now: 99999 }), false);
});

test("the week after Oct 23: bar / dumbbell / easy rhythm, warm-ups first, progressions", () => {
  const week = plan.days.filter((d) => d.date >= "2026-10-24" && d.date <= "2026-10-30");
  assert.deepEqual(week.map((d) => d.kind), ["DBs", "Easy", "Full", "DBs", "Easy", "Full", "DBs"]);
  for (const d of week) {
    const items = dayItems(d);
    for (const it of items) assert.ok(EXERCISES[it.ex], `${d.date}: ${it.ex}`);
    if (d.kind !== "Easy") assert.equal(items[0].ex, "arm_circles", `${d.date} opens with the warm-up`);
    for (const it of items) assert.ok(!/after 1 min of/.test(it.note || ""), "no warm-up hidden in a note");
  }
  const bar = dayItems(dayFor(plan, "2026-10-26")), by = (ex) => bar.find((it) => it.ex === ex);
  assert.deepEqual([by("hang").secs, by("scap_pull").reps, by("pullup_neg").sets, by("pullup_b").reps, by("pushup").reps, by("hollow").secs], [25, 8, 5, 6, 8, 25]);
  const db = dayItems(dayFor(plan, "2026-10-24"));
  assert.ok(db.filter((it) => ["goblet", "db_row", "db_ohp", "db_rdl"].includes(it.ex)).every((it) => it.reps === 10 && /heavier/.test(it.note)));
});

test("corrections from data/corrections.json are applied once, then mirrored", async () => {
  const storage = memStorage(), sent = [];
  const corr = { corrections: [{ id: "x1", set: { w: 15 } }, { id: "not-here", set: { w: 99 } }] };
  const fetchJson = async (u) => (u.endsWith("corrections.json") ? corr : u.endsWith("history.json") ? { entries: [{ id: "x1", ex: "goblet", w: 10, sets: 3, reps: 10, ts: 1, day: "2026-10-24" }], done: [] } : fetchData(u));
  const s = createLocalStore({ storage, fetchJson, mirror: async (d) => { sent.push(d.entries.map((e) => e.w).join()); } });
  const e = (await s.entries())[0];
  assert.equal(e.w, 15); assert.equal(e.corrected, true);
  // a later edit isn't overwritten by the same correction on the next page load
  const all = JSON.parse(storage.getItem("bb.entries")); all[0].w = 17.5; storage.setItem("bb.entries", JSON.stringify(all));
  const s2 = createLocalStore({ storage, fetchJson, mirror: async () => {} });
  assert.equal((await s2.entries())[0].w, 17.5);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sent.at(-1), "15", "the corrected log is mirrored");
});

test("dumbbell weight: last logged by default, − / + in 2.5 lb steps, kept across sets", async () => {
  const { weightFor, adjustWeight } = await import("../js/plan.js");
  const goblet = dayItems(dayFor(plan, "2026-10-27")).find((it) => it.ex === "goblet");
  const log = [{ ex: "goblet", w: 15, sets: 3, reps: 10, ts: 5, day: "2026-10-24" }];
  assert.equal(weightFor(goblet, null, log, "2026-10-27"), 15);
  let dr = adjustWeight(goblet, null, log, "2026-10-27", 2.5);
  assert.equal(weightFor(goblet, dr, log, "2026-10-27"), 17.5);
  const r = tickSet(goblet, dr);
  assert.equal(r.draft.w, 17.5, "the next set keeps it");
  assert.equal(undoSet(r.draft).w, 17.5);
  assert.equal(weightFor(goblet, adjustWeight(goblet, { w: 0 }, log, "x", -2.5), log, "x"), 0, "never below 0");
  const hang = dayItems(dayFor(plan, "2026-10-26")).find((it) => it.ex === "hang");
  assert.equal(weightFor(hang, { w: 20 }, log, "x"), 0, "bodyweight exercises have no weight");
  assert.match(goblet.note, /15 lb/);
});

test("camera box shape: follows the camera; floor exercises on an upright phone get the sideways hint", async () => {
  const { camShape, MOVES } = await import("../js/moves.js");
  assert.deepEqual(camShape(1280, 720, MOVES.pushup), { aspect: "1280 / 720", ratio: 1280 / 720, portrait: false, hint: null });
  const up = camShape(720, 1280, MOVES.pushup);
  assert.equal(up.portrait, true); assert.match(up.hint, /sideways/);
  assert.match(camShape(720, 1280, MOVES.bridge).hint, /sideways/);
  assert.equal(camShape(720, 1280, MOVES.squat).hint, null, "standing exercises are fine upright");
  assert.equal(camShape(720, 1280, MOVES.rdl).hint, null);
  assert.equal(camShape(0, 0, MOVES.pushup).aspect, "16 / 9", "before the camera reports its size");
});

test("skip a training day: it and everything after move back a day; undo restores; rest days stay put", async () => {
  const { skipPlan, undoSkipPlan, canSkip, canUndoSkip } = await import("../js/plan.js");
  const now = new Date(2026, 9, 26, 9).getTime();                  // Mon Oct 26, morning
  const r = skipPlan(plan, "2026-10-26", now);
  const kinds = (p) => p.days.filter((d) => d.date >= "2026-10-26").map((d) => `${d.date.slice(8)}:${d.kind}`).join(" ");
  assert.equal(kinds(r.plan), "26:Skipped 27:Full 28:DBs 29:Easy 30:Full 31:DBs");
  assert.deepEqual(r.record, { date: "2026-10-26", kind: "Full", title: "Pull, push and legs", shifted: true, ts: now });
  assert.equal(r.plan.undo.on, "2026-10-26");
  const day = dayFor(r.plan, "2026-10-26");
  assert.ok(canUndoSkip(r.plan, day, "2026-10-26")); assert.ok(!canUndoSkip(r.plan, day, "2026-10-27"), "undo only on the same day");
  assert.equal(kinds(undoSkipPlan(r.plan)), kinds(plan));
  const easy = skipPlan(plan, "2026-10-28", now);
  assert.equal(kinds(easy.plan), "26:Full 27:DBs 28:Easy 29:Full 30:DBs");
  assert.ok(dayFor(easy.plan, "2026-10-28").skipped); assert.equal(easy.record.shifted, false);
  assert.ok(canSkip(plan, dayFor(plan, "2026-10-26"), [], "2026-10-25"));
  assert.ok(!canSkip(plan, dayFor(plan, "2026-10-24"), [], "2026-10-25"), "not a past day");
  assert.ok(!canSkip(plan, dayFor(plan, "2026-10-26"), [{ date: "2026-10-26" }], "2026-10-25"), "not a finished day");
});

test("the plan list shows what was logged in the target's place", async () => {
  const { resultText } = await import("../js/plan.js");
  assert.equal(resultText({ ex: "bw_squat", sets: 3, reps: 15 }), "3 × 15");
  assert.equal(resultText({ ex: "scap_pull", sets: 2, reps: 4, perSet: [7, 4] }), "7, 4");
  assert.equal(resultText({ ex: "hang", sets: 2, reps: 25, perSet: [26, 25] }), "26, 25 s");
  assert.equal(resultText({ ex: "hollow", sets: 3, reps: 20 }), "3 × 20 s");
  assert.equal(resultText({ ex: "db_row", sets: 3, reps: 10, w: 15 }, { each: true }), "3 × 10 each side", "no weight in the list");
});
