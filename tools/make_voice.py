#!/usr/bin/env python3
"""Generate the coach's voice clips from cues.json, so it sounds like a person, not a robot.

Run this once on your Mac; it writes audio/<clip>.mp3 (or .wav / .m4a) and audio/manifest.json.
The app plays these clips and falls back to the browser's voice for anything missing.

Engines
  kokoro  (default) Free neural voice that runs locally. Natural, fast on Apple Silicon.
            python3 -m pip install "kokoro>=0.9.4" soundfile numpy
            brew install espeak-ng ffmpeg        # espeak-ng: pronunciation fallback; ffmpeg: mp3 output
  say     macOS built-in voices, no installs. Download a Premium voice first:
            System Settings > Accessibility > Spoken Content > System voice > Manage Voices

Examples
  python3 tools/make_voice.py                          # kokoro, voice am_michael
  python3 tools/make_voice.py --voice af_heart         # a different kokoro voice
  python3 tools/make_voice.py --preview                # hear a few voices first (macOS afplay)
  python3 tools/make_voice.py --engine say --voice "Zoe (Premium)"
  python3 tools/make_voice.py --only sag,praise        # regenerate some cues only
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CUES = ROOT / "cues.json"
OUT = ROOT / "audio"
KOKORO_VOICES = ["am_michael", "am_adam", "am_fenrir", "af_heart", "af_bella", "af_nicole"]
RATE = 24000


def clip_list(only=None):
    data = json.loads(CUES.read_text())
    clips = []
    for cue_id, variants in data["cues"].items():
        if only and cue_id not in only:
            continue
        for i, text in enumerate(variants):
            clips.append((f"{cue_id}_{i}", text))
    if not only or "numbers" in only:
        for n, word in enumerate(data["numbers"]["words"][: data["numbers"]["max"]], start=1):
            clips.append((f"n_{n}", word))
    return clips


def trim(audio, thresh=0.01, pad=int(0.04 * RATE)):
    import numpy as np
    idx = np.where(np.abs(audio) > thresh)[0]
    if not len(idx):
        return audio
    return audio[max(0, idx[0] - pad): min(len(audio), idx[-1] + pad)]


def kokoro_engine(voice, speed):
    try:
        from kokoro import KPipeline
        import numpy as np
        import soundfile as sf
    except ImportError:
        sys.exit('Kokoro is not installed. Run:  python3 -m pip install "kokoro>=0.9.4" soundfile numpy')
    lang = "b" if voice.startswith("b") else "a"
    pipe = KPipeline(lang_code=lang)

    def render(text, wav_path):
        parts = [a for _, _, a in pipe(text, voice=voice, speed=speed)]
        audio = np.concatenate([p.numpy() if hasattr(p, "numpy") else p for p in parts])
        sf.write(wav_path, trim(audio), RATE)
    return render


def say_engine(voice, speed):
    if not shutil.which("say"):
        sys.exit("The 'say' engine needs macOS.")
    wpm = str(int(185 * speed))

    def render(text, aiff_path):
        subprocess.run(["say", "-v", voice, "-r", wpm, "-o", str(aiff_path), text], check=True)
    return render


def encode(src, dest_stem, fmt):
    """Convert a rendered clip to the output format. Returns the output file name."""
    if fmt == "mp3":
        dest = dest_stem.with_suffix(".mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-b:a", "64k", str(dest)], check=True)
    elif fmt == "m4a":
        dest = dest_stem.with_suffix(".m4a")
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", str(src), str(dest)], check=True)
    else:
        dest = dest_stem.with_suffix(".wav")
        if src.suffix == ".wav":
            shutil.copy(src, dest)
        else:
            subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16", str(src), str(dest)], check=True)
    return dest.name


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", choices=["kokoro", "say"], default="kokoro")
    ap.add_argument("--voice", default=None, help="kokoro: am_michael (default), af_heart, ...  say: e.g. 'Zoe (Premium)'")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--format", choices=["auto", "mp3", "wav", "m4a"], default="auto")
    ap.add_argument("--only", default="", help="comma-separated cue ids to regenerate (use 'numbers' for counts)")
    ap.add_argument("--preview", action="store_true", help="speak one line in several voices and exit (macOS)")
    args = ap.parse_args()

    voice = args.voice or ("am_michael" if args.engine == "kokoro" else "Samantha")
    make = kokoro_engine if args.engine == "kokoro" else say_engine

    if args.preview:
        with tempfile.TemporaryDirectory() as tmp:
            voices = KOKORO_VOICES if args.engine == "kokoro" else [voice]
            for v in voices:
                p = Path(tmp) / f"{v}.{'wav' if args.engine == 'kokoro' else 'aiff'}"
                make(v, args.speed)("Hips up. Squeeze your glutes. That's it, keep that.", p)
                print("Playing", v)
                subprocess.run(["afplay", str(p)])
        return

    fmt = args.format
    if fmt == "auto":
        fmt = "mp3" if shutil.which("ffmpeg") else ("m4a" if shutil.which("afconvert") else "wav")
    only = {s.strip() for s in args.only.split(",") if s.strip()} or None
    render = make(voice, args.speed)
    OUT.mkdir(exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if (only and manifest_path.exists()) else {"clips": {}}

    clips = clip_list(only)
    with tempfile.TemporaryDirectory() as tmp:
        for i, (clip_id, text) in enumerate(clips, 1):
            raw = Path(tmp) / (clip_id + (".wav" if args.engine == "kokoro" else ".aiff"))
            render(text, raw)
            manifest["clips"][clip_id] = encode(raw, OUT / clip_id, fmt)
            print(f"[{i}/{len(clips)}] {clip_id}: {text}")

    manifest.update({"voice": voice, "engine": args.engine})
    manifest_path.write_text(json.dumps(manifest, indent=1))
    print(f"\nWrote {len(clips)} clips to {OUT} ({fmt}). Reload the app to hear them.")


if __name__ == "__main__":
    main()
