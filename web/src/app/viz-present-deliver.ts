import type { StateMsg } from "../core/types";
import { vizClockMs } from "../core/viz-clock";
import { monoMs, type MonoMs } from "../core/viz-time";
import type { Mosaic } from "../graph/mosaic";
import type { NetScene } from "../graph/scene";
import { noteHostDirect } from "../plugins/viz-drive";
import type { PluginView } from "../plugins/plugin";
import { illustratedSourceBind, parseSourceBind } from "../core/sources";
import type { VizDataFrame, VizFrameBudget, VizBufferWriter } from "../plugins/viz-host";
import { syncVizPackRenderCanvas } from "../plugins/viz-pack-host";
import {
  mirrorMosaicTileCadenceFromPrimary,
  vizTileBudgetRegistry,
} from "../plugins/viz-tile-budget";
import type { PluginSandbox } from "../plugins/host";
import { parseHnRainLook } from "../../../plugins/src/hn-rain/frontend/crawl";
import type { RenderHost } from "../graph/render-host";
import type { FeedTitleCube } from "../plugins/feed-title-cube";
import { deliverVizPluginFrame, type VizFrameTickSandbox } from "./viz-frame-tick";
import { mainVizBuildFrame, mainVizDeliver } from "./viz-main-deliver";
import {
  bindMosaicTileBudgetLines,
  mosaicTileBudgetLines,
} from "./main-viz-tile-lines";
import { STEREO_BINS } from "../../../plugins/src/stereo-gram/frontend/drive";
import { normalizeVizDemoPackId, type VizHud } from "../ui/viz-hud";
import type { ViewMode } from "../core/modes";
import { notePackSandboxFrame, packPerfEnabled } from "../core/pack-host-perf";

export interface VizPresentDeliverHost {
  modeById: (viewId: string) => ViewMode;
  modeSelValue: () => string;
  pluginSpecs: PluginView[];
  tsWatchId: () => string;
  mosaic: Pick<Mosaic, "on" | "tileIds" | "mainMode" | "focusedId" | "graphScene"> | null | undefined;
  scene: NetScene;
  renderHost: RenderHost;
  sandbox: PluginSandbox & { handlers: VizFrameTickSandbox["handlers"] };
  vizBudget: VizFrameBudget;
  getVizWriter: () => VizBufferWriter | null;
  bindVizWriter: (spec: PluginView | null) => void;
  vizHud: VizHud;
  optsFor: (m: ViewMode) => Record<string, string>;
  mosaicTileViewId: (slot: string) => string;
  pluginSpecForMode: (modeId: string) => PluginView | null;
  syncPanelPackSub: (packPanelId: string, on: boolean) => void;
  feedTitleCube: FeedTitleCube;
  getVizFrameClockMs: () => MonoMs;
  setVizFrameClockMs: (ms: MonoMs) => void;
  syncVizBudgetTileScope: () => void;
  /** Production tile-health: viz pack wrote into the sandbox this frame. */
  noteVizWrite?: () => void;
  /** Production tile-health: a viz frame was delivered to the sandbox. */
  onVizFrameDelivered?: (frame: VizDataFrame) => void;
}

/** One viz budget deliver + sandbox frame (display cadence, not websocket cadence). */
export function tickVizPresentDeliver(shown: StateMsg, host: VizPresentDeliverHost): void {
  const mode = host.modeById(host.modeSelValue());
  const active = (mode.pluginId && host.pluginSpecs.find((p) => p.id === mode.pluginId))
    || host.pluginSpecs.find((p) => p.id === host.tsWatchId())
    || null;
  const packId = normalizeVizDemoPackId(active?.id ?? mode.pluginId);
  const mosaicDemoPacks = host.mosaic?.on
    && host.mosaic.tileIds.some((id) => normalizeVizDemoPackId(host.modeById(id).pluginId));
  const packPanelId = host.mosaic?.on
    ? (host.mosaic.focusedId || host.mosaic.mainMode || host.mosaic.tileIds[0] || "main")
    : "main";
  host.syncPanelPackSub(packPanelId, !!(packId && (active?.capabilities?.includes("viz.read") || packId)));
  if (!(active?.capabilities?.includes("viz.read") || packId || mosaicDemoPacks)) return;

  host.syncVizBudgetTileScope();

  const vizWriter = host.getVizWriter();
  if (!vizWriter && active) host.bindVizWriter(active);

  const audio = host.scene.pulseNow.bass;
  const idle = active?.viz?.idle;
  const bind = packId === "hn-rain" || packId === "hn-term"
    ? illustratedSourceBind(host.optsFor(mode))
    : parseSourceBind(host.optsFor(mode));

  const scopeTileIds = host.mosaic?.on && host.mosaic.tileIds.length ? host.mosaic.tileIds : ["main"];
  const primaryTileId = host.mosaic?.on ? (host.mosaic.mainMode || scopeTileIds[0] || "main") : "main";
  host.vizBudget.setTileId(primaryTileId);

  const prevClockMs = host.getVizFrameClockMs();
  const delivered = mainVizDeliver({
    budget: host.vizBudget,
    prevClockMs,
    state: shown,
    audio,
    buildFrame: (s, pt, a) => mainVizBuildFrame(s, pt, a, idle, bind, active?.viz?.contract ?? 2),
    onFrame: (f) => {
      host.onVizFrameDelivered?.(f);
      if (packId === "stereo-gram") f.spectrum = host.scene.heardSpectrum(STEREO_BINS).spectrum;
      const coalesceMosaic = !!(host.mosaic?.on && mosaicDemoPacks);
      if (!coalesceMosaic && packId) {
        noteHostDirect("main");
        syncVizPackRenderCanvas(host.renderHost.bufferPixelSize());
      }
      deliverVizPluginFrame({
        frame: f,
        sandbox: host.sandbox,
        mosaic: host.mosaic,
        mosaicDemoPacks: coalesceMosaic,
        packId,
        activeMode: mode,
        modeById: host.modeById,
        mosaicTileViewId: host.mosaicTileViewId,
        pluginSpecForMode: host.pluginSpecForMode,
        optsFor: host.optsFor,
        budgetStats: host.vizBudget.stats,
      });
      if (packPerfEnabled() && active?.id) notePackSandboxFrame(active.id);
    },
  });
  host.setVizFrameClockMs(delivered.nextClockMs);

  const frame = delivered.frame;
  if (host.mosaic?.on && scopeTileIds.length > 1) {
    mirrorMosaicTileCadenceFromPrimary(primaryTileId, scopeTileIds);
  }
  if (frame) {
    if (packId === "hn-rain" || packId === "hn-term") {
      host.scene.setVizHeadlines(frame.headlines.map((h) => h.text).join(" / ") || "HN");
    }
    if (packId === "hn-rain") {
      const pics = parseHnRainLook(host.optsFor(mode)).pics && !host.mosaic?.on;
      host.feedTitleCube.setActive(pics);
      if (pics) host.feedTitleCube.sync(frame.headlines.map((h) => h.text));
    }
  }

  const activeTiles = vizTileBudgetRegistry.activeTileCount();
  const budgetTileId = host.mosaic?.on ? (host.mosaic.mainMode || host.mosaic.tileIds[0] || "main") : "main";
  const tileLinesRaw = host.mosaic?.on ? mosaicTileBudgetLines(host.mosaic.tileIds) : undefined;
  if (tileLinesRaw) bindMosaicTileBudgetLines(tileLinesRaw, (id) => vizTileBudgetRegistry.getTile(id));
  host.vizHud.tick({
    packId,
    packName: active?.name ?? packId ?? "",
    stats: host.vizBudget.stats,
    frame: host.vizBudget.lastBuilt,
    state: shown,
    now: vizClockMs(),
    tileBudget: vizTileBudgetRegistry.getTile(budgetTileId),
    activeTiles,
    tileBudgetLines: tileLinesRaw,
  });
}
