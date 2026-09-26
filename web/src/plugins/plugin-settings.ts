import {
  encodeStoredConfigValue,
  fieldDefault,
  instanceDefaultValue,
  PRESET_BASE_META_KEY,
  type PluginView,
} from "./plugin";
import type { PluginField } from "../core/modes";
import type { PluginPreset, PluginSectionDecl, PluginSettingsDecl } from "./plugin-visualisation";
import { VIEW_PROMPT_KEY } from "./plugin-visualisation";

export { PRESET_BASE_META_KEY } from "./plugin";

export const CUSTOM_PRESET_ID = "custom";
const UNDO_RING_SIZE = 10;

const sectionOpen = new Map<string, Map<string, boolean>>();
const undoRings = new Map<string, Record<string, string>[]>();

export function hasDeclaredSettings(spec: PluginView): boolean {
  const s = spec.settings;
  return !!(s?.presets?.length || s?.sections?.length || s?.hud?.labelFields?.length);
}

export function fieldDefaultForSpec(spec: PluginView, field: PluginField): string {
  const inst = instanceDefaultValue(spec, field.key);
  return inst !== undefined ? inst : fieldDefault(field);
}

function hasRandomisableFields(spec: PluginView, fields: PluginField[]): boolean {
  const pf = spec.settings?.presetField;
  for (const f of fields) {
    if (f.randomise === false) continue;
    if (pf && f.key === pf) continue;
    if (isMetaConfigKey(f.key)) continue;
    if (f.type === "textarea") continue;
    if (f.type === "text") continue;
    if (f.type === "boolean") {
      if (f.randomise === true) return true;
      continue;
    }
    return true;
  }
  return false;
}

export function showSettingsToolbar(spec: PluginView, fields: PluginField[]): boolean {
  return !!(spec.settings?.presets?.length || hasRandomisableFields(spec, fields));
}

export function isMetaConfigKey(key: string): boolean {
  return key === PRESET_BASE_META_KEY || key.startsWith("__");
}

/** Config keys pushed to the plugin sandbox / profile export. */
export function packConfigValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!isMetaConfigKey(k)) out[k] = v;
  }
  return out;
}

export function sectionOpenState(storeId: string, title: string, sectionDecl: PluginSectionDecl[], index: number): boolean {
  let map = sectionOpen.get(storeId);
  if (!map) {
    map = new Map();
    sectionOpen.set(storeId, map);
  }
  const saved = map.get(title);
  if (saved !== undefined) return saved;
  const decl = sectionDecl.find((s) => s.title === title);
  if (decl) return decl.collapsed !== true;
  return true;
}

export function rememberSectionOpen(storeId: string, title: string, open: boolean): void {
  let map = sectionOpen.get(storeId);
  if (!map) {
    map = new Map();
    sectionOpen.set(storeId, map);
  }
  map.set(title, open);
}

export function clearUndoRing(storeId: string): void {
  undoRings.delete(storeId);
}

/** Drop UI session state after a catalog reload (sections, undo stacks). */
export function clearPluginSettingsUiState(): void {
  sectionOpen.clear();
  undoRings.clear();
}

export function undoRingDepth(storeId: string): number {
  return undoRings.get(storeId)?.length ?? 0;
}

function undoRing(storeId: string): Record<string, string>[] {
  let ring = undoRings.get(storeId);
  if (!ring) {
    ring = [];
    undoRings.set(storeId, ring);
  }
  return ring;
}

export function pushUndoSnapshot(storeId: string, values: Record<string, string>): void {
  const ring = undoRing(storeId);
  ring.push({ ...values });
  while (ring.length > UNDO_RING_SIZE) ring.shift();
}

export function popUndoSnapshot(storeId: string): Record<string, string> | null {
  const ring = undoRing(storeId);
  return ring.length ? ring.pop()! : null;
}

export function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function snapNumber(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (!step || step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

export function validateRandomRange(field: PluginField, range: [number, number]): boolean {
  if (field.type !== "number") return false;
  if (field.min === undefined || field.max === undefined) return false;
  const min = field.min;
  const max = field.max;
  return range[0] >= min && range[1] <= max && range[0] <= range[1];
}

export function presetById(decl: PluginSettingsDecl | undefined, id: string): PluginPreset | undefined {
  return decl?.presets?.find((p) => p.id === id);
}

export function presetValueForField(
  field: PluginField | undefined,
  value: string | number | boolean,
): string {
  return encodeStoredConfigValue(field, value);
}

export function presetValuesToStrings(
  values: Record<string, string | number | boolean>,
  fields?: PluginField[],
): Record<string, string> {
  const byKey = new Map(fields?.map((f) => [f.key, f]));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = presetValueForField(byKey.get(k), v);
  }
  return out;
}

export function activePresetId(spec: PluginView, values: Record<string, string>): string | null {
  const field = spec.settings?.presetField;
  if (!field) return null;
  const raw = values[field];
  return raw && raw !== CUSTOM_PRESET_ID ? raw : null;
}

export function derivedPresetId(spec: PluginView, values: Record<string, string>): string | null {
  const active = activePresetId(spec, values);
  if (active) return active;
  const base = values[PRESET_BASE_META_KEY];
  return base || null;
}

export function valuesMatchPreset(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
  preset: PluginPreset,
  presetField?: string,
): boolean {
  const want = presetValuesToStrings(preset.values, fields);
  for (const f of fields) {
    if (presetField && f.key === presetField) continue;
    if (isMetaConfigKey(f.key)) continue;
    if (f.type === "text") continue;
    if (f.type === "textarea") continue;
    const cur = values[f.key] ?? fieldDefaultForSpec(spec, f);
    const exp = want[f.key] ?? fieldDefaultForSpec(spec, f);
    if (String(cur) !== String(exp)) return false;
  }
  return true;
}

export function isCustomConfig(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
): boolean {
  const pf = spec.settings?.presetField;
  if (!pf) return false;
  if (values[pf] === CUSTOM_PRESET_ID) return true;
  const pid = values[pf];
  if (!pid) return false;
  const preset = presetById(spec.settings, pid);
  if (!preset) return false;
  return !valuesMatchPreset(spec, fields, values, preset, pf);
}

export function fieldBaselineForDirty(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
  key: string,
): string | undefined {
  const decl = spec.settings;
  const field = fields.find((f) => f.key === key);
  if (!field || isMetaConfigKey(key)) return undefined;
  if (!decl?.presets?.length) return fieldDefaultForSpec(spec, field);
  const pf = decl.presetField;
  if (pf && key === pf) return undefined;
  const baseId = derivedPresetId(spec, values);
  if (!baseId) return undefined;
  const preset = presetById(decl, baseId);
  if (!preset) return undefined;
  const mapped = presetValuesToStrings(preset.values, fields);
  if (key in mapped) return mapped[key];
  const inst = instanceDefaultValue(spec, key);
  if (inst !== undefined) return inst;
  return fieldDefault(field);
}

export function fieldLabelForValue(field: PluginField, value: string): string {
  if (field.type === "select" && field.values?.length) {
    const row = field.values.find(([v]) => v === value);
    if (row) return row[1];
  }
  if (field.type === "boolean") return value === "1" || value === "true" ? "on" : "off";
  return value;
}

export function buildPluginHudCaption(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
): string | null {
  const keys = spec.settings?.hud?.labelFields;
  if (!keys?.length) return null;
  const parts: string[] = [];
  const pf = spec.settings?.presetField;
  for (const key of keys) {
    if (pf && key === pf) {
      if (isCustomConfig(spec, fields, values)) {
        parts.push("Custom");
      } else {
        const pid = values[pf] ?? "";
        const preset = presetById(spec.settings, pid);
        parts.push(preset?.label ?? fieldLabelForValue(
          fields.find((f) => f.key === key) ?? { key, label: key, type: "text" },
          pid,
        ));
      }
      continue;
    }
    const field = fields.find((f) => f.key === key);
    if (!field) continue;
    const cur = values[field.key] ?? fieldDefaultForSpec(spec, field);
    parts.push(fieldLabelForValue(field, cur));
  }
  return parts.length ? parts.join(" · ") : null;
}

export function applyPresetToValues(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
  presetId: string,
): void {
  const preset = presetById(spec.settings, presetId);
  if (!preset) return;
  const pf = spec.settings?.presetField;
  Object.assign(values, presetValuesToStrings(preset.values, fields));
  if (pf) values[pf] = presetId;
  delete values[PRESET_BASE_META_KEY];
  markPresetConsistency(spec, fields, values);
}

export function markPresetConsistency(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
): void {
  const decl = spec.settings;
  const pf = decl?.presetField;
  if (!pf || !decl?.presets?.length) return;
  const cur = values[pf];
  if (cur === CUSTOM_PRESET_ID) return;
  if (cur) {
    const preset = presetById(decl, cur);
    if (preset && !valuesMatchPreset(spec, fields, values, preset, pf)) {
      values[PRESET_BASE_META_KEY] = cur;
      values[pf] = CUSTOM_PRESET_ID;
    }
    return;
  }
  for (const preset of decl.presets) {
    if (valuesMatchPreset(spec, fields, values, preset, pf)) {
      values[pf] = preset.id;
      delete values[PRESET_BASE_META_KEY];
      return;
    }
  }
  values[pf] = CUSTOM_PRESET_ID;
}

export function randomiseDeclaredConfig(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
  rng: () => number,
): void {
  const pf = spec.settings?.presetField;
  const prevPreset = pf ? (values[pf] && values[pf] !== CUSTOM_PRESET_ID ? values[pf] : values[PRESET_BASE_META_KEY]) : undefined;
  if (pf && prevPreset) values[PRESET_BASE_META_KEY] = prevPreset;
  for (const f of fields) {
    if (f.randomise === false) continue;
    if (pf && f.key === pf) continue;
    if (isMetaConfigKey(f.key)) continue;
    if (f.type === "textarea") continue;
    if (f.type === "text") continue;
    if (f.type === "boolean") {
      if (f.randomise !== true) continue;
      values[f.key] = rng() < 0.5 ? "0" : "1";
      continue;
    }
    if (f.type === "select" && f.values?.length) {
      const i = Math.floor(rng() * f.values.length);
      values[f.key] = f.values[i]![0];
      continue;
    }
    if (f.type === "number") {
      if (f.min === undefined || f.max === undefined) continue;
      const min = f.min;
      const max = f.max;
      const step = f.step ?? 1;
      let lo = min;
      let hi = max;
      if (f.randomRange) {
        lo = f.randomRange[0];
        hi = f.randomRange[1];
      }
      const raw = lo + rng() * (hi - lo);
      values[f.key] = String(snapNumber(raw, min, max, step));
    }
  }
  if (pf) values[pf] = CUSTOM_PRESET_ID;
}

function resetFieldToDefault(
  spec: PluginView,
  field: PluginField,
  values: Record<string, string>,
): void {
  values[field.key] = fieldDefaultForSpec(spec, field);
}

function skipFieldOnReset(f: PluginField, pf?: string): boolean {
  if (isMetaConfigKey(f.key)) return true;
  if (pf && f.key === pf) return true;
  if (f.type === "text") return true;
  if (f.type === "textarea") return true;
  return false;
}

/** Pack default preset: instance default preset id when valid, else settings.presets[0]. */
export function defaultPresetForReset(spec: PluginView): PluginPreset | null {
  const decl = spec.settings;
  if (!decl?.presets?.length) return null;
  const pf = decl.presetField ?? "preset";
  const inst = instanceDefaultValue(spec, pf);
  if (inst && decl.presets.some((p) => p.id === inst)) {
    return presetById(decl, inst) ?? null;
  }
  return decl.presets[0] ?? null;
}

export function resetDeclaredConfig(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
): void {
  const decl = spec.settings;
  const pf = decl?.presetField;
  const prompt = values[VIEW_PROMPT_KEY];
  const preset = defaultPresetForReset(spec);
  if (preset) {
    if (pf) values[pf] = preset.id;
    for (const f of fields) {
      if (skipFieldOnReset(f, pf)) continue;
      if (Object.prototype.hasOwnProperty.call(preset.values, f.key)) {
        values[f.key] = presetValueForField(f, preset.values[f.key]!);
      } else {
        resetFieldToDefault(spec, f, values);
      }
    }
  } else {
    for (const f of fields) {
      if (isMetaConfigKey(f.key)) continue;
      if (pf && f.key === pf) continue;
      if (f.type === "textarea" && f.key === VIEW_PROMPT_KEY) continue;
      if (f.type === "text" || f.type === "textarea") continue;
      resetFieldToDefault(spec, f, values);
    }
  }
  if (prompt !== undefined) values[VIEW_PROMPT_KEY] = prompt;
  delete values[PRESET_BASE_META_KEY];
  markPresetConsistency(spec, fields, values);
}

export function orderedSectionTitles(
  spec: PluginView,
  fields: PluginField[],
): string[] {
  const decl = spec.settings?.sections;
  const seen = new Set<string>();
  const out: string[] = [];
  if (decl?.length) {
    for (const s of decl) {
      if (!seen.has(s.title)) {
        seen.add(s.title);
        out.push(s.title);
      }
    }
  }
  for (const f of fields) {
    const t = f.section ?? "";
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
