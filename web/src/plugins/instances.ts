import type { PluginField } from "../core/modes";
import type { PluginView } from "./plugin";

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

export function configStoreId(spec: Pick<PluginView, "id" | "instanceId">): string {
  return spec.instanceId && spec.instanceId !== spec.id ? `${spec.id}:${spec.instanceId}` : spec.id;
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

/** Resolve a persisted config store id (catalog or `id:instance`) to the expanded plugin spec. */
export function pluginSpecForStoreId(specs: PluginView[], storeId: string): PluginView | null {
  for (const raw of specs) {
    for (const expanded of expandPluginInstances(raw)) {
      if (configStoreId(expanded) === storeId) return expanded;
    }
  }
  return null;
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
