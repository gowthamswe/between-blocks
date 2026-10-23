// Builds fake MediaPipe landmark frames of someone doing glute bridges, filmed side-on, lying on their back,
// head to the left, feet to the right. Pixel space 1280x720.
//   lift - hip height above the shoulder-knee line, as a fraction of that line's length
//          (0 = shoulders, hips, knees in line; -0.25 = hips on the floor, about 127°; positive = arching past it)
import { SIZE } from "./synth.js";
export { SIZE };

const S = { x: 300, y: 600 }, K = { x: 820, y: 450 }, A = { x: 900, y: 620 };
const LEN = Math.hypot(K.x - S.x, K.y - S.y);

export function frame({ lift = -0.25, vis = 0.95 }) {
  const hx = 580, lineY = S.y + ((hx - S.x) / (K.x - S.x)) * (K.y - S.y);
  const H = { x: hx, y: lineY - lift * LEN };
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const put = (i, p, v) => { lm[i] = { x: p.x / SIZE.width, y: p.y / SIZE.height, z: 0, visibility: v }; };
  put(0, { x: S.x - 60, y: S.y - 10 }, vis);
  put(11, S, vis); put(23, H, vis); put(25, K, vis); put(27, A, vis); put(29, { x: A.x - 15, y: A.y + 5 }, vis); put(31, { x: A.x + 40, y: A.y + 5 }, vis);
  const off = (p) => ({ x: p.x + 5, y: p.y - 6 });
  put(12, off(S), 0.3); put(24, off(H), 0.3); put(26, off(K), 0.3); put(28, off(A), 0.3);
  return lm;
}

// One rep at 30 fps: rest on the floor, rise, hold at the top, lower.
export function rep({ top = 0, upS = 1, holdS = 1.2, downS = 1.2, restS = 0.6 } = {}) {
  const fps = 30, out = [], n = (s) => Math.max(1, Math.round(s * fps)), floor = -0.25;
  for (let i = 0; i < n(restS); i++) out.push({ lift: floor });
  for (let i = 1; i <= n(upS); i++) out.push({ lift: floor + (top - floor) * (i / n(upS)) });
  for (let i = 0; i < Math.round(holdS * fps); i++) out.push({ lift: top });
  for (let i = 1; i <= n(downS); i++) out.push({ lift: top + (floor - top) * (i / n(downS)) });
  return out;
}

export function play(analyzer, specs, t0 = 0) {
  const events = []; let t = t0;
  for (const s of specs) { const r = analyzer.update(frame(s), t, SIZE); if (r.event) events.push(r.event); t += 1000 / 30; }
  return { events, t };
}
