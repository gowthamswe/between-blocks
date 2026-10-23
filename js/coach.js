// Decides what the coach says, and when. Pure logic: returns lists of utterances,
// the voice layer plays them. Each utterance: { id, text, kind } where id is a clip id
// like "sag_1" or "n_7" and kind is "count" | "cue" | "praise" | "info".
//
// Rules (the difference between a trainer and a nag):
//  - speak at the top of a rep, never mid-rep
//  - at most one correction per rep, most important fault first
//  - correct only when a fault shows up in 2 of the last 3 reps (a big sag: right away)
//  - the same correction waits at least 3 reps before it's repeated
//  - after a correction, praise the first rep that fixes it, once
//  - rotate phrasings so it doesn't sound like a loop

import { dayKey } from "./plan.js";

export const PRIORITY = ["sag", "shallow", "pike", "fast"];

// Per exercise: which faults to correct, most important first; the cue id for each fault and for the
// start / half-rep / out-of-position lines; and which fault is bad enough to call out on the first rep.
// Defaults are push-ups.
export const PUSHUP_COACHING = {
  priority: PRIORITY,
  ids: { ready: "ready", half: "half", position: "position" },
  cueFor: (f) => f,
  urgent: (f, rep) => f === "sag" && rep.maxSag > 0.1,
};

export function createCoach({ cues, target = 0, countAloud = true, rng = Math.random, coaching = PUSHUP_COACHING } = {}) {
  const { priority, ids, cueFor, urgent: isUrgent } = { ...PUSHUP_COACHING, ...coaching };
  const lib = cues.cues;
  const numWords = cues.numbers.words;
  const lastIdx = {};
  let history = [];           // fault arrays of recent reps
  let lastCued = {};          // fault -> rep number it was last cued at
  let pendingFix = null;      // { fault, rep }
  let lastHalfCue = -Infinity;
  let halfCount = 0;
  let lastPositionCueT = -Infinity;
  let reps = 0;

  function pick(id) {
    const variants = lib[id];
    if (!variants) return null;
    let i = 0;
    if (variants.length > 1) {
      // any phrasing except the one used last time
      const prev = lastIdx[id];
      if (prev == null) i = Math.min(variants.length - 1, Math.floor(rng() * variants.length));
      else { i = Math.min(variants.length - 2, Math.floor(rng() * (variants.length - 1))); if (i >= prev) i += 1; }
    }
    lastIdx[id] = i;
    return { id: `${id}_${i}`, text: variants[i] };
  }
  const say = (id, kind) => { const p = pick(id); return p ? { ...p, kind } : null; };
  const num = (n) => (n >= 1 && n <= numWords.length ? { id: `n_${n}`, text: numWords[n - 1], kind: "count" } : null);

  function reset() {
    history = []; lastCued = {}; pendingFix = null; lastHalfCue = -Infinity; halfCount = 0;
    lastPositionCueT = -Infinity; reps = 0;
  }

  function onStart() { reset(); return [say(ids.ready, "info")].filter(Boolean); }

  function onRep(rep) {
    reps = rep.n;
    const faults = rep.faults || [];
    history = [...history, faults].slice(-3);
    const out = [];
    if (countAloud) out.push(num(rep.n));

    // praise a fix
    let praised = false;
    if (pendingFix) {
      if (!faults.includes(pendingFix.fault)) { out.push(say("praise", "praise")); praised = true; pendingFix = null; }
      else if (rep.n - pendingFix.rep >= 3) pendingFix = null; // give up waiting
    }

    // one correction, highest priority eligible fault
    if (!praised) {
      for (const f of priority) {
        if (!faults.includes(f)) continue;
        const seen = history.filter((h) => h.includes(f)).length;
        const urgent = !!isUrgent(f, rep);
        const persistent = seen >= 2 || urgent;
        const cooled = lastCued[f] == null || rep.n - lastCued[f] >= 3;
        if (persistent && cooled) {
          out.push(say(cueFor(f), "cue"));
          lastCued[f] = rep.n;
          pendingFix = { fault: f, rep: rep.n };
          break;
        }
      }
    }

    // target callouts (only if nothing else needed saying)
    if (target >= 4 && out.filter((u) => u && u.kind !== "count").length === 0) {
      if (rep.n === target - 2) out.push(say("two_more", "info"));
      else if (rep.n === target - 1) out.push(say("last_one", "info"));
    }
    if (target > 0 && rep.n === target) out.push(say("target_done", "info"));
    return out.filter(Boolean);
  }

  function onHalf() {
    halfCount += 1;
    if (halfCount - lastHalfCue >= 2 || lastHalfCue === -Infinity) {
      lastHalfCue = halfCount;
      return [say(ids.half, "cue")].filter(Boolean);
    }
    return [];
  }

  // call while the set is running and the pose isn't usable; t in ms
  function onLostPose(t, lostForMs) {
    if (lostForMs < 3000 || t - lastPositionCueT < 15000) return [];
    lastPositionCueT = t;
    return [say(ids.position, "info")].filter(Boolean);
  }

  // a timed squeeze at the top is done (glute bridge): tell them to come down
  function onHeld() { return ids.held ? [say(ids.held, "info")].filter(Boolean) : []; }

  function onEnd(total) {
    const out = [say("set_done", "info")];
    if (total > 0) { out.push(num(total)); out.push(say("reps_word", "info")); }
    return out.filter(Boolean);
  }

  return {
    onStart, onRep, onHalf, onHeld, onLostPose, onEnd, reset,
    set target(v) { target = v; }, get target() { return target; },
    set countAloud(v) { countAloud = v; },
  };
}

// Plain-text summary of a set, for pasting into Between Blocks or a chat with Claude.
// `move` names the exercise and its faults; defaults to push-ups.
const PUSHUP_SUMMARY = { name: "Push-ups", joint: "elbow",
  faults: { sag: "hips sagged", shallow: "not deep enough", pike: "hips too high", fast: "lowered too fast" } };
export function summarize(reps, { target = 0, date = new Date(), move = PUSHUP_SUMMARY } = {}) {
  const n = reps.length;
  if (!n) return `${move.name}: no counted reps.`;
  const avg = Math.round(reps.reduce((s, r) => s + r.score, 0) / n);
  const tally = {};
  reps.forEach((r) => r.faults.forEach((f) => { tally[f] = (tally[f] || 0) + 1; }));
  const faultTxt = Object.keys(tally).length
    ? Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([f, c]) => `${move.faults[f] || f} on ${c}`).join(", ")
    : "no form faults";
  const avgLower = (reps.reduce((s, r) => s + r.lowerMs, 0) / n / 1000).toFixed(1);
  const avgDepth = Math.round(reps.reduce((s, r) => s + (r.depth ?? r.minElbow), 0) / n);
  const tail = move.tail ? move.tail(reps, avgDepth) : `avg depth ${avgDepth}° at the ${move.joint}`;
  return `${dayKey(date)} · ${move.name}: ${n} reps${target ? ` (target ${target})` : ""}, form score ${avg}/100. ` +
    `${faultTxt}. Avg lowering ${avgLower}s, ${tail}.`;
}
