// Builds fake MediaPipe landmark frames of someone squatting, filmed side-on, facing right.
// Pixel space 1280x720. Angles in degrees:
//   thighV - thigh angle from vertical (0 standing, 90 = thighs level, >90 = below level)
//   shinV  - shin forward tilt from vertical; lean - torso angle from vertical; heel - heel lift as a fraction of shin
import { SIZE } from "./synth.js";
export { SIZE };

const SHIN = 170, THIGH = 180, TORSO = 230;
const rad = (d) => (d * Math.PI) / 180;

export function frame({ thighV = 4, shinV, lean = 6, heel = 0, vis = 0.95, heelVis = 0.9 }) {
  shinV = shinV ?? thighV * 0.35;
  const A = { x: 640, y: 640 };
  const K = { x: A.x + SHIN * Math.sin(rad(shinV)), y: A.y - SHIN * Math.cos(rad(shinV)) };
  const H = { x: K.x - THIGH * Math.sin(rad(thighV)), y: K.y - THIGH * Math.cos(rad(thighV)) };
  const S = { x: H.x + TORSO * Math.sin(rad(lean)), y: H.y - TORSO * Math.cos(rad(lean)) };
  const N = { x: S.x + 20, y: S.y - 50 };
  const Hl = { x: A.x - 22, y: A.y + 10 - heel * SHIN };
  const T = { x: A.x + 70, y: A.y + 14 };
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const put = (i, p, v) => { lm[i] = { x: p.x / SIZE.width, y: p.y / SIZE.height, z: 0, visibility: v }; };
  put(0, N, vis);
  put(11, S, vis); put(23, H, vis); put(25, K, vis); put(27, A, vis); put(29, Hl, heelVis); put(31, T, heelVis);
  const off = (p) => ({ x: p.x - 8, y: p.y - 3 });
  put(12, off(S), 0.3); put(24, off(H), 0.3); put(26, off(K), 0.3); put(28, off(A), 0.3); put(30, off(Hl), 0.2); put(32, off(T), 0.2);
  return lm;
}

// One rep at 30 fps. bottom: thigh angle from vertical at the bottom (95 = just below level).
export function rep({ bottom = 95, downS = 2, upS = 1.2, holdTopS = 0.6, lean = 30, heel = 0 } = {}) {
  const fps = 30, out = [], n = (s) => Math.max(1, Math.round(s * fps));
  const top = { thighV: 4, lean: 6, heel: 0 };
  for (let i = 0; i < n(holdTopS); i++) out.push({ ...top });
  for (let i = 1; i <= n(downS); i++) { const u = i / n(downS); out.push({ thighV: 4 + (bottom - 4) * u, lean: 6 + (lean - 6) * u, heel: heel * u }); }
  for (let i = 1; i <= n(upS); i++) { const u = i / n(upS); out.push({ thighV: bottom + (4 - bottom) * u, lean: lean + (6 - lean) * u, heel: heel * (1 - u) }); }
  return out;
}

export function play(analyzer, specs, t0 = 0) {
  const events = []; let t = t0;
  for (const s of specs) { const r = analyzer.update(frame(s), t, SIZE); if (r.event) events.push(r.event); t += 1000 / 30; }
  return { events, t };
}
