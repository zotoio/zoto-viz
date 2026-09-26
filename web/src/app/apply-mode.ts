import type { ViewMode } from "../core/modes";
import type { DreamAnim } from "../graph/scene";
import type { ConsentReviewResult } from "./pack-consent";
import type { PluginView } from "../plugins/plugin";
import type { Select } from "../ui/ui";
import type { Mosaic } from "../graph/mosaic";
import {
  flashModeKeptPrevious,
  flashModeLoadFailed,
} from "./mode-switch-message";
import { settleConsentAndDrainAuto } from "./mode-switch-coordinator";
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
  ensureReviewed: (spec: PluginView | null) => Promise<ConsentReviewResult>;
  loadTsPlugin: (spec: PluginView | null, switchGen: number) => Promise<void>;
  syncPluginSky: (spec: PluginView | null, switchGen: number) => Promise<void>;
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
  applyViewLook: () => void;
  feedSetGraphBase: (base: string) => void;
  syncWifiIfNeeded: (m: ViewMode) => void;
  modeLabel: (m: ViewMode) => string;
  onConsentDeclined: () => void;
  shouldLoadPluginRuntime: (m: ViewMode) => boolean;
  isModeSwitchStale: (generation: number) => boolean;
  getLastConsentedModeId: () => string;
  markModeConsented: (modeId: string) => void;
  showRollbackMessage: (kind: "declined" | "failed", declined: ViewMode, keptModeId: string) => string | null;
};

export type ApplyModeFlags = { keepLayout?: boolean };

function rollbackSwitch(
  host: ApplyModeHost,
  keptModeId: string,
  declined: ViewMode,
  prevPresent: ReturnType<typeof capturePresentDriveBeforeLiveModeCommit>,
  mosaicSnap: MosaicAnimSnap | null,
  paneRevert: MosaicPaneRevert | null,
  kind: "declined" | "failed",
): string | null {
  const kept = host.modeById(keptModeId);
  if (paneRevert) host.mosaicSetPaneView(paneRevert.slot, paneRevert.modeId);
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
  host.onConsentDeclined();
  host.modeSel.focus();
  return host.showRollbackMessage(kind, declined, keptModeId);
}

function scheduleConsentFinalize(
  host: ApplyModeHost,
  m: ViewMode,
  spec: PluginView | null,
  paneSpec: PluginView | null,
  prevPresent: ReturnType<typeof capturePresentDriveBeforeLiveModeCommit>,
  mosaicSnap: MosaicAnimSnap | null,
  paneRevert: MosaicPaneRevert | null,
  switchGen: number,
): void {
  const targetId = m.id;
  const keptOnFailure = host.getLastConsentedModeId() || prevPresent.prevPresentMode;
  void (async () => {
    let result: ConsentReviewResult = "failed";
    try {
      result = await host.ensureReviewed(spec);
    } catch {
      result = "failed";
    }
    if (result === "aborted") {
      settleConsentAndDrainAuto("aborted");
      return;
    }
    if (host.isModeSwitchStale(switchGen)) {
      settleConsentAndDrainAuto(result);
      return;
    }
    if (host.getLiveMode() !== targetId) return;
    if (result === "ok") {
      host.markModeConsented(targetId);
      host.syncModeHud(m, spec);
      if (host.shouldLoadPluginRuntime(m)) {
        await host.loadTsPlugin(paneSpec, switchGen);
        if (host.isModeSwitchStale(switchGen)) {
          settleConsentAndDrainAuto(result);
          return;
        }
        await host.syncPluginSky(paneSpec, switchGen);
      }
      settleConsentAndDrainAuto(result);
      return;
    }
    rollbackSwitch(
      host,
      keptOnFailure,
      m,
      prevPresent,
      mosaicSnap,
      paneRevert,
      result === "declined" ? "declined" : "failed",
    );
    settleConsentAndDrainAuto(result);
  })();
}

export function applyModeImpl(
  host: ApplyModeHost,
  id: string,
  flags: ApplyModeFlags = {},
  switchGen: number,
): void {
  const m = host.modeById(id);
  const opts = host.optsFor(m);
  const prevLive = host.getLiveMode();
  const prevPresent = capturePresentDriveBeforeLiveModeCommit(prevLive);
  host.applySkyPrompt(m, opts);
  host.modeSel.value = m.id;
  localStorage.setItem("zoto-viz.mode", m.id);
  host.touch();
  host.applyPluginWall(m.id, { ...flags, prevMode: prevLive });

  const spec = m.pluginId ? host.pluginSpecForMode(m.id) : null;
  host.setLiveMode(m.id);
  host.refreshPluginDrive(spec, m.id);
  const paneSpec = host.skySpecForMode(m.id, spec);
  const skyStage = host.computeSkyStage(m, spec, opts);
  host.applyStageOnly(skyStage);
  host.applyModeFeedExtras(m, opts);
  host.bindThisView(m.id);
  host.clearModeOpts();

  let mosaicSnap: MosaicAnimSnap | null = null;
  let paneRevert: MosaicPaneRevert | null = null;

  host.feedSetGraphBase(m.graphBase ?? "topology");
  host.syncWifiIfNeeded(m);

  if (host.mosaic?.on && !(m.pluginId && m.standalone)) {
    if (host.mosaicShouldResize(m.id, !!flags.keepLayout)) {
      mosaicSnap = host.captureMosaicSnap();
      host.mosaicSetSizeForMode(m.id, mosaicSnap);
    }
    if (!host.mosaicHasTile(m.id)) {
      const slot = host.mosaicFocusSlot();
      if (!mosaicSnap) mosaicSnap = host.captureMosaicSnap();
      if (!slot || !host.mosaicSetPaneView(slot, m.id)) {
        const kept = host.getLastConsentedModeId() || prevLive;
        rollbackSwitch(host, kept, m, prevPresent, mosaicSnap, null, "failed");
        return;
      }
      paneRevert = { slot, modeId: prevLive };
    }
    host.applyMosaicModeVisuals(m, opts, spec, skyStage);
    host.applyViewLook();
    scheduleConsentFinalize(host, m, spec, paneSpec, prevPresent, mosaicSnap, paneRevert, switchGen);
    return;
  }

  host.applySoloModeVisuals(m, opts, spec, skyStage);
  host.applyViewLook();
  scheduleConsentFinalize(host, m, spec, paneSpec, prevPresent, mosaicSnap, paneRevert, switchGen);
}
