import type { RemixPairing } from "./remix-types";

const KEY = "zoto-viz.remixPairing";

export function loadRemixPairing(): RemixPairing | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RemixPairing;
    if (!parsed?.dataPluginId || !parsed.sourceId || !parsed.visualPackId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRemixPairing(pairing: RemixPairing): void {
  localStorage.setItem(KEY, JSON.stringify(pairing));
}

export function clearRemixPairing(): void {
  localStorage.removeItem(KEY);
}

export function remixViewId(visualPackId: string): string {
  return visualPackId.startsWith("plugin:") ? visualPackId : `plugin:${visualPackId}`;
}
