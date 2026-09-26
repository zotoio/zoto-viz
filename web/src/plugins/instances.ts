import type { PluginField } from "../core/modes";
import { mosaicTileViewId } from "../graph/mosaic-tile-id";
import type { PluginView } from "./plugin";

export { mosaicTileViewId } from "../graph/mosaic-tile-id";

export type PluginInstance = {
  id: string;
  name?: string;
  hint?: string;
  source?: string;
  title?: string;
  caption?: string;
  image?: string;
  link?: string;
  filter?: string;
  /** Per-instance config defaults applied before pack-wide fallback. */
  defaults?: Record<string, string | number | boolean>;
};

const BIND_DEFAULTS: Record<string, string> = {
  source: "",
  titleField: "title",
  captionField: "summary",
  imageField: "image",
  linkField: "link",
  filter: "all",
};

const INSTANCE_TO_FIELD: Record<string, keyof PluginInstance> = {
  source: "source",
  titleField: "title",
  captionField: "caption",
  imageField: "image",
  linkField: "link",
  filter: "filter",
};

export function pluginViewId(id: string, instanceId?: string | null): string {
  if (instanceId && instanceId !== id) return `plugin:${id}:${instanceId}`;
  return `plugin:${id}`;
}

export function parsePluginId(modeId: string): string | null {
  if (!modeId.startsWith("plugin:")) return null;
  return modeId.slice("plugin:".length).split(":")[0] || null;
}

export function parsePluginInstance(modeId: string): string | null {
  if (!modeId.startsWith("plugin:")) return null;
  const rest = modeId.slice("plugin:".length);
  const i = rest.indexOf(":");
  return i >= 0 ? rest.slice(i + 1) || null : null;
}

/** localStorage namespace for plugin config (per catalog instance row). */
export function configStoreId(spec: Pick<PluginView, "id" | "instanceId">): string {
  return spec.instanceId && spec.instanceId !== spec.id ? `${spec.id}:${spec.instanceId}` : spec.id;
}

/** True when each mosaic/catalog instance has its own config store id. */
export function configStoredPerTile(spec: Pick<PluginView, "id" | "instanceId">): boolean {
  return !!(spec.instanceId && spec.instanceId !== spec.id);
}

export type PackWallScope = {
  mosaicOn: boolean;
  tileModeIds: readonly string[];
};

export function configStoreIdForMode(modeId: string): string | null {
  const canonical = mosaicTileViewId(modeId);
  const packId = parsePluginId(canonical);
  if (!packId) return null;
  const inst = parsePluginInstance(canonical);
  return inst && inst !== packId ? `${packId}:${inst}` : packId;
}

/** Tiles on the wall that share this spec's config store (not merely the same pack id). */
export function countTilesSharingConfigStore(spec: PluginView, tileModeIds: readonly string[]): number {
  const mine = configStoreId(spec);
  let n = 0;
  for (const modeId of tileModeIds) {
    if (configStoreIdForMode(modeId) === mine) n += 1;
  }
  return n;
}

/** Host note under plugin settings (null = hide). */
export function packScopeNoteText(spec: PluginView, wall?: PackWallScope): string | null {
  if (configStoredPerTile(spec)) {
    return "Settings apply to this tile only. Instance defaults override shared pack values.";
  }
  const shared = wall?.mosaicOn ? countTilesSharingConfigStore(spec, wall.tileModeIds) : 0;
  if (shared < 2) return null;
  return `Applies to all ${spec.name} tiles on this wall. Shared pack storage.`;
}

export function parseInstances(raw: unknown): PluginInstance[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PluginInstance[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    if (!id) continue;
    const inst: PluginInstance = { id };
    for (const key of ["name", "hint", "source", "title", "caption", "image", "link", "filter"] as const) {
      const val = rec[key];
      if (typeof val === "string" && val.trim()) inst[key] = val.trim();
    }
    const defs = rec.defaults;
    if (defs && typeof defs === "object" && !Array.isArray(defs)) {
      const map: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(defs)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") map[k] = v;
      }
      if (Object.keys(map).length) inst.defaults = map;
    }
    out.push(inst);
  }
  return out.length ? out : undefined;
}

export function applyInstance(spec: PluginView, inst: PluginInstance): PluginView {
  const config = (spec.config ?? []).map((field) => patchField(field, inst));
  return {
    ...spec,
    instanceId: inst.id,
    name: inst.name || spec.name,
    hint: inst.hint || spec.hint,
    look: spec.look,
    config,
    instanceDefaults: inst.defaults,
  };
}

function patchField(field: PluginField, inst: PluginInstance): PluginField {
  const key = INSTANCE_TO_FIELD[field.key];
  if (!key) return field;
  const val = inst[key];
  if (typeof val !== "string" || !val) return field;
  return { ...field, default: val };
}

export function expandPluginInstances(spec: PluginView): PluginView[] {
  const rows = spec.instances?.length ? spec.instances : [{ id: spec.id }];
  return rows.map((inst) => applyInstance(spec, { ...inst, id: inst.id || spec.id }));
}

export function bindDefaults(inst?: PluginInstance): Record<string, string> {
  return {
    ...BIND_DEFAULTS,
    source: inst?.source ?? "",
    titleField: inst?.title ?? "title",
    captionField: inst?.caption ?? "summary",
    imageField: inst?.image ?? "image",
    linkField: inst?.link ?? "link",
    filter: inst?.filter ?? "all",
  };
}
