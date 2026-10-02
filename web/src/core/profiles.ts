import { DEFAULT_FEED, type FeedConfig } from "../ui/feed";
import { DEFAULT_CHAT, type ChatConfig } from "../ui/chat";
import { allModes, defaultCatalogMode, defaultOpts } from "./modes";
import { DEFAULT_DREAM, type DreamAnim } from "../graph/scene";
import { guardReadableAnim } from "../graph/readable";
import { DEFAULT_THEME } from "./themes";
import { EMPTY_LOOK, normalizeAgentLook, type AgentLook } from "../graph/deco";
import { DEFAULT_DICE, normalizeDice, type DiceConfig } from "./shuffle";
import { apiFetch } from "./http";
import { mergeMediaAccept, setMediaAcceptSink } from "../ui/media-ask";
import { remapSavedViewId } from "./saved-view-id";
import { normalizeRecentViews } from "../plugins/recent-views";
import type { RemixPairing } from "../remix/remix-types";

/** Shipped profile id. Always present, never overwritten from the UI. */
export const SHIPPED_ID = "zoto-viz";
export const SHIPPED_LABEL = "zoto viz";
/** Pre-rename shipped id; still treated as the factory profile. */
export const LEGACY_SHIPPED_ID = "netviz";
export const USER_ID = "user";
/** Legacy cycling profile id; new agent profiles are named after the Ollama model. */
export const AI_ID = "ai";
/** #262: the ProfileSettings schema this build writes. v0 is legacy, v1 and v2 are accepted. */
export const PROFILE_SETTINGS_V = 2;
/** #256: the profile bar's line for a profile saved by a newer build, which autosave leaves alone. */
export const NEWER_PROFILE_NOTICE = "This profile was saved by a newer version of zoto-viz, so changes won't be saved to it. Use Save as to keep them in a new profile.";
const AI_PREV_KEY = "zoto-viz.ai.prevProfile";

export interface ProfileMeta {
  id: string;
  label: string;
  shipped: boolean;
  /** Ollama model tag when this profile belongs to a local agent. */
  model?: string;
}

export interface ProfileList {
  default: string;
  fresh: boolean;
  file: string;
  profiles: ProfileMeta[];
}

export interface ProfileSettings {
  theme: string;
  dream: boolean;
  mode: string;
  modeOptions: Record<string, Record<string, string>>;
  show: { lan: boolean; internet: boolean; multicast: boolean; offline: boolean; labels: boolean; cpuIdle: boolean };
  merge: boolean;
  redact: boolean;
  /** Auto-grant plugin consent for shipped src and local zips (not contrib zips). */
  autoconsent: boolean;
  /** Host adaptive render.scale governor (on by default; `?vizGovernor=0` forces off for one load). */
  vizGovernor: boolean;
  filters: { allowNames: string; blockNames: string; allowNets: string; blockNets: string };
  anim: DreamAnim;
  feed: FeedConfig;
  chat: ChatConfig;
  arcade: Record<string, string>;
  /** where the chrome sits: top header, or a wide left/right bar (the other side holds the inspect panel) */
  chrome: "top" | "left" | "right";
  /** per-plugin cog values, keyed by YAML plugin id */
  plugins: Record<string, Record<string, string>>;
  camera: "auto" | "off";
  mic: "auto" | "off";
  /** Speaker output: plugin SFX, arcade, spoken replies. Starts off. */
  sound: boolean;
  /** GLSL / photos / SVG the local agent pinned on this profile */
  agent: AgentLook;
  /** Header dice: which groups to roll and the soft ceilings. */
  dice: DiceConfig;
  /** always true; kept on the blob so older files upgrade on the next write */
  autosave: boolean;
  /** Agent backend and model. The Cursor key itself stays in ~/.zoto-viz/cursor-key. */
  ai: ProfileAi;
  /** View ids the user picked, most recent first (header, digits, mosaic panes). */
  recentViews: string[];
  /** Focused mosaic pane, when the user last left one. */
  mosaicFocus: string;
  /** Header and Settings controls that used to live only in this browser. */
  operator: ProfileOperator;
  /** Remix data/visual pairing. Null when the user cleared it. */
  remix: RemixPairing | null;
  /** False when an older file has no saved copy of that block yet. */
  operatorSaved: boolean;
  recentSaved: boolean;
  remixSaved: boolean;
  mosaicFocusSaved: boolean;
  pluginsSaved: boolean;
  arcadeSaved: boolean;
  modeOptionsSaved: boolean;
  /** #256: schema version; always the current one once normalised. */
  v: typeof PROFILE_SETTINGS_V;
  /**
   * #256: the stored blob had no `v` (saved before versioning); its next autosave upgrades it.
   * Load-time only, like `newer`: normalizeSettings sets both, and no saved blob carries them.
   */
  legacy?: boolean;
  /** #256: the stored blob's `v` is newer than this build's, so autosave never writes over it. */
  newer?: boolean;
}

/** #256: a profile blob as written to the server: current `v`, without the load-time markers. */
export function storedSettings(s: ProfileSettings): Omit<ProfileSettings, "legacy" | "newer"> {
  const out: ProfileSettings = { ...s, v: PROFILE_SETTINGS_V };
  delete out.legacy;
  delete out.newer;
  return out;
}

/** Settings the operator toggles outside the motion / graph blob. */
export interface ProfileOperator {
  voice: boolean;
  listen: boolean;
  watchword: string;
  ttsVoice: string;
  includeScreen: boolean;
  mosaicLayout: boolean;
  tsPlugins: boolean;
  temper: number;
  weather: string;
  tileHealErrors: boolean;
  debug: boolean;
}

/** Agent choices stored on the profile so a new tab or the other port keeps them. */
export interface ProfileAi {
  /** Empty until this profile has been saved with an explicit backend. */
  backend: "" | "ollama" | "cursor";
  model: string;
  cursorModel: string;
  /** Header AI. Off unless this profile saved it on — a missing blob must not switch profiles. */
  cycle: boolean;
}

/** A same-tab session snapshot as ProfileStore applies it at boot. */
export interface SessionApply {
  profileId: string;
  dirty?: boolean;
  settings: unknown;
  /** #256: profiles the page knew were saved by a newer build. */
  newerIds?: string[];
  /** #256: the snapshot's profile still had a legacy (v0) blob on the server. */
  legacy?: boolean;
}

export interface ProfileHost {
  collect(): ProfileSettings;
  apply(s: ProfileSettings): void;
}

let hush = 0;

/** Run a settings write without marking the loaded profile dirty. */
export function quiet<T>(fn: () => T): T {
  hush++;
  try { return fn(); } finally { hush--; }
}

export function isQuiet(): boolean {
  return hush > 0;
}

/** Overlay that the header AI toggle writes into a new model-named profile. */
export function aiCycleSettings(base: ProfileSettings, opts: { keepLook?: boolean } = {}): ProfileSettings {
  const shader = !!base.agent.shader;
  const keep = opts.keepLook || shader;
  return {
    ...base,
    dream: true,
    autosave: true,
    ai: { ...base.ai, cycle: true },
    anim: {
      ...base.anim,
      follow: true,
      cycle: true,
      randomize: true,
      backdrop: keep ? (shader ? "custom" : base.anim.backdrop) : "dynamic",
      themeCycle: keep ? base.anim.themeCycle : "cadence",
      skyCycle: keep ? base.anim.skyCycle : "off",
    },
  };
}

export function shippedSettings(): ProfileSettings {
  return {
    theme: DEFAULT_THEME.id,
    dream: false,
    mode: defaultCatalogMode()?.id ?? "topology",
    modeOptions: Object.fromEntries(allModes().map((m) => [m.id, defaultOpts(m)])),
    show: { lan: true, internet: true, multicast: true, offline: true, labels: true, cpuIdle: true },
    merge: false,
    redact: false,
    autoconsent: false,
    vizGovernor: true,
    filters: { allowNames: "", blockNames: "", allowNets: "", blockNets: "" },
    anim: { ...DEFAULT_DREAM },
    feed: { ...DEFAULT_FEED },
    chat: { ...DEFAULT_CHAT },
    arcade: {},
    chrome: "top",
    plugins: {},
    camera: "auto",
    mic: "auto",
    sound: false,
    agent: { ...EMPTY_LOOK },
    dice: { ...DEFAULT_DICE, include: { ...DEFAULT_DICE.include } },
    autosave: true,
    ai: emptyAi(),
    recentViews: [],
    mosaicFocus: "",
    operator: defaultOperator(),
    remix: null,
    operatorSaved: true,
    recentSaved: true,
    remixSaved: true,
    mosaicFocusSaved: true,
    pluginsSaved: true,
    arcadeSaved: true,
    modeOptionsSaved: true,
    v: PROFILE_SETTINGS_V,
    legacy: false,
    newer: false,
  };
}

export function defaultOperator(): ProfileOperator {
  return {
    voice: true,
    listen: true,
    watchword: "zoto",
    ttsVoice: "",
    includeScreen: true,
    mosaicLayout: true,
    tsPlugins: true,
    temper: 22,
    weather: "drift",
    tileHealErrors: false,
    debug: false,
  };
}

const WEATHERS = new Set(["hush", "drift", "pulse", "storm"]);

export function normalizeOperator(raw: unknown): ProfileOperator {
  const d = defaultOperator();
  const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const temper = Number(s.temper);
  const weather = typeof s.weather === "string" ? s.weather : d.weather;
  const watch = typeof s.watchword === "string" ? s.watchword.trim().slice(0, 32) : d.watchword;
  return {
    voice: bool(s.voice, d.voice),
    listen: bool(s.listen, d.listen),
    watchword: watch || d.watchword,
    ttsVoice: typeof s.ttsVoice === "string" ? s.ttsVoice.trim().slice(0, 80) : d.ttsVoice,
    includeScreen: bool(s.includeScreen, d.includeScreen),
    mosaicLayout: bool(s.mosaicLayout, d.mosaicLayout),
    tsPlugins: bool(s.tsPlugins, d.tsPlugins),
    temper: Number.isFinite(temper) ? Math.min(100, Math.max(0, Math.round(temper))) : d.temper,
    weather: WEATHERS.has(weather) ? weather : d.weather,
    tileHealErrors: bool(s.tileHealErrors, d.tileHealErrors),
    debug: bool(s.debug, d.debug),
  };
}

export function normalizeRemix(raw: unknown): RemixPairing | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const dataPluginId = typeof s.dataPluginId === "string" ? s.dataPluginId.trim() : "";
  const sourceId = typeof s.sourceId === "string" ? s.sourceId.trim() : "";
  const visualPackId = typeof s.visualPackId === "string" ? s.visualPackId.trim() : "";
  if (!dataPluginId || !sourceId || !visualPackId) return null;
  return { dataPluginId, sourceId, visualPackId };
}

export function emptyAi(): ProfileAi {
  return { backend: "", model: "", cursorModel: "", cycle: false };
}

export function normalizeAi(raw: unknown): ProfileAi {
  const d = emptyAi();
  const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const backend = s.backend === "cursor" || s.backend === "ollama" ? s.backend : d.backend;
  return {
    backend,
    model: typeof s.model === "string" ? s.model.slice(0, 64) : d.model,
    cursorModel: typeof s.cursorModel === "string" ? s.cursorModel.slice(0, 64) : d.cursorModel,
    cycle: s.cycle === true,
  };
}

/** Shared across profiles in ~/.zoto-viz/profiles.yml (`global`). */
export interface HomeGlobal {
  ai: ProfileAi;
  /** mic / cam: Allow was pressed. micOff: the user said Not now or switched the mic Off. */
  media: { mic: boolean; cam: boolean; micOff: boolean };
}

export function emptyHomeGlobal(): HomeGlobal {
  return { ai: emptyAi(), media: { mic: false, cam: false, micOff: false } };
}

export function normalizeHomeGlobal(raw: unknown): HomeGlobal {
  const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const media = s.media && typeof s.media === "object" ? s.media as Record<string, unknown> : {};
  return {
    ai: normalizeAi(s.ai),
    media: { mic: media.mic === true, cam: media.cam === true, micOff: media.micOff === true },
  };
}

/** True when the home block has a model choice worth keeping over a profile blob. */
export function homeAiActive(ai: ProfileAi | undefined): boolean {
  if (!ai) return false;
  return ai.backend === "cursor" || ai.backend === "ollama"
    || ai.model.trim() !== ""
    || ai.cursorModel.trim() !== ""
    || ai.cycle === true;
}

export function normalizeSettings(raw: unknown): ProfileSettings {
  const d = shippedSettings();
  const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const show = s.show && typeof s.show === "object" ? s.show as Record<string, unknown> : {};
  const filters = s.filters && typeof s.filters === "object" ? s.filters as Record<string, unknown> : {};
  const anim = s.anim && typeof s.anim === "object" ? s.anim as DreamAnim : d.anim;
  const feed = s.feed && typeof s.feed === "object" ? s.feed as FeedConfig : d.feed;
  const chat = s.chat && typeof s.chat === "object" ? s.chat as ChatConfig : d.chat;
  const modeOptions = s.modeOptions && typeof s.modeOptions === "object"
    ? s.modeOptions as Record<string, Record<string, string>>
    : d.modeOptions;
  const arcade = s.arcade && typeof s.arcade === "object" ? s.arcade as Record<string, string> : {};
  const plugins = s.plugins && typeof s.plugins === "object" ? s.plugins as Record<string, Record<string, string>> : {};
  // #256: the markers come from the stored `v` alone, never from a stored legacy / newer.
  const savedV = typeof s.v === "number" && Number.isInteger(s.v) && s.v >= 1 ? s.v : 0;
  return {
    theme: typeof s.theme === "string" ? s.theme : d.theme,
    dream: bool(s.dream, d.dream),
    mode: typeof s.mode === "string" ? remapSavedViewId(s.mode) : d.mode,
    modeOptions: { ...d.modeOptions, ...modeOptions },
    show: {
      lan: bool(show.lan, d.show.lan),
      internet: bool(show.internet, d.show.internet),
      multicast: bool(show.multicast, d.show.multicast),
      offline: bool(show.offline, d.show.offline),
      labels: bool(show.labels, d.show.labels),
      cpuIdle: bool(show.cpuIdle, d.show.cpuIdle),
    },
    merge: bool(s.merge, d.merge),
    redact: bool(s.redact, d.redact),
    autoconsent: bool(s.autoconsent, d.autoconsent),
    vizGovernor: bool(s.vizGovernor, d.vizGovernor),
    filters: {
      allowNames: str(filters.allowNames),
      blockNames: str(filters.blockNames),
      allowNets: str(filters.allowNets),
      blockNets: str(filters.blockNets),
    },
    anim: guardReadableAnim({ ...d.anim, ...anim }),
    feed: {
      ...d.feed,
      ...feed,
      source: "traffic",
      includeSources: bool((feed as FeedConfig).includeSources, d.feed.includeSources),
      textSize: (() => {
        const n = Number((feed as FeedConfig).textSize);
        return Number.isFinite(n) ? Math.min(20, Math.max(10, n)) : d.feed.textSize;
      })(),
      density: (() => {
        const n = Number((feed as FeedConfig).density);
        return Number.isFinite(n) ? Math.min(80, Math.max(12, n)) : d.feed.density;
      })(),
    },
    chat: {
      on: bool((chat as ChatConfig).on, d.chat.on),
      textSize: (() => {
        const n = Number((chat as ChatConfig).textSize);
        return Number.isFinite(n) ? Math.min(20, Math.max(10, n)) : d.chat.textSize;
      })(),
    },
    arcade: { ...arcade },
    chrome: s.chrome === "left" || s.chrome === "right" ? s.chrome : d.chrome,
    plugins: { ...plugins },
    camera: s.camera === "off" ? "off" : d.camera,
    mic: s.mic === "off" ? "off" : d.mic,
    sound: bool(s.sound, d.sound),
    agent: normalizeAgentLook(s.agent),
    dice: normalizeDice(s.dice),
    autosave: true,
    ai: normalizeAi(s.ai),
    recentViews: normalizeRecentViews(s.recentViews),
    mosaicFocus: typeof s.mosaicFocus === "string" ? s.mosaicFocus.trim().slice(0, 80) : "",
    operator: normalizeOperator(s.operator),
    remix: normalizeRemix(s.remix),
    operatorSaved: !!s.operator && typeof s.operator === "object",
    recentSaved: Array.isArray(s.recentViews),
    remixSaved: Object.prototype.hasOwnProperty.call(s, "remix"),
    mosaicFocusSaved: typeof s.mosaicFocus === "string",
    pluginsSaved: !!s.plugins && typeof s.plugins === "object",
    arcadeSaved: !!s.arcade && typeof s.arcade === "object",
    modeOptionsSaved: !!s.modeOptions && typeof s.modeOptions === "object",
    v: PROFILE_SETTINGS_V,
    legacy: savedV === 0,
    newer: savedV > PROFILE_SETTINGS_V,
  };
}

/**
 * #257: a legacy blob's `vizGovernor: false` was the old default, written whether or not
 * the user chose it. That applies as on. A current profile's false is the user's choice.
 */
export function vizGovernorEnabledForSettings(s: ProfileSettings): boolean {
  if (s.legacy && s.vizGovernor === false) return true;
  return s.vizGovernor === true;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const AUTOSAVE_DEBOUNCE_MS = 450;

/** Slug used as the writable profile id for an Ollama model tag. */
export function agentProfileId(model: string): string {
  const compact = model.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let slug = compact.slice(0, 32).replace(/-+$/g, "");
  if (!slug) slug = "agent";
  if (!/^[a-z]/.test(slug)) slug = `m-${slug}`.slice(0, 32).replace(/-+$/g, "");
  if (!ID_RE.test(slug)) slug = "agent";
  if (slug === SHIPPED_ID || slug === LEGACY_SHIPPED_ID || slug === USER_ID) slug = `agent-${slug}`.slice(0, 32);
  return slug;
}

export function isAgentProfile(meta: { id: string; model?: string } | undefined): boolean {
  if (!meta) return false;
  if (meta.id === AI_ID) return true;
  return typeof meta.model === "string" && meta.model.trim().length > 0;
}

export function isShippedId(id: string): boolean {
  return id === SHIPPED_ID || id === LEGACY_SHIPPED_ID;
}

/** Suffix after the header brand: ` - user-2`. */
export function headerBrandProfile(label: string | undefined): string {
  const name = (label ?? "").trim();
  return name ? ` - ${name}` : "";
}

/** Writable profile that absorbs factory-look edits. Always `user`, never an agent or startup profile. */
export function workingProfileId(_defaultId: string, _ids: string[]): string {
  return USER_ID;
}

export function suggestId(taken: string[]): string {
  if (!taken.includes(USER_ID)) return USER_ID;
  for (let i = 2; i < 100; i++) {
    const id = `${USER_ID}-${i}`;
    if (!taken.includes(id)) return id;
  }
  return `user-${Date.now().toString(36)}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || `${r.status} ${path}`);
  return body as T;
}

export class ProfileStore {
  current = "";
  defaultId = SHIPPED_ID;
  list: ProfileMeta[] = [];
  dirty = false;
  available = false;
  file = "";
  /** Model choice and mic / camera acceptance. Shared by every profile. */
  homeGlobal: HomeGlobal = emptyHomeGlobal();
  /** writable profiles always write as settings change */
  autosave = true;
  private saveTimer = 0;
  private saveGen = 0;
  /** Last id sent to the startup-default route, so a reload does not retarget it. */
  private pinSent = "";
  private adopting = false;
  private recoverTimer = 0;
  private recoverDelay = 2000;
  private recovering = false;
  /** #256: profiles whose loaded blob a newer build saved; nothing here writes over them. */
  private readonly newer = new Set<string>();
  /** #256: the loaded profile whose blob has no `v` yet (cleared once a write upgrades it). */
  private legacyId = "";
  /** #256: the newer profile whose line the status span shows; set once per load of it. */
  private noticeId = "";
  private readonly host: ProfileHost;
  private readonly sel: { setOptions(o: { value: string; label: string; hint?: string }[]): void; value: string; el: HTMLElement };
  private readonly bar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly discardBtn: HTMLButtonElement;
  private readonly saveAsBtn: HTMLButtonElement;
  private readonly defaultBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;

  constructor(host: ProfileHost, sel: ProfileStore["sel"], bar: HTMLElement, tools: HTMLElement) {
    this.host = host;
    this.sel = sel;
    this.bar = bar;
    this.bar.className = "profile-bar";
    this.bar.hidden = true;
    this.status = document.createElement("span");
    this.status.className = "msg";
    // #256: in the bar, empty, before any line is set, so the line is announced when it is.
    this.status.setAttribute("role", "status");
    const actions = document.createElement("span");
    actions.className = "actions";
    this.saveBtn = btn("Save", "save these settings to the current profile");
    this.discardBtn = btn("Discard", "reload the current profile and drop unsaved changes");
    this.saveAsBtn = btn("Save as…", "write a new profile and make it the startup default");
    actions.append(this.saveBtn, this.discardBtn, this.saveAsBtn);
    this.bar.append(this.status, actions);

    this.defaultBtn = btn("startup default", "load this profile when the page opens");
    this.deleteBtn = btn("delete", "remove this profile");
    this.deleteBtn.classList.add("warn");
    tools.append(this.defaultBtn, this.deleteBtn);

    setMediaAcceptSink((media) => { void this.saveHome({ media }); });
    this.saveBtn.addEventListener("click", () => void this.confirmSave());
    this.discardBtn.addEventListener("click", () => void this.discard());
    this.saveAsBtn.addEventListener("click", () => void this.saveAsNew(true));
    this.defaultBtn.addEventListener("click", () => void this.setDefault(this.current));
    this.deleteBtn.addEventListener("click", () => void this.remove());
  }

  get canAutosave(): boolean {
    return this.available && !!this.current && !this.shipped && !this.newerProfile;
  }

  /** #256: the current profile was saved by a newer version of zoto-viz. */
  get newerProfile(): boolean {
    return !!this.current && this.newer.has(this.current);
  }

  /** #256: the current profile's stored blob predates `v`. */
  get legacyProfile(): boolean {
    return !!this.current && this.legacyId === this.current;
  }

  /** #256: every profile known to be newer, for the same-tab session snapshot. */
  newerIds(): string[] {
    return [...this.newer];
  }

  meta(id = this.current): ProfileMeta | undefined {
    return this.list.find((p) => p.id === id);
  }

  isAgent(id = this.current): boolean {
    return isAgentProfile(this.meta(id) ?? (id ? { id } : undefined));
  }

  get shipped(): boolean {
    return this.meta()?.shipped === true || isShippedId(this.current);
  }

  async boot(live?: SessionApply | null): Promise<boolean> {
    let data: ProfileList;
    try {
      data = await this.pullList();
    } catch (e) {
      console.warn("zoto-viz profiles:", e);
      this.markUnavailable();
      if (live) return this.applySession(live);
      this.current = USER_ID;
      this.syncChrome();
      return false;
    }
    try {
      if (live) return this.applySession(live);
      const load = this.list.some((p) => p.id === data.default) ? data.default : SHIPPED_ID;
      await this.load(load, { quiet: true });
      return false;
    } catch (e) {
      console.warn("zoto-viz profiles:", e);
      this.syncChrome();
      return false;
    }
  }

  /**
   * Re-open ~/.zoto-viz/profiles.yml after a monitor blip. Keeps the live look;
   * does not reload the startup default.
   */
  async recover(): Promise<boolean> {
    if (this.available) return true;
    if (this.recovering) return false;
    this.recovering = true;
    try {
      await this.pullList();
      this.syncChrome();
      if (this.canAutosave && this.dirty) void this.writeNow();
      return true;
    } catch (e) {
      console.warn("zoto-viz profiles:", e);
      this.markUnavailable();
      return false;
    } finally {
      this.recovering = false;
    }
  }

  private async pullList(): Promise<ProfileList> {
    let data = await api<ProfileList>("/api/profiles");
    this.available = true;
    this.file = data.file;
    this.clearRecoverTimer();
    data = await this.ensureCatalog(data);
    this.ingest(data);
    await this.loadHome();
    return data;
  }

  /** Pull `global` and fold a browser-only mic accept into the home file. */
  private async loadHome(): Promise<void> {
    try {
      this.homeGlobal = normalizeHomeGlobal(await api("/api/profiles/global"));
      const merged = mergeMediaAccept(this.homeGlobal.media);
      if (merged.mic !== this.homeGlobal.media.mic || merged.cam !== this.homeGlobal.media.cam) {
        await this.saveHome({ media: merged });
      }
      if (this.homeGlobal.media.micOff) this.onHomeMicOff?.();
    } catch (e) {
      console.warn("zoto-viz home global:", e);
    }
  }

  /** Keep a real model choice in the home block. An empty profile blob must not wipe it. */
  private keepHomeAi(ai: ProfileAi): void {
    if (homeAiActive(ai) || !homeAiActive(this.homeGlobal.ai)) void this.saveHome({ ai });
  }

  /**
   * Called once the home file says the mic was declined, so a new browser starts with it Off.
   * The app points this at the header toggle.
   */
  onHomeMicOff?: () => void;

  /** Keep the mic On / Off decision in the home file so every browser and session shares it. */
  saveMicOff(off: boolean): void {
    if (this.homeGlobal.media.micOff === off) return;
    void this.saveHome({ media: { ...this.homeGlobal.media, micOff: off } });
  }

  /** Merge model details or media acceptance into the home file. */
  async saveHome(patch: { ai?: ProfileAi; media?: { mic: boolean; cam: boolean; micOff?: boolean } }): Promise<void> {
    if (!this.available) return;
    if (patch.ai) this.homeGlobal = { ...this.homeGlobal, ai: normalizeAi(patch.ai) };
    let body: typeof patch = patch;
    if (patch.media) {
      // The server replaces the whole media block, so always send every field.
      const media = {
        mic: patch.media.mic === true,
        cam: patch.media.cam === true,
        micOff: patch.media.micOff ?? this.homeGlobal.media.micOff,
      };
      this.homeGlobal = { ...this.homeGlobal, media };
      body = { ...patch, media };
    }
    try {
      this.homeGlobal = normalizeHomeGlobal(await api("/api/profiles/global", {
        method: "PUT",
        body: JSON.stringify(body),
      }));
    } catch (e) {
      console.warn("zoto-viz home global:", e);
    }
  }

  /** Best-effort factory + user rows. A write failure must not flip available off. */
  private async ensureCatalog(data: ProfileList): Promise<ProfileList> {
    try {
      await api("/api/profiles/shipped", { method: "POST", body: JSON.stringify({ settings: storedSettings(shippedSettings()) }) });
      data = await api<ProfileList>("/api/profiles");
    } catch (e) {
      console.warn("zoto-viz profiles shipped:", e);
    }
    if (data.profiles.some((p) => p.id === USER_ID)) return data;
    try {
      await api("/api/profiles", {
        method: "POST",
        body: JSON.stringify({
          id: USER_ID,
          label: USER_ID,
          settings: storedSettings({ ...this.host.collect(), autosave: true }),
          make_default: data.fresh || data.default === USER_ID || isShippedId(data.default),
        }),
      });
      return await api<ProfileList>("/api/profiles");
    } catch (e) {
      // Two tabs (or a race with another client) both create `user` on first boot.
      if (String(e).includes("already exists")) {
        return await api<ProfileList>("/api/profiles");
      }
      console.warn("zoto-viz profiles user:", e);
      return data;
    }
  }

  private markUnavailable(): void {
    this.available = false;
    this.syncChrome();
    this.scheduleRecover();
  }

  private scheduleRecover(): void {
    if (this.recoverTimer || this.available) return;
    this.recoverTimer = window.setTimeout(() => {
      this.recoverTimer = 0;
      void this.recover().then((ok) => {
        if (ok) this.recoverDelay = 2000;
        else {
          this.recoverDelay = Math.min(this.recoverDelay * 2, 30_000);
          this.scheduleRecover();
        }
      });
    }, this.recoverDelay);
  }

  private clearRecoverTimer(): void {
    if (this.recoverTimer) {
      window.clearTimeout(this.recoverTimer);
      this.recoverTimer = 0;
    }
    this.recoverDelay = 2000;
  }

  /** Apply a same-tab session snapshot instead of the startup default. */
  applySession(live: SessionApply): boolean {
    const raw = live.profileId === LEGACY_SHIPPED_ID ? SHIPPED_ID : live.profileId;
    let id = raw && this.list.some((p) => p.id === raw)
      ? raw
      : (this.current || this.defaultId || USER_ID);
    if (isShippedId(id) && this.list.some((p) => p.id === USER_ID)) id = USER_ID;
    this.current = id;
    this.sel.value = id;
    const settings = normalizeSettings(live.settings);
    // #256: the snapshot's settings were re-stamped to this build's v, so what the page learned from the server
    // load rides beside them. A session apply runs once, at boot: the snapshot is its record.
    this.newer.clear();
    this.noticeId = "";
    for (const n of live.newerIds ?? []) this.newer.add(n);
    if (settings.newer) this.newer.add(id);
    this.legacyId = settings.legacy || (live.legacy === true && id === raw) ? id : "";
    this.dirty = !!live.dirty && !this.shipped && !this.newerProfile;
    const applied = this.legacyProfile ? { ...settings, legacy: true } : settings;
    quiet(() => this.host.apply(applied));
    this.adoptAutosave(settings.autosave);
    this.syncChrome();
    return true;
  }

  touch(): void {
    if (hush || !this.available || !this.current) return;
    if (this.shipped) {
      void this.adoptWorking();
      return;
    }
    if (this.newerProfile) return;
    if (this.canAutosave) {
      this.scheduleSave();
      return;
    }
    if (!this.dirty) {
      this.dirty = true;
      this.syncChrome();
    }
  }

  /** Autosave stays on for every writable profile. */
  adoptAutosave(_on?: boolean): void {
    this.autosave = true;
  }

  /** First edit on the factory profile lands on the writable working profile. */
  private async adoptWorking(): Promise<void> {
    if (this.adopting || !this.available || !this.shipped) return;
    this.adopting = true;
    const id = workingProfileId(this.defaultId, this.list.map((p) => p.id));
    const settings: ProfileSettings = { ...this.host.collect(), autosave: true };
    try {
      // #275: the list can name a working profile this tab never loaded. One GET
      // before the first write; a newer blob takes the keep-unsaved path below.
      if (this.list.some((p) => p.id === id) && !this.newer.has(id)) {
        const raw = await api<{ settings: unknown }>(`/api/profiles/${id}`);
        if (normalizeSettings(raw.settings).newer) this.newer.add(id);
      }
      if (this.newer.has(id)) {
        // #256: a newer build saved the working profile; keep the edit here, unsaved.
        this.dirty = true;
        this.syncChrome();
        return;
      }
      if (this.list.some((p) => p.id === id)) {
        await api(`/api/profiles/${id}`, { method: "PUT", body: JSON.stringify({ settings: storedSettings(settings) }) });
      } else {
        await api("/api/profiles", {
          method: "POST",
          body: JSON.stringify({
            id,
            label: id,
            settings: storedSettings(settings),
            make_default: isShippedId(this.defaultId),
          }),
        });
      }
      this.ingest(await api<ProfileList>("/api/profiles"));
      this.current = id;
      this.dirty = false;
      this.sel.value = id;
      this.adoptAutosave(true);
      this.syncChrome();
    } catch (e) {
      this.dirty = true;
      this.syncChrome();
      flash(this.bar, String(e));
    } finally {
      this.adopting = false;
    }
  }

  async select(id: string): Promise<void> {
    if (id === this.current) return;
    await this.flushPending();
    if (this.dirty) {
      const choice = await ask({
        title: "Unsaved profile",
        body: this.shipped
          ? `Shipped ${SHIPPED_LABEL} cannot be overwritten. Save as a new profile before switching, or discard the changes.`
          : `Save changes to profile “${this.current}” before switching to “${id}”?`,
        actions: this.shipped
          ? [
              { id: "saveas", label: "Save as…", kind: "primary" },
              { id: "discard", label: "Discard" },
              { id: "cancel", label: "Cancel" },
            ]
          : [
              { id: "save", label: "Save", kind: "primary" },
              { id: "discard", label: "Discard" },
              { id: "cancel", label: "Cancel" },
            ],
      });
      if (!choice || choice.id === "cancel") { this.sel.value = this.current; return; }
      if (choice.id === "save" && !(await this.saveCurrent())) { this.sel.value = this.current; return; }
      if (choice.id === "saveas" && !(await this.saveAsNew(true))) { this.sel.value = this.current; return; }
    }
    try {
      await this.load(id);
      void this.pinStartup();
    } catch (e) {
      this.sel.value = this.current;
      flash(this.bar, String(e));
    }
  }

  private async load(id: string, opts: { quiet?: boolean } = {}): Promise<void> {
    this.clearTimer();
    const settings = isShippedId(id)
      ? shippedSettings()
      : normalizeSettings((await api<{ settings: unknown }>(`/api/profiles/${id}`)).settings);
    this.current = id;
    if (settings.newer) this.newer.add(id);
    else this.newer.delete(id);
    this.legacyId = settings.legacy ? id : "";
    this.dirty = false;
    this.sel.value = id;
    const apply = () => { this.host.apply(settings); };
    if (opts.quiet) quiet(apply); else quiet(apply);
    this.adoptAutosave(settings.autosave);
    this.syncChrome();
  }

  /**
   * Choosing a profile makes it the one a cold start loads. Header AI and a
   * same-tab session must not retarget it — that was swapping in the model profile.
   */
  async pinStartup(): Promise<void> {
    const id = this.current;
    if (!this.available || !id || id === this.defaultId || id === this.pinSent) return;
    this.pinSent = id;
    try {
      await api("/api/profiles/default", { method: "PUT", body: JSON.stringify({ id }) });
      this.defaultId = id;
      this.syncChrome();
    } catch (e) {
      this.pinSent = "";
      console.warn("zoto-viz profiles:", e);
    }
  }

  /** Create or load the profile named after `model`. Creates only when the model is online. */
  async activateAiCycle(seed: ProfileSettings, opts: { model: string; online: boolean }): Promise<"live" | "saved" | "none"> {
    const model = opts.model.trim() || "gemma4";
    const id = agentProfileId(model);
    const prev = this.current && !this.isAgent()
      ? this.current
      : (localStorage.getItem(AI_PREV_KEY) || this.defaultId || USER_ID);
    if (prev && !this.isAgent(prev)) localStorage.setItem(AI_PREV_KEY, prev);
    const has = (pid: string) => this.list.some((p) => p.id === pid);
    const existing = has(id) ? id : (has(AI_ID) ? AI_ID : "");

    if (!opts.online) {
      if (!existing) {
        flash(this.bar, `Agent backend is offline — no saved profile for ${model}.`);
        return "none";
      }
      if (!this.available) {
        this.current = existing;
        this.dirty = false;
        this.sel.value = existing;
        this.syncChrome();
        return "saved";
      }
      await this.flushPending();
      await this.load(existing);
      return "saved";
    }

    const settings = aiCycleSettings(seed);
    if (!this.available) {
      this.current = id;
      this.dirty = false;
      quiet(() => this.host.apply(settings));
      this.adoptAutosave(false);
      this.syncChrome();
      return "live";
    }
    await this.flushPending();
    if (!has(id) && has(AI_ID) && id !== AI_ID) {
      const raw = await api<{ settings: unknown }>(`/api/profiles/${AI_ID}`);
      const loaded = normalizeSettings(raw.settings);
      await api("/api/profiles", {
        method: "POST",
        body: JSON.stringify({
          id,
          label: model,
          model,
          // #275: a newer blob is copied unchanged, so its v and unknown fields survive the rename.
          settings: loaded.newer ? raw.settings : storedSettings(loaded),
          make_default: this.defaultId === AI_ID,
        }),
      });
      await api(`/api/profiles/${AI_ID}`, { method: "DELETE" });
      if (loaded.newer) this.newer.add(id);
      this.ingest(await api<ProfileList>("/api/profiles"));
      await this.load(id);
      return "live";
    }
    if (has(id)) {
      const meta = this.meta(id);
      if (meta && (meta.model !== model || meta.label !== model)) {
        const raw = await api<{ settings: unknown }>(`/api/profiles/${id}`);
        await api(`/api/profiles/${id}`, {
          method: "PUT",
          body: JSON.stringify({ settings: raw.settings, label: model, model }),
        });
        this.ingest(await api<ProfileList>("/api/profiles"));
      }
      await this.load(id);
      return "live";
    }
    await api("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ id, label: model, model, settings: storedSettings(settings), make_default: false }),
    });
    this.ingest(await api<ProfileList>("/api/profiles"));
    this.current = id;
    this.dirty = false;
    this.sel.value = id;
    quiet(() => this.host.apply(settings));
    this.adoptAutosave(true);
    this.syncChrome();
    this.keepHomeAi(settings.ai);
    return "live";
  }

  /** Write live settings into the model-named profile when it already exists. Never creates. */
  async writeAi(settings: ProfileSettings, model = ""): Promise<void> {
    const next: ProfileSettings = { ...settings, autosave: true };
    if (!this.available) return;
    const tag = model.trim();
    const slug = tag ? agentProfileId(tag) : "";
    // Only the profile whose id is this model. A different agent profile
    // (for example gemma4 while Cursor is on Grok) must keep its own name.
    const id = slug && (this.list.some((p) => p.id === slug) || this.current === slug)
      ? (this.list.some((p) => p.id === slug) ? slug : this.current)
      : "";
    if (!id || this.meta(id)?.shipped || this.newer.has(id)) return;
    const label = tag || this.meta(id)?.model || this.meta(id)?.label || id;
    const body: Record<string, unknown> = { settings: storedSettings(next), label };
    if (tag) body.model = tag;
    else if (this.meta(id)?.model) body.model = this.meta(id)!.model;
    await api(`/api/profiles/${id}`, { method: "PUT", body: JSON.stringify(body) });
    if (this.legacyId === id) this.legacyId = "";
    this.keepHomeAi(next.ai);
    if (this.current === id) {
      this.dirty = false;
      this.adoptAutosave(true);
      this.syncChrome();
    }
  }

  /** Leave the agent profile for the profile that was current before the header toggle. */
  async deactivateAiCycle(): Promise<void> {
    const prev = localStorage.getItem(AI_PREV_KEY) || this.defaultId || USER_ID;
    const id = this.isAgent(prev) ? USER_ID : prev;
    if (!this.available) {
      this.current = this.isAgent(id) ? USER_ID : id;
      quiet(() => this.host.apply(shippedSettings()));
      this.adoptAutosave(false);
      this.syncChrome();
      return;
    }
    await this.flushPending();
    const target = this.list.some((p) => p.id === id) ? id : (this.list.some((p) => p.id === USER_ID) ? USER_ID : SHIPPED_ID);
    await this.load(target, { quiet: true });
  }

  private scheduleSave(): void {
    this.clearTimer();
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      void this.writeNow();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private clearTimer(): void {
    if (!this.saveTimer) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
  }

  private async flushPending(): Promise<void> {
    if (!this.saveTimer) return;
    this.clearTimer();
    await this.writeNow();
  }

  private async writeNow(): Promise<boolean> {
    if (this.shipped || this.newerProfile || !this.current || !this.available) return false;
    const gen = ++this.saveGen;
    const settings = this.host.collect();
    const target = this.current;
    try {
      await api(`/api/profiles/${target}`, {
        method: "PUT",
        body: JSON.stringify({ settings: storedSettings(settings) }),
      });
      if (this.legacyId === target) this.legacyId = "";
      this.keepHomeAi(settings.ai);
      if (gen !== this.saveGen) return true;
      this.dirty = false;
      this.syncChrome();
      return true;
    } catch (e) {
      if (gen !== this.saveGen) return false;
      this.dirty = true;
      this.syncChrome();
      flash(this.bar, String(e));
      return false;
    }
  }

  private async confirmSave(): Promise<void> {
    if (this.shipped) { await this.saveAsNew(true); return; }
    const ok = await ask({
      title: "Save profile",
      body: `Write the current settings to profile “${this.current}” in ${this.file || "~/.zoto-viz/profiles.yml"}?`,
      actions: [
        { id: "save", label: "Save", kind: "primary" },
        { id: "cancel", label: "Cancel" },
      ],
    });
    if (ok?.id === "save") await this.saveCurrent();
  }

  private async saveCurrent(): Promise<boolean> {
    if (this.shipped) return this.saveAsNew(true);
    this.clearTimer();
    const ok = await this.writeNow();
    if (!ok) {
      await ask({ title: "Could not save", body: this.bar.querySelector(".msg")?.textContent || "write failed", actions: [{ id: "ok", label: "OK", kind: "primary" }] });
    }
    return ok;
  }

  private async saveAsNew(makeDefault: boolean): Promise<boolean> {
    this.clearTimer();
    const taken = this.list.map((p) => p.id);
    const suggested = suggestId(taken);
    const result = await ask({
      title: this.shipped ? "Shipped profile is read-only" : "Save as new profile",
      body: this.shipped
        ? `“${SHIPPED_LABEL}” cannot be edited. Save these settings as a new profile? It becomes the startup default.`
        : "Create a new profile from the current settings.",
      fields: [{ id: "name", label: "profile id", value: suggested, placeholder: "my-lan" }],
      actions: [
        { id: "save", label: makeDefault ? "Save as default" : "Save", kind: "primary" },
        { id: "cancel", label: "Cancel" },
      ],
    });
    if (result?.id !== "save") return false;
    const id = (result.values?.name ?? "").trim().toLowerCase();
    if (!ID_RE.test(id)) {
      await ask({ title: "Invalid id", body: "Use a slug: start with a letter, then letters, digits, _ or -.", actions: [{ id: "ok", label: "OK", kind: "primary" }] });
      return false;
    }
    if (isShippedId(id)) {
      await ask({ title: "Reserved", body: `${SHIPPED_LABEL} is the shipped default.`, actions: [{ id: "ok", label: "OK", kind: "primary" }] });
      return false;
    }
    try {
      await api("/api/profiles", {
        method: "POST",
        body: JSON.stringify({ id, label: id, settings: storedSettings({ ...this.host.collect(), autosave: true }), make_default: makeDefault }),
      });
      const data = await api<ProfileList>("/api/profiles");
      this.ingest(data);
      this.current = id;
      this.dirty = false;
      this.sel.value = id;
      this.adoptAutosave(true);
      this.syncChrome();
      return true;
    } catch (e) {
      await ask({ title: "Could not save", body: String(e), actions: [{ id: "ok", label: "OK", kind: "primary" }] });
      return false;
    }
  }

  private async discard(): Promise<void> {
    if (!this.current) return;
    try {
      await this.load(this.current);
    } catch (e) {
      flash(this.bar, String(e));
    }
  }

  private async setDefault(id: string): Promise<void> {
    if (!id) return;
    try {
      await api("/api/profiles/default", { method: "PUT", body: JSON.stringify({ id }) });
      this.defaultId = id;
      this.syncChrome();
    } catch (e) {
      await ask({ title: "Could not set default", body: String(e), actions: [{ id: "ok", label: "OK", kind: "primary" }] });
    }
  }

  private async remove(): Promise<void> {
    if (this.shipped) return;
    const ok = await ask({
      title: "Delete profile",
      body: `Delete profile “${this.current}”? The shipped ${SHIPPED_LABEL} profile is kept.`,
      actions: [
        { id: "delete", label: "Delete", kind: "danger" },
        { id: "cancel", label: "Cancel" },
      ],
    });
    if (ok?.id !== "delete") return;
    try {
      const res = await api<{ default: string }>(`/api/profiles/${this.current}`, { method: "DELETE" });
      const data = await api<ProfileList>("/api/profiles");
      this.ingest(data);
      await this.load(res.default || SHIPPED_ID, { quiet: true });
    } catch (e) {
      await ask({ title: "Could not delete", body: String(e), actions: [{ id: "ok", label: "OK", kind: "primary" }] });
    }
  }

  private ingest(data: ProfileList): void {
    this.list = data.profiles;
    this.defaultId = data.default;
    this.file = data.file;
    this.sel.setOptions(this.list.map((p) => this.optionOf(p)));
  }

  private optionOf(p: ProfileMeta): { value: string; label: string; hint?: string } {
    const hint = [
      p.shipped ? "shipped" : "",
      isAgentProfile(p) ? "agent" : "",
      p.id === this.defaultId ? "startup" : "",
      p.id === this.current && this.canAutosave ? "autosave" : "",
      p.id === this.current && this.dirty ? "unsaved" : "",
    ].filter(Boolean).join(" · ") || undefined;
    return { value: p.id, label: p.shipped ? SHIPPED_LABEL : p.label, hint };
  }

  private headerLabel(): string {
    const p = this.meta();
    if (!p) return this.current;
    return p.shipped ? SHIPPED_LABEL : (p.label || p.id);
  }

  private syncChrome(): void {
    const brand = document.getElementById("brandProfile");
    if (brand) {
      const suffix = headerBrandProfile(this.headerLabel());
      brand.textContent = suffix;
      brand.hidden = !suffix;
    }
    this.sel.setOptions(this.list.map((p) => this.optionOf(p)));
    this.sel.value = this.current || this.list[0]?.id || "";
    this.sel.el.classList.toggle("dirty", this.dirty);
    this.sel.el.classList.toggle("shipped", this.shipped);
    this.defaultBtn.disabled = !this.available || !this.current || this.current === this.defaultId;
    this.deleteBtn.disabled = !this.available || this.shipped || this.list.filter((p) => !p.shipped).length === 0;
    this.saveAsBtn.hidden = false;

    if (!this.available) {
      this.bar.hidden = false;
      this.noticeId = "";
      this.status.textContent = "Profiles file unavailable — settings stay in this browser until the monitor can write ~/.zoto-viz/profiles.yml.";
      this.saveBtn.hidden = true;
      this.discardBtn.hidden = true;
      this.saveAsBtn.hidden = true;
      return;
    }
    if (this.newerProfile) {
      this.bar.hidden = false;
      // #256: once per load of the profile; re-renders and reloads of it leave the line alone.
      if (this.noticeId !== this.current) {
        this.status.textContent = NEWER_PROFILE_NOTICE;
        this.noticeId = this.current;
      }
      const active = document.activeElement;
      const refocus = active === this.saveBtn || active === this.discardBtn;
      this.saveBtn.hidden = true;
      this.discardBtn.hidden = true;
      if (refocus) this.saveAsBtn.focus();
      return;
    }
    const workingId = workingProfileId(this.defaultId, this.list.map((p) => p.id));
    // #275: the edit stays on the shipped profile, but the working profile is the newer one.
    const newerWorking = this.shipped && this.dirty && this.newer.has(workingId);
    if (!newerWorking) this.noticeId = "";
    this.saveBtn.hidden = false;
    this.discardBtn.hidden = false;
    if (!this.dirty) {
      this.bar.hidden = true;
      this.status.textContent = "";
      return;
    }
    this.bar.hidden = false;
    if (this.shipped) {
      if (newerWorking) {
        if (this.noticeId !== workingId) {
          this.status.textContent = NEWER_PROFILE_NOTICE;
          this.noticeId = workingId;
        }
      } else {
        this.status.textContent = `Shipped “${SHIPPED_LABEL}” cannot be edited. Save as a new profile to keep these settings (it becomes the startup default).`;
      }
      this.saveBtn.hidden = true;
      this.saveAsBtn.hidden = false;
    } else {
      this.status.textContent = `Unsaved changes to profile “${this.current}”.`;
      this.saveBtn.hidden = false;
    }
  }
}

function btn(label: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn small";
  b.textContent = label;
  b.title = title;
  return b;
}

function flash(bar: HTMLElement, msg: string): void {
  bar.hidden = false;
  const el = bar.querySelector(".msg");
  if (el) el.textContent = msg;
}

interface AskAction { id: string; label: string; kind?: "primary" | "danger" | "ghost" }
interface AskField { id: string; label: string; value?: string; placeholder?: string }
interface AskResult { id: string; values: Record<string, string> }

function ask(opts: { title: string; body: string; fields?: AskField[]; actions: AskAction[] }): Promise<AskResult | null> {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "modal ask";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const back = document.createElement("div");
    back.className = "backdrop";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    const head = document.createElement("div");
    head.className = "mhead";
    const h = document.createElement("strong");
    h.textContent = opts.title;
    head.appendChild(h);
    const body = document.createElement("div");
    body.className = "ask-body";
    const p = document.createElement("p");
    p.textContent = opts.body;
    body.appendChild(p);
    const fields = new Map<string, HTMLInputElement>();
    for (const f of opts.fields ?? []) {
      const lab = document.createElement("label");
      lab.className = "ask-field";
      const cap = document.createElement("span");
      cap.className = "cap";
      cap.textContent = f.label;
      const input = document.createElement("input");
      input.type = "text";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.value = f.value ?? "";
      if (f.placeholder) input.placeholder = f.placeholder;
      lab.append(cap, input);
      body.appendChild(lab);
      fields.set(f.id, input);
    }
    const row = document.createElement("div");
    row.className = "ask-actions";
    const finish = (id: string | null) => {
      document.body.classList.remove("modal-open");
      modal.remove();
      document.removeEventListener("keydown", onKey, true);
      if (id === null) { resolve(null); return; }
      const values: Record<string, string> = {};
      for (const [k, input] of fields) values[k] = input.value;
      resolve({ id, values });
    };
    for (const a of opts.actions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn${a.kind === "primary" ? " primary" : a.kind === "danger" ? " danger" : ""}`;
      b.textContent = a.label;
      b.addEventListener("click", () => finish(a.id));
      row.appendChild(b);
    }
    sheet.append(head, body, row);
    modal.append(back, sheet);
    back.addEventListener("click", () => finish("cancel"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish("cancel"); }
      if (e.key === "Enter" && fields.size) {
        e.preventDefault();
        finish(opts.actions.find((a) => a.kind === "primary")?.id ?? opts.actions[0]!.id);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("modal-open");
    document.body.appendChild(modal);
    const first = opts.fields?.[0] && fields.get(opts.fields[0].id);
    (first ?? row.querySelector("button.primary") ?? row.querySelector("button"))?.focus();
  });
}
