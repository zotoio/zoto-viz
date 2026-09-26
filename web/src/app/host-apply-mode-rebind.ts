import { drawerKeyForModeId } from "../graph/mosaic-tile-id";
import type { ViewMode } from "../core/modes";
import type { Settings } from "../ui/settings";

export type ViewDrawerRebindContext = {
  settings: Settings | null | undefined;
  modeId: string;
  flags: { keepLayout?: boolean };
  hostModeById: (id: string) => ViewMode;
};

/** Whether mosaic layout sync should rebuild the view drawer (main `applyMode` + anim sync). */
export function shouldRebindViewDrawerOnApplyMode(ctx: ViewDrawerRebindContext): boolean {
  if (ctx.flags.keepLayout) return false;
  const { settings, modeId, hostModeById } = ctx;
  if (!settings?.viewDrawerOpenWithSpec()) return true;
  const focus = settings.viewFocus?.trim() || modeId;
  return drawerKeyForModeId(focus) !== drawerKeyForModeId(modeId);
}

export function rebindViewDrawerOnApplyMode(
  bindThisView: (modeId: string) => void,
  ctx: ViewDrawerRebindContext,
): void {
  if (shouldRebindViewDrawerOnApplyMode(ctx)) bindThisView(ctx.modeId);
}
