import type { ViewMode } from "../core/modes";

const optsCache = new Map<string, Record<string, string>>();

export function cachedModeOpts(m: ViewMode, build: () => Record<string, string>): Record<string, string> {
  let o = optsCache.get(m.id);
  if (!o) {
    o = build();
    optsCache.set(m.id, o);
  }
  return o;
}

export function invalidateVizModeOptsCache(): void {
  optsCache.clear();
}
