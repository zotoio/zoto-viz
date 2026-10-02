/**
 * #260: read today's legacy keys into a sparse v2 envelope. In memory only.
 * A stored value equal to its default is inherit, so it is left out. That is
 * slightly lossy if a default changes later: the old "I saved the default" and
 * "I never touched it" look the same.
 * Duplicate tiles stay shared. Nothing here calls setItem or removeItem.
 */
import { DEFAULT_DREAM } from "../graph/scene";
import { VIZ_MAX_ACTIVE_TILES } from "../plugins/viz-tile-constants";
import { DEFAULT_THEME } from "./themes";
import { normalizeSettings, vizGovernorEnabledForSettings } from "./profiles";

export const LEGACY_PREFIX = "zoto-viz";

/** Wall layout lives under `anim.*` today and moves to `walls.default.layout`. */
export const WALL_LAYOUT_KEYS = [
  "mosaic",
  "hero",
  "mosaicTree",
  "mosaicMaxId",
  "mosaicTiles",
  "mosaicSharedTheme",
  "mosaicUniqueSkies",
] as const;

/** Every `anim.*` key persistAnim can write, including the wall keys above. */
export const ANIM_STORAGE_KEYS = [
  "yawPeriod", "pitchDeg", "pitchPeriod", "zoom", "zoomPeriod",
  "follow", "cycle", "cyclePeriod", "randomize",
  "backdrop", "skyOpacity", "skyBright", "skySpeed", "skyEase", "skyPhotoS", "skyAiMin", "skyAudio",
  "bgAudio", "bgColor", "bgOpacity",
  "gridOpacity", "gridBright", "gridAudio", "gridColor", "gridSize", "gridFollow", "gridShape",
  "audioSens", "audioDrive", "audioCamera", "camAudio", "camChange", "camGaze", "camInertia", "moveEase",
  "camTheme", "audioNodes", "themeCycle", "skyCycle",
  "labelWeight", "labelCount", "autoTune",
  "nodeWeight", "edgeWeight", "edgeOpacity", "nodeShape",
  "edgeGlow", "edgeGlowAmt", "edgeGlowSpeed",
  "graphFabric", "graphSpace", "graphLayout", "graphLinks",
  "mosaic", "hero", "mosaicTree", "mosaicMaxId", "mosaicTiles", "mosaicSharedTheme", "mosaicUniqueSkies",
  "focus",
  "partAmt", "partBusy", "partQuiet", "partPeak", "partCap", "partSpeed", "partSize", "audioParts",
  "magnetSelf", "magnetGateway", "magnetLan", "magnetLocal", "magnetInternet", "magnetMulticast",
  "magnetCross", "magnetRange", "magnetTraffic",
  "gravity", "swirl", "chargeAmt", "spring", "linkSpan", "drag", "centerPull", "stringAmt", "audioPhysics",
] as const;

/** The 14 arcade families in main.ts `ARCADE_STORAGE_RE`. */
export const ARCADE_FAMILIES = [
  "pong", "invaders", "command", "frogger", "cpupong", "doom", "waves", "orbits",
  "helix", "skyline", "pacman", "tetris", "portal", "carousel",
] as const;

const WALL_KEY_SET = new Set<string>(WALL_LAYOUT_KEYS);
const ARCADE_SET = new Set<string>(ARCADE_FAMILIES);
export type SettingsEnvelope = {
  v: 2;
  activeWall: "default";
  global: {
    anim?: Record<string, unknown>;
    theme?: string;
    governor?: boolean;
  };
  packs: Record<string, { config: Record<string, string> }>;
  views: Record<string, {
    config?: Record<string, string>;
    mode?: Record<string, string>;
    arcade?: Record<string, string>;
  }>;
  walls: {
    default: {
      layout: Record<string, unknown>;
      tiles: Record<string, { look?: { backdrop: string } }>;
      defaults?: { governor?: boolean };
    };
  };
};

export type LegacyReadStore = {
  getItem(key: string): string | null;
  key(index: number): string | null;
  length: number;
};

export type LegacySources = {
  local: LegacyReadStore;
  session?: { getItem(key: string): string | null } | null;
  /** A profiles.yml settings blob. No `v` means pre-#256. */
  profile?: unknown;
};

function emptyEnvelope(): SettingsEnvelope {
  return {
    v: 2,
    activeWall: "default",
    global: {},
    packs: {},
    views: {},
    walls: { default: { layout: {}, tiles: {} } },
  };
}

function dreamDefault(key: string): unknown {
  return (DEFAULT_DREAM as unknown as Record<string, unknown>)[key];
}

/** How persistAnim would store a default, or null when the host omits the key. */
export function encodeAnimStorage(key: string, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 0) return null;
  return JSON.stringify(value);
}

export function animStoredIsDefault(key: string, raw: string): boolean {
  const encoded = encodeAnimStorage(key, dreamDefault(key));
  if (encoded == null) return raw === "" || raw === "[]" || raw === "null";
  if (typeof dreamDefault(key) === "number") return Number(raw) === dreamDefault(key);
  return raw === encoded;
}

function parseAnimValue(key: string, raw: string): unknown {
  const sample = dreamDefault(key);
  if (typeof sample === "boolean") return raw === "1";
  if (typeof sample === "number") return Number(raw);
  if (sample != null && typeof sample === "object") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

function listKeys(store: LegacyReadStore): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k) out.push(k);
  }
  return out;
}

function viewBag(env: SettingsEnvelope, id: string): NonNullable<SettingsEnvelope["views"][string]> {
  const cur = env.views[id] ?? {};
  env.views[id] = cur;
  return cur;
}

function putConfig(bag: { config?: Record<string, string> }, key: string, value: string): void {
  bag.config = bag.config ?? {};
  bag.config[key] = value;
}

function tileCount(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter((row) => typeof row === "string" && row.trim()).length;
  } catch {
    return 0;
  }
}

function applyGovernor(env: SettingsEnvelope, on: boolean): void {
  if (on === true) return;
  env.global.governor = on;
  env.walls.default.defaults = { ...(env.walls.default.defaults ?? {}), governor: on };
}

function foldProfile(env: SettingsEnvelope, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const s = raw as Record<string, unknown>;
  const normalized = normalizeSettings(s);
  if (typeof s.theme === "string" && s.theme !== DEFAULT_THEME.id) env.global.theme = s.theme;
  // Markers (`v`, `legacy`, `newer`, `*Saved`) are not copied. A legacy
  // `vizGovernor: false` is the old default, so it stays inherit.
  applyGovernor(env, vizGovernorEnabledForSettings(normalized));
}

function foldSession(env: SettingsEnvelope, session: LegacySources["session"]): void {
  if (!session) return;
  const raw = session.getItem(`${LEGACY_PREFIX}.session.live`);
  if (!raw) return;
  try {
    const j = JSON.parse(raw) as { v?: unknown; settings?: unknown };
    if (j.v !== 1 || !j.settings || typeof j.settings !== "object") return;
    const s = j.settings as Record<string, unknown>;
    if (typeof s.theme === "string" && s.theme !== DEFAULT_THEME.id) env.global.theme = s.theme;
  } catch {
    /* a bad snapshot contributes nothing */
  }
}

/** Build the v2 envelope from legacy storage. Does not write. */
export function readLegacyEnvelope(sources: LegacySources): SettingsEnvelope {
  const env = emptyEnvelope();
  const local = sources.local;
  for (const key of listKeys(local)) {
    if (!key.startsWith(`${LEGACY_PREFIX}.`)) continue;
    const raw = local.getItem(key);
    if (raw == null) continue;
    const rest = key.slice(LEGACY_PREFIX.length + 1);

    if (rest.startsWith("anim.")) {
      const name = rest.slice("anim.".length);
      if (name === "mosaicSkies") {
        placeSkies(env, raw);
        continue;
      }
      if (animStoredIsDefault(name, raw)) continue;
      const value = parseAnimValue(name, raw);
      if (WALL_KEY_SET.has(name)) {
        env.walls.default.layout[name] = name === "mosaicTiles" && tileCount(raw) > VIZ_MAX_ACTIVE_TILES
          ? raw
          : value;
        continue;
      }
      env.global.anim = env.global.anim ?? {};
      env.global.anim[name] = value;
      continue;
    }

    if (rest === "mosaicFocus" && raw) {
      env.walls.default.layout.mosaicFocus = raw;
      continue;
    }

    if (rest === "vizGovernor") {
      applyGovernor(env, raw !== "0");
      continue;
    }

    if (rest === "theme" && raw && raw !== DEFAULT_THEME.id) {
      env.global.theme = raw;
      continue;
    }

    if (rest.startsWith("plugin.")) {
      const body = rest.slice("plugin.".length);
      const dot = body.lastIndexOf(".");
      if (dot <= 0) continue;
      const storeId = body.slice(0, dot);
      const field = body.slice(dot + 1);
      if (storeId.includes(":")) putConfig(viewBag(env, `plugin:${storeId}`), field, raw);
      else {
        const pack = env.packs[storeId] ?? { config: {} };
        pack.config[field] = raw;
        env.packs[storeId] = pack;
      }
      continue;
    }

    if (rest.startsWith("mode.")) {
      const body = rest.slice("mode.".length);
      const dot = body.lastIndexOf(".");
      if (dot <= 0) continue;
      const viewId = body.slice(0, dot);
      const field = body.slice(dot + 1);
      const bag = viewBag(env, viewId);
      bag.mode = bag.mode ?? {};
      bag.mode[field] = raw;
      continue;
    }

    const arcadeDot = rest.indexOf(".");
    if (arcadeDot > 0) {
      const family = rest.slice(0, arcadeDot);
      if (ARCADE_SET.has(family)) {
        const bag = viewBag(env, family);
        bag.arcade = bag.arcade ?? {};
        bag.arcade[rest.slice(arcadeDot + 1)] = raw;
      }
    }
  }

  foldProfile(env, sources.profile);
  foldSession(env, sources.session);
  return env;
}

function placeSkies(env: SettingsEnvelope, raw: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  for (const [id, sky] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof sky !== "string" || !sky) continue;
    env.walls.default.tiles[id] = { look: { backdrop: sky } };
  }
}

function storageFromMap(entries: Record<string, string>): LegacyReadStore {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i) => keys[i] ?? null,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(entries, k) ? entries[k]! : null),
  };
}

/** The legacy keys that read back to the same envelope. Not written to storage. */
export function writeLegacyEntries(env: SettingsEnvelope): Record<string, string> {
  const out: Record<string, string> = {};
  const p = LEGACY_PREFIX;
  for (const [key, value] of Object.entries(env.global.anim ?? {})) {
    const encoded = encodeAnimStorage(key, value);
    if (encoded != null) out[`${p}.anim.${key}`] = encoded;
  }
  const layout = env.walls.default.layout;
  for (const [key, value] of Object.entries(layout)) {
    if (key === "mosaicFocus" && typeof value === "string") {
      out[`${p}.mosaicFocus`] = value;
      continue;
    }
    if (key === "mosaicTiles" && typeof value === "string") {
      out[`${p}.anim.mosaicTiles`] = value;
      continue;
    }
    const encoded = encodeAnimStorage(key, value);
    if (encoded != null) out[`${p}.anim.${key}`] = encoded;
  }
  const skies: Record<string, string> = {};
  for (const [id, tile] of Object.entries(env.walls.default.tiles)) {
    const backdrop = tile.look?.backdrop;
    if (backdrop) skies[id] = backdrop;
  }
  if (Object.keys(skies).length) out[`${p}.anim.mosaicSkies`] = JSON.stringify(skies);
  if (env.global.governor === false || env.walls.default.defaults?.governor === false) {
    out[`${p}.vizGovernor`] = "0";
  }
  if (env.global.theme) out[`${p}.theme`] = env.global.theme;
  for (const [id, pack] of Object.entries(env.packs)) {
    for (const [field, value] of Object.entries(pack.config)) out[`${p}.plugin.${id}.${field}`] = value;
  }
  for (const [id, view] of Object.entries(env.views)) {
    for (const [field, value] of Object.entries(view.config ?? {})) {
      const storeId = id.startsWith("plugin:") ? id.slice("plugin:".length) : id;
      out[`${p}.plugin.${storeId}.${field}`] = value;
    }
    for (const [field, value] of Object.entries(view.mode ?? {})) out[`${p}.mode.${id}.${field}`] = value;
    for (const [field, value] of Object.entries(view.arcade ?? {})) out[`${p}.${id}.${field}`] = value;
  }
  return out;
}

/** Read, then the in-memory legacy form of that envelope, then read again. */
export function rereadLegacyEnvelope(sources: LegacySources): SettingsEnvelope {
  return readLegacyEnvelope({ local: storageFromMap(writeLegacyEntries(readLegacyEnvelope(sources))) });
}
