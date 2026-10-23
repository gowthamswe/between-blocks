import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBridgeAnalyzer, measure, holdFromNote } from "../js/bridge.js";
import { createCoach, summarize } from "../js/coach.js";
import { MOVES, moveFor } from "../js/moves.js";
import { canCoach } from "../js/exercises.js";
import { frame, rep, play, SIZE } from "./synth-bridge.js";

const cues = JSON.parse(readFileSync(new URL("../cues.json", import.meta.url)));
const seq = (...reps) => reps.flat();

test("measure reads hip extension, signed past straight", () => {
  const floor = measure(frame({ lift: -0.25 }), SIZE);
  assert.ok(floor.valid && floor.ext < 135, `floor ${floor.ext}`);
  assert.ok(Math.abs(measure(frame({ lift: 0 }), SIZE).ext - 180) < 0.5);
  assert.ok(measure(frame({ lift: 0.06 }), SIZE).ext > 190);
});

test("standing up isn't a bridge", () => {
  const up = frame({}); [[11, 0.4, 0.2], [23, 0.42, 0.5], [25, 0.44, 0.7], [27, 0.45, 0.9]].forEach(([i, x, y]) => { up[i].x = x; up[i].y = y; });
  assert.equal(measure(up, SIZE).reason, "not-lying");
  assert.equal(measure(frame({ vis: 0.2 }), SIZE).reason, "not-visible");
});

test("clean bridges count when the hips come back down", () => {
  const { events } = play(createBridgeAnalyzer(), seq(rep(), rep(), rep(), [{ lift: -0.25 }]));
  const reps = events.filter((e) => e.type === "rep");
  assert.equal(reps.length, 3);
  reps.forEach((e) => { assert.deepEqual(e.faults, []); assert.equal(e.score, 100); assert.ok(e.holdMs >= 1100, `${e.holdMs}`); });
});

test("each fault is caught", () => {
  const one = (o, cfg) => play(createBridgeAnalyzer(cfg), rep(o)).events.find((e) => e.type === "rep");
  assert.deepEqual(one({ top: -0.06 }).faults, ["low"]);
  assert.deepEqual(one({ top: 0.06 }).faults, ["arch"]);
  assert.deepEqual(one({ holdS: 0.2 }).faults, ["hold"]);
  assert.deepEqual(one({ downS: 0.3 }).faults, ["fast"]);
  assert.deepEqual(one({ holdS: 1.5 }, { holdMs: 3000 }).faults, ["hold"]);       // plan asks for 3 s
  assert.deepEqual(one({ holdS: 3.1 }, { holdMs: 3000 }).faults, []);
});

test("a slow rise doesn't count as the squeeze", () => {
  const e = play(createBridgeAnalyzer({ holdMs: 3000 }), rep({ upS: 3.5, holdS: 0.4 })).events.find((x) => x.type === "rep");
  assert.ok(e.holdMs < 1000, `${e.holdMs}`);
  assert.ok(e.faults.includes("hold"));
});

test("hips that barely lift don't count", () => {
  const { events } = play(createBridgeAnalyzer(), seq(rep({ top: -0.12 }), rep()));
  assert.equal(events.find((e) => e.type !== "held").type, "half");
  assert.equal(events.filter((e) => e.type === "rep").length, 1);
});

test("says 'down' once the plan's squeeze time is reached, once per rep", () => {
  const { events } = play(createBridgeAnalyzer({ holdMs: 3000 }), seq(rep({ holdS: 3.4 }), rep({ holdS: 3.4 })));
  const held = events.filter((e) => e.type === "held");
  assert.equal(held.length, 2);
  assert.ok(held[0].holdMs >= 3000 && held[0].holdMs < 3100);
  assert.ok(events.indexOf(held[0]) < events.findIndex((e) => e.type === "rep"), "held comes before the rep is counted");
  assert.equal(play(createBridgeAnalyzer({ holdMs: 3000 }), rep({ holdS: 2 })).events.filter((e) => e.type === "held").length, 0);
});

test("the plan note sets the squeeze time", () => {
  assert.equal(holdFromNote("3-second squeeze at the top, feet close to your hips"), 3000);
  assert.equal(holdFromNote("Pause 2 sec hold at the top"), 2000);
  assert.equal(holdFromNote("feet close to your hips"), null);
  assert.equal(moveFor("glute_br").create({ note: "3-second squeeze at the top" }).cfg.holdMs, 3000);
  assert.equal(moveFor("glute_br").create(null).cfg.holdMs, 1000);
});

test("bridge coach uses bridge lines", () => {
  const { coaching } = MOVES.bridge;
  for (const f of coaching.priority) assert.ok(cues.cues[coaching.cueFor(f)], f);
  const coach = createCoach({ cues, countAloud: false, rng: () => 0, coaching });
  assert.deepEqual(coach.onRep({ n: 1, faults: ["hold"], peak: 178 }), []);
  assert.equal(coach.onRep({ n: 2, faults: ["hold"], peak: 178 })[0].text, "Hold the squeeze at the top");
  assert.equal(coach.onRep({ n: 3, faults: [], peak: 178 })[0].kind, "praise");
  const fresh = createCoach({ cues, countAloud: false, rng: () => 0, coaching });
  assert.match(fresh.onRep({ n: 1, faults: ["arch"], peak: 204 })[0].id, /^br_arch_/);   // big arch: right away
  assert.equal(coach.onHeld()[0].text, "And down");
  const out = [...coach.onStart(), ...coach.onHalf(), ...coach.onLostPose(10000, 4000)];
  assert.deepEqual(out.map((u) => u.id.replace(/_\d+$/, "")), ["br_ready", "br_half", "br_position"]);
  // push-ups and squats have no timed squeeze
  assert.deepEqual(createCoach({ cues }).onHeld(), []);
});

test("bridge summary reads like a log line", () => {
  const s = summarize([
    { n: 1, faults: [], score: 100, lowerMs: 1200, depth: 179, holdMs: 3100 },
    { n: 2, faults: ["hold"], score: 85, lowerMs: 1000, depth: 175, holdMs: 1900 },
  ], { target: 12, date: new Date(2026, 9, 23, 12), move: MOVES.bridge.summary });
  assert.equal(s, "2026-10-23 · Glute bridges: 2 reps (target 12), form score 93/100. squeeze too short on 1. Avg lowering 1.1s, avg squeeze 2.5s, avg hip angle 177° at the top.");
});

test("plan glute bridges open the camera coach; one-leg bridges don't yet", () => {
  assert.ok(canCoach("glute_br"));
  assert.ok(!canCoach("sl_bridge"));
});
