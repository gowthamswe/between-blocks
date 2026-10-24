// The plan screen: day strip, today's session, logging, progress and history.
// Push-ups, squats, glute bridges and RDLs open the camera coach (coach.html), which logs its sets back through the same store.
import { createLocalStore } from "./store.js";
import { exName, isTimed, isHold, isBodyweight, canCoach, CUES } from "./exercises.js";
import { makeFigure, gripMap, BAR_EX, ytUrl } from "./figures.js";
import { unlock as unlockAudio, beep, restBeep } from "./beep.js";
import { restKey, restAfter, nextToDo, addSet, coachSet } from "./plan.js";
import { createCamCoach } from "./camcoach.js";
import { moveFor } from "./moves.js";
import { setProgress, tickSet, undoSet, entryFromSets, timerState, nextReps, adjustReps, amount, setsFromEntry, holdState, startHold, heldSecs, beepFor } from "./plan.js";
import { itemKey, dayKey, planDays, dayFor, dayItems, pickDay, targetText, entryText, entriesFor, logDefaults, dayStatus, progress, logText } from "./plan.js";

const store = createLocalStore();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let plan = null, entries = [], done = [], sel = null, openForm = null, msg = "";
let cuesOpen = false;      // the (i) panel with form cues
let openItem = undefined;   // item key whose picture is open; undefined = pick the next one to do

// ---------- pictures: one animation loop for whatever figures are on screen ----------
let ticks = [], raf = 0;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function loop(now) { ticks.forEach((t) => t(now)); raf = ticks.length ? requestAnimationFrame(loop) : 0; }
function startTicks() { cancelAnimationFrame(raf); raf = 0; if (ticks.length && !reduceMotion) raf = requestAnimationFrame(loop); }

function media(ex) {
  const host = el("div", { class: "media fig" });
  const f = makeFigure(ex);
  f.svg.setAttribute("role", "img"); f.svg.setAttribute("aria-label", `${exName(ex)}, animated drawing`); f.svg.removeAttribute("aria-hidden");
  host.append(f.svg);
  if (f.tick) ticks.push(f.tick);
  if (BAR_EX[ex]) host.append(gripMap(ex));
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
      el("span", { class: "day-flag" }, st === "done" ? TICK() : st === "skipped" ? "SKIP" : d.kind === "Easy" ? "EASY" : st === "started" ? "•" : "")));
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
    host.append(el("div", { class: "empty-card" }, el("h2", { text: d.wasKind === "Easy" ? "Rest day skipped" : "Skipped" }),
      el("p", { text: `${shortDate(d.date)}${d.wasTitle ? ` was ${d.wasTitle.toLowerCase()}` : ""}. It was skipped in Between Blocks, and everything after it moved back a day.` })));
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

function renderMap(d, items, cur, drafts) {
  const today = dayKey(), st = dayStatus(d, entries, done);
  const map = el("aside", { class: "map" });
  map.append(el("span", { class: "s-kind", text: d.kind }),
    el("h1", { class: "map-title", text: d.title }),
    el("p", { class: "map-facts" }, shortDate(d.date) + (d.date === today ? " · today" : "") + ` · ${items.length} exercises`,
      st === "done" ? el("span", { class: "done-pill" }, TICK(), "Done") : null));
  if (d.note) map.append(el("p", { class: "coach-note", text: d.note }));
  const ol = el("ol", { class: "moves" });
  items.forEach((it, i) => {
    const key = itemKey(d.date, it), logged = entriesFor(entries, d.date, it), pr = setProgress(it, drafts[i], logged);
    const s = i === cur ? "now" : logged.length ? "done" : "todo";
    ol.append(el("li", {}, el("button", { class: "move", type: "button", "data-s": s, "data-logged": logged.length ? "1" : null, "aria-current": i === cur ? "true" : null, onclick: () => select(key) },
      el("span", { class: "move-num" }, logged.length ? TICK() : String(i + 1).padStart(2, "0")),
      el("span", { class: "move-mid" }, el("span", { class: "move-name", text: exName(it.ex) }),
        el("span", { class: "move-sub", "data-progress": !logged.length && pr.done ? "1" : null,
          text: logged.length ? "Logged " + entryText(logged[logged.length - 1]) : pr.done ? `${pr.done} of ${sets(pr.total)} done` : it.note || (canCoach(it.ex) ? "camera coach" : "") })),
      el("span", { class: "move-t", text: targetText(it) }))));
  });
  map.append(ol);
  const doneRec = done.find((x) => x.date === d.date);
  const foot = el("div", { class: "s-foot" });
  if (doneRec) foot.append(el("span", { class: "fine", text: "Session marked done." }), el("button", { class: "linkish", type: "button", text: "Undo", onclick: async () => { await store.unmarkDone(d.date); await refresh(); render(); } }));
  else if (st === "started" || st === "done") foot.append(el("button", { class: "primary", type: "button", text: "Mark session done", onclick: async () => { await store.markDone({ date: d.date }); await refresh(); render(); } }));
  if (foot.childNodes.length) map.append(foot);
  return map;
}

// ---------- set tracking: tiles next to the title (sets · reps · timer) and one big "set done" button ----------
let timerIv = 0, timerCtx = null;   // the selected item and its draft, for the live timer tile
// Countdown beeps (holds and rest). The audio is unlocked by the Start / Done taps.
let holdMode = null, beeped = new Set();
let advanceAfter = null;   // set when an exercise with no rest is finished: move on at the next render

// ---------- camera coach in the picture area ----------
// Coach turns the camera on where the drawing was; the tiles, Done, rest and moving on work as without it.
let cam = null, camKey = null, cuesData = null;
function stopCam(opts) { if (cam) cam.stop(opts); cam = null; camKey = null; }
async function startCam(d, it) {
  unlockAudio(); stopCam();
  try { cuesData = cuesData || await (await fetch("cues.json")).json(); } catch { cuesData = { cues: {}, numbers: { words: [] } }; }
  const key = itemKey(d.date, it);
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
  // rest after an exercise's last set is over: on to the next one
  const r = timerCtx.rest;
  if (r && r.advanceFrom && Date.now() >= r.restEnd && openItem === r.advanceFrom) {
    store.saveDraft(restKey(sel), { restEnd: r.restEnd });       // advance once
    timerCtx.rest = { restEnd: r.restEnd };
    advanceFrom(r.advanceFrom);
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
  // rest after every set, the last one included; after the last set it also moves on to the next exercise
  const rest = restAfter(it);
  if (rest) await store.saveDraft(restKey(d.date), r.complete ? { ...rest, advanceFrom: itemKey(d.date, it) } : rest);
  else await store.clearDraft(restKey(d.date));
  if (r.complete && !rest) advanceAfter = itemKey(d.date, it);    // no rest: move on straight away
  if (r.complete) {
    const w = isBodyweight(it.ex) ? 0 : logDefaults(it, entries, d.date).w;
    await store.addEntry(entryFromSets(it, r.sets, { day: d.date, w }));
    await store.clearDraft(itemKey(d.date, it));
    await refresh();
  } else await saveSets(d, it, r.draft);
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
  const w = isBodyweight(it.ex) ? 0 : logDefaults(it, entries, d.date).w;
  const amountLab = isTimed(it.ex) ? (isHold(it.ex) ? "sec hold" : "sec") : it.each ? "reps each side" : it.reps === 1 ? "rep" : "reps";
  const t = timerState(it, rest);
  // reps for the set you're on; the arrows change it (holds are timed, so no arrows)
  const arrows = manual && !isTimed(it.ex) && !camOn;
  const reps = arrows ? nextReps(it, draft) : amount(it);
  const step = (delta) => async (e) => { e.stopPropagation(); await saveSets(d, it, adjustReps(it, draft, delta)); render(); };
  const hold = isTimed(it.ex) ? holdState(it, draft) : null;
  const repsTile = el("div", { class: "tile tile-reps", id: "st-reps", "data-changed": arrows && reps !== amount(it) ? "1" : null, "data-tone": hold ? hold.tone : null },
    el("span", { class: "tile-big", text: hold ? hold.text : camOn ? String(cam.count) : String(reps) }),
    el("span", { class: "tile-lab", text: hold ? hold.label : camOn ? `of ${reps} ${amountLab}` : amountLab + (w ? ` · ${w} lb` : "") }),
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
        CUES[it.ex] && cuesOpen ? el("div", { class: "cue-pop", id: "cue-pop", role: "dialog", "aria-label": "Form cues", onclick: (e) => e.stopPropagation() },
          el("span", { class: "cue-pop-lab", text: "Form cues" }), el("ul", { class: "cues" }, CUES[it.ex].map((c) => el("li", { text: c })))) : null),
      it.note ? el("p", { class: "st-note", text: it.note[0].toUpperCase() + it.note.slice(1) }) : null),
    tiles(d, it, draft, logged, rest, camOn)));

  const acts = el("div", { class: "ctrls" });
  if (!logged.length) {
    if (camOn) acts.append(el("button", { class: "ghost-btn", type: "button", text: "Stop camera", onclick: () => { stopCam(); render(); } }));
    else if (canCoach(it.ex)) acts.append(el("button", { class: "play-btn coach-btn", type: "button", text: "Coach", onclick: () => startCam(d, it) }));
    const setCls = canCoach(it.ex) && !camOn ? "ghost-btn" : "play-btn";   // with a camera coach, ticking by hand is the fallback
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
  if (acts.childNodes.length) stage.append(acts);
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
  stage.append(camOn ? el("div", { class: "media cam-media" }, cam.el) : media(it.ex));

  const nx = items.slice(cur + 1).find((x) => !entriesFor(entries, d.date, x).length) || items[cur + 1];
  if (nx) {
    const pic = makeFigure(nx.ex, true).svg;
    stage.append(el("button", { class: "next", type: "button", onclick: () => select(itemKey(d.date, nx)) },
      el("span", { class: "next-img" }, pic),
      el("span", { class: "next-txt" }, el("span", { class: "next-lab", text: "Next up" }), el("span", { class: "next-name", text: exName(nx.ex) }), el("span", { class: "next-t", text: targetText(nx) + (nx.rest ? ` · rest ${nx.rest} s` : "") }))));
  }
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
  const rows = progress(entries);
  if (!rows.length) { ul.append(el("li", { class: "empty", text: "Nothing logged yet." })); return; }
  const chip = { up: "up", down: "down", same: "same", new: "new" };
  rows.forEach((r) => ul.append(el("li", {},
    el("span", { class: "p-name", text: r.name }),
    el("span", { class: "p-meta" }, el("span", { class: "chip-t", "data-s": r.trend, text: chip[r.trend] }), el("span", { class: "p-cur", text: entryText(r.last) })),
    el("span", { class: "p-trail", text: r.trail.join(" → ") + `   last ${shortDate(r.last.day || dayKey(r.last.ts))}` + (r.last.src === "coach" ? ` · form ${r.last.form}/100` : "") }))));
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

// ---------- tabs ----------
function wireTabs() {
  const tabs = ["today", "progress", "history"];
  tabs.forEach((t) => $("tab-" + t).addEventListener("click", () => {
    if (t !== "today") stopCam();
    tabs.forEach((u) => { $("tab-" + u).setAttribute("aria-selected", u === t ? "true" : "false"); $("view-" + u).hidden = u !== t; });
    render();
  }));
}

async function render() {
  ticks = []; timerCtx = null;
  $("foot").textContent = `Plan updated ${plan.updated || "?"} · progress saved in this browser (${entries.length} entries) · camera coach for push-ups, squats, glute bridges and RDLs`;
  renderWeek();
  await renderDay();
  if (advanceAfter) { const k = advanceAfter; advanceAfter = null; advanceFrom(k); return; }
  startTicks();
  if (timerCtx) startTimer(); else clearInterval(timerIv);
  if (!$("view-progress").hidden) renderProgress();
  if (!$("view-history").hidden) renderHistory();
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

async function boot() {
  wireTabs(); wireHistory(); wireKeys();
  try { plan = await store.plan(); }
  catch { $("day").append(el("div", { class: "banner", text: "Couldn't load data/plan.json. Serve the folder over http (see README), don't open the file directly." })); return; }
  await refresh();
  const want = params.get("day");
  sel = want && dayFor(plan, want) ? want : pickDay(plan);
  await render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
