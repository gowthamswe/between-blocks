// Wires camera -> pose model -> push-up analysis -> coach -> voice, and draws the screen.
import { createPushupAnalyzer, LM } from "./pushup.js";
import { createCoach, summarize } from "./coach.js";
import { createVoice } from "./voice.js";
import { createPose, isPhone } from "./pose.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("bbc." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("bbc." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const settings = {
  target: store.get("target", 7),
  model: store.get("model", "auto"),
  camera: store.get("camera", ""),
  mirror: store.get("mirror", null),   // null = decide from the camera
  debug: store.get("debug", false),
  voice: store.get("voice", true),
  count: store.get("count", true),
};

const app = $("app"), video = $("video"), canvas = $("overlay"), g = canvas.getContext("2d");
const analyzer = createPushupAnalyzer();
const voice = createVoice();
let cues = null, coach = null, pose = null, stream = null;
let running = false, reps = [], setStartT = 0, lastValidT = null, wakeLock = null, looping = false;
let fps = 0, fpsN = 0, fpsT = performance.now();

const FAULT_LABEL = { sag: "Hips sagged", shallow: "Not deep enough", pike: "Hips too high", fast: "Lowered too fast" };
const POSE_MSG = {
  nobody: ["Can't see you", "warn"],
  "not-visible": ["Get your whole body in view", "warn"],
  "not-plank": ["Get into a plank, side-on", "warn"],
  "bad-geometry": ["Adjust the camera", "warn"],
};

// ---------- small UI helpers ----------
function setPill(text, tone = "idle") { const p = $("pose-pill"); p.textContent = text; p.dataset.tone = tone; }
function setMsg(text, tone) { const m = $("setup-msg"); m.textContent = text; if (tone) m.dataset.tone = tone; else delete m.dataset.tone; }
function setState(s) { app.dataset.state = s; }

let captionTimer = 0;
function showCaption(text, kind = "info") {
  const c = $("caption");
  c.textContent = text; c.dataset.kind = kind; c.dataset.show = "1";
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => { c.dataset.show = "0"; }, kind === "count" ? 900 : 2400);
}
voice.onSpeak = (u) => { if (u.kind !== "count") showCaption(u.text, u.kind); };

function renderCount() {
  $("count").textContent = reps.length;
  $("count-of").textContent = settings.target ? `/ ${settings.target}` : "";
  $("count").parentElement.dataset.done = settings.target && reps.length >= settings.target ? "1" : "0";
}

function renderLast(r) {
  $("last").hidden = false;
  const s = $("last-score");
  s.textContent = r.score; s.dataset.tone = r.score >= 90 ? "good" : r.score >= 70 ? "warn" : "bad";
  const chips = $("last-chips"); chips.textContent = "";
  (r.faults.length ? r.faults : ["ok"]).forEach((f) => {
    const c = document.createElement("span");
    c.className = "chip" + (f === "ok" ? " ok" : "");
    c.textContent = f === "ok" ? "Clean rep" : FAULT_LABEL[f] || f;
    chips.appendChild(c);
  });
  $("last-meta").textContent = `${(r.lowerMs / 1000).toFixed(1)} s down · ${r.minElbow}° at the bottom`;
}

// ---------- frame sizing ----------
function fitFrame() {
  const stage = $("stage"), frame = $("frame");
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const scale = Math.min(sw / vw, sh / vh);
  frame.style.width = Math.floor(vw * scale) + "px";
  frame.style.height = Math.floor(vh * scale) + "px";
  frame.style.aspectRatio = "auto";
  if (canvas.width !== vw) canvas.width = vw;
  if (canvas.height !== vh) canvas.height = vh;
}
addEventListener("resize", fitFrame);

// ---------- camera ----------
async function openCamera(deviceId) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const video_c = deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: "user", ...size };
  stream = await navigator.mediaDevices.getUserMedia({ video: video_c, audio: false });
  video.srcObject = stream;
  await video.play();
  await new Promise((r) => (video.videoWidth ? r() : video.addEventListener("loadedmetadata", r, { once: true })));
  const track = stream.getVideoTracks()[0];
  const facing = track.getSettings().facingMode;
  const mirror = settings.mirror ?? (facing ? facing === "user" : !isPhone());
  $("frame").dataset.mirror = mirror ? "1" : "0";
  $("chk-mirror").checked = mirror;
  fitFrame();
  await listCameras(track.getSettings().deviceId);
}

async function listCameras(currentId) {
  const sel = $("sel-camera"); sel.textContent = "";
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  devices.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId; o.textContent = d.label || `Camera ${i + 1}`;
    if (d.deviceId === currentId) o.selected = true;
    sel.appendChild(o);
  });
}

async function loadPose() {
  if (pose) { pose.close(); pose = null; }
  pose = await createPose(settings.model, (s) => setPill(s));
}

async function start() {
  const btn = $("btn-camera");
  btn.disabled = true;
  voice.unlock(); // inside the tap, so the browser allows sound later
  if (!navigator.mediaDevices?.getUserMedia) {
    setMsg("This browser can't use the camera here. Open the app over https:// or http://localhost in Chrome.", "warn");
    btn.disabled = false; return;
  }
  try {
    setMsg("Starting camera…");
    await openCamera(settings.camera);
  } catch (e) {
    const why = e && e.name === "NotAllowedError" ? "Camera access is blocked. Allow it in the browser's site settings, then try again."
      : e && e.name === "NotFoundError" ? "No camera found." : `Couldn't start the camera (${e && e.message}).`;
    setMsg(why, "warn"); btn.disabled = false; return;
  }
  try {
    setMsg("Loading the pose model. The first time takes a few seconds…");
    await loadPose();
  } catch (e) {
    setMsg(`Couldn't load the pose model (${e && e.message}). Check your connection and reload.`, "warn");
    btn.disabled = false; return;
  }
  $("panel-setup").hidden = true;
  $("hud").hidden = false; $("controls").hidden = false;
  setState("live");
  renderCount();
  $("voice-src").textContent = "Voice: " + voice.source;
  if (!looping) { looping = true; tick(); }
}

// ---------- main loop ----------
function tick() {
  const next = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick));
  if (!pose || video.readyState < 2) { next(); return; }
  const now = performance.now();
  let lm = null;
  try { lm = pose.detect(video, now); } catch { /* skip a bad frame */ }
  const r = analyzer.update(lm, now, { width: video.videoWidth, height: video.videoHeight });
  handle(r, now);
  draw(lm, r);
  fpsN++; if (now - fpsT > 1000) { fps = Math.round((fpsN * 1000) / (now - fpsT)); fpsN = 0; fpsT = now; }
  next();
}

function handle(r, t) {
  if (r.valid) setPill(running ? `Tracking · ${r.phase}` : "In position", "good");
  else { const [txt, tone] = POSE_MSG[r.reason] || ["Adjust the camera", "warn"]; setPill(txt, tone); }

  if (settings.debug) {
    $("debug").hidden = false;
    $("debug").textContent = r.valid
      ? `elbow ${r.elbow.toFixed(0)}°  hips ${(r.line * 100).toFixed(1)}%  ${r.phase}\nside ${r.side}  tilt ${r.tilt.toFixed(0)}°  ${fps} fps  ${pose.size}/${pose.delegate}`
      : `${r.reason}  ${fps} fps`;
  } else $("debug").hidden = true;

  if (!running) return;
  if (r.valid) lastValidT = t;
  else voice.say(coach.onLostPose(t, t - (lastValidT ?? setStartT)));

  if (!r.event) return;
  if (r.event.type === "rep") {
    reps.push(r.event);
    renderCount(); renderLast(r.event);
    voice.say(coach.onRep(r.event));
  } else if (r.event.type === "half") {
    const said = coach.onHalf();
    if (said.length) voice.say(said); else showCaption("Not counted: go deeper", "cue");
  }
}

// ---------- drawing ----------
function draw(lm, r) {
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;
  const W = canvas.width, H = canvas.height;
  const side = LM[r.side || "l"];
  const p = (i) => [lm[i].x * W, lm[i].y * H];
  const lw = Math.max(3, W / 220);
  const bad = r.valid && r.live && (r.live.sag || r.live.pike);
  const body = !r.valid ? "rgba(161,152,142,.8)" : bad ? "#F06A5B" : "#7FD39C";
  const line = (a, b, color, w = lw) => { g.strokeStyle = color; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(...p(a)); g.lineTo(...p(b)); g.stroke(); };
  // body line: shoulder - hip - knee - ankle; arm: shoulder - elbow - wrist
  line(side.shoulder, side.hip, body, lw * 1.4);
  line(side.hip, side.knee, body, lw * 1.4);
  line(side.knee, side.ankle, body, lw * 1.4);
  line(side.shoulder, side.elbow, "#F6F1EA");
  line(side.elbow, side.wrist, "#F6F1EA");
  line(LM.nose, side.shoulder, "rgba(246,241,234,.5)", lw * 0.7);
  // the straight line the hips should sit on
  if (r.valid) {
    g.setLineDash([lw * 2, lw * 2.5]);
    line(side.shoulder, side.ankle, "rgba(246,241,234,.35)", lw * 0.6);
    g.setLineDash([]);
  }
  [side.shoulder, side.elbow, side.wrist, side.hip, side.knee, side.ankle].forEach((i) => {
    g.fillStyle = i === side.elbow ? "#EF7C58" : "#F6F1EA";
    g.beginPath(); g.arc(...p(i), lw * 1.3, 0, Math.PI * 2); g.fill();
  });
}

// ---------- set flow ----------
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener("visibilitychange", () => { if (running && document.visibilityState === "visible") keepAwake(true); });

function startSet() {
  voice.unlock();
  $("panel-summary").hidden = true; $("hud").hidden = false; setState("live");
  running = true; reps = []; lastValidT = null; setStartT = performance.now();
  analyzer.reset();
  coach.target = settings.target;
  coach.countAloud = settings.count;
  renderCount(); $("last").hidden = true;
  const b = $("btn-set"); b.textContent = "End set"; b.dataset.running = "1";
  voice.say(coach.onStart());
  keepAwake(true);
}

function endSet() {
  running = false;
  const b = $("btn-set"); b.textContent = "Start set"; b.dataset.running = "0";
  voice.say(coach.onEnd(reps.length));
  keepAwake(false);
  showSummary();
}

function showSummary() {
  const n = reps.length;
  $("sum-title").textContent = n ? `Set done: ${n} rep${n === 1 ? "" : "s"}` : "No reps counted";
  const avg = n ? Math.round(reps.reduce((s, r) => s + r.score, 0) / n) : 0;
  const lower = n ? (reps.reduce((s, r) => s + r.lowerMs, 0) / n / 1000).toFixed(1) : "0";
  const stats = $("sum-stats"); stats.textContent = "";
  [[n, "reps"], [n ? avg : "—", "avg form"], [n ? lower + "s" : "—", "avg lowering"]].forEach(([v, l]) => {
    const d = document.createElement("div"); d.className = "stat";
    const b = document.createElement("b"); b.textContent = v; const s = document.createElement("span"); s.textContent = l;
    d.append(b, s); stats.appendChild(d);
  });
  const ol = $("sum-reps"); ol.textContent = "";
  reps.forEach((r) => {
    const li = document.createElement("li");
    const cells = [[`#${r.n}`, "n"], [r.score, "s"], [r.faults.map((f) => FAULT_LABEL[f]).join(", ") || "Clean", ""], [`${(r.lowerMs / 1000).toFixed(1)}s · ${r.minElbow}°`, "m"]];
    cells.forEach(([t, c]) => { const sp = document.createElement("span"); if (c) sp.className = c; sp.textContent = t; li.appendChild(sp); });
    ol.appendChild(li);
  });
  $("sum-text").value = summarize(reps, { target: settings.target });
  $("btn-copy").textContent = "Copy summary";
  $("hud").hidden = true; $("panel-summary").hidden = false;
  setState("summary");
}

// ---------- wiring ----------
function wire() {
  $("target").textContent = settings.target;
  document.querySelectorAll(".stepper button").forEach((b) => b.addEventListener("click", () => {
    settings.target = Math.max(1, Math.min(30, settings.target + Number(b.dataset.step)));
    $("target").textContent = settings.target; store.set("target", settings.target);
  }));
  $("btn-camera").addEventListener("click", start);
  $("btn-set").addEventListener("click", () => (running ? endSet() : startSet()));
  $("btn-again").addEventListener("click", () => {
    $("panel-summary").hidden = true; $("hud").hidden = false; setState("live");
    reps = []; renderCount(); $("last").hidden = true;
  });
  $("btn-copy").addEventListener("click", async () => {
    const t = $("sum-text");
    try { await navigator.clipboard.writeText(t.value); $("btn-copy").textContent = "Copied"; }
    catch { t.select(); $("btn-copy").textContent = "Selected: press Copy"; }
  });

  const tog = (id, key, apply) => {
    const b = $(id);
    const sync = () => { b.setAttribute("aria-pressed", settings[key] ? "true" : "false"); };
    sync(); apply(settings[key]);
    b.addEventListener("click", () => { settings[key] = !settings[key]; store.set(key, settings[key]); sync(); apply(settings[key]); });
  };
  tog("btn-voice", "voice", (v) => { voice.enabled = v; $("btn-voice").textContent = v ? "Voice on" : "Voice off"; });
  tog("btn-count", "count", (v) => { if (coach) coach.countAloud = v; });

  $("btn-settings").addEventListener("click", () => { $("voice-src").textContent = "Voice: " + voice.source; $("settings").showModal(); });
  $("sel-model").value = settings.model;
  $("sel-model").addEventListener("change", async (e) => {
    settings.model = e.target.value; store.set("model", settings.model);
    if (pose) { try { await loadPose(); } catch (err) { setPill("Model failed to load", "warn"); } }
  });
  $("sel-camera").addEventListener("change", async (e) => {
    settings.camera = e.target.value; store.set("camera", settings.camera);
    if (stream) { try { await openCamera(settings.camera); } catch { setPill("Couldn't switch camera", "warn"); } }
  });
  $("chk-mirror").addEventListener("change", (e) => { settings.mirror = e.target.checked; store.set("mirror", settings.mirror); $("frame").dataset.mirror = e.target.checked ? "1" : "0"; });
  $("chk-debug").checked = settings.debug;
  $("chk-debug").addEventListener("change", (e) => { settings.debug = e.target.checked; store.set("debug", settings.debug); });
}

async function boot() {
  wire();
  try {
    cues = await (await fetch("cues.json")).json();
  } catch {
    setMsg("Couldn't load cues.json. Serve the folder over http (see README), don't open the file directly.", "warn");
    $("btn-camera").disabled = true; return;
  }
  coach = createCoach({ cues, target: settings.target, countAloud: settings.count });
  voice.loadManifest();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
