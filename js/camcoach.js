// The camera coach as a component: camera → pose model → exercise analysis → coach → voice, drawn into
// a box of its own (video, tracked skeleton, status, last rep, what the coach said). The plan screen puts
// this box where the exercise drawing goes; sets, rest and logging stay with the plan screen.
//
//   const cam = createCamCoach({ move, item, cues, onRep });
//   container.append(cam.el); await cam.start();
//   cam.beginSet(target)   → counts reps until endSet()
//   cam.endSet()           → the reps of that set (analyzer events), for coachSet()
//   cam.stop()             → camera off
import { createCoach } from "./coach.js";
import { createVoice } from "./voice.js";
import { createPose, isPhone } from "./pose.js";
import { shouldEndSet } from "./plan.js";
import { camShape } from "./moves.js";

const pref = (k, d) => { try { const v = localStorage.getItem("bbc." + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const POSE_MSG = { nobody: ["Can't see you", "warn"], "not-visible": ["Get your whole body in view", "warn"], "bad-geometry": ["Adjust the camera", "warn"] };

// One pose model and one voice for the page: switching exercises shouldn't reload either.
let poseP = null, voice = null;
const getPose = (onStatus) => (poseP = poseP || createPose(pref("model", "auto"), onStatus).catch((e) => { poseP = null; throw e; }));

export function createCamCoach({ move, item, cues, onRep = () => {}, onStatus = () => {}, onSetEnd = () => {} }) {
  voice = voice || createVoice();
  voice.enabled = pref("voice", true);
  const el = document.createElement("div"); el.className = "cam";
  el.innerHTML = `<video playsinline muted></video><canvas></canvas>
    <span class="cam-pill" data-tone="idle">Starting camera…</span>
    <div class="cam-last" hidden><b></b><span></span></div>
    <div class="cam-caption" aria-live="polite"></div>
    <div class="cam-hint" hidden></div>`;
  const video = el.querySelector("video"), canvas = el.querySelector("canvas"), g = canvas.getContext("2d");
  const pill = el.querySelector(".cam-pill"), last = el.querySelector(".cam-last"), caption = el.querySelector(".cam-caption");
  const analyzer = move.create(item);
  const coach = createCoach({ cues, target: item.reps || 0, countAloud: pref("count", true), coaching: move.coaching });
  let stream = null, pose = null, live = true, running = false, reps = [], lastValidT = null, setStartT = 0, wakeLock = null, announced = false;
  let ready = false, captionTimer = 0, target = 0, lastRepT = 0, invalidSince = null;

  const setPill = (text, tone = "idle") => { pill.textContent = text; pill.dataset.tone = tone; onStatus(text, tone); };
  function showCaption(text, kind) {
    caption.textContent = text; caption.dataset.kind = kind; caption.dataset.show = "1";
    clearTimeout(captionTimer); captionTimer = setTimeout(() => { caption.dataset.show = "0"; }, 2400);
  }
  const say = (list) => { voice.onSpeak = (u) => { if (u.kind !== "count" && el.isConnected) showCaption(u.text, u.kind); }; voice.say(list); };

  async function start() {
    voice.unlock();
    if (!navigator.mediaDevices?.getUserMedia) { setPill("This browser can't use the camera here", "warn"); throw new Error("no camera API"); }
    try {
      // ask for the picture in the screen's orientation: tall on an upright phone, wide otherwise
      // (some phones rotate a landscape request for you, some crop it to a square)
      const upright = innerHeight > innerWidth;
      const size = upright ? { width: { ideal: 720 }, height: { ideal: 1280 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, id = pref("camera", "");
      stream = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id }, ...size } : { facingMode: "user", ...size }, audio: false });
    } catch (e) {
      setPill(e && e.name === "NotAllowedError" ? "Camera blocked: allow it in site settings" : e && e.name === "NotFoundError" ? "No camera found" : "Couldn't start the camera", "warn");
      throw e;
    }
    if (!live) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => (video.videoWidth ? r() : video.addEventListener("loadedmetadata", r, { once: true })));
    const facing = stream.getVideoTracks()[0].getSettings().facingMode;
    el.dataset.mirror = (pref("mirror", null) ?? (facing ? facing === "user" : !isPhone())) ? "1" : "0";
    applyShape();
    video.addEventListener("resize", applyShape);       // the phone was rotated: new shape
    setPill("Loading the pose model…");
    try { pose = await getPose((s) => setPill(s)); } catch (e) { setPill("Couldn't load the pose model", "warn"); throw e; }
    if (!live) return;
    ready = true;
    setPill("Get in position", "idle");
    keepAwake(true);
    tick();
  }

  // size the drawing surface to the video, and the box (the element we sit in) to the video's shape
  function applyShape() {
    if (!video.videoWidth) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const sh = camShape(video.videoWidth, video.videoHeight, move);
    el.dataset.portrait = sh.portrait ? "1" : "0";
    const hint = el.querySelector(".cam-hint"); hint.hidden = !sh.hint; hint.textContent = sh.hint || "";
    shape = sh;
    if (el.parentElement) { el.parentElement.style.aspectRatio = sh.aspect; el.parentElement.style.setProperty("--ar", sh.ratio.toFixed(4)); el.parentElement.dataset.portrait = el.dataset.portrait; }
  }
  let shape = camShape(0, 0, move);

  function tick() {
    if (!live) return;
    const next = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick));
    if (video.paused && video.srcObject) video.play().catch(() => {});      // moving the box in the page can pause it
    if (!pose || video.readyState < 2) { next(); return; }
    const now = performance.now();
    let lm = null;
    try { lm = pose.detect(video, now); } catch { /* skip a bad frame */ }
    const r = analyzer.update(lm, now, { width: video.videoWidth, height: video.videoHeight });
    handle(r, now);
    draw(lm, r);
    next();
  }

  function handle(r, t) {
    if (r.valid) setPill(running ? "Counting" : "In position", "good");
    else { const [txt, tone] = move.pose[r.reason] || POSE_MSG[r.reason] || ["Adjust the camera", "warn"]; setPill(txt, tone); }
    if (!running) return;
    if (r.valid) { lastValidT = t; invalidSince = null; }
    else { say(coach.onLostPose(t, t - (lastValidT ?? setStartT))); if (invalidSince == null) invalidSince = t; }
    // the set ends by itself: target reached and a moment passed, or they got up
    if (shouldEndSet({ running, count: reps.length, target, lastRepT, invalidSince, now: t })) {
      running = false; el.dataset.running = "0";      // stop counting now; endSet() hands over the reps
      onSetEnd(); return;
    }
    if (!r.event) return;
    if (r.event.type === "rep") {
      reps.push(r.event); lastRepT = t;
      showLast(r.event);
      say(coach.onRep(r.event));
      onRep(reps.length, r.event);
    } else if (r.event.type === "half") {
      const said = coach.onHalf();
      if (said.length) say(said); else showCaption(move.downWord, "cue");
    } else if (r.event.type === "held") say(coach.onHeld());
  }

  function showLast(r) {
    last.hidden = false;
    const b = last.querySelector("b"); b.textContent = r.score; b.dataset.tone = r.score >= 90 ? "good" : r.score >= 70 ? "warn" : "bad";
    last.querySelector("span").textContent = r.faults.length ? r.faults.map((f) => move.faults[f] || f).join(", ") : "Clean rep";
  }

  function draw(lm, r) {
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!lm) return;
    const W = canvas.width, H = canvas.height, side = move.lm[r.side || "l"];
    const p = (i) => [lm[i].x * W, lm[i].y * H], lw = Math.max(3, W / 220);
    const body = !r.valid ? "rgba(161,152,142,.8)" : r.valid && move.bad(r.live) ? "#F06A5B" : "#7FD39C";
    const line = (a, b, color, w = lw) => { g.strokeStyle = color; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(...p(a)); g.lineTo(...p(b)); g.stroke(); };
    move.lines(side).forEach(([a, b, k]) => line(a, b, body, lw * k));
    move.limb(side).forEach(([a, b]) => line(a, b, "#F6F1EA"));
    line(move.lm.nose, side.shoulder, "rgba(246,241,234,.5)", lw * 0.7);
    if (r.valid) { g.setLineDash([lw * 2, lw * 2.5]); line(...move.guide(side), "rgba(246,241,234,.35)", lw * 0.6); g.setLineDash([]); }
    move.dots(side).forEach((i) => { g.fillStyle = i === move.hot(side) ? "#EF7C58" : "#F6F1EA"; g.beginPath(); g.arc(...p(i), lw * 1.3, 0, Math.PI * 2); g.fill(); });
  }

  async function keepAwake(on) {
    try {
      if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { wakeLock = null; }
  }

  return {
    el,
    start,
    get ready() { return ready; },
    get running() { return running; },
    get count() { return reps.length; },
    get shape() { return shape; },
    // start counting a set; the coach's "get ready" line only before the first one
    beginSet(setTarget) {
      target = setTarget || 0;
      analyzer.reset(); coach.target = target; coach.reset && coach.reset();
      invalidSince = null; lastRepT = 0;
      reps = []; lastValidT = null; setStartT = performance.now(); running = true; last.hidden = true; el.dataset.running = "1";
      if (!announced) { announced = true; say(coach.onStart()); }
      onRep(0, null);
    },
    endSet() {
      running = false; el.dataset.running = "0";
      const out = reps.slice();
      // at the target the coach has just said "That's the target"; only a set that ends short gets "Set done, N reps"
      if (!target || out.length < target) say(coach.onEnd(out.length));
      return out;
    },
    // graceful: the camera turned itself off after the last set, so let the coach finish speaking
    stop({ graceful = false } = {}) {
      live = false; running = false; ready = false;
      keepAwake(false);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null; video.srcObject = null;
      if (voice && !graceful) voice.stop();
    },
  };
}
