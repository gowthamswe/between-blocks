import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSquatAnalyzer, measure, GOBLET } from "../js/squat.js";
import { createCoach, summarize } from "../js/coach.js";
import { MOVES, moveFor } from "../js/moves.js";
import { canCoach } from "../js/exercises.js";
import { frame, rep, play, SIZE } from "./synth-squat.js";

const cues = JSON.parse(readFileSync(new URL("../cues.json", import.meta.url)));
const seq = (...reps) => reps.flat();

test("measure reads knee angle, thigh level, torso lean", () => {
  const stand = measure(frame({ thighV: 4 }), SIZE);
  assert.ok(stand.valid); assert.ok(stand.knee > 170, `knee ${stand.knee}`);
  const deep = measure(frame({ thighV: 95, shinV: 33, lean: 35 }), SIZE);
  assert.ok(Math.abs(deep.knee - 52) < 2, `knee ${deep.knee}`);
  assert.ok(Math.abs(deep.thigh - -5) < 2, `thigh ${deep.thigh}`);
  assert.ok(Math.abs(deep.lean - 35) < 2, `lean ${deep.lean}`);
});

test("lying down or out of view isn't a squat", () => {
  assert.equal(measure(frame({ vis: 0.2 }), SIZE).reason, "not-visible");
  const flat = frame({}); [11, 23, 25, 27].forEach((i, k) => { flat[i].y = 0.8; flat[i].x = 0.2 + k * 0.15; });
  assert.equal(measure(flat, SIZE).reason, "not-standing");
});

test("clean squats count with full marks", () => {
  const { events } = play(createSquatAnalyzer(), seq(rep(), rep(), rep()));
  assert.deepEqual(events.map((e) => e.type), ["rep", "rep", "rep"]);
  events.forEach((e) => { assert.deepEqual(e.faults, []); assert.equal(e.score, 100); assert.ok(e.lowerMs >= 1800, `${e.lowerMs}`); });
  assert.equal(events[2].n, 3);
});

test("each fault is caught", () => {
  const one = (o) => play(createSquatAnalyzer(), seq(rep(o))).events[0];
  assert.deepEqual(one({ bottom: 65 }).faults, ["shallow"]);          // thighs 25° above level
  assert.deepEqual(one({ heel: 0.2 }).faults, ["heels"]);
  assert.deepEqual(one({ lean: 60 }).faults, ["lean"]);
  assert.deepEqual(one({ downS: 0.6 }).faults, ["fast"]);
  assert.equal(one({ bottom: 65, lean: 60 }).score, 65);
});

test("a quarter squat doesn't count", () => {
  const { events } = play(createSquatAnalyzer(), seq(rep({ bottom: 40 }), rep()));
  assert.equal(events[0].type, "half");
  assert.equal(events[1].type, "rep"); assert.equal(events[1].n, 1);
});

test("goblet squats expect a more upright chest", () => {
  const r = rep({ lean: 45 });
  assert.deepEqual(play(createSquatAnalyzer(), r).events[0].faults, []);
  assert.deepEqual(play(createSquatAnalyzer(GOBLET), r).events[0].faults, ["lean"]);
});

test("heels aren't judged when the camera can't see them", () => {
  const r = rep({ heel: 0.3 }).map((f) => ({ ...f, heelVis: 0.1 }));
  assert.deepEqual(play(createSquatAnalyzer(), r).events[0].faults, []);
});

test("losing the pose mid-rep drops that rep", () => {
  const r = rep(), mid = Math.floor(r.length * 0.4);
  const broken = [...r.slice(0, mid), ...Array(30).fill({ thighV: 50, vis: 0.1 }), ...r.slice(mid)];
  const { events } = play(createSquatAnalyzer(), seq(broken, rep()));
  assert.equal(events.filter((e) => e.type === "rep").length, 1);
});

test("squat coach uses squat lines, and only when a fault repeats", () => {
  const coach = createCoach({ cues, countAloud: false, rng: () => 0, coaching: MOVES.squat.coaching });
  assert.deepEqual(coach.onRep({ n: 1, faults: ["lean"], maxHeel: 0 }), []);
  const c2 = coach.onRep({ n: 2, faults: ["lean"], maxHeel: 0 });
  assert.match(c2[0].id, /^sq_lean_/); assert.equal(c2[0].text, "Chest up");
  assert.equal(coach.onRep({ n: 3, faults: [], maxHeel: 0 })[0].kind, "praise");
  const c4 = coach.onRep({ n: 4, faults: ["heels", "fast"], maxHeel: 0.25 });          // big heel lift: right away
  assert.match(c4[0].id, /^sq_heels_/);
});

test("every squat line the coach can say exists in cues.json", () => {
  const { coaching } = MOVES.squat;
  for (const f of coaching.priority) assert.ok(cues.cues[coaching.cueFor(f)], f);
  const coach = createCoach({ cues, target: 6, countAloud: true, coaching });
  const out = [...coach.onStart(), ...coach.onHalf(), ...coach.onLostPose(10000, 4000), ...coach.onEnd(7)];
  assert.equal(out.length, 6);   // ready, half, position, then "Set done", "Seven", "reps"
  out.forEach((u) => assert.ok(u.text && u.id));
  assert.match(out[0].id, /^sq_ready_/);
});

test("squat summary reads like a log line", () => {
  const s = summarize([
    { n: 1, faults: [], score: 100, lowerMs: 2000, depth: 55 },
    { n: 2, faults: ["lean"], score: 85, lowerMs: 1800, depth: 61 },
  ], { target: 15, date: new Date(2026, 9, 23, 12), move: MOVES.goblet.summary });
  assert.equal(s, "2026-10-23 · Goblet squats: 2 reps (target 15), form score 93/100. chest dropped on 1. Avg lowering 1.9s, avg depth 58° at the knee.");
});

test("plan squats open the camera coach", () => {
  assert.ok(canCoach("bw_squat") && canCoach("goblet") && canCoach("pushup"));
  assert.ok(!canCoach("db_row"));
  assert.equal(moveFor("bw_squat").key, "squat");
  assert.equal(moveFor("goblet").key, "goblet"); assert.ok(moveFor("goblet").weighted);
});
