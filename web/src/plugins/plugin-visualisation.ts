import type { ModeOption, PluginField, ViewMode } from "../core/modes";
import { BACKDROP_OPTIONS, type BackdropKind } from "../graph/backdrop";
import { parseMosaicTiles } from "../graph/mosaic-layout";
import { parseFabric, parseGraphSpace } from "../graph/fabric";
import { parseGraphLayout, parseGraphLinks } from "../graph/graph-layouts";
import { parsePluginIdle } from "./fixtures/golden-state";
import { parseVizContract, parseVizContractResult } from "./viz-host";
import { parseTypeSafeContract } from "./typesafe-host";
import { parseInstances } from "./instances";
import type {
  PluginEngine,
  PluginLayout,
  PluginLook,
  PluginStyle,
  PluginView,
} from "./plugin";

/** Host engines plugins may wrap. Unknown `visualisation.engine` values are rejected. */
export const PLUGIN_ENGINES = [
  "graph", "netpong", "invaders", "command", "frogger", "cpupong", "doom",
  "waves", "orbits", "helix", "skyline", "pacman", "tetris", "portal", "carousel",
] as const satisfies readonly PluginEngine[];

const ENGINE_SET = new Set<string>(PLUGIN_ENGINES);
const BACKDROP_SET = new Set<string>(BACKDROP_OPTIONS.map((o) => o.value));
const NODE_COLORS = new Set(["role", "kind", "heat", "proto", "hash"]);
const NODE_SCALES = new Set(["default", "bytes", "rate"]);
const LABEL_STYLES = new Set(["default", "all", "none", "top"]);
const CHROMES = new Set(["top", "left", "right"]);
const LOOK_KEYS = [
  "theme", "chrome", "backdrop", "stageOnly",
  "skyOpacity", "skyBright", "skySpeed", "skyEase", "skyAudio", "skyCycle",
  "bgColor", "bgOpacity", "bgAudio",
  "gridShape", "gridColor", "gridSize", "gridFollow", "gridOpacity", "gridBright", "gridAudio",
  "audioDrive", "audioSens", "audioCamera", "audioNodes",
  "themeCycle", "edgeGlow", "edgeGlowAmt", "edgeGlowSpeed", "graphFabric", "graphSpace", "graphLayout", "graphLinks",
  "mosaic", "hero", "mosaicTiles", "mosaicSharedTheme", "mosaicUniqueSkies",
] as const;

export type CatalogRow = {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  hint?: unknown;
  engine?: unknown;
  base?: unknown;
  look?: unknown;
  style?: unknown;
  layout?: unknown;
  options?: unknown;
  config?: unknown;
  visualisation?: unknown;
  file?: unknown;
  runtime?: unknown;
  entry?: unknown;
  capabilities?: unknown;
  viz?: unknown;
  typesafe?: unknown;
  hash?: unknown;
  service?: unknown;
  consent?: unknown;
  origin?: unknown;
  parts?: unknown;
  frontend?: unknown;
  instances?: unknown;
  has_frontend?: unknown;
  has_sky?: unknown;
  has_sky_shader?: unknown;
  has_backend?: unknown;
  has_datasource?: unknown;
  shader_sha256?: unknown;
  sky_available?: unknown;
  sky_error?: unknown;
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function asString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  return s ? s : undefined;
}

function asPairs(raw: unknown): [string, string][] {
  if (Array.isArray(raw)) {
    const out: [string, string][] = [];
    for (const item of raw) {
      if (Array.isArray(item) && item.length >= 2) {
        out.push([String(item[0]), String(item[1])]);
      }
    }
    return out;
  }
  const rec = asRecord(raw);
  if (!rec) return [];
  return Object.entries(rec).map(([k, v]) => [k, String(v)]);
}

function asOption(key: string, raw: unknown): ModeOption | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const id = asString(rec.key) ?? key;
  if (!id) return undefined;
  const values = asPairs(rec.values);
  const label = asString(rec.label) ?? id;
  const fallback = values[0]?.[0] ?? "";
  const def = rec.default !== undefined ? String(rec.default) : fallback;
  return { key: id, label, values, default: def };
}

function asField(key: string, raw: unknown): PluginField | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const id = asString(rec.key) ?? key;
  if (!id) return undefined;
  const type = rec.type === "boolean" || rec.type === "select" || rec.type === "number" || rec.type === "text" || rec.type === "textarea"
    ? rec.type
    : "text";
  const field: PluginField = {
    key: id,
    label: asString(rec.label) ?? id,
    type,
  };
  if (asString(rec.hint)) field.hint = asString(rec.hint);
  if (rec.default !== undefined) field.default = rec.default as string | number | boolean;
  const values = asPairs(rec.values);
  if (values.length) field.values = values;
  if (typeof rec.min === "number") field.min = rec.min;
  if (typeof rec.max === "number") field.max = rec.max;
  if (typeof rec.step === "number") field.step = rec.step;
  return field;
}

function asListOrMap<T>(raw: unknown, parse: (key: string, value: unknown) => T | undefined): T[] {
  if (Array.isArray(raw)) {
    const out: T[] = [];
    for (const item of raw) {
      const rec = asRecord(item);
      const parsed = parse(asString(rec?.key) ?? "", item);
      if (parsed) out.push(parsed);
    }
    return out;
  }
  const rec = asRecord(raw);
  if (!rec) return [];
  const out: T[] = [];
  for (const [key, value] of Object.entries(rec)) {
    const parsed = parse(key, value);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseOptions(raw: unknown): ModeOption[] | undefined {
  const out = asListOrMap(raw, asOption);
  return out.length ? out : undefined;
}

export function parseConfig(raw: unknown): PluginField[] | undefined {
  const out = asListOrMap(raw, asField);
  return out.length ? out : undefined;
}

export function parseLook(raw: unknown): PluginLook | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const look: PluginLook = {};
  for (const key of LOOK_KEYS) {
    if (!(key in rec)) continue;
    const v = rec[key];
    if (v === undefined) continue;
    if (key === "backdrop") {
      if (typeof v === "string" && BACKDROP_SET.has(v)) look.backdrop = v as BackdropKind;
      continue;
    }
    if (key === "chrome") {
      if (typeof v === "string" && CHROMES.has(v)) look.chrome = v as PluginLook["chrome"];
      continue;
    }
    if (key === "stageOnly") {
      if (typeof v === "boolean") look.stageOnly = v;
      continue;
    }
    if (key === "graphFabric") {
      const f = parseFabric(v);
      if (f) look.graphFabric = f;
      continue;
    }
    if (key === "graphSpace") {
      const space = parseGraphSpace(v);
      if (space) look.graphSpace = space;
      continue;
    }
    if (key === "graphLayout") {
      const layout = parseGraphLayout(v);
      if (layout) look.graphLayout = layout;
      continue;
    }
    if (key === "graphLinks") {
      const links = parseGraphLinks(v);
      if (links) look.graphLinks = links;
      continue;
    }
    if (key === "mosaic") {
      if (v === "4" || v === "6" || v === "8") look.mosaic = v;
      continue;
    }
    if (key === "hero") {
      if (v === "off" || v === "left" || v === "center" || v === "right") look.hero = v;
      continue;
    }
    if (key === "mosaicTiles") {
      const tiles = parseMosaicTiles(v);
      if (tiles.length) look.mosaicTiles = tiles;
      continue;
    }
    if (key === "mosaicSharedTheme") {
      if (typeof v === "boolean") look.mosaicSharedTheme = v;
      continue;
    }
    if (key === "mosaicUniqueSkies") {
      if (typeof v === "boolean") look.mosaicUniqueSkies = v;
      continue;
    }
    (look as Record<string, unknown>)[key] = v;
  }
  return Object.keys(look).length ? look : undefined;
}

export function parseStyle(raw: unknown): PluginStyle | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const style: PluginStyle = {};
  if (typeof rec.nodeColor === "string" && NODE_COLORS.has(rec.nodeColor)) {
    style.nodeColor = rec.nodeColor as PluginStyle["nodeColor"];
  }
  if (typeof rec.nodeScale === "string" && NODE_SCALES.has(rec.nodeScale)) {
    style.nodeScale = rec.nodeScale as PluginStyle["nodeScale"];
  }
  if (typeof rec.labels === "string" && LABEL_STYLES.has(rec.labels)) {
    style.labels = rec.labels as PluginStyle["labels"];
  }
  if (typeof rec.flatten === "boolean") style.flatten = rec.flatten;
  const fabric = parseFabric(rec.fabric);
  if (fabric) style.fabric = fabric;
  return Object.keys(style).length ? style : undefined;
}

export function parseLayout(raw: unknown): PluginLayout | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const layout: PluginLayout = {};
  if (typeof rec.lanShell === "number") layout.lanShell = rec.lanShell;
  if (typeof rec.internetShell === "number") layout.internetShell = rec.internetShell;
  return Object.keys(layout).length ? layout : undefined;
}

function parseEngine(raw: unknown): PluginEngine | undefined {
  const s = asString(raw);
  if (!s) return undefined;
  if (!ENGINE_SET.has(s)) throw new Error(`unknown visualisation.engine ${s}`);
  return s as PluginEngine;
}

function vizBlock(raw: CatalogRow): Record<string, unknown> {
  return asRecord(raw.visualisation) ?? {};
}

/** True when the catalog row declared a visualisation.yml (or legacy top-level engine/look). */
export function hasVisualisation(raw: CatalogRow): boolean {
  if (asRecord(raw.visualisation)) return true;
  if (Array.isArray(raw.parts) && raw.parts.includes("visualisation")) return true;
  return raw.engine !== undefined || raw.base !== undefined || raw.look !== undefined
    || raw.style !== undefined || raw.layout !== undefined
    || raw.options !== undefined || raw.config !== undefined;
}

/**
 * Translate a catalog row (plugin.yml identity + optional visualisation.yml) into PluginView.
 * visualisation.yml wins over legacy top-level engine/look/style/layout/options/config.
 */
export function toPluginView(raw: unknown): PluginView {
  const row = (asRecord(raw) ?? {}) as CatalogRow;
  const viz = vizBlock(row);
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id) throw new Error("plugin id is required");
  if (!name) throw new Error("plugin name is required");
  const version = typeof row.version === "number" ? row.version : Number(row.version);
  if (!Number.isFinite(version) || version < 1) throw new Error("plugin version is required");

  const engine = parseEngine(viz.engine ?? row.engine);
  const idle = parsePluginIdle(viz.idle);
  const spec: PluginView = {
    id,
    name,
    version,
    hint: asString(viz.hint) ?? asString(row.hint),
    engine,
    base: asString(viz.base) ?? asString(row.base),
    options: parseOptions(viz.options ?? row.options),
    config: parseConfig(viz.config ?? row.config),
    style: parseStyle(viz.style ?? row.style),
    layout: parseLayout(viz.layout ?? row.layout),
    look: parseLook(viz.look ?? row.look),
    instances: parseInstances(row.instances),
  };
  if (idle) spec.idle = idle;
  if (asString(row.file)) spec.file = asString(row.file);
  if (row.runtime === "yaml" || row.runtime === "typescript") spec.runtime = row.runtime;
  if (asString(row.entry)) spec.entry = asString(row.entry);
  const fe = asRecord(row.frontend);
  const feEntry = asString(fe?.entry);
  if (feEntry) spec.frontend = { entry: feEntry };
  if (!spec.entry && feEntry) spec.entry = feEntry;
  if (Array.isArray(row.capabilities)) {
    spec.capabilities = row.capabilities.filter((c): c is NonNullable<PluginView["capabilities"]>[number] =>
      c === "graph.read" || c === "graph.style" || c === "ui.overlay" || c === "config.read"
      || c === "viz.read" || c === "viz.write" || c === "typesafe");
  }
  const vizParsed = parseVizContractResult(row.viz);
  if (vizParsed?.state === "Blocked") {
    spec.viz_block = vizParsed.reason;
    spec.sky_available = false;
    spec.sky_error = vizParsed.reason;
  } else if (vizParsed?.state === "ready") {
    spec.viz = vizParsed.contract;
  }
  const typesafeContract = parseTypeSafeContract(row.typesafe);
  if (typesafeContract) spec.typesafe = typesafeContract;
  if (asString(row.hash)) spec.hash = asString(row.hash);
  if (asString(row.service)) spec.service = asString(row.service);
  if (row.consent === "reviewed" || row.consent === "authored" || row.consent === null) spec.consent = row.consent;
  if (row.origin === "src" || row.origin === "zip" || row.origin === "local") spec.origin = row.origin;
  if (typeof row.has_frontend === "boolean") spec.has_frontend = row.has_frontend;
  if (typeof row.has_sky === "boolean") spec.has_sky = row.has_sky;
  if (typeof row.has_sky_shader === "boolean") spec.has_sky_shader = row.has_sky_shader;
  if (typeof row.has_backend === "boolean") spec.has_backend = row.has_backend;
  if (typeof row.has_datasource === "boolean") spec.has_datasource = row.has_datasource;
  if (asString(row.shader_sha256)) spec.shader_sha256 = asString(row.shader_sha256);
  if (typeof row.sky_available === "boolean") spec.sky_available = row.sky_available;
  if (asString(row.sky_error)) spec.sky_error = asString(row.sky_error);
  return spec;
}

function mergeByKey<T extends { key: string }>(base: T[] | undefined, extra: T[] | undefined): T[] | undefined {
  if (!extra?.length) return base;
  const out = [...(base ?? [])];
  for (const item of extra) {
    const i = out.findIndex((x) => x.key === item.key);
    if (i >= 0) out[i] = item;
    else out.push(item);
  }
  return out;
}

/** Overlay later-catalog pins onto the first row: look / style / layout / options / config only. */
export function mergeOverlayPins(base: PluginView, extra: PluginView): PluginView {
  return {
    ...base,
    hint: extra.hint || base.hint,
    look: extra.look ? { ...base.look, ...extra.look } : base.look,
    style: extra.style ? { ...base.style, ...extra.style } : base.style,
    layout: extra.layout ? { ...base.layout, ...extra.layout } : base.layout,
    options: mergeByKey(base.options, extra.options),
    config: mergeByKey(base.config, extra.config),
  };
}

/** First unique plugin.yml.id is a menu row; later same ids overlay pins. */
export function partitionCatalog(specs: PluginView[]): {
  rows: PluginView[];
  overlays: Map<string, PluginView>;
} {
  const rows: PluginView[] = [];
  const overlays = new Map<string, PluginView>();
  const index = new Map<string, number>();
  for (const spec of specs) {
    const i = index.get(spec.id);
    if (i === undefined) {
      index.set(spec.id, rows.length);
      rows.push(spec);
      continue;
    }
    const prev = overlays.get(spec.id);
    overlays.set(spec.id, prev ? mergeOverlayPins(prev, spec) : spec);
  }
  return { rows, overlays };
}

export function optionToField(opt: ModeOption): PluginField {
  return {
    key: opt.key,
    label: opt.label,
    type: "select",
    values: opt.values,
    default: opt.default,
  };
}

export const VIEW_PROMPT_KEY = "prompt";
export const VIEW_PROMPT_MAX = 800;
export const VIEW_PROMPT_FIELD: PluginField = {
  key: VIEW_PROMPT_KEY,
  label: "prompt",
  type: "textarea",
  default: "",
  hint: "This profile's brief for AI Dynamic on this view — mood, palette, motif. Empty uses the default sky prompt.",
};

/** Settings "This view" knobs: compiled view options (host engine + YAML) plus config, then the profile prompt. */
export function pluginViewKnobs(spec: PluginView, fields?: PluginField[]): PluginField[] {
  const options = (spec.options ?? []).map(optionToField);
  const config = fields ?? spec.config ?? [];
  const knobs = mergeByKey(options, config) ?? [];
  if (!knobs.some((f) => f.key === VIEW_PROMPT_KEY)) knobs.push(VIEW_PROMPT_FIELD);
  return knobs;
}

/** Map visualisation.engine onto the ViewMode dispatch fields (graphBase / arcadeId). */
export function engineDispatch(spec: Pick<PluginView, "engine" | "base">): Pick<ViewMode, "graphBase" | "arcadeId" | "standalone"> {
  if (spec.engine && spec.engine !== "graph") {
    return { standalone: true, arcadeId: spec.engine, graphBase: undefined };
  }
  const base = spec.base === "cores" || spec.base === "load" || spec.base === "cpu" ? "cpu" : spec.base;
  return { standalone: false, arcadeId: undefined, graphBase: base };
}
