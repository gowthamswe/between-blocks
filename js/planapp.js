// The plan screen: day strip, today's session, logging, progress and history.
// Push-ups open the camera coach (coach.html), which logs its sets back through the same store.
import { createLocalStore } from "./store.js";
import { exName, isTimed, isBodyweight, canCoach, CUES } from "./exercises.js";
import { PHOTOS, photoSrc, makeFigure, gripMap, BAR_EX, ytUrl } from "./figures.js";
import { dayKey, planDays, dayFor, dayItems, pickDay, targetText, entryText, entriesFor, logDefaults, dayStatus, progress, logText } from "./plan.js";

const store = createLocalStore();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let plan = null, entries = [], done = [], sel = null, openForm = null, msg = "";
let openItem = undefined;   // item key whose picture is open; undefined = pick the next one to do

// ---------- pictures: one animation loop for whatever figures are on screen ----------
let ticks = [], raf = 0;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let figMode = "photo";
try { figMode = localStorage.getItem("bb.figMode") || "photo"; } catch { /* default */ }
function loop(now) { ticks.forEach((t) => t(now)); raf = ticks.length ? requestAnimationFrame(loop) : 0; }
function startTicks() { cancelAnimationFrame(raf); raf = 0; if (ticks.length && !reduceMotion) raf = requestAnimationFrame(loop); }

function media(ex) {
  const host = el("div", { class: "media fig" });
  const ph = PHOTOS[ex];
  if (ph && figMode === "photo") {
    const box = el("div", { class: "photo" });
    [0, 1].forEach((i) => box.append(el("img", { src: photoSrc(ex, i), alt: `${exName(ex)}, ${ph[i].toLowerCase()}` })));
    box.append(el("div", { class: "ph-lab", text: ph[0] }), el("div", { class: "ph-lab", text: ph[1] }));
    host.append(box);
  } else {
    const f = makeFigure(ex);
    host.append(f.svg);
    if (f.tick) ticks.push(f.tick);
  }
  if (ph) host.append(el("button", { class: "fig-toggle", type: "button", text: figMode === "photo" ? "Show drawing" : "Show photo",
    onclick: (e) => { e.stopPropagation(); figMode = figMode === "photo" ? "draw" : "photo"; try { localStorage.setItem("bb.figMode", figMode); } catch { /* ignore */ } render(); } }));
  if (BAR_EX[ex]) host.append(gripMap(ex));
  const yt = el("a", { class: "yt", href: ytUrl(ex, exName(ex)), target: "_blank", rel: "noopener", "aria-label": "Find a demo video on YouTube", title: "Find a demo video" });
  yt.innerHTML = '<svg viewBox="0 0 26 18" aria-hidden="true"><path fill="#fff" d="M10 3.5v11l9-5.5z"/></svg>';
  host.append(yt);
  return host;
}
function thumb(ex) {
  if (PHOTOS[ex]) return el("span", { class: "thumb ph" }, el("img", { src: photoSrc(ex, 0), alt: "", loading: "lazy" }));
  return el("span", { class: "thumb fig" }, makeFigure(ex, true).svg);
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

// ---------- the selected day ----------
async function renderDay() {
  const host = $("day"); host.textContent = "";
  const today = dayKey(), days = planDays(plan);
  if (!days.length) { host.append(el("div", { class: "empty-card" }, el("h2", { text: "No plan yet" }), el("p", { text: "Ask Claude for a plan; it goes in data/plan.json." }))); return; }
  const last = days[days.length - 1].date;
  if (today > last) host.append(el("div", { class: "banner", text: `The plan ended on ${shortDate(last)}. Open History, copy your log, and ask Claude for the next days.` }));

  const d = dayFor(plan, sel);
  if (!d) return;
  const st = dayStatus(d, entries, done);
  const card = el("article", { class: "session" });
  card.append(el("div", { class: "s-head" },
    el("div", {}, el("span", { class: "s-kind", text: d.skipped ? "Skipped" : d.kind }), el("h1", { class: "s-title", text: d.skipped ? (d.wasTitle ? `Skipped (was ${d.wasTitle.toLowerCase()})` : "Skipped") : d.title }),
      el("p", { class: "s-date", text: shortDate(d.date) + (d.date === today ? " · today" : "") })),
    st === "done" ? el("span", { class: "done-pill" }, TICK(), "Done") : null));
  if (d.skipped) { card.append(el("p", { class: "s-note", text: "This day was skipped in Between Blocks and everything after it moved back a day." })); host.append(card); return; }
  if (d.note) card.append(el("p", { class: "s-note", text: d.note }));

  const list = el("ol", { class: "items" });
  const items = dayItems(d);
  if (openItem === undefined) {
    const next = items.find((it) => !entriesFor(entries, d.date, it).length);
    openItem = next ? itemKey(d.date, next) : null;
  }
  for (let n = 0; n < items.length; n++) list.append(await renderItem(d, items[n], n + 1));
  card.append(list);

  const doneRec = done.find((x) => x.date === d.date);
  const foot = el("div", { class: "s-foot" });
  if (doneRec) foot.append(el("span", { class: "fine", text: "Session marked done." }), el("button", { class: "linkish", type: "button", text: "Undo", onclick: async () => { await store.unmarkDone(d.date); await refresh(); render(); } }));
  else if (st === "started" || st === "done") foot.append(el("button", { class: "primary", type: "button", text: "Mark session done", onclick: async () => { await store.markDone({ date: d.date }); await refresh(); render(); } }));
  card.append(foot);
  host.append(card);
}

async function renderItem(d, it, n) {
  const logged = entriesFor(entries, d.date, it);
  const key = itemKey(d.date, it);
  const draft = canCoach(it.ex) ? await store.draft(key) : null;
  const li = el("li", { class: "item", "data-s": logged.length ? "done" : draft ? "started" : "todo" });
  const facts = [targetText(it), it.rest ? `rest ${it.rest} s` : null].filter(Boolean).join(" · ");
  const open = openItem === key;
  li.dataset.open = open ? "1" : "0";
  const toggle = () => { openItem = open ? null : key; render(); };
  li.append(el("div", { class: "i-head", role: "button", tabindex: "0", "aria-expanded": open ? "true" : "false",
      onclick: toggle, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } },
    el("span", { class: "i-num" }, logged.length ? TICK() : String(n)),
    el("div", { class: "i-main" },
      el("div", { class: "i-name", text: exName(it.ex) }),
      el("div", { class: "i-target", text: facts }),
      it.note ? el("div", { class: "i-note", text: it.note }) : null),
    open ? null : thumb(it.ex)));

  const body = el("div", { class: "i-body" });
  if (open) body.append(media(it.ex));
  if (CUES[it.ex]) body.append(el("details", { class: "cues", open: open }, el("summary", { text: "Form cues" }), el("ul", {}, CUES[it.ex].map((c) => el("li", { text: c })))));
  logged.forEach((e) => {
    const extra = e.src === "coach" ? ` · camera coach, form ${e.form}/100` : "";
    body.append(el("div", { class: "logged" }, el("span", { text: "Logged " + entryText(e) + extra }),
      el("button", { class: "linkish", type: "button", text: "Remove", onclick: async () => { await store.removeEntry(e.id); await refresh(); render(); } })));
  });

  const acts = el("div", { class: "i-acts" });
  if (canCoach(it.ex) && !logged.length) {
    const q = new URLSearchParams({ day: d.date, block: it.block, item: it.idx });
    const label = draft && draft.sets && draft.sets.length ? `Continue with coach (${draft.sets.length} of ${it.sets} sets)` : "Coach with camera";
    acts.append(el("a", { class: "primary", href: "coach.html?" + q, text: label }));
  }
  if (!logged.length) acts.append(el("button", { class: "ghost", type: "button", text: openForm === key ? "Cancel" : "Log", onclick: () => { openForm = openForm === key ? null : key; render(); } }));
  if (acts.childNodes.length) body.append(acts);
  if (openForm === key) body.append(logForm(d, it));
  li.append(body);
  return li;
}

function logForm(d, it) {
  const v = logDefaults(it, entries, d.date);
  const field = (name, label, value, step = 1) => el("label", { class: "field" }, el("span", { text: label }),
    el("input", { type: "number", inputmode: "decimal", min: "0", step: String(step), name, value: String(value) }));
  const form = el("form", { class: "log-form", onsubmit: async (ev) => {
    ev.preventDefault();
    const f = new FormData(form), num = (k) => Number(f.get(k) || 0);
    if (!num("sets") || !num("reps")) return;
    await store.addEntry({ ex: it.ex, sets: num("sets"), reps: num("reps"), w: isBodyweight(it.ex) ? 0 : num("w"), day: d.date, block: it.block, item: it.idx });
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
  ticks = [];
  renderWeek();
  await renderDay();
  startTicks();
  if (!$("view-progress").hidden) renderProgress();
  if (!$("view-history").hidden) renderHistory();
}

async function boot() {
  wireTabs(); wireHistory();
  try { plan = await store.plan(); }
  catch { $("day").append(el("div", { class: "banner", text: "Couldn't load data/plan.json. Serve the folder over http (see README), don't open the file directly." })); return; }
  await refresh();
  const want = params.get("day");
  sel = want && dayFor(plan, want) ? want : pickDay(plan);
  $("foot").textContent = `Plan updated ${plan.updated || "?"} · progress saved in this browser (${entries.length} entries) · camera coach for push-ups`;
  await render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
