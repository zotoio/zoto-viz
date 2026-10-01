import type { ViewMode } from "../core/modes";
import type { DreamAnim } from "../graph/scene";
import type { ConsentReviewResult } from "./pack-consent";
import type { PluginView } from "../plugins/plugin";
import { lookForMode, pluginHasFrontend, pluginWall } from "../plugins/plugin";
import { packNeedsConsent } from "./plugin-consent-mount";
import type { Select } from "../ui/ui";
import type { Mosaic } from "../graph/mosaic";
import {
  flashModeKeptPrevious,
  flashModeLoadFailed,
} from "./mode-switch-message";
import { settleConsentAndDrainAuto } from "./mode-switch-coordinator";
import { commitModeSwitchAttempt, throwIfAborted } from "./mode-switch-attempt";
import { dropMediaAskGatedByPackConsent } from "../ui/media-ask";
import { showNeedsYou } from "./needs-you";
import { setViewState, showViewState, viewStateOf, type CouldntStartReason } from "./view-state";
import {
  capturePresentDriveBeforeLiveModeCommit,
  restorePresentDriveAfterModeRollback,
  type PresentDriveDeps,
} from "./present-drive-app";

export type MosaicAnimSnap = {
  size: DreamAnim["mosaic"];
  hero: DreamAnim["hero"];
  tree: DreamAnim["mosaicTree"];
  maximized: string | null;
  tiles: string[];
};

export type MosaicPaneRevert = { slot: string; modeId: string };

/** How applyViewLook treats the pick's plugin sky. */
export type ViewLookOpts = {
  /** #226: the pack's sky installs after its ready (the sync after loadTsPlugin), not with the look. */
  skyAfterReady?: boolean;
};

/** #226: applyViewLook syncs the sky itself unless the pick's pack sky waits for the pack's ready. */
export function viewLookSyncsSky(opts: ViewLookOpts | undefined, skySpec: PluginView | null): boolean {
  return !(opts?.skyAfterReady && pluginHasFrontend(skySpec));
}

export type ApplyModeHost = {
  modeById: (id: string) => ViewMode;
  optsFor: (m: ViewMode) => Record<string, string>;
  getLiveMode: () => string;
  setLiveMode: (id: string) => void;
  modeSel: Select;
  touch: () => void;
  applyPluginWall: (modeId: string, flags: { keepLayout?: boolean; prevMode?: string }) => void;
  pluginSpecForMode: (modeId: string) => PluginView | null;
  skySpecForMode: (modeId: string, fallback: PluginView | null) => PluginView | null;
  refreshPluginDrive: (spec: PluginView | null, modeId: string) => void;
  applySkyPrompt: (m: ViewMode, opts: Record<string, string>) => void;
  reapplyCommittedModeSurfaces: (modeId: string) => void;
  presentDriveDeps: PresentDriveDeps;
  computeSkyStage: (m: ViewMode, spec: PluginView | null, opts: Record<string, string>) => boolean;
  applyStageOnly: (skyStage: boolean) => void;
  applyModeFeedExtras: (m: ViewMode, opts: Record<string, string>) => void;
  bindThisView: (modeId: string) => void;
  clearModeOpts: () => void;
  ensureReviewed: (spec: PluginView | null, signal: AbortSignal) => Promise<ConsentReviewResult>;
  loadTsPlugin: (spec: PluginView | null, signal: AbortSignal) => Promise<void>;
  syncPluginSky: (spec: PluginView | null, signal: AbortSignal) => Promise<void>;
  mosaic: Mosaic | null;
  captureMosaicSnap: () => MosaicAnimSnap;
  restoreMosaicSnap: (snap: MosaicAnimSnap, preferMode: string) => void;
  mosaicSetSizeForMode: (modeId: string, snap: MosaicAnimSnap) => void;
  mosaicShouldResize: (modeId: string, keepLayout: boolean) => boolean;
  mosaicSetPaneView: (from: string, to: string) => boolean;
  mosaicFocusSlot: () => string | undefined;
  mosaicHasTile: (modeId: string) => boolean;
  applyMosaicModeVisuals: (
    m: ViewMode,
    opts: Record<string, string>,
    spec: PluginView | null,
    skyStage: boolean,
  ) => void;
  applySoloModeVisuals: (
    m: ViewMode,
    opts: Record<string, string>,
    spec: PluginView | null,
    skyStage: boolean,
  ) => void;
  syncModeHud: (m: ViewMode, spec: PluginView | null) => void;
  applyViewLook: (opts?: ViewLookOpts) => void;
  feedSetGraphBase: (base: string) => void;
  syncWifiIfNeeded: (m: ViewMode) => void;
  modeLabel: (m: ViewMode) => string;
  onConsentDeclined: () => void;
  shouldLoadPluginRuntime: (m: ViewMode) => boolean;
  getLastConsentedModeId: () => string;
  getFallbackKeptModeId: () => string;
  markModeConsented: (modeId: string) => void;
  showRollbackMessage: (kind: "declined" | "failed", declined: ViewMode, keptModeId: string) => string | null;
  retryDeclinedMode?: (modeId: string) => void;
  focusModePicker: () => void;
  /** The tile's own sky wait is running (it owns "starting" until the sky lands or times out). */
  tileSkyStarting?: (tileId: string) => boolean;
  /** Take the previous view's pack runtime and sky off the solo wall (Needs you shows the theme background). */
  stopPackRuntime?: (signal: AbortSignal) => void;
  /**
   * Auto-consent will grant this pick on its own (on, eligible, not an incomplete record): the
   * tile shows starting while it does, and no Needs you or consent text is ever written.
   */
  willAutoConsent?: (spec: PluginView) => boolean;
};

/** Solo wall tile id in the per-tile ViewState map. */
const SOLO_TILE = "main";

export type ApplyModeFlags = { keepLayout?: boolean };

function needsConsentBeforeShow(spec: PluginView | null): boolean {
  return packNeedsConsent(spec);
}

function commitTargetPublicSurfaces(
  host: ApplyModeHost,
  m: ViewMode,
  prevHeldId: string,
): void {
  host.modeSel.value = m.id;
  localStorage.setItem("zoto-viz.mode", m.id);
  const opts = host.optsFor(m);
  host.applySkyPrompt(m, opts);
  host.bindThisView(m.id);
  host.applyModeFeedExtras(m, opts);
  host.feedSetGraphBase(m.graphBase ?? "topology");
  host.syncWifiIfNeeded(m);
  host.applyPluginWall(m.id, { keepLayout: true, prevMode: prevHeldId });
}

function rollbackSwitch(
  host: ApplyModeHost,
  keptModeId: string,
  declined: ViewMode,
  prevPresent: ReturnType<typeof capturePresentDriveBeforeLiveModeCommit>,
  mosaicSnap: MosaicAnimSnap | null,
  paneRevert: MosaicPaneRevert | null,
  kind: "declined" | "failed",
  signal?: AbortSignal,
): string | null {
  commitModeSwitchAttempt(signal);
  const kept = host.modeById(keptModeId);
  if (paneRevert) host.mosaicSetPaneView(paneRevert.modeId, paneRevert.slot);
  host.modeSel.value = keptModeId;
  host.setLiveMode(keptModeId);
  localStorage.setItem("zoto-viz.mode", keptModeId);
  host.applyPluginWall(keptModeId, { prevMode: declined.id, keepLayout: true });
  restorePresentDriveAfterModeRollback(
    prevPresent.prevPresentSpec,
    prevPresent.prevPresentMode,
    keptModeId,
    (id) => host.pluginSpecForMode(id),
    host.presentDriveDeps,
  );
  if (mosaicSnap) host.restoreMosaicSnap(mosaicSnap, keptModeId);
  host.reapplyCommittedModeSurfaces(keptModeId);
  host.syncModeHud(kept, host.pluginSpecForMode(keptModeId));
  host.applyViewLook();
  dropMediaAskGatedByPackConsent();
  host.onConsentDeclined();
  host.focusModePicker();
  return host.showRollbackMessage(kind, declined, keptModeId);
}

function tileFor(host: ApplyModeHost, m: ViewMode): string {
  return host.mosaic?.on && !(m.pluginId && m.standalone) ? m.id : SOLO_TILE;
}

/** Needs you on the pick's own tile; Review there starts it in place (restart re-applies it). */
function showPickNeedsYou(host: ApplyModeHost, m: ViewMode, spec: PluginView): void {
  showNeedsYou({
    tileId: tileFor(host, m),
    viewId: m.id,
    spec,
    restart: () => host.retryDeclinedMode?.(m.id),
  });
}

/** Couldn't start on the pick's own tile, with Retry. Never the previous view in its place. */
export function showPickCouldntStart(
  host: ApplyModeHost,
  m: ViewMode,
  spec: PluginView | null,
  reason: CouldntStartReason,
  err?: unknown,
): void {
  const tile = tileFor(host, m);
  const packId = spec?.id ?? m.pluginId ?? m.id;
  // The pack's sky failed to compile: the tile already says so (cant-draw / shader, #171 c), and a
  // generic "couldn't start" with Retry would only compile the same shader again.
  const cur = viewStateOf(tile);
  if (cur?.kind === "cant-draw" && cur.reason === "shader" && cur.packId === packId) return;
  const log = err instanceof Error ? err.message : err != null ? String(err) : undefined;
  showViewState(
    tile,
    m.id,
    spec?.name || host.modeLabel(m),
    { kind: "couldnt-start", reason, packId, ...(log ? { log } : {}) },
    { onRetry: () => host.retryDeclinedMode?.(m.id) },
  );
}

/** Loads done: ready, unless the tile's sky wait still owns starting or something failed. */
function settleTileReady(host: ApplyModeHost, m: ViewMode): void {
  const tile = tileFor(host, m);
  const cur = viewStateOf(tile);
  if (cur && cur.kind !== "starting" && cur.kind !== "needs-you") return;
  if (cur?.kind === "starting" && host.tileSkyStarting?.(tile)) return;
  setViewState(tile, m.id, { kind: "ready" });
}

function scheduleConsentFinalize(
  host: ApplyModeHost,
  m: ViewMode,
  spec: PluginView | null,
  paneSpec: PluginView | null,
  prevLive: string,
  signal: AbortSignal,
): void {
  const targetId = m.id;
  const commitScene = (): void => {
    const skyStage = host.computeSkyStage(m, spec, host.optsFor(m));
    host.applyStageOnly(skyStage);
    if (host.mosaic?.on && !(m.pluginId && m.standalone)) {
      host.applyMosaicModeVisuals(m, host.optsFor(m), spec, skyStage);
    } else {
      host.applySoloModeVisuals(m, host.optsFor(m), spec, skyStage);
    }
    host.applyViewLook({ skyAfterReady: host.shouldLoadPluginRuntime(m) });
  };
  void (async () => {
    let result: ConsentReviewResult = "failed";
    try {
      result = await host.ensureReviewed(spec, signal);
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        dropMediaAskGatedByPackConsent();
        settleConsentAndDrainAuto("aborted");
        return;
      }
      result = "failed";
    }
    if (result === "aborted" || signal.aborted) {
      dropMediaAskGatedByPackConsent();
      settleConsentAndDrainAuto("aborted");
      return;
    }
    if (host.modeSel.value !== targetId) return;
    if (result === "ok") {
      commitTargetPublicSurfaces(host, m, prevLive);
      host.setLiveMode(targetId);
      host.refreshPluginDrive(spec, targetId);
      commitScene();
      host.markModeConsented(targetId);
      host.syncModeHud(m, spec);
      // Approved (or never needed it): the tile leaves Needs you at once and starts in place.
      setViewState(tileFor(host, m), targetId, { kind: "starting" });
      try {
        throwIfAborted(signal);
        if (host.shouldLoadPluginRuntime(m)) {
          await host.loadTsPlugin(paneSpec, signal);
          throwIfAborted(signal);
          await host.syncPluginSky(paneSpec, signal);
        }
      } catch (e) {
        if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          dropMediaAskGatedByPackConsent();
          settleConsentAndDrainAuto("aborted");
          return;
        }
        commitModeSwitchAttempt(signal);
        showPickCouldntStart(host, m, spec, "load-failed", e);
        host.focusModePicker();
        settleConsentAndDrainAuto("failed", m.id);
        return;
      }
      settleTileReady(host, m);
      commitModeSwitchAttempt(signal);
      settleConsentAndDrainAuto(result);
      host.focusModePicker();
      return;
    }
    // Not now / no answer: the pick stays the view, on Needs you. Could not save the OK: Couldn't
    // start with Retry. Neither ever puts the previous view back.
    commitModeSwitchAttempt(signal);
    dropMediaAskGatedByPackConsent();
    host.onConsentDeclined();
    if (result === "declined" && spec) showPickNeedsYou(host, m, spec);
    else showPickCouldntStart(host, m, spec, "grant-failed");
    host.focusModePicker();
    settleConsentAndDrainAuto(result, m.id);
  })();
}

export function applyModeImpl(
  host: ApplyModeHost,
  id: string,
  flags: ApplyModeFlags = {},
  signal: AbortSignal,
): void {
  const m = host.modeById(id);
  const opts = host.optsFor(m);
  const prevLive = host.getLiveMode();
  const prevPresent = capturePresentDriveBeforeLiveModeCommit(prevLive);
  const spec = m.pluginId ? host.pluginSpecForMode(m.id) : null;
  const paneSpec = host.skySpecForMode(m.id, spec);
  const skyStage = host.computeSkyStage(m, spec, opts);
  // Needs you or not, the pick is the view: picker, header, sky prompt and tile all name it. A
  // pack waiting on its OK runs no code: theme background (stage only, no pack sky) and Needs you.
  const gateScene = needsConsentBeforeShow(spec);
  const tileStage = gateScene || skyStage;

  host.modeSel.value = m.id;
  localStorage.setItem("zoto-viz.mode", m.id);
  host.applySkyPrompt(m, opts);
  host.touch();
  host.applyPluginWall(m.id, { ...flags, prevMode: prevLive });
  host.setLiveMode(m.id);
  host.refreshPluginDrive(gateScene ? null : spec, m.id);
  host.applyStageOnly(tileStage);
  host.applyModeFeedExtras(m, opts);
  host.bindThisView(m.id);
  host.clearModeOpts();

  let mosaicSnap: MosaicAnimSnap | null = null;

  host.feedSetGraphBase(m.graphBase ?? "topology");
  host.syncWifiIfNeeded(m);

  if (host.mosaic?.on && !(m.pluginId && m.standalone)) {
    if (host.mosaicShouldResize(m.id, !!flags.keepLayout)) {
      mosaicSnap = host.captureMosaicSnap();
      host.mosaicSetSizeForMode(m.id, mosaicSnap);
    }
    // A wall view (Syscon, Cypher CIC) is the wall applyPluginWall just laid out, not a pane:
    // swapping it into the focus slot evicts the wall's own first tile (#172).
    const wallView = !!pluginWall(lookForMode(m.id) ?? spec?.look);
    if (!wallView && !host.mosaicHasTile(m.id)) {
      const slot = host.mosaicFocusSlot();
      if (!mosaicSnap) mosaicSnap = host.captureMosaicSnap();
      if (!slot || !host.mosaicSetPaneView(slot, m.id)) {
        const kept = host.getLastConsentedModeId() || prevLive;
        rollbackSwitch(host, kept, m, prevPresent, mosaicSnap, null, "failed", signal);
        return;
      }
    }
    host.applyMosaicModeVisuals(m, opts, spec, tileStage);
    host.applyViewLook({ skyAfterReady: !gateScene && host.shouldLoadPluginRuntime(m) });
    if (gateScene && spec) gateUntilOk(host, m, spec, signal);
    scheduleConsentFinalize(host, m, spec, paneSpec, prevLive, signal);
    return;
  }

  host.applySoloModeVisuals(m, opts, spec, tileStage);
  host.applyViewLook({ skyAfterReady: !gateScene && host.shouldLoadPluginRuntime(m) });
  if (gateScene && spec) gateUntilOk(host, m, spec, signal);
  scheduleConsentFinalize(host, m, spec, paneSpec, prevLive, signal);
}

/**
 * Before the OK: the previous view's pack and sky come off (theme background), the HUD names the
 * pick, and the tile shows Needs you. Nothing of the picked pack loads.
 */
function gateUntilOk(host: ApplyModeHost, m: ViewMode, spec: PluginView, signal: AbortSignal): void {
  host.syncModeHud(m, spec);
  if (!host.mosaic?.on || (m.pluginId && m.standalone)) host.stopPackRuntime?.(signal);
  // Auto-consent resolves before any notice is written: starting now, the view once it grants.
  if (host.willAutoConsent?.(spec)) setViewState(tileFor(host, m), m.id, { kind: "starting" });
  else showPickNeedsYou(host, m, spec);
}
