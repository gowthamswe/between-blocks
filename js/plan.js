// The workout plan and progress, as plain data. No browser code, so it's testable.
//
// Plan (data/plan.json, written by Claude): { from, updated, days: [day] }
//   day:  { date: "YYYY-MM-DD", title, kind: "Full" | "DBs" | "Easy" | "Skipped", note, skipped?, wasTitle?,
//           blocks: [{ name, items: [item] }] }
//   item: { ex, sets, reps | secs, rest, note?, each? }
// Entry (one logged exercise, same shape as Between Blocks so it can move back):
//   { id, ex, sets, reps, w, ts, day, block, item?, src?: "coach", perSet?, form?, faults?, lowerS?, depth? }
//   For timed exercises `reps` holds seconds, as in Between Blocks.
import { exName, isTimed, isBodyweight } from "./exercises.js";

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const planDays = (plan) => (plan && plan.days) || [];
export const dayFor = (plan, date) => planDays(plan).find((d) => d.date === date) || null;
// A day's items, with their position. `dup` marks an exercise that appears more than once that day;
// only then does the position decide which one a logged result belongs to.
export const dayItems = (day) => {
  const items = day && day.blocks ? day.blocks.flatMap((b, bi) => b.items.map((it, i) => ({ ...it, block: bi, idx: i }))) : [];
  const n = {}; items.forEach((it) => { n[it.ex] = (n[it.ex] || 0) + 1; });
  return items.map((it) => (n[it.ex] > 1 ? { ...it, dup: true } : it));
};

// Where an item's in-progress sets are kept. Keyed by exercise, so adding an item (a warm-up at the top)
// doesn't move them onto the wrong exercise.
export const itemKey = (date, it) => (it.dup ? `${date}.${it.ex}.${it.block}.${it.idx}` : `${date}.${it.ex}`);

// The item a link points at: "day=2026-10-23&block=0&item=4"
export function findItem(plan, date, block, idx) {
  const d = dayFor(plan, date);
  const it = dayItems(d).find((x) => x.block === block && x.idx === idx);
  return it ? { day: d, item: it } : null;
}

// Which day to open: today if it's in the plan, else the next planned day, else the last one.
export function pickDay(plan, today = dayKey()) {
  const days = planDays(plan);
  if (!days.length) return null;
  if (days.some((d) => d.date === today)) return today;
  const next = days.find((d) => d.date > today);
  return (next || days[days.length - 1]).date;
}

export const amount = (item) => (isTimed(item.ex) ? item.secs : item.reps);

export function targetText(item) {
  const per = isTimed(item.ex) ? `${item.secs} s` : `${item.reps}`;
  return `${item.sets} × ${per}${item.each ? " each side" : ""}`;
}

export function entryText(e) {
  const varied = e.perSet && new Set(e.perSet).size > 1;
  const per = (varied ? e.perSet.join(", ") : `${e.reps}`) + (isTimed(e.ex) ? " s" : "");
  const sets = e.perSet && new Set(e.perSet).size > 1 ? `${e.perSet.length} sets: ` : `${e.sets} × `;
  return `${sets}${per}${e.w ? ` · ${e.w} lb` : ""}`;
}

// What was logged, in the plan list's "3 × 15" form (no weight): "3 × 15", "7, 4" when sets differed, "26, 25 s".
export function resultText(e, item) {
  const varied = e.perSet && new Set(e.perSet).size > 1;
  const unit = isTimed(e.ex) ? " s" : "";
  if (varied) return e.perSet.join(", ") + unit;
  return `${e.sets} × ${e.reps}${unit}${item && item.each ? " each side" : ""}`;
}

// Entries for a planned item. Older entries (from Between Blocks) don't record the item index,
// so they match on day + exercise.
// Results logged for a planned item: same day and exercise. Position only matters when the
// exercise appears twice that day (and older Between Blocks entries don't record it at all).
export function entriesFor(entries, date, item) {
  return entries.filter((e) => e.day === date && e.ex === item.ex && (!item.dup || e.item == null || (e.item === item.idx && (e.block ?? 0) === item.block)));
}

export function lastEntry(entries, ex, beforeDay) {
  let best = null;
  for (const e of entries) if (e.ex === ex && (!beforeDay || (e.day || dayKey(e.ts)) < beforeDay) && (!best || e.ts > best.ts)) best = e;
  return best;
}

// Starting values for the log form: the plan's target, and the last weight used for that exercise.
// Dumbbell weight for an exercise: what you set with − / + for this session, else the last weight logged.
export const weightFor = (item, draft, entries, date) => (isBodyweight(item.ex) ? 0 : draft && draft.w != null ? draft.w : logDefaults(item, entries, date).w);
export const adjustWeight = (item, draft, entries, date, delta) =>
  ({ ...(draft || {}), sets: (draft && draft.sets) || [], w: Math.max(0, Math.round((weightFor(item, draft, entries, date) + delta) * 2) / 2) });

export function logDefaults(item, entries, date) {
  const last = lastEntry(entries, item.ex, date);
  return { sets: item.sets, reps: amount(item), w: isBodyweight(item.ex) ? 0 : (last && last.w) || 0 };
}

export function dayStatus(day, entries, done) {
  if (!day) return "none";
  if (day.skipped) return "skipped";
  if (done.some((d) => d.date === day.date)) return "done";
  const items = dayItems(day);
  const logged = items.filter((it) => entriesFor(entries, day.date, it).length).length;
  if (items.length && logged === items.length) return "done";
  return logged ? "started" : "todo";
}

// One entry from the sets the camera coach counted.
// `reps` is the lowest set, so "3 × 8" means every set reached 8; perSet keeps the detail.
export function coachEntry(sets, { day, item, ts = Date.now(), w = 0 }) {
  const perSet = sets.map((s) => s.reps);
  const cam = sets.filter((s) => !s.manual);              // sets ticked by hand have no form data
  const all = cam.flatMap((s) => (s.repScores || []));
  const faults = {};
  cam.forEach((s) => Object.entries(s.faults || {}).forEach(([f, c]) => { faults[f] = (faults[f] || 0) + c; }));
  const total = cam.reduce((a, s) => a + s.reps, 0);
  const wavg = (k) => (total ? cam.reduce((a, s) => a + (s[k] || 0) * s.reps, 0) / total : 0);
  return {
    ex: item.ex, sets: sets.length, reps: Math.min(...perSet), w, ts, day: day, block: item.block, item: item.idx,
    src: "coach", perSet,
    form: all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : Math.round(wavg("form")),
    faults, lowerS: Math.round(wavg("lowerS") * 10) / 10, depth: Math.round(wavg("depth")),
  };
}

// One coach set, from the reps the analyzer produced.
export function coachSet(reps, ts = Date.now()) {
  const n = reps.length;
  const faults = {};
  reps.forEach((r) => r.faults.forEach((f) => { faults[f] = (faults[f] || 0) + 1; }));
  const avg = (f) => (n ? reps.reduce((a, r) => a + f(r), 0) / n : 0);
  return {
    reps: n, ts, faults, repScores: reps.map((r) => r.score),
    form: Math.round(avg((r) => r.score)), lowerS: Math.round(avg((r) => r.lowerMs) / 100) / 10, depth: Math.round(avg((r) => r.depth ?? r.minElbow)),
  };
}

// Where each exercise stands: latest result plus the trail of earlier ones.
export function progress(entries) {
  const by = {};
  [...entries].sort((a, b) => a.ts - b.ts).forEach((e) => { (by[e.ex] = by[e.ex] || []).push(e); });
  return Object.entries(by).map(([ex, list]) => {
    const last = list[list.length - 1];
    const prev = list.length > 1 ? list[list.length - 2] : null;
    const score = (e) => (e.perSet ? e.perSet.reduce((a, b) => a + b, 0) : e.reps * e.sets) + (e.w || 0) * 100;
    const trend = !prev ? "new" : score(last) > score(prev) ? "up" : score(last) < score(prev) ? "down" : "same";
    return { ex, name: exName(ex), last, trend, trail: list.slice(-8).map((e) => (isTimed(ex) ? `${e.reps}s` : `${e.reps}`) + (e.w ? `@${e.w}` : "")) };
  }).sort((a, b) => b.last.ts - a.last.ts);
}

// A plain-text log Claude can read to plan the next days.
export function logText(entries, done, { since } = {}) {
  const byDay = {};
  entries.filter((e) => !since || (e.day || dayKey(e.ts)) >= since).forEach((e) => { (byDay[e.day || dayKey(e.ts)] = byDay[e.day || dayKey(e.ts)] || []).push(e); });
  return Object.keys(byDay).sort().map((d) => {
    const lines = byDay[d].sort((a, b) => (a.block ?? 0) - (b.block ?? 0) || (a.item ?? 0) - (b.item ?? 0) || a.ts - b.ts).map((e) => {
      let s = `- ${exName(e.ex)}: ${entryText(e)}`;
      if (e.src === "coach") {
        const f = Object.entries(e.faults || {}).map(([k, c]) => `${k} ${c}`).join(", ");
        s += ` (camera coach: form ${e.form}/100${f ? `, faults ${f}` : ""}, lowering ${e.lowerS}s, depth ${e.depth}°)`;
      }
      return s;
    });
    const dn = done.find((x) => x.date === d);
    return `${d}${dn ? " · session done" + (dn.mins ? `, ${dn.mins} min` : "") : ""}\n${lines.join("\n")}`;
  }).join("\n\n");
}

// ---------- per-set tracking on the plan screen ----------
// Sets done so far live in the item's draft, the same one the camera coach uses:
//   { sets: [set], next: reps for the set you're on (the arrows), restEnd: ms, holdStart: ms }
// A set is a coachSet from the camera, or { reps, ts, manual: true } ticked by hand (reps = seconds for holds).

// Drafts saved before sets were a list kept a count instead.
function setsOf(draft) {
  if (!draft) return [];
  if (draft.sets) return draft.sets;
  return Array.from({ length: draft.manual || 0 }, (_, i) => ({ reps: (draft.held && draft.held[i]) ?? null, manual: true }));
}

export function setProgress(item, draft, logged = []) {
  if (logged.length) { const e = logged[logged.length - 1]; return { done: e.sets, total: Math.max(item.sets, e.sets), logged: true }; }
  const done = setsOf(draft).length;
  return { done, total: Math.max(item.sets, done), logged: false };
}

// Reps for the set you're on: the plan's, unless changed with the arrows.
export const nextReps = (item, draft) => (draft && draft.next != null ? draft.next : amount(item));
export function adjustReps(item, draft, delta) {
  const next = Math.max(0, Math.min(99, nextReps(item, draft) + delta));
  return { ...(draft || {}), sets: setsOf(draft), next: next === amount(item) ? undefined : next };
}

// Tick off one set by hand. After the last set the exercise is complete (log it); otherwise the rest starts
// and the next set goes back to the plan's reps.
export function tickSet(item, draft, { now = Date.now(), held = null } = {}) {
  const reps = held != null ? Math.round(held) : nextReps(item, draft);
  return addSet(item, draft, { reps, ts: now, manual: true }, now);
}

// Camera on: when a set ends by itself, so nobody has to get up to tap Done.
//   target reached and no new rep for 2.5 s → done (a rep still in progress gets to finish)
//   at least one rep, then out of position for 3 s → they got up; done with what was counted
export const AUTO_END = { afterTargetMs: 2500, outOfPositionMs: 3000 };
export function shouldEndSet({ running, count, target, lastRepT, invalidSince, now }) {
  if (!running || !count) return false;
  if (target && count >= target && now - lastRepT >= AUTO_END.afterTargetMs) return true;
  return invalidSince != null && now - invalidSince >= AUTO_END.outOfPositionMs;
}

// Add one finished set (ticked by hand, or a coachSet from the camera on the plan screen).
export function addSet(item, draft, set, now = Date.now()) {
  const sets = [...setsOf(draft).map((x) => (x.reps == null ? { ...x, reps: amount(item) } : x)), set];
  if (sets.length >= item.sets) return { complete: true, sets, draft: null };
  const keep = draft && draft.w != null ? { w: draft.w } : {};           // the weight you set stays for the next set
  return { complete: false, sets, draft: { sets, restEnd: item.rest ? now + item.rest * 1000 : null, holdStart: null, ...keep } };
}

// A logged result turned back into sets, so its last set can be undone. Camera details aren't kept.
export function setsFromEntry(e) {
  const reps = e.perSet && e.perSet.length === e.sets ? e.perSet : Array.from({ length: e.sets }, () => e.reps);
  return reps.map((r) => ({ reps: r, manual: true }));
}

export function undoSet(draft) {
  const sets = setsOf(draft).slice(0, -1);
  const keep = draft && draft.w != null ? { w: draft.w } : {};
  if (!sets.length) return Object.keys(keep).length ? { sets, ...keep } : null;
  return { sets, restEnd: null, holdStart: null, ...keep };
}

// The entry once every set is done. Any camera sets make it a coach entry (form from those sets);
// hand-ticked only: reps per set, lowest as the headline number.
export function entryFromSets(item, sets, { day, w = 0, ts = Date.now() }) {
  if (sets.some((x) => !x.manual)) return coachEntry(sets, { day, item, ts, w });
  const perSet = sets.map((x) => x.reps);
  return { ex: item.ex, sets: sets.length, reps: Math.min(...perSet), w, ts, day, block: item.block, item: item.idx,
    src: "sets", ...(new Set(perSet).size > 1 ? { perSet } : {}) };
}

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Timed holds: tap Start, get a few seconds to get ready, then the hold counts down from the goal.
export const HOLD_LEAD_MS = 5000;
export const startHold = (draft, now = Date.now()) => ({ ...(draft || {}), sets: (draft && draft.sets) || [], holdStart: now + HOLD_LEAD_MS, restEnd: null });
// What the middle tile shows during a hold. holdStart is when the hold itself starts (after the lead-in).
export function holdState(item, draft, now = Date.now()) {
  if (!draft || !draft.holdStart) return null;
  if (now < draft.holdStart) return { mode: "ready", text: String(Math.ceil((draft.holdStart - now) / 1000)), label: "get ready", tone: "ready" };
  const held = Math.min(item.secs, Math.floor((now - draft.holdStart) / 1000)), left = item.secs - held;
  return left > 0 ? { mode: "hold", text: String(left), label: "sec left", tone: "live", held }
    : { mode: "over", text: "0", label: "time! tap done", tone: "go", held };   // stays at 0, no over-time
}
// Seconds held when Done is tapped: 0 in the lead-in, never more than the goal.
export const heldSecs = (draft, now = Date.now(), goal = Infinity) => (draft && draft.holdStart ? Math.min(goal, Math.max(0, (now - draft.holdStart) / 1000)) : null);

// Which beep (if any) belongs to this moment of a hold: short beeps on the last 3 s of the get-ready
// and of the hold, a long one at "go" and at time's up. Returns a key so each beep plays once.
export function beepFor(state) {
  if (!state) return null;
  const n = Number(state.text);
  if ((state.mode === "ready" || state.mode === "hold") && n >= 1 && n <= 3) return { key: `${state.mode}:${n}`, long: false };
  if (state.mode === "hold" && state.held === 0) return { key: "go", long: true };
  if (state.mode === "over") return { key: "end", long: true };
  return null;
}

// Rest belongs to the session, not one exercise: every finished set (the last one too) starts the plan's
// rest, and it keeps counting when you move to the next exercise. Stored as a draft under this key.
export const restKey = (date) => `${date}.rest`;
export const restAfter = (item, now = Date.now()) => (item.rest ? { restEnd: now + item.rest * 1000 } : null);

// After an exercise's last set: the next one to do. The first unlogged item after it, else the first
// unlogged one anywhere, else null (session done).
export function nextToDo(items, entries, date, fromIdx) {
  const todo = (it) => !entriesFor(entries, date, it).length;
  return items.slice(fromIdx + 1).find(todo) || items.slice(0, fromIdx).find(todo) || null;
}

// What the timer tile shows: the rest countdown, or the rest length before you start.
export function timerState(item, draft, now = Date.now()) {
  if (draft && draft.restEnd) {
    const left = Math.ceil((draft.restEnd - now) / 1000);
    return left > 0 ? { mode: "rest", text: clock(left), label: "rest", tone: "rest" } : { mode: "go", text: "Go", label: "rest done", tone: "go" };
  }
  return { mode: "idle", text: item.rest ? clock(item.rest) : "—", label: item.rest ? "rest" : "no rest", tone: "idle" };
}

// ---------- skipping a day (ported from the Between Blocks page) ----------
// Training day: a "Skipped" placeholder takes its date, and it plus every later non-skipped day moves back
// one day (stepping over other skipped dates). Rest day: marked skipped in place, nothing moves.
// The plan before the skip is kept in plan.undo, usable on the same calendar day.
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return dayKey(new Date(y, m - 1, d + n).getTime()); };
const clone = (o) => JSON.parse(JSON.stringify(o));

export function canSkip(plan, day, done, today = dayKey()) {
  return !!(plan && day && !day.skipped && !done.some((x) => x.date === day.date) && day.date >= today);
}
export function canUndoSkip(plan, day, today = dayKey()) {
  const u = plan && plan.undo;
  return !!(u && day && u.date === day.date && u.on === today && u.days);
}

export function skipPlan(plan, date, now = Date.now()) {
  const days = clone(planDays(plan)), orig = days.find((x) => x.date === date);
  if (!orig) return null;
  const stamp = { skipped: true, skippedAt: now, wasKind: orig.kind || "", wasTitle: orig.title || "" };
  let out;
  if (orig.kind === "Easy") out = days.map((x) => (x.date === date ? Object.assign(x, stamp) : x));
  else {
    const fixed = { [date]: 1 };
    days.forEach((x) => { if (x.skipped) fixed[x.date] = 1; });
    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    out = []; let cursor = null;
    days.forEach((x) => {
      if (x.date < date || x.skipped) { out.push(x); return; }
      let c = addDays(x.date, 1);
      if (cursor && c <= cursor) c = addDays(cursor, 1);
      while (fixed[c]) c = addDays(c, 1);
      cursor = c; x.date = c; out.push(x);
    });
    out.push(Object.assign({ date, kind: "Skipped", title: "Skipped", note: "", blocks: [] }, stamp));
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  const next = clone(plan); delete next.undo;
  const before = clone(next.days || []);
  next.days = out;
  next.undo = { date, on: dayKey(now), days: before };
  return { plan: next, record: { date, kind: orig.kind || "", title: orig.title || "", shifted: orig.kind !== "Easy", ts: now } };
}

export function undoSkipPlan(plan) {
  const next = clone(plan);
  next.days = clone(plan.undo.days); delete next.undo;
  return next;
}

// ---------- home or cable machine ----------
// A training day can carry its other version: day.where is "home" or "cable" (missing = home), and
// day.alt holds the other one ({ where, kind, title, note, blocks }). Switching swaps the two, so the
// plan always says what you're actually doing and the log matches it. Locked once anything is logged.
const WHERE_FIELDS = ["where", "kind", "title", "note", "blocks"];
export const whereOf = (day) => (day && day.where) || "home";
export function canSwapWhere(day, entries, done) {
  return !!(day && day.alt && !day.skipped && !done.some((x) => x.date === day.date) && !entries.some((e) => e.day === day.date));
}
export function swapWhere(plan, date) {
  const next = clone(plan);
  const d = planDays(next).find((x) => x.date === date);
  if (!d || !d.alt) return null;
  const cur = {};
  WHERE_FIELDS.forEach((f) => { if (d[f] !== undefined) cur[f] = d[f]; });
  cur.where = whereOf(d);
  WHERE_FIELDS.forEach((f) => { if (d.alt[f] !== undefined) d[f] = d.alt[f]; else delete d[f]; });
  d.where = d.alt.where || "home";
  d.alt = cur;
  return next;
}
