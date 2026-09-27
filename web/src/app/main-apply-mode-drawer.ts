import type { ViewMode } from "../core/modes";
import type { Settings } from "../ui/settings";
import {
  rebindViewDrawerOnApplyMode,
  type ViewDrawerRebindContext,
} from "./host-apply-mode-rebind";

/** main.ts `applyMode` drawer rebind — skip rebuild when drawer key unchanged. */
export function runMainApplyModeDrawerRebind(
  bindThisView: (modeId: string) => void,
  ctx: {
    settings: Settings | null | undefined;
    modeId: string;
    flags: { keepLayout?: boolean };
    hostModeById: (id: string) => ViewMode;
  },
): void {
  const rebindCtx: ViewDrawerRebindContext = {
    settings: ctx.settings,
    modeId: ctx.modeId,
    flags: ctx.flags,
    hostModeById: ctx.hostModeById,
  };
  rebindViewDrawerOnApplyMode(bindThisView, rebindCtx);
}
