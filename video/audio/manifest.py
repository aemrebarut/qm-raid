# Builds the playable set and manifest.json for raid-video (raid-video-vo).
# Usage: python3 manifest.py [eleven|kokoro]   (default eleven; any line missing there falls back to kokoro/)
# Per line: trim silence, loudness to -16 LUFS, time-fit lines with a "max" (intro beats), write <id>.wav here.
# Music: music.wav = intro music 0 to 15 s, then the march bed quietly to 109 s. SFX: absolute cue times.
import json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PREFER = sys.argv[1] if len(sys.argv) > 1 else "eleven"
SECTIONS = {"intro": (0, 15), "orders": (15, 20), "teams": (35, 20), "forge": (55, 20),
            "autopilot": (75, 15), "loadout": (90, 15), "end": (105, 4)}
CARD = 1.2  # clip title card; the herald starts after it
TOTAL = 109


def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                                capture_output=True, text=True).stdout.strip())


def ff(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def src_for(name):
    for d in ([PREFER, "kokoro"] if PREFER != "kokoro" else ["kokoro"]):
        p = os.path.join(HERE, d, name + ".wav")
        if os.path.exists(p):
            return d, p
    return None, None


TRIM = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse"


def build_line(ln):
    engine, src = src_for(ln["id"])
    if not src:
        return None
    out = os.path.join(HERE, ln["id"] + ".wav")
    ff("-i", src, "-af", f"{TRIM},loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-ac", "1", out)
    d = dur(out)
    if ln.get("max") and d > ln["max"]:
        tempo = min(d / ln["max"], 1.35)
        tmp = out + ".tmp.wav"
        ff("-i", out, "-af", f"atempo={tempo:.3f}", tmp)
        os.replace(tmp, out)
        d = dur(out)
    return {"file": ln["id"] + ".wav", "id": ln["id"], "section": ln["section"], "duration": round(d, 2),
            "text": ln["text"], "engine": engine}


def main():
    lines = json.load(open(os.path.join(HERE, "lines.json")))["lines"]
    tracks, alts = [], []
    for ln in lines:
        t = build_line(ln)
        if not t:
            print("missing", ln["id"])
            continue
        if ln.get("at") is not None:
            t["offset"] = ln["at"]
        (alts if ln.get("alt") else tracks).append(t)
    # Clip lines: spread evenly after the title card, leaving the tail of the slot quiet.
    for sec, (start, length) in SECTIONS.items():
        ts = [t for t in tracks if t["section"] == sec and "offset" not in t]
        if not ts:
            continue
        lead = 0.3 if sec == "end" else CARD + 0.3
        room = length - lead - 0.6 - sum(t["duration"] for t in ts)
        gap = max(0.3, room / max(1, len(ts) - 1)) if len(ts) > 1 else 0
        at = lead
        for t in ts:
            t["offset"] = round(at, 2)
            at += t["duration"] + gap
        t["overrun"] = round(max(0, ts[-1]["offset"] + ts[-1]["duration"] - length), 2)
        for a in alts:
            if a["section"] == sec:
                a["offset"] = ts[-1]["offset"]
    for t in tracks + alts:
        t.setdefault("offset", 0)
        t["at"] = round(SECTIONS[t["section"]][0] + t["offset"], 2)

    manifest = {"tracks": tracks, "alts": alts}
    # Music: intro music then the quiet bed.
    intro, bed = src_for("music_intro")[1], src_for("music_bed")[1]
    if intro or bed:
        parts, filt, n = [], [], 0
        if intro:
            parts += ["-i", intro]
            filt.append(f"[{n}:a]atrim=0:15,afade=t=out:st=14:d=1,loudnorm=I=-18:TP=-1.5,aresample=44100,aformat=channel_layouts=stereo[a{n}]")
            n += 1
        if bed:
            parts += ["-i", bed]
            start = 14.5 if intro else 0
            filt.append(f"[{n}:a]atrim=0:{TOTAL - start},afade=t=in:d=1,afade=t=out:st={TOTAL - start - 2.5}:d=2.5,loudnorm=I=-30:TP=-6,aresample=44100,aformat=channel_layouts=stereo,adelay={int(start * 1000)}|{int(start * 1000)}[a{n}]")
            n += 1
        mix = "".join(f"[a{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,apad=whole_dur={TOTAL},atrim=0:{TOTAL}[m]"
        ff(*parts, "-filter_complex", ";".join(filt + [mix]), "-map", "[m]", os.path.join(HERE, "music.wav"))
        manifest["music"] = {"file": "music.wav", "duration": round(dur(os.path.join(HERE, "music.wav")), 2),
                             "note": "intro music 0 to 15 s at -18 LUFS, march bed from 14.5 s at -30 LUFS; VO is -16 LUFS"}
    # Intro cues: 0 to 2 s gameplay cold open, smash cut at 2.0, anime beats scaled to 2 to 15 s (raid-video-intro retimes).
    cues = [("sfx_impact", 2.0), ("sfx_whoosh", 4.34), ("sfx_impact", 4.43), ("sfx_whoosh", 7.11), ("sfx_sparkle", 8.59),
            ("sfx_whoosh", 9.71), ("sfx_hammer", 10.15), ("sfx_hammer", 10.58), ("sfx_hammer", 11.01), ("sfx_riser", 11.1),
            ("sfx_impact", 12.83), ("sfx_slam", 12.92), ("sfx_sparkle", 13.18),
            ("sfx_whoosh", 15.0), ("sfx_whoosh", 35.0), ("sfx_whoosh", 55.0), ("sfx_whoosh", 75.0), ("sfx_whoosh", 90.0),
            ("sfx_chime", 105.0)]
    sfx, made = [], {}
    for name, at in cues:
        if name not in made:
            _, p = src_for(name)
            if p:
                out = os.path.join(HERE, name + ".wav")
                ff("-i", p, "-af", "loudnorm=I=-18:TP=-1", "-ar", "44100", out)
                made[name] = round(dur(out), 2)
        if name in made:
            sfx.append({"file": name + ".wav", "at": at, "duration": made[name]})
    manifest["sfx"] = sfx
    manifest["extras"] = [{"file": n + ".wav", "use": u} for n, u in
                          (("sfx_scroll", "teams handoff scroll"), ("sfx_hammer", "forge train"), ("sfx_chime", "VERDICT: APPROVED stamp"))
                          if n in made or os.path.exists(os.path.join(HERE, n + ".wav"))]
    json.dump(manifest, open(os.path.join(HERE, "manifest.json"), "w"), indent=1)
    for sec, (start, length) in SECTIONS.items():
        ts = [t for t in tracks if t["section"] == sec]
        spoken = sum(t["duration"] for t in ts)
        print(f"{sec:9} slot {length:>2}s  speech {spoken:5.2f}s  " + "  ".join(f"{t['id']}@{t['offset']}+{t['duration']}({t['engine'][0]})" for t in ts))


main()
