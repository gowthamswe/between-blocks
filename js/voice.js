// Plays coach utterances. Prefers prerecorded clips (natural voice, no delay) listed in
// audio/manifest.json; anything without a clip is spoken by the browser's own voice.
//
// Queue rules: one thing at a time; at most 2 waiting; rep counts are dropped rather than
// queued behind something else, so the coach never falls behind the set.

export function createVoice({ base = "audio/", rate = 1.05 } = {}) {
  let ctx = null;
  let manifest = null;     // { voice, clips: { id: filename } }
  const buffers = new Map();
  const queue = [];
  let busy = false;
  let enabled = true;
  let ttsVoice = null;
  let onSpeak = () => {};

  async function loadManifest() {
    try {
      const r = await fetch(base + "manifest.json", { cache: "no-cache" });
      if (r.ok) manifest = await r.json();
    } catch { manifest = null; }
    return manifest;
  }

  function pickTtsVoice() {
    if (!("speechSynthesis" in window)) return null;
    const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    if (!vs.length) return null;
    // best-sounding voices first: Apple Premium/Enhanced, Google's online voices, then anything English
    const rank = (v) => (/premium/i.test(v.name) ? 0 : /enhanced/i.test(v.name) ? 1 : /natural|neural/i.test(v.name) ? 2
      : /google us english/i.test(v.name) ? 3 : /google/i.test(v.name) ? 4 : /samantha|zoe|ava|evan|nathan/i.test(v.name) ? 5 : 9);
    return vs.sort((a, b) => rank(a) - rank(b))[0];
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    ttsVoice = pickTtsVoice();
    speechSynthesis.onvoiceschanged = () => { ttsVoice = pickTtsVoice(); };
  }

  // Must be called from a tap/click: browsers only allow sound after the user interacts.
  async function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") await ctx.resume();
    if ("speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(""); speechSynthesis.speak(u); }
    if (!manifest) await loadManifest();
    preload();
  }

  async function preload() {
    if (!ctx || !manifest?.clips) return;
    await Promise.all(Object.entries(manifest.clips).map(async ([id, file]) => {
      if (buffers.has(id)) return;
      try {
        const r = await fetch(base + file);
        if (!r.ok) return;
        buffers.set(id, await ctx.decodeAudioData(await r.arrayBuffer()));
      } catch { /* missing or undecodable clip: browser voice covers it */ }
    }));
  }

  function playClip(buf) {
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination);
      src.onended = resolve; src.start();
    });
  }

  function speakTts(text) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      if (ttsVoice) u.voice = ttsVoice;
      u.rate = rate; u.pitch = 1;
      u.onend = resolve; u.onerror = resolve;
      speechSynthesis.speak(u);
      setTimeout(resolve, 4000); // never let a stuck utterance block the queue
    });
  }

  async function pump() {
    if (busy) return;
    const u = queue.shift();
    if (!u) return;
    busy = true;
    onSpeak(u);
    const buf = buffers.get(u.id);
    try { if (buf && ctx) await playClip(buf); else await speakTts(u.text); } catch { /* keep going */ }
    busy = false;
    pump();
  }

  function say(list) {
    if (!enabled) { list.forEach((u) => onSpeak(u)); return; }
    for (const u of list) {
      if (u.kind === "count" && (busy || queue.length)) continue;
      if (queue.length >= 2) queue.splice(queue.findIndex((q) => q.kind === "count") >= 0 ? queue.findIndex((q) => q.kind === "count") : 0, 1);
      queue.push(u);
    }
    pump();
  }

  function stop() { queue.length = 0; if ("speechSynthesis" in window) speechSynthesis.cancel(); }

  return {
    unlock, say, stop, loadManifest,
    set enabled(v) { enabled = v; if (!v) stop(); }, get enabled() { return enabled; },
    set onSpeak(fn) { onSpeak = fn || (() => {}); },
    get source() { return buffers.size ? `${manifest?.voice || "recorded"} voice (${buffers.size} clips)` : ttsVoice ? `browser voice: ${ttsVoice.name}` : "browser voice"; },
  };
}
