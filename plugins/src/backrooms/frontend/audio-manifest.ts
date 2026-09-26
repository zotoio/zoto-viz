/** Parsed from plugins/src/backrooms/audio.manifest.yml — keep in sync manually in tests. */

export const BACKROOMS_AUDIO_MANIFEST = {
  required: [
    "sfx/buzz.mp3",
    "sfx/fluoro.mp3",
    "sfx/screech.mp3",
    "sfx/roar.mp3",
    "sfx/pant.mp3",
    "sfx/box.mp3",
  ],
  loops: {
    buzz: "sfx/buzz.mp3",
    fluoro: "sfx/fluoro.mp3",
    pant: "sfx/pant.mp3",
  },
  oneShots: {
    screech: "sfx/screech.mp3",
    roar: "sfx/roar.mp3",
    box: "sfx/box.mp3",
  },
  heartbeat: { enabled: true, rateHz: 1.15 },
} as const;

export type BackroomsSampleId = keyof typeof BACKROOMS_AUDIO_MANIFEST.loops
  | keyof typeof BACKROOMS_AUDIO_MANIFEST.oneShots;

export function backroomsAssetUrl(pluginId: string, rel: string, rev = "dev"): string {
  const path = rel.replace(/^\/+/, "");
  return `/api/plugins/${encodeURIComponent(pluginId)}/asset/${path}?v=${encodeURIComponent(rev)}`;
}

export function backroomsManifestSampleUrls(pluginId = "backrooms", rev = "dev"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of BACKROOMS_AUDIO_MANIFEST.required) out[rel] = backroomsAssetUrl(pluginId, rel, rev);
  return out;
}
