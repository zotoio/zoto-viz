export type NoticeKey =
  | "server-restarted"
  | "retry-failed"
  | "context-lost"
  | "context-not-restored"
  | "install-failed"
  | "layout-refused-boot"
  | "layout-refused-profile";

const NOTICE_ROUTE: Record<NoticeKey, "status" | "alert"> = {
  "server-restarted": "status",
  "retry-failed": "alert",
  "context-lost": "status",
  "context-not-restored": "alert",
  "install-failed": "alert",
  "layout-refused-boot": "status",
  "layout-refused-profile": "status",
};

const MAX_VISIBLE = 3;

const REGION_CLASS = "wall-notice-region";
const STATUS_CLASS = "wall-notice-status";
const ALERT_CLASS = "wall-notice-alert";
const ROW_CLASS = "wall-notice-row";

type NoticeAction = { label: string; onClick: () => void };

type QueuedNotice = {
  text: string;
  action?: NoticeAction;
  autoClearMs?: number;
};

type LiveNotice = {
  key: NoticeKey;
  node: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  isError: boolean;
};

let regionNode: HTMLElement | null = null;
let statusContainer: HTMLElement | null = null;
let alertContainer: HTMLElement | null = null;

const visible: LiveNotice[] = [];
const keyToLive = new Map<NoticeKey, LiveNotice>();
const queue = new Map<NoticeKey, QueuedNotice>();

function isErrorKey(key: NoticeKey): boolean {
  return NOTICE_ROUTE[key] === "alert";
}

function syncQueueCount(): void {
  if (regionNode) regionNode.dataset.queueCount = String(queue.size);
}

function pickContainer(key: NoticeKey): HTMLElement {
  return NOTICE_ROUTE[key] === "alert" ? alertContainer! : statusContainer!;
}

function clearNoticeTimer(notice: LiveNotice): void {
  if (notice.timer != null) {
    clearTimeout(notice.timer);
    notice.timer = null;
  }
}

function armNoticeTimer(notice: LiveNotice, autoClearMs?: number): void {
  clearNoticeTimer(notice);
  if (autoClearMs == null || autoClearMs <= 0) return;
  notice.timer = setTimeout(() => {
    dismissNotice(notice.key);
  }, autoClearMs);
}

function writeRowContent(node: HTMLElement, text: string, action?: NoticeAction): void {
  let span = node.querySelector<HTMLElement>(".wall-notice-text");
  if (!span) {
    span = document.createElement("span");
    span.className = "wall-notice-text";
    node.prepend(span);
  }
  if (span.getAttribute("data-notice-text") !== text) {
    span.textContent = text;
    span.setAttribute("data-notice-text", text);
  }
  const existingBtn = node.querySelector<HTMLButtonElement>(".wall-notice-action");
  if (action) {
    if (!existingBtn) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wall-notice-action btn small";
      btn.tabIndex = -1;
      btn.textContent = action.label;
      btn.addEventListener("click", (e) => { e.stopPropagation(); action.onClick(); });
      node.append(btn);
    } else if (existingBtn.textContent !== action.label) existingBtn.textContent = action.label;
  } else existingBtn?.remove();
}

function makeRow(key: NoticeKey, text: string, action?: NoticeAction): HTMLElement {
  const row = document.createElement("div");
  row.className = ROW_CLASS;
  row.dataset.noticeKey = key;
  row.tabIndex = -1;
  writeRowContent(row, text, action);
  return row;
}

function removeLiveNotice(notice: LiveNotice): void {
  clearNoticeTimer(notice);
  notice.node.remove();
  const idx = visible.indexOf(notice);
  if (idx >= 0) visible.splice(idx, 1);
  keyToLive.delete(notice.key);
}

function promoteQueued(key: NoticeKey): void {
  const pending = queue.get(key);
  if (!pending) return;
  queue.delete(key);
  syncQueueCount();
  insertVisible(key, pending.text, pending.action, pending.autoClearMs);
}

function insertVisible(
  key: NoticeKey,
  text: string,
  action?: NoticeAction,
  autoClearMs?: number,
): void {
  const node = makeRow(key, text, action);
  pickContainer(key).appendChild(node);
  const live: LiveNotice = { key, node, timer: null, isError: isErrorKey(key) };
  visible.push(live);
  keyToLive.set(key, live);
  armNoticeTimer(live, autoClearMs);
}

function evictOldestNonError(): boolean {
  for (const notice of visible) {
    if (!notice.isError) {
      removeLiveNotice(notice);
      return true;
    }
  }
  return false;
}

function dismissNotice(key: NoticeKey): void {
  const live = keyToLive.get(key);
  if (live) {
    removeLiveNotice(live);
    queue.delete(key);
    syncQueueCount();
    if (queue.size > 0) {
      const next = queue.keys().next().value as NoticeKey;
      promoteQueued(next);
    }
    return;
  }
  if (queue.delete(key)) syncQueueCount();
}

export function mountWallNoticeRegion(root: HTMLElement): void {
  if (regionNode?.isConnected) return;
  if (regionNode && !regionNode.isConnected) {
    for (const notice of [...visible]) removeLiveNotice(notice);
    queue.clear();
    syncQueueCount();
    statusContainer!.replaceChildren();
    alertContainer!.replaceChildren();
    root.appendChild(regionNode);
    return;
  }
  regionNode = document.createElement("div");
  regionNode.className = REGION_CLASS;
  regionNode.dataset.queueCount = "0";

  statusContainer = document.createElement("div");
  statusContainer.className = STATUS_CLASS;
  statusContainer.setAttribute("role", "status");
  statusContainer.tabIndex = -1;

  alertContainer = document.createElement("div");
  alertContainer.className = ALERT_CLASS;
  alertContainer.setAttribute("role", "alert");
  alertContainer.tabIndex = -1;

  regionNode.append(statusContainer, alertContainer);
  root.appendChild(regionNode);
}

export function postWallNotice(args: {
  key: NoticeKey;
  text: string;
  action?: NoticeAction;
  autoClearMs?: number;
}): { dismiss: () => void } {
  const { key, text, action, autoClearMs } = args;
  const dismiss = () => dismissNotice(key);

  const live = keyToLive.get(key);
  if (live) {
    writeRowContent(live.node, text, action);
    armNoticeTimer(live, autoClearMs);
    if (
      visible.length === MAX_VISIBLE &&
      visible.every((n) => n.isError) &&
      isErrorKey(key)
    ) {
      queue.set(key, { text, action, autoClearMs });
      syncQueueCount();
    }
    return { dismiss };
  }

  if (queue.has(key)) {
    queue.set(key, { text, action, autoClearMs });
    syncQueueCount();
    return { dismiss };
  }

  if (visible.length < MAX_VISIBLE) {
    insertVisible(key, text, action, autoClearMs);
    return { dismiss };
  }

  if (!evictOldestNonError()) {
    queue.set(key, { text, action, autoClearMs });
    syncQueueCount();
    return { dismiss };
  }

  insertVisible(key, text, action, autoClearMs);
  return { dismiss };
}
