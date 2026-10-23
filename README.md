# Between Blocks Coach

A push-up coach that runs in the browser. It watches you through the camera, counts reps, scores each one, and talks you through the set like a trainer: short cues at the top of a rep, only when a mistake keeps happening, and a quick "that's it" when you fix it.

Everything runs on your device. No video is recorded or uploaded.

**Status:** your Between Blocks plan now lives here too. Open the app to see today's session, log each exercise, and use the camera coach for push-ups (other exercises are logged by hand). Squats and pull-ups come next for the coach.

## The plan and your progress

- `data/plan.json` is the plan, copied from the Between Blocks artifact on 2026-10-23 (10 days, Oct 14–23). Claude writes this file; the app only reads it.
- `data/history.json` is the log exported from Between Blocks (73 entries, 10 finished sessions). The app copies it into the browser once, on first open.
- Everything you log after that is saved **in this browser only** (localStorage, keys `bb.*`). It isn't synced to other devices or back to the Between Blocks artifact.
- **Push-ups:** tap *Coach with camera*. The coach takes the plan's target (e.g. 3 × 8), counts sets 1 of 3, runs the rest timer, and keeps finished sets if the page reloads. *Save to plan* logs all sets with the form score and takes you back.
- **History → Copy last 14 days for Claude** gives Claude a plain-text log to plan the next days. **Download all progress** saves a JSON with the plan, every entry and the finished sessions. That file is what moves into shared storage later.

### Syncing to Between Blocks (stopgap)

Until there's shared storage, Claude copies your progress into the Between Blocks artifact on request:

1. Run the app with `npm run serve`, not `python3 -m http.server`. On every change the app sends its log to the server, which writes `data/progress.json` (gitignored).
2. Ask Claude to "sync to Between Blocks". Claude dumps the artifact's `entries` and `done`, runs `node tools/bb-sync.mjs <dump-dir> writes.json`, and applies the writes in one batch.

The sync is one-way (this app → Between Blocks). Records it writes carry `via: "bb-coach"`. Something you log directly in Between Blocks is reported but never deleted, and it doesn't show up here, so log in this app.

All storage goes through `js/store.js`. Its methods are async, so a shared backend (Claude writes the plan, the app reads it and writes progress) can replace localStorage without touching the screens.

## What it checks (push-ups, filmed side-on)

| Check | How it's measured | Cue |
|---|---|---|
| Depth | Elbow angle at the bottom. Under 95° is full depth; 95–120° counts but is flagged; above 120° doesn't count. | "Go lower" |
| Hips sagging | Hips more than 5% of body length below the shoulder-to-ankle line | "Hips up" |
| Hips piking | Hips more than 7% above that line | "Hips down a little" |
| Rushing | Lowering faster than 1 second (the plan asks for about 2) | "Slow it down" |

Each rep starts at 100 and loses points per fault (sag −25, shallow −20, pike −15, rushing −10).

## What it checks (squats, filmed side-on)

Bodyweight and goblet squats in the plan open the same coach with squat settings (`js/squat.js`, thresholds in `DEFAULTS`).

| Check | How it's measured | Cue |
|---|---|---|
| Depth | Thigh angle at the bottom. Within 15° of level (or below) is full depth. The knee must bend to at least 120° for the rep to count | "Sit a little deeper" |
| Heels | Heel rising more than 10% of shin length from where it sat standing. Skipped if the camera can't see the heel | "Keep your heels down" |
| Chest | Torso more than 50° from vertical near the bottom (40° for goblet squats) | "Chest up" |
| Rushing | Sitting down faster than 1 second (the plan asks for about 2) | "Sit down slowly" |

Penalties: shallow −20, heels −20, chest −15, rushing −10. A big heel lift is corrected right away. The side view can't see knees caving in; that needs a front camera. For goblet squats the coach shows a dumbbell weight (starting at the last weight logged) and logs it with the sets.

Squat phrases are the `sq_*` entries in `cues.json`. Until you rerun `tools/make_voice.py`, they're spoken in the browser's voice.

## What it checks (glute bridges, filmed side-on)

Lying on your back, knees bent, camera at floor height (`js/bridge.js`). The rep is counted when your hips come back down, so the squeeze and the lowering can be judged. The squeeze time comes from the plan note ("3-second squeeze at the top" = 3 s; otherwise 1 s). While you hold, the screen counts the seconds, and the coach says "and down" when you've held long enough.

| Check | How it's measured | Cue |
|---|---|---|
| Hips all the way up | Shoulder-hip-knee angle at the top. 170° or more is full; under 160° doesn't count | "Hips higher" |
| Arching | Hips pushed more than 12° past the shoulder-knee line | "Ribs down" |
| Squeeze | Time held near the top, against the plan's squeeze (0.3 s slack). A slow rise doesn't count as holding | "Hold the squeeze at the top" |
| Dropping | Lowering from the squeeze faster than about 0.75 s | "Lower slowly" |

Penalties: low −20, squeeze −15, arch −15, dropping −10. One-leg bridges aren't coached yet: the side view can't see your hips tilting or twisting.

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
npm run serve        # node, no installs; also keeps data/progress.json for syncing
```

Open http://localhost:8000 in Chrome for the plan. The coach is at http://localhost:8000/coach.html; open it from a push-up item so it picks up the target.

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

When you open the coach from the plan, *Save to plan* logs it for you. The summary line is still there to paste to Claude.

## Files

```
index.html            the plan: today, progress, history
coach.html            the camera coach
css/app.css           styles (coach, and the shared colors)
css/plan.css          plan screen styles
js/planapp.js         plan screen: day strip, logging, progress, history, export
js/plan.js            plan + progress logic (no browser code, testable)
js/store.js           where the plan and progress live (today: data/ + localStorage)
js/exercises.js       exercise names and form cues, as in Between Blocks
data/plan.json        the plan (written by Claude)
data/history.json     log exported from Between Blocks, seeds the browser once
js/app.js             coach: camera → pose → analysis → coach → voice, plus drawing
js/pose.js            loads MediaPipe Pose Landmarker (runs in the browser, GPU when available)
js/pushup.js          push-up geometry, rep phases, faults, score (no browser code, testable)
js/coach.js           what to say and when, and the set summary (no browser code, testable)
js/voice.js           plays recorded clips, falls back to the browser's voice
cues.json             every phrase the coach can say
tools/make_voice.py   generates the voice clips (Kokoro or macOS voices)
tools/serve.mjs       local server; mirrors progress to data/progress.json
tools/bb-sync.mjs     plans the sync of data/progress.json into Between Blocks
sw.js, manifest.webmanifest, icons/   installable app + offline cache
tests/                node tests on synthetic push-ups
```

## Tests

```sh
npm test        # node --test, no installs needed
```

`tests/plan.test.js` checks the copied plan and history, how logged entries match plan items, coach sets turning into one entry, progress trends, the text log for Claude, and the local store (seeding once, drafts surviving a reload, export).

The tests generate fake side-on push-ups (clean, sagging, piking, shallow, rushed, half reps, losing the pose mid-rep) and check the counting, the faults, and the coach's timing rules.

## Next

- Shared storage for the plan and progress, per user: Claude writes the plan, the app reads it and writes progress. Then hosting.

- Tune the thresholds on real sets (Settings → "Show angles").
- Add squats and goblet squats (side view), then dead hangs, negatives and band pull-ups (front view, on the power tower).
- A short spoken summary between sets ("last two reps sagged; squeeze your glutes this set").
