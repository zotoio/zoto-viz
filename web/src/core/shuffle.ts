import type { PluginField, ModeOption } from "./modes";
import type { ProfileSettings } from "./profiles";
import { DEFAULT_DREAM, DREAM_BOUNDS, AUDIO_DRIVES, EDGE_GLOWS, FABRIC_DICE, FOCUS_MODES, GRAPH_SPACE_OPTIONS, HERO_POS, MOSAIC_SIZES, SKY_CYCLES, THEME_CYCLES, type AudioDrive, type DreamAnim, type MosaicSize } from "../graph/scene";
import { FLOOR_SHAPES } from "../graph/floor";
import { CYCLE_SKIES, type BackdropKind } from "../graph/backdrop";
import { assignMosaicSkies, mosaicIds, shouldUniqueMosaicSkies } from "../graph/mosaic";
import { lookForMode } from "../plugins/plugin";
import { VIEW_PROMPT_KEY } from "../plugins/plugin-visualisation";
import { DEFAULT_FEED, FEED_LAYOUTS, FEED_SCOPES, type FeedConfig } from "../ui/feed";

export type Bound = { min: number; max: number; step: number };
export type Rng = () => number;

/** Chat line after a dice roll so the local agent takes over from the new look. */
export const DICE_HANDOFF =
  "Operator rolled the dice. Visual settings in the dice pool are a fresh random seed (theme, view, mosaic, feed, motion, physics, knobs) with a soft ceiling on labels, sparks, mosaic tiles, and node-count knobs so the frame stays usable. Privacy filters, camera, microphone, chrome placement, and prompts stay. Groups left off were not rolled. Dream cycling and AI Control follow the dice settings. Take over from this look — keep, rewrite, or surprise. Leave those ceilings unless the operator asks for more.";

export const DICE_INCLUDE_KEYS = [
  "theme", "view", "mosaic", "feed",
  "motion", "style", "physics", "knobs", "show",
] as const;

export type DiceIncludeKey = (typeof DICE_INCLUDE_KEYS)[number];
export type DiceInclude = Record<DiceIncludeKey, boolean>;
export type DiceMosaicMax = "4" | "6" | "8";

export const DICE_INCLUDE_META: { key: DiceIncludeKey; label: string; hint: string }[] = [
  { key: "theme", label: "theme", hint: "colour theme" },
  { key: "view", label: "view", hint: "catalog view (Topology, Talkers, …)" },
  { key: "mosaic", label: "mosaic", hint: "tile count and hero pane" },
  { key: "feed", label: "feed", hint: "packet overlay on/off, layout, density" },
  { key: "motion", label: "motion", hint: "orbit, sky, floor, labels, audio, theme / sky cycles" },
  { key: "style", label: "graph style", hint: "2D / 3D fabric mesh and plane vs space layout — any graph plugin" },
  { key: "physics", label: "physics", hint: "magnets, gravity, strings, traffic sparks" },
  { key: "knobs", label: "knobs", hint: "per-view options and plugin fields (not prompts)" },
  { key: "show", label: "visibility", hint: "LAN / internet / multicast / offline / labels / CPU idle / merge names" },
];

export interface DiceConfig {
  include: DiceInclude;
  /** Header / Settings repeat switch. When on, rolls on `periodMin`. */
  on: boolean;
  /** Minutes between automatic rolls while `on`. */
  periodMin: number;
  /** Reserved. A roll never starts a chat / think turn. */
  handoff: boolean;
  /** Turn on dream + view cycling + AI Control after a roll. */
  cycle: boolean;
  labelsMax: number;
  sparksMax: number;
  sparkPeak: number;
  mosaicMax: DiceMosaicMax;
  feedDensityMax: number;
  nodeTop: number;
}

export const DICE_PERIOD: Bound = { min: 1, max: 60, step: 1 };

export type DicePatch = Partial<Omit<DiceConfig, "include">> & { include?: Partial<DiceInclude> };

export const DEFAULT_DICE: DiceConfig = {
  include: {
    theme: true, view: true, mosaic: true, feed: true,
    motion: true, style: true, physics: true, knobs: true, show: true,
  },
  on: false,
  periodMin: 5,
  handoff: false,
  cycle: true,
  labelsMax: 48,
  sparksMax: 800,
  sparkPeak: 48,
  mosaicMax: "6",
  feedDensityMax: 48,
  nodeTop: 40,
};

/**
 * Dice-only clamps below the slider max. Operators and agent patches can still
 * crank Settings to the full DREAM_BOUNDS / plugin field range. Labels / sparks
 * overlay from DiceConfig.
 */
export const DICE_SOFT: Partial<Record<keyof DreamAnim, Partial<Bound>>> = {
  labelCount: { max: DEFAULT_DICE.labelsMax },
  nodeWeight: { max: 1.8 },
  edgeWeight: { max: 1.8 },
  edgeGlowAmt: { max: 1.4 },
  skySpeed: { max: 2.4 },
  gridSize: { min: 32 },
  partAmt: { max: 1.25 },
  partBusy: { max: 1.5 },
  partPeak: { max: DEFAULT_DICE.sparkPeak },
  partCap: { max: DEFAULT_DICE.sparksMax },
  partSize: { max: 1.5 },
};

const MOSAIC_RANK: Record<string, number> = { off: 0, "4": 1, "6": 2, "8": 3 };

export function diceMosaic(cfg: DiceConfig = DEFAULT_DICE): MosaicSize[] {
  const cap = MOSAIC_RANK[cfg.mosaicMax] ?? MOSAIC_RANK["6"]!;
  return MOSAIC_SIZES.map((o) => o.value).filter((v) => (MOSAIC_RANK[v] ?? 0) <= cap);
}

/** Eight WebGL graphs (2×4) stay a manual choice unless mosaic max is 2×4. */
export const DICE_MOSAIC = diceMosaic(DEFAULT_DICE);

export const DICE_FEED_DENSITY: Bound = { min: 12, max: DEFAULT_DICE.feedDensityMax, step: 1 };

/** Plugin / view `top` knobs (talkers labels, bluetooth nodes). Slider max can be 64–80. */
export const DICE_NODE_TOP = DEFAULT_DICE.nodeTop;

function snapStep(n: number, lo: number, hi: number, step: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(hi, Math.max(lo, n));
  const snapped = Math.round(clamped / step) * step;
  return Math.min(hi, Math.max(lo, Number(snapped.toFixed(4))));
}

export function normalizeDice(raw: unknown): DiceConfig {
  const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const incRaw = s.include && typeof s.include === "object" ? s.include as Record<string, unknown> : {};
  const include = { ...DEFAULT_DICE.include };
  for (const k of DICE_INCLUDE_KEYS) {
    if (typeof incRaw[k] === "boolean") include[k] = incRaw[k];
  }
  const mosaicMax = s.mosaicMax === "4" || s.mosaicMax === "6" || s.mosaicMax === "8" ? s.mosaicMax : DEFAULT_DICE.mosaicMax;
  return {
    include,
    on: typeof s.on === "boolean" ? s.on : DEFAULT_DICE.on,
    periodMin: snapStep(Number(s.periodMin), DICE_PERIOD.min, DICE_PERIOD.max, DICE_PERIOD.step, DEFAULT_DICE.periodMin),
    handoff: false,
    cycle: typeof s.cycle === "boolean" ? s.cycle : DEFAULT_DICE.cycle,
    labelsMax: snapStep(Number(s.labelsMax), DREAM_BOUNDS.labelCount.min, DREAM_BOUNDS.labelCount.max, DREAM_BOUNDS.labelCount.step, DEFAULT_DICE.labelsMax),
    sparksMax: snapStep(Number(s.sparksMax), DREAM_BOUNDS.partCap.min, DREAM_BOUNDS.partCap.max, DREAM_BOUNDS.partCap.step, DEFAULT_DICE.sparksMax),
    sparkPeak: snapStep(Number(s.sparkPeak), DREAM_BOUNDS.partPeak.min, DREAM_BOUNDS.partPeak.max, DREAM_BOUNDS.partPeak.step, DEFAULT_DICE.sparkPeak),
    mosaicMax,
    feedDensityMax: snapStep(Number(s.feedDensityMax), 12, 80, 1, DEFAULT_DICE.feedDensityMax),
    nodeTop: snapStep(Number(s.nodeTop), 8, 80, 1, DEFAULT_DICE.nodeTop),
  };
}

export function mergeDice(base: DiceConfig, patch: DicePatch): DiceConfig {
  return normalizeDice({
    ...base,
    ...patch,
    include: { ...base.include, ...patch.include },
  });
}

export function diceSoft(cfg: DiceConfig = DEFAULT_DICE): Partial<Record<keyof DreamAnim, Partial<Bound>>> {
  return {
    ...DICE_SOFT,
    labelCount: { max: cfg.labelsMax },
    partCap: { max: cfg.sparksMax },
    partPeak: { max: cfg.sparkPeak },
  };
}

export function diceFeedBound(cfg: DiceConfig = DEFAULT_DICE): Bound {
  return capBound({ min: 12, max: 80, step: 1 }, { max: cfg.feedDensityMax });
}

/** Operational / free-text knobs the dice leaves alone (RF watch, prompts, identity). */
const SKIP_KEYS = new Set([
  VIEW_PROMPT_KEY, "watch", "dwell", "ssid", "ssids", "source", "target", "pattern",
]);

const ANIM_NUM_MOTION: [keyof DreamAnim, Bound][] = [
  ["yawPeriod", DREAM_BOUNDS.yawPeriod],
  ["pitchDeg", DREAM_BOUNDS.pitchDeg],
  ["pitchPeriod", DREAM_BOUNDS.pitchPeriod],
  ["zoom", DREAM_BOUNDS.zoom],
  ["zoomPeriod", DREAM_BOUNDS.zoomPeriod],
  ["cyclePeriod", DREAM_BOUNDS.cyclePeriod],
  ["skyOpacity", DREAM_BOUNDS.opacity],
  ["skyBright", DREAM_BOUNDS.bright],
  ["skySpeed", DREAM_BOUNDS.skySpeed],
  ["skyEase", DREAM_BOUNDS.skyEase],
  ["skyAiMin", DREAM_BOUNDS.skyAiMin],
  ["bgOpacity", DREAM_BOUNDS.opacity],
  ["gridOpacity", DREAM_BOUNDS.opacity],
  ["gridBright", DREAM_BOUNDS.bright],
  ["gridSize", DREAM_BOUNDS.gridSize],
  ["gridFollow", DREAM_BOUNDS.gridFollow],
  ["audioSens", DREAM_BOUNDS.audioSens],
  ["camAudio", DREAM_BOUNDS.camDrive],
  ["camChange", DREAM_BOUNDS.camDrive],
  ["camGaze", DREAM_BOUNDS.camDrive],
  ["camInertia", DREAM_BOUNDS.camInertia],
  ["moveEase", DREAM_BOUNDS.moveEase],
  ["labelWeight", DREAM_BOUNDS.labelWeight],
  ["labelCount", DREAM_BOUNDS.labelCount],
  ["nodeWeight", DREAM_BOUNDS.nodeWeight],
  ["edgeWeight", DREAM_BOUNDS.edgeWeight],
  ["edgeGlowAmt", DREAM_BOUNDS.edgeGlowAmt],
  ["edgeGlowSpeed", DREAM_BOUNDS.edgeGlowSpeed],
];

const ANIM_NUM_PHYSICS: [keyof DreamAnim, Bound][] = [
  ["partAmt", DREAM_BOUNDS.partAmt],
  ["partBusy", DREAM_BOUNDS.partBusy],
  ["partQuiet", DREAM_BOUNDS.partQuiet],
  ["partPeak", DREAM_BOUNDS.partPeak],
  ["partCap", DREAM_BOUNDS.partCap],
  ["partSpeed", DREAM_BOUNDS.partSpeed],
  ["partSize", DREAM_BOUNDS.partSize],
  ["magnetSelf", DREAM_BOUNDS.magnet],
  ["magnetGateway", DREAM_BOUNDS.magnet],
  ["magnetLan", DREAM_BOUNDS.magnet],
  ["magnetLocal", DREAM_BOUNDS.magnet],
  ["magnetInternet", DREAM_BOUNDS.magnet],
  ["magnetMulticast", DREAM_BOUNDS.magnet],
  ["magnetCross", DREAM_BOUNDS.magnet],
  ["magnetRange", DREAM_BOUNDS.magnetRange],
  ["gravity", DREAM_BOUNDS.gravity],
  ["swirl", DREAM_BOUNDS.swirl],
  ["chargeAmt", DREAM_BOUNDS.chargeAmt],
  ["spring", DREAM_BOUNDS.spring],
  ["linkSpan", DREAM_BOUNDS.linkSpan],
  ["drag", DREAM_BOUNDS.drag],
  ["centerPull", DREAM_BOUNDS.centerPull],
  ["stringAmt", DREAM_BOUNDS.stringAmt],
];

const ANIM_BOOL_MOTION: (keyof DreamAnim)[] = [
  "follow", "cycle", "randomize", "skyAudio", "bgAudio", "gridAudio",
  "audioCamera", "camTheme", "audioNodes",
];

const ANIM_BOOL_PHYSICS: (keyof DreamAnim)[] = [
  "audioPhysics", "audioParts",
];

export interface ShuffleMode {
  id: string;
  options?: ModeOption[];
  config?: PluginField[];
}

export interface ShufflePlugin {
  id: string;
  fields: PluginField[];
}

export interface ShuffleCtx {
  themes: string[];
  modes: ShuffleMode[];
  plugins: ShufflePlugin[];
  skies: BackdropKind[];
  audioDrives?: AudioDrive[];
}

const SHOW_KEYS = ["lan", "internet", "multicast", "offline", "labels", "cpuIdle"] as const;

export function snapBound(b: Bound, rnd: Rng = Math.random): number {
  const span = b.max - b.min;
  const n = Math.round((b.min + rnd() * span) / b.step) * b.step;
  return Math.min(b.max, Math.max(b.min, Number(n.toFixed(4))));
}

/** Raise a floor or drop a ceiling without inverting the range. */
export function capBound(b: Bound, soft?: Partial<Bound>): Bound {
  if (!soft) return b;
  let min = soft.min != null ? Math.max(b.min, soft.min) : b.min;
  let max = soft.max != null ? Math.min(b.max, soft.max) : b.max;
  if (min > max) min = max;
  return { min, max, step: b.step };
}

export function diceBound(key: keyof DreamAnim, b: Bound, cfg: DiceConfig = DEFAULT_DICE): Bound {
  return capBound(b, diceSoft(cfg)[key]);
}

/** Drop numeric `top` choices above the dice node ceiling; leave other selects alone. */
export function diceSelect(key: string, values: readonly string[], cfg: DiceConfig = DEFAULT_DICE): string[] {
  if (key !== "top") return [...values];
  const kept = values.filter((v) => {
    const n = Number(v);
    return !Number.isFinite(n) || n <= cfg.nodeTop;
  });
  return kept.length ? kept : [...values];
}

export function diceNumberBound(f: PluginField, cfg: DiceConfig = DEFAULT_DICE): Bound {
  const min = f.min ?? 0;
  const rawMax = f.max ?? Math.max(min + 1, 100);
  const step = f.step ?? 1;
  return capBound({ min, max: rawMax, step }, f.key === "top" ? { max: cfg.nodeTop } : undefined);
}

export function pickOne<T>(items: readonly T[], rnd: Rng = Math.random): T {
  if (!items.length) throw new Error("pickOne: empty");
  const i = Math.min(items.length - 1, Math.floor(rnd() * items.length));
  return items[i]!;
}

function pickOther<T>(items: readonly T[], current: T | undefined, rnd: Rng): T {
  if (items.length <= 1) return items[0]!;
  const rest = current === undefined ? items : items.filter((x) => x !== current);
  return pickOne(rest.length ? rest : items, rnd);
}

export function shuffleField(f: PluginField, rnd: Rng = Math.random, cfg: DiceConfig = DEFAULT_DICE): string | undefined {
  if (SKIP_KEYS.has(f.key) || f.type === "text" || f.type === "textarea") return undefined;
  if (f.type === "boolean") return rnd() < 0.5 ? "1" : "0";
  if (f.type === "select" && f.values?.length) return pickOne(diceSelect(f.key, f.values.map(([v]) => v), cfg), rnd);
  if (f.type === "number") return String(snapBound(diceNumberBound(f, cfg), rnd));
  return undefined;
}

function shuffleKnobMap(
  current: Record<string, string> | undefined,
  fields: PluginField[] | undefined,
  options: ModeOption[] | undefined,
  rnd: Rng,
  cfg: DiceConfig,
): Record<string, string> {
  const out = { ...(current ?? {}) };
  for (const opt of options ?? []) {
    if (SKIP_KEYS.has(opt.key) || !opt.values.length) continue;
    out[opt.key] = pickOne(diceSelect(opt.key, opt.values.map(([v]) => v), cfg), rnd);
  }
  for (const f of fields ?? []) {
    const next = shuffleField(f, rnd, cfg);
    if (next !== undefined) out[f.key] = next;
  }
  return out;
}

function snapGroup(rec: Record<string, unknown>, keys: [keyof DreamAnim, Bound][], cfg: DiceConfig, rnd: Rng): void {
  for (const [key, bound] of keys) rec[key] = snapBound(diceBound(key, bound, cfg), rnd);
}

/** Random motion, sky, floor, physics, mosaic, and graph look inside the dice soft ceilings. */
export function shuffleAnim(
  anim: DreamAnim,
  ctx: Pick<ShuffleCtx, "skies" | "audioDrives">,
  rnd: Rng = Math.random,
  cfg: DiceConfig = DEFAULT_DICE,
): DreamAnim {
  const next: DreamAnim = { ...DEFAULT_DREAM, ...anim };
  const rec = next as unknown as Record<string, unknown>;
  if (cfg.include.motion) {
    snapGroup(rec, ANIM_NUM_MOTION, cfg, rnd);
    for (const key of ANIM_BOOL_MOTION) rec[key] = rnd() < 0.5;
    next.autoTune = true;
    if (ctx.skies.length) next.backdrop = pickOther(ctx.skies, anim.backdrop, rnd);
    next.gridShape = pickOther(FLOOR_SHAPES.map((o) => o.value), anim.gridShape, rnd);
    const drives = ctx.audioDrives?.length ? ctx.audioDrives : AUDIO_DRIVES.map((o) => o.value);
    next.audioDrive = pickOther(drives, anim.audioDrive, rnd);
    next.edgeGlow = pickOther(EDGE_GLOWS.map((o) => o.value), anim.edgeGlow, rnd);
    next.focus = pickOther(FOCUS_MODES.map((o) => o.value), anim.focus, rnd);
    next.themeCycle = pickOther(THEME_CYCLES.map((o) => o.value), anim.themeCycle, rnd);
    next.skyCycle = pickOther(SKY_CYCLES.map((o) => o.value), anim.skyCycle, rnd);
  }
  if (cfg.include.style) {
    next.graphFabric = pickOther(FABRIC_DICE, anim.graphFabric, rnd);
    next.graphSpace = pickOther(GRAPH_SPACE_OPTIONS.map((o) => o.value), anim.graphSpace, rnd);
  }
  if (cfg.include.physics) {
    snapGroup(rec, ANIM_NUM_PHYSICS, cfg, rnd);
    for (const key of ANIM_BOOL_PHYSICS) rec[key] = rnd() < 0.5;
  }
  if (cfg.include.mosaic) {
    next.mosaic = pickOther(diceMosaic(cfg), anim.mosaic, rnd);
    next.hero = pickOther(HERO_POS.map((o) => o.value), anim.hero, rnd);
    next.mosaicTree = null;
    next.mosaicMaxId = "";
    next.mosaicTiles = [];
  } else {
    next.mosaic = anim.mosaic;
    next.hero = anim.hero;
    next.mosaicTree = anim.mosaicTree ?? null;
    next.mosaicMaxId = anim.mosaicMaxId ?? "";
    next.mosaicTiles = anim.mosaicTiles ?? [];
  }
  next.mosaicSharedTheme = !!anim.mosaicSharedTheme;
  return next;
}

function shuffleFeed(feed: FeedConfig, rnd: Rng, cfg: DiceConfig): FeedConfig {
  return {
    on: rnd() < 0.5,
    layout: pickOther(FEED_LAYOUTS.map((o) => o.value), feed.layout, rnd),
    scope: pickOther(FEED_SCOPES.map((o) => o.value), feed.scope, rnd),
    source: "traffic",
    density: snapBound(diceFeedBound(cfg), rnd),
    textSize: snapBound({ min: 10, max: 20, step: 1 }, rnd),
    modulate: rnd() < 0.5,
    includeSources: feed.includeSources,
  };
}

function diceOf(s: ProfileSettings): DiceConfig {
  return s.dice ?? DEFAULT_DICE;
}

function stampMosaicSkies(
  anim: DreamAnim,
  mode: string,
  skies: BackdropKind[],
  rnd: Rng,
  catalog: string[],
): DreamAnim {
  if (anim.mosaic === "off") {
    return { ...anim, mosaicUniqueSkies: false, mosaicSkies: {} };
  }
  const unique = shouldUniqueMosaicSkies(rnd);
  let tiles = anim.mosaicTiles?.length ? anim.mosaicTiles : mosaicIds(anim.mosaic, mode, anim.hero);
  if (!tiles.length && catalog.length) {
    const n = Number(anim.mosaic) || 0;
    const extra = anim.hero !== "off" ? 1 : 0;
    const hero = catalog.includes(mode) ? mode : catalog[0]!;
    tiles = [hero, ...catalog.filter((id) => id !== hero)].slice(0, Math.max(n + extra, 2));
  }
  const pool = skies.length ? skies : CYCLE_SKIES;
  return {
    ...anim,
    mosaicUniqueSkies: unique,
    mosaicSkies: unique
      ? assignMosaicSkies(tiles, anim.backdrop, pool, (id) => lookForMode(id)?.backdrop)
      : {},
  };
}

/**
 * Random theme, catalog view, mosaic, feed, every view's knobs, motion, and physics.
 * Leaves chrome, camera, microphone, privacy filters, prompts, agent decorations, and the dice config itself.
 */
/** Plugin skies hide the graph. The header die always asks for a new view. */
export function diceLookForRoll(
  cfg: DiceConfig,
  current: { pinSky?: boolean; stageOnly?: boolean; forceView?: boolean } = {},
): DiceConfig {
  if (cfg.include.view || current.forceView || current.pinSky || current.stageOnly) {
    return cfg.include.view ? cfg : { ...cfg, include: { ...cfg.include, view: true } };
  }
  return cfg;
}

export function shuffleLook(s: ProfileSettings, ctx: ShuffleCtx, rnd: Rng = Math.random): ProfileSettings {
  const cfg = diceOf(s);
  const on = cfg.include;
  const modeOptions: Record<string, Record<string, string>> = { ...s.modeOptions };
  const plugins: Record<string, Record<string, string>> = { ...s.plugins };
  if (on.knobs) {
    for (const m of ctx.modes) {
      modeOptions[m.id] = shuffleKnobMap(modeOptions[m.id], m.config, m.options, rnd, cfg);
    }
    for (const p of ctx.plugins) {
      plugins[p.id] = shuffleKnobMap(plugins[p.id], p.fields, undefined, rnd, cfg);
    }
  }
  const modeIds = ctx.modes.map((m) => m.id);
  const show = { ...s.show };
  let merge = s.merge;
  if (on.show) {
    for (const key of SHOW_KEYS) show[key] = rnd() < 0.5;
    merge = rnd() < 0.5;
  }
  const animOn = on.motion || on.physics || on.mosaic || on.style;
  const mode = on.view && modeIds.length ? pickOther(modeIds, s.mode, rnd) : s.mode;
  let anim = animOn ? shuffleAnim(s.anim, ctx, rnd, cfg) : { ...s.anim };
  if (animOn && (on.motion || on.mosaic)) {
    anim = stampMosaicSkies(anim, mode, ctx.skies, rnd, modeIds);
  }
  return {
    ...s,
    theme: on.theme && ctx.themes.length ? pickOther(ctx.themes, s.theme, rnd) : s.theme,
    mode,
    modeOptions,
    plugins,
    anim,
    chrome: s.chrome,
    camera: s.camera,
    mic: s.mic,
    merge,
    show,
    feed: on.feed ? shuffleFeed(s.feed ?? DEFAULT_FEED, rnd, cfg) : s.feed,
    dice: cfg,
  };
}
