// Builds fake MediaPipe landmark frames of someone doing push-ups, filmed side-on,
// so the analysis and coaching logic can be tested without a camera.
// Pixel space 1280x720, feet on the left, head on the right, hands under the shoulders.

export const SIZE = { width: 1280, height: 720 };
const FA = 110, UA = 120; // forearm and upper-arm length in px

// One frame. elbow: elbow angle in degrees; hip: hip offset as a fraction of body length
// (positive = sag, negative = pike); vis: visibility of the camera-side joints.
export function frame({ elbow, hip = 0, vis = 0.95 }) {
  const W = { x: 900, y: 600 };
  const E = { x: W.x, y: W.y - FA };                 // forearm vertical
  const th = (elbow * Math.PI) / 180;
  const S = { x: E.x + UA * Math.sin(th), y: E.y + UA * Math.cos(th) };
  const A = { x: 220, y: 610 };
  const len = Math.hypot(S.x - A.x, S.y - A.y);
  // normal to the shoulder-ankle line pointing down in the image
  let nx = -(S.y - A.y) / len, ny = (S.x - A.x) / len;
  if (ny < 0) { nx = -nx; ny = -ny; }
  const H = { x: (S.x + A.x) / 2 + nx * hip * len, y: (S.y + A.y) / 2 + ny * hip * len };
  const K = { x: (H.x + A.x) / 2, y: (H.y + A.y) / 2 };
  const N = { x: S.x + 40, y: S.y - 10 };
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const put = (i, p, v) => { lm[i] = { x: p.x / SIZE.width, y: p.y / SIZE.height, z: 0, visibility: v }; };
  put(0, N, vis);
  // camera side = left landmarks; far side slightly offset and less visible
  put(11, S, vis); put(13, E, vis); put(15, W, vis); put(23, H, vis); put(25, K, vis); put(27, A, vis);
  const off = (p) => ({ x: p.x + 6, y: p.y - 4 });
  put(12, off(S), 0.3); put(14, off(E), 0.3); put(16, off(W), 0.3); put(24, off(H), 0.3); put(26, off(K), 0.3); put(28, off(A), 0.3);
  return lm;
}

// A sequence of frames for one rep at 30 fps.
// lowerS / pushS: seconds lowering / pushing; bottom: lowest elbow angle; hip: hip offset at the bottom.
export function rep({ bottom = 85, lowerS = 2, pushS = 1, holdTopS = 0.6, hip = 0, hipTop = 0 } = {}) {
  const fps = 30, out = [];
  const top = 172;
  const n = (s) => Math.max(1, Math.round(s * fps));
  for (let i = 0; i < n(holdTopS); i++) out.push({ elbow: top, hip: hipTop });
  for (let i = 1; i <= n(lowerS); i++) { const u = i / n(lowerS); out.push({ elbow: top + (bottom - top) * u, hip: hipTop + (hip - hipTop) * u }); }
  for (let i = 1; i <= n(pushS); i++) { const u = i / n(pushS); out.push({ elbow: bottom + (top - bottom) * u, hip: hip + (hipTop - hip) * u }); }
  return out;
}

// Run a list of pose specs through an analyzer; returns the events it emitted.
export function play(analyzer, specs, t0 = 0) {
  const events = []; let t = t0;
  for (const s of specs) {
    const r = analyzer.update(frame(s), t, SIZE);
    if (r.event) events.push(r.event);
    t += 1000 / 30;
  }
  return { events, t };
}
