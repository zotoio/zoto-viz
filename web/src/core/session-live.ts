import { normalizeSettings, type ProfileSettings } from "./profiles";

export const SESSION_LIVE_KEY = "zoto-viz.session.live";

export interface SessionLive {
  /** #262: written as 2. A stored 1 is still read. */
  v: 1 | 2;
  profileId: string;
  dirty: boolean;
  settings: ProfileSettings;
  selected?: string | null;
  aiCycle?: boolean;
  /** #256: profiles known to be newer; the settings above were re-stamped v: 1 and can't say. */
  newerIds?: string[];
  /** #256: the profile's server blob is still legacy (v0). */
  legacy?: boolean;
}

export function readSessionLive(store: Pick<Storage, "getItem"> | null = defaultStore()): SessionLive | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_LIVE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<SessionLive>;
    if ((j.v !== 1 && j.v !== 2) || !j.settings || typeof j.settings !== "object") return null;
    return {
      v: 2,
      profileId: typeof j.profileId === "string" ? j.profileId : "",
      dirty: j.dirty === true,
      settings: normalizeSettings(j.settings),
      selected: typeof j.selected === "string" && j.selected ? j.selected : null,
      aiCycle: j.aiCycle === true,
      newerIds: Array.isArray(j.newerIds) ? j.newerIds.filter((n): n is string => typeof n === "string") : [],
      legacy: j.legacy === true,
    };
  } catch {
    return null;
  }
}

export function writeSessionLive(live: Omit<SessionLive, "v">, store: Pick<Storage, "setItem"> | null = defaultStore()): void {
  if (!store) return;
  try {
    store.setItem(SESSION_LIVE_KEY, JSON.stringify({ v: 2 as const, ...live, settings: normalizeSettings(live.settings) }));
  } catch {
    /* quota / private mode */
  }
}

function defaultStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
