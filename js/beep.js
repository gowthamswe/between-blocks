// Countdown beeps for holds and rest, shared by the plan screen and the camera coach.
// Browsers only play sound after a tap, so call unlock() inside a click (Start, Done, Next set).
let ctx = null;

export function unlock() {
  try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === "suspended") ctx.resume(); } catch { ctx = null; }
}

// short = a 3-2-1 tick; long = go / time's up
export function beep(long = false) {
  if (!ctx) return;
  try {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), dur = long ? 0.45 : 0.12;
    o.type = "sine"; o.frequency.value = long ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch { /* no sound */ }
}

// Which beep belongs to this moment of a rest that ends at restEnd: 3-2-1, then a long one at 0.
// The key includes restEnd, so each rest beeps once per second even though callers poll faster.
// A rest that ended more than 2 s ago (say, the page was reopened later) stays quiet.
export function restBeep(restEnd, now = Date.now()) {
  if (!restEnd) return null;
  const left = Math.ceil((restEnd - now) / 1000);
  if (left >= 1 && left <= 3) return { key: `rest:${restEnd}:${left}`, long: false };
  if (left <= 0 && now - restEnd < 2000) return { key: `rest:${restEnd}:go`, long: true };
  return null;
}
