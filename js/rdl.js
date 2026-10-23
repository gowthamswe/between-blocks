// Romanian deadlift (dumbbells) from MediaPipe pose landmarks, filmed side-on.
// Pure logic: no DOM, no camera. Same shape as the other analyzers.
//
// Per frame it measures, on the side facing the camera:
//   hinge - torso angle from vertical, hip to shoulder (0 = standing tall, ~70-90 = full hinge). Drives the reps.
//   knee  - knee angle, hip-knee-ankle. An RDL keeps soft knees (~150-170); much less turns it into a squat.
//   drift - how far the wrists (the dumbbells) sit in front of the middle of the foot, in shin lengths.
//           The weights should slide down the thighs and stay over the feet.
// Per rep: deepest hinge, least knee angle, worst drift, lowering time, faults, score.
// What the side view can't judge: a rounded back. Shoulder and hip are the only torso points it has.

export const LM = {
  nose: 0,
  l: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  r: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};

export const DEFAULTS = {
  topEnter: 20,       // torso within 20° of vertical = standing tall
  topLeave: 30,       // hinging past this starts the lowering phase
  countMin: 35,       // the deepest hinge must reach this or the rep doesn't count
  goodHinge: 45,      // hinge at least this far = reached the hamstring stretch
  riseBy: 12,         // torso must come up this far from its deepest point to start standing
  kneeMin: 135,       // knees bending past this = squatting the weight instead of hinging
  driftMax: 0.6,      // wrists more than 0.6 shin lengths in front of the mid-foot = weights drifting away
  minLowerMs: 1000,   // lowering faster than this = rushing (plan: "hips back · 2 sec")
  minVis: 0.5,
  invalidAbortMs: 600,
  smooth: 0.45,
};

export const PENALTY = { squat: 20, drift: 15, shallow: 20, fast: 10 };

function angleDeg(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (!n1 || !n2) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function pickSide(lm) {
  const score = (side) => ["shoulder", "hip", "knee", "ankle", "wrist"].reduce((acc, k) => acc + (lm[LM[side][k]]?.visibility ?? 0), 0);
  return score("l") >= score("r") ? "l" : "r";
}

export function measure(lm, size, cfg = DEFAULTS) {
  if (!lm || lm.length < 33) return { valid: false, reason: "nobody" };
  const side = pickSide(lm);
  const ids = LM[side];
  const px = (i) => ({ x: lm[i].x * size.width, y: lm[i].y * size.height, v: lm[i].visibility ?? 1 });
  const S = px(ids.shoulder), H = px(ids.hip), K = px(ids.knee), A = px(ids.ankle), W = px(ids.wrist), Hl = px(ids.heel), T = px(ids.toe);
  if ([S, H, K, A].some((p) => p.v < cfg.minVis)) return { valid: false, reason: "not-visible", side };
  // on your feet: hips above knees above ankles, shoulders not below the hips
  if (!(H.y < K.y && K.y < A.y) || S.y > H.y + 0.15 * Math.hypot(K.x - A.x, K.y - A.y)) return { valid: false, reason: "not-standing", side };
  const hinge = (Math.atan2(Math.abs(S.x - H.x), H.y - S.y) * 180) / Math.PI;
  const knee = angleDeg(H, K, A);
  const shin = Math.hypot(K.x - A.x, K.y - A.y);
  if (!Number.isFinite(knee) || !shin) return { valid: false, reason: "bad-geometry", side };
  // facing direction: toes ahead of heel; else the way the shoulders lean
  const feet = Hl.v >= cfg.minVis && T.v >= cfg.minVis;
  const facing = feet ? Math.sign(T.x - Hl.x) || 1 : Math.sign(S.x - H.x) || 1;
  const mid = feet ? (Hl.x + T.x) / 2 : A.x + facing * 0.15 * shin;
  const drift = W.v >= cfg.minVis ? ((W.x - mid) * facing) / shin : null;
  return { valid: true, side, hinge, knee, drift, shin, pts: { S, H, K, A, W } };
}

export function scoreRep(faults) {
  return Math.max(0, 100 - faults.reduce((s, f) => s + (PENALTY[f] || 0), 0));
}

export function createRdlAnalyzer(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let phase = "idle";        // idle -> top -> down -> up -> top ...
  let rep = null, count = 0, sm = null, lastValidT = null, topLow = 90, topEdgeT = null;

  function reset() { phase = "idle"; rep = null; count = 0; sm = null; lastValidT = null; topLow = 90; topEdgeT = null; }

  function finishRep(t) {
    const r = rep; rep = null;
    if (r.maxHinge < cfg.countMin) return { type: "half", maxHinge: Math.round(r.maxHinge), t };
    count += 1;
    const lowerMs = r.tMax - r.tStart;
    const faults = [];
    if (r.minKnee < cfg.kneeMin) faults.push("squat");
    if (r.maxDrift > cfg.driftMax) faults.push("drift");
    if (r.maxHinge < cfg.goodHinge) faults.push("shallow");
    if (lowerMs < cfg.minLowerMs) faults.push("fast");
    return {
      type: "rep", n: count, t,
      maxHinge: Math.round(r.maxHinge), depth: Math.round(r.maxHinge), minKnee: Math.round(r.minKnee),
      maxDrift: +r.maxDrift.toFixed(2), lowerMs: Math.round(lowerMs), upMs: Math.round(t - r.tMax),
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
    const drift = m.drift ?? (sm ? sm.drift : 0);
    sm = sm ? { hinge: a * sm.hinge + (1 - a) * m.hinge, knee: a * sm.knee + (1 - a) * m.knee, drift: a * sm.drift + (1 - a) * drift }
      : { hinge: m.hinge, knee: m.knee, drift };
    const h = sm.hinge;
    out.hinge = h; out.knee = sm.knee; out.drift = sm.drift;

    if (phase === "idle") {
      if (h < cfg.topEnter) { phase = "top"; topLow = h; topEdgeT = t; }
    } else if (phase === "top") {
      if (h < topLow) topLow = h;
      if (h <= topLow + 5) topEdgeT = t;
      if (h > cfg.topLeave) { phase = "down"; rep = { tStart: topEdgeT ?? t, maxHinge: h, tMax: t, minKnee: sm.knee, maxDrift: m.drift != null ? sm.drift : 0 }; }
    } else if (phase === "down" || phase === "up") {
      if (h > rep.maxHinge) { rep.maxHinge = h; rep.tMax = t; if (phase === "up") phase = "down"; }
      rep.minKnee = Math.min(rep.minKnee, sm.knee);
      if (m.drift != null) rep.maxDrift = Math.max(rep.maxDrift, sm.drift);
      if (phase === "down" && h < rep.maxHinge - cfg.riseBy) phase = "up";
      if (h < cfg.topEnter) { out.event = finishRep(t); phase = "top"; topLow = h; topEdgeT = t; }
    }
    out.phase = phase; out.count = count;
    out.live = rep ? { squat: sm.knee < cfg.kneeMin, drift: m.drift != null && sm.drift > cfg.driftMax } : null;
    return out;
  }

  return { update, reset, get count() { return count; }, get phase() { return phase; }, cfg };
}
