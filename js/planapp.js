// The plan screen: day strip, today's session, logging, progress and history.
// Push-ups, squats, glute bridges and RDLs open the camera coach (coach.html), which logs its sets back through the same store.
// Loaded on demand (import() below): the camera coach (js/camcoach.js, js/moves.js and the exercise analyzers)
// only when Coach is tapped in the local app, and only the one store each version uses. The cloud page
// (cloud.html on claude.ai) never loads the camera code or the browser store, so it doesn't ship them.
import { exName, isTimed, isHold, isBodyweight, canCoach, isCable, CUES } from "./exercises.js";
import { makeFigure, gripMap, BAR_EX, ytUrl, hasFigure } from "./figures.js";
import { whereOf, canSwapWhere } from "./plan.js";
import { unlock as unlockAudio, beep, restBeep, isMuted, setMuted } from "./beep.js";
import { EXERCISES } from "./exercises.js";
import { restKey, restAfter, nextToDo, addSet, coachSet, weightFor, adjustWeight, canSkip, canUndoSkip, lastEntry, resultText } from "./plan.js";
import { setProgress, tickSet, undoSet, entryFromSets, timerState, nextReps, adjustReps, amount, setsFromEntry, holdState, startHold, heldSecs, beepFor } from "./plan.js";
import { itemKey, dayKey, planDays, dayFor, dayItems, pickDay, targetText, entryText, entriesFor, logDefaults, dayStatus, progress, logText } from "./plan.js";

// Where the plan and log live: the Between Blocks artifact's cloud database when this page runs there,
// else this browser (the local app, with its camera coach and progress mirror).
let store = null;
const inCloud = () => store && store.kind === "cloud";
const coachable = (ex) => canCoach(ex) && !inCloud();   // the camera isn't available inside claude.ai
const showCoachButton = (ex) => canCoach(ex);           // in the cloud the button is a stub that does nothing
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let plan = null, entries = [], done = [], sel = null, openForm = null, msg = "";
let cuesOpen = false;      // the (i) panel with form cues
let dayNoteOpen = false;   // the (i) next to the day title: the day's coach note
let openItem = undefined;   // item key whose picture is open; undefined = pick the next one to do

// ---------- pictures: one animation loop for whatever figures are on screen ----------
let ticks = [], raf = 0;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function loop(now) { ticks.forEach((t) => t(now)); raf = ticks.length ? requestAnimationFrame(loop) : 0; }
function startTicks() { cancelAnimationFrame(raf); raf = 0; if (ticks.length && !reduceMotion) raf = requestAnimationFrame(loop); }

function media(ex, where = "home") {
  const host = el("div", { class: "media fig" });
  const f = makeFigure(ex);
  f.svg.setAttribute("role", "img"); f.svg.setAttribute("aria-label", `${exName(ex)}, animated drawing`); f.svg.removeAttribute("aria-hidden");
  host.append(f.svg);
  if (f.tick) ticks.push(f.tick);
  if (!hasFigure(ex)) host.append(el("p", { class: "nofig-note", text: "No drawing for this one yet. Tap ▶ for a demo video, or (i) for form cues." }));
  if (BAR_EX[ex] && where !== "cable") host.append(gripMap(ex));   // the grip map is his power tower's top
  const yt = el("a", { class: "yt", href: ytUrl(ex, exName(ex)), target: "_blank", rel: "noopener", "aria-label": "Find a demo video on YouTube", title: "Find a demo video" });
  yt.innerHTML = '<svg viewBox="0 0 26 18" aria-hidden="true"><path fill="#fff" d="M10 3.5v11l9-5.5z"/></svg>';
  host.append(yt);
  return host;
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c != null && e.append(c));
  return e;
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parse = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const shortDate = (k) => { const d = parse(k); return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`; };
const sets = (n) => `${n} set${n === 1 ? "" : "s"}`;
const TICK = () => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("aria-hidden", "true"); s.innerHTML = '<path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'; return s; };

async function refresh() { [entries, done] = await Promise.all([store.entries(), store.done()]); }

// ---------- day strip ----------
function renderWeek() {
  const w = $("week"); w.textContent = "";
  const today = dayKey();
  planDays(plan).forEach((d) => {
    const st = dayStatus(d, entries, done);
    const dt = parse(d.date);
    w.append(el("button", { class: "day", type: "button", "aria-pressed": d.date === sel ? "true" : "false", "data-s": st,
      "data-today": d.date === today ? "1" : null, "data-easy": d.kind === "Easy" ? "1" : null,
      onclick: () => { stopCam(); sel = d.date; openForm = null; openItem = undefined; msg = ""; history.replaceState(null, "", "?day=" + d.date); render(); } },
      el("span", { class: "day-dow", text: d.date === today ? "Today" : DOW[dt.getDay()] }),
      el("span", { class: "day-num", text: `${MON[dt.getMonth()]} ${dt.getDate()}` }),
      el("span", { class: "day-flag" }, st === "done" ? TICK() : st === "skipped" ? "SKIP" : d.kind === "Easy" ? "EASY" : st === "started" ? "•" : whereOf(d) === "cable" ? "CABLE" : "")));
  });
  const on = w.querySelector('[aria-pressed="true"]');
  if (on) on.scrollIntoView({ block: "nearest", inline: "center" });
}

// ---------- the selected day: session list on the left, the selected exercise on the right ----------
async function renderDay() {
  const host = $("day"); host.textContent = "";
  const today = dayKey(), days = planDays(plan);
  if (!days.length) { host.append(el("div", { class: "empty-card" }, el("h2", { text: "No plan yet" }), el("p", { text: "Ask Claude for a plan; it goes in data/plan.json." }))); return; }
  const last = days[days.length - 1].date;
  if (today > last) host.append(el("div", { class: "banner", text: `The plan ended on ${shortDate(last)}. Open History, copy your log, and ask Claude for the next days.` }));

  const d = dayFor(plan, sel);
  if (!d) return;
  if (d.skipped) {
    const undo = store.undoSkip && canUndoSkip(plan, d);
    host.append(el("div", { class: "empty-card" }, el("h2", { text: d.wasKind === "Easy" ? "Rest day skipped" : "Skipped" }),
      el("p", { text: d.wasKind === "Easy" ? `${shortDate(d.date)}. Nothing else moved.`
        : `${shortDate(d.date)}${d.wasTitle ? ` was ${d.wasTitle.toLowerCase()}` : ""}. That session and everything after it moved back one day.` }),
      undo ? el("div", { class: "skip-actions" }, el("button", { class: "ghost-btn", type: "button", id: "undo-skip", text: "Undo skip",
        onclick: async () => { await store.undoSkip(d.date); plan = await store.plan(); render(); } })) : null));
    return;
  }
  const items = dayItems(d);
  const keys = items.map((it) => itemKey(d.date, it));
  if (!keys.includes(openItem)) {
    const next = items.find((it) => !entriesFor(entries, d.date, it).length);
    openItem = itemKey(d.date, next || items[0]);
  }
  const cur = keys.indexOf(openItem);
  const drafts = await Promise.all(keys.map((k) => store.draft(k)));
  const board = el("section", { class: "board" });
  const rest = await store.draft(restKey(d.date));
  board.append(renderMap(d, items, cur, drafts), await renderStage(d, items, cur, drafts[cur], rest));
  host.append(board);
}

function select(key) {
  if (key !== camKey) stopCam();
  openItem = key; openForm = null; cuesOpen = false; render();
  if (matchMedia("(max-width: 900px)").matches) $("stage")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

// Skip this day (cloud): a training day and everything after it move back a day; a rest day is just marked.
let skipAsk = null;
function skipControl(d) {
  const wrap = el("div", { class: "skip-wrap" });
  if (skipAsk !== d.date) {
    wrap.append(el("button", { class: "linkish", type: "button", id: "skip-day", text: "Skip this day", onclick: () => { skipAsk = d.date; render(); } }));
    return wrap;
  }
  const rest = d.kind === "Easy";
  wrap.append(el("div", { class: "skip-confirm" },
    el("p", { text: rest ? "Skip this rest day? Nothing else moves." : `Skip ${shortDate(d.date)}? This session and everything after it move back one day.` }),
    el("div", { class: "skip-actions" },
      el("button", { class: "primary", type: "button", id: "skip-yes", text: "Skip day", onclick: async () => { skipAsk = null; await store.skipDay(d.date); plan = await store.plan(); render(); } }),
      el("button", { class: "ghost-btn", type: "button", id: "skip-no", text: "Keep it", onclick: () => { skipAsk = null; render(); } }))));
  return wrap;
}

// Home or cable machine: where today's version is done, and a switch when the plan has the other version.
function whereRow(d) {
  if (!d.where && !d.alt) return null;                 // older plans: nothing to say
  const where = whereOf(d);
  const row = el("div", { class: "where-row" },
    el("span", { class: "where-chip", "data-where": where, text: where === "cable" ? "Cable machine" : "Home" }));
  if (d.alt && store.swapDay) {
    if (canSwapWhere(d, entries, done)) {
      row.append(el("button", { class: "linkish", type: "button", id: "swap-where",
        text: d.alt.where === "cable" ? "Switch to the cable-machine version" : "Switch to the home version",
        onclick: async () => { stopCam(); await store.swapDay(d.date); plan = await store.plan(); openItem = undefined; render(); } }));
    } else row.append(el("span", { class: "fine", text: "Can't switch once something's logged" }));
  }
  return row;
}

// Rough session length, as Between Blocks estimated it: work time plus rests plus ~75 s changeover per exercise.
function sessionMins(items) {
  const secs = items.reduce((a, it) => a + it.sets * (it.secs ? it.secs + 5 : (it.reps || 5) * (it.each ? 8 : 4)) + Math.max(0, it.sets - 1) * (it.rest || 0) + 75, 0);
  const m = secs / 60;
  return m >= 12 ? Math.round(m / 5) * 5 : Math.max(2, Math.round(m));
}

function renderMap(d, items, cur, drafts) {
  const today = dayKey(), st = dayStatus(d, entries, done);
  const map = el("aside", { class: "map" });
  map.append(el("span", { class: "s-kind", text: d.kind }),
    el("div", { class: "map-title-row" }, el("h1", { class: "map-title", text: d.title }),
      d.note ? el("button", { class: "info-btn", type: "button", "aria-label": "About this day", "aria-expanded": dayNoteOpen ? "true" : "false", "aria-controls": "day-note",
        onclick: () => { dayNoteOpen = !dayNoteOpen; render(); } }, "i") : null),
    el("p", { class: "map-facts" }, shortDate(d.date) + (d.date === today ? " · today" : "") + ` · ~${sessionMins(items)} min · ${items.length} exercises · ${items.reduce((a, it) => a + it.sets, 0)} sets`,
      st === "done" ? el("span", { class: "done-pill" }, TICK(), "Done") : null));
  const wr = whereRow(d); if (wr) map.append(wr);
  if (d.note && dayNoteOpen) map.append(el("p", { class: "coach-note", id: "day-note", text: d.note }));
  const ol = el("ol", { class: "moves" });
  items.forEach((it, i) => {
    const key = itemKey(d.date, it), logged = entriesFor(entries, d.date, it), pr = setProgress(it, drafts[i], logged);
    const s = i === cur ? "now" : logged.length ? "done" : "todo";
    ol.append(el("li", {}, el("button", { class: "move", type: "button", "data-s": s, "data-logged": logged.length ? "1" : null, "aria-current": i === cur ? "true" : null, onclick: () => select(key) },
      el("span", { class: "move-num" }, logged.length ? TICK() : String(i + 1).padStart(2, "0")),
      el("span", { class: "move-mid" }, el("span", { class: "move-name", text: exName(it.ex) }),
        el("span", { class: "move-sub", "data-progress": !logged.length && pr.done ? "1" : null,
          text: logged.length ? "" : pr.done ? `${pr.done} of ${sets(pr.total)} done` : coachable(it.ex) ? "camera coach" : "" })),   // the note shows on the right
      // logged: what you did, in green, where the target was
      el("span", { class: "move-t", text: logged.length ? resultText(logged[logged.length - 1], it) : targetText(it) }))));
  });
  map.append(ol);
  const doneRec = done.find((x) => x.date === d.date);
  const foot = el("div", { class: "s-foot" });
  if (doneRec) foot.append(el("span", { class: "fine", text: "Session marked done." }), el("button", { class: "linkish", type: "button", text: "Undo", onclick: async () => { await store.unmarkDone(d.date); await refresh(); render(); } }));
  else if (st === "started" || st === "done") foot.append(el("button", { class: "primary", type: "button", text: "Mark session done", onclick: async () => { await store.markDone({ date: d.date }); await refresh(); render(); } }));
  if (foot.childNodes.length) map.append(foot);
  if (store.skipDay && canSkip(plan, d, done)) map.append(skipControl(d));
  return map;
}

// ---------- set tracking: tiles next to the title (sets · reps · timer) and one big "set done" button ----------
let timerIv = 0, timerCtx = null;   // the selected item and its draft, for the live timer tile
// Countdown beeps (holds and rest). The audio is unlocked by the Start / Done taps.
let holdMode = null, beeped = new Set();
let advanceAfter = null;   // an exercise was just finished: move on to the next one at the next render

// ---------- camera coach in the picture area ----------
// Coach turns the camera on where the drawing was; the tiles, Done, rest and moving on work as without it.
let cam = null, camKey = null, cuesData = null;
function stopCam(opts) { if (cam) cam.stop(opts); cam = null; camKey = null; }
async function startCam(d, it) {
  unlockAudio(); stopCam();
  try { cuesData = cuesData || await (await fetch("cues.json")).json(); } catch { cuesData = { cues: {}, numbers: { words: [] } }; }
  const key = itemKey(d.date, it);
  const [{ createCamCoach }, { moveFor }] = await Promise.all([import("./camcoach.js"), import("./moves.js")]);
  cam = createCamCoach({ move: moveFor(it.ex), item: it, cues: cuesData,
    onRep: (n) => { const t = $("st-reps"); if (t && camKey === key) t.querySelector(".tile-big").textContent = String(n); },
    // the camera ended the set (target reached, or they got up): same as tapping Done
    onSetEnd: async () => { if (camKey !== key) return; finishSet(d, it, await store.draft(key)); } });
  camKey = key; render();
  try { await cam.start(); } catch { /* the camera box shows why */ }
}

// Move from a finished exercise to the next one to do (only if you're still looking at it).
function advanceFrom(fromKey) {
  const d = dayFor(plan, sel); if (!d || openItem !== fromKey) return;
  const items = dayItems(d), i = items.findIndex((x) => itemKey(d.date, x) === fromKey);
  const nx = i >= 0 ? nextToDo(items, entries, d.date, i) : null;
  if (nx) select(itemKey(d.date, nx));
}
function paintTimer() {
  const host = $("st-timer"); if (!host || !timerCtx) return;
  const t = timerState(timerCtx.item, timerCtx.rest);
  host.dataset.tone = t.tone;
  host.querySelector(".tile-big").textContent = t.text;
  host.querySelector(".tile-lab").textContent = t.label;
  // timed hold: the middle tile counts the lead-in, then the hold down from the goal
  const h = holdState(timerCtx.item, timerCtx.draft), reps = $("st-reps");
  if (h && reps) {
    reps.dataset.tone = h.tone;
    reps.querySelector(".tile-big").textContent = h.text;
    reps.querySelector(".tile-lab").textContent = h.label;
  }
  const mode = h ? h.mode : null;
  const b = beepFor(h) || restBeep(timerCtx.rest && timerCtx.rest.restEnd);
  if (b && !beeped.has(b.key)) { beeped.add(b.key); beep(b.long); }
  // camera on and no rest running: count the next set
  if (cam && camKey === openItem && cam.ready && !cam.running) {
    const rs = timerCtx.rest, resting = rs && rs.restEnd && Date.now() < rs.restEnd;
    if (!resting) cam.beginSet(timerCtx.item.reps);
  }
  if (holdMode === "ready" && mode === "hold") render();       // Cancel becomes Done
  holdMode = mode;
}
function startTimer() { clearInterval(timerIv); paintTimer(); timerIv = setInterval(paintTimer, 250); }

async function saveSets(d, it, draft) {
  const key = itemKey(d.date, it);
  if (draft) await store.saveDraft(key, draft); else await store.clearDraft(key);
}
async function finishSet(d, it, draft) {
  unlockAudio();   // the rest that starts now beeps at the end
  const held = heldSecs(draft, Date.now(), isTimed(it.ex) ? it.secs : Infinity);
  const camOn = cam && camKey === itemKey(d.date, it);
  let r;
  if (camOn) {
    const counted = cam.endSet();          // nothing counted (camera couldn't see you): the plan's reps, as a hand-ticked set
    r = addSet(it, draft, counted.length ? coachSet(counted) : { reps: nextReps(it, draft), ts: Date.now(), manual: true });
    if (r.complete) stopCam({ graceful: true });    // let the coach finish its last line
  } else r = tickSet(it, draft, { held });
  const rest = restAfter(it);
  if (r.complete) {
    const w = weightFor(it, draft, entries, d.date);
    await store.addEntry(entryFromSets(it, r.sets, { day: d.date, w }));
    await store.clearDraft(itemKey(d.date, it));
    await refresh();
    // last set: move straight on to the next exercise, its rest counting there. The day's last exercise: no rest.
    const items = dayItems(d), idx = items.findIndex((x) => itemKey(d.date, x) === itemKey(d.date, it));
    const more = nextToDo(items, entries, d.date, idx);
    if (more && rest) await store.saveDraft(restKey(d.date), rest); else await store.clearDraft(restKey(d.date));
    if (more) advanceAfter = itemKey(d.date, it);
  } else {
    if (rest) await store.saveDraft(restKey(d.date), rest); else await store.clearDraft(restKey(d.date));
    await saveSets(d, it, r.draft);
  }
  render();
}

// Undo the last set. On a logged exercise that un-logs it and keeps the other sets.
async function undoLast(d, it, draft, logged) {
  if (logged.length) {
    const e = logged[logged.length - 1];
    await store.removeEntry(e.id);
    await saveSets(d, it, undoSet({ sets: setsFromEntry(e) }));
    await refresh();
  } else await saveSets(d, it, undoSet(draft));
  render();
}
// Back to zero: drop the logged result and any sets in progress.
async function clearSets(d, it, logged) {
  for (const e of logged) await store.removeEntry(e.id);
  await store.clearDraft(itemKey(d.date, it));
  await refresh(); render();
}

// Dumbbell weight for this exercise today, set before (or between) sets; it's what gets logged.
// Cable exercises log the number on the weight stack, in its 5 lb steps.
const WEIGHT_STEP = 2.5, STACK_STEP = 5;
function weightRow(d, it, draft, logged) {
  if (isBodyweight(it.ex) || logged.length) return null;
  const cable = isCable(it.ex), stepBy = cable ? STACK_STEP : WEIGHT_STEP;
  const w = weightFor(it, draft, entries, d.date);
  const step = (delta) => async () => { await saveSets(d, it, adjustWeight(it, draft, entries, d.date, delta)); render(); };
  return el("div", { class: "weight-row" }, el("span", { class: "weight-lab", text: cable ? "Stack" : "Dumbbells" }),
    el("button", { class: "rep-arrow w-btn", type: "button", "aria-label": `Lighter by ${stepBy} lb`, disabled: w <= 0, onclick: step(-stepBy) }, "−"),
    el("output", { class: "weight-val", text: `${w} lb` }),
    el("button", { class: "rep-arrow w-btn", type: "button", "aria-label": `Heavier by ${stepBy} lb`, onclick: step(stepBy) }, "+"),
    cable && !w ? el("span", { class: "fine", text: "set it to the pin you use" }) : null);
}

function tiles(d, it, draft, logged, rest, camOn) {
  const pr = setProgress(it, draft, logged), manual = !pr.logged;   // ticking needs an unlogged exercise; undo works either way
  const bars = el("div", { class: "bars", role: "group", "aria-label": `${pr.done} of ${pr.total} sets done` });
  for (let i = 0; i < pr.total; i++) {
    const s = i < pr.done ? "done" : i === pr.done && !pr.logged ? "now" : "todo";
    // tap the next bar to tick a set off, or the last filled one to undo it
    const act = i === pr.done - 1 ? () => undoLast(d, it, draft, logged)
      : manual && i === pr.done && !isTimed(it.ex) ? () => finishSet(d, it, draft) : null;
    bars.append(act ? el("button", { class: "bar", type: "button", "data-s": s, "aria-label": s === "now" ? `Set ${i + 1} done` : `Undo set ${i + 1}`, onclick: act })
      : el("span", { class: "bar", "data-s": s }));
  }
  const setsLab = pr.logged ? `${sets(pr.done)} ✓` : pr.done ? `${pr.done} of ${sets(pr.total)}` : sets(pr.total);
  const amountLab = isTimed(it.ex) ? (isHold(it.ex) ? "sec hold" : "sec") : it.each ? "reps each side" : it.reps === 1 ? "rep" : "reps";
  const t = timerState(it, rest);
  // reps for the set you're on; the arrows change it (holds are timed, so no arrows)
  const arrows = manual && !isTimed(it.ex) && !camOn;
  const reps = arrows ? nextReps(it, draft) : amount(it);
  const step = (delta) => async (e) => { e.stopPropagation(); await saveSets(d, it, adjustReps(it, draft, delta)); render(); };
  const hold = isTimed(it.ex) ? holdState(it, draft) : null;
  const repsTile = el("div", { class: "tile tile-reps", id: "st-reps", "data-changed": arrows && reps !== amount(it) ? "1" : null, "data-tone": hold ? hold.tone : null },
    el("span", { class: "tile-big", text: hold ? hold.text : camOn ? String(cam.count) : String(reps) }),
    el("span", { class: "tile-lab", text: hold ? hold.label : camOn ? `of ${reps} ${amountLab}` : amountLab }),   // weight: the Dumbbells row below
    arrows ? el("button", { class: "rep-arrow up", type: "button", "aria-label": "One more rep", disabled: reps >= 99, onclick: step(1) }, "▲") : null,
    arrows ? el("button", { class: "rep-arrow down", type: "button", "aria-label": "One fewer rep", disabled: reps <= 0, onclick: step(-1) }, "▼") : null);
  return el("div", { class: "tiles" },
    el("div", { class: "tile tile-sets", "data-done": pr.logged ? "1" : null }, bars, el("span", { class: "tile-lab", text: setsLab })),
    repsTile,
    el("div", { class: "tile tile-timer", id: "st-timer", "data-tone": t.tone }, el("span", { class: "tile-big", text: t.text }), el("span", { class: "tile-lab", text: t.label })));
}

async function renderStage(d, items, cur, draft, rest) {
  const it = items[cur], key = itemKey(d.date, it);
  const logged = entriesFor(entries, d.date, it);
  const pr = setProgress(it, draft, logged);
  timerCtx = { item: it, draft, rest };
  const camOn = !!(cam && camKey === key);
  const stage = el("div", { class: "stage", id: "stage" });
  stage.append(el("div", { class: "st-head" },
    el("div", { class: "st-titles" }, el("span", { class: "st-step", text: `${cur + 1} of ${items.length}` }),
      el("div", { class: "st-name-row" }, el("h2", { class: "st-name", text: exName(it.ex) }),
        CUES[it.ex] ? el("button", { class: "info-btn", type: "button", "aria-label": "Form cues", "aria-expanded": cuesOpen ? "true" : "false", "aria-controls": "cue-pop",
          onclick: (e) => { e.stopPropagation(); cuesOpen = !cuesOpen; render(); } }, "i") : null,
        // camera coach: on the title row, right-aligned, so the set button below is the same everywhere
        showCoachButton(it.ex) && !logged.length
          ? (camOn ? el("button", { class: "coach-btn", type: "button", "data-on": "1", text: "Stop camera", onclick: () => { stopCam(); render(); } })
            : el("button", { class: "coach-btn", type: "button", text: "Coach", title: inCloud() ? "The camera coach runs in the local app" : null,
                onclick: () => { if (coachable(it.ex)) startCam(d, it); } }))
          : null,
        CUES[it.ex] && cuesOpen ? el("div", { class: "cue-pop", id: "cue-pop", role: "dialog", "aria-label": "Form cues", onclick: (e) => e.stopPropagation() },
          el("span", { class: "cue-pop-lab", text: "Form cues" }), el("ul", { class: "cues" }, CUES[it.ex].map((c) => el("li", { text: c })))) : null),
      it.note ? el("p", { class: "st-note", text: it.note[0].toUpperCase() + it.note.slice(1) }) : null),
    tiles(d, it, draft, logged, rest, camOn),
    weightRow(d, it, draft, logged)));

  const acts = el("div", { class: "ctrls" });
  if (!logged.length) {
    const setCls = "play-btn";
    if (isTimed(it.ex)) {
      const h = holdState(it, draft);
      acts.append(!h
        ? el("button", { class: setCls, type: "button", text: "Start", onclick: async () => { unlockAudio(); for (const k of [...beeped]) if (!k.startsWith("rest:")) beeped.delete(k); await store.clearDraft(restKey(d.date)); await saveSets(d, it, startHold(draft)); holdMode = "ready"; render(); } })
        : h.mode === "ready"
          ? el("button", { class: "ghost-btn", type: "button", text: "Cancel", onclick: async () => { await saveSets(d, it, { ...draft, holdStart: null }); render(); } })
          : el("button", { class: setCls, type: "button", text: "✓ Done", onclick: () => finishSet(d, it, draft) }));
    } else {
      acts.append(el("button", { class: setCls, type: "button", text: "✓ Done", onclick: () => finishSet(d, it, draft) }));
    }
  }
  // Done sits at the end of the tile row (on phones it drops below as a full-width bar, see plan.css)
  if (acts.childNodes.length) { const t = stage.querySelector(".tiles"), row = el("div", { class: "tile-row" }); t.replaceWith(row); row.append(t, acts); }
  if (!logged.length && pr.done) {
    stage.append(el("div", { class: "logged progress-line" }, el("span", { text: `${pr.done} of ${sets(pr.total)} done · tap the last bar to undo one` }),
      el("span", { class: "logged-acts" }, el("button", { class: "linkish", type: "button", text: "Clear", onclick: () => clearSets(d, it, logged) }))));
  }

  logged.forEach((e) => {
    const extra = e.src === "coach" ? ` · camera coach, form ${e.form}/100` : "";
    stage.append(el("div", { class: "logged" }, el("span", {}, TICK(), " Logged " + entryText(e) + extra),
      el("span", { class: "logged-acts" },
        el("button", { class: "linkish", type: "button", text: openForm === e.id ? "Cancel" : "Edit", onclick: () => { openForm = openForm === e.id ? null : e.id; render(); } }),
        el("button", { class: "linkish", type: "button", text: "Clear", onclick: () => clearSets(d, it, logged) }))));
    if (openForm === e.id) stage.append(logForm(d, it, e));
  });
  stage.append(camOn ? el("div", { class: "media cam-media", "data-portrait": cam.shape.portrait ? "1" : "0", style: `aspect-ratio: ${cam.shape.aspect}; --ar: ${cam.shape.ratio.toFixed(4)}` }, cam.el) : media(it.ex, whereOf(d)));

  return stage;
}

// Typed correction of a logged result: replaces that entry.
function logForm(d, it, entry) {
  const v = { sets: entry.sets, reps: entry.reps, w: entry.w || 0 };
  const field = (name, label, value, step = 1) => el("label", { class: "field" }, el("span", { text: label }),
    el("input", { type: "number", inputmode: "decimal", min: "0", step: String(step), name, value: String(value) }));
  const form = el("form", { class: "log-form", onsubmit: async (ev) => {
    ev.preventDefault();
    const f = new FormData(form), num = (k) => Number(f.get(k) || 0);
    if (!num("sets") || !num("reps")) return;
    const { id, perSet, ...rest } = entry;
    const same = num("sets") === entry.sets && num("reps") === entry.reps;
    await store.removeEntry(id);
    await store.addEntry({ ...rest, sets: num("sets"), reps: num("reps"), w: isBodyweight(it.ex) ? 0 : num("w"), ...(same && perSet ? { perSet } : {}), edited: true });
    openForm = null; await refresh(); render();
  } },
  field("sets", "Sets", v.sets), field("reps", isTimed(it.ex) ? "Seconds" : it.each ? "Reps each side" : "Reps", v.reps),
  isBodyweight(it.ex) ? null : field("w", "Weight (lb)", v.w, 0.5),
  el("button", { class: "primary", type: "submit", text: "Save" }));
  return form;
}

// ---------- progress + history ----------
function renderProgress() {
  const ul = $("prog"); ul.textContent = "";
  const notesHost = $("coach-notes"); if (notesHost) notesHost.textContent = "";
  const coach = store.coach ? store.coach() : null;
  if (coach && notesHost && (coach.notes || []).length) {
    notesHost.append(el("div", { class: "sec-head spaced" }, el("h2", { text: "Coach's notes" }), el("span", { class: "hint", text: coach.updated ? `from Claude · ${coach.updated}` : "from Claude" })),
      el("ul", { class: "notes" }, coach.notes.map((n) => el("li", { text: n }))));
  }
  const exNote = {}; ((coach && coach.exercises) || []).forEach((x) => { if (x.note) exNote[x.ex] = x.note; });
  const rows = progress(entries);
  if (!rows.length) { ul.append(el("li", { class: "empty", text: "Nothing logged yet." })); return; }
  const chip = { up: "up", down: "down", same: "same", new: "new" };
  rows.forEach((r) => ul.append(el("li", {},
    el("span", { class: "p-name", text: r.name }),
    el("span", { class: "p-meta" }, el("span", { class: "chip-t", "data-s": r.trend, text: chip[r.trend] }), el("span", { class: "p-cur", text: entryText(r.last) })),
    el("span", { class: "p-trail", text: r.trail.join(" → ") + `   last ${shortDate(r.last.day || dayKey(r.last.ts))}` + (r.last.src === "coach" ? ` · form ${r.last.form}/100` : "") }),
    exNote[r.ex] ? el("span", { class: "p-note", text: exNote[r.ex] }) : null)));
}

function renderHistory() {
  const host = $("hist"); host.textContent = "";
  const byDay = {};
  entries.forEach((e) => { const k = e.day || dayKey(e.ts); (byDay[k] = byDay[k] || []).push(e); });
  const days = Object.keys(byDay).sort().reverse();
  $("hist-count").textContent = `${entries.length} entries · ${days.length} days`;
  $("hist-msg").textContent = msg;
  days.forEach((k) => {
    const dn = done.find((x) => x.date === k);
    host.append(el("div", { class: "h-day" },
      el("div", { class: "h-date" }, el("span", { text: shortDate(k) }), el("span", { text: dn ? `done${dn.mins ? ` · ${dn.mins} min` : ""}` : "" })),
      el("ul", { class: "feed" }, byDay[k].sort((a, b) => (a.item ?? 99) - (b.item ?? 99) || a.ts - b.ts).map((e) =>
        el("li", {}, el("span", { class: "f-ex", text: exName(e.ex) + (e.src === "coach" ? " · camera coach" : "") }), el("span", { class: "f-num", text: entryText(e) }))))));
  });
}

function wireHistory() {
  $("btn-copylog").addEventListener("click", async () => {
    const since = dayKey(Date.now() - 13 * 864e5);
    const txt = "Between Blocks log, last 14 days\n\n" + (logText(entries, done, { since }) || "(nothing logged)");
    try { await navigator.clipboard.writeText(txt); msg = "Copied. Paste it to Claude."; }
    catch { msg = "Couldn't copy here. Use the download instead."; }
    renderHistory();
  });
  $("btn-export").addEventListener("click", async () => {
    const data = await store.exportAll();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    const a = el("a", { href: url, download: `between-blocks-progress-${dayKey()}.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// ---------- add an entry by hand: any exercise, not just today's plan ----------
const GROUP_NAMES = { warmup: "Warm-up", push: "Push", pull: "Pull", legs: "Legs", hinge: "Hinge", core: "Core", carry: "Carry" };
let manualOpen = null;
function renderGroups() {
  const host = $("groups"); host.textContent = "";
  const byGroup = {};
  Object.entries(EXERCISES).forEach(([k, x]) => { (byGroup[x.group] = byGroup[x.group] || []).push(k); });
  Object.keys(GROUP_NAMES).filter((g) => byGroup[g]).forEach((g) => {
    const ul = el("ul", { class: "ex-list" });
    byGroup[g].forEach((k) => {
      const last = lastEntry(entries, k);
      const li = el("li", { class: "ex", "data-open": manualOpen === k ? "1" : null },
        el("button", { class: "ex-row", type: "button", "aria-expanded": manualOpen === k ? "true" : "false", onclick: () => { manualOpen = manualOpen === k ? null : k; renderGroups(); } },
          el("span", { class: "ex-name", text: exName(k) }), el("span", { class: "ex-last", text: last ? entryText(last) : "" }), el("span", { class: "chev" })));
      if (manualOpen === k) li.append(manualForm(k, last));
      ul.append(li);
    });
    host.append(el("div", { class: "group" }, el("span", { class: "group-name", text: GROUP_NAMES[g] }), ul));
  });
}
function manualForm(k, last) {
  const field = (name, label, value, step = 1) => el("label", { class: "field" }, el("span", { text: label }),
    el("input", { type: "number", inputmode: "decimal", min: "0", step: String(step), name, id: `manual-${k}-${name}`, value: value == null ? "" : String(value) }));
  const form = el("form", { class: "log-form", onsubmit: async (ev) => {
    ev.preventDefault();
    const f = new FormData(form), num = (n) => Number(f.get(n) || 0);
    if (!num("sets") || !num("reps")) return;
    await store.addEntry({ ex: k, sets: num("sets"), reps: num("reps"), w: isBodyweight(k) ? 0 : num("w"), day: dayKey() });
    manualOpen = null; msg = `Logged ${exName(k)}.`; await refresh(); render();
  } },
  field("sets", "Sets", last ? last.sets : 3), field("reps", isTimed(k) ? "Seconds" : "Reps", last ? last.reps : ""),
  isBodyweight(k) ? null : field("w", "Weight (lb)", last ? last.w : "", 0.5),
  el("button", { class: "primary", type: "submit", text: "Log" }));
  return form;
}

// ---------- tabs ----------
function wireTabs() {
  const tabs = ["today", "progress", "history"];
  tabs.forEach((t) => $("tab-" + t).addEventListener("click", () => {
    if (t !== "today") stopCam();
    tabs.forEach((u) => { $("tab-" + u).setAttribute("aria-selected", u === t ? "true" : "false"); $("view-" + u).hidden = u !== t; });
    render();
  }));
}

// One redraw at a time. A change can ask for a redraw while one is running (e.g. tapping Skip or the
// home/cable switch redraws, and the database's confirmation redraws again); overlapping redraws each
// cleared the screen and then both added the session list, so it showed twice. Queue them instead.
let rendering = null, renderAgain = false;
async function render() {
  if (rendering) { renderAgain = true; return rendering; }
  rendering = (async () => { do { renderAgain = false; await renderOnce(); } while (renderAgain); })();
  try { await rendering; } finally { rendering = null; }
}

async function renderOnce() {
  ticks = []; timerCtx = null;
  const prof = plan && plan.profile ? `${plan.profile.weight_lb} lb · ${plan.profile.height} · ` : "";
  $("foot").textContent = prof + (inCloud()
    ? `Plan updated ${plan && plan.updated || "?"} · saved to your Between Blocks log (${entries.length} entries) · the camera coach runs in the local app`
    : `Plan updated ${plan && plan.updated || "?"} · progress saved in this browser (${entries.length} entries) · camera coach for push-ups, squats, glute bridges and RDLs`);
  const coach = store.coach ? store.coach() : null;
  $("block-label").textContent = (coach && coach.block) || "";
  $("status").textContent = store.status ? store.status() : "";
  renderWeek();
  await renderDay();
  if (advanceAfter) { const k = advanceAfter; advanceAfter = null; advanceFrom(k); return; }
  startTicks();
  if (timerCtx) startTimer(); else clearInterval(timerIv);
  if (!$("view-progress").hidden) renderProgress();
  if (!$("view-history").hidden) { renderHistory(); renderGroups(); }
}

function wireHead() {
  const beeps = $("btn-beeps");
  const syncBeeps = () => { beeps.textContent = isMuted() ? "Beeps off" : "Beeps on"; beeps.setAttribute("aria-pressed", isMuted() ? "true" : "false"); };
  syncBeeps();
  beeps.addEventListener("click", () => { setMuted(!isMuted()); syncBeeps(); });
  const fs = $("btn-fs");
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const syncFs = () => { fs.textContent = isFs() ? "Exit full screen" : "Full screen"; };
  fs.addEventListener("click", () => {
    try {
      if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
      else { const r = document.documentElement; (r.requestFullscreen || r.webkitRequestFullscreen)?.call(r)?.catch?.(() => {}); }
    } catch { /* not available here */ }
  });
  document.addEventListener("fullscreenchange", syncFs); document.addEventListener("webkitfullscreenchange", syncFs);
}

function wireKeys() {
  // the cue panel closes on Esc or a tap anywhere else
  document.addEventListener("click", () => { if (cuesOpen) { cuesOpen = false; render(); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && cuesOpen) { cuesOpen = false; render(); return; }
    const tag = (e.target && e.target.tagName) || "";
    if ($("view-today").hidden || /INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    const d = dayFor(plan, sel); if (!d || d.skipped) return;
    const keys = dayItems(d).map((it) => itemKey(d.date, it)), i = keys.indexOf(openItem);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { if (i < keys.length - 1) { e.preventDefault(); select(keys[i + 1]); } }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { if (i > 0) { e.preventDefault(); select(keys[i - 1]); } }
  });
}

async function pickStore() {
  if (window.claude && window.claude.use) {
    const db = await window.claude.use("db").catch(() => null);
    if (db) return (await import("./dbstore.js")).createDbStore(db);
    return null;                                    // in claude.ai but the database isn't available in this view
  }
  return (await import("./store.js")).createLocalStore();
}

async function boot() {
  document.body.classList.add("plan-page");   // the cloud page has no <body> tag of its own to carry it
  wireTabs(); wireHistory(); wireKeys(); wireHead();
  $("day").append(el("div", { class: "empty-card" }, el("h2", { text: "Loading your plan…" })));
  store = await pickStore();
  if (!store) { $("day").textContent = ""; $("day").append(el("div", { class: "banner", text: "Your plan can't load in this view. Open Between Blocks from your artifacts on claude.ai while signed in." })); return; }
  if (inCloud()) { $("btn-export").hidden = true; store.onChange = async () => { plan = await store.plan(); await refresh(); render(); }; }
  try { plan = await store.plan(); }
  catch { $("day").textContent = ""; $("day").append(el("div", { class: "banner", text: "Couldn't load data/plan.json. Serve the folder over http (see README), don't open the file directly." })); return; }
  $("day").textContent = "";
  await refresh();
  const want = params.get("day");
  sel = want && dayFor(plan, want) ? want : pickDay(plan);
  await render();
  if (!inCloud() && "serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
