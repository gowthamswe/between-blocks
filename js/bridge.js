// Glute bridge analysis from MediaPipe pose landmarks, filmed side-on, lying on your back.
// Pure logic: no DOM, no camera. Same shape as the push-up and squat analyzers.
//
// Per frame it measures, on the side facing the camera:
//   ext  - hip extension: the shoulder-hip-knee angle, signed. 180 = shoulders, hips and knees in one line;
//          below 180 = hips under that line (on the floor ~130); above 180 = hips pushed past it (arching).
// A rep: hips rise from the floor, hold at the top, lower back down. It's counted when the hips are back down,
// so the hold and the lowering can be judged. Per rep: peak extension, hold time, lowering time, faults, score.
// While holding, it emits one "held" event when the plan's squeeze time is reached, so the coach can say "down".

export const LM = {
  nose: 0,
  l: { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  r: { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};

export const DEFAULTS = {
  downEnter: 145,     // hips below this = back on the floor (rep ends here)
  upLeave: 150,       // rising past this starts a rep
  countMin: 160,      // the top must reach this or the rep doesn't count
  goodTop: 170,       // full extension: shoulders, hips and knees nearly in line
  archMax: 192,       // pushed more than 12° past the line = arching the lower back
  holdBand: 6,        // within this many degrees of the peak counts as holding
  holdMs: 1000,       // squeeze at the top for at least this long (plan: 1 s, or "3-second squeeze")
  holdSlackMs: 300,   // a hold this much short of the target still passes
  minLowerMs: 500,    // timed from the end of the squeeze to passing downEnter (about 2/3 of the way down),
                      // so 0.5 s here is dropping the whole way in about 0.75 s
  minVis: 0.5,
  maxTorsoDeg: 50,    // shoulder-to-hip line steeper than this = not lying down
  invalidAbortMs: 600,
  smooth: 0.45,
};

export const PENALTY = { low: 20, hold: 15, arch: 15, fast: 10 };

function angleDeg(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (!n1 || !n2) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Is the hip above (true) or below the shoulder-knee line? Image y grows downward.
function hipAboveLine(S, H, K) {
  const dx = K.x - S.x;
  if (!dx) return false;
  const lineY = S.y + ((H.x - S.x) / dx) * (K.y - S.y);
  return H.y < lineY;
}

export function pickSide(lm) {
  const score = (side) => ["shoulder", "hip", "knee", "ankle"].reduce((acc, k) => acc + (lm[LM[side][k]]?.visibility ?? 0), 0);
  return score("l") >= score("r") ? "l" : "r";
}

export function measure(lm, size, cfg = DEFAULTS) {
  if (!lm || lm.length < 29) return { valid: false, reason: "nobody" };
  const side = pickSide(lm);
  const ids = LM[side];
  const px = (i) => ({ x: lm[i].x * size.width, y: lm[i].y * size.height, v: lm[i].visibility ?? 1 });
  const S = px(ids.shoulder), H = px(ids.hip), K = px(ids.knee), A = px(ids.ankle);
  if ([S, H, K, A].some((p) => p.v < cfg.minVis)) return { valid: false, reason: "not-visible", side };
  // lying on your back, knees bent: shoulders and hips low and roughly level, knees above the feet
  const torso = Math.abs((Math.atan2(S.y - H.y, Math.abs(S.x - H.x)) * 180) / Math.PI);
  if (torso > cfg.maxTorsoDeg || !(K.y < A.y) || Math.sign(K.x - S.x) !== Math.sign(A.x - S.x)) return { valid: false, reason: "not-lying", side };
  const a = angleDeg(S, H, K);
  if (!Number.isFinite(a)) return { valid: false, reason: "bad-geometry", side };
  const ext = hipAboveLine(S, H, K) ? 360 - a : a;
  return { valid: true, side, ext, pts: { S, H, K, A } };
}

export function scoreRep(faults) {
  return Math.max(0, 100 - faults.reduce((s, f) => s + (PENALTY[f] || 0), 0));
}

export function createBridgeAnalyzer(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let phase = "idle";        // idle -> down -> up -> down ...
  let rep = null, count = 0, sm = null, lastValidT = null, lastT = null;

  function reset() { phase = "idle"; rep = null; count = 0; sm = null; lastValidT = null; lastT = null; }

  function finishRep(t) {
    const r = rep; rep = null;
    if (r.peak < cfg.countMin) return { type: "half", peak: Math.round(r.peak), t };
    count += 1;
    const lowerMs = t - r.tHoldEnd;
    const faults = [];
    if (r.peak < cfg.goodTop) faults.push("low");
    if (r.peak > cfg.archMax) faults.push("arch");
    if (r.holdMs < cfg.holdMs - cfg.holdSlackMs) faults.push("hold");
    if (lowerMs < cfg.minLowerMs) faults.push("fast");
    return {
      type: "rep", n: count, t,
      peak: Math.round(r.peak), depth: Math.round(r.peak), holdMs: Math.round(r.holdMs),
      upMs: Math.round(r.tPeak - r.tStart), lowerMs: Math.round(lowerMs),
      faults, score: scoreRep(faults),
    };
  }

  function update(landmarks, t, size) {
    const m = measure(landmarks, size, cfg);
    const out = { ...m, phase, count, event: null };
    const dt = lastT == null ? 0 : t - lastT; lastT = t;
    if (!m.valid) {
      sm = null;
      if (lastValidT != null && t - lastValidT > cfg.invalidAbortMs) { rep = null; phase = "idle"; }
      out.phase = phase;
      return out;
    }
    lastValidT = t;
    sm = sm == null ? m.ext : cfg.smooth * sm + (1 - cfg.smooth) * m.ext;
    const e = sm;
    out.ext = e;

    if (phase === "idle") {
      if (e < cfg.downEnter) phase = "down";
    } else if (phase === "down") {
      if (e > cfg.upLeave) { phase = "up"; rep = { tStart: t, peak: e, tPeak: t, holdRef: null, holdNow: 0, holdMs: 0, tHoldEnd: t, held: false }; }
    } else if (phase === "up") {
      if (e > rep.peak) { rep.peak = e; rep.tPeak = t; }
      // The hold is time spent near one height at the top. Still climbing past where the hold
      // started restarts it, so a slow rise doesn't count as a squeeze.
      if (e >= cfg.countMin) {
        if (rep.holdRef == null || e > rep.holdRef + cfg.holdBand) { rep.holdRef = e; rep.holdNow = 0; }
        else if (e >= rep.holdRef - cfg.holdBand) { rep.holdNow += dt; rep.tHoldEnd = t; }
        rep.holdMs = Math.max(rep.holdMs, rep.holdNow);
        if (!rep.held && rep.holdNow >= cfg.holdMs) { rep.held = true; out.event = { type: "held", holdMs: Math.round(rep.holdNow), t }; }
      }
      if (e < cfg.downEnter) { out.event = finishRep(t); phase = "down"; }
    }
    out.phase = phase; out.count = count;
    out.live = rep ? { arch: e > cfg.archMax, holding: rep.holdRef != null && e >= rep.holdRef - cfg.holdBand, holdMs: rep.holdNow } : null;
    return out;
  }

  return { update, reset, get count() { return count; }, get phase() { return phase; }, cfg };
}

// "3-second squeeze at the top" in the plan note -> hold for 3 s
export function holdFromNote(note) {
  const m = /(\d+(?:\.\d+)?)[- ]?(?:second|sec|s)\b[^.;]*?(?:squeeze|hold|pause)/i.exec(note || "");
  return m ? Math.round(Number(m[1]) * 1000) : null;
}
