/** Wall-level status strip on `#wall`. */

const WALL_NOTICE_CLASS = "mosaic-wall-notice";

function wallNoticeHost(): HTMLElement | null {
  return document.getElementById("wall");
}

function wallNoticeElements(): HTMLElement[] {
  const host = wallNoticeHost();
  if (!host) return [];
  return [...host.querySelectorAll(`.${WALL_NOTICE_CLASS}`)] as HTMLElement[];
}

export function clearWallNotices(): void {
  for (const el of wallNoticeElements()) el.remove();
}

export function showWallStatusNotice(text: string): HTMLElement | null {
  const host = wallNoticeHost();
  if (!host) return null;
  clearWallNotices();
  const el = document.createElement("div");
  el.className = WALL_NOTICE_CLASS;
  el.setAttribute("role", "status");
  el.textContent = text;
  host.prepend(el);
  return el;
}

export function showWallRetryNotice(message: string, onRetry: () => void | Promise<void>): HTMLElement | null {
  const host = wallNoticeHost();
  if (!host) return null;
  clearWallNotices();
  const el = document.createElement("div");
  el.className = WALL_NOTICE_CLASS;
  el.setAttribute("role", "status");
  const span = document.createElement("span");
  span.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mosaic-wall-notice-retry";
  btn.textContent = "Retry";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void onRetry();
  });
  el.append(span, " ", btn);
  host.prepend(el);
  return el;
}
