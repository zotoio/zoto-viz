/** Ephemeral wall-level notices (settings toasts, heal banners). Shader fallback must not post here. */

let wallNoticeCount = 0;

export function pushWallNotice(_message: string): void {
  wallNoticeCount++;
}

export function wallNoticeTotal(): number {
  return wallNoticeCount;
}

export function resetWallNotices(): void {
  wallNoticeCount = 0;
}
