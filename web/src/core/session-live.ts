import { normalizeSettings, type ProfileSettings } from "./profiles";

export const SESSION_LIVE_KEY = "zoto-viz.session.live";

export interface SessionLive {
  v: 1;
  profileId: string;
  dirty: boolean;
  settings: ProfileSettings;
  selected?: string | null;
  aiCycle?: boolean;
}

export function readSessionLive(store: Pick<Storage, "getItem"> | null = defaultStore()): SessionLive | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_LIVE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<SessionLive>;
    if (j.v !== 1 || !j.settings || typeof j.settings !== "object") return null;
    return {
      v: 1,
      profileId: typeof j.profileId === "string" ? j.profileId : "",
      dirty: j.dirty === true,
      settings: normalizeSettings(j.settings),
      selected: typeof j.selected === "string" && j.selected ? j.selected : null,
      aiCycle: j.aiCycle === true,
    };
  } catch {
    return null;
  }
}

export function writeSessionLive(live: Omit<SessionLive, "v">, store: Pick<Storage, "setItem"> | null = defaultStore()): void {
  if (!store) return;
  try {
    store.setItem(SESSION_LIVE_KEY, JSON.stringify({ v: 1 as const, ...live, settings: normalizeSettings(live.settings) }));
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
