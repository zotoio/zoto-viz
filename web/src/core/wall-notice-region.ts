export type NoticeKey =
  | "server-restarted"
  | "retry-failed"
  | "context-lost"
  | "context-not-restored"
  | "install-failed"
  | "layout-refused-boot"
  | "layout-refused-profile"
  | "update-rolled-back"
  | "pack-navigation-stopped"
  | "drawer-edit-discarded";
const NOTICE_ROUTE = {
  "install-failed": "alert",
  "context-not-restored": "alert",
  "retry-failed": "status",
  "update-rolled-back": "alert",
  "server-restarted": "status",
  "context-lost": "status",
  "layout-refused-boot": "status",
  "layout-refused-profile": "status",
  "pack-navigation-stopped": "status",
  "drawer-edit-discarded": "status",
} as const satisfies Record<NoticeKey, "status" | "alert">;
export type AlertKey = { [K in NoticeKey]: (typeof NOTICE_ROUTE)[K] extends "alert" ? K : never }[NoticeKey];
export type StatusKey = Exclude<NoticeKey, AlertKey>;
type NoticeAction = { label: string; onClick: () => void };
export type WallNoticeArgs =
  | { key: Exclude<StatusKey, "retry-failed">; text: string; action?: undefined; autoClearMs?: number }
  | { key: "retry-failed"; text: string; action: NoticeAction; autoClearMs?: undefined }
  | { key: AlertKey; text: string; action?: NoticeAction; autoClearMs?: undefined };
export type WallNoticeHandle = { dismiss(): void; readonly live: boolean };
const MAX_VISIBLE = 3;
type Entry = {
  key: NoticeKey;
  text: string;
  action?: NoticeAction;
  autoClearMs?: number;
  node: HTMLElement | null;
  timer: ReturnType<typeof setTimeout> | null;
  armedMs?: number;
  isError: boolean;
  cleared: boolean;
  handle: WallNoticeHandle;
};
let regionNode: HTMLElement | null = null;
let mountRoot: HTMLElement | null = null;
let statusContainer: HTMLElement | null = null;
let alertContainer: HTMLElement | null = null;
const visible: Entry[] = [];
const keyToLive = new Map<NoticeKey, Entry>();
const queue = new Map<NoticeKey, Entry>();
function isErrorKey(key: NoticeKey): boolean {
  return NOTICE_ROUTE[key] === "alert";
}
function syncQueueCount(): void {
  if (regionNode) regionNode.dataset.queueCount = String(queue.size);
}
function pickContainer(key: NoticeKey): HTMLElement {
  return NOTICE_ROUTE[key] === "alert" ? alertContainer! : statusContainer!;
}
function clearNoticeTimer(e: Entry): void {
  if (e.timer != null) {
    clearTimeout(e.timer);
    e.timer = null;
  }
}
function syncNoticeTimer(e: Entry, restart: boolean): void {
  const ms = e.autoClearMs && e.autoClearMs > 0 && !e.isError && !e.action ? e.autoClearMs : undefined;
  if (ms != null && e.timer != null && ms === e.armedMs && !restart) return;
  clearNoticeTimer(e);
  if (ms == null) return;
  e.armedMs = ms;
  e.timer = setTimeout(() => dismissEntry(e), ms);
}
function detachRow(node: Element): void {
  if (mountRoot && node.contains(document.activeElement)) mountRoot.focus();
  node.remove();
}
function writeRowContent(e: Entry): void {
  const node = e.node!;
  let span = node.querySelector<HTMLElement>(".wall-notice-text");
  if (!span) {
    span = document.createElement("span");
    span.className = "wall-notice-text";
    node.prepend(span);
  }
  if (span.textContent !== e.text) span.textContent = e.text;
  const existingBtn = node.querySelector<HTMLButtonElement>(".wall-notice-action");
  if (e.action) {
    if (!existingBtn) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wall-notice-action btn small";
      btn.textContent = e.action.label;
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); e.action?.onClick(); });
      node.append(btn);
    } else if (existingBtn.textContent !== e.action.label) existingBtn.textContent = e.action.label;
  } else if (existingBtn) detachRow(existingBtn);
}
function removeLiveNotice(e: Entry): void {
  e.cleared = true;
  clearNoticeTimer(e);
  if (e.node) {
    detachRow(e.node);
    e.node = null;
  }
  const idx = visible.indexOf(e);
  if (idx >= 0) visible.splice(idx, 1);
  if (keyToLive.get(e.key) === e) keyToLive.delete(e.key);
}
function insertVisible(e: Entry): void {
  e.node = document.createElement("div");
  e.node.className = "wall-notice-row";
  e.node.dataset.noticeKey = e.key;
  writeRowContent(e);
  pickContainer(e.key).appendChild(e.node);
  visible.push(e);
  keyToLive.set(e.key, e);
  syncNoticeTimer(e, true);
}
function evictOldestNonError(): boolean {
  for (const e of visible) {
    if (!e.isError) {
      removeLiveNotice(e);
      return true;
    }
  }
  return false;
}
function dismissEntry(e: Entry): void {
  if (keyToLive.get(e.key) === e) {
    removeLiveNotice(e);
    if (queue.size > 0) {
      const next = queue.values().next().value as Entry;
      queue.delete(next.key);
      syncQueueCount();
      insertVisible(next);
    }
    return;
  }
  if (queue.get(e.key) === e) {
    e.cleared = true;
    queue.delete(e.key);
    syncQueueCount();
  }
}
/** Status notices stack above error notices. Within each group, the newest is at the bottom. */
export function mountWallNoticeRegion(root: HTMLElement): void {
  if (regionNode?.isConnected) return;
  mountRoot = root;
  if (!root.hasAttribute("tabindex")) root.tabIndex = -1;
  if (regionNode && !regionNode.isConnected) {
    for (const e of [...visible, ...queue.values()]) removeLiveNotice(e);
    queue.clear();
    syncQueueCount();
    root.appendChild(regionNode);
    return;
  }
  regionNode = document.createElement("div");
  regionNode.className = "wall-notice-region";
  regionNode.dataset.queueCount = "0";
  statusContainer = document.createElement("div");
  statusContainer.className = "wall-notice-status";
  statusContainer.setAttribute("role", "status");
  alertContainer = document.createElement("div");
  alertContainer.className = "wall-notice-alert";
  alertContainer.setAttribute("role", "alert");
  regionNode.append(statusContainer, alertContainer);
  root.appendChild(regionNode);
}
export function postWallNotice(args: WallNoticeArgs): WallNoticeHandle {
  if (!regionNode) throw new Error("wall notice region not mounted");
  const { key, text, action, autoClearMs } = args;
  const live = keyToLive.get(key);
  if (live) {
    const textChanged = live.text !== text;
    live.text = text;
    live.action = action;
    live.autoClearMs = autoClearMs;
    writeRowContent(live);
    syncNoticeTimer(live, textChanged);
    return live.handle;
  }
  const queued = queue.get(key);
  if (queued) {
    Object.assign(queued, { text, action, autoClearMs });
    return queued.handle;
  }
  const e = { key, text, action, autoClearMs, node: null, timer: null, isError: isErrorKey(key), cleared: false } as Entry;
  e.handle = { dismiss: () => dismissEntry(e), get live() { return !e.cleared; } };
  if (visible.length >= MAX_VISIBLE && !evictOldestNonError()) { queue.set(key, e); syncQueueCount(); } else insertVisible(e);
  return e.handle;
}
