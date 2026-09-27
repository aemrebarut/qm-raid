# ElevenLabs narration, sound effects and music (raid-video-vo). Kokoro (tts.py) stays the fallback.
# Usage: python3 eleven.py [vo|sfx|music ...] [id ...]   (default: everything)
# Reads ELEVENLABS_API_KEY from video/.env inside this process only; never prints it.
# Writes eleven/<id>.wav (44.1 kHz) next to this file; manifest.py picks the files up.
import json, os, subprocess, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "eleven")
API = "https://api.elevenlabs.io"


def load_key():
    for raw in open(os.path.join(HERE, "..", ".env")):
        k, _, v = raw.strip().partition("=")
        if k.strip() == "ELEVENLABS_API_KEY":
            return v.strip().strip("'\"")
    sys.exit("ELEVENLABS_API_KEY missing in video/.env")


KEY = load_key()

# Stock voices (default library), first id that works wins.
VOICES = {
    "hype": [("Harry", "SOYHLrjzK2X1ezoPC6cr"), ("Liam", "TX3LPaxmHKxFdv7VOQHJ")],
    "herald": [("George", "JBFqnCBsd6RMkjVDRZzb"), ("Daniel", "onwK4e9ZLuTAKqWW03F9")],
}
SETTINGS = {
    "hype": {"stability": 0.0, "similarity_boost": 0.75, "style": 0.6, "use_speaker_boost": True},
    "herald": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.3, "use_speaker_boost": True},
}

SFX = [
    ("sfx_whoosh", 0.8, "fast anime whoosh swipe, air cutting, short and punchy"),
    ("sfx_impact", 1.5, "anime impact hit, deep boom with sharp crack, cinematic punch"),
    ("sfx_hammer", 0.8, "blacksmith hammer striking an anvil once, bright metallic clang with sparks"),
    ("sfx_sparkle", 1.0, "magical sparkle twinkle, bright chimes glitter"),
    ("sfx_riser", 2.0, "fast rising whoosh riser building tension into a hit"),
    ("sfx_slam", 2.5, "huge logo slam, heavy cinematic impact with metallic ring and short reverb tail"),
    ("sfx_chime", 1.5, "warm fantasy victory chime, soft bells"),
    ("sfx_scroll", 0.8, "parchment scroll unrolling quickly, paper swish"),
    ("sfx_land", 0.6, "cartoon character landing on the ground, short soft thud with a tiny bounce"),
    ("sfx_glint", 0.7, "anime eye glint, bright high metallic ting shine"),
    ("sfx_beam", 1.2, "magical blue energy beam firing upward, shimmering hum"),
    ("sfx_orb", 0.9, "glowing orb landing with a soft magical pop and a bright ding"),
    ("sfx_clash", 1.2, "two swords clashing hard, metallic clang with sparks, anime battle"),
]
MUSIC = [
    ("music_intro", 15000, "Original high energy anime opening style instrumental, fast rock drums, driving electric guitar riff, synth stabs, 160 bpm, triumphant, builds to a big hit at the end, no vocals"),
    ("music_bed", 95000, "Original light medieval march for a strategy game, steady war drums, soft lute and low strings, playful and adventurous, 100 bpm, sits quietly under narration, no vocals, no big swells"),
]


def post(path, body, tries=4):
    url = API + path
    for n in range(tries):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"xi-api-key": KEY, "Content-Type": "application/json", "Accept": "audio/mpeg"})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode(errors="replace")
            if e.code in (429, 500, 502, 503) and n < tries - 1:
                time.sleep(3 * (n + 1))
                continue
            raise RuntimeError(f"{path.split('?')[0]} HTTP {e.code}: {msg}")


def to_wav(mp3, name):
    os.makedirs(OUT, exist_ok=True)
    src = os.path.join(OUT, name + ".mp3")
    open(src, "wb").write(mp3)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ar", "44100", os.path.join(OUT, name + ".wav")], check=True)
    os.remove(src)
    d = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", os.path.join(OUT, name + ".wav")], capture_output=True, text=True).stdout.strip()
    return float(d)


def vo(ln):
    last = None
    for vname, vid in VOICES[ln["role"]]:
        for model, text in (("eleven_v3", ln["el"]), ("eleven_multilingual_v2", ln.get("say", ln["text"]))):
            try:
                mp3 = post(f"/v1/text-to-speech/{vid}?output_format=mp3_44100_128",
                           {"text": text, "model_id": model, "voice_settings": SETTINGS[ln["role"]], "seed": 7})
                return f"{ln['id']} {to_wav(mp3, ln['id']):.2f} s ({vname}, {model})"
            except RuntimeError as e:
                last = e
    return f"{ln['id']} FAILED {last}"


def sfx(item):
    name, secs, prompt = item
    try:
        mp3 = post("/v1/sound-generation?output_format=mp3_44100_128",
                   {"text": prompt, "duration_seconds": secs, "prompt_influence": 0.6})
        return f"{name} {to_wav(mp3, name):.2f} s"
    except RuntimeError as e:
        return f"{name} FAILED {e}"


def music(item):
    name, ms, prompt = item
    try:
        mp3 = post("/v1/music?output_format=mp3_44100_128", {"prompt": prompt, "music_length_ms": ms, "force_instrumental": True})
        return f"{name} {to_wav(mp3, name):.2f} s"
    except RuntimeError as e:
        return f"{name} FAILED {e}"


if __name__ == "__main__":
    args = sys.argv[1:]
    kinds = [a for a in args if a in ("vo", "sfx", "music")] or ["vo", "sfx", "music"]
    ids = {a for a in args if a not in ("vo", "sfx", "music")}
    lines = json.load(open(os.path.join(HERE, "lines.json")))["lines"]
    jobs = []
    if "music" in kinds:
        jobs += [(music, m) for m in MUSIC if not ids or m[0] in ids]
    if "vo" in kinds:
        jobs += [(vo, l) for l in lines if not ids or l["id"] in ids]
    if "sfx" in kinds:
        jobs += [(sfx, s) for s in SFX if not ids or s[0] in ids]
    with ThreadPoolExecutor(3) as ex:
        for res in ex.map(lambda j: j[0](j[1]), jobs):
            print(res, flush=True)
