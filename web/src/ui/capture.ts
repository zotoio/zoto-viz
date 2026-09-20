import type { FeedConfig } from "./feed";
import type { ChatConfig } from "./chat";
import type { ProfileSettings } from "../core/profiles";
import { BACKDROP_OPTIONS, type BackdropKind } from "../graph/backdrop";
import { EMPTY_LOOK, mergeAgentLook, normalizeAgentLook, type AgentLook } from "../graph/deco";
import { DREAM_BOUNDS, type DreamAnim } from "../graph/scene";
import { parseMosaicNode, parseMosaicTiles } from "../graph/mosaic-layout";
import { FLOOR_SHAPES } from "../graph/floor";
import { DICE_INCLUDE_KEYS, mergeDice, DEFAULT_DICE, type DicePatch } from "../core/shuffle";

const JPEG_MAX = 900_000;
const JPEG_MIN = 32;

export interface ViewShow {
  lan: boolean;
  internet: boolean;
  multicast: boolean;
  offline: boolean;
  labels: boolean;
  cpuIdle?: boolean;
}

/** Packed HUD sent with each chat turn. Short keys, omit defaults. */
export interface PackedHud {
  m: string;
  th?: string;
  ch?: string;
  cam?: string;
  mic?: string;
  sel?: string;
  p?: string;
  d?: 1;
  mg?: 0;
  rd?: 1;
  st?: string;
  hide?: string;
  fd?: string;
  q?: string[];
}

export interface CaptureCtx {
  mode: string;
  theme: string;
  chrome: string;
  dream: boolean;
  selected: string | null;
  merge: boolean;
  redact: boolean;
  camera: "auto" | "off";
  mic?: "auto" | "off";
  show: ViewShow;
  feed: FeedConfig;
  feedLines: string[];
}

export type ViewCapture = {
  hud: PackedHud;
  /** Raw JPEG base64 (no data-URL prefix). Omitted when the canvas is blank. */
  screenshot?: string;
};

/** HUD plus an optional live-canvas JPEG for the current chat turn. */
export function packView(hud: PackedHud, canvas: HTMLCanvasElement | null): ViewCapture {
  const screenshot = canvas ? canvasJpeg(canvas) ?? undefined : undefined;
  return screenshot ? { hud, screenshot } : { hud };
}

export interface AgentPatch {
  theme?: string;
  dream?: boolean;
  camera?: "auto" | "off";
  mic?: "auto" | "off";
  chrome?: "top" | "left" | "right";
  mode?: string;
  redact?: boolean;
  merge?: boolean;
  feed?: Partial<FeedConfig>;
  chat?: Partial<ChatConfig>;
  show?: Partial<ViewShow>;
  filters?: Partial<ProfileSettings["filters"]>;
  anim?: Partial<DreamAnim>;
  modeOptions?: Record<string, Record<string, string>>;
  arcade?: Record<string, string>;
  plugins?: Record<string, Record<string, string>>;
  agent?: Partial<AgentLook> & { clear?: boolean };
  temper?: number;
  weather?: string;
  shuffle?: boolean;
  dice?: DicePatch;
}

export const VIEW_KEY = "zoto-viz.aiView";

const HIDE_SHORT: Record<keyof ViewShow, string> = {
  lan: "lan",
  internet: "inet",
  multicast: "mc",
  offline: "off",
  labels: "lbl",
  cpuIdle: "cpu",
};

/** On unless the operator has turned it off. */
export function includeView(): boolean {
  return localStorage.getItem(VIEW_KEY) !== "0";
}

export function elText(id: string, max = 80): string {
  return (document.getElementById(id)?.textContent || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function pair(a: string, b: string, prefix: string): string {
  if (!a && !b) return "";
  return `${prefix}${a || "0"}/${b || "0"}`;
}

/** Compact on-screen state for the local model. No image. */
export function captureHud(ctx: CaptureCtx): PackedHud {
  const hud: PackedHud = { m: ctx.mode };
  if (ctx.theme) hud.th = ctx.theme;
  if (ctx.chrome) hud.ch = ctx.chrome;
  if (ctx.camera) hud.cam = ctx.camera;
  if (ctx.mic) hud.mic = ctx.mic;
  if (ctx.selected) hud.sel = ctx.selected.slice(0, 40);
  const panel = elText("panel", 48);
  if (panel) hud.p = panel;
  if (ctx.dream) hud.d = 1;
  if (!ctx.merge) hud.mg = 0;
  if (ctx.redact) hud.rd = 1;
  const st = [
    elText("pps", 8) ? `${elText("pps", 8)}pps` : "",
    elText("bps", 12),
    pair(elText("lanDevs", 4), elText("lanOnline", 4), "lan"),
    pair(elText("netSvcs", 4), elText("netOnline", 4), "svc"),
    pair(elText("flows", 6), elText("active", 4), "fl"),
    elText("net", 32),
  ].filter(Boolean).join(" ");
  if (st) hud.st = st.slice(0, 80);
  const hide = (Object.keys(HIDE_SHORT) as (keyof ViewShow)[])
    .filter((k) => ctx.show[k] === false)
    .map((k) => HIDE_SHORT[k]);
  if (hide.length) hud.hide = hide.join(",");
  if (!ctx.feed.on) hud.fd = "off";
  else hud.fd = `${ctx.feed.layout}/${ctx.feed.source}/${ctx.feed.scope}`.slice(0, 40);
  if (ctx.feed.on) {
    const q = ctx.feedLines.slice(0, 3).map((l) => l.replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean);
    if (q.length) hud.q = q;
  }
  return hud;
}

/** @deprecated use captureHud */
export const captureDom = captureHud;

/**
 * JPEG of a WebGL (or 2d) canvas as raw base64, downscaled so the chat body stays under 2 MB.
 * Call after a render so WebGL without preserveDrawingBuffer is not blank.
 */
export function canvasJpeg(canvas: HTMLCanvasElement, maxEdge = 960, quality = 0.45): string | null {
  try {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return null;
    let target: HTMLCanvasElement = canvas;
    const edge = Math.max(w, h);
    if (edge > maxEdge) {
      const scale = maxEdge / edge;
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(w * scale));
      off.height = Math.max(1, Math.round(h * scale));
      const g = off.getContext("2d");
      if (!g) return null;
      g.drawImage(canvas, 0, 0, off.width, off.height);
      target = off;
    }
    const url = target.toDataURL("image/jpeg", quality);
    const b64 = url.includes(",") ? url.slice(url.indexOf(",") + 1) : url;
    if (!b64 || b64.length < JPEG_MIN || b64.length >= JPEG_MAX) return null;
    return b64;
  } catch {
    return null;
  }
}

const SHOW_KEYS = ["lan", "internet", "multicast", "offline", "labels", "cpuIdle"] as const;
const ANIM_BOOL: (keyof DreamAnim)[] = [
  "follow", "cycle", "randomize", "skyAudio", "bgAudio", "gridAudio", "audioCamera", "camTheme", "audioNodes",
  "audioPhysics", "audioParts", "autoTune", "mosaicSharedTheme", "mosaicUniqueSkies",
];
const BACKDROPS = new Set(BACKDROP_OPTIONS.map((o) => o.value));
const SHAPES = new Set(FLOOR_SHAPES.map((o) => o.value));
const AUDIO_DRIVES = new Set(["mic", "traffic", "node"]);
const THEME_CYCLES = new Set(["off", "cadence", "audio"]);
const EDGE_GLOWS = new Set(["off", "comet", "pulse"]);
const MOSAICS = new Set(["off", "4", "6", "8"]);
const HEROS = new Set(["off", "left", "center", "right"]);
const FOCUSES = new Set(["activity", "motion", "cloud"]);

function strRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

function nestRecord(v: unknown): Record<string, Record<string, string>> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, Record<string, string>> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const inner = strRecord(val);
    if (inner) out[k] = inner;
  }
  return Object.keys(out).length ? out : undefined;
}

function pickAnim(raw: unknown): Partial<DreamAnim> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  const out: Partial<DreamAnim> = {};
  for (const k of ANIM_BOOL) if (typeof s[k] === "boolean") (out as Record<string, unknown>)[k] = s[k];
  if (typeof s.backdrop === "string" && BACKDROPS.has(s.backdrop as BackdropKind)) out.backdrop = s.backdrop as BackdropKind;
  if (typeof s.gridShape === "string" && SHAPES.has(s.gridShape as never)) out.gridShape = s.gridShape as DreamAnim["gridShape"];
  if (typeof s.audioDrive === "string" && AUDIO_DRIVES.has(s.audioDrive)) out.audioDrive = s.audioDrive as DreamAnim["audioDrive"];
  if (typeof s.themeCycle === "string" && THEME_CYCLES.has(s.themeCycle)) out.themeCycle = s.themeCycle as DreamAnim["themeCycle"];
  if (typeof s.skyCycle === "string" && THEME_CYCLES.has(s.skyCycle)) out.skyCycle = s.skyCycle as DreamAnim["skyCycle"];
  if (typeof s.edgeGlow === "string" && EDGE_GLOWS.has(s.edgeGlow)) out.edgeGlow = s.edgeGlow as DreamAnim["edgeGlow"];
  if (typeof s.mosaic === "string" && MOSAICS.has(s.mosaic)) out.mosaic = s.mosaic as DreamAnim["mosaic"];
  if (typeof s.hero === "string" && HEROS.has(s.hero)) out.hero = s.hero as DreamAnim["hero"];
  const tree = parseMosaicNode(s.mosaicTree);
  if (tree) out.mosaicTree = tree;
  const tiles = parseMosaicTiles(s.mosaicTiles);
  if (tiles.length) out.mosaicTiles = tiles;
  if (typeof s.mosaicMaxId === "string") out.mosaicMaxId = s.mosaicMaxId.trim().slice(0, 80);
  if (s.mosaicSkies && typeof s.mosaicSkies === "object" && !Array.isArray(s.mosaicSkies)) {
    const skies: NonNullable<DreamAnim["mosaicSkies"]> = {};
    for (const [id, sky] of Object.entries(s.mosaicSkies as Record<string, unknown>)) {
      if (typeof sky === "string" && BACKDROPS.has(sky as BackdropKind)) skies[id] = sky as BackdropKind;
    }
    if (Object.keys(skies).length) out.mosaicSkies = skies;
  }
  if (typeof s.focus === "string" && FOCUSES.has(s.focus)) out.focus = s.focus as DreamAnim["focus"];
  if (typeof s.bgColor === "string") out.bgColor = s.bgColor;
  if (typeof s.gridColor === "string") out.gridColor = s.gridColor;
  const bound: Record<string, { min: number; max: number }> = {
    yawPeriod: DREAM_BOUNDS.yawPeriod,
    pitchDeg: DREAM_BOUNDS.pitchDeg,
    pitchPeriod: DREAM_BOUNDS.pitchPeriod,
    zoom: DREAM_BOUNDS.zoom,
    zoomPeriod: DREAM_BOUNDS.zoomPeriod,
    cyclePeriod: DREAM_BOUNDS.cyclePeriod,
    skyOpacity: DREAM_BOUNDS.opacity,
    skyBright: DREAM_BOUNDS.bright,
    skySpeed: DREAM_BOUNDS.skySpeed,
    skyEase: DREAM_BOUNDS.skyEase,
    skyAiMin: DREAM_BOUNDS.skyAiMin,
    bgOpacity: DREAM_BOUNDS.opacity,
    gridOpacity: DREAM_BOUNDS.opacity,
    gridBright: DREAM_BOUNDS.bright,
    gridSize: DREAM_BOUNDS.gridSize,
    gridFollow: DREAM_BOUNDS.gridFollow,
    audioSens: DREAM_BOUNDS.audioSens,
    camAudio: DREAM_BOUNDS.camDrive,
    camChange: DREAM_BOUNDS.camDrive,
    camGaze: DREAM_BOUNDS.camDrive,
    camInertia: DREAM_BOUNDS.camInertia,
    moveEase: DREAM_BOUNDS.moveEase,
    labelWeight: DREAM_BOUNDS.labelWeight,
    labelCount: DREAM_BOUNDS.labelCount,
    nodeWeight: DREAM_BOUNDS.nodeWeight,
    edgeWeight: DREAM_BOUNDS.edgeWeight,
    edgeGlowAmt: DREAM_BOUNDS.edgeGlowAmt,
    edgeGlowSpeed: DREAM_BOUNDS.edgeGlowSpeed,
    partAmt: DREAM_BOUNDS.partAmt,
    partBusy: DREAM_BOUNDS.partBusy,
    partQuiet: DREAM_BOUNDS.partQuiet,
    partPeak: DREAM_BOUNDS.partPeak,
    partCap: DREAM_BOUNDS.partCap,
    partSpeed: DREAM_BOUNDS.partSpeed,
    partSize: DREAM_BOUNDS.partSize,
    magnetSelf: DREAM_BOUNDS.magnet,
    magnetGateway: DREAM_BOUNDS.magnet,
    magnetLan: DREAM_BOUNDS.magnet,
    magnetLocal: DREAM_BOUNDS.magnet,
    magnetInternet: DREAM_BOUNDS.magnet,
    magnetMulticast: DREAM_BOUNDS.magnet,
    magnetCross: DREAM_BOUNDS.magnet,
    magnetRange: DREAM_BOUNDS.magnetRange,
    gravity: DREAM_BOUNDS.gravity,
    swirl: DREAM_BOUNDS.swirl,
    chargeAmt: DREAM_BOUNDS.chargeAmt,
    spring: DREAM_BOUNDS.spring,
    linkSpan: DREAM_BOUNDS.linkSpan,
    drag: DREAM_BOUNDS.drag,
    centerPull: DREAM_BOUNDS.centerPull,
    stringAmt: DREAM_BOUNDS.stringAmt,
  };
  for (const [k, b] of Object.entries(bound)) {
    const n = Number(s[k]);
    if (!Number.isFinite(n)) continue;
    (out as Record<string, number>)[k] = Math.min(b.max, Math.max(b.min, n));
  }
  return Object.keys(out).length ? out : undefined;
}

const MOSAIC_LAYOUT_KEYS = ["mosaic", "hero", "mosaicTree", "mosaicMaxId"] as const;

/** Drop split / size / hero / maximize. Tile view ids (`mosaicTiles`) stay. */
export function stripMosaicLayout(anim: Partial<DreamAnim>): Partial<DreamAnim> {
  const next = { ...anim };
  for (const k of MOSAIC_LAYOUT_KEYS) delete next[k];
  return next;
}

/** Whitelist a settings fence so the agent cannot write arbitrary keys. */
export function pickAgentSettings(patch: Record<string, unknown>, modeIds: string[]): AgentPatch {
  const out: AgentPatch = {};
  if (typeof patch.theme === "string" && patch.theme.trim()) out.theme = patch.theme.trim();
  if (typeof patch.dream === "boolean") out.dream = patch.dream;
  if (patch.chrome === "top" || patch.chrome === "left" || patch.chrome === "right") out.chrome = patch.chrome;
  if (typeof patch.mode === "string" && modeIds.includes(patch.mode)) out.mode = patch.mode;
  if (typeof patch.redact === "boolean") out.redact = patch.redact;
  if (typeof patch.merge === "boolean") out.merge = patch.merge;
  if (patch.feed && typeof patch.feed === "object" && !Array.isArray(patch.feed)) {
    const f = patch.feed as Record<string, unknown>;
    const feed: NonNullable<AgentPatch["feed"]> = {};
    if (typeof f.on === "boolean") feed.on = f.on;
    if (f.source === "transcript" || f.source === "both") {
      out.chat = { ...out.chat, on: true };
      feed.source = "traffic";
    } else if (f.source === "traffic") {
      feed.source = "traffic";
    }
    if (f.layout === "ticker" || f.layout === "bars" || f.layout === "both") feed.layout = f.layout;
    if (f.scope === "lan" || f.scope === "selected" || f.scope === "any") feed.scope = f.scope;
    if (typeof f.modulate === "boolean") feed.modulate = f.modulate;
    const dens = Number(f.density);
    if (Number.isFinite(dens)) feed.density = Math.min(80, Math.max(12, dens));
    const size = Number(f.textSize);
    if (Number.isFinite(size)) feed.textSize = Math.min(20, Math.max(10, size));
    if (Object.keys(feed).length) out.feed = feed;
  }
  if (patch.chat && typeof patch.chat === "object" && !Array.isArray(patch.chat)) {
    const c = patch.chat as Record<string, unknown>;
    const chat: NonNullable<AgentPatch["chat"]> = {};
    if (typeof c.on === "boolean") chat.on = c.on;
    const size = Number(c.textSize);
    if (Number.isFinite(size)) chat.textSize = Math.min(20, Math.max(10, size));
    if (Object.keys(chat).length) out.chat = { ...out.chat, ...chat };
  }
  if (patch.show && typeof patch.show === "object" && !Array.isArray(patch.show)) {
    const s = patch.show as Record<string, unknown>;
    const show: AgentPatch["show"] = {};
    for (const k of SHOW_KEYS) {
      if (typeof s[k] === "boolean") show[k] = s[k];
    }
    if (Object.keys(show).length) out.show = show;
  }
  if (patch.filters && typeof patch.filters === "object" && !Array.isArray(patch.filters)) {
    const f = patch.filters as Record<string, unknown>;
    const filters: NonNullable<AgentPatch["filters"]> = {};
    for (const k of ["allowNames", "blockNames", "allowNets", "blockNets"] as const) {
      if (typeof f[k] === "string") filters[k] = f[k];
    }
    if (Object.keys(filters).length) out.filters = filters;
  }
  const anim = pickAnim(patch.anim);
  if (anim) out.anim = anim;
  const modeOptions = nestRecord(patch.modeOptions);
  if (modeOptions) out.modeOptions = modeOptions;
  const arcade = strRecord(patch.arcade);
  if (arcade) out.arcade = arcade;
  const plugins = nestRecord(patch.plugins);
  if (plugins) out.plugins = plugins;
  if (patch.agent && typeof patch.agent === "object" && !Array.isArray(patch.agent)) {
    const a = patch.agent as Record<string, unknown>;
    const agent: NonNullable<AgentPatch["agent"]> = {};
    if (typeof a.clear === "boolean") agent.clear = a.clear;
    const look = normalizeAgentLook(a);
    if (look.shader) agent.shader = look.shader;
    if (look.shaderPhoto) agent.shaderPhoto = look.shaderPhoto;
    if (look.decos.length) agent.decos = look.decos;
    if (Object.keys(agent).length) out.agent = agent;
  }
  const temper = Number(patch.temper);
  if (Number.isFinite(temper)) out.temper = Math.min(100, Math.max(0, Math.round(temper)));
  if (typeof patch.weather === "string") out.weather = patch.weather;
  if (patch.shuffle === true) out.shuffle = true;
  const dice = pickDice(patch.dice);
  if (dice) out.dice = dice;
  return out;
}

function pickDice(raw: unknown): DicePatch | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  const out: DicePatch = {};
  if (s.include && typeof s.include === "object" && !Array.isArray(s.include)) {
    const inc = s.include as Record<string, unknown>;
    const include: NonNullable<DicePatch["include"]> = {};
    for (const k of DICE_INCLUDE_KEYS) {
      if (typeof inc[k] === "boolean") include[k] = inc[k];
    }
    if (Object.keys(include).length) out.include = include;
  }
  if (typeof s.on === "boolean") out.on = s.on;
  if (typeof s.handoff === "boolean") out.handoff = s.handoff;
  if (typeof s.cycle === "boolean") out.cycle = s.cycle;
  if (s.mosaicMax === "4" || s.mosaicMax === "6" || s.mosaicMax === "8") out.mosaicMax = s.mosaicMax;
  const nums = ["periodMin", "labelsMax", "sparksMax", "sparkPeak", "feedDensityMax", "nodeTop"] as const;
  for (const k of nums) {
    const n = Number(s[k]);
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

export function mergeAgentPatch(base: ProfileSettings, patch: AgentPatch): ProfileSettings {
  return {
    ...base,
    theme: patch.theme ?? base.theme,
    dream: patch.dream ?? base.dream,
    camera: base.camera,
    mic: base.mic,
    chrome: patch.chrome ?? base.chrome,
    mode: patch.mode ?? base.mode,
    redact: patch.redact ?? base.redact,
    merge: patch.merge ?? base.merge,
    feed: { ...base.feed, ...patch.feed, source: "traffic" },
    chat: { ...base.chat, ...patch.chat },
    show: { ...base.show, ...patch.show },
    filters: { ...base.filters, ...patch.filters },
    anim: { ...base.anim, ...patch.anim },
    modeOptions: patch.modeOptions ? { ...base.modeOptions, ...patch.modeOptions } : base.modeOptions,
    arcade: patch.arcade ? { ...base.arcade, ...patch.arcade } : base.arcade,
    plugins: patch.plugins ? { ...base.plugins, ...patch.plugins } : base.plugins,
    agent: patch.agent ? mergeAgentLook(base.agent ?? EMPTY_LOOK, patch.agent) : (base.agent ?? EMPTY_LOOK),
    dice: patch.dice ? mergeDice(base.dice ?? DEFAULT_DICE, patch.dice) : (base.dice ?? DEFAULT_DICE),
  };
}
