import type { Mosaic } from "../graph/mosaic";
import { consentBlockMessage, mosaicFocusSlot, mosaicSwapFrom } from "./apply-mode-mosaic";
import { clearConsentPendingForPane, registerConsentPending } from "./consent-pending-panes";

export type SwitchPaneViewResult =
  | { ok: true; paneId: string; viewId: string }
  | { ok: false; reason: string };

export type SwitchPaneViewHost = Pick<
  Mosaic,
  "tileIds" | "focusedId" | "setPaneView" | "setPaneNotice" | "focus"
>;

export type SwitchPaneViewOpts = {
  /** Current mode on the tile (tile/settings pick). Header omits and uses focus / swap-from. */
  fromViewId?: string;
  ensureReviewed: () => Promise<boolean>;
  spec: { name?: string } | null | undefined;
  /** Release rAF/pack/writer leases for a retiring view id. */
  teardownView: (viewId: string) => void;
  /** Bind mode, sky, and pack delivery on the tile after layout swap. */
  mountView: (viewId: string) => void | Promise<void>;
  /** Persist mosaicTiles / refresh settings after a successful swap. */
  persistLayout: () => void;
  /** Catalog plugin id when `toViewId` is a plugin view (for consent-resume). */
  pluginId?: string | null;
};

const paneSwitchGen = new Map<string, number>();
let switchSeq = 0;

export function resetPaneSwitchTokens(): void {
  paneSwitchGen.clear();
  switchSeq = 0;
}

function beginPaneSwitch(paneKey: string): number {
  const token = ++switchSeq;
  paneSwitchGen.set(paneKey, token);
  return token;
}

function paneSwitchStale(paneKey: string, token: number): boolean {
  return paneSwitchGen.get(paneKey) !== token;
}

type ResolvedSlot =
  | { ok: true; paneId: string; swap: boolean; fromViewId: string; toViewId: string }
  | { ok: false; reason: string };

/** Resolve which tile slot will change and whether `setPaneView` is needed. */
export function resolvePaneSwitchSlot(
  mosaic: Pick<SwitchPaneViewHost, "tileIds" | "focusedId">,
  toViewId: string,
  fromViewId?: string,
): ResolvedSlot {
  if (!toViewId) return { ok: false, reason: "No view selected." };

  if (fromViewId !== undefined) {
    let paneId = fromViewId;
    if (!mosaic.tileIds.includes(paneId)) {
      const fallback = mosaicFocusSlot(mosaic);
      if (!fallback) return { ok: false, reason: "That tile is no longer on the wall." };
      paneId = fallback;
    }
    if (paneId === toViewId) return { ok: true, paneId, swap: false, fromViewId: paneId, toViewId };
    return { ok: true, paneId, swap: true, fromViewId: paneId, toViewId };
  }

  if (mosaic.tileIds.includes(toViewId)) {
    return { ok: true, paneId: toViewId, swap: false, fromViewId: toViewId, toViewId };
  }

  const swapFrom = mosaicSwapFrom(mosaic, toViewId);
  if (!swapFrom) return { ok: false, reason: "No tile on the wall to switch." };
  return { ok: true, paneId: swapFrom, swap: true, fromViewId: swapFrom, toViewId };
}

/**
 * Single host path for header mode, tile chrome, and settings wall slot picks.
 * On deny/failure nothing on the wall/header mutates except an inline tile notice.
 */
export async function switchPaneView(
  mosaic: SwitchPaneViewHost,
  toViewId: string,
  opts: SwitchPaneViewOpts,
): Promise<SwitchPaneViewResult> {
  const slot = resolvePaneSwitchSlot(mosaic, toViewId, opts.fromViewId);
  if (!slot.ok) {
    const noticePane = mosaicFocusSlot(mosaic);
    if (noticePane) mosaic.setPaneNotice(noticePane, slot.reason);
    return { ok: false, reason: slot.reason };
  }

  const token = beginPaneSwitch(slot.paneId);

  if (!(await opts.ensureReviewed())) {
    if (paneSwitchStale(slot.paneId, token)) {
      return { ok: false, reason: "A newer view switch is already in progress." };
    }
    const msg = consentBlockMessage(opts.spec);
    mosaic.setPaneNotice(slot.paneId, msg);
    const pid = opts.pluginId?.trim();
    if (pid && slot.swap) {
      registerConsentPending({
        paneId: slot.paneId,
        toViewId: slot.toViewId,
        fromViewId: opts.fromViewId,
        pluginId: pid,
      });
    }
    return { ok: false, reason: msg };
  }

  if (paneSwitchStale(slot.paneId, token)) {
    return { ok: false, reason: "A newer view switch is already in progress." };
  }

  if (slot.swap) {
    opts.teardownView(slot.fromViewId);
    if (!mosaic.setPaneView(slot.fromViewId, slot.toViewId)) {
      const msg = "Could not swap that view on the wall.";
      mosaic.setPaneNotice(slot.paneId, msg);
      return { ok: false, reason: msg };
    }
  }

  if (paneSwitchStale(slot.paneId, token)) {
    return { ok: false, reason: "A newer view switch is already in progress." };
  }

  mosaic.setPaneNotice(slot.toViewId, null);
  clearConsentPendingForPane(slot.paneId);
  mosaic.focus(slot.toViewId);
  await opts.mountView(slot.toViewId);
  opts.persistLayout();

  return { ok: true, paneId: slot.paneId, viewId: slot.toViewId };
}
