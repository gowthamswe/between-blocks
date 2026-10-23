// Builds fake MediaPipe landmark frames of a dumbbell Romanian deadlift, filmed side-on, facing right.
// Pixel space 1280x720. Angles in degrees:
//   hinge - torso from vertical; thighV - thigh tilted back from vertical; shinV - shin forward from vertical
//   drift - wrists in front of the middle of the foot, in shin lengths
import { SIZE } from "./synth.js";
export { SIZE };

const SHIN = 170, THIGH = 180, TORSO = 230;
const rad = (d) => (d * Math.PI) / 180;
const A = { x: 640, y: 640 }, TOE = { x: 710, y: 654 }, HEEL = { x: 618, y: 650 }, MID = (TOE.x + HEEL.x) / 2;

export function frame({ hinge = 5, thighV = 3, shinV = 2, drift = 0.1, vis = 0.95, wristVis = 0.9 }) {
  const K = { x: A.x + SHIN * Math.sin(rad(shinV)), y: A.y - SHIN * Math.cos(rad(shinV)) };
  const H = { x: K.x - THIGH * Math.sin(rad(thighV)), y: K.y - THIGH * Math.cos(rad(thighV)) };
  const S = { x: H.x + TORSO * Math.sin(rad(hinge)), y: H.y - TORSO * Math.cos(rad(hinge)) };
  const W = { x: MID + drift * SHIN, y: Math.max(S.y + 120, H.y + 60) };
  const E = { x: (S.x + W.x) / 2, y: (S.y + W.y) / 2 };
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const put = (i, p, v) => { lm[i] = { x: p.x / SIZE.width, y: p.y / SIZE.height, z: 0, visibility: v }; };
  put(0, { x: S.x + 30, y: S.y - 40 }, vis);
  put(11, S, vis); put(13, E, wristVis); put(15, W, wristVis); put(23, H, vis); put(25, K, vis); put(27, A, vis); put(29, HEEL, vis); put(31, TOE, vis);
  const off = (p) => ({ x: p.x - 8, y: p.y - 3 });
  [[12, S], [14, E], [16, W], [24, H], [26, K], [28, A], [30, HEEL], [32, TOE]].forEach(([i, p]) => put(i, off(p), 0.3));
  return lm;
}

// One rep at 30 fps. bottom: deepest hinge; knees/drift: thigh tilt and wrist drift at the bottom.
export function rep({ bottom = 75, thighV = 25, shinV = 6, drift = 0.2, downS = 2, upS = 1.2, holdTopS = 0.6 } = {}) {
  const fps = 30, out = [], n = (s) => Math.max(1, Math.round(s * fps));
  const top = { hinge: 5, thighV: 3, shinV: 2, drift: 0.1 }, bot = { hinge: bottom, thighV, shinV, drift };
  const mix = (u) => Object.fromEntries(Object.keys(top).map((k) => [k, top[k] + (bot[k] - top[k]) * u]));
  for (let i = 0; i < n(holdTopS); i++) out.push(mix(0));
  for (let i = 1; i <= n(downS); i++) out.push(mix(i / n(downS)));
  for (let i = 1; i <= n(upS); i++) out.push(mix(1 - i / n(upS)));
  return out;
}

export function play(analyzer, specs, t0 = 0) {
  const events = []; let t = t0;
  for (const s of specs) { const r = analyzer.update(frame(s), t, SIZE); if (r.event) events.push(r.event); t += 1000 / 30; }
  return { events, t };
}
