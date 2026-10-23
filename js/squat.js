// Squat analysis (bodyweight and goblet) from MediaPipe pose landmarks, filmed side-on.
// Pure logic: no DOM, no camera. Same shape as the push-up analyzer: feed it frames with update().
//
// Per frame it measures, on the side facing the camera:
//   knee   - knee angle, hip-knee-ankle (180 = standing straight). Drives the rep phases.
//   thigh  - how far the thigh sits above horizontal, in degrees (0 = thighs level, negative = below).
//   lean   - torso angle from vertical, hip to shoulder, in degrees.
//   heel   - how far the heel has lifted since standing, as a fraction of shin length (needs the heel landmark).
// Per rep it reports depth, lowering time, worst lean, heel lift, faults and a 0-100 score.
// What the side view can't see: knees caving in. That needs a front camera.

export const LM = {
  nose: 0,
  l: { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  r: { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};

export const DEFAULTS = {
  topEnter: 160,      // knee above this = standing tall
  topLeave: 150,      // dropping below this starts the lowering phase
  countMax: 120,      // the deepest knee angle must reach this or the rep doesn't count
  goodThigh: 15,      // thighs within 15° of level (or below) = full depth; plan says "thighs at least level"
  riseBy: 15,         // knee must open this far from its lowest point to start standing up
  leanMax: 50,        // torso more than 50° from vertical at the bottom = chest dropping
  heelMax: 0.1,       // heel lifting more than 10% of shin length = heels coming up
  minLowerMs: 1000,   // sitting down faster than this = rushing (plan asks for ~2 s)
  minVis: 0.5,        // landmark visibility needed to trust a point
  invalidAbortMs: 600,// lose the pose this long mid-rep and the rep is dropped
  smooth: 0.45,       // exponential smoothing (0 = none)
};
// A goblet squat holds the weight at the chest, so the torso should stay more upright.
export const GOBLET = { leanMax: 40 };

export const PENALTY = { shallow: 20, heels: 20, lean: 15, fast: 10 };

function angleDeg(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (!n1 || !n2) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function pickSide(lm) {
  const score = (side) => ["shoulder", "hip", "knee", "ankle"].reduce((acc, k) => acc + (lm[LM[side][k]]?.visibility ?? 0), 0);
  return score("l") >= score("r") ? "l" : "r";
}

export function measure(lm, size, cfg = DEFAULTS) {
  if (!lm || lm.length < 33) return { valid: false, reason: "nobody" };
  const side = pickSide(lm);
  const ids = LM[side];
  const px = (i) => ({ x: lm[i].x * size.width, y: lm[i].y * size.height, v: lm[i].visibility ?? 1 });
  const S = px(ids.shoulder), H = px(ids.hip), K = px(ids.knee), A = px(ids.ankle), Hl = px(ids.heel), T = px(ids.toe);
  if ([S, H, K, A].some((p) => p.v < cfg.minVis)) return { valid: false, reason: "not-visible", side };
  // upright: shoulders above hips above ankles (image y grows downward)
  if (!(S.y < H.y && H.y < A.y)) return { valid: false, reason: "not-standing", side };
  const knee = angleDeg(H, K, A);
  const thigh = (Math.atan2(K.y - H.y, Math.abs(K.x - H.x)) * 180) / Math.PI;   // + = hip above knee
  const lean = (Math.atan2(Math.abs(S.x - H.x), H.y - S.y) * 180) / Math.PI;
  const shin = Math.hypot(K.x - A.x, K.y - A.y);
  if (!Number.isFinite(knee) || !shin) return { valid: false, reason: "bad-geometry", side };
  const heelY = Hl.v >= cfg.minVis ? Hl.y : null;
  return { valid: true, side, knee, thigh, lean, heelY, shin, pts: { S, H, K, A, Hl, T } };
}

export function scoreRep(faults) {
  return Math.max(0, 100 - faults.reduce((s, f) => s + (PENALTY[f] || 0), 0));
}

export function createSquatAnalyzer(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let phase = "idle";        // idle -> top -> down -> up -> top ...
  let rep = null, count = 0, sm = null, lastValidT = null;
  let topPeak = 0, topEdgeT = null, heelBase = null;

  function reset() { phase = "idle"; rep = null; count = 0; sm = null; lastValidT = null; topPeak = 0; topEdgeT = null; heelBase = null; }

  function finishRep(t) {
    const r = rep; rep = null;
    const lowerMs = r.tMin - r.tStart;
    if (r.minKnee > cfg.countMax) return { type: "half", minKnee: Math.round(r.minKnee), t };
    count += 1;
    const faults = [];
    if (r.minThigh > cfg.goodThigh) faults.push("shallow");
    if (r.maxHeel > cfg.heelMax) faults.push("heels");
    if (r.maxLean > cfg.leanMax) faults.push("lean");
    if (lowerMs < cfg.minLowerMs) faults.push("fast");
    return {
      type: "rep", n: count, t,
      minKnee: Math.round(r.minKnee), depth: Math.round(r.minKnee), thigh: Math.round(r.minThigh),
      lowerMs: Math.round(lowerMs), upMs: Math.round(t - r.tMin),
      maxLean: Math.round(r.maxLean), maxHeel: +r.maxHeel.toFixed(3),
      faults, score: scoreRep(faults),
    };
  }

  function update(landmarks, t, size) {
    const m = measure(landmarks, size, cfg);
    const out = { ...m, phase, count, event: null };
    if (!m.valid) {
      sm = null;
      if (lastValidT != null && t - lastValidT > cfg.invalidAbortMs) { rep = null; phase = "idle"; }
      out.phase = phase;
      return out;
    }
    lastValidT = t;
    const a = cfg.smooth;
    sm = sm ? { knee: a * sm.knee + (1 - a) * m.knee, thigh: a * sm.thigh + (1 - a) * m.thigh, lean: a * sm.lean + (1 - a) * m.lean }
      : { knee: m.knee, thigh: m.thigh, lean: m.lean };
    const k = sm.knee;
    out.knee = k; out.thigh = sm.thigh; out.lean = sm.lean;
    // heel lift is measured against where the heel sits while standing
    const heel = m.heelY != null && heelBase != null ? (heelBase - m.heelY) / m.shin : 0;

    if (phase === "idle") {
      if (k > cfg.topEnter) { phase = "top"; topPeak = k; topEdgeT = t; heelBase = m.heelY; }
    } else if (phase === "top") {
      if (k > topPeak) topPeak = k;
      if (k >= topPeak - 6) { topEdgeT = t; if (m.heelY != null) heelBase = heelBase == null ? m.heelY : 0.7 * heelBase + 0.3 * m.heelY; }
      if (k < cfg.topLeave) {
        phase = "down";
        rep = { tStart: topEdgeT ?? t, minKnee: k, tMin: t, minThigh: sm.thigh, maxLean: sm.lean, maxHeel: Math.max(0, heel) };
      }
    } else if (phase === "down" || phase === "up") {
      rep.maxHeel = Math.max(rep.maxHeel, heel);
      if (k < rep.minKnee) { rep.minKnee = k; rep.tMin = t; if (phase === "up") phase = "down"; }
      if (sm.thigh < rep.minThigh) rep.minThigh = sm.thigh;
      // lean only matters near the bottom, where the chest tends to drop
      if (k < cfg.topLeave - 20) rep.maxLean = Math.max(rep.maxLean, sm.lean);
      if (phase === "down" && k > rep.minKnee + cfg.riseBy) phase = "up";
      if (k > cfg.topEnter) { out.event = finishRep(t); phase = "top"; topPeak = k; topEdgeT = t; }
    }
    out.phase = phase; out.count = count;
    out.live = rep ? { lean: sm.lean > cfg.leanMax && k < cfg.topLeave - 20, heels: heel > cfg.heelMax } : null;
    return out;
  }

  return { update, reset, get count() { return count; }, get phase() { return phase; }, cfg };
}
