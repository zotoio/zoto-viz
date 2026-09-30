import {
  allModes,
  ARCADE_ENGINES,
  categorize,
  GRAPH_BASES,
  graphModes,
  heat,
  hashColor,
  hostEngine,
  paneLabelCap,
  setPluginModes,
  topology,
  viewCaption,
  type ModeOption,
  type PluginField,
  type ShellSet,
  type ViewMode,
} from "../core/modes";
import {
  configStoreId,
  expandPluginInstances,
  parsePluginId,
  pluginViewId,
} from "./instances";
import type { PluginInstance } from "./instances";
import { RECENT_VIEW_GROUP, recentViewIds } from "./recent-views";
import {
  blockedCatalogEntries,
  blockedViewSelectRow,
  catalogErrorLooksBlocked,
  PACK_INSTALL_CHECK_UNAVAILABLE,
  consumePackInstallNotices,
  queuePackInstallBlockedNotice,
  syncBlockedCatalogFromErrors,
  takePackInstallBlockedNotice,
} from "./pack-install-surface";
import {
  engineDispatch,
  mergeOverlayPins,
  partitionCatalog,
  PLUGIN_ENGINES,
  pluginViewKnobs,
  toPluginView,
} from "./plugin-visualisation";
import type { GNode, DreamAnim, EdgeGlow, AudioDrive, HeroPos, MosaicSize, ThemeCycle } from "../graph/scene";
import { parseMosaicTiles } from "../graph/mosaic-layout";
import { parseFabric, type FabricKind, type GraphSpace } from "../graph/fabric";
import type { GraphLayout, GraphLinks } from "../graph/graph-layouts";
import { guardReadableAnim } from "../graph/readable";
import type { BackdropKind } from "../graph/backdrop";
import type { FloorShape } from "../graph/floor";
import { KIND_COLOR, ROLE_COLOR, deviceKind, displayName } from "../core/types";
import { apiFetch } from "../core/http";
import type { ManifestBlockedPlugin } from "./plugin-manifest-blocked";
import {
  isUnavailableRow,
  setUnavailableCatalog,
  unavailableBanner,
  unavailablePackForView,
  unavailablePickerRows,
} from "./plugin-unavailable";
import {
  manifestBlockedViewSelectRow,
  setManifestBlockedCatalog,
} from "./plugin-manifest-blocked";
import { PluginSandbox, pluginModuleUrl } from "./host";
import type { PluginIdleConfig } from "./fixtures/golden-state";
import type { RenderScaleConfig } from "./render-scale-governor";
import type { VizPluginContract } from "./viz-host";
import type { TypeSafeContract } from "./typesafe-host";
import { parseTypeSafeContract } from "./typesafe-host";
import { addModeSwitchAbortListener, removeModeSwitchAbortListener } from "../app/mode-switch-attempt";

function dimHex(hex: number, amount: number): number {
  const r = Math.round(((hex >> 16) & 255) * amount);
  const g = Math.round(((hex >> 8) & 255) * amount);
  const b = Math.round((hex & 255) * amount);
  return (r << 16) | (g << 8) | b;
}

export type PluginEngine =
  | "graph" | "netpong" | "invaders" | "command" | "frogger" | "cpupong" | "doom"
  | "waves" | "orbits" | "helix" | "skyline" | "pacman" | "tetris" | "portal" | "carousel";
export type NodeColorStyle = "role" | "kind" | "heat" | "proto" | "hash";
export type NodeScaleStyle = "default" | "bytes" | "rate";
export type LabelStyle = "default" | "all" | "none" | "top";

export interface PluginStyle {
  nodeColor?: NodeColorStyle;
  nodeScale?: NodeScaleStyle;
  labels?: LabelStyle;
  flatten?: boolean;
  /** Nodes + edges become an animated fabric mesh (same highlight / glow as the sphere graph). */
  fabric?: FabricKind | boolean;
  /**
   * Style-library ids (`orbit-helix`, or a list to combine left to right).
   * Resolved into fabric / space / layout / links. Keys set beside `library` win.
   */
  library?: string[];
}

export interface PluginLayout {
  lanShell?: number;
  internetShell?: number;
}

/** Optional per-view pins. Omitted keys keep the core settings cog / active profile. */
export interface PluginLook {
  theme?: string;
  chrome?: "top" | "left" | "right";
  backdrop?: BackdropKind;
  /** Hide nodes / edges / labels so the plugin sky owns the frame. */
  stageOnly?: boolean;
  skyOpacity?: number;
  skyBright?: number;
  skySpeed?: number;
  skyEase?: number;
  skyPhotoS?: number;
  skyAudio?: boolean;
  skyCycle?: ThemeCycle;
  bgColor?: string;
  bgOpacity?: number;
  bgAudio?: boolean;
  gridShape?: FloorShape;
  gridColor?: string;
  gridSize?: number;
  gridOpacity?: number;
  gridBright?: number;
  gridAudio?: boolean;
  gridFollow?: number;
  audioDrive?: AudioDrive;
  audioSens?: number;
  audioCamera?: boolean;
  audioNodes?: boolean;
  themeCycle?: ThemeCycle;
  edgeGlow?: EdgeGlow;
  edgeGlowAmt?: number;
  edgeGlowSpeed?: number;
  edgeOpacity?: number;
  nodeShape?: import("../graph/node-shapes").NodeShapePin;
  graphFabric?: FabricKind | boolean;
  graphSpace?: GraphSpace;
  graphLayout?: GraphLayout;
  graphLinks?: GraphLinks;
  /** Open a mosaic wall of other catalog views when this plugin is selected. */
  mosaic?: MosaicSize;
  hero?: HeroPos;
  mosaicTiles?: string[];
  mosaicSharedTheme?: boolean;
  mosaicUniqueSkies?: boolean;
}

export type PluginWall = {
  mosaic: Exclude<MosaicSize, "off">;
  hero: HeroPos;
  mosaicTiles: string[];
  mosaicSharedTheme: boolean;
};

/** A plugin look that pins a multi-view mosaic (Syscon and future walls). */
export function pluginWall(look?: PluginLook | null): PluginWall | null {
  if (!look?.mosaic || look.mosaic === "off") return null;
  const mosaicTiles = parseMosaicTiles(look.mosaicTiles);
  if (mosaicTiles.length < 2) return null;
  return {
    mosaic: look.mosaic,
    hero: look.hero ?? "off",
    mosaicTiles,
    mosaicSharedTheme: look.mosaicSharedTheme !== false,
  };
}

export function pluginWallOwns(look: PluginLook | null | undefined, modeId: string): boolean {
  const wall = pluginWall(look);
  return !!wall && wall.mosaicTiles.includes(modeId);
}

/** True when this catalog row ships a plugin-sky fragment. */
export function pluginHasSky(spec: { has_sky_shader?: boolean; shader_sha256?: string; look?: PluginLook } | null | undefined): boolean {
  if (!spec) return false;
  const backdrop = spec.look?.backdrop;
  return (spec.has_sky_shader === true || !!spec.shader_sha256) && (backdrop === undefined || backdrop === "plugin");
}

/**
 * Wall views keep extras on their own look, but the selected wall row's
 * plugin sky wins over a sky-less hero tile (Syscon / Cypher CIC).
 */
export function pickPluginSkySpec<T extends { has_sky_shader?: boolean; shader_sha256?: string; look?: PluginLook }>(
  selected: T | null,
  pane: T | null,
): T | null {
  if (pluginHasSky(selected)) return selected;
  if (pluginHasSky(pane)) return pane;
  return pane ?? selected;
}

/** Catalog views whose look pins a multi-tile mosaic (Syscon and future walls). */
export function catalogPluginWalls(): { modeId: string; wall: PluginWall }[] {
  const out: { modeId: string; wall: PluginWall }[] = [];
  for (const [modeId, look] of looks) {
    const wall = pluginWall(look);
    if (wall) out.push({ modeId, wall });
  }
  return out;
}

export type PluginCapability =
  | "graph.read" | "graph.style" | "ui.overlay" | "config.read" | "viz.read" | "viz.write"
  | "typesafe";

export interface PluginView {
  id: string;
  name: string;
  version: number;
  hint?: string;
  /** plugin.yml `picker: hidden`: test / fixture pack, never offered in a picker or random pick. */
  picker?: "hidden";
  /** Catalog row when this spec was expanded from plugin.yml instances. */
  instanceId?: string;
  /** Short label for mosaic tiles when distinct from {@link name}. */
  instanceLabel?: string;
  packName?: string;
  /** Defaults from the matched plugin.yml instance row (before pack fallback). */
  instanceDefaults?: Record<string, string | number | boolean>;
  instances?: PluginInstance[];
  /** Absent when the zip has no visualisation.yml and plugin.yml ships no engine. */
  engine?: PluginEngine;
  base?: string;
  options?: ModeOption[];
  config?: PluginField[];
  style?: PluginStyle;
  layout?: PluginLayout;
  look?: PluginLook;
  file?: string;
  runtime?: "yaml" | "typescript";
  entry?: string;
  frontend?: { entry?: string };
  capabilities?: PluginCapability[];
  /** visualisation.yml idle golden mock — graph / arcade when capture is quiet. */
  idle?: PluginIdleConfig;
  viz?: VizPluginContract;
  /** Host adaptive render-scale governor steps (from plugin.yml render.scale). */
  renderScale?: RenderScaleConfig;
  /** Host-clamped visualisation.yml workBudget (#45). */
  workBudget?: import("../../../plugins/sdk/manifest-work-budget").ManifestWorkBudget;
  /** Set when the host clamped workBudget below what the pack asked for. */
  workBudgetLimited?: string;
  typesafe?: TypeSafeContract;
  hash?: string;
  sha256?: string;
  service?: string;
  consent?: "reviewed" | "authored" | null;
  /** Why consent is or isn't in place (catalog). Read it through `app/consent-store`, never directly. */
  consent_state?: "none" | "granted" | "changed" | "stale";
  /** Catalog provenance: src (shipped), zip (contrib), or local (~/.zoto-viz/plugins/local). */
  origin?: "src" | "zip" | "local";
  has_frontend?: boolean;
  has_sky?: boolean;
  has_sky_shader?: boolean;
  has_backend?: boolean;
  has_datasource?: boolean;
  shader_sha256?: string;
  sky_available?: boolean;
  sky_error?: string;
  /** Third-party datasource library ids this view wants (`usgs-quakes`, …). */
  sourceLibrary?: string[];
  /** Host drawer: presets, HUD label fields, section order (from plugin.yml / visualisation.yml). */
  settings?: import("./plugin-visualisation").PluginSettingsDecl;
  /** Declared binary assets (meshes/textures) hashed into consent (`assets_sha256`). */
  assets?: { id: string; path: string; sha256?: string; bytes?: number; triangles?: number }[];
  assets_sha256?: string;
  /** Catalog manifest kind; data-source trees are remix feeds, not view menu rows. */
  pluginKind?: "data-source";
  dataSource?: import("../remix/remix-types").DataSourceBlock;
}

const LOOK_ANIM_KEYS = [
  "backdrop", "skyOpacity", "skyBright", "skySpeed", "skyEase", "skyPhotoS", "skyAudio", "skyCycle",
  "bgColor", "bgOpacity", "bgAudio",
  "gridShape", "gridColor", "gridSize", "gridFollow", "gridOpacity", "gridBright", "gridAudio",
  "audioDrive", "audioSens", "audioCamera", "audioNodes",
  "themeCycle", "edgeGlow", "edgeGlowAmt", "edgeGlowSpeed", "edgeOpacity", "nodeShape", "graphFabric", "graphSpace", "graphLayout", "graphLinks",
] as const satisfies readonly (keyof PluginLook)[];

let looks = new Map<string, PluginLook>();
/** View ids of `picker: hidden` packs: still creatable by id, never offered. */
let pickerHidden = new Set<string>();

/** True for a `picker: hidden` view: no picker row, no dice / dream-cycle / new-wall pick. */
export function isPickerHidden(viewId: string): boolean {
  return pickerHidden.has(viewId);
}

/** Graph views the dream cycle steps through (never a `picker: hidden` test pack). */
export function dreamCycleModes(): ViewMode[] {
  return graphModes().filter((m) => !isPickerHidden(m.id));
}

/** Host wrap-target ids (graph bases + arcade engines), not live menu ids. */
export const shippedModeIds = (): Set<string> =>
  new Set([...GRAPH_BASES, ...ARCADE_ENGINES].map((m) => m.id));

export function lookForMode(modeId: string): PluginLook | undefined {
  return looks.get(modeId);
}

export function mergeLook(base: DreamAnim, look?: PluginLook | null): DreamAnim {
  if (!look) return guardReadableAnim(base);
  const out = { ...base };
  for (const key of LOOK_ANIM_KEYS) {
    const v = look[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  return guardReadableAnim(out);
}

export interface PluginList {
  dir: string;
  schema: string;
  plugins: PluginView[];
  errors: { file: string; error: string; message?: string; id?: string; name?: string; import?: string }[];
  blocked?: ManifestBlockedPlugin[];
  /** #169: packs kept in the catalog that can't load (esbuild missing, or one pack's bundle failed). */
  unavailable?: { id: string; name: string; reason: string; available?: false }[];
  installNotices?: { error: string; message: string }[];
  pythonService?: boolean;
}

export {
  configStoreId,
  configStoreIdForMode,
  parsePluginId,
  parsePluginInstance,
  pluginSpecForStoreId,
  pluginViewId,
} from "./instances";

/** Executable plugins (TypeScript, Python, and/or a custom sky shader) need a source-review consent. YAML-only views skip it. */
export function pluginNeedsReview(spec: PluginView): boolean {
  return spec.runtime === "typescript" || spec.has_frontend === true || spec.has_backend === true
    || spec.has_datasource === true || !!spec.service
    || spec.has_sky_shader === true || !!spec.shader_sha256;
}

export function pluginHasFrontend(spec: PluginView | null | undefined): boolean {
  return !!spec && (spec.has_frontend === true || spec.runtime === "typescript");
}

/** Tile chrome title: instance label, then pack name, then catalog name. */
export function tileDisplayName(spec: PluginView): string {
  return spec.instanceLabel || spec.packName || spec.name || spec.id;
}

export function pluginModulePath(id: string, hash?: string): string {
  return pluginModuleUrl(id, hash);
}

export function pluginSkyPath(id: string, hash?: string): string {
  const path = `/api/plugins/${encodeURIComponent(id)}/sky/fragment.glsl`;
  return hash ? `${path}?h=${encodeURIComponent(hash)}` : path;
}

/** Fetch `/api/plugins/<id>/sky/fragment.glsl` (403 without consent). */
export async function fetchPluginSky(
  id: string,
  hash?: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const r = await apiFetch(pluginSkyPath(id, hash), { cache: "no-store" });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!r.ok) throw new Error(`plugin sky ${r.status}`);
  const text = await r.text();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return text;
}

/** Fetch `/plugins/<id>/module.js` and load it in the iframe sandbox. */
export async function attachPluginFrontend(
  sandbox: PluginSandbox,
  spec: PluginView | null,
  config: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  if (!pluginHasFrontend(spec)) {
    sandbox.unload();
    return false;
  }
  const dispose = () => { sandbox.unload(); };
  addModeSwitchAbortListener(signal, dispose, { once: true });
  try {
    await sandbox.loadModule(spec!.id, spec!.capabilities ?? [], config, spec!.hash, spec!.viz);
    if (signal?.aborted) {
      sandbox.unload();
      if (signal) removeModeSwitchAbortListener(signal, dispose);
      return false;
    }
    return true;
  } catch (e) {
    if (signal) removeModeSwitchAbortListener(signal, dispose);
    throw e;
  }
}

export function vizContractFor(spec: PluginView | null | undefined): VizPluginContract | undefined {
  return spec?.viz;
}

const storeKey = (id: string, key: string) => `zoto-viz.plugin.${id}.${key}`;

let pluginConfigCacheGen = 0;
let pluginCatalogRevision = 0;
const pluginOptsConfigCache = new Map<string, { gen: number; values: Record<string, string> }>();

export function pluginConfigCacheGeneration(): number {
  return pluginConfigCacheGen;
}

export function pluginCatalogCacheRevision(): number {
  return pluginCatalogRevision;
}

function fieldDefaultsSignature(fields: PluginField[]): string {
  return fields.map((f) => {
    const d = f.default !== undefined ? String(f.default) : "";
    return `${f.key}:${f.type}:${d}:${f.min ?? ""}:${f.max ?? ""}`;
  }).join("\0");
}

function pluginConfigCacheKey(spec: PluginView, fields: PluginField[]): string {
  const storeId = configStoreId(spec);
  const fieldSig = fields.map((f) => f.key).join("\0");
  return `${pluginCatalogRevision}\0${storeId}\0${fieldSig}\0${fieldDefaultsSignature(fields)}`;
}

export function bumpPluginCatalogRevision(): void {
  pluginCatalogRevision += 1;
  pluginConfigCacheGen += 1;
  pluginOptsConfigCache.clear();
}

export function invalidatePluginConfigCache(): void {
  pluginConfigCacheGen += 1;
  pluginOptsConfigCache.clear();
}

/** Cached config for per-frame optsFor (invalidated on writePluginConfig). */
export function loadPluginConfigCached(spec: PluginView, fields: PluginField[]): Record<string, string> {
  const key = pluginConfigCacheKey(spec, fields);
  const hit = pluginOptsConfigCache.get(key);
  if (hit && hit.gen === pluginConfigCacheGen) return hit.values;
  const loaded = loadPluginConfig(spec, fields);
  pluginOptsConfigCache.set(key, { gen: pluginConfigCacheGen, values: loaded });
  return loaded;
}

/** Persisted meta: base preset for custom configs (not exported to packs). */
export const PRESET_BASE_META_KEY = "__presetBase";
export type { PluginInstance } from "./instances";

/** One encoding for field defaults, instance defaults, and preset values (booleans → 1/0). */
export function encodeStoredConfigValue(
  field: PluginField | undefined,
  value: string | number | boolean,
): string {
  if (field?.type === "boolean") {
    return value === true || value === 1 || value === "true" || value === "1" ? "1" : "0";
  }
  return String(value);
}

export function fieldDefault(f: PluginField): string {
  if (f.type === "boolean") return encodeStoredConfigValue(f, f.default ?? false);
  if (f.default !== undefined) return String(f.default);
  if (f.type === "number") return String(f.min ?? 0);
  if (f.type === "select") return f.values?.[0]?.[0] ?? "";
  return "";
}

function instanceDefaultFor(spec: PluginView, key: string): string | undefined {
  const field = spec.config?.find((f) => f.key === key);
  const encode = (raw: string | number | boolean) => encodeStoredConfigValue(field, raw);
  const defs = spec.instanceDefaults;
  if (defs && defs[key] !== undefined) return encode(defs[key]);
  const inst = spec.instances?.find((i) => i.id === (spec.instanceId ?? spec.id));
  const row = inst?.defaults;
  if (!row || row[key] === undefined) return undefined;
  return encode(row[key]);
}

/** Same baseline as loadPluginConfig (instance row before field default). */
export function instanceDefaultValue(spec: PluginView, key: string): string | undefined {
  return instanceDefaultFor(spec, key);
}

export function loadPluginConfig(spec: PluginView, fields = spec.config): Record<string, string> {
  const out: Record<string, string> = {};
  const storeId = configStoreId(spec);
  const viewId = pluginViewId(spec.id, spec.instanceId);
  const metaKeys = [PRESET_BASE_META_KEY];
  for (const mk of metaKeys) {
    const saved = localStorage.getItem(storeKey(storeId, mk));
    if (saved !== null) out[mk] = saved;
  }
  for (const f of fields ?? []) {
    const saved = localStorage.getItem(storeKey(storeId, f.key));
    if (saved !== null) {
      out[f.key] = saved;
      continue;
    }
    const instDef = instanceDefaultFor(spec, f.key);
    if (instDef !== undefined) {
      out[f.key] = instDef;
      continue;
    }
    const pack = spec.instanceId && spec.instanceId !== spec.id
      ? localStorage.getItem(storeKey(spec.id, f.key))
      : null;
    if (pack !== null) {
      out[f.key] = pack;
      continue;
    }
    const legacy = localStorage.getItem(`zoto-viz.mode.${viewId}.${f.key}`);
    out[f.key] = legacy !== null ? legacy : fieldDefault(f);
  }
  return out;
}

export function removePluginConfigKeys(id: string, keys: string[]): void {
  for (const k of keys) localStorage.removeItem(storeKey(id, k));
  invalidatePluginConfigCache();
}

export function writePluginConfig(id: string, values: Record<string, string>): void {
  for (const [k, v] of Object.entries(values)) localStorage.setItem(storeKey(id, k), v);
  invalidatePluginConfigCache();
}

export function collectPluginConfigs(specs: PluginView[]): Record<string, Record<string, string>> {
  const rows = specs.flatMap((s) => expandPluginInstances(s));
  return Object.fromEntries(rows.map((s) => {
    const raw = loadPluginConfig(s, pluginViewKnobs(s));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === PRESET_BASE_META_KEY || k.startsWith("__")) continue;
      out[k] = v;
    }
    return [configStoreId(s), out];
  }));
}

/** Drop stored plugin knobs, then write exactly the profile's saved values. */
export function replacePluginConfigs(raw: Record<string, Record<string, string>> | undefined): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("zoto-viz.plugin.")) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
  applyPluginConfigs(raw);
}

export function applyPluginConfigs(raw: Record<string, Record<string, string>> | undefined): void {
  if (!raw) return;
  for (const [id, values] of Object.entries(raw)) {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (k === PRESET_BASE_META_KEY || k.startsWith("__")) continue;
      cleaned[k] = v;
    }
    writePluginConfig(id, cleaned);
    removePluginConfigKeys(id, [PRESET_BASE_META_KEY]);
  }
}

function mergeOptions(base: ModeOption[] | undefined, extra: ModeOption[] | undefined): ModeOption[] | undefined {
  if (!extra?.length) return base;
  const out = [...(base ?? [])];
  for (const opt of extra) {
    const i = out.findIndex((o) => o.key === opt.key);
    if (i >= 0) out[i] = opt;
    else out.push(opt);
  }
  return out;
}

function mergeFields(base?: PluginField[], extra?: PluginField[]): PluginField[] {
  if (!extra?.length) return base ?? [];
  const out = [...(base ?? [])];
  for (const f of extra) {
    const i = out.findIndex((x) => x.key === f.key);
    if (i >= 0) out[i] = f;
    else out.push(f);
  }
  return out;
}

function compileGraph(spec: PluginView): ViewMode {
  const base = hostEngine(spec.base ?? "topology") ?? topology;
  const style = spec.style ?? {};
  const layout = spec.layout ?? {};
  let maxBytes = 1, maxLogRate = 1;
  const top = new Set<GNode>();

  const mode: ViewMode = {
    ...base,
    id: pluginViewId(spec.id, spec.instanceId),
    label: tileDisplayName(spec),
    hint: spec.hint || base.hint,
    pluginId: spec.id,
    kind: catalogKindOf(spec),
    ...engineDispatch(spec),
    stageOnly: pluginStageOnly(spec),
    options: mergeOptions(base.options, spec.options),
    config: mergeFields(base.config, spec.config),
    flatten: style.flatten ?? base.flatten,
    fabric: (() => {
      const f = parseFabric(style.fabric);
      return f && f !== "off" && f !== "auto" ? f : undefined;
    })(),
    prepare(ctx) {
      maxBytes = 1;
      maxLogRate = 1;
      const ranked: GNode[] = [];
      for (const n of ctx.nodes.values()) {
        if (!n.visible) continue;
        maxBytes = Math.max(maxBytes, n.device.bytes_in + n.device.bytes_out);
        maxLogRate = Math.max(maxLogRate, Math.log10(1 + n.rate));
        if (n.device.role !== "multicast") ranked.push(n);
      }
      ranked.sort((a, b) => (ctx.opts.rank === "bytes"
        ? (b.device.bytes_in + b.device.bytes_out) - (a.device.bytes_in + a.device.bytes_out)
        : b.rate - a.rate));
      top.clear();
      const n = paneLabelCap(ctx, Number(ctx.opts.top) || ctx.labelCount);
      for (const node of ranked.slice(0, n)) top.add(node);
      base.prepare?.(ctx);
    },
    nodeColor(n, ctx) {
      if (ctx.opts.internet === "hide" && n.device.role === "internet") return 0x1a1d24;
      const c = style.nodeColor;
      let hex: number | undefined;
      if (c === "role") hex = ROLE_COLOR[n.device.role];
      else if (c === "kind") hex = KIND_COLOR[deviceKind(n.device)];
      else if (c === "heat") hex = n.rate > 0 ? heat(0.2 + 0.8 * (Math.log10(1 + n.rate) / maxLogRate)) : heat(0);
      else if (c === "proto") hex = categorize(n.device.ports ?? []).color;
      else if (c === "hash") {
        if (spec.base === "wifi" && (n.device.role === "gateway" || (n.device.role === "internet" && !n.device.ip.startsWith("ap:")))) {
          hex = ROLE_COLOR[n.device.role];
        } else {
          hex = hashColor(displayName(n.device) || n.device.ip);
        }
      }
      else hex = base.nodeColor?.(n, ctx);
      if (ctx.opts.internet === "dim" && n.device.role === "internet" && hex !== undefined) {
        return dimHex(hex, 0.4);
      }
      return hex;
    },
    nodeScale(n, ctx) {
      if (ctx.opts.internet === "hide" && n.device.role === "internet") return 0.01;
      const kind = style.nodeScale;
      let s: number | undefined;
      if (kind === "bytes") {
        const share = Math.sqrt((n.device.bytes_in + n.device.bytes_out) / maxBytes);
        s = 3 + 20 * share;
      } else if (kind === "rate") {
        s = 3 + 20 * (Math.log10(1 + n.rate) / maxLogRate);
      } else {
        s = base.nodeScale?.(n, ctx);
      }
      if (ctx.opts.internet === "dim" && n.device.role === "internet" && s !== undefined) return Math.max(2, s * 0.45);
      return s;
    },
    forceLabel(n, ctx) {
      if (ctx.opts.internet === "hide" && n.device.role === "internet") return false;
      if (style.labels === "all") return true;
      if (style.labels === "none") return false;
      if (style.labels === "top") return top.has(n);
      return base.forceLabel?.(n, ctx) ?? false;
    },
    suppressLabel(n, ctx) {
      if (ctx.opts.internet === "hide" && n.device.role === "internet") return true;
      if (style.labels === "all") return false;
      if (style.labels === "none") return true;
      if (style.labels === "top") return !top.has(n);
      return base.suppressLabel?.(n, ctx) ?? false;
    },
    // lanShell / internetShell move the role shells; a base that places particular nodes itself (the Wi-Fi
    // station band, say) does so relative to the moved shells rather than being flattened onto one of them.
    shellRadius: (layout.lanShell || layout.internetShell)
      ? (n, shells) => {
          const eff: ShellSet = {
            ...shells,
            ...(layout.lanShell ? { lan: layout.lanShell, local: layout.lanShell, self: layout.lanShell } : {}),
            ...(layout.internetShell ? { internet: layout.internetShell } : {}),
          };
          return base.shellRadius?.(n, eff) ?? eff[n.device.role];
        }
      : base.shellRadius,
  };
  return mode;
}

function compileArcade(spec: PluginView): ViewMode {
  const engine = spec.engine ?? "netpong";
  const base = hostEngine(engine) ?? ARCADE_ENGINES[0]!;
  return {
    ...base,
    id: pluginViewId(spec.id, spec.instanceId),
    label: spec.name,
    hint: spec.hint || base.hint,
    pluginId: spec.id,
    kind: catalogKindOf(spec),
    ...engineDispatch(spec),
    options: mergeOptions(base.options, spec.options),
    config: spec.config ?? [],
  };
}

export function catalogKindOf(spec: Pick<PluginView, "engine" | "capabilities" | "look">): "graph" | "arcade" | "demo" {
  const caps = spec.capabilities ?? [];
  if (caps.includes("viz.read") || caps.includes("viz.write") || spec.look?.backdrop === "plugin") return "demo";
  if (spec.engine && spec.engine !== "graph") return "arcade";
  return "graph";
}

/**
 * Demo viz packs hide the LAN graph so the plugin sky owns the frame.
 * Graph wraps (topology, talkers, …) keep nodes. `look.stageOnly: false` opts out.
 */
export function pluginStageOnly(
  spec: Pick<PluginView, "engine" | "capabilities" | "look" | "has_sky_shader">,
): boolean {
  if (spec.look?.stageOnly === false) return false;
  if (spec.look?.stageOnly === true) return true;
  return catalogKindOf(spec) === "demo" || spec.has_sky_shader === true;
}

const ARCADE_ENGINE_SET = new Set<string>(PLUGIN_ENGINES.filter((e) => e !== "graph"));

export function compilePlugin(spec: PluginView): ViewMode {
  if (!spec.engine) throw new Error("visualisation.engine is required to compile a view");
  if (spec.engine === "graph") return compileGraph(spec);
  if (ARCADE_ENGINE_SET.has(spec.engine)) return compileArcade(spec);
  throw new Error(`unknown visualisation.engine ${spec.engine}`);
}

export function specCaption(spec: PluginView): string {
  const dispatch = engineDispatch(spec);
  return viewCaption({
    id: spec.id,
    label: tileDisplayName(spec),
    graphBase: dispatch.graphBase,
    arcadeId: dispatch.arcadeId,
  });
}

const CATALOG_GROUP_RANK: Record<string, number> = { graph: 0, demo: 1, arcade: 2 };

/** Catalog <select> used on mosaic tiles and This view pane pickers. */
export function fillViewSelect(
  sel: HTMLSelectElement,
  current: string,
  suffix?: (value: string) => string,
): void {
  sel.replaceChildren();
  const modes: { value: string; label: string; group: string; disabled?: boolean }[] = viewPickerOptions();
  let groupEl: HTMLOptGroupElement | null = null;
  let lastGroup = "";
  for (const m of modes) {
    if (m.group !== lastGroup) {
      lastGroup = m.group;
      groupEl = document.createElement("optgroup");
      groupEl.label = m.group;
      sel.appendChild(groupEl);
    }
    const o = document.createElement("option");
    o.value = m.value;
    // The suffix is for choices in the open list only, never the view this select is running.
    o.textContent = m.label + (m.value === current || m.disabled ? "" : (suffix?.(m.value) ?? ""));
    if (m.disabled) o.disabled = true;
    if (m.value === current) o.selected = true;
    (groupEl ?? sel).appendChild(o);
  }
  if (current && !modes.some((m) => m.value === current)) {
    // A view opened by id (hidden test pack, saved layout): name it, it is not offered.
    const known = allModes().find((m) => m.id === current);
    const o = document.createElement("option");
    o.value = current;
    // #169: a tile on an unavailable pack shows the pack's name here, never its raw view id.
    o.textContent = known ? viewCaption(known) : (unavailablePackForView(current)?.name ?? current);
    o.selected = true;
    sel.appendChild(o);
    sel.value = current;
  }
}

/**
 * `suffixFor` marks a row with a short trailing word ("needs OK") when the view needs attention;
 * rows that just work carry their plain name.
 */
export function viewSelectOptions(
  suffixFor?: (viewId: string) => string | null,
): { value: string; label: string; hint: string; group: string }[] {
  const rows = allModes().filter((m) => !isPickerHidden(m.id)).map((m) => ({
    value: m.id,
    label: viewCaption(m),
    group: m.kind === "arcade" ? "arcade" : m.kind === "demo" ? "demo" : "graph",
  }));
  const blockedRow = manifestBlockedViewSelectRow();
  if (blockedRow) rows.push(blockedRow);
  rows.sort((a, b) => (CATALOG_GROUP_RANK[a.group] ?? 9) - (CATALOG_GROUP_RANK[b.group] ?? 9)
    || a.label.localeCompare(b.label));
  const byId = new Map(rows.map((row) => [row.value, row]));
  const pinned = new Set<string>();
  const recentRows: { value: string; label: string; group: string }[] = [];
  for (const id of recentViewIds()) {
    const row = byId.get(id);
    if (!row || pinned.has(row.value)) continue;
    pinned.add(row.value);
    recentRows.push({ ...row, group: RECENT_VIEW_GROUP });
  }
  const ordered = [...recentRows, ...rows.filter((row) => !pinned.has(row.value))];
  const numbered = ordered.map((row, i) => ({
    ...row,
    hint: i < 9 ? `${i + 1}` : i === 9 ? "0" : row.group,
  }));
  const marked = suffixFor
    ? numbered.map((row) => {
      const suffix = suffixFor(row.value);
      return suffix ? { ...row, label: `${row.label} · ${suffix}` } : row;
    })
    : numbered;
  const blocked = blockedViewSelectRow(blockedCatalogEntries());
  return blocked ? [...marked, blocked] : marked;
}

/**
 * #169: what the view picker shows: every loadable row (viewSelectOptions), then each unavailable
 * pack greyed out and unpickable. Automatic picks (wall fill, digit keys, default slots) read
 * viewSelectOptions(), which never holds an unavailable pack.
 */
export function viewPickerOptions(
  suffixFor?: (viewId: string) => string | null,
): {
  value: string; label: string; hint: string; group: string; disabled?: boolean;
}[] {
  return [...viewSelectOptions(suffixFor), ...unavailablePickerRows()];
}

/** #169: one banner per catalog when setup isn't finished, else null. */
export function viewPickerBanner(): string | null {
  return unavailableBanner();
}

export async function fetchPlugins(): Promise<PluginList> {
  const r = await apiFetch("/api/plugins", { cache: "no-store" });
  if (!r.ok) throw new Error(`plugins ${r.status}`);
  return r.json() as Promise<PluginList>;
}

export async function grantPluginConsent(id: string, kind: "reviewed" | "authored"): Promise<void> {
  const r = await apiFetch(`/api/plugins/${encodeURIComponent(id)}/consent`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  if (!r.ok) throw new Error(`consent ${r.status}`);
}

export function applyPluginCatalog(specs: PluginView[]): ViewMode[] {
  const { rows, overlays } = partitionCatalog(specs);
  const nextLooks = new Map<string, PluginLook>();
  const modes: ViewMode[] = [];
  const nextHidden = new Set<string>();
  for (const spec of rows) {
    const extra = overlays.get(spec.id);
    const merged = extra ? mergeOverlayPins(spec, extra) : spec;
    for (const view of expandPluginInstances(merged)) {
      if (view.look) nextLooks.set(pluginViewId(view.id, view.instanceId), view.look);
      if (!view.engine) continue;
      try {
        const mode = compilePlugin(view);
        modes.push(mode);
        if (merged.picker === "hidden") nextHidden.add(mode.id);
      } catch (e) {
        console.warn("zoto-viz plugin:", view.file || view.id, e);
      }
    }
  }
  looks = nextLooks;
  pickerHidden = nextHidden;
  setPluginModes(modes);
  return modes;
}

export { takePackInstallBlockedNotice } from "./pack-install-surface";

export async function installPlugins(): Promise<PluginView[]> {
  try {
    bumpPluginCatalogRevision();
    const { clearPluginSettingsUiState } = await import("./plugin-settings");
    clearPluginSettingsUiState();
    const data = await fetchPlugins();
    setManifestBlockedCatalog((data.blocked ?? []) as ManifestBlockedPlugin[]);
    // #169: unavailable packs are listed, never loaded. The service keeps them out of `plugins`;
    // a row marked `available: false` there is treated the same way.
    const plugins = data.plugins ?? [];
    setUnavailableCatalog([...(data.unavailable ?? []), ...plugins.filter(isUnavailableRow)]);
    consumePackInstallNotices(data.installNotices);
    syncBlockedCatalogFromErrors(data.errors as Record<string, unknown>[]);
    for (const e of data.errors) {
      const err = String(e.error || "");
      const msg = e.message ?? (catalogErrorLooksBlocked(err) ? err : "");
      if (
        e.error === "pack_boundary"
        || e.error === "pack_sdk_contract"
        || e.error === "pack_install_blocked"
        || e.error === "pack_install_start_failed"
        || e.error === "pack_install_interrupted"
        || e.error === PACK_INSTALL_CHECK_UNAVAILABLE
        || catalogErrorLooksBlocked(msg)
        || catalogErrorLooksBlocked(err)
      ) {
        queuePackInstallBlockedNotice({
          ok: false,
          ...e,
          error: String(e.error || "pack_boundary"),
          message: String(msg || err || e.message || ""),
        });
      }
      console.warn("zoto-viz plugin:", e.file, err || msg);
    }
    const specs: PluginView[] = [];
    for (const raw of plugins) {
      if (isUnavailableRow(raw)) continue;
      try {
        specs.push(toPluginView(raw));
      } catch (e) {
        console.warn("zoto-viz plugin:", (raw as PluginView).file || (raw as PluginView).id, e);
      }
    }
    applyPluginCatalog(specs);
    const { seedConsentFromCatalog } = await import("../app/consent-store");
    seedConsentFromCatalog(specs);
    return specs;
  } catch (e) {
    console.warn("zoto-viz plugins:", e);
    setManifestBlockedCatalog([]);
    setUnavailableCatalog([]);
    looks = new Map();
    setPluginModes([]);
    syncBlockedCatalogFromErrors([]);
    return [];
  }
}

