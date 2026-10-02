/**
 * The sparse v2 envelope at `zoto-viz.settings`.
 * The first read builds it from legacy keys and writes nothing.
 * The first user edit writes that envelope and dual-writes the one legacy key
 * for the Global or Pack value that changed.
 */
import { readLegacyEnvelope, type LegacyReadStore, type SettingsEnvelope } from "./legacy-settings";

export const SETTINGS_ENVELOPE_KEY = "zoto-viz.settings";

export type SettingsStore = LegacyReadStore & {
  setItem(key: string, value: string): void;
};

export type UserEdit = {
  /** The legacy key an older tab still reads. */
  legacyKey: string;
  value: string;
  scope: "global" | "pack";
  /** `anim.yawPeriod`, `theme`, or a pack config field. */
  field: string;
  packId?: string;
};

function coerce(field: string, value: string): string | number | boolean {
  if (field.startsWith("anim.") && value !== "" && !Number.isNaN(Number(value)) && /^-?\d/.test(value)) {
    return Number(value);
  }
  if (value === "1" || value === "0") {
    const name = field.startsWith("anim.") ? field.slice("anim.".length) : field;
    if (["follow", "cycle", "randomize", "skyAudio", "bgAudio", "gridAudio", "audioCamera", "camTheme", "audioNodes", "autoTune", "audioParts", "audioPhysics"].includes(name)) {
      return value === "1";
    }
  }
  return value;
}

function envelopeFromStore(store: LegacyReadStore): SettingsEnvelope {
  const raw = store.getItem(SETTINGS_ENVELOPE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as SettingsEnvelope;
      if (parsed && parsed.v === 2) return parsed;
    } catch {
      /* fall through to legacy */
    }
  }
  return readLegacyEnvelope({ local: store });
}

function applyEdit(env: SettingsEnvelope, edit: UserEdit): void {
  const value = coerce(edit.field, edit.value);
  if (edit.scope === "pack" && edit.packId) {
    const pack = env.packs[edit.packId] ?? { config: {} };
    pack.config = { ...pack.config, [edit.field]: edit.value };
    env.packs[edit.packId] = pack;
    return;
  }
  if (edit.field === "theme" && typeof value === "string") {
    env.global.theme = value;
    return;
  }
  if (edit.field.startsWith("anim.")) {
    env.global.anim = { ...(env.global.anim ?? {}), [edit.field.slice("anim.".length)]: value };
  }
}

/** First read is free of writes. The first edit writes v2 and one legacy key. */
export function applyUserEdit(store: SettingsStore, edit: UserEdit): SettingsEnvelope {
  const env = envelopeFromStore(store);
  applyEdit(env, edit);
  env.v = 2;
  env.activeWall = "default";
  store.setItem(SETTINGS_ENVELOPE_KEY, JSON.stringify(env));
  store.setItem(edit.legacyKey, edit.value);
  return env;
}
