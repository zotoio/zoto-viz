import { AUDIO_DRIVES, NetScene, escapeHtml, type DreamAnim, type Filters } from "../graph/scene";
import { Panel } from "../ui/panel";
import { allModes, arcadeSlotFor, defaultCatalogMode, defaultOpts, hostEngine, modeById, type ViewMode } from "../core/modes";
import { flagMissingLayoutViews } from "./layout-missing-views";
import { ago, fmtBytes, type Device, type LinkStatus, type StateMsg } from "../core/types";
import { collapseByName } from "../core/collapse";
import { rCidr, rIp, rMac, redaction } from "../core/redact";
import { THEMES, alignThemeToColor, applyThemeChrome, themeById, themePickerGroup, themeSwatch, type Theme } from "../core/themes";
import { makePaneDiceButton, mountDiceSplit, morphCopy, Select, Toggle } from "../ui/ui";
import { Settings, makeViewCogButton } from "../ui/settings";
import {
  activateRemixPairing,
  deactivateRemix,
  hydrateRemixFromStorage,
  remixPairingActive,
} from "../remix/remix-runtime";
import { remixViewId, loadRemixPairing } from "../remix/remix-store";
import { illustratedSourceBind, parseSourceBind, sourceHeadlines } from "../core/sources";
import { bindSourceOf, viewAuthBlock, type AuthCtx } from "../core/auth-setup";
import { LiveFeed, feedViewShift } from "../ui/feed";
import { ChatPanel } from "../ui/chat";
import { DebugLog, readDebugOn } from "../ui/debug-log";
import { liveCam } from "../camera/livecam";
import { liveMic } from "../audio/want";
import { setMediaDeclineSink } from "../ui/media-ask";
import { liveSound } from "../audio/sound";
import { PluginSfx, setBackroomsSampleRev } from "../audio/plugin-sfx";
import { backroomsSlots } from "../../../plugins/src/backrooms/frontend/director";
import { deliverPluginPresentTick } from "../plugins/viz-present-tick";
import {
  activePluginSpec,
  presentDrive,
  refreshPluginDriveState,
} from "./present-drive-app";
import { applyModeImpl, showPickCouldntStart, type ApplyModeFlags, type ApplyModeHost, type MosaicAnimSnap } from "./apply-mode";
import type { ConsentReviewResult } from "./pack-consent";
import {
  consentErrorOf,
  consentGranted,
  consentStateOf,
  onConsentChange,
  requestConsent,
  seedConsent,
} from "./consent-store";
import {
  addModeSwitchAbortListener,
  beginModeSwitchAttempt,
  commitModeSwitchAttempt,
  removeModeSwitchAbortListener,
  getActiveModeSwitchSignal,
  throwIfAborted,
} from "./mode-switch-attempt";
import {
  getLastConsentedModeId,
  setLastConsentedModeId,
} from "./mode-switch-state";
import {
  beginCoordinatedModeSwitch,
  registerAutoSwitchRunner,
  registerDreamPulseReset,
  settleConsentAndDrainAuto,
  type ModeSwitchSource,
  type PendingAutoSwitch,
} from "./mode-switch-coordinator";
import { registerApplyModeTestBindings } from "./apply-mode-test-host";
import { registerMainEntryTestHooks } from "./main-entry-test-host";
import {
  flashModeKeptPrevious,
  flashModeLoadFailed,
  initModeSwitchStatusStrip,
} from "./mode-switch-message";
import { ProfileStore, aiCycleSettings, homeAiActive, quiet, SHIPPED_ID, type ProfileSettings } from "../core/profiles";
import {
  loadVizGovernorSetting,
  setVizGovernorSetting,
} from "../plugins/render-scale-governor-enable";
import {
  applyHostRenderScaleGovernor,
  bootRenderScaleGpuTimer,
  createVizGovernorToggle,
  refreshRenderScaleGovernorFromUrl,
  bindRenderScaleGovernorPresentListener,
  syncHostRenderGovernorForSpec,
  type RenderScaleGovernorHost,
} from "./render-scale-governor-wiring";
import { readSessionLive, writeSessionLive } from "../core/session-live";
import { diceLookForRoll, shuffleLook } from "../core/shuffle";
import { pickPaneDiceView } from "../graph/pane-dice";
import { usesFullDeviceTable } from "../graph/layout-budget";
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
import { bindTetrisStandaloneHost, unbindTetrisStandaloneHost } from "../arcade/tetris-standalone-host";
import { PortalView } from "../arcade/portal";
import { CarouselView } from "../arcade/carousel";
import { spawnArcade } from "../arcade/spawn";
import { Mosaic, mosaicPaneMode } from "../graph/mosaic";
import { mosaicTileViewId } from "../graph/mosaic-tile-id";
import { noteUserView, recentViewIds, setRecentViews } from "../plugins/recent-views";
import { hostModeById } from "./host-mode";
import { globalViewLeavesMosaic } from "./global-view";
import { mosaicPluginSkyPaneView } from "./mosaic-host-bindings";
import { RenderHost } from "../graph/render-host";
import {
  replacePluginConfigs,
  collectPluginConfigs,
  fetchPlugins,
  grantPluginConsent,
  installPlugins,
  bumpPluginCatalogRevision,
  loadPluginConfig,
  loadPluginConfigCached,
  pluginConfigCacheGeneration,
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
  pluginHasSky,
  pluginNeedsReview,
  pluginViewId,
  viewSelectOptions,
  viewPickerBanner,
  viewPickerOptions,
  writePluginConfig,
  configStoreId,
  pluginSpecForStoreId as lookupPluginSpecForStoreId,
  takePackInstallBlockedNotice,
  configStoreIdForMode,
  type PluginView,
} from "../plugins/plugin";
import {
  mayPushSandboxOnPluginFields,
  routePluginChangeSandboxPush,
  sandboxConfigPostMatchesLoaded,
  sandboxLoadedConfigStoreId,
  type PendingSandboxConfigPush,
} from "./plugin-sandbox-config-push-route";
import {
  PACK_BLOCKED_SELECT_VALUE,
  formatBlockedCatalogNotice,
  blockedCatalogEntries,
} from "../plugins/pack-install-surface";
import { BlockedInstallPanel } from "../plugins/pack-install-blocked-ui";
import { packConfigValues } from "../plugins/plugin-settings";
import { pluginOptsFromSpec } from "./plugin-mode-opts";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";
import {
  hudCaptionFromOpts,
  syncPluginHudForMode,
} from "../plugins/plugin-hud-sync";
import { MANIFEST_BLOCKED_VIEW_ID } from "../plugins/plugin-manifest-blocked";
import { bootPluginSettingsHost } from "./app-plugin-settings-boot";
import { applyMosaicLayoutFromAnim } from "./mosaic-layout-settings-wiring";
import { wirePluginFrontendAttach } from "./wire-settings-host";
import { SandboxConfigBatcher } from "./sandbox-config-batcher";
import { resolvePluginWall, type WallSnap } from "../plugins/plugin-wall";
import { dreamCycleModes, vizContractFor } from "../plugins/plugin";
import {
  VizBufferWriter, VizFrameBudget, VIZ_FRAME_BUDGET_MS, bindVizWriterCore, defaultVizContract,
  type VizDataFrame,
} from "../plugins/viz-host";
import {
  TILE_HEAL_FALLBACK_MODE,
  type HealStep,
} from "../plugins/tile-health";
import {
  TileHealthMonitor,
  readTileHealErrors,
  writeTileHealErrors,
} from "../plugins/tile-health-monitor";
import {
  TypeSafeHost,
  parseTypeSafeEnable,
  pluginHasTypeSafe,
  setTypeSafeProxyConfigured,
} from "../plugins/typesafe-host";
import { mainVizDeliver, mainVizBuildFrame } from "./viz-main-deliver";
import { runPackFrameHandler, syncVizPackRenderCanvas } from "../plugins/viz-pack-host";
import {
  mirrorMosaicTileCadenceFromPrimary,
  syncVizTileScope,
  vizTileBudgetRegistry,
} from "../plugins/viz-tile-budget";
import {
  easeStereoBins, STEREO_BINS, packStereoDrive, parseStereoTiming, stepStereoClock, stereoRate,
} from "../../../plugins/src/stereo-gram/frontend/drive";
import { buildStereoFrame, STEREO_FRAME_SLOTS } from "../../../plugins/src/stereo-gram/frontend/frame";
import { stereoAiFrame } from "../plugins/stereo-ai";
import { FeedTitleCube } from "../plugins/feed-title-cube";
import { NestCamsLive } from "../plugins/nest-cams-live";
import { parseHnRainLook } from "../../../plugins/src/hn-rain/frontend/crawl";
import { monoMs, type MonoMs } from "../core/viz-time";
import { applyInstance } from "../plugins/instances";
import { VIEW_PROMPT_KEY } from "../plugins/plugin-visualisation";
import { ignoreResizeLoopError, observeResize } from "../core/resize";
import { bootSession, apiFetch } from "../core/http";
import { bindServerRestartWallNotice } from "../core/http-notice";
import { mountWallNoticeRegion } from "../core/wall-notice-region";
import {
  applyPackFeedPaneNotice,
  clearTilePackFeed,
  markSandboxStartupFailed,
  markSandboxStartupOk,
  setTileExpectsVizFeed,
} from "../plugins/plugin-pack-feed";
import { registerPackAssetRetry } from "../plugins/pack-asset-frame";
import { syncPanelPackSub, releasePanelView } from "../graph/panel-view-lifecycle";
import { addPresentListener } from "../core/fps";
import { bindTileHealthPresentTick } from "./tile-health-present";
import { paintLiveBlankNotice } from "./live-blank-notice";
import { SkyLoads, SkyWaits, landWhenDrawn, type SkyLoadCtl } from "./sky-wait";
import { loadTilesSettlingEach } from "./sky-sync-tiles";
import { createProductionTileHealthMonitor } from "./tile-health-boot";
import { markPresent, presentInterval } from "../core/present-clock";
import { perfPinFromSearch, setPerfPinnedOff } from "../core/perf";
import { applyDevVizWallFlagsOnBuild, devVizWallTileCostBadInputMessage } from "../core/viz-dev-wall-flags";
import { bootNixieRealWallClock } from "../plugins/nixie-wall-parts";
import {
  bindMosaicTileBudgetLines,
  mosaicTileBudgetLines,
} from "./main-viz-tile-lines";
import { vizClockMs } from "../core/viz-clock";
import { broadcastPluginUbo } from "./viz-plugin-ubo";
import { AgentPanel, aiMosaicLayoutOn, CYCLE_KEY, type AgentLookInput } from "../ui/agent";
import { invalidateSkyRecipe, setSkyPrompt } from "../graph/sky-ai";
import { compileAgentSky } from "../graph/sky-agent";
import { normalizeAgentLook, type AgentLook, type DecoAt } from "../graph/deco";
import { isNasaStillDeco, isNasaStillUrl } from "../core/nasa-stills";
import { PluginSandbox, consentHash, tsPluginsAllowed, type PluginHostHandlers } from "../plugins/host";
import { autoconsentEligible, autoconsentEnabled, autoconsentKind, setAutoconsent } from "../plugins/consent";
import { captureHud, packView } from "../ui/capture";
import { createApplyAgentPatch } from "./agent-patch";
import { pluginIdleOf, withGoldenIfIdle, withGoldenSnapshot } from "../plugins/fixtures/golden-state";
import { applyFeedSlotPaints, paintFeedState } from "./feed-paint";
import { VizHud, isVizDemoPack, normalizeVizDemoPackId, type VizDemoPackId } from "../ui/viz-hud";
import { dropMosaicTileWriter } from "../graph/mosaic-viz-feed";
import { tickVizPresentDeliver, type VizPresentDeliverHost } from "./viz-present-deliver";
import {
  bindVizDriveElement,
  clearVizDrive,
  noteHostDirect,
} from "../plugins/viz-drive";
import { mosaicFocusSlot, revertModeSelection } from "./apply-mode-mosaic";
import { reconcileMosaicTilesWithMode, resolveRestoredViewMode } from "./boot-view-restore";
import { smokeBackroomsWallClock } from "../core/smoke-harness";
import { applyVizWriteBatch } from "../plugins/viz-write-batch";
import { notePackPerfPresent } from "./pack-perf-report";
import { createHostMeshBridge, tryApplyHostMeshBridge } from "./host-mesh-bridge";
import { recordPluginSkyLoad } from "./plugin-sky-load-meta";
import { installTileSkyShader } from "./plugin-sky-compile";
import { warnPluginSkyConsent } from "./plugin-sky-consent-notice";
import { hasKeptTileAnswer, showNeedsYou, waitForTileReview, type TileReviewRunner } from "./needs-you";
import { clearViewState, setViewState, setViewStateTileResolver, viewStateOf, viewStatePickerSuffix, viewStateViewId } from "./view-state";
import { bindCantDrawViewState } from "./cant-draw-state";
import { bindCantDrawSurface } from "./cant-draw-surface";
import { packNeedsConsent, shouldPromptPluginReview } from "./plugin-consent-mount";
import { hasConsentPending } from "./consent-pending-panes";
import { livePatchIsConsentOnly, mergePluginConsentLivePatch } from "./plugin-consent-live";
import { initPluginConsentSync } from "./plugin-consent-sync";
import { resumePendingConsentPaneSwitches } from "./mosaic-consent-resume";
import { switchPaneView, type SwitchPaneViewResult } from "./switch-pane-view";

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
// Each tile's cant-draw view state follows the host: lost context, Reload offered, drawn again, shader failures (#171 c).
bindCantDrawViewState(renderHost);
// One tile's shader failure gets its own "couldn't draw" line; a lost context is the wall notice's alone (#179 c).
bindCantDrawSurface((viewId, packId) => pluginSpecForMode(viewId)?.name ?? packId);
mountWallNoticeRegion($("wall"));
if (renderHost.software) document.body.dataset.softgl = "";
const scene = new NetScene($("scene"), { host: renderHost });
bootRenderScaleGpuTimer(scene, renderHost.gl);
const hostMeshBridge = createHostMeshBridge(() => sandboxDrivenScene(), (packId) => hostMeshCanPlace(packId));
scene.retargetPanel("main");
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
// #177: `?perf=off` pins the perf lean off (tune.k 0) for a deterministic session; read it with window.zotoviz.perfLean().
setPerfPinnedOff(perfPinFromSearch(window.location.search));
(window as unknown as { zotoviz: NetScene; znetviz: NetScene }).zotoviz = scene;
(window as unknown as { znetviz: NetScene }).znetviz = scene; // one-release alias
let mosaic: Mosaic | null = null;
let lastRaw: StateMsg | null = null;
let tileHealth: TileHealthMonitor | null = null;
let lastVizFrame: VizDataFrame | null = null;
let tileHealErrorsOn = readTileHealErrors();
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
  title: "settings profile — restores every setting last saved on it (~/.zoto-viz/profiles.yml)",
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
    void syncPluginSky(skySpecForMode(m.id, spec), getActiveModeSwitchSignal() ?? refreshPluginSignal.signal).catch(() => {});
    return;
  }
  const look = pin ? lookForMode(modeSel.value) : undefined;
  scene.setAnim(mergeLook(settings.animSettings, look));
  const m = modeById(modeSel.value);
  const spec = m.pluginId ? pluginSpecs.find((p) => p.id === m.pluginId) ?? null : null;
  // A sky that fails (fetch or compile) is logged and shown on its tile by installPluginSky.
  void syncPluginSky(skySpecForMode(m.id, spec), getActiveModeSwitchSignal() ?? refreshPluginSignal.signal).catch(() => {});
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
let catalogReady = false;
let settings!: Settings;
const sandbox = new PluginSandbox();
const pluginSfx = new PluginSfx();
let vizWriter: VizBufferWriter | null = null;
let vizFrameClockMs: MonoMs = monoMs(0);
const vizBudget = new VizFrameBudget();
let vizTileScopeKey = "";

function syncVizBudgetTileScope(): void {
  const ids = mosaic?.on ? mosaic.tileIds : ["main"];
  const scopeIds = ids.length ? ids : ["main"];
  const key = scopeIds.join("\0");
  if (key === vizTileScopeKey) return;
  vizTileScopeKey = key;
  applyDevVizWallFlagsOnBuild(location.search, scopeIds);
  vizHud.syncDevWallBadInputMessage(devVizWallTileCostBadInputMessage());
  syncVizTileScope(scopeIds);
  vizBudget.setTileId(mosaic?.on ? (mosaic.mainTileId || scopeIds[0] || "main") : "main");
  if (mosaic?.on) vizHud.syncMosaicTileHudLines(scopeIds);
  else vizHud.syncMosaicTileHudLines([]);
}
const typesafeHost = new TypeSafeHost();
let preserveVizUbo = false;
const vizHud = new VizHud($("scene"), (packId) => swapVizPack(packId));
const renderScaleGovernorHost: RenderScaleGovernorHost = {
  scene,
  get mosaic() { return mosaic; },
  pluginSpecForMode,
  vizHud,
};
refreshRenderScaleGovernorFromUrl();
bindRenderScaleGovernorPresentListener(renderScaleGovernorHost);
const pluginHudCaptions = new Map<string, string | null>();

function mosaicHudOn(): boolean {
  return !!(mosaic?.on && !document.body.classList.contains("stage-only"));
}

const syncMosaicPluginHudCaptions = bootPluginSettingsHost({
  modeById: hostModeById,
  pluginSpecForMode,
  optsFor,
  captions: pluginHudCaptions,
  getMosaicHost: () => (mosaic ? {
    on: mosaic.on,
    tileIds: mosaic.tileIds,
    setPaneSettingsCaption: (id, text) => mosaic!.setPaneSettingsCaption(id, text),
  } : null),
});

bindVizDriveElement("main", $("scene"));

function stagePresentAspect(): number {
  const a = scene.camera.aspect;
  return Number.isFinite(a) && a > 0 ? a : 16 / 9;
}

const presentDriveDeps = {
  sandbox,
  pluginClock: () => scene.skyTime(),
  stageAspect: stagePresentAspect,
};

function refreshPluginDriveForMode(spec: PluginView | null, modeId: string): void {
  refreshPluginDriveState(spec, modeId, presentDriveDeps);
}

addPresentListener((ts) => {
  const mode = modeById(modeSel.value);
  const packId = normalizeVizDemoPackId(mode.pluginId ?? tsWatchId);
  if (packId) vizBudget.markPresent(ts);
  notePackPerfPresent(ts, presentInterval);
  deliverPluginPresentTick(presentDrive, ts);
  if (mode.pluginId === "backrooms") {
    pluginSfx.syncBackroomsViewConfig(currentOpts);
    pluginSfx.setBackrooms(scene.skyTime());
  } else pluginSfx.silence();
});
addPresentListener(markPresent);
let stereoBins: number[] = [];
let stereoBinsAt = 0;
scene.afterLook = () => {
  const mode = modeById(modeSel.value);
  if (mode.pluginId === "backrooms" && vizWriter) {
    // The director owns camera, creature and maze on the sky clock; the sound bed reads the same track.
    pluginSfx.syncBackroomsViewConfig(currentOpts);
    scene.setHeard(false);
    const drive = backroomsSlots(
      scene.skyTime(),
      smokeBackroomsWallClock() ?? new Date(),
      innerWidth / Math.max(1, innerHeight),
    );
    vizWriter.writeBuffer(0, drive.slot0);
    vizWriter.writeBuffer(1, drive.slot1);
    broadcastPluginUbo(scene, vizWriter.ubo, mosaic?.on ? mosaic : null);
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
  broadcastPluginUbo(scene, vizWriter.ubo, mosaic?.on ? mosaic : null);
};
/** The mosaic tile the single sandbox drives ("main" outside the mosaic). */
function sandboxVizTileId(): string {
  if (!mosaic?.on) return "main";
  return mosaic.tileIds.includes(modeSel.value) ? modeSel.value : mosaicFocusSlot(mosaic) || "main";
}
/** The scene on screen for that tile: in a mosaic each pane has its own NetScene. */
function sandboxDrivenScene(): NetScene {
  const tile = sandboxVizTileId();
  return (tile !== "main" && mosaic?.on ? mosaic.graphScene(tile) : null) ?? scene;
}
/** Host meshes only for the current view's pack, and for a sandboxed pack only once its frame is ready. */
function hostMeshCanPlace(packId: string): boolean {
  const current = pluginSpecForMode(modeSel.value);
  if (current?.id !== packId) return false;
  return !pluginHasFrontend(current) || sandbox.readyPack === packId;
}
/** Mosaic pane showing a sandboxed pack that the single sandbox is not driving. */
function mosaicPanePreviewOnly(tileId: string): boolean {
  if (!mosaic?.on || tileId === "main" || tileId === modeSel.value) return false;
  return pluginHasFrontend(pluginSpecForMode(tileId));
}
function bindVizWriter(spec: PluginView | null, preserveUbo = false): void {
  const contract = vizContractFor(spec) ?? (spec?.capabilities?.some((c) => c === "viz.write")
    ? defaultVizContract() : undefined);
  const { writer, resetFrameTs, resetBudget } = bindVizWriterCore(vizWriter, contract, preserveUbo);
  vizWriter = writer;
  if (resetFrameTs) vizFrameClockMs = monoMs(0);
  if (resetBudget) {
    vizBudget.reset();
    vizHud.resetSkipBaseline();
  }
  if (writer && preserveUbo && !resetFrameTs) broadcastPluginUbo(scene, writer.ubo, mosaic?.on ? mosaic : null);
  refreshPluginDriveForMode(spec ?? activePluginSpec, modeSel.value);
  syncHostRenderGovernorForSpec(renderScaleGovernorHost, spec);
  void hostMeshBridge.mountPack(spec);
}
function swapVizPack(packId: VizDemoPackId): void {
  if (modeById(pluginViewId(packId)).id === modeSel.value) return;
  preserveVizUbo = true;
  applyMode(pluginViewId(packId), {}, { channel: "user" });
}
sandbox.handlers = {
  setStyle: (s: Record<string, unknown>) => scene.setPluginStyle(s),
  setNodeColor: (id: string, hex: number) => scene.setPluginNodeColor(id, hex),
  writeBuffer: (slot: number, data: number[]) => {
    tileHealth?.noteSandboxWrite();
    if (vizWriter?.writeBuffer(slot, data).ok) {
      broadcastPluginUbo(scene, vizWriter.ubo, mosaic?.on ? mosaic : null);
      tryApplyHostMeshBridge(
        hostMeshBridge,
        activePluginSpec,
        vizContractFor(activePluginSpec),
        slot,
        data,
      );
    }
  },
  writeUniform: (name: string, value: import("../plugins/viz-host").VizUniformValue) => {
    tileHealth?.noteSandboxWrite();
    if (vizWriter?.writeUniform(name, value).ok) scene.setPluginUniform(name, value);
  },
  writeParticles: (data: number[], stride?: number) => {
    tileHealth?.noteSandboxWrite();
    vizWriter?.writeParticles(data, stride);
  },
  writeBatch: (batch: import("../plugins/viz-write-batch").VizWriteBatchPayload) => {
    if (!vizWriter) return;
    const contract = vizContractFor(activePluginSpec);
    applyVizWriteBatch(vizWriter, batch, {
      onBuffer: () => {
        tileHealth?.noteSandboxWrite();
        broadcastPluginUbo(scene, vizWriter!.ubo, mosaic?.on ? mosaic : null);
      },
      onUniform: (name, value) => {
        tileHealth?.noteSandboxWrite();
        scene.setPluginUniform(name, value);
      },
    });
    for (const b of batch.buffers) {
      tryApplyHostMeshBridge(hostMeshBridge, activePluginSpec, contract, b.slot, b.data);
    }
  },
  drawState: (drawing: boolean) => tileHealth?.setPackDrawingNothing(!drawing),
  loseHostContext: () => renderHost.recreateContext(),
} as PluginHostHandlers;
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
  title: "view mode (keys 1–9, 0 for the 10th). Your last 10 picks stay at the top. Type to filter.",
  filterable: true,
  options: viewPickerOptions(),
  onChange: (id) => applyMode(id, {}, { channel: "user" }),
});
$("modeBox").append(modeSel.el);
modeSel.setBanner(viewPickerBanner());

/** #169: header picker rows (unavailable packs greyed out, after the rest) plus the setup banner. */
function setHeaderPickerOptions(): void {
  modeSel.setOptions(pickerOptions());
  modeSel.setBanner(viewPickerBanner());
}
const blockedInstallPanel = new BlockedInstallPanel({
  onCatalogRefresh: () => syncPluginCatalog(),
});
$("modeBox").append(blockedInstallPanel.el);
const feedTitleCube = new FeedTitleCube($("wall"));

const vizPresentHost: VizPresentDeliverHost = {
  modeById,
  modeSelValue: () => modeSel.value,
  get pluginSpecs() { return pluginSpecs; },
  tsWatchId: () => tsWatchId,
  mosaic,
  scene,
  renderHost,
  sandbox,
  vizBudget,
  getVizWriter: () => vizWriter,
  bindVizWriter: (spec) => bindVizWriter(spec),
  vizHud,
  optsFor,
  mosaicTileViewId,
  pluginSpecForMode,
  syncPanelPackSub,
  feedTitleCube,
  getVizFrameClockMs: () => vizFrameClockMs,
  setVizFrameClockMs: (ms) => { vizFrameClockMs = ms; },
  syncVizBudgetTileScope,
  renderScaleGovernor: renderScaleGovernorHost,
  noteVizWrite: () => tileHealth?.noteVizWrite(),
  onVizFrameDelivered: (frame) => {
    lastVizFrame = frame;
    tileHealth?.noteVizFrameDelivered();
  },
};

function shownForVizDeliver(): StateMsg | null {
  if (!lastRaw) return null;
  const curMode = modeById(liveMode || modeSel.value);
  const curSpec = curMode.pluginId ? pluginSpecForMode(curMode.id) : null;
  let shown = withGoldenIfIdle(lastRaw, pluginIdleOf(curSpec));
  if (mergeToggle.checked) shown = collapseByName(lastRaw).msg;
  return shown;
}

addPresentListener(() => {
  const shown = shownForVizDeliver();
  if (shown) tickVizPresentDeliver(shown, vizPresentHost);
});

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

function sandboxPluginConfig(spec: PluginView): Record<string, string> {
  return packConfigValues(loadPluginConfigCached(spec, pluginViewKnobs(spec)));
}

const sandboxConfigBatcher = new SandboxConfigBatcher(
  (storeId, config) => {
    if (sandboxConfigPostMatchesLoaded(storeId, tsWatchStoreId)) sandbox.setConfig(config);
  },
  (cb) => requestAnimationFrame(cb),
  (id) => cancelAnimationFrame(id),
);

function scheduleSandboxSetConfig(storeId: string, config: Record<string, string>): void {
  sandboxConfigBatcher.schedule(storeId, config);
}

function cancelScheduledSandboxConfig(): void {
  sandboxConfigBatcher.cancel();
}

function settingsTargetModeId(): string {
  const focus = settings?.viewFocus?.trim();
  return focus || modeSel.value;
}

function onPluginFields(flags: { skipSandboxPush?: boolean } = {}): void {
  const modeId = settingsTargetModeId();
  const m = hostModeById(modeId);
  const opts = optsFor(m);
  currentOpts = opts;
  setSkyPrompt(m.pluginId ?? m.id, opts[VIEW_PROMPT_KEY] ?? "");
  if (mosaic?.on) {
    const focus = mosaic.focusedId || mosaic.mainMode;
    if (focus) noteTileHealthGrace(focus);
  } else {
    noteTileHealthGrace("main");
  }
  nestCams.setLook(opts);
  if (m.pluginId === "carousel") (arcade.carousel.view as CarouselView).setBind(opts);
  if (mosaic?.on && !(m.pluginId && m.standalone)) setSceneMode(mosaic.graphScene(m.id), m, opts);
  else setSceneMode(scene, m, opts);
  renderLegend(m, opts);
  const spec = pluginSpecForMode(m.id);
  if (!flags.skipSandboxPush && spec && pluginHasFrontend(spec)) {
    const loadedStore = sandboxLoadedConfigStoreId(
      tsWatchStoreId,
      tsWatchStoreId ? pluginSpecForStoreId(tsWatchStoreId) : null,
    );
    if (mayPushSandboxOnPluginFields(loadedStore, spec)) {
      scheduleSandboxSetConfig(configStoreId(spec), sandboxPluginConfig(spec));
    }
  }
  if (mosaic?.on && spec) {
    const store = configStoreId(spec);
    for (const tileId of mosaic.tileIds) {
      if (configStoreIdForMode(tileId) !== store) continue;
      const pm = hostModeById(tileId);
      setSceneMode(mosaic.graphScene(tileId), pm, optsFor(pm));
    }
  }
  syncPluginHudForMode(m, spec, pluginHudCaptions, vizHud, mosaicHudOn());
  syncMosaicPluginHudCaptions();
  const cap = pluginHudCaptions.get(m.id);
  morphCopy($("hint"), cap ? `${spec?.name ?? m.label} · ${cap}` : m.hint);
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

let modeOptsCacheGen = -1;
const modeOptsCache = new Map<string, Record<string, string>>();

function optsFor(m: ViewMode): Record<string, string> {
  const gen = pluginConfigCacheGeneration();
  if (gen !== modeOptsCacheGen) {
    modeOptsCacheGen = gen;
    modeOptsCache.clear();
  }
  const cached = modeOptsCache.get(m.id);
  if (cached) return cached;
  const o = defaultOpts(m);
  if (m.pluginId) {
    const spec = pluginSpecForMode(m.id);
    if (spec) Object.assign(o, pluginOptsFromSpec(m, spec));
  } else {
    for (const opt of m.options ?? []) {
      const saved = localStorage.getItem(`zoto-viz.mode.${m.id}.${opt.key}`);
      if (saved !== null && opt.values.some(([v]) => v === saved)) o[opt.key] = saved;
    }
  }
  const frozen = Object.freeze(o);
  modeOptsCache.set(m.id, frozen);
  return frozen;
}

function arcadeControls(m: ViewMode): HTMLElement[] {
  const slot = arcade[m.arcadeId ?? ""];
  return slot ? [...slot.view.controls] : [];
}

function bindThisView(modeId: string): void {
  if (settings?.consumePreserveViewBind()) return;
  if (modeId === MANIFEST_BLOCKED_VIEW_ID) {
    settings?.bindManifestBlockedCatalog(() => refreshPluginCatalogAndResume());
    settings?.setAuthSetup(null);
    return;
  }
  const m = modeById(modeId);
  const spec = m.pluginId ? pluginSpecForMode(m.id) : null;
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
let tsWatchStoreId = "";
let tsWatchHash = "";

const refreshPluginSignal = new AbortController();

let ensureReviewedOverride: ((spec: PluginView | null, signal: AbortSignal) => Promise<ConsentReviewResult>) | null = null;
let reviewOverride: TileReviewRunner | null = null;

/** After any grant: the catalog row (not a copy) learns its sky may load, and tiles get a heal grace. */
function afterConsentGranted(packId: string): void {
  const raw = pluginSpecs.find((p) => p.id === packId);
  if (raw) {
    if (raw.hash) consentHash(raw.id, raw.hash);
    if (raw.has_sky_shader || raw.shader_sha256) raw.sky_available = true;
  }
  noteTileHealthGrace("main");
  mosaic?.tileIds.forEach((id) => noteTileHealthGrace(id));
}

type EnsureReviewedOpts = {
  /**
   * false: do not wait on the tile's Review (mosaic pane picks paint Needs you on the pane and
   * resume on the OK). An OK already given on a settled tile is still taken.
   */
  wait?: boolean;
};

/**
 * No modal: the operator answers on the tile (Needs you → Review). The review wait also ends when
 * the pack is granted elsewhere (Settings, live patch), so the view starts in place either way.
 */
/**
 * Auto-consent grants this pack without asking: on, eligible origin, and (option (a)) never an
 * incomplete record, which stays Needs you ("needs your OK again") until the operator reviews it.
 */
function willAutoConsent(spec: PluginView): boolean {
  return autoconsentEnabled() && autoconsentEligible(spec) && consentStateOf(spec) !== "stale";
}

async function ensureReviewedImpl(
  spec: PluginView | null,
  signal: AbortSignal,
  opts: EnsureReviewedOpts = {},
): Promise<ConsentReviewResult> {
  if (!spec || !pluginNeedsReview(spec)) return "ok";
  if (consentGranted(spec)) return "ok";
  if (!shouldPromptPluginReview(spec, catalogReady)) return "aborted";
  const packId = spec.id;
  const auto = willAutoConsent(spec);
  if (!auto && opts.wait === false && !reviewOverride && !hasKeptTileAnswer(packId)) return "declined";
  const out = await requestConsent(spec, async (reviewSignal) => {
    let kind: "reviewed" | "authored" | null;
    if (auto) {
      kind = autoconsentKind(spec);
    } else {
      kind = reviewOverride
        ? await reviewOverride(spec, { signal: reviewSignal, state: consentStateOf(spec) })
        : await waitForTileReview(spec, reviewSignal);
      if (!kind) return "declined";
    }
    // Granted elsewhere while the tile waited: nothing to send again.
    if (!consentGranted(spec)) await grantPluginConsent(packId, kind);
    return kind;
  }, signal);
  if (out === "ok") afterConsentGranted(packId);
  else if (out === "failed") console.warn("zoto-viz plugin consent:", packId, consentErrorOf(packId));
  return out;
}

function hostTileConfig(): Record<string, string> {
  const canvas = document.querySelector("canvas.render-host") as HTMLCanvasElement | null;
  const w = canvas?.width ?? 0;
  const h = canvas?.height ?? 0;
  return {
    hostTileW: String(w > 64 ? w : 1280),
    hostTileH: String(h > 64 ? h : 800),
  };
}

async function ensureReviewed(
  spec: PluginView | null,
  signal: AbortSignal,
  opts?: EnsureReviewedOpts,
): Promise<ConsentReviewResult> {
  if (ensureReviewedOverride) return ensureReviewedOverride(spec, signal);
  return ensureReviewedImpl(spec, signal, opts);
}

async function loadTsPlugin(spec: PluginView | null, signal: AbortSignal): Promise<void> {
  const vizTileId = sandboxVizTileId();
  if (!pluginHasFrontend(spec) || !spec?.hash) {
    sandbox.unload();
    clearVizDrive(vizTileId);
    bindVizWriter(spec);
    scene.clearPluginStyle();
    tsWatchId = spec?.id ?? "";
    tsWatchStoreId = spec ? configStoreId(spec) : "";
    return;
  }
  if (!tsPluginsAllowed()) {
    sandbox.unload();
    clearVizDrive(vizTileId);
    bindVizWriter(spec);
    scene.clearPluginStyle();
    tsWatchId = spec?.id ?? "";
    tsWatchStoreId = spec ? configStoreId(spec) : "";
    return;
  }
  if (packNeedsConsent(spec)) {
    console.warn("zoto-viz plugin frontend: needs review before module load", spec.id);
    markPluginNeedsReview(spec);
    sandbox.unload();
    clearVizDrive(vizTileId);
    bindVizWriter(null);
    scene.clearPluginStyle();
    tsWatchId = "";
    tsWatchStoreId = "";
    paintPluginNeedsReviewNotice(spec, mosaic?.on ? modeSel.value : undefined);
    return;
  }
  const tileId = "main";
  const packLabel = spec.name ?? spec.id;
  const { beginUserPackLoadSession } = await import("../plugins/pack-asset-navigation");
  beginUserPackLoadSession(tileId);
  sandbox.setActivePackLabel(packLabel);
  setTileExpectsVizFeed(tileId, !!(spec.capabilities?.includes("viz.read") || spec.capabilities?.includes("viz.write")));
  clearTilePackFeed(tileId);
  const mosaicHost = mosaic as import("../plugins/plugin-pack-feed").MosaicNoticeHost & {
    focusPaneTile?: (id: string) => void;
    setWallNotice?: (text: string | null | undefined) => void;
  } | null;
  registerPackAssetRetry(tileId, packLabel, () => {
    void import("../plugins/pack-asset-rebuild").then(({ retryPackAssetProtectedLoad }) =>
      retryPackAssetProtectedLoad(tileId, packLabel, mosaicHost, async () => {
        await attachPluginFrontend(sandbox, spec, loadPluginConfig(spec, spec.config));
      }),
    );
  });
  try {
    throwIfAborted(signal);
    const { runPackAssetProtectedLoad } = await import("../plugins/pack-asset-rebuild");
    await runPackAssetProtectedLoad(
      tileId,
      packLabel,
      mosaicHost,
      async () => {
        await wirePluginFrontendAttach(sandboxConfigBatcher, () =>
          attachPluginFrontend(sandbox, spec, { ...sandboxPluginConfig(spec), ...hostTileConfig() }, signal),
        );
      },
    );
    throwIfAborted(signal);
    markSandboxStartupOk(tileId);
    const preserve = preserveVizUbo && isVizDemoPack(tsWatchId) && isVizDemoPack(spec.id);
    preserveVizUbo = false;
    bindVizWriter(spec, preserve);
    tsWatchId = spec.id;
    tsWatchStoreId = configStoreId(spec);
    tsWatchHash = spec.hash;
    if (pendingSandboxPush?.storeId === configStoreId(spec)) {
      scheduleSandboxSetConfig(pendingSandboxPush.storeId, pendingSandboxPush.config);
      pendingSandboxPush = null;
    }
    const m = modeById(modeSel.value);
    if (m.pluginId === spec.id) {
      syncPluginHudForMode(m, spec, pluginHudCaptions, vizHud, mosaicHudOn());
      syncMosaicPluginHudCaptions();
    }
    if (!tsWatch) tsWatch = window.setInterval(() => void refreshTsPlugin(), 2500);
  } catch (e) {
    if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      sandbox.unload();
      throw e;
    }
    console.warn("zoto-viz plugin runtime:", e);
    markSandboxStartupFailed(tileId);
    applyPackFeedPaneNotice(mosaic as import("../plugins/plugin-pack-feed").MosaicNoticeHost | null, tileId, packLabel);
    sandbox.unload();
    scene.clearPluginStyle();
    throw e;
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
        seedConsent(next);
        const reviewed = await ensureReviewed(spec, refreshPluginSignal.signal);
        if (reviewed !== "ok") return;
        await loadTsPlugin(spec, refreshPluginSignal.signal);
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
  const canonical = mosaicTileViewId(modeId);
  const id = parsePluginId(canonical);
  if (!id) return null;
  const raw = pluginSpecs.find((p) => p.id === id);
  if (!raw) return null;
  const inst = parsePluginInstance(canonical);
  if (!inst || inst === raw.id) return { ...raw, instanceId: inst || raw.id };
  const row = (raw.instances ?? []).find((i) => i.id === inst);
  return row ? applyInstance(raw, row) : { ...raw, instanceId: inst };
}

function tileHealthModeId(tileId: string): string {
  return tileId === "main" ? modeSel.value : tileId;
}

function tileHealthAwaitingApproval(tileId: string): boolean {
  const m = modeById(tileHealthModeId(tileId));
  const spec = m.pluginId ? pluginSpecForMode(m.id) : null;
  if (packNeedsConsent(spec)) return true;
  return !!viewAuthBlock({
    id: m.id,
    pluginId: m.pluginId,
    source: bindSourceOf(spec, parseSourceBind(optsFor(m)).source),
    capabilities: spec?.capabilities,
  }, liveAuthCtx());
}

function noteTileHealthGrace(tileId: string): void {
  tileHealth?.noteGrace(tileId);
}

function graphMsgForTile(tileId: string, msg: StateMsg): StateMsg {
  const modeId = tileId === "main" ? modeSel.value : tileId;
  const spec = pluginSpecForMode(modeId);
  if (tileHealth?.forceDemo(tileId)) return withGoldenSnapshot(msg, pluginIdleOf(spec));
  return msg;
}

/** Mosaic extras keep their own look; a wall row's plugin sky wins over a sky-less hero. */
function skySpecForMode(modeId: string, fallback: PluginView | null): PluginView | null {
  const selected = fallback ?? pluginSpecForMode(modeId);
  if (mosaic?.on) {
    const pane = mosaic.mainTileId || mosaic.focusedId;
    return pickPluginSkySpec(selected, pane ? pluginSpecForMode(pane) : null);
  }
  return selected;
}

const PLUGIN_NEEDS_REVIEW_MSG = "needs review";

/** Picker rows: a pack still waiting on the operator's OK ends in "needs OK". */
function pickerOptions(): ReturnType<typeof viewPickerOptions> {
  const needsOk = viewStatePickerSuffix({ kind: "needs-you", reason: "consent", packId: "" });
  return viewPickerOptions((id) => {
    const spec = parsePluginId(mosaicTileViewId(id)) ? pluginSpecForMode(id) : null;
    return spec && packNeedsConsent(spec) ? needsOk : null;
  });
}

/** A grant (here, in Settings, or from the monitor) drops "needs OK" from the picker at once. */
let pickerRefreshQueued = false;
onConsentChange(() => {
  if (pickerRefreshQueued) return;
  pickerRefreshQueued = true;
  queueMicrotask(() => {
    pickerRefreshQueued = false;
    setHeaderPickerOptions();
  });
});

/** Solo tile "main" is the scene; a mosaic tile is its pane (same keys as the sky waits). */
setViewStateTileResolver((tileId) => skyWaitHostEl(tileId));

function markPluginNeedsReview(spec: PluginView): void {
  spec.sky_error = PLUGIN_NEEDS_REVIEW_MSG;
  spec.sky_available = false;
}

/**
 * Needs you on the tile that wanted this pack: the solo wall ("main"), or the mosaic pane. Review
 * there starts the view in place once approved (no reload, never another view).
 */
function paintPluginNeedsReviewNotice(spec: PluginView, paneId?: string): void {
  // Auto-consent resolves before any notice is written (UX Pro): while a switch is picking this
  // pack, its own review path grants it and then loads it, so nothing may paint Needs you here.
  if (willAutoConsent(spec) && getActiveModeSwitchSignal()) return;
  if (mosaic?.on) {
    // The wall view's own pack (Syscon, Cypher CIC): Needs you names the wall view on its wall's
    // main tile, and Review re-applies the wall view (#172), never the tile's own view.
    const wall = wallOwner && !mosaic.tileIds.includes(wallOwner) && pluginSpecForMode(wallOwner)?.id === spec.id ? wallOwner : null;
    const wallTile = wall ? wallMainTile() : null;
    if (wall && wallTile) {
      showNeedsYou({ tileId: wallTile, viewId: wall, spec, restart: () => applyMode(wall) });
      return;
    }
    const pane = paneId && mosaic.tileIds.includes(paneId) ? paneId : mosaicFocusSlot(mosaic);
    if (!pane) return;
    showNeedsYou({
      tileId: pane,
      viewId: mosaicTileViewId(pane),
      spec,
      restart: () => { void runMosaicPaneSwitch(pane, pane); },
    });
    return;
  }
  const viewId = modeSel.value;
  showNeedsYou({ tileId: "main", viewId, spec, restart: () => applyMode(viewId) });
}

async function loadPluginSkyOnto(
  target: NetScene,
  spec: PluginView | null,
  pinPlugin: boolean,
  signal: AbortSignal,
  paneId?: string,
): Promise<void> {
  // A superseded sync never touches this tile's sky, card or wait; the newest sync decides.
  if (signal.aborted) return;
  const lookOpts = spec ? (lookForMode(pluginViewId(spec.id, spec.instanceId)) ?? spec.look) : undefined;
  const want = pinPlugin && !!spec && lookOpts?.backdrop === "plugin" && (spec.has_sky_shader === true || !!spec.shader_sha256);
  const packKey = want && spec ? `${spec.id}:${spec.shader_sha256 || ""}` : "";
  if (target === scene && packKey && packKey === skyLoaded) return;
  if (!want || !spec) {
    cancelSkyWait(target, paneId);
    if (target === scene && skyLoaded) {
      scene.setPluginShader(null);
      skyLoaded = "";
    } else if (target !== scene) {
      target.setPluginShader(null);
    }
    return;
  }
  if (packNeedsConsent(spec)) {
    cancelSkyWait(target, paneId);
    warnPluginSkyConsent(spec.id);
    markPluginNeedsReview(spec);
    target.setPluginShader(null);
    if (target === scene) skyLoaded = "";
    if (target === scene || (mosaic?.on && paneId)) paintPluginNeedsReviewNotice(spec, paneId);
    return;
  }
  // Already on this tile: nothing to fetch or compile again.
  if (skyInstalled.get(target) === packKey && target.pluginSkyId === spec.id) return;
  // One request per tile per sky: concurrent syncs (mode apply, pane mount, refresh) share it.
  // The newest caller owns the load and the tile's wait from here on.
  const waitKey = skyWaitKey(target, paneId);
  if (waitKey) skyWaits.own(waitKey, signal);
  return skyLoads.share(target, packKey, signal, (ctl) =>
    installPluginSky(target, spec, packKey, lookOpts, ctl, paneId));
}

/**
 * One network request per sky at a time, shared by every caller and tile. Not tied to any one
 * caller's signal: a superseded sync (boot re-apply, mode switch) drops its interest after the await
 * instead of cancelling a request the next sync would repeat.
 */
const skyFetches = new Map<string, Promise<string>>();
function fetchSkyOnce(id: string, hash?: string): Promise<string> {
  const key = `${id}:${hash || ""}`;
  const cur = skyFetches.get(key);
  if (cur) return cur;
  console.info(`[zoto-viz sky] step=request pack=${id}`);
  const p = fetchPluginSky(id, hash);
  skyFetches.set(key, p);
  const clear = () => {
    if (skyFetches.get(key) === p) skyFetches.delete(key);
  };
  p.then(clear, clear);
  return p;
}

/** Tiles' installed sky (packKey) and in-flight sky loads, so each sky is requested once per tile. */
const skyInstalled = new WeakMap<NetScene, string>();
const skyLoads = new SkyLoads<NetScene>();

async function installPluginSky(
  target: NetScene,
  spec: PluginView,
  packKey: string,
  lookOpts: Parameters<typeof recordPluginSkyLoad>[0]["look"],
  ctl: SkyLoadCtl,
  paneId?: string,
): Promise<void> {
  const signal = ctl.signal();
  const waitKey = skyWaitKey(target, paneId);
  if (target.pluginSkyDrawn !== spec.id) beginSkyWait(waitKey, target, spec, paneId, signal);
  const disposeSky = () => {
    // A newer sync took this load over; its own abort (not this one) decides.
    if (ctl.signal() !== signal || !ctl.current()) return;
    target.setPluginShader(null);
    skyInstalled.delete(target);
    if (target === scene) skyLoaded = "";
  };
  addModeSwitchAbortListener(signal, disposeSky, { once: true });
  try {
    recordPluginSkyLoad({ packId: spec.id, packKey: packKey, isShaderPack: true, look: lookOpts });
    const source = await fetchSkyOnce(spec.id, spec.shader_sha256);
    throwIfAborted(ctl.signal());
    // A Retry started a newer load for this tile; that one installs the sky.
    if (!ctl.current()) return;
    // With its pack, so a sky that fails to compile lands on the tile as cant-draw / shader (#171 c).
    const err = installTileSkyShader(target, spec, source, packKey);
    if (err) {
      console.warn("zoto-viz plugin sky:", err);
      spec.sky_error = err;
      spec.sky_available = false;
      throw new Error(err);
    }
    spec.sky_available = true;
    delete spec.sky_error;
    skyInstalled.set(target, packKey);
    if (target === scene) skyLoaded = packKey;
    // The card stays until a frame with the sky is actually drawn (first-use compile included).
    if (waitKey) landWhenDrawn(skyWaits, waitKey, target, spec.id);
    // Check the pane again now its own sky is on it: a Retry's sky lands after the sync that
    // settled this pane (fault no-sky), and nothing else would clear its warming state.
    if (mosaic?.on && paneId) mosaic.settlePane(paneId);
  } catch (e) {
    const owner = ctl.signal();
    if (waitKey && ctl.current()) skyWaits.cancelOwned(waitKey, owner);
    if (owner.aborted) return;
    // A failed install (#203) has already dropped the tile's previous sky (the backdrop clears it
    // on a compile error) and may have left the host's fallback up: nothing on the tile is known to
    // be installed any more. The next pick of any sky, the one that was up before included, must
    // install it, and a pick with no sky must still clear this one, so skyLoaded names the failure.
    if (ctl.current()) {
      skyInstalled.delete(target);
      if (target === scene) skyLoaded = `${packKey}#failed`;
    }
    console.warn("zoto-viz plugin sky:", e);
    removeModeSwitchAbortListener(signal, disposeSky);
    throw e;
  }
}

/**
 * Tiles waiting on their own view's sky: "Starting…" card, then "couldn't start. Retry" at the
 * deadline. The heal ladder skips them (tile-health `skyStarting`), so a slow or stuck pack sky
 * never becomes a stand-in or another pack.
 */
const skyWaitTiles = new Map<string, { target: NetScene; spec: PluginView; paneId?: string }>();
const skyWaits = new SkyWaits({
  hostEl: (key) => skyWaitHostEl(key),
  name: (key) => {
    const w = skyWaitTiles.get(key);
    return w ? w.spec.name || w.spec.id : "";
  },
  viewId: (key) => {
    if (mosaic?.on) return mosaicTileViewId(key);
    if (key === "main") return modeSel.value;
    const w = skyWaitTiles.get(key);
    return w ? pluginViewId(w.spec.id, w.spec.instanceId) : key;
  },
  packId: (key) => skyWaitTiles.get(key)?.spec.id ?? key,
  skyReady: (key) => {
    const w = skyWaitTiles.get(key);
    return !!w && w.target.pluginSkyDrawn === w.spec.id;
  },
  retry: (key) => {
    const w = skyWaitTiles.get(key);
    if (!w) return;
    console.info(`[zoto-viz sky] tile=${key} step=retry`);
    skyLoads.forget(w.target); // a stuck request doesn't absorb the retry
    skyFetches.delete(`${w.spec.id}:${w.spec.shader_sha256 || ""}`);
    void loadPluginSkyOnto(w.target, w.spec, true, getActiveModeSwitchSignal() ?? refreshPluginSignal.signal, w.paneId).catch(() => {});
    skyWaits.begin(key);
  },
});

/** Tile key for a sky load: the mosaic pane id, or "main" for the solo wall. */
function skyWaitKey(target: NetScene, paneId?: string): string {
  if (mosaic?.on) return paneId ?? (target === scene ? mosaic.mainTileId : "");
  return target === scene ? "main" : "";
}

function skyWaitHostEl(key: string): HTMLElement | null {
  if (mosaic?.on) return document.querySelector<HTMLElement>(`.mosaic-pane[data-mode="${CSS.escape(key)}"]`);
  return key === "main" ? $("scene") : null;
}

function beginSkyWait(key: string, target: NetScene, spec: PluginView, paneId: string | undefined, owner: AbortSignal): void {
  if (!key) return;
  skyWaitTiles.set(key, { target, spec, paneId });
  skyWaits.begin(key, owner);
}

function cancelSkyWait(target: NetScene, paneId?: string): void {
  const key = skyWaitKey(target, paneId);
  if (key) skyWaits.cancel(key);
}

function tileSkyStarting(tileId: string): boolean {
  const key = mosaic?.on && tileId === "main" ? mosaic.mainTileId : tileId;
  return skyWaits.exempt(key);
}

/**
 * While a wall view's own wall is up (Syscon, Cypher CIC) and it ships a plugin sky: that sky and
 * the tile it goes on, the wall's main tile (the pane skySpecForMode picks). Null otherwise.
 */
function wallViewSky(): { tile: string; spec: PluginView } | null {
  if (!mosaic?.on || !wallOwner || mosaic.tileIds.includes(wallOwner)) return null;
  const spec = pluginSpecForMode(wallOwner);
  if (!spec || !pluginHasSky(spec)) return null;
  const main = wallMainTile();
  return main ? { tile: main, spec } : null;
}

/** The wall's main tile: where a wall view's own sky and Needs you land (#172). */
function wallMainTile(): string | null {
  if (!mosaic?.on) return null;
  const main = mosaic.mainTileId || mosaic.focusedId;
  return main && mosaic.tileIds.includes(main) ? main : null;
}

/**
 * A wall view's consent, asked without waiting (#172). Still needed or declined: its wall's main
 * tile shows Needs you for it and Review there re-applies it; the header stays on the wall view.
 */
async function reviewWallView(m: ViewMode, spec: PluginView | null, signal: AbortSignal): Promise<SwitchPaneViewResult> {
  const result = await ensureReviewed(spec, signal, { wait: false });
  const tile = wallMainTile();
  if (result === "ok") {
    if (tile && viewStateOf(tile)?.kind === "needs-you" && viewStateViewId(tile) === m.id) clearViewState(tile);
    return { ok: true, paneId: tile ?? m.id, viewId: m.id };
  }
  if (signal.aborted || !spec || !tile) return { ok: false, reason: "Not reviewed." };
  showNeedsYou({ tileId: tile, viewId: m.id, spec, restart: () => applyMode(m.id) });
  return { ok: false, reason: "Needs you.", needsYou: true };
}

/** A saved layout naming a view that is gone gets a plain notice, never a stand-in view. */
function flagMissingMosaicViews(): void {
  if (!mosaic?.on || !catalogReady) return;
  const m = mosaic;
  flagMissingLayoutViews({
    tileIds: m.tileIds,
    isKnownView: (viewId) => allModes().some((row) => row.id === viewId)
      || !!hostEngine(viewId) || !!hostEngine(viewId.replace(/^plugin:/, "")),
    paneScene: (tileId) => m.graphScene(tileId),
  });
}

async function syncPluginSky(spec: PluginView | null, signal: AbortSignal): Promise<void> {
  if (mosaic?.on) {
    flagMissingMosaicViews();
    mosaic.markSkyPending();
    // The wall row's sky wins over its main tile's own; the other tiles keep theirs (#172c).
    const wall = wallViewSky();
    const tileSpec = (id: string): PluginView | null => (id === wall?.tile ? wall.spec : pluginSpecForMode(id));
    const wantSky = (m: Mosaic, id: string): boolean =>
      id === wall?.tile || mosaicPluginSkyPaneView(id, m.paneSky(id), lookForMode).wantPlugin;
    try {
      for (const id of mosaic.tileIds) {
        const target = mosaic.graphScene(id);
        const pane = tileSpec(id);
        if (!target || !pane || target.pluginSkyDrawn === pane.id) continue;
        if (!wantSky(mosaic, id)) continue;
        if (packNeedsConsent(pane)) continue;
        if (!(pane.has_sky_shader === true || !!pane.shader_sha256)) continue;
        beginSkyWait(id, target, pane, id, signal);
      }
      // Each tile loads on its own and settles its own pane when its own load ends, so one held
      // sky (Backrooms first in the list) never keeps the other panes covered by the warming state.
      const m = mosaic;
      await loadTilesSettlingEach(m.tileIds, signal, async (id) => {
        const target = m.graphScene(id);
        if (!target) return;
        const pane = tileSpec(id);
        const wantPlugin = wantSky(m, id);
        await loadPluginSkyOnto(target, pane, wantPlugin, signal, id);
      }, (id) => { if (m.on) m.settlePane(id); });
    } finally {
      // A switched-away sync never leaves a pane on "Starting…"; the next sync begins its own wait.
      // Only this sync's own waits: a newer sync may already have begun the pane's card and deadline.
      if (signal.aborted) for (const id of mosaic.tileIds) if (skyWaits.state(id) === "starting") skyWaits.cancelOwned(id, signal);
      mosaic.settlePanes();
    }
    return;
  }
  throwIfAborted(signal);
  await loadPluginSkyOnto(scene, spec, true, signal);
}

function teardownMosaicPanelView(viewId: string): void {
  releasePanelView(viewId);
  dropMosaicTileWriter(viewId);
}

async function mountMosaicPanelView(viewId: string): Promise<void> {
  if (!mosaic?.on) return;
  const pm = mosaicPaneMode(viewId);
  const spec = pm.pluginId ? pluginSpecForMode(pm.id) : null;
  const o = optsFor(pm);
  const target = mosaic.graphScene(viewId);
  const skyStage = !pm.standalone && !!(pm.stageOnly || (lookForMode(viewId) ?? spec?.look)?.stageOnly);
  setSceneMode(target, pm, o, skyStage);
  const paneSpec = skySpecForMode(viewId, spec);
  if (pm.standalone || arcadeSlotFor(pm) !== "carousel") {
    void syncPluginSky(paneSpec, refreshPluginSignal.signal).catch(() => {});
  }
  const packId = normalizeVizDemoPackId(pm.pluginId);
  syncPanelPackSub(viewId, !!(packId || spec?.capabilities?.includes("viz.read")));
}

function persistMosaicPickLayout(): void {
  settings.refreshMosaicSlots();
}

async function runMosaicPaneSwitch(
  toViewId: string,
  fromViewId?: string,
  signal: AbortSignal = refreshPluginSignal.signal,
  restart?: () => void,
): Promise<SwitchPaneViewResult> {
  if (!mosaic?.on) return { ok: false, reason: "Mosaic is off." };
  const pm = modeById(toViewId);
  const spec = pm.pluginId ? pluginSpecForMode(pm.id) : null;
  const pluginId = pm.pluginId ? (parsePluginId(pm.id) ?? pm.pluginId) : null;
  const result = await switchPaneView(mosaic, toViewId, {
    fromViewId,
    ensureReviewed: async () => (await ensureReviewed(spec, signal, { wait: false })) === "ok",
    spec,
    pluginId,
    onNeedsYou: spec
      ? (paneId) => showNeedsYou({
        tileId: paneId,
        viewId: mosaicTileViewId(toViewId),
        spec,
        restart: restart ?? (() => { void runMosaicPaneSwitch(toViewId, fromViewId ?? paneId); }),
      })
      : undefined,
    teardownView: teardownMosaicPanelView,
    mountView: mountMosaicPanelView,
    persistLayout: persistMosaicPickLayout,
  });
  if (result.ok) {
    noteTileHealthGrace(toViewId);
    if (fromViewId) noteTileHealthGrace(fromViewId);
    // The pane that showed Needs you now shows the view; its sky wait (if any) owns starting.
    if (result.paneId !== result.viewId) clearViewState(result.paneId);
    if (viewStateOf(result.viewId)?.kind !== "starting") {
      setViewState(result.viewId, mosaicTileViewId(result.viewId), { kind: "ready" });
    }
    syncMosaicPluginHudCaptions();
  }
  return result;
}

function pluginIsConsented(pluginId: string): boolean {
  const spec = pluginSpecs.find((p) => p.id === pluginId);
  if (!spec) return false;
  return !packNeedsConsent(spec);
}

async function resumeMosaicConsentPending(): Promise<void> {
  if (!mosaic?.on) return;
  await resumePendingConsentPaneSwitches(pluginIsConsented, (pending) =>
    runMosaicPaneSwitch(pending.toViewId, pending.fromViewId),
  );
}

async function refreshPluginCatalogAndResume(): Promise<void> {
  pluginSpecs = await installPlugins();
  setHeaderPickerOptions();
  settings.refreshMosaicSlots();
  await resumeMosaicConsentPending();
}

initPluginConsentSync({
  refreshCatalogAndResume: refreshPluginCatalogAndResume,
  pollIntervalMs: 10_000,
});

function computeSkyStage(m: ViewMode, spec: PluginView | null): boolean {
  return !m.standalone && !!(m.stageOnly || (lookForMode(m.id) ?? spec?.look)?.stageOnly);
}

/**
 * The one stage-only rule (graph hidden, sky and floor stay): an arcade view on the solo wall, a
 * solo pick still waiting on its OK, or the view's own stage look. #183: NetScene.setMode resets
 * stage-only to the mode's own flag, so every setMode goes through {@link setSceneMode}.
 */
function stageOnlyRule(target: NetScene, m: ViewMode, spec: PluginView | null): boolean {
  const solo = target === scene && !mosaic?.on;
  if (solo && (arcadeSlotFor(m) !== null || packNeedsConsent(spec))) return true;
  return computeSkyStage(m, spec);
}

/** setMode, then stage-only by {@link stageOnlyRule} (or the caller's already-computed value). */
function setSceneMode(
  target: NetScene | null | undefined,
  m: ViewMode,
  opts: Record<string, string>,
  stage?: boolean,
): void {
  if (!target) return;
  target.setMode(m, opts);
  target.setStageOnly(stage ?? stageOnlyRule(target, m, pluginSpecForMode(m.id)));
}

function applyModeFeedExtras(m: ViewMode, opts: Record<string, string>): void {
  const rainPics = m.pluginId === "hn-rain" && parseHnRainLook(opts).pics && !mosaic?.on;
  feedTitleCube.setActive(rainPics);
  nestCams.setActive(m.pluginId === "nest-cams");
  nestCams.setLook(opts);
}

/** Refresh the settings caption for `m` and return the hint line that carries it. */
function syncPluginHudCaption(m: ViewMode, spec: PluginView | null, opts: Record<string, string>): string {
  const fields = spec ? pluginViewKnobs({ ...spec, options: m.options, config: m.config }, m.config) : [];
  const cap = spec ? hudCaptionFromOpts(spec, fields, opts) : null;
  if (cap) {
    pluginHudCaptions.set(m.id, cap);
    return `${spec!.name} · ${cap}`;
  }
  pluginHudCaptions.delete(m.id);
  return m.hint;
}

function syncModeHud(m: ViewMode, spec: PluginView | null): void {
  syncPluginHudCaption(m, spec, optsFor(m));
  syncPluginHudForMode(m, spec, pluginHudCaptions, vizHud, mosaicHudOn());
  syncMosaicPluginHudCaptions();
}

function captureMosaicAnimSnap(): MosaicAnimSnap {
  const a = settings.animSettings;
  const size = mosaic?.on ? mosaic.current : a.mosaic;
  return {
    size,
    hero: mosaic?.on ? mosaic.heroPos : a.hero,
    tree: a.mosaicTree,
    maximized: a.mosaicMaxId || null,
    tiles: [...a.mosaicTiles],
  };
}

function restoreMosaicAnimSnap(snap: MosaicAnimSnap, preferMode: string): void {
  if (!mosaic) return;
  mosaic.setSize(snap.size, preferMode, snap.hero, {
    tree: snap.tree,
    maximized: snap.maximized,
    tiles: snap.tiles,
  });
}

function applyMosaicModeVisuals(m: ViewMode, opts: Record<string, string>, spec: PluginView | null, skyStage: boolean): void {
  const onWall = mosaic!.tileIds.includes(m.id);
  const focusId = onWall ? m.id : mosaic!.tileIds[0] ?? m.id;
  mosaic!.focus(focusId);
  // A wall view (Syscon, Cypher CIC) is not a tile of its wall: the first tile keeps its own mode (#172).
  const wallView = !onWall && !!pluginWall(lookForMode(m.id) ?? spec?.look);
  const target = wallView ? undefined : mosaic!.graphScene(focusId);
  setSceneMode(target, m, opts, skyStage);
  document.body.classList.remove("arcade");
  scene.setActive(true);
  morphViewChrome(m, opts, spec, skyStage, false);
}

function applySoloModeVisuals(m: ViewMode, opts: Record<string, string>, spec: PluginView | null, skyStage: boolean): void {
  const next = arcadeSlotFor(m);
  setSceneMode(scene, m, opts, next !== null || skyStage);
  document.body.classList.toggle("arcade", next !== null);
  unbindTetrisStandaloneHost(scene);
  if (next === "tetris") {
    bindTetrisStandaloneHost(scene, arcade.tetris.view as TetrisView);
  } else {
    scene.setActive(true);
  }
  if (activeArcade && activeArcade !== next) { arcade[activeArcade].view.stop(); arcade[activeArcade].el.hidden = true; }
  if (next && activeArcade !== next) { arcade[next].el.hidden = false; arcade[next].view.start(selectedIp); }
  if (next === "carousel") (arcade.carousel.view as CarouselView).setBind(opts);
  activeArcade = next;
  syncFeedShift();
  morphViewChrome(m, opts, spec, skyStage, false);
}

function reapplyCommittedModeSurfaces(modeId: string): void {
  noteTileHealthGrace("main");
  const m = modeById(modeId);
  const opts = optsFor(m);
  currentOpts = opts;
  setSkyPrompt(m.pluginId ?? m.id, opts[VIEW_PROMPT_KEY] ?? "");
  const spec = m.pluginId ? pluginSpecForMode(modeId) : null;
  const skyStage = computeSkyStage(m, spec);
  document.body.classList.toggle("stage-only", skyStage);
  applyModeFeedExtras(m, opts);
  bindThisView(modeId);
  refreshPluginDriveForMode(spec, modeId);
  if (mosaic?.on && !(m.pluginId && m.standalone)) {
    applyMosaicModeVisuals(m, opts, spec, skyStage);
    return;
  }
  applySoloModeVisuals(m, opts, spec, skyStage);
}

function buildApplyModeHost(): ApplyModeHost {
  return {
    modeById,
    optsFor,
    getLiveMode: () => liveMode,
    setLiveMode: (id) => { liveMode = id; },
    modeSel,
    touch,
    applyPluginWall,
    pluginSpecForMode,
    skySpecForMode,
    refreshPluginDrive: refreshPluginDriveForMode,
    presentDriveDeps,
    applySkyPrompt: (m, opts) => {
      currentOpts = opts;
      setSkyPrompt(m.pluginId ?? m.id, opts[VIEW_PROMPT_KEY] ?? "");
    },
    reapplyCommittedModeSurfaces,
    computeSkyStage: (m, spec) => computeSkyStage(m, spec),
    applyStageOnly: (skyStage) => { document.body.classList.toggle("stage-only", skyStage); },
    applyModeFeedExtras,
    bindThisView,
    clearModeOpts: () => { $("modeOpts").replaceChildren(); },
    ensureReviewed: (spec, signal) => ensureReviewed(spec, signal),
    loadTsPlugin: (spec, signal) => loadTsPlugin(spec, signal),
    syncPluginSky: (spec, signal) => syncPluginSky(spec, signal),
    mosaic,
    captureMosaicSnap: captureMosaicAnimSnap,
    restoreMosaicSnap: restoreMosaicAnimSnap,
    mosaicSetSizeForMode: (modeId, snap) => {
      mosaic!.setSize(snap.size, modeId, snap.hero, {
        tree: snap.tree,
        maximized: snap.maximized,
        tiles: snap.tiles,
      });
    },
    mosaicShouldResize: (modeId, keepLayout) =>
      !keepLayout && !!mosaic && mosaic.heroPos !== "off" && mosaic.heroMode !== modeId,
    mosaicSetPaneView: (from, to) => mosaic!.setPaneView(from, to),
    mosaicFocusSlot: () => (mosaic ? mosaicFocusSlot(mosaic) ?? undefined : undefined),
    mosaicHasTile: (modeId) => !!mosaic?.tileIds.includes(modeId),
    applyMosaicModeVisuals,
    applySoloModeVisuals,
    syncModeHud,
    applyViewLook,
    feedSetGraphBase: (base) => { feedCtl.feed?.setGraphBase(base); },
    syncWifiIfNeeded: (m) => { if (m.graphBase === "wifi") void syncWifiWatch(); },
    modeLabel: (m) => m.label,
    onConsentDeclined: () => { preserveVizUbo = false; },
    shouldLoadPluginRuntime: (m) => m.standalone || arcadeSlotFor(m) !== "carousel",
    getLastConsentedModeId,
    getFallbackKeptModeId: () => defaultCatalogMode()?.id ?? "topology",
    markModeConsented: (modeId) => setLastConsentedModeId(modeId),
    retryDeclinedMode: (modeId) => { applyMode(modeId); },
    showRollbackMessage: (kind, declined, keptModeId) => {
      const keptLabel = modeById(keptModeId).label;
      if (kind === "declined") return flashModeKeptPrevious(keptLabel);
      return flashModeLoadFailed(declined.label, keptLabel, () => applyMode(declined.id));
    },
    focusModePicker: () => { modeSel.focusWithRing(); },
    tileSkyStarting,
    willAutoConsent,
    stopPackRuntime: (signal) => {
      void loadTsPlugin(null, signal).catch(() => {});
      void loadPluginSkyOnto(scene, null, false, signal).catch(() => {});
    },
  };
}

/** Mosaic graph switches keep the consent-first pane path; the wall only changes after review. */
async function applyMosaicModeAsync(m: ViewMode, flags: ApplyModeFlags, signal: AbortSignal): Promise<void> {
  const opts = optsFor(m);
  const prevMode = liveMode;
  const spec = m.pluginId ? pluginSpecForMode(m.id) : null;
  // A wall view is the wall applyPluginWall lays out below, not a pane: a pane switch would put it
  // over its own wall's first tile (the onAfterSetSize re-entry lands here mid-layout, #172).
  const wallView = !!pluginWall(lookForMode(m.id) ?? spec?.look);
  const sw = wallView
    ? await reviewWallView(m, spec, signal)
    : await runMosaicPaneSwitch(m.id, undefined, signal, () => applyMode(m.id));
  if (signal.aborted) {
    settleConsentAndDrainAuto("aborted");
    return;
  }
  if (!sw.ok && sw.needsYou) {
    // The pick is the view: the header keeps naming it while its pane shows Needs you; Review
    // there re-applies it. Never snap the header back to the previous view.
    modeSel.value = m.id;
    settleConsentAndDrainAuto("declined", m.id);
    return;
  }
  if (!sw.ok) {
    revertModeSelection(prevMode, modeSel, { mode: liveMode });
    settleConsentAndDrainAuto("declined", m.id);
    return;
  }
  if (!mosaic?.on) {
    settleConsentAndDrainAuto("aborted");
    return;
  }

  currentOpts = opts;
  setSkyPrompt(m.pluginId ?? m.id, opts[VIEW_PROMPT_KEY] ?? "");
  modeSel.value = m.id;
  localStorage.setItem("zoto-viz.mode", m.id);
  touch();
  applyPluginWall(m.id, { ...flags, prevMode });
  liveMode = m.id;
  setLastConsentedModeId(m.id);

  const paneSpec = skySpecForMode(m.id, spec);
  const skyStage = computeSkyStage(m, spec);
  document.body.classList.toggle("stage-only", skyStage);
  applyModeFeedExtras(m, opts);
  bindThisView(m.id);
  refreshPluginDriveForMode(spec, m.id);
  $("modeOpts").replaceChildren();
  feedCtl.feed?.setGraphBase(m.graphBase);
  if (m.graphBase === "wifi") void syncWifiWatch();

  if (!flags.keepLayout && mosaic.heroPos !== "off" && mosaic.heroMode !== m.id) {
    mosaic.setSize(mosaic.current, m.id, mosaic.heroPos, {
      tree: settings.animSettings.mosaicTree,
      maximized: settings.animSettings.mosaicMaxId || null,
      tiles: settings.animSettings.mosaicTiles,
    });
  }
  document.body.classList.remove("arcade");
  scene.setActive(true);
  morphViewChrome(m, opts, spec, skyStage);
  applyViewLook();
  if (m.standalone || arcadeSlotFor(m) !== "carousel") {
    try {
      await loadTsPlugin(paneSpec, signal);
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        settleConsentAndDrainAuto("aborted");
        return;
      }
      console.warn("zoto-viz mosaic plugin load:", e);
    }
  }
  commitModeSwitchAttempt(signal);
  settleConsentAndDrainAuto("ok");
}

function runAutoSwitch(pending: PendingAutoSwitch): void {
  applyMode(pending.modeId, pending.flags, { channel: "automatic", auto: pending.auto });
}

export function applyMode(
  id: string,
  flags: { keepLayout?: boolean } = {},
  source: ModeSwitchSource = { channel: "user" },
): void {
  cancelScheduledSandboxConfig();
  if (id === MANIFEST_BLOCKED_VIEW_ID) {
    modeSel.value = id;
    bindThisView(id);
    touch();
    return;
  }
  const { proceed } = beginCoordinatedModeSwitch(source, id, flags);
  if (!proceed) return;
  const signal = beginModeSwitchAttempt();
  const m = modeById(id);
  if (mosaic?.on && !(m.pluginId && m.standalone)) void applyMosaicModeAsync(m, flags, signal);
  else applyModeImpl(buildApplyModeHost(), id, flags, signal);
  if (source.channel === "user") modeSel.focus();
}

registerAutoSwitchRunner(runAutoSwitch);
registerDreamPulseReset(() => scene.resetDreamCyclePulse());
registerApplyModeTestBindings({
  scene: () => scene,
  firePluginChange: (storeId, values) => { settings.onPluginChange?.(storeId, values); },
  flagMissingMosaicViews: () => flagMissingMosaicViews(),
  setEnsureReviewedOverride: (fn) => { ensureReviewedOverride = fn; },
  setReviewOverride: (fn) => { reviewOverride = fn; },
  refreshCatalog: () => refreshPluginCatalogAndResume(),
  setMosaic: (m) => { mosaic = m; },
  setPluginSpecs: (specs) => { pluginSpecs = specs; catalogReady = true; },
  setLiveMode: (id) => { liveMode = id; },
  setModeSelValue: (id) => { modeSel.value = id; },
  refreshModeOptions: () => setHeaderPickerOptions(),
  reattachModeSelect: () => {
    const modeBox = $("modeBox");
    if (modeBox && !modeBox.contains(modeSel.el)) modeBox.appendChild(modeSel.el);
  },
});

function morphViewChrome(
  m: ViewMode,
  opts: Record<string, string>,
  spec: PluginView | null,
  skyStage: boolean,
  syncHud = true,
): void {
  morphCopy($("hint"), syncPluginHudCaption(m, spec, opts));
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
  if (syncHud) syncModeHud(m, spec);
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

const storedBootMode = localStorage.getItem("zoto-viz.mode");
const initialBootMode = storedBootMode === MANIFEST_BLOCKED_VIEW_ID
  ? (defaultCatalogMode()?.id ?? "topology")
  : (storedBootMode ?? defaultCatalogMode()?.id ?? "topology");
modeSel.value = initialBootMode;
liveMode = initialBootMode;
if (!import.meta.env.VITEST) initModeSwitchStatusStrip();

export { getPresentDriveTileId } from "./present-drive-app";
export function getApplyModeHostForTests(): ApplyModeHost {
  return buildApplyModeHost();
}

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
const OVERLAYS_KEY = "zoto-viz.overlays";
function readOverlays(): boolean {
  return localStorage.getItem(OVERLAYS_KEY) !== "0";
}
function setOverlays(on: boolean): void {
  localStorage.setItem(OVERLAYS_KEY, on ? "1" : "0");
  document.body.classList.toggle("overlays-off", !on);
  overlaysChrome.checked = on;
  overlaysSettings.checked = on;
}
const overlaysChrome = new Toggle({
  id: "overlays",
  label: "overlays",
  title: "on-picture overlays: viz HUD, status chip, pane captions, graph tags (key O)",
  checked: readOverlays(),
  onChange: (on) => setOverlays(on),
});
const overlaysSettings = new Toggle({
  label: "overlays",
  title: "on-picture overlays: viz HUD, status chip, pane captions, graph tags (key O)",
  checked: readOverlays(),
  onChange: (on) => setOverlays(on),
});
$("overlaysBox").appendChild(overlaysChrome.el);
document.body.classList.toggle("overlays-off", !readOverlays());
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
  const feedPaint = paintFeedState({
    raw: m,
    heroModeId: liveMode || modeSel.value,
    mosaicOn: !!mosaic?.on,
    mosaicTileIds: mosaic?.tileIds ?? [],
    modeById,
    pluginSpecForMode,
  });
  applyDemoDataLabels(feedPaint.demoSlots);
  let shown = applyFeedSlotPaints({
    result: feedPaint,
    mergeNames: mergeToggle.checked,
    collapseByName,
    heroScene: scene,
    mosaicOn: !!mosaic?.on,
    mosaicTileIds: mosaic?.tileIds ?? [],
    graphScene: (id) => mosaic?.graphScene(id) ?? null,
    arcadeViews: Object.values(arcade).map((a) => a.view),
    remapSlotMsg: (slot, msg) => graphMsgForTile(slot === "hero" ? "main" : slot, msg),
  });
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
{
  const bootScope: readonly string[] = ["main"];
  vizTileScopeKey = bootScope.join("\0");
  bootNixieRealWallClock();
  applyDevVizWallFlagsOnBuild(location.search, bootScope);
  vizHud.syncDevWallBadInputMessage(devVizWallTileCostBadInputMessage());
}

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
settings.onRemixSave = async (pairing) => {
  await activateRemixPairing(pairing);
  if (noteUserView(remixViewId(pairing.visualPackId))) refreshViewMenus();
  touch();
  applyMode(remixViewId(pairing.visualPackId), {}, { channel: "user" });
};
settings.onRemixClear = () => {
  deactivateRemix();
  touch();
};
bindServerRestartWallNotice();
let pendingSandboxPush: PendingSandboxConfigPush | null = null;

function pluginSpecForStoreId(storeId: string): PluginView | null {
  return lookupPluginSpecForStoreId(pluginSpecs, storeId);
}

function maybePushSandboxForStore(storeId: string, values: Record<string, string>): void {
  const spec = pluginSpecForStoreId(storeId);
  if (!spec || !pluginHasFrontend(spec)) return;
  const loadedStore = sandboxLoadedConfigStoreId(
    tsWatchStoreId,
    tsWatchStoreId ? pluginSpecForStoreId(tsWatchStoreId) : null,
  );
  const pending = routePluginChangeSandboxPush(
    loadedStore,
    storeId,
    spec,
    packConfigValues(values),
    scheduleSandboxSetConfig,
  );
  if (pending) pendingSandboxPush = pending;
}

settings.onPluginChange = (storeId, values) => {
  maybePushSandboxForStore(storeId, values);
  onPluginFields({ skipSandboxPush: true });
};
settings.onInstancesChange = () => {
  void (async () => {
    pluginSpecs = await installPlugins();
    setHeaderPickerOptions();
    settings.refreshMosaicSlots();
    applyMode(modeSel.value, {}, { channel: "user" });
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
const tileHealToggle = new Toggle({
  label: "tile heal errors",
  title: "Show on-tile messages when the host heals a blank or stalled panel (off by default)",
  checked: tileHealErrorsOn,
  onChange: (on) => {
    tileHealErrorsOn = on;
    writeTileHealErrors(on);
    touch();
  },
});
settings.addSection("Tiles", [tileHealToggle], "Automatic empty-panel detection runs either way; this only controls visible heal messages.");
settings.addSection(
  "Overlays",
  [overlaysSettings],
  "Viz HUD, the corner status chip, pane captions, graph tags, and tile-heal notes. Header overlays / O is the same switch. Feed, chat, and debug stay on their own switches.",
);
const MOSAIC_FOCUS_KEY = "zoto-viz.mosaicFocus";
function persistMosaicFocus(id: string | null | undefined): void {
  const v = id?.trim();
  if (!v) return;
  try { localStorage.setItem(MOSAIC_FOCUS_KEY, v); } catch { /* ignore */ }
}

mosaic = new Mosaic({
  wall: $("wall"),
  sceneEl: $("scene"),
  main: scene,
  host: renderHost,
  arcade,
  spawnArcade: (engine) => spawnArcade(engine, scene),
  optsFor,
  onFocus: (id) => {
    mosaic?.focus(id);
    persistMosaicFocus(id);
    noteTileHealthGrace(id);
  },
  onPromote: (id, theme) => {
    if (noteUserView(id)) refreshViewMenus();
    applyMode(id, { keepLayout: true }, { channel: "user" });
    if (theme) applyTheme(theme.id);
    applyViewLook();
  },
  onLayout: (patch) => settings.applyMosaicLayout(patch),
  onCloseLast: () => {
    settings.applyAnim({ ...settings.animSettings, mosaic: "off", mosaicTree: null, mosaicMaxId: "", mosaicTiles: [] });
  },
  onPanePick: (from, to) => pickMosaicPane(from, to),
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
  pickSuffix: (modeId) => (pluginHasFrontend(pluginSpecForMode(modeId)) ? " (full view only)" : ""),
  wallSkyTile: () => wallViewSky()?.tile ?? null,
  paneDice: (id) => makePaneDiceButton({
    pane: id,
    onClick: () => { rollPaneDice(id); },
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
async function healTile(tileId: string, step: HealStep): Promise<void> {
  const modeId = tileId === "main" ? modeSel.value : tileId;
  const spec = pluginSpecForMode(modeId);
  switch (step) {
    case "resend-frame":
      if (lastVizFrame) sandbox.frame(lastVizFrame);
      break;
    case "restart-pack": {
      const m = modeById(modeId);
      const sc = tileId === "main" ? scene : mosaic?.graphScene(tileId) ?? null;
      if (sc) setSceneMode(sc, m, optsFor(m));
      if (spec && modeSel.value === m.id) await loadTsPlugin(spec, refreshPluginSignal.signal);
      else void syncPluginSky(spec, refreshPluginSignal.signal).catch(() => {});
      sc?.refresh();
      break;
    }
    case "recreate-context":
      renderHost.recreateContext();
      break;
    case "demo-snapshot":
      if (lastRaw && spec) {
        const golden = withGoldenIfIdle(lastRaw, pluginIdleOf(spec));
        const sc = tileId === "main" ? scene : mosaic?.graphScene(tileId) ?? null;
        sc?.update(golden);
      }
      break;
    case "fallback-pack":
      if (mosaic?.on && tileId !== "main") mosaic.setPaneView(tileId, TILE_HEAL_FALLBACK_MODE);
      else applyMode(TILE_HEAL_FALLBACK_MODE, {}, { channel: "user" });
      break;
  }
}

tileHealth = createProductionTileHealthMonitor({
  host: renderHost,
  mainScene: scene,
  mosaic,
  paneEl: (id) => (id === "main" ? scene.viewEl : mosaic?.graphScene(id)?.viewEl ?? null),
  sceneFor: (id) => (id === "main" ? scene : mosaic?.graphScene(id) ?? null),
  packFor: (id) => pluginSpecForMode(id === "main" ? modeSel.value : id),
  mayBeStatic: (spec) => spec?.viz?.mayBeStatic === true,
  awaitingApproval: (id) => tileHealthAwaitingApproval(id),
  isVisible: (id) => {
    const el = id === "main" ? scene.viewEl : mosaic?.graphScene(id)?.viewEl;
    if (!el || el.hidden) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  },
  showErrors: () => tileHealErrorsOn,
  onHeal: (tileId, step) => healTile(tileId, step),
  packLive: (id, packId) => (id === "main" || id === modeSel.value) && sandbox.readyPack === packId,
  previewOnly: (id) => mosaicPanePreviewOnly(id),
  skyStarting: (id) => tileSkyStarting(id),
  onLiveBlank: (id, packId, blank) => onLiveBlank(id, packId, blank),
  onCantStart: (id) => {
    const m = modeById(tileHealthModeId(id));
    const spec = pluginSpecForMode(m.id);
    if (!pluginHasFrontend(spec)) return false;
    showPickCouldntStart(buildApplyModeHost(), m, spec, "load-failed");
    return true;
  },
  couldntStart: (id) => viewStateOf(id)?.kind === "couldnt-start",
});
function onLiveBlank(tileId: string, packId: string, blank: boolean): void {
  const paneId = tileId === "main" ? modeSel.value : tileId;
  const m = mosaic?.on ? mosaic : null;
  paintLiveBlankNotice({
    setPaneNotice: m ? (id, text, recipe, opts) => m.setPaneNotice(id, text, recipe, opts) : null,
    paneEl: (id) => (m ? document.querySelector(`.mosaic-pane[data-mode="${CSS.escape(id)}"]`) : scene.viewEl),
    soloEl: scene.viewEl,
    viewName: (id) => pluginSpecForMode(id)?.name ?? null,
    retry: () => { void healTile(tileId, "restart-pack"); },
  }, paneId, packId, blank);
}
bindTileHealthPresentTick(tileHealth, addPresentListener);
let previewCaptionAt = 0;
addPresentListener(() => {
  const now = performance.now();
  if (now - previewCaptionAt < 500) return;
  previewCaptionAt = now;
  mosaic?.syncPreviewCaptions(mosaicPanePreviewOnly);
});

settings.onMosaicPanePick = (from, to) => pickMosaicPane(from, to);

async function pickMosaicPane(from: string, to: string): Promise<boolean> {
  const sw = await runMosaicPaneSwitch(to, from);
  if (!sw.ok) {
    settings.refreshMosaicSlots();
    return false;
  }
  if (noteUserView(to)) refreshViewMenus();
  noteTileHealthGrace(from);
  noteTileHealthGrace(to);
  touch();
  return true;
}

settings.addAnimation((a) => {
  const pin = pinViewLook();
  if (mosaic!.on) {
    mosaic!.applyLooks(a, pin);
    mosaic!.setTheme(scene.currentTheme);
  } else scene.setAnim(mergeLook(a, pin ? lookForMode(modeSel.value) : undefined));
  applyMosaicLayoutFromAnim(mosaic!, a, settings, {
    layoutKey: mosaic!.layoutKey,
    stopArcadeIfNeeded: () => {
      if (a.mosaic !== "off" && activeArcade) {
        arcade[activeArcade].view.stop();
        arcade[activeArcade].el.hidden = true;
        document.body.classList.remove("arcade");
        scene.setStageOnly(false);
        activeArcade = null;
      }
    },
    onBeforeSetSize: () => {},
    onAfterSetSize: () => {
      applyMode(modeSel.value, { keepLayout: true });
      syncFeedShift();
      syncHeaderViewChrome();
    },
  });
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

modeSel.onChange = (id) => {
  if (id === PACK_BLOCKED_SELECT_VALUE) {
    const text = formatBlockedCatalogNotice(blockedCatalogEntries());
    if (text) liveFeed.showOperatorNotice(text);
    modeSel.value = liveMode || modeSel.value;
    return;
  }
  selectHeaderView(id);
};

function syncHeaderViewChrome(): void {
  const wall = !!mosaic?.on;
  modeSel.setCaption(wall ? "global" : "view");
  modeSel.setTitle(wall
    ? "leave the wall and show this one view full screen (keys 1–9, 0 for the 10th). Your last 10 picks stay at the top. A wall pack such as Syscon opens its wall."
    : "view mode (keys 1–9, 0 for the 10th). Your last 10 picks stay at the top. Type to filter.");
}

function refreshViewMenus(): void {
  setHeaderPickerOptions();
  mosaic?.refreshViewMenus();
  settings.refreshMosaicSlots();
}

/** Header and digit picks. On a wall this is one global view, not another pane. */
function selectHeaderView(id: string): void {
  if (noteUserView(id)) refreshViewMenus();
  if (globalViewLeavesMosaic(!!mosaic?.on, lookForMode(id))) {
    modeSel.value = id;
    settings.applyAnim({
      ...settings.animSettings,
      mosaic: "off",
      mosaicTree: null,
      mosaicMaxId: "",
      mosaicTiles: [],
    });
    return;
  }
  applyMode(id);
}

async function syncPluginCatalog(): Promise<void> {
  pluginSpecs = await installPlugins();
  settings.refreshRemixPicker(pluginSpecs);
  blockedInstallPanel.refresh();
  const blocked = takePackInstallBlockedNotice();
  if (blocked) liveFeed.showOperatorNotice(blocked);
}

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
  touch();
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
  profiles?.saveMicOff(p === "off");
  scene.syncPulse();
  if (p === "off") agent.releaseMic();
  else agent.armWake();
};
$("micBox").appendChild(micToggle.el);
// Not now on the allow sheet turns the mic Off, so the toggle shows the real state and the
// choice survives reloads like any other Off. Turning the toggle back on is how to undo it.
setMediaDeclineSink((kinds) => {
  if (kinds.includes("mic")) settings.setMicPolicy("off");
});
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
settings.onMicResume = () => { void scene.resumePulseMic(); };
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
const vizGovernorToggle = createVizGovernorToggle(renderScaleGovernorHost);
const privSec = settings.addSection("Privacy", [redactToggle, autoconsentToggle, vizGovernorToggle]);
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
      const graphs = dreamCycleModes();
      if (graphs.length) {
        const i = Math.max(0, graphs.findIndex((m) => m.id === modeSel.value));
        applyMode(graphs[(i + 1) % graphs.length].id, {}, { channel: "automatic", auto: "dream-cycle" });
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
const profileBox = $("profileBox");
if (profileBox) profileBox.append(profileSel.el);
profileHost.append(profileTools);
const chromeHost = document.createElement("div");
chromeHost.className = "sec-controls";
chromeHost.append(chromeSel.el, layoutRow);
profiles = new ProfileStore(
  { collect: collectSettings, apply: applySettings },
  profileSel,
  profileBar,
  profileTools,
);
// A mic declined in another browser or session starts Off here too, with no sheet.
profiles.onHomeMicOff = () => settings.setMicPolicy("off");
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
  "The header profile menu loads this profile's last saved settings: view, theme, motion, mosaic, feed, chat, plugins, camera, and agent. Saved in ~/.zoto-viz/profiles.yml. Model choice and microphone / camera acceptance are shared across profiles in that file. Choosing one makes it the startup profile. zoto viz is the shipped default. The Cursor key stays in ~/.zoto-viz/cursor-key.",
  profileHost,
);
uiReady = true;
applyViewLook();
async function bootCatalogFromSession(): Promise<void> {
  try {
    const session = await bootSession();
    typeSafeKeyOn = session.typesafeConfigured;
    setTypeSafeProxyConfigured(() => typeSafeKeyOn);
    agent.setControlFromServer(session.aiControl);
    pluginSpecs = await installPlugins();
    catalogReady = true;
    setHeaderPickerOptions();
    settings.refreshMosaicSlots();
    settings.refreshRemixPicker(pluginSpecs);
    await hydrateRemixFromStorage();
    const live = readSessionLive();
    const bootMode = resolveRestoredViewMode({
      sessionMode: live?.settings?.mode,
      localMode: localStorage.getItem("zoto-viz.mode"),
      fallback: defaultCatalogMode()?.id ?? "topology",
    });
    const remixBoot = remixPairingActive();
    const resolvedBoot = remixBoot ? remixViewId(remixBoot.visualPackId) : bootMode;
    modeSel.value = resolvedBoot;
    localStorage.setItem("zoto-viz.mode", resolvedBoot);
    liveMode = resolvedBoot;
    if (settings.animSettings.mosaic !== "off" && mosaic) {
      const bootTiles = reconcileMosaicTilesWithMode(
        settings.animSettings.mosaicTiles,
        bootMode,
        localStorage.getItem(MOSAIC_FOCUS_KEY),
      );
      if (bootTiles.join("\0") !== settings.animSettings.mosaicTiles.join("\0")) {
        settings.applyAnim({ ...settings.animSettings, mosaicTiles: bootTiles });
      }
      if (mosaic) {
        mosaic.setSize(settings.animSettings.mosaic, bootMode, settings.animSettings.hero, {
          tree: settings.animSettings.mosaicTree,
          maximized: settings.animSettings.mosaicMaxId || null,
          tiles: settings.animSettings.mosaicTiles,
        });
        mosaic.hydrate();
        syncHeaderViewChrome();
      }
    }
    const restored = profiles ? await profiles.boot(live) : false;
    await agent.syncStatus();
    if (!agent.savedBackend() && agent.cursorReady()) {
      agent.useBackend("cursor");
      touch();
    }
    quiet(() => {
      applyMode(modeSel.value, {}, { channel: "automatic", auto: "profile-restore" });
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
  } finally {
    document.body.classList.remove("view-booting");
  }
}

if (!import.meta.env.VITEST) void bootCatalogFromSession();

registerMainEntryTestHooks({ connect, bootCatalog: bootCatalogFromSession });

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

const applyAgentPatch = createApplyAgentPatch({
  reloadClient: () => location.reload(),
  refreshPluginCatalogAndResume: () => refreshPluginCatalogAndResume(),
  mergeConsentPatch: (patch) => mergePluginConsentLivePatch(pluginSpecs, patch),
  hasConsentPending: () => hasConsentPending(),
  resumeMosaicConsentPending: () => resumeMosaicConsentPending(),
  modeIds: () => allModes().map((m) => m.id),
  diceOn: () => settings.diceSettings.on,
  collectSettings: () => collectSettings(),
  applySettings: (s, flags) => applySettings(s, flags),
  rollDice: () => rollDice(),
  syncTemper: (t) => agent.syncTemper(t as Parameters<typeof agent.syncTemper>[0]),
  aiMosaicLayoutOn: () => aiMosaicLayoutOn(),
  mosaicTiles: () => (mosaic?.on ? { tileIds: [...mosaic.tileIds], focusedId: mosaic.focusedId } : null),
  writeAi: async (s) => { await profiles?.writeAi(s, agent.modelTag); },
});

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

const ARCADE_STORAGE_RE = /^zoto-viz\.(pong|invaders|command|frogger|cpupong|doom|waves|orbits|helix|skyline|pacman|tetris|portal|carousel)\./;

function storageKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  return keys;
}

function replaceStorage(re: RegExp, entries: [string, string][]): void {
  for (const k of storageKeys()) if (re.test(k)) localStorage.removeItem(k);
  for (const [k, v] of entries) if (re.test(k)) localStorage.setItem(k, v);
}

function collectSettings(): ProfileSettings {
  const modeOptions: Record<string, Record<string, string>> = {};
  for (const m of allModes()) modeOptions[m.id] = optsFor(m);
  const arcade: Record<string, string> = {};
  for (const k of storageKeys()) {
    if (ARCADE_STORAGE_RE.test(k)) arcade[k] = localStorage.getItem(k) ?? "";
  }
  const operator = agent.operatorPrefs();
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
    vizGovernor: loadVizGovernorSetting(),
    recentViews: [...recentViewIds()],
    mosaicFocus: localStorage.getItem(MOSAIC_FOCUS_KEY) ?? "",
    operator: { ...operator, tileHealErrors: tileHealErrorsOn, debug: debugToggle.checked },
    remix: loadRemixPairing(),
    operatorSaved: true,
    recentSaved: true,
    remixSaved: true,
    mosaicFocusSaved: true,
    pluginsSaved: true,
    arcadeSaved: true,
    modeOptionsSaved: true,
  };
}

function applySettings(s: ProfileSettings, flags: { keepLayout?: boolean } = {}): void {
  bumpPluginCatalogRevision();
  void import("../plugins/plugin-settings").then((m) => m.clearPluginSettingsUiState());
  profiles?.adoptAutosave(s.autosave);
  if (s.arcadeSaved) replaceStorage(ARCADE_STORAGE_RE, Object.entries(s.arcade ?? {}) as [string, string][]);
  if (s.modeOptionsSaved) {
    const modeEntries: [string, string][] = [];
    for (const [mid, opts] of Object.entries(s.modeOptions ?? {})) {
      for (const [k, v] of Object.entries(opts)) modeEntries.push([`zoto-viz.mode.${mid}.${k}`, v]);
    }
    replaceStorage(/^zoto-viz\.mode\./, modeEntries);
  }
  if (s.pluginsSaved) replacePluginConfigs(s.plugins);
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
  const homeAi = profiles?.homeGlobal.ai;
  if (homeAi && homeAiActive(homeAi)) agent.applyAi(homeAi);
  if (s.operatorSaved) {
    agent.applyOperator(s.operator);
    tileHealErrorsOn = s.operator.tileHealErrors;
    writeTileHealErrors(tileHealErrorsOn);
    tileHealToggle.checked = tileHealErrorsOn;
    setDebug(s.operator.debug);
  }
  if (s.recentSaved) setRecentViews(s.recentViews);
  if (s.mosaicFocusSaved) {
    if (s.mosaicFocus) localStorage.setItem(MOSAIC_FOCUS_KEY, s.mosaicFocus);
    else localStorage.removeItem(MOSAIC_FOCUS_KEY);
  }
  if (s.remixSaved) {
    if (s.remix) void activateRemixPairing(s.remix);
    else deactivateRemix();
    settings.refreshRemixPicker(pluginSpecs);
  }
  refreshViewMenus();
  if (s.camera) settings.setCamPolicy(s.camera);
  // The mic decision is global (header toggle, Allow / Not now), not per profile. Every profile
  // carries mic: "auto" by default, so restoring it here switched a declined mic back on and
  // brought the allow sheet back on each profile or view load.
  settings.setSoundOn(!!s.sound);
  applyHostRenderScaleGovernor(s.vizGovernor === true, renderScaleGovernorHost);
  vizGovernorToggle.checked = s.vizGovernor === true;
  if (activeArcade) {
    arcade[activeArcade].view.stop();
    arcade[activeArcade].el.hidden = true;
    activeArcade = null;
    document.body.classList.remove("arcade");
    scene.setStageOnly(false);
  }
  applyMode(s.mode, { keepLayout: flags.keepLayout }, { channel: "user" });
  if (s.mosaicFocusSaved && s.mosaicFocus && mosaic?.on) mosaic.focus(s.mosaicFocus);
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
    void profiles.saveHome({ ai: agent.aiPrefs() });
  } catch (e) {
    console.warn("zoto-viz AI cycle:", e);
    agent.setCycleChecked(false);
    void profiles?.saveHome({ ai: agent.aiPrefs() });
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
    if (packNeedsConsent(spec)) return false;
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

function rollPaneDice(paneId: string): void {
  if (!mosaic?.on) return;
  const to = pickPaneDiceView(
    paneId,
    mosaic.tileIds,
    diceModes().map((m) => m.id),
    (id) => usesFullDeviceTable(modeById(id)),
  );
  if (!to) return;
  void pickMosaicPane(paneId, to);
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

if (!import.meta.env.VITEST) {
  connect();
}

window.addEventListener("keydown", (e) => {
  const t = e.target;
  const onModePicker = t instanceof Node && modeSel.el.contains(t);
  if (t instanceof HTMLSelectElement || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
  if (t instanceof HTMLButtonElement && !onModePicker) return;
  if (e.key === "Escape" && settings.isOpen) { settings.close(); return; }
  if (e.key === "Escape") scene.select(null);
  if (e.key === "r" || e.key === "R") setRedaction(!redaction.enabled);
  if (e.key === "d" || e.key === "D") setDream(!dreamToggle.checked);
  if (e.key === "f" || e.key === "F") settings.setFeedOn(!settings.feedSettings.on);
  if (e.key === "c" || e.key === "C") settings.setChatOn(!settings.chatSettings.on);
  if (e.key === "b" || e.key === "B") setDebug(!debugToggle.checked);
  if (e.key === "l" || e.key === "L") setLabels(!sysLabels.checked);
  if (e.key === "o" || e.key === "O") setOverlays(!overlaysChrome.checked);
  if (e.key === "t" || e.key === "T") applyTheme(THEMES[(THEMES.findIndex((t) => t.id === theme.id) + (e.shiftKey ? THEMES.length - 1 : 1)) % THEMES.length].id, true);
  const idx = e.key === "0" ? 9 : Number(e.key) - 1;
  const modes = viewSelectOptions();
  if (idx >= 0 && idx < modes.length && !e.ctrlKey && !e.metaKey && !e.altKey) selectHeaderView(modes[idx]!.value);
});
window.addEventListener("pagehide", (e) => {
  persistLive(true);
  // #206: a page going away (not into the bfcache) stops the live feed's poll.
  if (!e.persisted) liveFeed.dispose();
});
