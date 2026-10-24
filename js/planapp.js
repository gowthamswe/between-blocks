// The plan screen: day strip, today's session, logging, progress and history.
// Push-ups, squats, glute bridges and RDLs open the camera coach (coach.html), which logs its sets back through the same store.
import { createLocalStore } from "./store.js";
import { exName, isTimed, isBodyweight, canCoach, CUES } from "./exercises.js";
import { makeFigure, gripMap, BAR_EX, ytUrl } from "./figures.js";
import { setProgress, tickSet, undoSet, manualEntry, timerState } from "./plan.js";
import { dayKey, planDays, dayFor, dayItems, pickDay, targetText, entryText, entriesFor, logDefaults, dayStatus, progress, logText } from "./plan.js";

const store = createLocalStore();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let plan = null, entries = [], done = [], sel = null, openForm = null, msg = "";
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
const itemKey = (date, it) => `${date}.${it.block}.${it.idx}`;
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
      onclick: () => { sel = d.date; openForm = null; openItem = undefined; msg = ""; history.replaceState(null, "", "?day=" + d.date); render(); } },
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
  board.append(renderMap(d, items, cur, drafts), await renderStage(d, items, cur, drafts[cur]));
  host.append(board);
}

function select(key) {
  openItem = key; openForm = null; render();
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
          text: logged.length ? "Logged " + entryText(logged[logged.length - 1]) : pr.done ? `${pr.done} of ${pr.total} sets done` : it.note || (canCoach(it.ex) ? "camera coach" : "") })),
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
function paintTimer() {
  const host = $("st-timer"); if (!host || !timerCtx) return;
  const t = timerState(timerCtx.item, timerCtx.draft);
  host.dataset.tone = t.tone;
  host.querySelector(".tile-big").textContent = t.text;
  host.querySelector(".tile-lab").textContent = t.label;
}
function startTimer() { clearInterval(timerIv); paintTimer(); timerIv = setInterval(paintTimer, 250); }

async function saveSets(d, it, draft) {
  const key = itemKey(d.date, it);
  if (draft) await store.saveDraft(key, draft); else await store.clearDraft(key);
}
async function finishSet(d, it, draft) {
  const held = draft && draft.holdStart ? (Date.now() - draft.holdStart) / 1000 : null;
  const r = tickSet(it, draft, { held });
  if (r.complete) {
    const w = isBodyweight(it.ex) ? 0 : logDefaults(it, entries, d.date).w;
    await store.addEntry(manualEntry(it, r, { day: d.date, w }));
    await store.clearDraft(itemKey(d.date, it));
    await refresh();
  } else await saveSets(d, it, r.draft);
  render();
}

function tiles(d, it, draft, logged) {
  const pr = setProgress(it, draft, logged), manual = !canCoach(it.ex) && !pr.logged;
  const bars = el("div", { class: "bars", role: "group", "aria-label": `${pr.done} of ${pr.total} sets done` });
  for (let i = 0; i < pr.total; i++) {
    const s = i < pr.done ? "done" : i === pr.done && !pr.logged ? "now" : "todo";
    // tap the next bar to tick a set off, or the last filled one to undo it
    const act = !manual ? null : i === pr.done && !isTimed(it.ex) ? () => finishSet(d, it, draft)
      : i === pr.done - 1 ? async () => { await saveSets(d, it, undoSet(draft)); render(); } : null;
    bars.append(act ? el("button", { class: "bar", type: "button", "data-s": s, "aria-label": s === "now" ? `Set ${i + 1} done` : `Undo set ${i + 1}`, onclick: act })
      : el("span", { class: "bar", "data-s": s }));
  }
  const setsLab = pr.logged ? `${pr.done} sets ✓` : pr.done ? `${pr.done} of ${pr.total} sets` : `${pr.total} sets`;
  const w = isBodyweight(it.ex) ? 0 : logDefaults(it, entries, d.date).w;
  const amountLab = isTimed(it.ex) ? "sec hold" : it.each ? "reps each side" : it.reps === 1 ? "rep" : "reps";
  const t = timerState(it, draft);
  return el("div", { class: "tiles" },
    el("div", { class: "tile tile-sets", "data-done": pr.logged ? "1" : null }, bars, el("span", { class: "tile-lab", text: setsLab })),
    el("div", { class: "tile" }, el("span", { class: "tile-big", text: String(isTimed(it.ex) ? it.secs : it.reps) }),
      el("span", { class: "tile-lab", text: amountLab + (w ? ` · ${w} lb` : "") })),
    el("div", { class: "tile tile-timer", id: "st-timer", "data-tone": t.tone }, el("span", { class: "tile-big", text: t.text }), el("span", { class: "tile-lab", text: t.label })));
}

async function renderStage(d, items, cur, draft) {
  const it = items[cur], key = itemKey(d.date, it);
  const logged = entriesFor(entries, d.date, it);
  const pr = setProgress(it, draft, logged);
  timerCtx = { item: it, draft };
  const stage = el("div", { class: "stage", id: "stage" });
  stage.append(el("div", { class: "st-head" },
    el("div", { class: "st-titles" }, el("span", { class: "st-step", text: `${cur + 1} of ${items.length}` }), el("h2", { class: "st-name", text: exName(it.ex) }),
      it.note ? el("p", { class: "st-note", text: it.note[0].toUpperCase() + it.note.slice(1) }) : null),
    tiles(d, it, draft, logged)));

  const acts = el("div", { class: "ctrls" });
  acts.append(el("button", { class: "ic-btn", type: "button", "aria-label": "Previous exercise", disabled: cur === 0, onclick: () => select(itemKey(d.date, items[cur - 1])), text: "←" }));
  if (!logged.length) {
    const n = pr.done + 1;
    if (canCoach(it.ex)) {
      acts.append(el("a", { class: "play-btn coach-btn", href: "coach.html?" + new URLSearchParams({ day: d.date, block: it.block, item: it.idx }), text: "Coach" }));
    } else if (isTimed(it.ex)) {
      acts.append(draft && draft.holdStart
        ? el("button", { class: "play-btn", type: "button", text: `✓ Hold done · set ${n}`, onclick: () => finishSet(d, it, draft) })
        : el("button", { class: "play-btn", type: "button", text: `Start hold · set ${n}`, onclick: async () => { await saveSets(d, it, { ...(draft || { manual: 0, held: [] }), holdStart: Date.now(), restEnd: null }); render(); } }));
    } else {
      acts.append(el("button", { class: "play-btn", type: "button", text: `✓ Set ${n} done`, onclick: () => finishSet(d, it, draft) }));
    }
    acts.append(el("button", { class: "ghost-btn", type: "button", text: openForm === key ? "Cancel" : "Log", onclick: () => { openForm = openForm === key ? null : key; render(); } }));
  }
  acts.append(el("button", { class: "ic-btn", type: "button", "aria-label": "Next exercise", disabled: cur === items.length - 1, onclick: () => select(itemKey(d.date, items[cur + 1])), text: "→" }));
  stage.append(acts);

  logged.forEach((e) => {
    const extra = e.src === "coach" ? ` · camera coach, form ${e.form}/100` : "";
    stage.append(el("div", { class: "logged" }, el("span", {}, TICK(), " Logged " + entryText(e) + extra),
      el("button", { class: "linkish", type: "button", text: "Remove", onclick: async () => { await store.removeEntry(e.id); await refresh(); render(); } })));
  });
  if (openForm === key) stage.append(logForm(d, it, draft));
  stage.append(media(it.ex));
  if (CUES[it.ex]) stage.append(el("ul", { class: "cues" }, CUES[it.ex].map((c) => el("li", { text: c }))));

  const nx = items.slice(cur + 1).find((x) => !entriesFor(entries, d.date, x).length) || items[cur + 1];
  if (nx) {
    const pic = makeFigure(nx.ex, true).svg;
    stage.append(el("button", { class: "next", type: "button", onclick: () => select(itemKey(d.date, nx)) },
      el("span", { class: "next-img" }, pic),
      el("span", { class: "next-txt" }, el("span", { class: "next-lab", text: "Next up" }), el("span", { class: "next-name", text: exName(nx.ex) }), el("span", { class: "next-t", text: targetText(nx) + (nx.rest ? ` · rest ${nx.rest} s` : "") }))));
  }
  return stage;
}

function logForm(d, it, draft) {
  const v = logDefaults(it, entries, d.date);
  const pr = setProgress(it, draft);
  if (pr.done && pr.done < it.sets) v.sets = pr.done;
  const field = (name, label, value, step = 1) => el("label", { class: "field" }, el("span", { text: label }),
    el("input", { type: "number", inputmode: "decimal", min: "0", step: String(step), name, value: String(value) }));
  const form = el("form", { class: "log-form", onsubmit: async (ev) => {
    ev.preventDefault();
    const f = new FormData(form), num = (k) => Number(f.get(k) || 0);
    if (!num("sets") || !num("reps")) return;
    await store.addEntry({ ex: it.ex, sets: num("sets"), reps: num("reps"), w: isBodyweight(it.ex) ? 0 : num("w"), day: d.date, block: it.block, item: it.idx });
    if (!canCoach(it.ex)) await store.clearDraft(itemKey(d.date, it));
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
    tabs.forEach((u) => { $("tab-" + u).setAttribute("aria-selected", u === t ? "true" : "false"); $("view-" + u).hidden = u !== t; });
    render();
  }));
}

async function render() {
  ticks = []; timerCtx = null;
  $("foot").textContent = `Plan updated ${plan.updated || "?"} · progress saved in this browser (${entries.length} entries) · camera coach for push-ups, squats, glute bridges and RDLs`;
  renderWeek();
  await renderDay();
  startTicks();
  if (timerCtx) startTimer(); else clearInterval(timerIv);
  if (!$("view-progress").hidden) renderProgress();
  if (!$("view-history").hidden) renderHistory();
}

function wireKeys() {
  document.addEventListener("keydown", (e) => {
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
