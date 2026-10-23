import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPushupAnalyzer, measure } from "../js/pushup.js";
import { createCoach, summarize } from "../js/coach.js";
import { frame, rep, play, SIZE } from "./synth.js";

const cues = JSON.parse(readFileSync(new URL("../cues.json", import.meta.url)));
const seq = (...reps) => reps.flat();

test("measure reads elbow angle and a straight body line", () => {
  const m = measure(frame({ elbow: 90, hip: 0 }), SIZE);
  assert.equal(m.valid, true);
  assert.ok(Math.abs(m.elbow - 90) < 1, `elbow ${m.elbow}`);
  assert.ok(Math.abs(m.line) < 0.01, `line ${m.line}`);
  assert.equal(m.side, "l");
});

test("measure signs sag positive and pike negative", () => {
  assert.ok(measure(frame({ elbow: 170, hip: 0.08 }), SIZE).line > 0.07);
  assert.ok(measure(frame({ elbow: 170, hip: -0.1 }), SIZE).line < -0.09);
});

test("hidden joints or standing up are not a valid plank", () => {
  assert.equal(measure(frame({ elbow: 170, vis: 0.2 }), SIZE).valid, false);
  const standing = frame({ elbow: 170 });
  standing[27] = { ...standing[27], x: standing[11].x, y: 0.95 }; // ankle straight below shoulder
  assert.equal(measure(standing, SIZE).reason, "not-plank");
});

test("counts clean reps with no faults", () => {
  const a = createPushupAnalyzer();
  const { events } = play(a, seq(rep(), rep(), rep(), rep({ holdTopS: 0.6 })));
  const reps = events.filter((e) => e.type === "rep");
  assert.equal(reps.length, 4);
  reps.forEach((r) => { assert.deepEqual(r.faults, []); assert.equal(r.score, 100); });
  assert.ok(reps[0].lowerMs > 1500 && reps[0].lowerMs < 2300, `lowerMs ${reps[0].lowerMs}`);
});

test("flags sag, shallow, pike and rushing", () => {
  const a = createPushupAnalyzer();
  const { events } = play(a, seq(
    rep({ hip: 0.09 }),            // sag
    rep({ bottom: 110 }),          // shallow but counted
    rep({ hip: -0.12 }),           // pike
    rep({ lowerS: 0.5 }),          // rushed
    rep({ holdTopS: 0.4 }),
  ));
  const reps = events.filter((e) => e.type === "rep");
  assert.equal(reps.length, 5);
  assert.deepEqual(reps[0].faults, ["sag"]);
  assert.deepEqual(reps[1].faults, ["shallow"]);
  assert.deepEqual(reps[2].faults, ["pike"]);
  assert.deepEqual(reps[3].faults, ["fast"]);
  assert.deepEqual(reps[4].faults, []);
  assert.equal(reps[0].score, 75);
});

test("half reps are reported but not counted", () => {
  const a = createPushupAnalyzer();
  const { events } = play(a, seq(rep({ bottom: 130 }), rep()));
  assert.equal(events[0].type, "half");
  assert.equal(events[1].type, "rep");
  assert.equal(events[1].n, 1);
});

test("losing the pose mid-rep drops that rep", () => {
  const a = createPushupAnalyzer();
  const r = rep();
  const mid = Math.floor(r.length * 0.4);
  const broken = [...r.slice(0, mid), ...Array(30).fill({ elbow: 120, vis: 0.1 }), ...r.slice(mid)];
  const { events } = play(a, seq(broken, rep()));
  // the broken rep is abandoned; counting resumes on the next full rep
  assert.equal(events.filter((e) => e.type === "rep").length, 1);
});

test("coach waits for a fault to repeat, cues once, then praises the fix", () => {
  const coach = createCoach({ cues, countAloud: false, rng: () => 0 });
  const r = (n, faults, maxSag = 0.06) => ({ n, faults, maxSag });
  assert.deepEqual(coach.onRep(r(1, ["shallow"])), []);                 // first time: let it go
  const c2 = coach.onRep(r(2, ["shallow"]));                             // second time: cue
  assert.equal(c2.length, 1); assert.equal(c2[0].kind, "cue"); assert.match(c2[0].id, /^shallow_/);
  const c3 = coach.onRep(r(3, []));                                      // fixed: praise
  assert.equal(c3[0].kind, "praise");
  assert.deepEqual(coach.onRep(r(4, ["shallow"])), []);                  // 1 of last 3... history [s, -, s] = 2 but cooldown (4-2 < 3)
  const c5 = coach.onRep(r(5, ["shallow"]));                             // cooldown over
  assert.match(c5[0].id, /^shallow_/);
});

test("coach gives one correction per rep, sag first, and a big sag right away", () => {
  const coach = createCoach({ cues, countAloud: true, rng: () => 0 });
  const c1 = coach.onRep({ n: 1, faults: ["sag", "shallow"], maxSag: 0.12 });
  assert.deepEqual(c1.map((u) => u.kind), ["count", "cue"]);
  assert.equal(c1[0].id, "n_1");
  assert.match(c1[1].id, /^sag_/);
});

test("coach calls out the end of the target", () => {
  const coach = createCoach({ cues, target: 6, countAloud: false, rng: () => 0 });
  const said = [];
  for (let n = 1; n <= 6; n++) said.push(coach.onRep({ n, faults: [] }).map((u) => u.id.split("_").slice(0, -1).join("_")));
  assert.deepEqual(said, [[], [], [], ["two_more"], ["last_one"], ["target_done"]]);
});

test("coach rotates phrasings", () => {
  let i = 0; const seqRng = [0, 0, 0.5, 0.5, 0.9];
  const coach = createCoach({ cues, countAloud: false, rng: () => seqRng[i++ % seqRng.length] });
  const ids = [];
  for (let n = 1; n <= 8; n++) { const u = coach.onRep({ n, faults: ["fast"] }).find((x) => x.kind === "cue"); if (u) ids.push(u.id); }
  assert.ok(ids.length >= 2);
  for (let k = 1; k < ids.length; k++) assert.notEqual(ids[k], ids[k - 1]);
});

test("every clip id the coach can produce exists in cues.json", () => {
  const coach = createCoach({ cues, target: 6, countAloud: true });
  const out = [...coach.onStart(), ...coach.onHalf(), ...coach.onLostPose(10000, 4000), ...coach.onEnd(7)];
  out.forEach((u) => assert.ok(u.text && u.id));
});

test("summary reads like a log line", () => {
  const s = summarize([
    { n: 1, faults: [], score: 100, lowerMs: 2000, minElbow: 88 },
    { n: 2, faults: ["sag"], score: 75, lowerMs: 1800, minElbow: 92 },
  ], { target: 7, date: new Date("2026-10-23T12:00:00Z") });
  assert.equal(s, "2026-10-23 · Push-ups: 2 reps (target 7), form score 88/100. hips sagged on 1. Avg lowering 1.9s, avg depth 90° at the elbow.");
});
