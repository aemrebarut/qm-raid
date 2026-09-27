# Local narration fallback (raid-video-vo): Kokoro-82M, no API keys.
# Usage: <venv>/bin/python tts.py [id ...]   (reads lines.json, writes kokoro/<id>.wav, 24 kHz mono)
import json, sys, os
import numpy as np, soundfile as sf
from kokoro import KPipeline

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "kokoro")
os.makedirs(out, exist_ok=True)
cfg = json.load(open(os.path.join(here, "lines.json")))
only = set(sys.argv[1:])
pipes = {}
for ln in cfg["lines"]:
    if only and ln["id"] not in only:
        continue
    v = cfg["voices"][ln["role"]]
    voice, speed = v["kokoro"], ln.get("kokoroSpeed", v["kokoroSpeed"])
    lang = voice[0]  # 'a' American, 'b' British
    if lang not in pipes:
        pipes[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    chunks = [np.asarray(a, dtype=np.float32) for _, _, a in pipes[lang](ln.get("say", ln["text"]), voice=voice, speed=speed)]
    gap = np.zeros(int(24000 * 0.12), dtype=np.float32)
    audio = chunks[0] if len(chunks) == 1 else np.concatenate([x for c in chunks for x in (c, gap)][:-1])
    sf.write(os.path.join(out, ln["id"] + ".wav"), audio, 24000)
    print(ln["id"], round(len(audio) / 24000, 2), "s", flush=True)
