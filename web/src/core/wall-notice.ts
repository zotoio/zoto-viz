import {
  clearWallNoticeRegion,
  postWallNotice,
  type WallNoticeDismiss,
} from "./wall-notice-region";

export function clearWallNotices(): void {
  clearWallNoticeRegion();
}

export function showWallStatusNotice(text: string): HTMLElement | null {
  return postWallNotice({ kind: "info", text }).element;
}

export function showWallRetryNotice(
  message: string,
  onRetry: () => void | Promise<void>,
): HTMLElement | null {
  return postWallNotice({
    kind: "error",
    text: message,
    action: { label: "Retry", onClick: onRetry },
  }).element;
}

export type { WallNoticeDismiss };
