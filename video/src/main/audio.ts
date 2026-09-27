// Loads video/audio/manifest.json (owned by raid-video-vo) at render time through public/audio.
// Missing manifest renders silent, so the cut always builds.
import { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

export type VoTrack = { file: string; id?: string; section: string; offset: number; duration: number; volume?: number };
export type Sfx = { file: string; at: number; volume?: number };
export type Manifest = {
  tracks?: VoTrack[];
  alts?: VoTrack[];
  music?: { file: string; duration: number; volume?: number };
  sfx?: Sfx[];
};

export const useManifest = (): Manifest | null => {
  const [m, setM] = useState<Manifest | null>(null);
  const [handle] = useState(() => delayRender("audio manifest"));
  useEffect(() => {
    fetch(staticFile("audio/manifest.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setM(j))
      .catch(() => setM(null))
      .finally(() => continueRender(handle));
  }, [handle]);
  return m;
};
