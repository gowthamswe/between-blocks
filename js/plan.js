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
export const dayItems = (day) => (day && day.blocks ? day.blocks.flatMap((b, bi) => b.items.map((it, i) => ({ ...it, block: bi, idx: i }))) : []);

// The item a link points at: "day=2026-10-23&block=0&item=4"
export function findItem(plan, date, block, idx) {
  const d = dayFor(plan, date);
  const b = d && d.blocks && d.blocks[block];
  const it = b && b.items[idx];
  return it ? { day: d, item: { ...it, block, idx } } : null;
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
  const per = isTimed(e.ex) ? `${e.reps} s` : e.perSet && new Set(e.perSet).size > 1 ? e.perSet.join(", ") : `${e.reps}`;
  const sets = e.perSet && new Set(e.perSet).size > 1 ? `${e.perSet.length} sets: ` : `${e.sets} × `;
  return `${sets}${per}${e.w ? ` · ${e.w} lb` : ""}`;
}

// Entries for a planned item. Older entries (from Between Blocks) don't record the item index,
// so they match on day + exercise.
export function entriesFor(entries, date, item) {
  return entries.filter((e) => e.day === date && e.ex === item.ex && (e.item == null || (e.item === item.idx && (e.block ?? 0) === item.block)));
}

export function lastEntry(entries, ex, beforeDay) {
  let best = null;
  for (const e of entries) if (e.ex === ex && (!beforeDay || (e.day || dayKey(e.ts)) < beforeDay) && (!best || e.ts > best.ts)) best = e;
  return best;
}

// Starting values for the log form: the plan's target, and the last weight used for that exercise.
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
export function coachEntry(sets, { day, item, ts = Date.now() }) {
  const perSet = sets.map((s) => s.reps);
  const all = sets.flatMap((s) => (s.repScores || []));
  const faults = {};
  sets.forEach((s) => Object.entries(s.faults || {}).forEach(([f, c]) => { faults[f] = (faults[f] || 0) + c; }));
  const total = perSet.reduce((a, b) => a + b, 0);
  const wavg = (k) => (total ? sets.reduce((a, s) => a + (s[k] || 0) * s.reps, 0) / total : 0);
  return {
    ex: item.ex, sets: sets.length, reps: Math.min(...perSet), w: 0, ts, day: day, block: item.block, item: item.idx,
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
    form: Math.round(avg((r) => r.score)), lowerS: Math.round(avg((r) => r.lowerMs) / 100) / 10, depth: Math.round(avg((r) => r.minElbow)),
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
