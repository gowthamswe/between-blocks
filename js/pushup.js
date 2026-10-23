// Push-up analysis from MediaPipe pose landmarks, filmed side-on.
// Pure logic: no DOM, no camera. Feed it one frame at a time with update().
//
// Per frame it measures:
//   elbow  - elbow angle on the side facing the camera (180 = arm straight)
//   line   - how far the hips sit off the shoulder-to-ankle line, as a fraction of
//            that line's length. Positive = hips below the line (sag), negative = above (pike).
// Per rep it reports depth, lowering time, worst sag/pike, faults and a 0-100 score.

export const LM = {
  nose: 0,
  l: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  r: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
};

export const DEFAULTS = {
  topEnter: 150,      // elbow above this = arms straight at the top
  topLeave: 140,      // dropping below this starts the lowering phase
  countMax: 120,      // the deepest point must reach this or the rep doesn't count
  goodDepth: 95,      // deeper than this is full depth; between this and countMax = shallow
  riseBy: 15,         // elbow must rise this far from its lowest point to start the push
  sagMax: 0.05,       // hips more than 5% of body length below the line = sag
  pikeMax: 0.07,      // hips more than 7% above the line = pike
  minLowerMs: 1000,   // lowering faster than this = rushing (plan asks for ~2 s)
  minVis: 0.5,        // landmark visibility needed to trust a point
  maxTiltDeg: 40,     // shoulder-to-ankle line steeper than this = not in a plank
  invalidAbortMs: 600,// lose the pose this long mid-rep and the rep is dropped
  smooth: 0.45,       // exponential smoothing for elbow angle and hip line (0 = none)
};

export const PENALTY = { sag: 25, shallow: 20, pike: 15, fast: 10 };

function angleDeg(a, b, c) {
  // angle at b, in degrees
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (!n1 || !n2) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// signed distance of hip from the shoulder-ankle line, normalised by line length.
// Image y grows downward, so "below the line" (sag) = positive.
function hipLineOffset(s, h, a) {
  const dx = a.x - s.x, dy = a.y - s.y;
  const len = Math.hypot(dx, dy);
  if (!len) return NaN;
  const t = ((h.x - s.x) * dx + (h.y - s.y) * dy) / (len * len);
  const px = s.x + t * dx, py = s.y + t * dy;
  const dist = Math.hypot(h.x - px, h.y - py) / len;
  return h.y >= py ? dist : -dist;
}

// Pick the side facing the camera: the one whose key joints are most visible.
export function pickSide(lm) {
  const score = (side) => ["shoulder", "elbow", "wrist", "hip", "ankle"]
    .reduce((acc, k) => acc + (lm[LM[side][k]]?.visibility ?? 0), 0);
  return score("l") >= score("r") ? "l" : "r";
}

export function measure(lm, size, cfg = DEFAULTS) {
  if (!lm || lm.length < 29) return { valid: false, reason: "nobody" };
  const side = pickSide(lm);
  const ids = LM[side];
  const px = (i) => ({ x: lm[i].x * size.width, y: lm[i].y * size.height, v: lm[i].visibility ?? 1 });
  const S = px(ids.shoulder), E = px(ids.elbow), W = px(ids.wrist), H = px(ids.hip), A = px(ids.ankle);
  const low = [S, E, W, H, A].some((p) => p.v < cfg.minVis);
  if (low) return { valid: false, reason: "not-visible", side };
  const tilt = Math.abs((Math.atan2(A.y - S.y, S.x - A.x) * 180) / Math.PI);
  const tiltFromFlat = Math.min(tilt, 180 - tilt);
  if (tiltFromFlat > cfg.maxTiltDeg) return { valid: false, reason: "not-plank", side, tilt: tiltFromFlat };
  const elbow = angleDeg(S, E, W);
  const line = hipLineOffset(S, H, A);
  if (!Number.isFinite(elbow) || !Number.isFinite(line)) return { valid: false, reason: "bad-geometry", side };
  return { valid: true, side, elbow, line, tilt: tiltFromFlat, pts: { S, E, W, H, A } };
}

export function scoreRep(faults) {
  return Math.max(0, 100 - faults.reduce((s, f) => s + (PENALTY[f] || 0), 0));
}

export function createPushupAnalyzer(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let phase = "idle";        // idle -> top -> down -> up -> top ...
  let rep = null;            // the rep in progress
  let count = 0;
  let sm = null;             // smoothed {elbow, line}
  let lastValidT = null;
  let topPeak = 0, topEdgeT = null; // straightest elbow seen at the top, and when

  function reset() { phase = "idle"; rep = null; count = 0; sm = null; lastValidT = null; topPeak = 0; topEdgeT = null; }

  function finishRep(t) {
    const r = rep; rep = null;
    const lowerMs = r.tMin - r.tStart;
    const counted = r.minElbow <= cfg.countMax;
    if (!counted) return { type: "half", minElbow: r.minElbow, t };
    count += 1;
    const faults = [];
    if (r.maxSag > cfg.sagMax) faults.push("sag");
    if (r.minElbow > cfg.goodDepth) faults.push("shallow");
    if (r.maxPike > cfg.pikeMax) faults.push("pike");
    if (lowerMs < cfg.minLowerMs) faults.push("fast");
    return {
      type: "rep", n: count, t,
      minElbow: Math.round(r.minElbow),
      lowerMs: Math.round(lowerMs),
      pushMs: Math.round(t - r.tMin),
      maxSag: +r.maxSag.toFixed(3),
      maxPike: +r.maxPike.toFixed(3),
      faults, score: scoreRep(faults),
    };
  }

  // landmarks: MediaPipe normalized landmarks for one person; t: ms; size: {width, height}
  function update(landmarks, t, size) {
    const m = measure(landmarks, size, cfg);
    const out = { ...m, phase, count, event: null };
    if (!m.valid) {
      sm = null;
      if (rep && lastValidT != null && t - lastValidT > cfg.invalidAbortMs) { rep = null; phase = "idle"; }
      if (!rep && phase !== "idle" && lastValidT != null && t - lastValidT > cfg.invalidAbortMs) phase = "idle";
      out.phase = phase;
      return out;
    }
    lastValidT = t;
    const a = cfg.smooth;
    sm = sm ? { elbow: a * sm.elbow + (1 - a) * m.elbow, line: a * sm.line + (1 - a) * m.line } : { elbow: m.elbow, line: m.line };
    const e = sm.elbow, line = sm.line;
    out.elbow = e; out.line = line;

    if (phase === "idle") {
      if (e > cfg.topEnter) { phase = "top"; topPeak = e; topEdgeT = t; }
    } else if (phase === "top") {
      // the lowering starts when the arms leave their straightest point, not when they pass topLeave
      if (e > topPeak) topPeak = e;
      if (e >= topPeak - 6) topEdgeT = t;
      if (e < cfg.topLeave) {
        phase = "down";
        rep = { tStart: topEdgeT ?? t, minElbow: e, tMin: t, maxSag: Math.max(0, line), maxPike: Math.max(0, -line) };
      }
    } else if (phase === "down" || phase === "up") {
      rep.maxSag = Math.max(rep.maxSag, line);
      rep.maxPike = Math.max(rep.maxPike, -line);
      if (e < rep.minElbow) { rep.minElbow = e; rep.tMin = t; if (phase === "up") phase = "down"; }
      if (phase === "down" && e > rep.minElbow + cfg.riseBy) phase = "up";
      if (e > cfg.topEnter) { out.event = finishRep(t); phase = "top"; topPeak = e; topEdgeT = t; }
    }
    out.phase = phase; out.count = count;
    out.live = rep ? { sag: line > cfg.sagMax, pike: -line > cfg.pikeMax } : null;
    return out;
  }

  return { update, reset, get count() { return count; }, get phase() { return phase; }, cfg };
}
