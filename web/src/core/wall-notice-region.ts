/** Shared bottom-centre wall notice stack (restart, retry, boot refusals, …). */

export type WallNoticeKind = "info" | "error";

export type WallNoticeAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

export type PostWallNoticeOpts = {
  kind: WallNoticeKind;
  text: string;
  action?: WallNoticeAction;
};

export type WallNoticeDismiss = () => void;

export type WallNoticeHandle = {
  dismiss: WallNoticeDismiss;
  element: HTMLElement | null;
};

const MAX_VISIBLE = 3;
const NOTICE_CLASS = "mosaic-wall-notice";
const RETRY_CLASS = "mosaic-wall-notice-retry";

type LiveNotice = {
  kind: WallNoticeKind;
  el: HTMLElement;
};

let regionEl: HTMLElement | null = null;
const visible: LiveNotice[] = [];
const queued: PostWallNoticeOpts[] = [];

function isErrorKind(kind: WallNoticeKind): boolean {
  return kind === "error";
}

/** Mount (or return) the single viewport-fixed notice region. */
export function ensureWallNoticeRegion(): HTMLElement {
  const existing = document.getElementById("wall-notice-region");
  if (existing) {
    regionEl = existing;
    return existing;
  }
  const el = document.createElement("div");
  el.id = "wall-notice-region";
  el.className = "wall-notice-region";
  el.setAttribute("role", "status");
  document.body.appendChild(el);
  regionEl = el;
  return el;
}

function removeVisibleAt(index: number): void {
  const entry = visible[index];
  if (!entry) return;
  entry.el.remove();
  visible.splice(index, 1);
}

function oldestNonErrorIndex(): number {
  return visible.findIndex((n) => !isErrorKind(n.kind));
}

function canPlaceWithoutQueue(opts: PostWallNoticeOpts): boolean {
  if (visible.length < MAX_VISIBLE) return true;
  return oldestNonErrorIndex() >= 0 || !isErrorKind(opts.kind);
}

function flushQueue(): void {
  while (queued.length > 0) {
    const next = queued[0]!;
    if (!canPlaceWithoutQueue(next)) break;
    queued.shift();
    placeNotice(next);
  }
}

function placeNotice(opts: PostWallNoticeOpts): HTMLElement {
  const host = ensureWallNoticeRegion();
  if (visible.length >= MAX_VISIBLE) {
    const evict = oldestNonErrorIndex();
    if (evict >= 0) removeVisibleAt(evict);
  }
  const el = document.createElement("div");
  el.className = NOTICE_CLASS;
  el.dataset.wallNoticeKind = opts.kind;
  const span = document.createElement("span");
  span.textContent = opts.text;
  el.append(span);
  if (opts.action) {
    el.append(document.createTextNode(" "));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = RETRY_CLASS;
    btn.textContent = opts.action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void opts.action!.onClick();
    });
    el.append(btn);
  }
  host.appendChild(el);
  visible.push({ kind: opts.kind, el });
  return el;
}

function dismissElement(el: HTMLElement): void {
  const i = visible.findIndex((n) => n.el === el);
  if (i >= 0) removeVisibleAt(i);
  flushQueue();
}

/** Post a notice; returns dismiss handle and mounted element (null when queued). */
export function postWallNotice(opts: PostWallNoticeOpts): WallNoticeHandle {
  if (!canPlaceWithoutQueue(opts)) {
    queued.push(opts);
    const pending = opts;
    return {
      element: null,
      dismiss: () => {
        const qi = queued.indexOf(pending);
        if (qi >= 0) queued.splice(qi, 1);
      },
    };
  }
  const el = placeNotice(opts);
  return {
    element: el,
    dismiss: () => dismissElement(el),
  };
}

/** Remove every visible notice and clear the error wait queue. */
export function clearWallNoticeRegion(): void {
  while (visible.length > 0) removeVisibleAt(0);
  queued.length = 0;
}

export function wallNoticeRegionElement(): HTMLElement | null {
  return regionEl ?? document.getElementById("wall-notice-region");
}

export function wallNoticeRegionChildren(): HTMLElement[] {
  const host = wallNoticeRegionElement();
  if (!host) return [];
  return [...host.querySelectorAll(`.${NOTICE_CLASS}`)] as HTMLElement[];
}
