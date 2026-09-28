/** Remap retired saved view ids on load (profiles, localStorage, mosaic tiles). */
const SAVED_VIEW_ALIASES: Record<string, string> = {
  "plugin:cpu-pong": "plugin:cpupong",
  "cpu-pong": "cpupong",
};

export function remapSavedViewId(mode: string): string {
  const trimmed = mode.trim();
  if (!trimmed) return mode;
  return SAVED_VIEW_ALIASES[trimmed] ?? trimmed;
}

export function remapSavedViewIds(ids: readonly string[]): string[] {
  return ids.map((id) => remapSavedViewId(id));
}
