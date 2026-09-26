import type { ViewMode } from "../core/modes";
import { mosaicTileViewId } from "../graph/mosaic-tile-id";
import type { PluginView } from "../plugins/plugin";
import {
  hostIdleTargetForMode,
  mergeHostIdleForViews,
  pluginIdleOf,
  type HostIdleMergeResult,
} from "../plugins/fixtures/golden-state";
import type { StateMsg } from "../core/types";

export type FeedPaintInput = {
  raw: StateMsg;
  heroModeId: string;
  mosaicOn: boolean;
  mosaicTileIds: readonly string[];
  modeById: (id: string) => ViewMode;
  pluginSpecForMode: (modeId: string) => PluginView | null;
};

export function paintFeedState(input: FeedPaintInput): HostIdleMergeResult {
  const heroMode = input.modeById(input.heroModeId);
  const heroSpec = heroMode.pluginId ? input.pluginSpecForMode(heroMode.id) : null;
  const requests = [{
    slotId: "hero",
    idle: pluginIdleOf(heroSpec),
    target: hostIdleTargetForMode(heroMode),
  }];
  if (input.mosaicOn) {
    for (const tileSlot of input.mosaicTileIds) {
      const viewId = mosaicTileViewId(tileSlot);
      const mode = input.modeById(viewId);
      const spec = mode.pluginId ? input.pluginSpecForMode(mode.id) : null;
      requests.push({
        slotId: tileSlot,
        idle: pluginIdleOf(spec),
        target: hostIdleTargetForMode(mode),
      });
    }
  }
  return mergeHostIdleForViews(input.raw, requests);
}

export type FeedPaintScene = {
  update(msg: StateMsg): void;
  setAliasMap(map: Map<string, string>): void;
};

export type ApplyFeedSlotPaintsInput = {
  result: HostIdleMergeResult;
  mergeNames: boolean;
  collapseByName: (msg: StateMsg) => { msg: StateMsg; map: Map<string, string> };
  heroScene: FeedPaintScene;
  mosaicOn: boolean;
  mosaicTileIds: readonly string[];
  graphScene: (tileSlot: string) => FeedPaintScene | null | undefined;
  arcadeViews: ReadonlyArray<{ update(msg: StateMsg): void }>;
};

/** Paint path shared with `main.ts` feed() — per-slot state, no cross-tile golden leak. */
export function applyFeedSlotPaints(input: ApplyFeedSlotPaintsInput): StateMsg {
  const paintSlot = (slot: string): StateMsg => {
    const raw = input.result.slotPaints.get(slot) ?? input.result.slotPaints.get("hero")!;
    if (!input.mergeNames) return raw;
    return input.collapseByName(raw).msg;
  };
  const aliasFor = (slot: string): Map<string, string> => {
    const raw = input.result.slotPaints.get(slot) ?? input.result.slotPaints.get("hero")!;
    return input.mergeNames ? input.collapseByName(raw).map : new Map();
  };

  const heroPaint = paintSlot("hero");
  input.heroScene.setAliasMap(aliasFor("hero"));
  input.heroScene.update(heroPaint);

  if (input.mosaicOn) {
    for (const tileSlot of input.mosaicTileIds) {
      const scene = input.graphScene(tileSlot);
      if (!scene || scene === input.heroScene) continue;
      scene.setAliasMap(aliasFor(tileSlot));
      scene.update(paintSlot(tileSlot));
    }
  }

  for (const view of input.arcadeViews) view.update(heroPaint);

  return heroPaint;
}
