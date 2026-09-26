import { mosaicTileViewId } from "../graph/mosaic-tile-id";
import type { ViewMode } from "../core/modes";
import type { Settings } from "../ui/settings";

export type ViewDrawerRebindContext = {
  settings: Settings | null | undefined;
  modeId: string;
  flags: { keepLayout?: boolean };
  hostModeById: (id: string) => ViewMode;
};

function packKeyForMode(hostModeById: (id: string) => ViewMode, modeId: string): string {
  const m = hostModeById(modeId);
  return m.pluginId ?? mosaicTileViewId(m.id);
}

/** Whether mosaic layout sync should rebuild the view drawer (main `applyMode` + anim sync). */
export function shouldRebindViewDrawerOnApplyMode(ctx: ViewDrawerRebindContext): boolean {
  if (ctx.flags.keepLayout) return false;
  const { settings, modeId, hostModeById } = ctx;
  if (!settings?.isOpen || settings.activePane !== "view" || !settings.viewBind?.spec) return true;
  const focus = settings.viewFocus?.trim() || modeId;
  return packKeyForMode(hostModeById, focus) !== packKeyForMode(hostModeById, modeId);
}

export function rebindViewDrawerOnApplyMode(
  bindThisView: (modeId: string) => void,
  ctx: ViewDrawerRebindContext,
): void {
  if (shouldRebindViewDrawerOnApplyMode(ctx)) bindThisView(ctx.modeId);
}
