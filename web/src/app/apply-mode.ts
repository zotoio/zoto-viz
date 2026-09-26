import type { DreamAnim, ViewMode } from "../core/modes";
import type { PluginView } from "../plugins/plugin";
import type { Select } from "../ui/ui";
import type { VizHud } from "../ui/viz-hud";
import type { NetScene } from "../graph/scene";
import type { Mosaic } from "../graph/mosaic";
import { flashModeLoadKeptPrevious } from "./mode-switch-message";
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
  ensureReviewed: (spec: PluginView | null) => Promise<boolean>;
  loadTsPlugin: (spec: PluginView | null) => Promise<void>;
  syncPluginSky: (spec: PluginView | null) => Promise<void>;
  mosaic: Mosaic | null;
  settingsAnim: () => DreamAnim;
  captureMosaicSnap: () => MosaicAnimSnap;
  restoreMosaicSnap: (snap: MosaicAnimSnap, preferMode: string) => void;
  mosaicSetSizeForMode: (modeId: string) => void;
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
};

export type ApplyModeFlags = { keepLayout?: boolean };

function rollbackFailedSwitch(
  host: ApplyModeHost,
  prevMode: string,
  declined: ViewMode,
  prevPresent: ReturnType<typeof capturePresentDriveBeforeLiveModeCommit>,
  mosaicSnap: MosaicAnimSnap | null,
): string {
  const kept = host.modeById(prevMode);
  host.modeSel.value = prevMode;
  host.setLiveMode(prevMode);
  localStorage.setItem("zoto-viz.mode", prevMode);
  host.applyPluginWall(prevMode, { prevMode: declined.id, keepLayout: true });
  restorePresentDriveAfterModeRollback(
    prevPresent.prevPresentSpec,
    prevPresent.prevPresentMode,
    prevMode,
    (id) => host.pluginSpecForMode(id),
    host.presentDriveDeps,
  );
  if (mosaicSnap) host.restoreMosaicSnap(mosaicSnap, prevMode);
  host.reapplyCommittedModeSurfaces(prevMode);
  host.applyViewLook();
  host.syncModeHud(kept, host.pluginSpecForMode(prevMode));
  host.onConsentDeclined();
  host.modeSel.focus();
  return flashModeLoadKeptPrevious(host.modeLabel(declined), host.modeLabel(kept));
}

function scheduleConsentFinalize(
  host: ApplyModeHost,
  m: ViewMode,
  spec: PluginView | null,
  paneSpec: PluginView | null,
  prevMode: string,
  prevPresent: ReturnType<typeof capturePresentDriveBeforeLiveModeCommit>,
  mosaicSnap: MosaicAnimSnap | null,
): void {
  const targetId = m.id;
  void (async () => {
    const ok = await host.ensureReviewed(spec);
    if (host.getLiveMode() !== targetId) return;
    if (!ok) {
      rollbackFailedSwitch(host, prevMode, m, prevPresent, mosaicSnap);
      return;
    }
    host.syncModeHud(m, spec);
    if (host.shouldLoadPluginRuntime(m)) {
      void host.loadTsPlugin(paneSpec);
      void host.syncPluginSky(paneSpec);
    }
  })();
}

export function applyModeImpl(host: ApplyModeHost, id: string, flags: ApplyModeFlags = {}): void {
  const m = host.modeById(id);
  const opts = host.optsFor(m);
  const prevMode = host.getLiveMode();
  host.applySkyPrompt(m, opts);
  host.modeSel.value = m.id;
  localStorage.setItem("zoto-viz.mode", m.id);
  host.touch();
  host.applyPluginWall(m.id, { ...flags, prevMode });

  const spec = m.pluginId ? host.pluginSpecForMode(m.id) : null;
  const prevPresent = capturePresentDriveBeforeLiveModeCommit(prevMode);
  host.setLiveMode(m.id);
  host.refreshPluginDrive(spec, m.id);
  const paneSpec = host.skySpecForMode(m.id, spec);
  const skyStage = host.computeSkyStage(m, spec, opts);
  host.applyStageOnly(skyStage);
  host.applyModeFeedExtras(m, opts);
  host.bindThisView(m.id);
  host.clearModeOpts();

  let mosaicSnap: MosaicAnimSnap | null = null;

  host.feedSetGraphBase(m.graphBase);
  host.syncWifiIfNeeded(m);

  if (host.mosaic?.on && !(m.pluginId && m.standalone)) {
    if (host.mosaicShouldResize(m.id, !!flags.keepLayout)) {
      mosaicSnap = host.captureMosaicSnap();
      host.mosaicSetSizeForMode(m.id);
    }
    if (!host.mosaicHasTile(m.id)) {
      if (!mosaicSnap) mosaicSnap = host.captureMosaicSnap();
      const slot = host.mosaicFocusSlot();
      if (!slot || !host.mosaicSetPaneView(slot, m.id)) {
        rollbackFailedSwitch(host, prevMode, m, prevPresent, mosaicSnap);
        return;
      }
    }
    host.applyMosaicModeVisuals(m, opts, spec, skyStage);
    host.applyViewLook();
    scheduleConsentFinalize(host, m, spec, paneSpec, prevMode, prevPresent, mosaicSnap);
    return;
  }

  host.applySoloModeVisuals(m, opts, spec, skyStage);
  host.applyViewLook();
  scheduleConsentFinalize(host, m, spec, paneSpec, prevMode, prevPresent, null);
}
