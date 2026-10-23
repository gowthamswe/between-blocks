# Between Blocks Coach

A push-up coach that runs in the browser. It watches you through the camera, counts reps, scores each one, and talks you through the set like a trainer: short cues at the top of a rep, only when a mistake keeps happening, and a quick "that's it" when you fix it.

Everything runs on your device. No video is recorded or uploaded.

**Status:** first version, push-ups only. Squats and pull-ups come next.

## What it checks (push-ups, filmed side-on)

| Check | How it's measured | Cue |
|---|---|---|
| Depth | Elbow angle at the bottom. Under 95° is full depth; 95–120° counts but is flagged; above 120° doesn't count. | "Go lower" |
| Hips sagging | Hips more than 5% of body length below the shoulder-to-ankle line | "Hips up" |
| Hips piking | Hips more than 7% above that line | "Hips down a little" |
| Rushing | Lowering faster than 1 second (the plan asks for about 2) | "Slow it down" |

Each rep starts at 100 and loses points per fault (sag −25, shallow −20, pike −15, rushing −10).

**How the coach decides what to say:**
- It speaks at the top of a rep, never mid-rep.
- At most one correction per rep, in this order: sag, depth, pike, speed.
- It corrects a fault only once it shows up in 2 of the last 3 reps. A big sag gets corrected right away.
- The same correction waits at least 3 reps before it's repeated.
- After a correction, it praises the first rep that fixes it, once.
- It rotates phrasings so it doesn't sound like a loop.

All of this is in `js/coach.js`. The thresholds are in `DEFAULTS` in `js/pushup.js`.

## Run it on your Mac

The camera only works over `https://` or `http://localhost`, so serve the folder instead of opening the file directly:

```sh
cd between-blocks
python3 -m http.server 8000
```

Open http://localhost:8000 in Chrome and allow the camera.

**Camera placement:** side-on at floor height, 2–3 m away, with your whole body in view from head to heels. Keep the room bright. The skeleton turns green when it can see you in a plank, and red at the hips when they sag or pike. Settings → "Show angles" displays the live numbers if you want to tune the thresholds.

## Give it a natural voice (recommended)

Until you generate clips, the app uses the browser's built-in voice. To use a natural neural voice, generate the clips once on your Mac:

```sh
python3 -m pip install "kokoro>=0.9.4" soundfile numpy
brew install espeak-ng ffmpeg
python3 tools/make_voice.py --preview            # hear the voices, then pick one
python3 tools/make_voice.py --voice am_michael   # writes audio/*.mp3 + audio/manifest.json
```

Kokoro needs Python 3.10–3.12. If you'd rather not install anything, macOS voices work too: download a Premium voice (System Settings → Accessibility → Spoken Content → Manage Voices), then run `python3 tools/make_voice.py --engine say --voice "Zoe (Premium)"`.

Everything the coach can say is in `cues.json`. Edit the phrasings there and rerun the script. Use `--only sag,praise` to regenerate just a few cues.

Commit the `audio/` folder so the hosted version has the voice too.

## Host it and install it on your phone

1. Push to GitHub. In the repo, go to **Settings → Pages**, set Source to "Deploy from a branch", choose `main` and `/ (root)`, then save.
2. After a minute it's live at `https://gowthamswe.github.io/between-blocks/`.
3. On your Android phone, open that address in Chrome, then use the ⋮ menu → **Install app** (or **Add to home screen**). It opens full-screen and works offline after the first load.

Auto mode uses the most accurate pose model on a laptop and the balanced one on a phone. You can change it in Settings.

## Logging

At the end of a set, the summary gives you one line, for example:

> 2026-10-23 · Push-ups: 7 reps (target 7), form score 88/100. hips sagged on 2. Avg lowering 1.9s, avg depth 90° at the elbow.

Copy it into Between Blocks, or paste it to Claude.

## Files

```
index.html            the app
css/app.css           styles
js/app.js             camera → pose → analysis → coach → voice, plus drawing
js/pose.js            loads MediaPipe Pose Landmarker (runs in the browser, GPU when available)
js/pushup.js          push-up geometry, rep phases, faults, score (no browser code, testable)
js/coach.js           what to say and when, and the set summary (no browser code, testable)
js/voice.js           plays recorded clips, falls back to the browser's voice
cues.json             every phrase the coach can say
tools/make_voice.py   generates the voice clips (Kokoro or macOS voices)
sw.js, manifest.webmanifest, icons/   installable app + offline cache
tests/                node tests on synthetic push-ups
```

## Tests

```sh
npm test        # node --test, no installs needed
```

The tests generate fake side-on push-ups (clean, sagging, piking, shallow, rushed, half reps, losing the pose mid-rep) and check the counting, the faults, and the coach's timing rules.

## Next

- Tune the thresholds on real sets (Settings → "Show angles").
- Add squats and goblet squats (side view), then dead hangs, negatives and band pull-ups (front view, on the power tower).
- A short spoken summary between sets ("last two reps sagged; squeeze your glutes this set").
