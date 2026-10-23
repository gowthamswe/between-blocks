// What the camera coach needs to know about each exercise it can run: the analyzer, what to say,
// how to label faults, which joints to draw, and the camera tips. Plan exercises map onto these
// (bodyweight and goblet squats share the squat analyzer; goblet keeps the chest more upright).
import { createPushupAnalyzer, LM as PUSHUP_LM } from "./pushup.js";
import { createSquatAnalyzer, LM as SQUAT_LM, GOBLET } from "./squat.js";
import { createBridgeAnalyzer, LM as BRIDGE_LM, holdFromNote } from "./bridge.js";
import { createRdlAnalyzer, LM as RDL_LM } from "./rdl.js";
import { PUSHUP_COACHING } from "./coach.js";

const pushup = {
  key: "pushup", name: "Push-ups", title: "Push-up coach", joint: "elbow", unit: "push-up",
  create: () => createPushupAnalyzer(),
  downWord: "Not counted: go deeper",
  coaching: PUSHUP_COACHING,
  faults: { sag: "Hips sagged", shallow: "Not deep enough", pike: "Hips too high", fast: "Lowered too fast" },
  summary: { name: "Push-ups", joint: "elbow", faults: { sag: "hips sagged", shallow: "not deep enough", pike: "hips too high", fast: "lowered too fast" } },
  pose: { "not-plank": ["Get into a plank, side-on", "warn"] },
  tips: [["Side-on.", " Put the camera level with your body, at floor height, 2–3 m to your side."],
    ["Whole body in view,", " head to heels, with your hands under your shoulders."],
    ["Light the room.", " Tracking gets shaky in dim light."]],
  // body line, then arm; the elbow is the joint that counts
  lines: (s) => [[s.shoulder, s.hip, 1.4], [s.hip, s.knee, 1.4], [s.knee, s.ankle, 1.4]],
  limb: (s) => [[s.shoulder, s.elbow], [s.elbow, s.wrist]],
  guide: (s) => [s.shoulder, s.ankle],
  dots: (s) => [s.shoulder, s.elbow, s.wrist, s.hip, s.knee, s.ankle],
  hot: (s) => s.elbow,
  lm: PUSHUP_LM,
  bad: (live) => live && (live.sag || live.pike),
  depthText: (r) => `${r.minElbow}° at the bottom`,
  debug: (r) => `elbow ${r.elbow.toFixed(0)}°  hips ${(r.line * 100).toFixed(1)}%  ${r.phase}`,
};

const squatBase = {
  name: "Squats", title: "Squat coach", joint: "knee", unit: "squat",
  coaching: {
    priority: ["shallow", "heels", "lean", "fast"],
    ids: { ready: "sq_ready", half: "sq_half", position: "sq_position" },
    cueFor: (f) => "sq_" + f,
    urgent: (f, rep) => f === "heels" && rep.maxHeel > 0.2,
  },
  faults: { shallow: "Not deep enough", heels: "Heels lifted", lean: "Chest dropped", fast: "Sat down too fast" },
  downWord: "Not counted: sit lower",
  summary: { name: "Squats", joint: "knee", faults: { shallow: "not deep enough", heels: "heels lifted", lean: "chest dropped", fast: "sat down too fast" } },
  pose: { "not-standing": ["Stand up, side-on", "warn"] },
  tips: [["Side-on.", " Put the camera at hip height, 2–3 m to your side."],
    ["Whole body in view,", " head to feet. The coach watches your heels too."],
    ["Light the room.", " Tracking gets shaky in dim light."]],
  lines: (s) => [[s.shoulder, s.hip, 1.4], [s.hip, s.knee, 1.4], [s.knee, s.ankle, 1.4], [s.heel, s.toe, 1]],
  limb: () => [],
  guide: (s) => [s.knee, s.toe],
  dots: (s) => [s.shoulder, s.hip, s.knee, s.ankle, s.heel, s.toe],
  hot: (s) => s.knee,
  lm: SQUAT_LM,
  bad: (live) => live && (live.lean || live.heels),
  depthText: (r) => `${r.minKnee}° at the knee, thighs ${r.thigh <= 0 ? "below" : r.thigh + "° above"} level`,
  debug: (r) => `knee ${r.knee.toFixed(0)}°  thigh ${r.thigh.toFixed(0)}°  lean ${r.lean.toFixed(0)}°  ${r.phase}`,
};
const squat = { ...squatBase, key: "squat", create: () => createSquatAnalyzer() };
const goblet = { ...squatBase, key: "goblet", name: "Goblet squats", title: "Goblet squat coach", weighted: true,
  summary: { ...squatBase.summary, name: "Goblet squats" }, create: () => createSquatAnalyzer(GOBLET) };

// Glute bridge, lying on your back side-on. The plan's squeeze ("3-second squeeze at the top") sets the hold.
const bridge = {
  key: "bridge", name: "Glute bridges", title: "Glute bridge coach", joint: "hip", unit: "bridge",
  create: (item) => createBridgeAnalyzer({ holdMs: holdFromNote(item && item.note) || 1000 }),
  coaching: {
    priority: ["low", "arch", "hold", "fast"],
    ids: { ready: "br_ready", half: "br_half", position: "br_position", held: "br_down" },
    cueFor: (f) => "br_" + f,
    urgent: (f, rep) => f === "arch" && rep.peak > 200,
  },
  faults: { low: "Hips not all the way up", arch: "Back arched", hold: "Squeeze too short", fast: "Dropped down" },
  summary: { name: "Glute bridges", joint: "hip", faults: { low: "hips not all the way up", arch: "back arched", hold: "squeeze too short", fast: "dropped down" },
    tail: (reps, avg) => `avg squeeze ${(reps.reduce((s, r) => s + r.holdMs, 0) / reps.length / 1000).toFixed(1)}s, avg hip angle ${avg}° at the top` },
  pose: { "not-lying": ["Lie on your back, side-on, knees bent", "warn"] },
  tips: [["Side-on.", " Put the camera at floor height, 2–3 m to your side."],
    ["Shoulders to feet in view,", " lying on your back with your knees bent."],
    ["Light the room.", " Tracking gets shaky in dim light."]],
  lines: (s) => [[s.shoulder, s.hip, 1.4], [s.hip, s.knee, 1.4], [s.knee, s.ankle, 1.4]],
  limb: () => [],
  guide: (s) => [s.shoulder, s.knee],
  dots: (s) => [s.shoulder, s.hip, s.knee, s.ankle],
  hot: (s) => s.hip,
  lm: BRIDGE_LM,
  bad: (live) => live && live.arch,
  depthText: (r) => `${r.peak}° at the top, squeezed ${(r.holdMs / 1000).toFixed(1)} s`,
  debug: (r) => `hip ${r.ext.toFixed(0)}°  ${r.phase}`,
  downWord: "Not counted: hips all the way up",
};

// Romanian deadlift with dumbbells, side-on: hinge at the hips, soft knees, weights close to the legs.
const rdl = {
  key: "rdl", name: "Romanian deadlifts", title: "Romanian deadlift coach", joint: "hip", unit: "deadlift", weighted: true,
  create: () => createRdlAnalyzer(),
  coaching: {
    priority: ["squat", "drift", "shallow", "fast"],
    ids: { ready: "rd_ready", half: "rd_half", position: "rd_position" },
    cueFor: (f) => "rd_" + f,
    urgent: (f, rep) => f === "squat" && rep.minKnee < 120,
  },
  faults: { squat: "Knees bent too much", drift: "Weights drifted forward", shallow: "Didn't hinge far enough", fast: "Lowered too fast" },
  downWord: "Not counted: hips further back",
  summary: { name: "Romanian deadlifts", joint: "hip",
    faults: { squat: "knees bent too much", drift: "weights drifted forward", shallow: "didn't hinge far enough", fast: "lowered too fast" },
    tail: (reps, avg) => `avg hinge ${avg}° from upright` },
  pose: { "not-standing": ["Stand up, side-on", "warn"] },
  tips: [["Side-on.", " Put the camera at hip height, 2–3 m to your side."],
    ["Whole body in view,", " head to feet, with the dumbbells in the hand nearest the camera visible."],
    ["Light the room.", " Tracking gets shaky in dim light."]],
  lines: (s) => [[s.shoulder, s.hip, 1.4], [s.hip, s.knee, 1.4], [s.knee, s.ankle, 1.4], [s.heel, s.toe, 1]],
  limb: (s) => [[s.shoulder, s.elbow], [s.elbow, s.wrist]],
  guide: (s) => [s.wrist, s.ankle],
  dots: (s) => [s.shoulder, s.wrist, s.hip, s.knee, s.ankle, s.heel, s.toe],
  hot: (s) => s.hip,
  lm: RDL_LM,
  bad: (live) => live && (live.squat || live.drift),
  depthText: (r) => `hinged ${r.maxHinge}°, knees ${r.minKnee}°`,
  debug: (r) => `hinge ${r.hinge.toFixed(0)}°  knee ${r.knee.toFixed(0)}°  weights ${r.drift == null ? "?" : r.drift.toFixed(2)}  ${r.phase}`,
};

export const MOVES = { pushup, squat, goblet, bridge, rdl };
// plan exercise -> coach move
export const MOVE_FOR = { pushup: "pushup", bw_squat: "squat", goblet: "goblet", glute_br: "bridge", db_rdl: "rdl" };
export const moveFor = (ex) => MOVES[MOVE_FOR[ex]] || null;
