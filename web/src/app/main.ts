import { AUDIO_DRIVES, NetScene, escapeHtml, type DreamAnim, type Filters } from "../graph/scene";
import { Panel } from "../ui/panel";
import { allModes, arcadeSlotFor, defaultCatalogMode, defaultOpts, graphModes, modeById, type ViewMode } from "../core/modes";
import { ago, fmtBytes, type Device, type LinkStatus, type StateMsg } from "../core/types";
import { collapseByName } from "../core/collapse";
import { rCidr, rIp, rMac, redaction } from "../core/redact";
import { THEMES, alignThemeToColor, applyThemeChrome, themeById, themePickerGroup, themeSwatch, type Theme } from "../core/themes";
import { mountDiceSplit, morphCopy, Select, Toggle } from "../ui/ui";
import { Settings, makeViewCogButton } from "../ui/settings";
import { illustratedSourceBind, parseSourceBind, sourceHeadlines } from "../core/sources";
import { bindSourceOf, viewAuthBlock, type AuthCtx } from "../core/auth-setup";
import { LiveFeed, feedViewShift } from "../ui/feed";
import { ChatPanel } from "../ui/chat";
import { DebugLog, readDebugOn } from "../ui/debug-log";
import { liveCam } from "../camera/livecam";
import { liveMic } from "../audio/want";
import { liveSound } from "../audio/sound";
import { PluginSfx, setBackroomsSampleRev } from "../audio/plugin-sfx";
import {
  backroomsOptions as backroomsOptionsNow,
  backroomsSlots,
  parseBackroomsOptions,
  setBackroomsOptions,
} from "../../../plugins/src/backrooms/frontend/director";
import { ProfileStore, aiCycleSettings, quiet, SHIPPED_ID, type ProfileSettings } from "../core/profiles";
import { readSessionLive, writeSessionLive } from "../core/session-live";
import { diceLookForRoll, shuffleLook } from "../core/shuffle";
import { cycleSkyPool } from "../graph/backdrop";
import { PongView } from "../arcade/pong";
import { InvadersView } from "../arcade/invaders";
import { CommandView } from "../arcade/command";
import { FroggerView } from "../arcade/frogger";
import { CpuPongView } from "../arcade/cpupong";
import { DoomView } from "../arcade/doom";
import { WavesView } from "../arcade/waves";
import { OrbitsView } from "../arcade/orbits";
import { HelixView } from "../arcade/helix";
import { SkylineView } from "../arcade/skyline";
import { PacmanView } from "../arcade/pacman";
import { TetrisView } from "../arcade/tetris";
import { PortalView } from "../arcade/portal";
import { CarouselView } from "../arcade/carousel";
import { spawnArcade } from "../arcade/spawn";
import { Mosaic } from "../graph/mosaic";
import { RenderHost } from "../graph/render-host";
import {
  applyPluginConfigs,
  collectPluginConfigs,
  fetchPlugins,
  grantPluginConsent,
  installPlugins,
  loadPluginConfig,
  lookForMode,
  mergeLook,
  parsePluginId,
  parsePluginInstance,
  pluginWall,
  pickPluginSkySpec,
  catalogPluginWalls,
  attachPluginFrontend,
  fetchPluginSky,
  pluginHasFrontend,
  pluginNeedsReview,
  pluginViewId,
  viewSelectOptions,
  writePluginConfig,
  configStoreId,
  type PluginView,
} from "../plugins/plugin";
import { resolvePluginWall, type WallSnap } from "../plugins/plugin-wall";
import { askPluginReview } from "../plugins/plugin-ui";
import { vizContractFor } from "../plugins/plugin";
import {
  VizBufferWriter, VizFrameBudget, VIZ_FRAME_BUDGET_MS, bindVizWriterCore, buildVizFrame,
  buildVizFrameForPlugin, defaultVizContract,
} from "../plugins/viz-host";
import {
  TypeSafeHost,
  parseTypeSafeEnable,
  pluginHasTypeSafe,
  setTypeSafeProxyConfigured,
} from "../plugins/typesafe-host";
import { runPackFrameHandler } from "../plugins/viz-pack-host";
import {
  easeStereoBins, STEREO_BINS, packStereoDrive, parseStereoTiming, stepStereoClock, stereoRate,
} from "../../../plugins/src/stereo-gram/frontend/drive";
import { buildStereoFrame, STEREO_FRAME_SLOTS } from "../../../plugins/src/stereo-gram/frontend/frame";
import { stereoAiFrame } from "../plugins/stereo-ai";
import { FeedTitleCube } from "../plugins/feed-title-cube";
import { NestCamsLive } from "../plugins/nest-cams-live";
import { parseHnRainLook } from "../../../plugins/src/hn-rain/frontend/crawl";
import { applyInstance } from "../plugins/instances";
import { pluginViewKnobs, VIEW_PROMPT_KEY } from "../plugins/plugin-visualisation";
import { ignoreResizeLoopError, observeResize } from "../core/resize";
import { bootSession, apiFetch } from "../core/http";
import { addPresentListener } from "../core/fps";
import { markPresent, presentInterval } from "../core/present-clock";
import { AgentPanel, aiMosaicLayoutOn, CYCLE_KEY, type AgentLookInput } from "../ui/agent";
import { invalidateSkyRecipe, setSkyPrompt } from "../graph/sky-ai";
import { compileAgentSky } from "../graph/sky-agent";
import { normalizeAgentLook, type AgentLook, type DecoAt } from "../graph/deco";
import { isNasaStillDeco, isNasaStillUrl } from "../core/nasa-stills";
import { PluginSandbox, consentHash, hashConsented, tsPluginsAllowed } from "../plugins/host";
import { autoconsentEligible, autoconsentEnabled, autoconsentKind, setAutoconsent } from "../plugins/consent";
import { captureHud, mergeAgentPatch, packView, pickAgentSettings, stripMosaicLayout } from "../ui/capture";
import { pluginIdleOf, withGoldenIfIdle } from "../plugins/fixtures/golden-state";
import { mosaicTileViewId, mosaicWallUsesView, parseMosaicSlotId } from "../graph/mosaic-tile-id";
import { hostModeById } from "./host-mode";
import { applySharedMosaicPluginConfig } from "./shared-mosaic-plugin-config";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";
import {
  deliverCoalescedMosaicPacks,
} from "../graph/mosaic-pack-coalesce";
import { VizHud, isVizDemoPack, normalizeVizDemoPackId, type VizDemoPackId } from "../ui/viz-hud";

ignoreResizeLoopError();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type ChromePos = "top" | "left" | "right";
const CHROME_OPTS: { value: ChromePos; label: string; hint: string }[] = [
  { value: "top", label: "top", hint: "header across the top" },
  { value: "left", label: "left", hint: "wide bar on the left; inspect panel stays on the right" },
  { value: "right", label: "right", hint: "wide bar on the right; inspect panel moves to the left" },
];
const parseChrome = (raw: string | null | undefined): ChromePos =>
  raw === "left" || raw === "right" ? raw : "top";
let chrome: ChromePos = parseChrome(localStorage.getItem("zoto-viz.chrome"));
let userChrome: ChromePos = chrome;
document.body.dataset.chrome = chrome;

// one-time migration: netviz.* and z-netviz.* → zoto-viz.*
for (const k of Object.keys(localStorage)) {
  let nk: string | null = null;
  if (k.startsWith("z-netviz.")) nk = `zoto-viz.${k.slice("z-netviz.".length)}`;
  else if (k.startsWith("netviz.")) nk = `zoto-viz.${k.slice("netviz.".length)}`;
  if (!nk || nk === k) continue;
  if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k)!);
  localStorage.removeItem(k);
}

// ---------------------------------------------------------------- theme (before the scene so its first frame is right)

let theme: Theme = themeById(localStorage.getItem("zoto-viz.theme"));
applyThemeChrome(theme);

// one WebGL context for the whole wall: the main graph and every mosaic tile draw through it
const renderHost = new RenderHost($("wall"));
if (renderHost.software) document.body.dataset.softgl = "";
const scene = new NetScene($("scene"), { host: renderHost });
const panel = new Panel($("panel"), scene);
let selectedIp: string | null = null; // the graph selection becomes the arcade views' source / device when one is entered
scene.onSelect = (d) => { selectedIp = d?.ip ?? null; panel.show(d); persistLive(); };
scene.setTheme(theme);

/** the standalone (arcade) views, by mode id; each owns a canvas in its own full-screen container */
interface Standalone {
  controls: HTMLElement[];
  start(preferIp?: string | null): void;
  stop(): void;
  update(m: StateMsg): void;
  setTheme(t: Theme): void;
  setTicker?(lines: string[]): void;
}
const arcade: Record<string, { view: Standalone; el: HTMLElement }> = {
  netpong: { view: new PongView($("pong"), scene), el: $("pong") },
  invaders: { view: new InvadersView($("invaders"), scene), el: $("invaders") },
  command: { view: new CommandView($("command"), scene), el: $("command") },
  frogger: { view: new FroggerView($("frogger"), scene), el: $("frogger") },
  cpupong: { view: new CpuPongView($("cpupong"), scene), el: $("cpupong") },
  doom: { view: new DoomView($("doom"), scene), el: $("doom") },
  waves: { view: new WavesView($("waves"), scene), el: $("waves") },
  orbits: { view: new OrbitsView($("orbits"), scene), el: $("orbits") },
  helix: { view: new HelixView($("helix"), scene), el: $("helix") },
  skyline: { view: new SkylineView($("skyline"), scene), el: $("skyline") },
  pacman: { view: new PacmanView($("pacman"), scene), el: $("pacman") },
  tetris: { view: new TetrisView($("tetris"), scene), el: $("tetris") },
  portal: { view: new PortalView($("portal"), scene), el: $("portal") },
  carousel: { view: new CarouselView($("carousel"), scene), el: $("carousel") },
};
for (const a of Object.values(arcade)) a.view.setTheme(theme);
let activeArcade: string | null = null;
(window as unknown as { zotoviz: NetScene; znetviz: NetScene }).zotoviz = scene;
(window as unknown as { znetviz: NetScene }).znetviz = scene; // one-release alias
let mosaic: Mosaic | null = null;
let lastRaw: StateMsg | null = null;
let typeSafeKeyOn = false;

const themeSel = new Select({
  id: "theme",
  caption: "theme",
  title: "colour theme (key T cycles)",
  filterable: true,
  options: THEMES.map((t) => ({
    value: t.id, label: t.label, hint: t.hint, swatch: themeSwatch(t),
    group: themePickerGroup(t),
  })),
  value: theme.id,
  onChange: (id) => applyTheme(id, true),
});

const chromeSel = new Select({
  id: "chrome",
  caption: "chrome",
  title: "where the menus sit: top header, or a wide left/right bar (the other side holds the inspect panel)",
  options: CHROME_OPTS,
  value: chrome,
  onChange: (id) => applyChrome(parseChrome(id)),
});

let profiles: ProfileStore | null = null;
/** settings cog / chrome exist; persistLive also waits for liveReady so boot does not clobber the snapshot */
let uiReady = false;
let liveReady = false;
let persistLiveTimer = 0;
function persistLive(immediate = false): void {
  if (!uiReady || !liveReady || !profiles) return;
  const write = () => {
    persistLiveTimer = 0;
    writeSessionLive({
      profileId: profiles!.current,
      dirty: profiles!.dirty,
      settings: collectSettings(),
      selected: scene.selectedIp,
      aiCycle: agent.cycleOn,
    });
  };
  if (immediate) {
    if (persistLiveTimer) window.clearTimeout(persistLiveTimer);
    write();
    return;
  }
  if (persistLiveTimer) return;
  persistLiveTimer = window.setTimeout(write, 80);
}
const touch = () => { profiles?.touch(); persistLive(); };

const profileSel = new Select({
  id: "profile",
  caption: "profile",
  title: "settings profile (~/.zoto-viz/profiles.yml); zoto viz is the shipped default",
  options: [{ value: SHIPPED_ID, label: "zoto viz", hint: "shipped" }],
  value: SHIPPED_ID,
  onChange: (id) => { void profiles?.select(id); },
});

const dreamToggle = new Toggle({
  id: "dream",
  label: "dream",
  title: "slowly orbit, nod, and zoom toward busy nodes (key D); speeds are in the settings cog",
  checked: localStorage.getItem("zoto-viz.dream") === "1",
  onChange: (on) => setDream(on),
});
const dreamCog = new Toggle({
  id: "dream-cog",
  label: "dream camera",
  title: "slowly orbit, nod, and zoom toward busy nodes (key D)",
  checked: localStorage.getItem("zoto-viz.dream") === "1",
  onChange: (on) => setDream(on),
});
$("dreamBox").appendChild(dreamToggle.el);
function setDream(on: boolean): void {
  dreamToggle.checked = on;
  dreamCog.checked = on;
  localStorage.setItem("zoto-viz.dream", on ? "1" : "0");
  if (mosaic) mosaic.eachGraph((s) => s.setDream(on));
  else scene.setDream(on);
  touch();
}
setDream(dreamToggle.checked);

let themeFollow: (t: Theme) => void = () => {};

/** Paint chrome + scene from a palette without writing the selected theme id. */
function paintLiveTheme(t: Theme, fade = false): void {
  applyThemeChrome(t);
  scene.setTheme(t, fade);
  if (mosaic?.on) mosaic.setTheme(t, fade);
  else for (const a of Object.values(arcade)) a.view.setTheme(t);
  themeFollow(t);
  renderLegend(scene.currentMode, currentOpts);
}

/** Selected theme, optionally hue-shifted toward the webcam's current main colour. */
function paintedTheme(base: Theme): Theme {
  const hex = scene.liveCamColor;
  if (scene.dreamAnim.camTheme && hex != null) return alignThemeToColor(base, hex);
  return base;
}

function applyTheme(id: string, fade = false, persist = true): void {
  theme = themeById(id);
  paintLiveTheme(paintedTheme(theme), fade);
  if (!persist) {
    persistLive();
    return;
  }
  themeSel.value = theme.id;
  localStorage.setItem("zoto-viz.theme", theme.id);
  touch();
}

/** Keep plugin sky / stage-only pins even while AI cycle owns other views. */
function pinViewLook(): boolean {
  if (!agent.cycleOn) return true;
  const m = modeById(modeSel.value);
  if (m.stageOnly || m.kind === "demo") return true;
  const look = lookForMode(modeSel.value);
  return look?.backdrop === "plugin" || !!look?.stageOnly;
}

/** Pin theme / sky / floor / modulation from the active view's plugin YAML without writing the profile.
 *  Header AI cycling owns Dynamic sky and cadence look, except on plugin-owned stage views. */
function applyViewLook(): void {
  if (!uiReady) return;
  const pin = pinViewLook();
  if (mosaic?.on) {
    mosaic.applyLooks(settings.animSettings, pin);
    mosaic.setTheme(scene.currentTheme);
    applyChrome(userChrome, false);
    const m = modeById(modeSel.value);
    const spec = m.pluginId ? pluginSpecs.find((p) => p.id === m.pluginId) ?? null : null;
    void syncPluginSky(skySpecForMode(m.id, spec));
    return;
  }
  const look = pin ? lookForMode(modeSel.value) : undefined;
  scene.setAnim(mergeLook(settings.animSettings, look));
  const m = modeById(modeSel.value);
  const spec = m.pluginId ? pluginSpecs.find((p) => p.id === m.pluginId) ?? null : null;
  void syncPluginSky(skySpecForMode(m.id, spec));
  const want = look?.theme ?? theme.id;
  if (theme.id !== want) applyTheme(want, !!look?.theme, false);
  applyChrome(look?.chrome ?? userChrome, false);
}

function cycleRandomTheme(): void {
  const pool = THEMES.filter((t) => t.id !== theme.id);
  if (!pool.length) return;
  applyTheme(pool[Math.floor(Math.random() * pool.length)]!.id, true);
}

// ---------------------------------------------------------------- view modes

let currentOpts: Record<string, string> = {};
let pluginSpecs: PluginView[] = [];
let settings!: Settings;
const sandbox = new PluginSandbox();
const pluginSfx = new PluginSfx();
let vizWriter: VizBufferWriter | null = null;
let vizFrameTs = 0;
const vizBudget = new VizFrameBudget();
const typesafeHost = new TypeSafeHost();
let preserveVizUbo = false;
const vizHud = new VizHud($("scene"), (packId) => swapVizPack(packId));
addPresentListener((ts) => {
  const mode = modeById(modeSel.value);
  const packId = normalizeVizDemoPackId(mode.pluginId ?? tsWatchId);
  if (packId) vizBudget.markPresent(ts);
  if (mode.pluginId === "backrooms") {
    const br = backroomsViewOptions();
    pluginSfx.setMasterVolume(br.volume);
    pluginSfx.setBackrooms(scene.skyTime());
  } else pluginSfx.silence();
});
addPresentListener(markPresent);
let brOptsSrc: Record<string, string> | null = null;
let brOptsJson = "";
/** Backrooms view config (UI sliders / toggles, MCP set_plugin) → director options, re-parsed only when they change. */
function backroomsViewOptions(): ReturnType<typeof parseBackroomsOptions> {
  if (brOptsSrc !== currentOpts) {
    brOptsSrc = currentOpts;
    const json = JSON.stringify(currentOpts);
    if (json !== brOptsJson) {
      brOptsJson = json;
      setBackroomsOptions(parseBackroomsOptions(currentOpts));
    }
  }
  return backroomsOptionsNow();
}
let stereoBins: number[] = [];
let stereoBinsAt = 0;
scene.afterLook = () => {
  const mode = modeById(modeSel.value);
  if (mode.pluginId === "backrooms" && vizWriter) {
    // The director owns camera, creature and maze on the sky clock; the sound bed reads the same track.
    backroomsViewOptions();
    scene.setHeard(false);
    const drive = backroomsSlots(scene.skyTime(), new Date(), innerWidth / Math.max(1, innerHeight));
    vizWriter.writeBuffer(0, drive.slot0);
    vizWriter.writeBuffer(1, drive.slot1);
    scene.setPluginUboBuffer(vizWriter.ubo);
    return;
  }
  if (mode.pluginId !== "stereo-gram" || !vizWriter) {
    scene.setHeard(false);
    return;
  }
  const opts = optsFor(mode);
  const timing = parseStereoTiming(opts);
  scene.setHeard(timing.audio);
  const aiWanted = timing.ai && agent.cycleOn;
  const bands = aiWanted ? STEREO_BINS : timing.rack.solids;
  const heard = timing.audio ? scene.heardSpectrum(bands) : { level: 0, spectrum: [] as number[] };
  const now = performance.now();
  const dt = stereoBinsAt ? Math.min(0.1, (now - stereoBinsAt) / 1000) : 0;
  stereoBins = easeStereoBins(stereoBins.length === bands ? stereoBins : [], heard.spectrum, dt, timing.rack.rise, timing.rack.fall);
  stereoBinsAt = now;
  const clock = stepStereoClock(now / 1000, stereoRate(timing, heard.level));
  const ai = aiWanted
    ? stereoAiFrame({ audio: timing.audio, prompt: opts[VIEW_PROMPT_KEY] ?? "", morphMs: timing.morph * 1000 }, now, clock)
    : null;
  const talkers = (lastState?.devices ?? []).map((d) => ({ rate: d.packets }));
  const drive = packStereoDrive(talkers, timing, { clock, level: heard.level, bins: stereoBins, scene: ai?.head });
  vizWriter.writeBuffer(0, drive);
  // The sky only draws; the scene is built here once per frame.
  const frame = buildStereoFrame({ timing, clock, act: drive[0]!, level: heard.level, bins: stereoBins, ai });
  for (let s = 0; s < STEREO_FRAME_SLOTS; s++) vizWriter.writeBuffer(1 + s, frame.subarray(s * 64, (s + 1) * 64));
  scene.setPluginUboBuffer(vizWriter.ubo);
};
function bindVizWriter(spec: PluginView | null, preserveUbo = false): void {
  const contract = vizContractFor(spec) ?? (spec?.capabilities?.some((c) => c === "viz.write")
    ? defaultVizContract() : undefined);
  const { writer, resetFrameTs, resetBudget } = bindVizWriterCore(vizWriter, contract, preserveUbo);
  vizWriter = writer;
  if (resetFrameTs) vizFrameTs = 0;
  if (resetBudget) {
    vizBudget.reset();
    vizHud.resetSkipBaseline();
  }
  if (writer && preserveUbo && !resetFrameTs) scene.setPluginUboBuffer(writer.ubo);
}
function swapVizPack(packId: VizDemoPackId): void {
  if (modeById(pluginViewId(packId)).id === modeSel.value) return;
  preserveVizUbo = true;
  applyMode(pluginViewId(packId));
}
sandbox.handlers = {
  setStyle: (s) => scene.setPluginStyle(s),
  setNodeColor: (id, hex) => scene.setPluginNodeColor(id, hex),
  writeBuffer: (slot, data) => {
    if (vizWriter?.writeBuffer(slot, data).ok) scene.setPluginUboBuffer(vizWriter.ubo);
  },
  writeUniform: (name, value) => {
    if (vizWriter?.writeUniform(name, value).ok) scene.setPluginUniform(name, value);
  },
  writeParticles: (data, stride) => { vizWriter?.writeParticles(data, stride); },
};
const agent = new AgentPanel();
const feedCtl: { feed: LiveFeed | null } = { feed: null };
let feedShiftInited = false;
function syncFeedShift(): void {
  if (!feedCtl.feed) return;
  const sceneEl = $("scene");
  const feedEl = $("livefeed");
  const chatEl = $("livechat");
  if (!sceneEl || !feedEl) return;
  const docked = [feedEl, chatEl].filter((el): el is HTMLElement =>
    !!el && !el.hidden && !el.classList.contains("floated"));
  const skip = !!mosaic?.on || !docked.length;
  const width = Math.max(0, ...docked.map((el) => el.offsetWidth));
  scene.setViewShift(skip ? 0 : feedViewShift(width, chrome, sceneEl.clientWidth), !feedShiftInited);
  feedShiftInited = true;
}

function syncOverlayStack(): void {
  const feedOn = !!feedCtl.feed && !$("livefeed")?.hidden;
  const chatOn = !$("livechat")?.hidden;
  document.body.classList.toggle("feed-open", feedOn);
  document.body.classList.toggle("chat-open", chatOn);
}
const modeSel = new Select({
  id: "mode",
  caption: "view",
  title: "view mode (keys 1–9, 0 for the 10th). Type to filter.",
  filterable: true,
  options: viewSelectOptions(),
  onChange: (id) => applyMode(id),
});
$("modeBox").append(modeSel.el);
const feedTitleCube = new FeedTitleCube($("wall"));
const nestCams = new NestCamsLive($("wall"));
nestCams.onSettings = (camId) => {
  bindThisView("plugin:nest-cams");
  settings.openView(camId);
};
nestCams.onChange = (patch) => {
  const spec = pluginSpecForMode("plugin:nest-cams");
  if (!spec) return;
  const fields = pluginViewKnobs(spec, spec.config);
  writePluginConfig(configStoreId(spec), { ...loadPluginConfig(spec, fields), ...patch });
  onPluginFields();
};

function settingsTargetModeId(): string {
  const focus = settings?.viewFocus?.trim();
  return focus || modeSel.value;
}

function onPluginFields(): void {
  const modeId = settingsTargetModeId();
  const m = hostModeById(modeId);
  const opts = optsFor(m);
  currentOpts = opts;
  setSkyPrompt(m.pluginId ?? m.id, opts[VIEW_PROMPT_KEY] ?? "");
  nestCams.setLook(opts);
  if (m.pluginId === "carousel") (arcade.carousel.view as CarouselView).setBind(opts);
  const spec = m.pluginId ? pluginSpecForMode(modeId) : null;
  if (mosaic?.on && !(m.pluginId && m.standalone)) {
    mosaic.graphScene(m.id)?.setMode(m, opts);
    if (spec) applySharedMosaicPluginConfig(mosaic, spec, opts, optsFor, hostModeById);
  } else scene.setMode(m, opts);
  renderLegend(m, opts);
<<<<<<< HEAD
=======
  const spec = pluginSpecForMode(m.id);
  if (!flags.skipSandboxPush && spec && pluginHasFrontend(spec)) {
    scheduleSandboxSetConfig(spec.id, sandboxPluginConfig(spec));
  }
  if (mosaic?.on && spec) {
    applySharedMosaicPluginConfig(mosaic, spec, opts, optsFor, hostModeById);
  }
  syncPluginHudForMode(m, spec, pluginHudCaptions, vizHud, mosaicHudOn());
  syncMosaicPluginHudCaptions();
  const cap = pluginHudCaptions.get(m.id);
  morphCopy($("hint"), cap ? `${spec?.name ?? m.label} · ${cap}` : m.hint);
>>>>>>> db53f7e (PR F: item 15 slot-keyed captions; main onPluginFields uses shared mosaic sync)
  void syncWifiWatch();
}

/**
 * The Air SSIDs rotation is a monitor-side setting (it writes the channel plan the root hopper follows), so the
 * Wi-Fi plugin's watch fields are pushed to /api/rf/watch whenever they may have changed: the active Wi-Fi view's
 * values win, otherwise the first Wi-Fi plugin's. Unchanged values are not re-sent.
 */
let wifiWatchSent = "";
async function syncWifiWatch(): Promise<void> {
  const active = modeById(modeSel.value);
  const spec = active.graphBase === "wifi" && active.pluginId
    ? pluginSpecs.find((p) => p.id === active.pluginId)
    : pluginSpecs.find((p) => p.base === "wifi");
  if (!spec) return;
  const o = optsFor(spec.id === active.pluginId ? active : modeById(pluginViewId(spec.id)));
  if (o.watch === undefined) return;
  const body = JSON.stringify({
    ssids: o.watch,
    other: o.other === "1",
    dwell: Number(o.dwell) || 60,
    rotate: o.rotate !== "0",
  });
  if (body === wifiWatchSent) return;
  wifiWatchSent = body;
  try {
    await apiFetch("/api/rf/watch", { method: "PUT", headers: { "content-type": "application/json" }, body });
  } catch {
    wifiWatchSent = ""; // try again on the next change
  }
}

function optsFor(m: ViewMode): Record<string, string> {
  const o = defaultOpts(m);
  if (m.pluginId) {
    const spec = pluginSpecForMode(m.id);
    if (spec) Object.assign(o, loadPluginConfig(spec, pluginViewKnobs({ ...spec, options: m.options, config: m.config }, m.config)));
  } else {
    for (const opt of m.options ?? []) {
      const saved = localStorage.getItem(`zoto-viz.mode.${m.id}.${opt.key}`);
      if (saved !== null && opt.values.some(([v]) => v === saved)) o[opt.key] = saved;
    }
  }
  return o;
}

function arcadeControls(m: ViewMode): HTMLElement[] {
  const slot = arcade[m.arcadeId ?? ""];
  return slot ? [...slot.view.controls] : [];
}

function bindThisView(modeId: string): void {
  const m = hostModeById(modeId);
  const spec = m.pluginId ? pluginSpecForMode(modeId) : null;
  settings?.bindView(
    spec ? { ...spec, options: m.options, config: m.config } : null,
    spec ? m.config : undefined,
    lookForMode(m.id) ?? spec?.look,
    arcadeControls(m),
  );
  paintViewAuth(m, spec);
}

let tsWatch = 0;
let tsWatchId = "";
let tsWatchHash = "";

async function ensureReviewed(spec: PluginView | null): Promise<boolean> {
  if (!spec || !pluginNeedsReview(spec)) return true;
  if (spec.consent) return true;
  if (autoconsentEnabled() && autoconsentEligible(spec)) {
    const kind = autoconsentKind(spec);
    try {
      await grantPluginConsent(spec.id, kind);
      spec.consent = kind;
      if (spec.hash) consentHash(spec.id, spec.hash);
      if (spec.has_sky_shader || spec.shader_sha256) spec.sky_available = true;
      return true;
    } catch (e) {
      console.warn("zoto-viz plugin autoconsent:", e);
      return false;
    }
  }
  const kind = await askPluginReview(spec);
  if (!kind) return false;
  try {
    await grantPluginConsent(spec.id, kind);
    spec.consent = kind;
    if (spec.hash) consentHash(spec.id, spec.hash);
    if (spec.has_sky_shader || spec.shader_sha256) spec.sky_available = true;
    return true;
  } catch (e) {
    console.warn("zoto-viz plugin consent:", e);
    return false;
  }
}

async function loadTsPlugin(spec: PluginView | null): Promise<void> {
  if (!pluginHasFrontend(spec) || !spec?.hash) {
    sandbox.unload();
    bindVizWriter(spec);
    scene.clearPluginStyle();
    tsWatchId = spec?.id ?? "";
    return;
  }
  if (!tsPluginsAllowed()) {
    sandbox.unload();
    bindVizWriter(spec);
    scene.clearPluginStyle();
    tsWatchId = spec?.id ?? "";
    return;
  }
  if (pluginNeedsReview(spec) && !spec.consent) {
    sandbox.unload();
    bindVizWriter(null);
    scene.clearPluginStyle();
    tsWatchId = "";
    return;
  }
  try {
    await attachPluginFrontend(sandbox, spec, loadPluginConfig(spec, spec.config));
    const preserve = preserveVizUbo && isVizDemoPack(tsWatchId) && isVizDemoPack(spec.id);
    preserveVizUbo = false;
    bindVizWriter(spec, preserve);
    tsWatchId = spec.id;
    tsWatchHash = spec.hash;
    const m = modeById(modeSel.value);
    if (m.pluginId === spec.id) {
      vizHud.setActive(spec.id, spec.name);
    }
    if (!tsWatch) tsWatch = window.setInterval(() => void refreshTsPlugin(), 2500);
  } catch (e) {
    console.warn("zoto-viz plugin runtime:", e);
    sandbox.unload();
    scene.clearPluginStyle();
  }
}

async function refreshTsPlugin(): Promise<void> {
  if (!tsWatchId || !tsPluginsAllowed()) return;
  try {
    const data = await fetchPlugins();
    const next = data.plugins.find((p) => p.id === tsWatchId);
    if (next?.hash && next.hash !== tsWatchHash) {
      const spec = pluginSpecs.find((p) => p.id === tsWatchId);
      if (spec) {
        spec.hash = next.hash;
        spec.capabilities = next.capabilities;
        spec.consent = next.consent ?? null;
        if (!(await ensureReviewed(spec))) return;
        await loadTsPlugin(spec);
      }
    }
  } catch { /* monitor down */ }
}

let skyLoaded = "";

let wallOwner: string | null = null;
let wallRestore: WallSnap | null = null;
/** Last mode applyMode committed — Select updates its value before onChange. */
let liveMode = "";

function applyPluginWall(modeId: string, flags: { keepLayout?: boolean; prevMode?: string }): void {
  if (!settings) return;
  const resolved = resolvePluginWall({
    modeId,
    prevModeId: flags.prevMode ?? liveMode,
    keepLayout: !!flags.keepLayout,
    anim: settings.animSettings,
    wall: pluginWall(lookForMode(modeId)),
    walls: catalogPluginWalls(),
    owner: wallOwner,
    restore: wallRestore,
  });
  wallOwner = resolved.state.owner;
  wallRestore = resolved.state.restore;
  if (resolved.anim) {
    settings.applyAnim({ ...settings.animSettings, ...resolved.anim });
    mosaic?.hydrate();
  }
}

function pluginSpecForMode(modeId: string): PluginView | null {
  const { viewId } = parseMosaicSlotId(modeId);
  const id = parsePluginId(viewId);
  if (!id) return null;
  const raw = pluginSpecs.find((p) => p.id === id);
  if (!raw) return null;
  const inst = parsePluginInstance(viewId);
  if (!inst || inst === raw.id) return { ...raw, instanceId: inst || raw.id };
  const row = (raw.instances ?? []).find((i) => i.id === inst);
  return row ? applyInstance(raw, row) : { ...raw, instanceId: inst };
}

/** Mosaic extras keep their own look; a wall row's plugin sky wins over a sky-less hero. */
function skySpecForMode(modeId: string, fallback: PluginView | null): PluginView | null {
  const selected = fallback ?? pluginSpecForMode(modeId);
  if (mosaic?.on) {
    const pane = mosaic.mainMode || mosaic.focusedId;
    return pickPluginSkySpec(selected, pane ? pluginSpecForMode(pane) : null);
  }
  return selected;
}

async function loadPluginSkyOnto(target: NetScene, spec: PluginView | null, pinPlugin: boolean): Promise<void> {
  const look = spec ? (lookForMode(pluginViewId(spec.id, spec.instanceId)) ?? spec.look) : undefined;
  const want = pinPlugin && !!spec && look?.backdrop === "plugin" && (spec.has_sky_shader === true || !!spec.shader_sha256);
  const key = want && spec ? `${spec.id}:${spec.shader_sha256 || ""}` : "";
  if (target === scene && key && key === skyLoaded) return;
  if (!want || !spec) {
    if (target === scene && skyLoaded) {
      scene.setPluginShader(null);
      skyLoaded = "";
    } else if (target !== scene) {
      target.setPluginShader(null);
    }
    return;
  }
  if (pluginNeedsReview(spec) && !spec.consent) {
    target.setPluginShader(null);
    if (target === scene) skyLoaded = "";
    return;
  }
  try {
    const source = await fetchPluginSky(spec.id, spec.shader_sha256);
    const err = target.setPluginShader({ id: spec.id, source });
    if (err) {
      console.warn("zoto-viz plugin sky:", err);
      spec.sky_error = err;
      spec.sky_available = false;
      target.setPluginShader(null);
      if (target === scene) skyLoaded = "";
      return;
    }
    if (target === scene) skyLoaded = key;
  } catch (e) {
    console.warn("zoto-viz plugin sky:", e);
    target.setPluginShader(null);
    if (target === scene) skyLoaded = "";
  }
}

async function syncPluginSky(spec: PluginView | null): Promise<void> {
  if (mosaic?.on) {
    mosaic.markSkyPending();
    try {
      for (const id of mosaic.tileIds) {
        const target = mosaic.graphScene(id);
        if (!target) continue;
        const tileSky = mosaic.paneSky(id);
        const viewId = mosaicTileViewId(id);
        const pane = pluginSpecForMode(viewId);
        const wantPlugin = tileSky === "plugin" || (!tileSky && (lookForMode(viewId)?.backdrop === "plugin"));
        await loadPluginSkyOnto(target, pane, wantPlugin);
      }
    } finally {
      mosaic.settlePanes();
    }
    return;
  }
  await loadPluginSkyOnto(scene, spec, true);
}

function applyMode(id: string, flags: { keepLayout?: boolean } = {}): void {
  const m = modeById(id);
  const opts = optsFor(m);
  const prevMode = liveMode;
  currentOpts = opts;
  setSkyPrompt(m.pluginId ?? m.id, opts[VIEW_PROMPT_KEY] ?? "");
  modeSel.value = m.id;
  localStorage.setItem("zoto-viz.mode", m.id);
  touch();
  applyPluginWall(m.id, { ...flags, prevMode });
  liveMode = m.id;

  const spec = m.pluginId ? pluginSpecForMode(m.id) : null;
  const paneSpec = skySpecForMode(m.id, spec);
  const skyStage = !m.standalone && !!(m.stageOnly || (lookForMode(m.id) ?? spec?.look)?.stageOnly);
  document.body.classList.toggle("stage-only", skyStage);
  const rainPics = m.pluginId === "hn-rain" && parseHnRainLook(opts).pics && !mosaic?.on;
  feedTitleCube.setActive(rainPics);
  nestCams.setActive(m.pluginId === "nest-cams");
  nestCams.setLook(opts);
  bindThisView(m.id);
  $("modeOpts").replaceChildren();
  void (async () => {
    if (!(await ensureReviewed(spec))) {
      preserveVizUbo = false;
      modeSel.value = prevMode || modeSel.value;
      liveMode = prevMode;
      localStorage.setItem("zoto-viz.mode", modeSel.value);
      return;
    }
    if (m.standalone || arcadeSlotFor(m) !== "carousel") {
      void loadTsPlugin(paneSpec);
      void syncPluginSky(paneSpec);
    }
  })();
  feedCtl.feed?.setGraphBase(m.graphBase);
  if (m.graphBase === "wifi") void syncWifiWatch();

  if (mosaic?.on && !(m.pluginId && m.standalone)) {
    if (!flags.keepLayout && mosaic.heroPos !== "off" && mosaic.heroMode !== m.id) {
      mosaic.setSize(mosaic.current, m.id, mosaic.heroPos, {
        tree: settings.animSettings.mosaicTree,
        maximized: settings.animSettings.mosaicMaxId || null,
        tiles: settings.animSettings.mosaicTiles,
      });
    }
    const finishMosaic = (): void => {
      const focusId = mosaic!.tileIds.find((id) => mosaicTileViewId(id) === m.id) ?? mosaic!.tileIds[0] ?? m.id;
      mosaic!.focus(focusId);
      const target = mosaic!.graphScene(focusId);
      if (target) {
        target.setMode(m, opts);
        target.setStageOnly(skyStage);
      }
      document.body.classList.remove("arcade");
      scene.setActive(true);
      if (target !== scene) scene.setStageOnly(false);
      morphViewChrome(m, opts, spec, skyStage);
      applyViewLook();
    };
    const onWall = mosaic.tileIds.some((id) => mosaicTileViewId(id) === m.id);
    if (!onWall) {
      const slot = mosaic.focusedId || mosaic.tileIds[0];
      if (!slot) {
        modeSel.value = prevMode || modeSel.value;
        liveMode = prevMode;
        localStorage.setItem("zoto-viz.mode", modeSel.value);
        return;
      }
      if (!mosaic.setPaneView(slot, m.id)) {
        modeSel.value = prevMode || modeSel.value;
        liveMode = prevMode;
        localStorage.setItem("zoto-viz.mode", modeSel.value);
        return;
      }
      finishMosaic();
      return;
    }
    finishMosaic();
    return;
  }

  scene.setMode(m, opts);

  // standalone arcade, or NASA catalog views which share the contain-fit slideshow stage
  const next = arcadeSlotFor(m);
  document.body.classList.toggle("arcade", next !== null);
  scene.setActive(true);
  scene.setStageOnly(next !== null || skyStage);
  if (activeArcade && activeArcade !== next) { arcade[activeArcade].view.stop(); arcade[activeArcade].el.hidden = true; }
  if (next && activeArcade !== next) { arcade[next].el.hidden = false; arcade[next].view.start(selectedIp); }
  if (next === "carousel") (arcade.carousel.view as CarouselView).setBind(opts);
  activeArcade = next;
  syncFeedShift();

  morphViewChrome(m, opts, spec, skyStage);
  applyViewLook();
}

function morphViewChrome(m: ViewMode, opts: Record<string, string>, spec: PluginView | null, skyStage: boolean): void {
  morphCopy($("hint"), m.hint);
  const legend = $("legend");
  const paint = (): void => {
    if (skyStage) legend.replaceChildren();
    else renderLegend(m, opts);
    legend.classList.remove("morphing");
  };
  if (legend.childElementCount) {
    legend.classList.add("morphing");
    window.setTimeout(paint, 180);
  } else {
    paint();
  }
  vizHud.setActive(m.pluginId ?? spec?.id ?? null, spec?.name ?? m.label);
}

function renderLegend(m: ViewMode, opts: Record<string, string>): void {
  const el = $("legend");
  el.innerHTML = "";
  if (m.stageOnly || document.body.classList.contains("stage-only")) return;
  for (const item of m.legend(opts)) {
    const s = document.createElement("span");
    const i = document.createElement("i");
    i.style.background = item.color;
    if (item.line) i.classList.add("line");
    if (item.color === "transparent") i.classList.add("none");
    s.append(i, item.label);
    el.appendChild(s);
  }
}

applyMode(localStorage.getItem("zoto-viz.mode") ?? defaultCatalogMode()?.id ?? "topology");

// ---------------------------------------------------------------- visibility filters

function applyShow(key: keyof Filters, on: boolean): void {
  scene.setFilters({ [key]: on });
  mosaic?.eachGraph((s) => { if (s !== scene) s.setFilters({ [key]: on }); });
  localStorage.setItem(`zoto-viz.${key}`, on ? "1" : "0");
  touch();
}

function bindShowToggle(id: string, key: keyof Filters, label: string, title: string, fallback = true): Toggle {
  const saved = localStorage.getItem(`zoto-viz.${key}`);
  const t = new Toggle({
    id, label, title,
    checked: saved !== null ? saved === "1" : fallback,
    onChange: (on) => applyShow(key, on),
  });
  scene.setFilters({ [key]: t.checked });
  return t;
}
const netLan = bindShowToggle("showLan", "lan", "LAN devices", "devices on the local network (the ring around the gateway); this host, the gateway and local containers / VMs stay");
const netInternet = bindShowToggle("showInternet", "internet", "internet", "internet endpoints (outer sphere)");
const netMulticast = bindShowToggle("showMulticast", "multicast", "multicast", "multicast / broadcast groups");
const netOffline = bindShowToggle("showOffline", "offline", "offline", "devices not seen recently");
const sysLabels = bindShowToggle("showLabels", "labels", "labels", "node labels on network and system graphs (key L)");
const sysCpuIdle = bindShowToggle("showCpuIdle", "cpuIdle", "idle processes", "unused CPU processes fade for a few seconds after they go quiet; off hides them at once. Idle cores stay.");
const labelsChrome = new Toggle({
  id: "labels",
  label: "labels",
  title: "node labels on network and system graphs (key L)",
  checked: sysLabels.checked,
  onChange: (on) => setLabels(on),
});
$("labelsBox").appendChild(labelsChrome.el);
function setLabels(on: boolean): void {
  sysLabels.checked = on;
  labelsChrome.checked = on;
  applyShow("labels", on);
}
sysLabels.onChange = setLabels;
const showToggles = { lan: netLan, internet: netInternet, multicast: netMulticast, offline: netOffline, labels: sysLabels, cpuIdle: sysCpuIdle };
// "merge names" is a data transform rather than a visibility filter: the last raw snapshot is re-fed through it
const mergeToggle = new Toggle({
  id: "mergeNames", label: "merge names", title: "collapse internet hosts that share a hostname (CDN aliases). LAN devices with the same factory name stay separate — Wi-Fi+Ethernet of one box is already folded by MAC",
  checked: localStorage.getItem("zoto-viz.merge") === "1",
  onChange: (on) => { localStorage.setItem("zoto-viz.merge", on ? "1" : "0"); touch(); if (lastRaw) feed(lastRaw); },
});
let lastLiveSeq = 0;
let lastRepoRev = "";
function applyLive(m: StateMsg): void {
  const rev = m.repoRev || "";
  if (rev) setBackroomsSampleRev(rev);
  if (rev && lastRepoRev && rev !== lastRepoRev) {
    location.reload();
    return;
  }
  if (rev) lastRepoRev = rev;
  const live = m.live;
  if (!live || live.seq <= lastLiveSeq) return;
  lastLiveSeq = live.seq;
  if (live.patch?.reloadClient === true) {
    location.reload();
    return;
  }
  if (live.temper != null || live.weather) agent.syncTemper({ temper: live.temper, weather: live.weather });
  if (live.patch && Object.keys(live.patch).length) void applyAgentPatch(live.patch);
}

function applyDemoDataLabels(demoSlots: ReadonlySet<string>): void {
  const mark = (el: HTMLElement | null | undefined, on: boolean) => {
    if (!el) return;
    if (on) el.dataset.demoData = "1";
    else delete el.dataset.demoData;
  };
  if (!mosaic?.on) {
    mark(scene.viewEl, demoSlots.has("hero"));
    return;
  }
  mark(scene.viewEl, demoSlots.has("hero"));
  for (const slot of mosaic.tileIds) {
    mark(mosaic.graphScene(slot)?.viewEl, demoSlots.has(slot));
  }
}

function feed(m: StateMsg): void {
  const feedT0 = performance.now();
  lastRaw = m;
  applyLive(m);
  const curMode = modeById(liveMode || modeSel.value);
  const curSpec = curMode.pluginId ? pluginSpecForMode(curMode.id) : null;
  let shown = withGoldenIfIdle(m, pluginIdleOf(curSpec));
  if (mergeToggle.checked) {
    const c = collapseByName(m);
    scene.setAliasMap(c.map);
    mosaic?.eachGraph((s) => { if (s !== scene) s.setAliasMap(c.map); });
    scene.update(c.msg);
    mosaic?.update(c.msg);
    for (const a of Object.values(arcade)) a.view.update(c.msg);
    shown = c.msg;
  } else {
    scene.setAliasMap(new Map());
    scene.update(m);
    mosaic?.eachGraph((s) => { if (s !== scene) s.setAliasMap(new Map()); });
    mosaic?.update(m);
    for (const a of Object.values(arcade)) a.view.update(m);
  }
  applyStats(shown);
  feedCtl.feed?.setSourceHeadlines(sourceHeadlines(m.sources));
  nestCams.sync(m.sdm);
  settings.setNestDevices(m.sdm?.devices ?? []);
  if (uiReady) {
    const cur = modeById(liveMode || modeSel.value);
    paintViewAuth(cur, cur.pluginId ? pluginSpecForMode(cur.id) : null);
  }
  const ticker = [
    ...sourceHeadlines(m.sources).map((h) => `${h.label} ${h.text}`),
    ...(feedCtl.feed?.snapshot(10) ?? []),
  ];
  arcade.pacman?.view.setTicker?.(ticker);
  renderLegend(scene.currentMode, currentOpts);
  sandbox.tick(shown.devices.slice(0, 80).map((d) => ({
    id: d.ip,
    rate: d.packets,
    role: d.role,
  })));
  const mode = modeById(modeSel.value);
  const active = (mode.pluginId && pluginSpecs.find((p) => p.id === mode.pluginId))
    || pluginSpecs.find((p) => p.id === tsWatchId)
    || null;
  const packId = normalizeVizDemoPackId(active?.id ?? mode.pluginId);
  const mosaicDemoPacks = mosaic?.on
    && mosaic.tileIds.some((id) => normalizeVizDemoPackId(modeById(mosaicTileViewId(id)).pluginId));
  if (active?.capabilities?.includes("viz.read") || packId || mosaicDemoPacks) {
    if (!vizWriter && active) bindVizWriter(active);
    const audio = scene.pulseNow.bass;
    const idle = active?.viz?.idle;
    const bind = packId === "hn-rain" || packId === "hn-term"
      ? illustratedSourceBind(optsFor(mode))
      : parseSourceBind(optsFor(mode));
    const buildFrame = idle
      ? (s: StateMsg, pt: number, a: number) => buildVizFrameForPlugin(s, pt, a, idle, bind)
      : (s: StateMsg, pt: number, a: number) => buildVizFrame(s, pt, a, bind);
    const frame = vizBudget.deliver(shown, vizFrameTs, audio, (f) => {
      if (packId === "stereo-gram") f.spectrum = scene.heardSpectrum(STEREO_BINS).spectrum;
      if (mosaic?.on && mosaicDemoPacks) {
        deliverCoalescedMosaicPacks({
          mosaic,
          frame: f,
          modeById: (id) => modeById(mosaicTileViewId(id)),
          pluginSpecForMode,
          optsFor,
          budget: { stats: vizBudget.stats },
        });
      } else {
        sandbox.frame(f);
        if (packId) {
          runPackFrameHandler(packId, f, {
            writeBuffer: (slot, data) => sandbox.handlers.writeBuffer?.(slot, data),
            writeUniform: (name, value) => sandbox.handlers.writeUniform?.(name, value),
            writeParticles: (data, stride) => sandbox.handlers.writeParticles?.(data, stride),
          }, optsFor(mode));
        }
      }
    }, buildFrame);
    if (frame) {
      vizFrameTs = frame.t;
      if (packId === "hn-rain" || packId === "hn-term") {
        scene.setVizHeadlines(frame.headlines.map((h) => h.text).join(" / ") || "HN");
      }
      if (packId === "hn-rain") {
        const pics = parseHnRainLook(optsFor(mode)).pics && !mosaic?.on;
        feedTitleCube.setActive(pics);
        if (pics) feedTitleCube.sync(frame.headlines.map((h) => h.text));
      }
    }
    if (!mosaic?.on) {
      vizHud.tick({
        packId,
        packName: active?.name ?? packId ?? "",
        stats: vizBudget.stats,
        frame: vizBudget.lastBuilt,
        state: shown,
        now: performance.now(),
      });
    }
  }

  const tsMode = modeById(modeSel.value);
  const tsActive = tsMode.pluginId ? pluginSpecs.find((p) => p.id === tsMode.pluginId) : undefined;
  typesafeHost.configure({
    packHasCap: pluginHasTypeSafe(tsActive?.capabilities),
    enable: parseTypeSafeEnable(),
    contract: tsActive?.typesafe,
  });
  const tsSlice = typesafeHost.pluginStateSlice();
  if (tsSlice) {
    shown = { ...shown, plugin_state: { ...shown.plugin_state, ...tsSlice } };
  }
  const frameMs = performance.now() - feedT0;
  void typesafeHost.tick(shown, {
    presentIntervalMs: presentInterval(),
    headroomMs: VIZ_FRAME_BUDGET_MS - frameMs,
  });
}

// ---------------------------------------------------------------- redaction (screenshots / sharing)

let lastState: StateMsg | null = null;
const redactToggle = new Toggle({
  id: "redact", label: "redact", className: "warn",
  title: "partially mask addresses and device names for screenshots (key R)",
  onChange: (on) => setRedaction(on),
});
function setRedaction(on: boolean): void {
  redaction.enabled = on;
  redactToggle.checked = on;
  document.body.classList.toggle("redacted", on);
  localStorage.setItem("zoto-viz.redact", on ? "1" : "0");
  touch();
  if (lastState) applyStats(lastState);
  scene.refresh();
  mosaic?.eachGraph((s) => { if (s !== scene) s.refresh(); });
}
setRedaction(localStorage.getItem("zoto-viz.redact") === "1");

// ---------------------------------------------------------------- settings cog: allow/block filters + the moved show / privacy switches

settings = new Settings({
  storePrefix: "zoto-viz",
  onChange: () => {
    const fn = (d: Device) => settings.matches(d);
    if (mosaic) mosaic.eachGraph((s) => s.setNodeFilter(fn));
    else scene.setNodeFilter(fn);
  },
  onPersist: () => touch(),
});
settings.onPluginChange = () => {
  onPluginFields();
  if (!mosaic?.on) return;
  const focus = mosaic.focusedId;
  if (!focus) return;
  const pane = modeById(mosaicTileViewId(focus));
  mosaic.graphScene(focus)?.setMode(pane, optsFor(pane));
};
settings.onInstancesChange = () => {
  void (async () => {
    pluginSpecs = await installPlugins();
    modeSel.setOptions(viewSelectOptions());
    settings.refreshMosaicSlots();
    applyMode(modeSel.value);
  })();
};
const showSec = settings.addSection(
  "Network",
  [netLan, netInternet, netMulticast, netOffline, mergeToggle],
  "Which LAN and internet nodes appear. Merge folds CDN aliases that share a hostname.",
);
settings.addSection(
  "System",
  [sysCpuIdle, sysLabels],
  "CPU graphs: idle processes fade, or hide at once. Labels apply to every graph.",
);
mosaic = new Mosaic({
  wall: $("wall"),
  sceneEl: $("scene"),
  main: scene,
  host: renderHost,
  arcade,
  spawnArcade: (engine) => spawnArcade(engine, scene),
  optsFor,
  pluginSpecForMode: (modeId) => pluginSpecForMode(modeId),
  onFocus: (id) => mosaic?.focus(id),
  onPromote: (id, theme) => {
    applyMode(id, { keepLayout: true });
    if (theme) applyTheme(theme.id);
    applyViewLook();
  },
  onLayout: (patch) => {
    applyWallLayoutPatch(settings, patch);
  },
  onCloseLast: () => {
    settings.applyAnim({ ...settings.animSettings, mosaic: "off", mosaicTree: null, mosaicMaxId: "", mosaicTiles: [] });
  },
  paneCog: (id) => makeViewCogButton({
    className: "mosaic-pane-cog",
    title: "this pane's view settings",
    ariaLabel: "this pane settings",
    pane: id,
    onClick: () => {
      mosaic?.focus(id);
      bindThisView(id);
      settings.openView(id);
    },
  }),
  sync: () => ({
    theme: scene.currentTheme,
    filters: scene.currentFilters,
    anim: settings.animSettings,
    dreaming: dreamToggle.checked,
    nodeFilter: (d) => settings.matches(d),
    lastMsg: lastRaw && mergeToggle.checked ? collapseByName(lastRaw).msg : lastRaw,
    aliasMap: lastRaw && mergeToggle.checked ? collapseByName(lastRaw).map : new Map(),
  }),
});
settings.onMosaicPanePick = (from, to) => {
  if (!mosaic?.on) return false;
  if (!mosaic.setPaneView(from, to)) return false;
  const slot = mosaic.tileIds.find((id) => mosaicTileViewId(id) === to) ?? from;
  mosaic.focus(slot);
  const pm = hostModeById(to);
  const paneSpec = skySpecForMode(to, pm.pluginId ? pluginSpecForMode(to) : null);
  void (async () => {
    const spec = pm.pluginId ? pluginSpecForMode(pm.id) : null;
    if (!(await ensureReviewed(spec))) return;
    if (pm.standalone || arcadeSlotFor(pm) !== "carousel") {
      void syncPluginSky(paneSpec);
    }
  })();
  return true;
};
settings.addAnimation((a) => {
  const pin = pinViewLook();
  if (mosaic!.on) {
    mosaic!.applyLooks(a, pin);
    mosaic!.setTheme(scene.currentTheme);
  } else scene.setAnim(mergeLook(a, pin ? lookForMode(modeSel.value) : undefined));
  const key = `${a.mosaic}:${a.hero}:${(a.mosaicTiles?.length ? a.mosaicTiles : []).join(",")}:${a.mosaicMaxId ?? ""}`;
  if (key !== mosaic!.layoutKey) {
    if (a.mosaic !== "off" && activeArcade) {
      arcade[activeArcade].view.stop();
      arcade[activeArcade].el.hidden = true;
      document.body.classList.remove("arcade");
      scene.setStageOnly(false);
      activeArcade = null;
    }
    mosaic!.setSize(a.mosaic, modeSel.value, a.hero, {
      tree: a.mosaicTree,
      maximized: a.mosaicMaxId || null,
      tiles: a.mosaicTiles,
    });
    applyMode(modeSel.value, { keepLayout: true });
    syncFeedShift();
  }
}, dreamCog);
themeFollow = (t) => settings.syncTheme(t);
settings.syncTheme(paintedTheme(theme));
scene.onCamTheme = (hex) => {
  if (hex == null) paintLiveTheme(theme);
  else paintLiveTheme(alignThemeToColor(theme, hex));
};
if (scene.dreamAnim.camTheme && scene.liveCamColor != null) scene.onCamTheme(scene.liveCamColor);
const liveFeed = new LiveFeed($("livefeed"), scene);
const liveChat = new ChatPanel($("livechat"));
feedCtl.feed = liveFeed;
liveFeed.setGraphBase(modeById(modeSel.value).graphBase);
const feedToggle = new Toggle({
  id: "feed",
  label: "feed",
  title: "show the decoded activity list on the right (key F)",
  checked: settings.feedSettings.on,
  onChange: (on) => settings.setFeedOn(on),
});
$("feedBox").appendChild(feedToggle.el);
const chatToggle = new Toggle({
  id: "chat",
  label: "chat",
  title: "show the agent conversation on the right (key C)",
  checked: settings.chatSettings.on,
  onChange: (on) => settings.setChatOn(on),
});
$("chatBox").appendChild(chatToggle.el);
const debugLog = new DebugLog($("debuglog"));
const debugOn = readDebugOn();
const debugToggle = new Toggle({
  id: "debug",
  label: "debug",
  title: "debug panel: monitor log + Cursor tokens/cost (key B)",
  checked: debugOn,
});
const debugSettings = new Toggle({
  label: "backend logs",
  title: "same as the header debug switch (key B)",
  checked: debugOn,
});
function setDebug(on: boolean): void {
  debugToggle.checked = on;
  debugSettings.checked = on;
  debugLog.setOn(on);
}
debugLog.onClose = () => setDebug(false);
debugToggle.onChange = setDebug;
debugSettings.onChange = setDebug;
setDebug(debugOn);
$("debugBox").appendChild(debugToggle.el);
settings.addSection("Debug", [debugSettings], "Opens the debug panel (monitor log + Cursor tokens/cost in ~/.zoto-viz/cursor-stats.jsonl). Header debug or key B.");
const camToggle = new Toggle({
  id: "camera",
  label: "cam",
  title: "webcam on (Auto) / off — same as Settings → Privacy. Off stops the camera so the OS light goes out",
  checked: liveCam.camPolicy === "auto",
  onChange: (on) => settings.setCamPolicy(on ? "auto" : "off"),
});
settings.onCamPolicy = (p) => { camToggle.checked = p === "auto"; };
$("cameraBox").appendChild(camToggle.el);
const micToggle = new Toggle({
  id: "mic",
  label: "mic",
  title: "microphone on (Auto) / off — same as Settings → Privacy. Off stops every mic stream so the OS light goes out",
  checked: liveMic.micPolicy === "auto",
  onChange: (on) => settings.setMicPolicy(on ? "auto" : "off"),
});
settings.onMicPolicy = (p) => {
  micToggle.checked = p === "auto";
  scene.syncPulse();
  if (p === "off") agent.releaseMic();
  else agent.armWake();
};
$("micBox").appendChild(micToggle.el);
const soundToggle = new Toggle({
  id: "sound",
  label: "sound",
  title: "speakers on / off — same as Settings → Privacy. Off silences plugin SFX, arcade, and spoken replies. Starts off",
  checked: liveSound.soundOn,
  onChange: (on) => settings.setSoundOn(on),
});
settings.onSoundPolicy = (on) => {
  soundToggle.checked = on;
  if (!on) {
    pluginSfx.silence();
    agent.hushOutput();
  }
};
$("soundBox").appendChild(soundToggle.el);
settings.bindPulse(() => scene.pulseNow);
settings.addLiveFeed((c) => {
  liveFeed.setConfig(c);
  feedToggle.checked = c.on;
  syncOverlayStack();
  syncFeedShift();
});
settings.addChat((c) => {
  liveChat.setConfig(c);
  chatToggle.checked = c.on;
  if (c.on) liveChat.seedTranscript(agent.transcript());
  syncOverlayStack();
  syncFeedShift();
});
liveFeed.setConfig(settings.feedSettings);
liveChat.setConfig(settings.chatSettings);
syncOverlayStack();
syncFeedShift();
observeResize($("livefeed"), syncFeedShift);
observeResize($("livechat"), syncFeedShift);
observeResize($("scene"), syncFeedShift);
agent.onChat = (role, text, stream) => liveChat.pushChat(role, text, stream);
agent.onChatEnd = () => liveChat.lockStream();
liveChat.onDisplay = (info) => agent.hearFeed(info);
agent.onPhase = (phase) => {
  liveChat.setThinking(phase === "think");
  if (phase === "heard") settings.revealTranscript();
  liveChat.setListening(phase === "heard");
};
agent.onTranscript = () => liveChat.seedTranscript(agent.transcript());
agent.dictateInto = liveChat.ask;
liveChat.onSend = (text) => agent.offerSend(text);
liveChat.onMicDown = () => agent.beginTalk();
liveChat.onMicUp = () => agent.endTalk();
liveChat.seedTranscript(agent.transcript());
const autoconsentToggle = new Toggle({
  id: "autoconsent",
  label: "auto-consent plugins",
  className: "warn",
  title: "when on, shipped plugins/src and ~/.zoto-viz/plugins/local zips are consented automatically — not contrib zips dropped into plugins/",
  checked: autoconsentEnabled(),
  onChange: (on) => {
    setAutoconsent(on);
    touch();
  },
});
const privSec = settings.addSection("Privacy", [redactToggle, autoconsentToggle]);
$("settingsBox").appendChild(settings.el);
settings.attachViewCog($("modeBox"), () => bindThisView(modeSel.value));
agent.mountSettings(settings.agentHost());
agent.onOpen = () => { settings.open("agent"); };
agent.captureView = () => {
  const hud = captureHud({
    mode: modeSel.value,
    theme: theme.id,
    chrome: userChrome,
    dream: dreamToggle.checked,
    selected: scene.selectedIp,
    merge: mergeToggle.checked,
    redact: redaction.enabled,
    camera: liveCam.camPolicy,
    mic: liveMic.micPolicy,
    show: {
      lan: showToggles.lan.checked,
      internet: showToggles.internet.checked,
      multicast: showToggles.multicast.checked,
      offline: showToggles.offline.checked,
      labels: showToggles.labels.checked,
      cpuIdle: showToggles.cpuIdle.checked,
    },
    feed: settings.feedSettings,
    feedLines: [...liveChat.snapshot(2), ...liveFeed.snapshot(2)],
  });
  let canvas: HTMLCanvasElement | null = null;
  if (activeArcade) {
    const el = arcade[activeArcade].el.querySelector("canvas:not(.look)");
    canvas = el instanceof HTMLCanvasElement ? el : null;
  } else {
    scene.flushFrame();
    canvas = renderHost.canvas;
  }
  return packView(hud, canvas);
};
agent.onApplySettings = (patch) => { void applyAgentPatch(patch); };
agent.onPrefs = () => touch();
agent.onApplyLook = (look) => applyAgentLook(look);
$("aiBox").appendChild(agent.headerEl);
const diceToggle = new Toggle({
  id: "dice",
  label: "dice",
  title: "repeat every N minutes (Settings → Dice)",
  checked: settings.diceSettings.on,
  onChange: (on) => setDice(on),
});
const diceBox = $("diceBox");
mountDiceSplit(diceBox, diceToggle, () => { void rollDice({ view: true }); });
let diceTimer: number | null = null;
let dicePeriodArmed = 0;
function dicePeriodMs(): number {
  return Math.max(1, settings.diceSettings.periodMin) * 60_000;
}
function stopDiceTimer(): void {
  if (diceTimer != null) {
    window.clearInterval(diceTimer);
    diceTimer = null;
  }
  dicePeriodArmed = 0;
}
function syncDiceTimer(): void {
  const on = settings.diceSettings.on;
  diceToggle.checked = on;
  if (!on) {
    stopDiceTimer();
    return;
  }
  const ms = dicePeriodMs();
  if (diceTimer != null && dicePeriodArmed === ms) return;
  stopDiceTimer();
  dicePeriodArmed = ms;
  diceTimer = window.setInterval(() => { void rollDice(); }, ms);
}
function setDice(on: boolean): void {
  const was = settings.diceSettings.on;
  settings.setDiceOn(on);
  diceToggle.checked = on;
  if (on && !was) void rollDice({ view: true });
}
settings.onDiceChange = () => { syncDiceTimer(); };
syncDiceTimer();
agent.onCycle = (on) => {
  localStorage.setItem(CYCLE_KEY, on ? "1" : "0");
  void setAiCycle(on);
};
scene.setNodeFilter((d) => settings.matches(d));
scene.setAnim(mergeLook(settings.animSettings, lookForMode(modeSel.value)));
scene.onDreamPulse = () => {
  quiet(() => {
    const a = settings.animSettings;
    if (a.cycle && !mosaic?.on) {
      const graphs = graphModes();
      if (graphs.length) {
        const i = Math.max(0, graphs.findIndex((m) => m.id === modeSel.value));
        applyMode(graphs[(i + 1) % graphs.length].id);
      }
    }
    if (a.randomize) settings.shuffleAnim();
    if (a.themeCycle === "cadence") cycleRandomTheme();
    if (a.skyCycle === "cadence") settings.cycleSky();
  });
};
scene.onThemePulse = () => quiet(() => {
  const a = settings.animSettings;
  if (a.themeCycle === "audio") cycleRandomTheme();
  if (a.skyCycle === "audio") settings.cycleSky();
});

const layoutBtns = new Map<ChromePos, HTMLButtonElement>();
const layoutRow = document.createElement("div");
layoutRow.className = "skypick";
layoutRow.setAttribute("role", "radiogroup");
layoutRow.setAttribute("aria-label", "chrome position");
for (const o of CHROME_OPTS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sky";
  b.textContent = o.label;
  b.title = o.hint;
  b.setAttribute("aria-pressed", o.value === chrome ? "true" : "false");
  b.addEventListener("click", () => applyChrome(o.value));
  layoutBtns.set(o.value, b);
  layoutRow.appendChild(b);
}

function placeQuick(pos: ChromePos): void {
  const quick = $("quick");
  if (pos === "top") {
    const graph = settings.host;
    const first = graph.querySelector(":scope > .sec");
    if (first && first !== showSec.el) graph.insertBefore(showSec.el, first);
    else if (showSec.el.parentElement !== graph) graph.append(showSec.el);
    settings.privacyHost.append(privSec.el);
    quick.hidden = true;
  } else {
    quick.append(showSec.el, privSec.el);
    quick.hidden = false;
  }
}

function syncChromeMetrics(): void {
  const barEl = $("bar");
  const side = chrome !== "top";
  document.documentElement.style.setProperty("--bar-h", side ? "0px" : `${barEl.offsetHeight}px`);
  document.documentElement.style.setProperty("--bar-w", side ? `${barEl.offsetWidth}px` : "0px");
}

function applyChrome(pos: ChromePos, fromUser = true): void {
  chrome = pos;
  document.body.dataset.chrome = pos;
  chromeSel.value = pos;
  for (const [k, btn] of layoutBtns) btn.setAttribute("aria-pressed", k === pos ? "true" : "false");
  placeQuick(pos);
  syncChromeMetrics();
  syncFeedShift();
  if (fromUser) {
    userChrome = pos;
    localStorage.setItem("zoto-viz.chrome", pos);
    touch();
  }
}
applyChrome(chrome, false);

const profileBar = document.createElement("div");
profileBar.id = "profileBar";
document.body.appendChild(profileBar);
const profileTools = document.createElement("div");
profileTools.className = "prow";
const profileHost = document.createElement("div");
profileHost.className = "sec-controls";
profileHost.append(profileSel.el, profileTools);
const chromeHost = document.createElement("div");
chromeHost.className = "sec-controls";
chromeHost.append(chromeSel.el, layoutRow);
profiles = new ProfileStore(
  { collect: collectSettings, apply: applySettings },
  profileSel,
  profileBar,
  profileTools,
);
settings.prependSection(
  "Theme",
  "Colour theme. A plugin look can pin this; the chips on This view explain why.",
  themeSel.el,
);
settings.prependSection(
  "Chrome",
  "Header position. Left/right is a wide bar; inspect sits on the other side.",
  chromeHost,
);
settings.prependSection(
  "Profile",
  "Saved in ~/.zoto-viz/profiles.yml. Choosing a profile makes it the one a new tab loads. zoto viz is the shipped default. Backend and model are stored on that profile; the Cursor key stays in ~/.zoto-viz/cursor-key.",
  profileHost,
);
uiReady = true;
applyViewLook();
void (async () => {
  const session = await bootSession();
  typeSafeKeyOn = session.typesafeConfigured;
  setTypeSafeProxyConfigured(() => typeSafeKeyOn);
  agent.setControlFromServer(session.aiControl);
  pluginSpecs = await installPlugins();
  modeSel.setOptions(viewSelectOptions());
  settings.refreshMosaicSlots();
  if (settings.animSettings.mosaic !== "off") {
    mosaic.setSize(settings.animSettings.mosaic, modeSel.value, settings.animSettings.hero, {
      tree: settings.animSettings.mosaicTree,
      maximized: settings.animSettings.mosaicMaxId || null,
      tiles: settings.animSettings.mosaicTiles,
    });
    mosaic.hydrate();
  }
  const live = readSessionLive();
  applyMode(localStorage.getItem("zoto-viz.mode") ?? defaultCatalogMode()?.id ?? "");
  const restored = await profiles.boot(live);
  await agent.syncStatus();
  if (!agent.savedBackend() && agent.cursorReady()) {
    agent.useBackend("cursor");
    touch();
  }
  quiet(() => {
    applyMode(modeSel.value);
    applyViewLook();
    if (restored && live) applyTheme(live.settings.theme, false, false);
  });
  if (restored && live?.selected) scene.selectIp(live.selected);
  if (restored) agent.setCycleChecked(!!live?.aiCycle);
  else if (agent.cycleOn) await setAiCycle(true);
  liveReady = true;
  persistLive(true);
  void syncWifiWatch();
  agent.armWake();
})();

let liveAgentLook: AgentLook = { decos: [] };
let nasaAssetOrigins: Map<string, string> | null = null;
let nasaAssetOriginsP: Promise<void> | null = null;

function graphAgentLook(look: AgentLook): AgentLook {
  const decos = look.decos.filter((d) => !isNasaStillDeco(d, nasaAssetOrigins));
  const shaderPhoto = look.shaderPhoto && isNasaStillUrl(look.shaderPhoto) ? undefined : look.shaderPhoto;
  if (decos.length === look.decos.length && shaderPhoto === look.shaderPhoto) return look;
  const next: AgentLook = { decos };
  if (look.shader) next.shader = look.shader;
  if (shaderPhoto) next.shaderPhoto = shaderPhoto;
  return next;
}

function sceneAgentLook(): AgentLook { return graphAgentLook(liveAgentLook); }

function paintAgentLook(look: AgentLook): void {
  const next = graphAgentLook(normalizeAgentLook(look));
  liveAgentLook = next;
  scene.setAgentLook(next);
  mosaic?.eachGraph((g) => { if (g !== scene) g.setAgentLook(next); });
  void ensureNasaAssetOrigins();
}

async function ensureNasaAssetOrigins(): Promise<void> {
  if (nasaAssetOrigins || nasaAssetOriginsP) return nasaAssetOriginsP ?? Promise.resolve();
  nasaAssetOriginsP = (async () => {
    try {
      const r = await apiFetch("/api/ai/assets");
      const d = await r.json() as { assets?: { id?: string; url?: string; src?: string }[] };
      const map = new Map<string, string>();
      for (const row of d.assets ?? []) {
        const id = (row.id || "").toLowerCase();
        const origin = row.url || row.src || "";
        if (id && origin) map.set(id, origin);
      }
      nasaAssetOrigins = map;
      const stripped = graphAgentLook(liveAgentLook);
      if (stripped !== liveAgentLook) paintAgentLook(stripped);
    } catch {
      nasaAssetOrigins = new Map();
    } finally {
      nasaAssetOriginsP = null;
    }
  })();
  return nasaAssetOriginsP;
}

function decoAt(raw: unknown): DecoAt {
  if (raw === "selected" || raw === "internet" || raw === "origin") return raw;
  if (Array.isArray(raw) && raw.length >= 3) {
    const x = Number(raw[0]), y = Number(raw[1]), z = Number(raw[2]);
    if ([x, y, z].every(Number.isFinite)) return [x, y, z];
  }
  return "internet";
}

async function applyAgentPatch(patch: Record<string, unknown>): Promise<void> {
  if (patch.reloadClient === true) {
    location.reload();
    return;
  }
  if (patch.reloadPlugins === true) {
    pluginSpecs = await installPlugins();
    modeSel.setOptions(viewSelectOptions());
    settings.refreshMosaicSlots();
  }
  const p = pickAgentSettings(patch, allModes().map((m) => m.id));
  if (p.dice) {
    const wasOn = settings.diceSettings.on;
    applySettings(mergeAgentPatch(collectSettings(), { dice: p.dice }));
    if (p.dice.on === true && !wasOn && !p.shuffle) await rollDice();
  }
  if (p.shuffle) {
    await rollDice();
    return;
  }
  if (p.temper != null || p.weather) agent.syncTemper({ temper: p.temper, weather: p.weather });
  const lockLayout = !aiMosaicLayoutOn();
  if (lockLayout && p.anim) p.anim = stripMosaicLayout(p.anim);
  const cur = collectSettings();
  if (lockLayout && mosaic?.on && p.mode && typeof p.mode === "string") {
    const viewId = p.mode;
    if (!mosaicWallUsesView(mosaic.tileIds, viewId)) {
      const tiles = [...mosaic.tileIds];
      const at = Math.max(0, tiles.indexOf(mosaic.focusedId));
      const from = tiles[at] ?? tiles[0];
      if (from) {
        tiles[at] = viewId;
        p.anim = { ...p.anim, mosaicTiles: tiles };
      }
    }
  }
  const next = mergeAgentPatch(cur, p);
  applySettings(next, { keepLayout: lockLayout });
  await profiles?.writeAi(collectSettings(), agent.modelTag);
}

async function applyAgentLook(look: AgentLookInput): Promise<void> {
  const cur = collectSettings();
  let agentLook: AgentLook = look.clear ? { decos: [] } : { ...cur.agent, decos: [...cur.agent.decos] };
  if (look.shader) {
    const err = compileAgentSky(look.shader);
    if (err) throw new Error(`shader: ${err}`);
    agentLook = { ...agentLook, shader: look.shader };
    cur.anim = { ...cur.anim, backdrop: "custom" };
  }
  for (const p of look.photos ?? []) {
    if (isNasaStillUrl(p.url)) continue;
    const r = await apiFetch("/api/ai/asset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: p.url }),
    });
    const d = await r.json() as { error?: string; asset?: { id: string; href: string } };
    if (!r.ok || !d.asset) throw new Error(d.error || `photo ${r.status}`);
    agentLook.decos = [...agentLook.decos, {
      id: d.asset.id, kind: "photo", src: d.asset.href, from: p.url, at: decoAt(p.at),
    }];
  }
  if (look.svg) {
    const r = await apiFetch("/api/ai/asset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ svg: look.svg }),
    });
    const d = await r.json() as { error?: string; asset?: { id: string; href: string } };
    if (!r.ok || !d.asset) throw new Error(d.error || `svg ${r.status}`);
    agentLook.decos = [...agentLook.decos, { id: d.asset.id, kind: "svg", src: look.svg, at: "internet" }];
  }
  applySettings({ ...cur, agent: normalizeAgentLook(agentLook), anim: cur.anim });
  await profiles?.writeAi(collectSettings(), agent.modelTag);
}

function collectSettings(): ProfileSettings {
  const modeOptions: Record<string, Record<string, string>> = {};
  for (const m of allModes()) modeOptions[m.id] = optsFor(m);
  const arcade: Record<string, string> = {};
  for (const k of Object.keys(localStorage)) {
    if (/^zoto-viz\.(pong|invaders|command|frogger|cpupong|doom|waves|orbits|helix|skyline|pacman|tetris|portal|carousel)\./.test(k)) arcade[k] = localStorage.getItem(k) ?? "";
  }
  return {
    theme: theme.id,
    dream: dreamToggle.checked,
    mode: modeSel.value,
    modeOptions,
    show: {
      lan: showToggles.lan.checked,
      internet: showToggles.internet.checked,
      multicast: showToggles.multicast.checked,
      offline: showToggles.offline.checked,
      labels: showToggles.labels.checked,
      cpuIdle: showToggles.cpuIdle.checked,
    },
    merge: mergeToggle.checked,
    redact: redactToggle.checked,
    autoconsent: autoconsentEnabled(),
    filters: settings.filterText(),
    anim: { ...settings.animSettings },
    feed: { ...settings.feedSettings },
    chat: { ...settings.chatSettings },
    arcade,
    chrome: userChrome,
    plugins: collectPluginConfigs(pluginSpecs),
    camera: liveCam.camPolicy,
    mic: liveMic.micPolicy,
    sound: liveSound.soundOn,
    agent: sceneAgentLook(),
    dice: { ...settings.diceSettings, include: { ...settings.diceSettings.include } },
    autosave: true,
    ai: agent.aiPrefs(),
  };
}

function applySettings(s: ProfileSettings, flags: { keepLayout?: boolean } = {}): void {
  profiles?.adoptAutosave(s.autosave);
  for (const k of Object.keys(localStorage)) {
    if (/^zoto-viz\.(pong|invaders|command|frogger|cpupong|doom)\./.test(k)) localStorage.removeItem(k);
  }
  for (const [k, v] of Object.entries(s.arcade ?? {})) {
    if (/^zoto-viz\.(pong|invaders|command|frogger|cpupong|doom)\./.test(k)) localStorage.setItem(k, v);
  }
  for (const [mid, opts] of Object.entries(s.modeOptions ?? {})) {
    for (const [k, v] of Object.entries(opts)) localStorage.setItem(`zoto-viz.mode.${mid}.${k}`, v);
  }
  applyPluginConfigs(s.plugins);
  applyTheme(s.theme, s.theme !== theme.id);
  setDream(s.dream);
  userChrome = parseChrome(s.chrome);
  applyChrome(userChrome, false);
  const show = s.show;
  for (const key of Object.keys(showToggles) as (keyof typeof showToggles)[]) {
    const on = show[key] !== false;
    showToggles[key].checked = on;
    if (key === "labels") labelsChrome.checked = on;
    scene.setFilters({ [key]: on });
    mosaic?.eachGraph((g) => { if (g !== scene) g.setFilters({ [key]: on }); });
    localStorage.setItem(`zoto-viz.${key}`, on ? "1" : "0");
  }
  mergeToggle.checked = s.merge;
  localStorage.setItem("zoto-viz.merge", s.merge ? "1" : "0");
  setRedaction(s.redact);
  setAutoconsent(s.autoconsent);
  autoconsentToggle.checked = s.autoconsent;
  settings.setFilterText(s.filters);
  paintAgentLook(s.agent ?? { decos: [] });
  settings.applyAnim(s.anim);
  settings.applyFeed(s.feed);
  settings.applyChat(s.chat ?? settings.chatSettings);
  settings.applyDice(s.dice ?? settings.diceSettings);
  agent.applyAi(s.ai);
  if (s.camera) settings.setCamPolicy(s.camera);
  if (s.mic) settings.setMicPolicy(s.mic);
  settings.setSoundOn(!!s.sound);
  if (activeArcade) {
    arcade[activeArcade].view.stop();
    arcade[activeArcade].el.hidden = true;
    activeArcade = null;
    document.body.classList.remove("arcade");
    scene.setStageOnly(false);
  }
  applyMode(s.mode, { keepLayout: flags.keepLayout });
  if (lastRaw) feed(lastRaw);
  void syncWifiWatch();
  persistLive();
}

let aiBusy = false;
async function setAiCycle(on: boolean): Promise<void> {
  if (!profiles || aiBusy) return;
  aiBusy = true;
  try {
    if (on) {
      const st = await agent.probeOllama();
      const result = await profiles.activateAiCycle(collectSettings(), { model: st.model, online: st.online });
      if (result === "live") {
        invalidateSkyRecipe();
        await agent.setControl(true);
        agent.setCycleChecked(true);
      } else {
        await agent.setControl(false);
        agent.setCycleChecked(false);
      }
    } else {
      if (profiles.isAgent()) await profiles.deactivateAiCycle();
      await agent.setControl(false);
      agent.setCycleChecked(false);
    }
    applyViewLook();
    persistLive();
  } catch (e) {
    console.warn("zoto-viz AI cycle:", e);
    agent.setCycleChecked(false);
  } finally {
    aiBusy = false;
  }
}

const DICE_ROLL_MS = 450;
let diceBusy = false;
function liveAuthCtx(): AuthCtx {
  return {
    sdmLinked: !!lastRaw?.sdm?.linked,
    sdmPcmUrl: lastRaw?.sdm?.pcm_url,
    sources: lastRaw?.sources,
    cursorConfigured: agent.cursorReady(),
    typesafeConfigured: typeSafeKeyOn,
  };
}

function paintViewAuth(m: ViewMode, spec: PluginView | null): void {
  const block = viewAuthBlock({
    id: m.id,
    pluginId: m.pluginId,
    source: bindSourceOf(spec, parseSourceBind(optsFor(m)).source),
    capabilities: spec?.capabilities,
  }, liveAuthCtx());
  settings?.setAuthSetup(block, { pcmUrl: lastRaw?.sdm?.pcm_url });
}

function diceModes(): ViewMode[] {
  const allowed = new Set(viewSelectOptions().map((o) => o.value));
  const ctx = liveAuthCtx();
  const ready = allModes().filter((m) => {
    if (!allowed.has(m.id)) return false;
    if (!m.pluginId) return true;
    const spec = pluginSpecForMode(m.id);
    if (spec && pluginNeedsReview(spec) && !spec.consent) return false;
    if (viewAuthBlock({
      id: m.id,
      pluginId: m.pluginId,
      source: bindSourceOf(spec, parseSourceBind(optsFor(m)).source),
      capabilities: spec?.capabilities,
    }, ctx)) return false;
    return true;
  });
  if (ready.length) return ready;
  return allModes().filter((m) => {
    if (!allowed.has(m.id)) return false;
    const spec = pluginSpecForMode(m.id);
    return !viewAuthBlock({
      id: m.id,
      pluginId: m.pluginId,
      source: bindSourceOf(spec, parseSourceBind(optsFor(m)).source),
      capabilities: spec?.capabilities,
    }, ctx);
  });
}

async function rollDice(force: { view?: boolean } = {}): Promise<void> {
  if (diceBusy) return;
  diceBusy = true;
  diceBox.classList.add("rolling");
  try {
    const modes = diceModes();
    const cur = modeById(modeSel.value);
    const pinSky = !!(cur.stageOnly || lookForMode(cur.id)?.stageOnly || lookForMode(cur.id)?.backdrop === "plugin");
    const liveDice = settings.diceSettings;
    const dice = diceLookForRoll(liveDice, { pinSky, stageOnly: pinSky, forceView: force.view });
    let rolled = shuffleLook({ ...collectSettings(), dice }, {
      themes: THEMES.map((t) => t.id),
      modes: modes.map((m) => ({ id: m.id, options: m.options, config: m.config })),
      plugins: allModes().filter((m) => m.pluginId).map((m) => {
        const spec = pluginSpecForMode(m.id);
        const fields = pluginViewKnobs({ ...(spec ?? { id: m.pluginId!, name: m.label, version: 1 }), options: m.options, config: m.config }, m.config)
          .filter((f) => f.key !== "pics" || agent.cursorReady());
        return { id: spec ? `${spec.id}${spec.instanceId && spec.instanceId !== spec.id ? `:${spec.instanceId}` : ""}` : m.pluginId!, fields };
      }),
      skies: cycleSkyPool(),
      audioDrives: (liveMic.micPolicy === "off"
        ? AUDIO_DRIVES.filter((d) => d.value !== "mic")
        : AUDIO_DRIVES).map((d) => d.value),
    });
    if (dice.cycle) rolled = aiCycleSettings(rolled, { keepLook: true });
    rolled.mode = modeById(rolled.mode).id;
    rolled.dice = liveDice;
    applySettings(rolled);
    invalidateSkyRecipe();
    const startCycle = dice.cycle && !agent.cycleOn;
    window.setTimeout(() => {
      diceBox.classList.remove("rolling");
      diceBusy = false;
    }, DICE_ROLL_MS);
    if (startCycle) {
      await profiles?.writeAi(collectSettings(), agent.modelTag);
      await setAiCycle(true);
      applySettings(rolled);
    }
    await profiles?.writeAi(collectSettings(), agent.modelTag);
  } catch (e) {
    console.warn("zoto-viz dice:", e);
    diceBox.classList.remove("rolling");
    diceBusy = false;
  }
}
settings.onDice = () => { void rollDice(); };

// the panel sits under the header; keep its offset in sync with the header's wrapped height
const bar = $("bar");
observeResize(bar, syncChromeMetrics);

const LINK_KIND: Record<LinkStatus["kind"], string> = {
  wifi: "Wi-Fi", monitor: "monitor radio", bridge: "bridge", tunnel: "tunnel", ethernet: "Ethernet", gone: "gone",
};
const LED: Record<string, string> = { up: "ok", idle: "warn", degraded: "warn", down: "bad", unknown: "" };

/** Header line: a light per capture interface and one for the gateway, details in the tooltip. */
function renderNetLine(m: StateMsg): void {
  const net = $("net");
  if (!m.links?.length) {  // older monitor without link status
    const extra = (m.interfaces ?? []).filter((i) => i !== m.iface);
    net.textContent = `${m.iface}${extra.length ? ` +${extra.join(", ")}` : ""} · gw ${rIp(m.gateway)}`;
    return;
  }
  const now = m.ts;
  const light = (state: string, title: string, text: string) =>
    `<span class="if ${LED[state] ?? ""}" title="${escapeHtml(title)}"><i class="led"></i>${escapeHtml(text)}</span>`;
  const parts = m.links.map((l) => {
    const bits = [l.name];
    if (l.kind === "wifi") bits.push(l.ssid ? `Wi-Fi ${l.ssid}${l.chan ? ` ch${l.chan}` : ""}` : "Wi-Fi");
    else if (l.kind === "monitor") bits.push(`monitor radio${l.chan ? ` ch${l.chan}` : ""}`);
    else bits.push(LINK_KIND[l.kind] ?? l.kind);
    if (l.addrs.length) bits.push(l.addrs.filter((a) => !a.startsWith("fe80:")).map(rCidr).join(" "));
    if (l.state === "up") bits.push(`${l.pps} frames/s`);
    if (l.why) bits.push(l.why);
    else if (l.last_packet) bits.push(`last frame ${ago(l.last_packet, now)}`);
    return light(l.state, bits.join(" · "), l.name);
  });
  const g = m.gateway_status;
  const gbits = [`gateway ${rIp(m.gateway)}`];
  if (m.network) gbits.push(rCidr(m.network));
  if (!g || g.state === "unknown") gbits.push("not probed yet");
  else {
    gbits.push(g.rtt_ms != null ? `ping ${g.rtt_ms.toFixed(1)} ms` : g.last_ok ? `no ping reply (last ${ago(g.last_ok, now)})` : "no ping reply");
    gbits.push(g.neigh ? `neighbour ${g.neigh}${g.dev ? ` via ${g.dev}` : ""}${g.mac ? ` (${rMac(g.mac)})` : ""}` : "no neighbour entry");
    gbits.push(g.last_packet ? `last packet ${ago(g.last_packet, now)}` : "no packets seen");
  }
  parts.push(light(g?.state ?? "unknown", gbits.join(" · "), `gw ${rIp(m.gateway)}`));
  net.innerHTML = parts.join("");
}

function applyStats(m: StateMsg): void {
  lastState = m;
  renderNetLine(m);
  $("pps").textContent = Math.round(m.stats.pps).toLocaleString();
  $("bps").textContent = fmtBytes(m.stats.bps, true);
  let lan = 0, lanOn = 0, svc = 0, svcOn = 0;
  for (const d of m.devices) {
    if (d.role === "multicast") continue;
    if (d.role === "internet") { svc++; if (d.online) svcOn++; }
    else { lan++; if (d.online) lanOn++; }
  }
  $("lanDevs").textContent = String(lan);
  $("lanOnline").textContent = String(lanOn);
  $("netSvcs").textContent = String(svc);
  $("netOnline").textContent = String(svcOn);
  $("flows").textContent = String(m.stats.flows);
  $("active").textContent = String(m.stats.active_flows);
}

function connect(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const dot = $("conn");
  ws.onopen = () => {
    dot.classList.add("ok");
    void bootSession().then(() => profiles?.recover());
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data) as StateMsg;
    if (m.type !== "state") return;
    feed(m);
  };
  ws.onclose = () => { dot.classList.remove("ok"); setTimeout(connect, 2000); };
  ws.onerror = () => ws.close();
}

connect();

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === "Escape" && settings.isOpen) { settings.close(); return; }
  if (e.key === "Escape") scene.select(null);
  if (e.key === "r" || e.key === "R") setRedaction(!redaction.enabled);
  if (e.key === "d" || e.key === "D") setDream(!dreamToggle.checked);
  if (e.key === "f" || e.key === "F") settings.setFeedOn(!settings.feedSettings.on);
  if (e.key === "c" || e.key === "C") settings.setChatOn(!settings.chatSettings.on);
  if (e.key === "b" || e.key === "B") setDebug(!debugToggle.checked);
  if (e.key === "l" || e.key === "L") setLabels(!sysLabels.checked);
  if (e.key === "t" || e.key === "T") applyTheme(THEMES[(THEMES.findIndex((t) => t.id === theme.id) + (e.shiftKey ? THEMES.length - 1 : 1)) % THEMES.length].id, true);
  const idx = e.key === "0" ? 9 : Number(e.key) - 1;
  const modes = viewSelectOptions();
  if (idx >= 0 && idx < modes.length && !e.ctrlKey && !e.metaKey && !e.altKey) applyMode(modes[idx]!.value);
});
window.addEventListener("pagehide", () => persistLive(true));
