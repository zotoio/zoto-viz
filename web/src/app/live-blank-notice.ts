import { paintPackAssetPaneNotice, type PackAssetPaneNoticeOpts } from "../plugins/pack-asset-pane-notice";
import { liveBlankNoticeText } from "../plugins/plugin-copy";

export interface LiveBlankNoticeHost {
  /** Mosaic pane notice (when the wall is a mosaic), else null. */
  setPaneNotice: ((id: string, text: string | null, recipe: "default", opts?: PackAssetPaneNoticeOpts) => void) | null;
  /** Element that carries this tile's notice layer. */
  paneEl: (paneId: string) => ParentNode | null;
  /** Solo wall scene element (mosaic off). */
  soloEl: HTMLElement;
  viewName: (paneId: string) => string | null;
  retry: () => void;
}

/**
 * "<View> is running but not showing anything." with Retry, on the same notice layer as the
 * other pack notices. Clearing removes only this notice, never a consent / reconnect notice.
 */
export function paintLiveBlankNotice(
  host: LiveBlankNoticeHost,
  paneId: string,
  packId: string,
  blank: boolean,
): void {
  const ours = liveBlankNoticeText(host.viewName(paneId) ?? packId);
  if (!blank) {
    const cur = host.paneEl(paneId)?.querySelector(".mosaic-pane-notice-text")?.textContent;
    if (cur !== ours) return;
  }
  const text = blank ? ours : null;
  const opts: PackAssetPaneNoticeOpts | undefined = blank ? { showRetry: true, onRetry: host.retry } : undefined;
  if (host.setPaneNotice) host.setPaneNotice(paneId, text, "default", opts);
  else paintPackAssetPaneNotice(host.soloEl, text, "default", opts);
}
