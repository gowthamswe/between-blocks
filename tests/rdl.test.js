import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRdlAnalyzer, measure } from "../js/rdl.js";
import { createCoach, summarize } from "../js/coach.js";
import { MOVES, moveFor } from "../js/moves.js";
import { canCoach } from "../js/exercises.js";
import { frame, rep, play, SIZE } from "./synth-rdl.js";

const cues = JSON.parse(readFileSync(new URL("../cues.json", import.meta.url)));
const seq = (...reps) => reps.flat();

test("measure reads hinge, knee bend and where the weights are", () => {
  const stand = measure(frame({}), SIZE);
  assert.ok(stand.valid && stand.hinge < 8 && stand.knee > 170, JSON.stringify([stand.hinge, stand.knee]));
  const bottom = measure(frame({ hinge: 75, thighV: 25, shinV: 6, drift: 0.2 }), SIZE);
  assert.ok(Math.abs(bottom.hinge - 75) < 1, `${bottom.hinge}`);
  assert.ok(Math.abs(bottom.knee - 149) < 1.5, `${bottom.knee}`);
  assert.ok(Math.abs(bottom.drift - 0.2) < 0.02, `${bottom.drift}`);
  assert.equal(measure(frame({ wristVis: 0.1 }), SIZE).drift, null);
});

test("lying down or out of view isn't a deadlift", () => {
  assert.equal(measure(frame({ vis: 0.2 }), SIZE).reason, "not-visible");
  const flat = frame({}); [[11, 0.2], [23, 0.4], [25, 0.6], [27, 0.8]].forEach(([i, x]) => { flat[i].x = x; flat[i].y = 0.85; });
  assert.equal(measure(flat, SIZE).reason, "not-standing");
});

test("clean RDLs count with full marks", () => {
  const { events } = play(createRdlAnalyzer(), seq(rep(), rep(), rep()));
  assert.deepEqual(events.map((e) => e.type), ["rep", "rep", "rep"]);
  events.forEach((e) => { assert.deepEqual(e.faults, []); assert.equal(e.score, 100); assert.ok(e.lowerMs >= 1800, `${e.lowerMs}`); });
});

test("each fault is caught", () => {
  const one = (o) => play(createRdlAnalyzer(), rep(o)).events[0];
  assert.deepEqual(one({ thighV: 50, shinV: 20 }).faults, ["squat"]);       // knees ~110°
  assert.deepEqual(one({ drift: 0.9 }).faults, ["drift"]);
  assert.deepEqual(one({ bottom: 40 }).faults, ["shallow"]);
  assert.deepEqual(one({ downS: 0.6 }).faults, ["fast"]);
  assert.equal(one({ thighV: 50, shinV: 20, drift: 0.9 }).score, 65);
});

test("a nod forward doesn't count", () => {
  const { events } = play(createRdlAnalyzer(), seq(rep({ bottom: 28 + 4 }), rep()));
  assert.equal(events[0].type, "half");
  assert.equal(events[1].type, "rep"); assert.equal(events[1].n, 1);
});

test("weights aren't judged when the wrists are hidden", () => {
  const r = rep({ drift: 1.2 }).map((f) => ({ ...f, wristVis: 0.1 }));
  assert.deepEqual(play(createRdlAnalyzer(), r).events[0].faults, []);
});

test("losing the pose mid-rep drops that rep", () => {
  const r = rep(), mid = Math.floor(r.length * 0.4);
  const broken = [...r.slice(0, mid), ...Array(30).fill({ hinge: 50, vis: 0.1 }), ...r.slice(mid)];
  assert.equal(play(createRdlAnalyzer(), seq(broken, rep())).events.filter((e) => e.type === "rep").length, 1);
});

test("RDL coach uses its own lines", () => {
  const { coaching } = MOVES.rdl;
  for (const f of coaching.priority) assert.ok(cues.cues[coaching.cueFor(f)], f);
  const coach = createCoach({ cues, countAloud: false, rng: () => 0, coaching });
  assert.deepEqual(coach.onRep({ n: 1, faults: ["squat"], minKnee: 128 }), []);
  assert.equal(coach.onRep({ n: 2, faults: ["squat", "drift"], minKnee: 128 })[0].text, "Push your hips back, not down");
  const fresh = createCoach({ cues, countAloud: false, rng: () => 0, coaching });
  assert.match(fresh.onRep({ n: 1, faults: ["squat"], minKnee: 110 })[0].id, /^rd_squat_/);   // deep squat: right away
  const out = [...coach.onStart(), ...coach.onHalf(), ...coach.onLostPose(10000, 4000)];
  assert.deepEqual(out.map((u) => u.id.replace(/_\d+$/, "")), ["rd_ready", "rd_half", "rd_position"]);
});

test("RDL summary reads like a log line", () => {
  const s = summarize([
    { n: 1, faults: [], score: 100, lowerMs: 2000, depth: 76 },
    { n: 2, faults: ["drift"], score: 85, lowerMs: 1800, depth: 70 },
  ], { target: 12, date: new Date(2026, 9, 23, 12), move: MOVES.rdl.summary });
  assert.equal(s, "2026-10-23 · Romanian deadlifts: 2 reps (target 12), form score 93/100. weights drifted forward on 1. Avg lowering 1.9s, avg hinge 73° from upright.");
});

test("plan RDLs open the coach with the dumbbell weight", () => {
  assert.ok(canCoach("db_rdl"));
  assert.equal(moveFor("db_rdl").key, "rdl");
  assert.ok(moveFor("db_rdl").weighted);
});
