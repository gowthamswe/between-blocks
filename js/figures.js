// Exercise pictures, ported from the Between Blocks app: real photos (start/end, crossfading),
// animated figures for every exercise (side view on the floor, front view on his power tower),
// a "seen from above" grip map for bar work, and a YouTube demo search.
// makeFigure(ex, still) returns { svg, tick(now) | null }; the caller runs tick on animation frames.

const SVGNS = "http://www.w3.org/2000/svg";
function sv(name, attrs) { const e = document.createElementNS(SVGNS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function mv(pose, dx, dy, only) { const r = {}; for (const k in pose) r[k] = (!only || only.includes(k)) ? [pose[k][0] + dx, pose[k][1] + dy] : pose[k].slice(); return r; }
function ov(pose, o) { const r = {}; for (const k in pose) r[k] = pose[k].slice(); for (const j in o) r[j] = o[j]; return r; }
const F = (base, o) => ({ ...base, ...o });

/* real photos (Free Exercise DB, public domain), keyed by exercise: [start, end] labels */
export const PHOTOS = {
  pushup: ["Top", "Bottom"], pushup_he: ["Top", "Bottom"], bw_squat: ["Stand", "Bottom"], goblet: ["Stand", "Bottom"],
  db_curl: ["Arms long", "Curled"], db_ohp: ["At shoulders", "Overhead"], db_rdl: ["Stand", "Hinged"], db_row: ["Arm long", "Pulled"],
  glute_br: ["Down", "Hips up"], knee_raise: ["Hang", "Knees up"], pullup: ["Hang", "Top"], pullup_b: ["Hang", "Top"], scap_pull: ["Hang", "Shoulders down"],
};
export const photoSrc = (ex, i) => `photos/${ex.replace(/_/g, "-")}-${i}.jpg`;

/* which drawing each exercise uses, and what to search for on YouTube */
const FIG_OF = { hang: "hang", scap_pull: "scap", pullup_neg: "neg", pullup_b: "pullup_b", pullup: "pullup", knee_raise: "knee",
  pushup: "pushup", pushup_he: "pushup", bw_squat: "squat", goblet: "goblet", glute_br: "bridge", sl_bridge: "bridge", hollow: "hollow",
  db_curl: "curl", db_ohp: "ohp", db_row: "row", db_rdl: "rdl", farmer: "carry" };
const YT = { hang: "dead hang beginner form", scap_pull: "scapular pull up beginner", pullup_neg: "pull up negatives beginner",
  pullup_b: "band assisted pull up form", pullup: "neutral grip pull up form", knee_raise: "hanging knee raise beginner form",
  pushup: "push up proper form beginner", pushup_he: "incline push up form", bw_squat: "bodyweight squat proper form",
  goblet: "goblet squat dumbbell form", glute_br: "glute bridge proper form", sl_bridge: "single leg glute bridge form",
  hollow: "hollow body hold beginner", db_curl: "dumbbell bicep curl form", db_ohp: "standing dumbbell overhead press form",
  db_row: "one arm dumbbell row bench form", db_rdl: "dumbbell romanian deadlift form", farmer: "dumbbell farmers walk form" };
export const BAR_EX = { hang: 1, scap_pull: 1, pullup_neg: 1, pullup_b: 1, pullup: 1, knee_raise: 1 };
export const hasFigure = (ex) => !!FIG_OF[ex];
export const ytUrl = (ex, name) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(YT[ex] || `${name || ex} proper form`);

/* standing, facing right, floor at y=205 */
const ST = { H:[121,36], N:[119,49], S:[118,58], E:[117,88], W:[119,114], P:[116,112], K:[118,156], A:[120,200], T:[134,205] };
/* bar exercises are drawn FROM THE FRONT (right side only; mirrored about x=120), bar at y=22 */
const HG = { H:[120,72], N:[120,86], S:[140,90], E:[146,58], W:[150,26], P:[131,146], K:[132,190], A:[131,232], T:[131,240] };
const PU_TOP = { H:[120,6], N:[120,20], S:[140,28], E:[164,50], W:[150,26], P:[131,84], K:[132,128], A:[131,170], T:[131,178] };
const KR_TOP = ov(HG, { P:[131,142], K:[150,150], A:[141,193], T:[141,201] });
const SQ_BOT = { H:[146,104], N:[139,115], S:[135,124], E:[158,122], W:[184,120], P:[104,168], K:[148,170], A:[120,200], T:[134,205] };
const BAR = { front: true, vb: "-6 -14 252 296", bar: 22, floor: 256 };
const FLOOR = { prop: "floor", vb: "16 14 208 200", floor: 205 };
const REP = [[0, 0], [0.12, 0], [0.45, 1], [0.55, 1], [0.92, 0], [1, 0]];        /* lift ~1.3s, hold, lower ~1.5s */
const SLOW_DOWN = [[0, 0], [0.12, 0], [0.55, 1], [0.64, 1], [0.92, 0], [1, 0]];  /* lower 2s, pause, up */

const FIGS = {
  pushup: {
    vb: "14 62 222 124", floor: 171, prop: "floor", hand: [9, 3], ghost: true,
    a: { H:[211,99],  N:[198,107], S:[190,113], E:[191,140], W:[192,166], P:[132,134], K:[90,148], A:[46,162], T:[34,169] },
    b: { H:[207,138], N:[195,143], S:[186,147], E:[169,148], W:[192,166], P:[132,153], K:[90,157], A:[46,162], T:[34,169] },
    far: [6, -3], keys: SLOW_DOWN, period: 4200,
    phases: [[0.12, "Top · arms straight"], [0.55, "Lower · 2 sec"], [0.64, "Chest near floor"], [0.92, "Push up"], [1.01, "Top · arms straight"]],
    guide: ["A", "S"], guideLabel: "one straight line", lab: [20, 80],
  },
  squat: F(FLOOR, {
    ghost: true, a: ST, b: SQ_BOT, keys: SLOW_DOWN, period: 4200,
    phases: [[0.12, "Stand tall"], [0.55, "Sit down · 2 sec"], [0.64, "Thighs level"], [0.92, "Stand up"], [1.01, "Stand tall"]],
    guide: ["K", "T"], guideLabel: "knees over toes", guideOff: [30, 4],
  }),
  goblet: F(FLOOR, {
    ghost: true, goblet: true, a: ov(ST, { E:[126,90], W:[134,72] }), b: ov(SQ_BOT, { E:[146,150], W:[156,128] }),
    keys: SLOW_DOWN, period: 4200,
    phases: [[0.12, "Stand tall"], [0.55, "Sit down · 2 sec"], [0.64, "Elbows inside knees"], [0.92, "Drive up"], [1.01, "Stand tall"]],
    guide: ["P", "S"], guideLabel: "chest tall", guideOff: [-34, 0],
  }),
  ohp: F(FLOOR, {
    vb: "16 -26 208 240", ghost: true, db: true, lab: [22, -8], guideShift: [-20, 0],
    a: ov(ST, { E:[126,84], W:[128,58] }), b: ov(ST, { E:[122,30], W:[121,4] }), keys: REP, period: 3600,
    phases: [[0.12, "At the shoulders"], [0.45, "Press up"], [0.55, "Arms locked out"], [0.92, "Lower to shoulders"], [1.01, "At the shoulders"]],
    guide: ["A", "S"], guideLabel: "no leaning back", guideOff: [-44, 10],
  }),
  rdl: F(FLOOR, {
    ghost: true, db: true, a: ov(ST, { E:[118,88], W:[120,114] }),
    b: { H:[170,90], N:[160,96], S:[151,100], E:[151,130], W:[151,156], P:[100,118], K:[124,158], A:[120,200], T:[134,205] },
    keys: [[0, 0], [0.1, 0], [0.55, 1], [0.64, 1], [0.92, 0], [1, 0]], period: 4600,
    phases: [[0.1, "Stand tall"], [0.55, "Hips back · 2 sec"], [0.64, "Hamstring stretch"], [0.92, "Squeeze up"], [1.01, "Stand tall"]],
    guide: ["P", "S"], guideLabel: "flat back", guideOff: [-14, -30],
  }),
  row: F(FLOOR, {
    ghost: true, db: true, dbNearOnly: true, bench: [60, 150, 118, 9],
    a: { H:[180,104], N:[168,109], S:[158,112], E:[158,140], W:[158,166], P:[104,116], K:[96,158], A:[92,200], T:[106,205],
         fE:[160,131], fW:[162,148], fK:[110,146], fA:[68,146], fT:[58,146] },
    b: { H:[180,104], N:[168,109], S:[158,112], E:[131,102], W:[136,129], P:[104,116], K:[96,158], A:[92,200], T:[106,205],
         fE:[160,131], fW:[162,148], fK:[110,146], fA:[68,146], fT:[58,146] },
    keys: REP, period: 3600,
    phases: [[0.12, "Arm long"], [0.45, "Pull to hip"], [0.55, "Squeeze"], [0.92, "Lower · full stretch"], [1.01, "Arm long"]],
    guide: ["P", "S"], guideLabel: "flat back", guideOff: [0, -30], lab: [22, 40],
  }),
  curl: F(FLOOR, {
    ghost: true, db: true, a: ST, b: ov(ST, { W:[139,70] }), keys: REP, period: 3600,
    phases: [[0.12, "Arms long"], [0.45, "Curl up"], [0.55, "Squeeze"], [0.92, "Lower · 2 sec"], [1.01, "Arms long"]],
    guide: ["S", "E"], guideLabel: "elbows pinned", guideOff: [-46, 30], guideShift: [-16, 0],
  }),
  carry: F(FLOOR, {
    db: true,
    a: ov(ST, { W:[118,116], K:[124,156], A:[132,200], T:[146,205], fK:[116,155], fA:[110,198], fT:[124,203] }),
    b: ov(ST, { W:[118,116], K:[116,156], A:[110,200], T:[124,205], fK:[127,155], fA:[135,198], fT:[149,203] }),
    keys: [[0, 0], [0.5, 1], [1, 0]], period: 1500,
    phases: [[0.5, "Walk · stand tall"], [1.01, "Grip tight"]],
    guide: ["A", "S"], guideLabel: "stand tall", guideOff: [-40, 10], guideShift: [-22, 0],
  }),
  bridge: {
    vb: "14 96 212 104", floor: 190, prop: "floor", ghost: true, far: [5, -2],
    a: { H:[42,176], N:[55,177], S:[64,178], E:[90,184], W:[114,185], P:[118,178], K:[152,143], A:[170,184], T:[184,188] },
    b: { H:[42,176], N:[55,177], S:[64,178], E:[90,184], W:[114,185], P:[114,159], K:[156,140], A:[170,184], T:[184,188] },
    keys: [[0, 0], [0.1, 0], [0.4, 1], [0.62, 1], [0.92, 0], [1, 0]], period: 4000,
    phases: [[0.1, "Feet flat"], [0.4, "Push through heels"], [0.62, "Squeeze · hold 1 sec"], [0.92, "Lower slowly"], [1.01, "Feet flat"]],
    guide: ["S", "K"], guideLabel: "shoulders to knees", guideOff: [-6, -16], lab: [20, 112],
  },
  hollow: {
    vb: "14 96 218 104", floor: 190, prop: "floor", far: [5, -2],
    a: { H:[62,166], N:[72,171], S:[80,174], E:[56,160], W:[32,148], P:[130,178], K:[170,168], A:[208,158], T:[222,154] },
    b: { H:[63,163], N:[73,169], S:[81,173], E:[57,157], W:[33,144], P:[130,178], K:[170,166], A:[208,155], T:[222,151] },
    keys: [[0, 0], [0.5, 1], [1, 0]], period: 4000,
    phases: [[0.5, "Hold · low back flat"], [1.01, "Breathe"]],
    guide: ["S", "P"], guideLabel: "low back pressed down", guideOff: [0, 22], lab: [20, 112],
  },
  hang: F(BAR, { a: HG, b: mv(HG, 0, 2, ["P", "K", "A", "T"]), keys: [[0, 0], [0.5, 1], [1, 0]], period: 4000,
    phases: [[0.5, "Hold · grip tight"], [1.01, "Legs still, breathe"]] }),
  scap: F(BAR, {
    a: HG, b: ov(mv(HG, 0, -9, ["H", "N", "S", "P", "K", "A", "T"]), { E:[146,52] }),
    keys: [[0, 0], [0.12, 0], [0.4, 1], [0.6, 1], [0.92, 0], [1, 0]], period: 3600,
    phases: [[0.12, "Dead hang"], [0.4, "Shoulders down"], [0.6, "Hold 1 sec"], [0.92, "Lower slowly"], [1.01, "Dead hang"]],
    guide: ["S", "W"], guideLabel: "elbows stay straight", guideOff: [48, 30],
  }),
  pullup: F(BAR, { a: HG, b: PU_TOP, keys: REP, period: 3800,
    phases: [[0.12, "Arms straight"], [0.45, "Pull · chest up"], [0.55, "Chin over bar"], [0.92, "Lower · 2 sec"], [1.01, "Arms straight"]] }),
  pullup_b: F(BAR, { band: true, a: HG, b: PU_TOP, keys: REP, period: 3800,
    phases: [[0.12, "Arms straight"], [0.45, "Pull · chest up"], [0.55, "Chin over bar"], [0.92, "Lower · 2 sec"], [1.01, "Arms straight"]] }),
  neg: F(BAR, { a: PU_TOP, b: HG, period: 7000, keys: [[0, 0], [0.1, 0], [0.8, 1], [0.9, 1], [1, 0]],
    phases: [[0.1, "Chin over bar"], [0.8, "Lower · 5 sec"], [0.9, "Arms straight"], [1.01, "Step back up"]] }),
  knee: F(BAR, { a: HG, b: KR_TOP, keys: REP, period: 3800,
    phases: [[0.12, "Dead hang"], [0.45, "Knees up"], [0.55, "Hip height"], [0.92, "Lower slowly"], [1.01, "Dead hang"]] }),
};

const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
function timeline(f) {
  const at = (t) => {
    const k = f.keys;
    for (let i = 1; i < k.length; i++) if (t <= k[i][0]) { const s = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0] || 1); return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * ease(s); }
    return k[k.length - 1][1];
  };
  const phaseAt = (t) => { for (const [end, lab] of f.phases) if (t < end) return lab; return ""; };
  return { at, phaseAt };
}
const lerpPose = (f) => (u) => { const r = {}; for (const k in f.a) r[k] = [f.a[k][0] + (f.b[k][0] - f.a[k][0]) * u, f.a[k][1] + (f.b[k][1] - f.a[k][1]) * u]; return r; };
function L(el, a, b) { if (!el) return; el.setAttribute("x1", a[0].toFixed(1)); el.setAttribute("y1", a[1].toFixed(1)); el.setAttribute("x2", b[0].toFixed(1)); el.setAttribute("y2", b[1].toFixed(1)); }

/* bar work, from the front, on his power tower: two uprights, a lower cross brace, dip pads with handle posts */
function makeFront(f, still) {
  const svg = sv("svg", { viewBox: f.vb, "aria-hidden": "true" });
  const m = (p) => [240 - p[0], p[1]];
  const lerp = lerpPose(f);
  svg.appendChild(sv("ellipse", { cx: 120, cy: f.floor + 4, rx: 92, ry: 5, class: "shadow" }));
  svg.appendChild(sv("line", { x1: 0, y1: f.floor, x2: 240, y2: f.floor, "stroke-width": 3, class: "prop" }));
  const dipY = f.floor - 140;
  svg.appendChild(sv("line", { x1: 40, y1: f.floor - 52, x2: 200, y2: f.floor - 52, "stroke-width": 6, class: "prop" }));
  [40, 200].forEach((x) => {
    const inward = x < 120 ? 1 : -1;
    svg.appendChild(sv("line", { x1: x, y1: f.bar - 4, x2: x, y2: f.floor, "stroke-width": 6, class: "prop" }));
    svg.appendChild(sv("line", { x1: x - 18, y1: f.floor - 2, x2: x + 18, y2: f.floor - 2, "stroke-width": 6, class: "prop" }));
    svg.appendChild(sv("rect", { x: inward > 0 ? x - 10 : x - 22, y: dipY, width: 32, height: 8, rx: 3, class: "bench" }));
    svg.appendChild(sv("line", { x1: x + inward * 26, y1: dipY + 4, x2: x + inward * 26, y2: dipY - 12, "stroke-width": 4, class: "prop" }));
    svg.appendChild(sv("path", { d: `M${x + inward * 9} ${f.bar + 3} v7 a3 3 0 0 0 ${inward * 6} 0`, "stroke-width": 2, fill: "none", class: "prop" }));
  });
  const g = sv("g", { class: "figure" }), P = {};
  const seg = (name, w, cls) => { const l = sv("line", { "stroke-width": w, class: "seg " + (cls || "") }); P[name] = l; g.appendChild(l); };
  ["L", "R"].forEach((sd) => { seg("thigh" + sd, 16); seg("shin" + sd, 12); seg("foot" + sd, 9); });
  const torso = sv("polygon", { class: "torso-fill", "stroke-linejoin": "round", "stroke-width": 8 }); g.appendChild(torso);
  seg("neck", 10);
  const head = sv("circle", { r: 13, class: "headc" }); g.appendChild(head);
  ["L", "R"].forEach((sd) => { seg("upper" + sd, 12); seg("fore" + sd, 10); });
  let band = null;
  if (f.band) { band = sv("polyline", { class: "band", "stroke-width": 3.5, fill: "none", "stroke-linejoin": "round" }); g.appendChild(band); }
  svg.appendChild(g);
  /* top: long front bar with bent foam ends; the two middle handles run front-to-back, so from the front they show end-on */
  svg.appendChild(sv("line", { x1: 12, y1: f.bar, x2: 228, y2: f.bar, "stroke-width": 7, class: "prop" }));
  svg.appendChild(sv("line", { x1: 12, y1: f.bar, x2: 0, y2: f.bar + 10, "stroke-width": 10, class: "prop" }));
  svg.appendChild(sv("line", { x1: 228, y1: f.bar, x2: 240, y2: f.bar + 10, "stroke-width": 10, class: "prop" }));
  [90, 150].forEach((x) => svg.appendChild(sv("circle", { cx: x, cy: f.bar, r: 6, class: "bench" })));
  const hands = [sv("circle", { r: 6.5, class: "hand" }), sv("circle", { r: 6.5, class: "hand" })];
  hands.forEach((h) => svg.appendChild(h));
  if (!still) { const hl = sv("text", { x: 164, y: f.bar - 12, class: "guide-lab hand-lab" }); hl.textContent = "middle handles"; svg.appendChild(hl); }
  let gl = null, guide = null;
  if (!still && f.guide) {
    guide = sv("line", { class: "guide", "stroke-width": 2, "stroke-dasharray": "4 6", "stroke-linecap": "round" }); svg.appendChild(guide);
    gl = sv("text", { class: "guide-lab", "text-anchor": "middle" }); gl.textContent = f.guideLabel; svg.appendChild(gl);
  }
  let phase = null;
  if (!still) { phase = sv("text", { x: 120, y: f.floor + 24, class: "phase", "text-anchor": "middle" }); svg.appendChild(phase); }
  function place(q) {
    const sides = { R: (p) => p, L: m };
    for (const sd in sides) {
      const t = sides[sd];
      L(P["thigh" + sd], t(q.P), t(q.K)); L(P["shin" + sd], t(q.K), t(q.A)); L(P["foot" + sd], t(q.A), t(q.T));
      L(P["upper" + sd], t(q.S), t(q.E)); L(P["fore" + sd], t(q.E), t(q.W));
    }
    const sr = q.S, pr = [q.P[0] + 3, q.P[1] + 4];
    torso.setAttribute("points", [sr, [sr[0] - 3, sr[1] + 26], pr, m(pr), [240 - sr[0] + 3, sr[1] + 26], m(sr)].map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "));
    L(P.neck, q.N, [q.N[0], q.S[1] + 2]);
    head.setAttribute("cx", q.H[0].toFixed(1)); head.setAttribute("cy", q.H[1].toFixed(1));
    hands[0].setAttribute("cx", q.W[0]); hands[0].setAttribute("cy", q.W[1] - 1);
    hands[1].setAttribute("cx", 240 - q.W[0]); hands[1].setAttribute("cy", q.W[1] - 1);
    if (band) band.setAttribute("points", `112,${f.bar} 120,${(q.K[1] + 4).toFixed(1)} 128,${f.bar}`);
    if (guide) {
      const a = q[f.guide[0]], b = q[f.guide[1]];
      L(guide, [a[0] + 14, a[1] + 6], [b[0] + 14, b[1] - 4]);
      const go = f.guideOff || [0, 0];
      gl.setAttribute("x", ((a[0] + b[0]) / 2 + go[0]).toFixed(1)); gl.setAttribute("y", ((a[1] + b[1]) / 2 + go[1]).toFixed(1));
    }
  }
  if (still) { place(lerp(f.still != null ? f.still : 0.4)); return { svg, tick: null }; }
  const { at, phaseAt } = timeline(f);
  place(lerp(0)); phase.textContent = f.phases[0][1];
  return { svg, tick: (now) => { const t = (now % f.period) / f.period; place(lerp(at(t))); phase.textContent = phaseAt(t); } };
}

/* everything else, from the side: near limbs solid, far limbs muted, a ghost of the end position, a form guide line */
function makeSide(f, still) {
  const svg = sv("svg", { viewBox: f.vb, "aria-hidden": "true" });
  const vb = f.vb.split(" ").map(Number), far = f.far || [5, -2];
  const lerp = lerpPose(f);
  svg.appendChild(sv("ellipse", { cx: vb[0] + vb[2] / 2, cy: f.floor + 4, rx: vb[2] * 0.44, ry: 5, class: "shadow" }));
  svg.appendChild(sv("line", { x1: vb[0] - 4, y1: f.floor, x2: vb[0] + vb[2] + 4, y2: f.floor, "stroke-width": 3, class: "prop" }));
  if (f.bench) {
    const [bx, by, bw, bh] = f.bench;
    svg.appendChild(sv("rect", { x: bx, y: by, width: bw, height: bh, rx: 3, class: "bench" }));
    svg.appendChild(sv("rect", { x: bx + 10, y: by + bh, width: 6, height: f.floor - by - bh, class: "bench" }));
    svg.appendChild(sv("rect", { x: bx + bw - 16, y: by + bh, width: 6, height: f.floor - by - bh, class: "bench" }));
  }
  function body(cls, full) {
    const g = sv("g", { class: cls }), parts = {};
    const seg = (name, w, extra) => { const l = sv("line", { "stroke-width": w, class: "seg " + (extra || "") }); parts[name] = l; g.appendChild(l); };
    const dumb = (name) => { const r = sv("rect", { class: "db", rx: 3 }); parts[name] = r; g.appendChild(r); };
    if (full) {
      seg("fThigh", 15, "far"); seg("fShin", 11, "far"); seg("fFoot", 7, "far");
      if (f.db && !f.dbNearOnly) dumb("fDb");
      seg("fUpper", 11, "far"); seg("fFore", 9, "far"); if (f.hand) seg("fHand", 7, "far");
    }
    seg("thigh", 16); seg("shin", 12); seg("foot", 8);
    seg("torso", 23, "torso"); seg("neck", 9);
    const head = sv("circle", { r: 12, class: "headc" }); parts.head = head; g.appendChild(head);
    if (full && f.goblet) dumb("gDb");
    seg("upper", 12); seg("fore", 10); if (f.hand) seg("hand", 8);
    if (full && f.db) dumb("nDb");
    svg.appendChild(g);
    return parts;
  }
  function place(parts, pose) {
    const o = (p) => [p[0] + far[0], p[1] + far[1]];
    const fp = (k) => pose["f" + k] || o(pose[k]);
    const DB = (el, c, vert) => {
      if (!el) return;
      const w = vert ? 12 : 28, h = vert ? 26 : 12;
      el.setAttribute("x", (c[0] - w / 2).toFixed(1)); el.setAttribute("y", (c[1] - h / 2).toFixed(1)); el.setAttribute("width", w); el.setAttribute("height", h);
    };
    const hd = f.hand || [0, 0];
    const fS = o(pose.S), fP = o(pose.P), fK = fp("K"), fA = fp("A"), fT = fp("T"), fE = fp("E"), fW = fp("W");
    L(parts.fThigh, fP, fK); L(parts.fShin, fK, fA); L(parts.fFoot, fA, fT);
    L(parts.fUpper, fS, fE); L(parts.fFore, fE, fW); L(parts.fHand, fW, [fW[0] + hd[0], fW[1] + hd[1]]);
    L(parts.thigh, pose.P, pose.K); L(parts.shin, pose.K, pose.A); L(parts.foot, pose.A, pose.T);
    L(parts.torso, pose.S, pose.P); L(parts.neck, pose.N, pose.S);
    parts.head.setAttribute("cx", pose.H[0].toFixed(1)); parts.head.setAttribute("cy", pose.H[1].toFixed(1));
    L(parts.upper, pose.S, pose.E); L(parts.fore, pose.E, pose.W); L(parts.hand, pose.W, [pose.W[0] + hd[0], pose.W[1] + hd[1]]);
    DB(parts.nDb, pose.W, false); DB(parts.fDb, fW, false);
    DB(parts.gDb, [pose.W[0] + 4, pose.W[1] + 2], true);
  }
  if (still) { place(body("figure", true), lerp(f.still != null ? f.still : 0.4)); return { svg, tick: null }; }
  if (f.ghost) place(body("ghost", false), f.b);
  let guide = null, glabel = null;
  if (f.guide) { guide = sv("line", { class: "guide", "stroke-width": 2, "stroke-dasharray": "4 6", "stroke-linecap": "round" }); svg.appendChild(guide); }
  const parts = body("figure", true);
  if (f.guide) { glabel = sv("text", { class: "guide-lab", "text-anchor": "middle" }); glabel.textContent = f.guideLabel; svg.appendChild(glabel); }
  const lab = f.lab || [vb[0] + 6, vb[1] + 16];
  const phase = sv("text", { x: lab[0], y: lab[1], class: "phase" }); svg.appendChild(phase);
  function draw(u, label) {
    const pose = lerp(u);
    place(parts, pose);
    if (guide) {
      const gs = f.guideShift || [0, 0];
      const g0 = [pose[f.guide[0]][0] + gs[0], pose[f.guide[0]][1] + gs[1]], g1 = [pose[f.guide[1]][0] + gs[0], pose[f.guide[1]][1] + gs[1]];
      const ext = 0.12;
      L(guide, [g0[0] - (g1[0] - g0[0]) * ext, g0[1] - (g1[1] - g0[1]) * ext], [g1[0] + (g1[0] - g0[0]) * ext, g1[1] + (g1[1] - g0[1]) * ext]);
      const go = f.guideOff || [-18, -22];
      glabel.setAttribute("x", ((g0[0] + g1[0]) / 2 + go[0]).toFixed(1)); glabel.setAttribute("y", ((g0[1] + g1[1]) / 2 + go[1]).toFixed(1));
    }
    if (label != null) phase.textContent = label;
  }
  const { at, phaseAt } = timeline(f);
  draw(0, f.phases[0][1]);
  return { svg, tick: (now) => { const t = (now % f.period) / f.period; draw(at(t), phaseAt(t)); } };
}

export function makeFigure(ex, still = false) {
  const f = FIGS[FIG_OF[ex]];
  if (!f) { const svg = sv("svg", { viewBox: "0 0 200 200", "aria-hidden": "true" }); return { svg, tick: null }; }
  return f.front ? makeFront(f, still) : makeSide(f, still);
}

/* top-down map of the tower's top: front bar (bent ends), rear bar between the uprights,
   two middle handles joining them. Hands go on the middle handles; the band loops on the front bar between them. */
export function gripMap(ex) {
  const box = document.createElement("div"); box.className = "grip-map";
  const s = sv("svg", { viewBox: "0 0 130 66", "aria-hidden": "true" });
  const t = (x, y, txt, cls) => { const e = sv("text", { x, y, class: "gm-txt " + (cls || ""), "text-anchor": "middle" }); e.textContent = txt; s.appendChild(e); };
  t(65, 8, "Seen from above");
  [[34, 22, 96, 22], [34, 22, 28, 42], [96, 22, 102, 42]].forEach(([x1, y1, x2, y2]) => s.appendChild(sv("line", { x1, y1, x2, y2, "stroke-width": 3, class: "gm-bar" })));
  s.appendChild(sv("line", { x1: 12, y1: 42, x2: 118, y2: 42, "stroke-width": 3.5, class: "gm-bar" }));
  s.appendChild(sv("line", { x1: 12, y1: 42, x2: 5, y2: 52, "stroke-width": 5, class: "gm-foam" }));
  s.appendChild(sv("line", { x1: 118, y1: 42, x2: 125, y2: 52, "stroke-width": 5, class: "gm-foam" }));
  [53, 77].forEach((x) => s.appendChild(sv("line", { x1: x, y1: 22, x2: x, y2: 42, "stroke-width": 3, class: "gm-bar" })));
  [34, 96].forEach((x) => s.appendChild(sv("rect", { x: x - 4, y: 18, width: 8, height: 8, rx: 1.5, class: "gm-post" })));
  [53, 77].forEach((x) => s.appendChild(sv("ellipse", { cx: x, cy: 32, rx: 3.6, ry: 6.5, class: "gm-hand" })));
  t(65, 18, "hands", "hot");
  if (ex === "pullup_b") { s.appendChild(sv("ellipse", { cx: 65, cy: 42, rx: 4, ry: 3.2, "stroke-width": 1.8, class: "gm-band" })); t(65, 52, "band", "go"); }
  t(65, 63, "front bar ↓ you", "");
  box.appendChild(s);
  const p = document.createElement("p");
  p.textContent = ex === "pullup_b" ? "Hands on the two middle handles, palms facing. Band looped on the front bar between them."
    : "Hands on the two middle handles, palms facing each other.";
  box.appendChild(p);
  return box;
}
