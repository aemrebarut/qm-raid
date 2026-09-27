# Narration generator (raid-video-vo). Local Kokoro-82M, no API keys.
# Usage: <venv>/bin/python tts.py lines.json <outdir> [id ...]
# Writes <outdir>/<id>.wav (24 kHz mono) for each line; manifest.py measures durations.
import json, sys, os
import numpy as np, soundfile as sf
from kokoro import KPipeline

lines = json.load(open(sys.argv[1]))["lines"]
out = sys.argv[2]
only = set(sys.argv[3:])
os.makedirs(out, exist_ok=True)
pipes = {}
for ln in lines:
    if only and ln["id"] not in only:
        continue
    voice = ln["voice"]
    lang = voice[0]  # 'a' American, 'b' British
    if lang not in pipes:
        pipes[lang] = KPipeline(lang_code=lang)
    chunks = [a for _, _, a in pipes[lang](ln["say"], voice=voice, speed=ln.get("speed", 1.0))]
    gap = np.zeros(int(24000 * 0.12), dtype=np.float32)
    audio = np.concatenate([np.concatenate([np.asarray(c, dtype=np.float32), gap]) for c in chunks])[: -len(gap)]
    sf.write(os.path.join(out, ln["id"] + ".wav"), audio, 24000)
    print(ln["id"], round(len(audio) / 24000, 2), "s", flush=True)
