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
