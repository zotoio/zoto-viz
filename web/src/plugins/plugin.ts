import {
  allModes,
  categorize,
  GRAPH_BASES,
  heat,
  hashColor,
  modeById,
  MODES,
  paneLabelCap,
  setPluginModes,
  viewCaption,
  type ModeOption,
  type PluginField,
  type ShellSet,
  type ViewMode,
} from "../core/modes";
import type { GNode, DreamAnim, EdgeGlow, AudioDrive, ThemeCycle } from "../graph/scene";
import type { BackdropKind } from "../graph/backdrop";
import type { FloorShape } from "../graph/floor";
import { KIND_COLOR, ROLE_COLOR, deviceKind, displayName } from "../core/types";
import { apiFetch } from "../core/http";

function dimHex(hex: number, amount: number): number {
  const r = Math.round(((hex >> 16) & 255) * amount);
  const g = Math.round(((hex >> 8) & 255) * amount);
  const b = Math.round((hex & 255) * amount);
  return (r << 16) | (g << 8) | b;
}

export type PluginEngine = "graph" | "netpong" | "invaders" | "command" | "frogger" | "cpupong";
export type NodeColorStyle = "role" | "kind" | "heat" | "proto" | "hash";
export type NodeScaleStyle = "default" | "bytes" | "rate";
export type LabelStyle = "default" | "all" | "none" | "top";

export interface PluginStyle {
  nodeColor?: NodeColorStyle;
  nodeScale?: NodeScaleStyle;
  labels?: LabelStyle;
  flatten?: boolean;
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
  skyOpacity?: number;
  skyBright?: number;
  skySpeed?: number;
  skyEase?: number;
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
  audioDrive?: AudioDrive;
  audioSens?: number;
  audioCamera?: boolean;
  audioNodes?: boolean;
  themeCycle?: ThemeCycle;
  edgeGlow?: EdgeGlow;
  edgeGlowAmt?: number;
  edgeGlowSpeed?: number;
}

export type PluginCapability = "graph.read" | "graph.style" | "ui.overlay" | "config.read";

export interface PluginView {
  id: string;
  name: string;
  version: number;
  hint?: string;
  engine: PluginEngine;
  base?: string;
  options?: ModeOption[];
  config?: PluginField[];
  style?: PluginStyle;
  layout?: PluginLayout;
  look?: PluginLook;
  file?: string;
  runtime?: "yaml" | "typescript";
  entry?: string;
  capabilities?: PluginCapability[];
  hash?: string;
  service?: string;
  consent?: "reviewed" | "authored" | null;
}

const LOOK_ANIM_KEYS = [
  "backdrop", "skyOpacity", "skyBright", "skySpeed", "skyEase", "skyAudio", "skyCycle",
  "bgColor", "bgOpacity", "bgAudio",
  "gridShape", "gridColor", "gridSize", "gridOpacity", "gridBright", "gridAudio",
  "audioDrive", "audioSens", "audioCamera", "audioNodes",
  "themeCycle", "edgeGlow", "edgeGlowAmt", "edgeGlowSpeed",
] as const satisfies readonly (keyof PluginLook)[];

let looks = new Map<string, PluginLook>();

export const shippedModeIds = (): Set<string> => new Set(MODES.map((m) => m.id));

export function lookForMode(modeId: string): PluginLook | undefined {
  return looks.get(modeId);
}

export function mergeLook(base: DreamAnim, look?: PluginLook | null): DreamAnim {
  if (!look) return base;
  const out = { ...base };
  for (const key of LOOK_ANIM_KEYS) {
    const v = look[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

export interface PluginList {
  dir: string;
  schema: string;
  plugins: PluginView[];
  errors: { file: string; error: string }[];
  pythonService?: boolean;
}

export const pluginViewId = (id: string) => `plugin:${id}`;
export const parsePluginId = (modeId: string): string | null =>
  modeId.startsWith("plugin:") ? modeId.slice("plugin:".length) : null;

/** Executable plugins (TypeScript and/or a monitor-side Python module) need a source-review consent. */
export function pluginNeedsReview(spec: PluginView): boolean {
  return spec.runtime === "typescript" || !!spec.service;
}

const storeKey = (id: string, key: string) => `zoto-viz.plugin.${id}.${key}`;

export function fieldDefault(f: PluginField): string {
  if (f.type === "boolean") return f.default === true || f.default === "true" || f.default === "1" ? "1" : "0";
  if (f.default !== undefined) return String(f.default);
  if (f.type === "number") return String(f.min ?? 0);
  if (f.type === "select") return f.values?.[0]?.[0] ?? "";
  return "";
}

export function loadPluginConfig(spec: PluginView, fields = spec.config): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields ?? []) {
    const saved = localStorage.getItem(storeKey(spec.id, f.key));
    out[f.key] = saved !== null ? saved : fieldDefault(f);
  }
  return out;
}

export function writePluginConfig(id: string, values: Record<string, string>): void {
  for (const [k, v] of Object.entries(values)) localStorage.setItem(storeKey(id, k), v);
}

export function collectPluginConfigs(specs: PluginView[]): Record<string, Record<string, string>> {
  return Object.fromEntries(specs.map((s) => [s.id, loadPluginConfig(s)]));
}

export function applyPluginConfigs(raw: Record<string, Record<string, string>> | undefined): void {
  if (!raw) return;
  for (const [id, values] of Object.entries(raw)) writePluginConfig(id, values);
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
  const base = GRAPH_BASES.find((m) => m.id === spec.base) ?? modeById(spec.base ?? "topology");
  const style = spec.style ?? {};
  const layout = spec.layout ?? {};
  let maxBytes = 1, maxLogRate = 1;
  const top = new Set<GNode>();

  const mode: ViewMode = {
    ...base,
    id: pluginViewId(spec.id),
    label: spec.name,
    hint: spec.hint || base.hint,
    pluginId: spec.id,
    graphBase: spec.base === "cores" || spec.base === "load" || spec.base === "cpu" ? "cpu" : spec.base,
    standalone: false,
    arcadeId: undefined,
    options: mergeOptions(base.options, spec.options),
    config: mergeFields(base.config, spec.config),
    flatten: style.flatten ?? base.flatten,
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
  const base = modeById(spec.engine);
  return {
    ...base,
    id: pluginViewId(spec.id),
    label: spec.name,
    hint: spec.hint || base.hint,
    pluginId: spec.id,
    standalone: true,
    arcadeId: spec.engine,
    options: mergeOptions(base.options, spec.options),
    config: spec.config ?? [],
  };
}

export function compilePlugin(spec: PluginView): ViewMode {
  return spec.engine === "graph" ? compileGraph(spec) : compileArcade(spec);
}

export function specCaption(spec: PluginView): string {
  return viewCaption({
    id: spec.id,
    label: spec.name,
    graphBase: spec.engine === "graph"
      ? (spec.base === "cores" || spec.base === "load" || spec.base === "cpu" ? "cpu" : spec.base)
      : undefined,
    arcadeId: spec.engine !== "graph" ? spec.engine : undefined,
  });
}

export function viewSelectOptions(): { value: string; label: string; hint: string }[] {
  const shipped = MODES.map((m, i) => ({ value: m.id, label: viewCaption(m), hint: `${i + 1}` }));
  const extra = allModes()
    .filter((m) => m.pluginId)
    .map((m) => ({
      value: m.id,
      label: viewCaption(m),
      hint: (m.config?.length ? "plugin · fields" : "plugin"),
    }));
  return [...shipped, ...extra];
}

export async function fetchPlugins(): Promise<PluginList> {
  const r = await apiFetch("/api/plugins");
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

export async function installPlugins(): Promise<PluginView[]> {
  try {
    const data = await fetchPlugins();
    for (const e of data.errors) console.warn("zoto-viz plugin:", e.file, e.error);
    const shipped = shippedModeIds();
    const nextLooks = new Map<string, PluginLook>();
    const modes: ViewMode[] = [];
    for (const spec of data.plugins) {
      if (shipped.has(spec.id)) {
        if (spec.look) nextLooks.set(spec.id, spec.look);
        continue;
      }
      try {
        modes.push(compilePlugin(spec));
        if (spec.look) nextLooks.set(pluginViewId(spec.id), spec.look);
      } catch (e) {
        console.warn("zoto-viz plugin:", spec.file || spec.id, e);
      }
    }
    looks = nextLooks;
    setPluginModes(modes);
    return data.plugins;
  } catch (e) {
    console.warn("zoto-viz plugins:", e);
    looks = new Map();
    setPluginModes([]);
    return [];
  }
}

