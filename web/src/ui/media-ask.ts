/**
 * In-page microphone / camera accept. Cursor Simple Browser and other
 * embedded Chromium shells have no permission chrome — getUserMedia then
 * hangs or auto-grants at the OS (indicator on) with nothing to click.
 * Allow is the user gesture that opens the device; Not now leaves it closed.
 */

import { probeWebGL } from "../graph/webgl";
import { micCaptureAllowed } from "../audio/want";
import { currentCamPolicy } from "../camera/want";

export type MediaAskKind = "mic" | "cam";

type Waiter = {
  audio: boolean;
  video: boolean | MediaTrackConstraints;
  reason: string;
  resolve: (stream: MediaStream | null) => void;
};

const ACCEPT_KEY = "zoto-viz.mediaAccept";
const DISMISS_KEY = "zoto-viz.mediaDismiss";

const granted: Record<MediaAskKind, boolean> = { mic: false, cam: false };
const dismissed: Record<MediaAskKind, boolean> = { mic: false, cam: false };

function loadDismissed(): void {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return;
    const j = JSON.parse(raw) as { mic?: boolean; cam?: boolean };
    dismissed.mic = j.mic === true;
    dismissed.cam = j.cam === true;
  } catch { /* ignore */ }
}

function persistDismissed(): void {
  try {
    const payload: { mic?: true; cam?: true } = {};
    if (dismissed.mic) payload.mic = true;
    if (dismissed.cam) payload.cam = true;
    if (!payload.mic && !payload.cam) {
      sessionStorage.removeItem(DISMISS_KEY);
      return;
    }
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify(payload));
  } catch { /* ignore */ }
}

loadDismissed();

function readAccept(): Record<MediaAskKind, boolean> {
  try {
    const raw = localStorage.getItem(ACCEPT_KEY);
    if (!raw) return { mic: false, cam: false };
    const j = JSON.parse(raw) as { mic?: boolean; cam?: boolean };
    return { mic: j.mic === true, cam: j.cam === true };
  } catch {
    return { mic: false, cam: false };
  }
}

function writeAccept(kind: MediaAskKind): void {
  const next = readAccept();
  next[kind] = true;
  try { localStorage.setItem(ACCEPT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  granted[kind] = true;
}

function accepted(kind: MediaAskKind): boolean {
  return granted[kind] || readAccept()[kind];
}

let queue: Waiter[] = [];
let flushScheduled = false;
const MEDIA_ASK_TITLE_ID = "media-ask-title";

type MediaAskHost = {
  waiters: Waiter[];
  audio: boolean;
  video: boolean;
  modal: HTMLDialogElement;
  previousFocus: HTMLElement | null;
  title: HTMLElement;
  body: HTMLDivElement;
  allow: HTMLButtonElement;
  cancel: HTMLButtonElement;
  settled: boolean;
};

let open: MediaAskHost | null = null;

function capturePreviousFocus(): HTMLElement | null {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el !== document.body) return el;
  return null;
}

function focusReturnTarget(previous: HTMLElement | null): HTMLElement | null {
  if (
    previous instanceof HTMLElement
    && previous.isConnected
    && !previous.closest("#wall")
    && !previous.classList.contains("wall-notice-action")
  ) {
    return previous;
  }
  const mic = document.getElementById("mic");
  return mic instanceof HTMLElement ? mic : null;
}

function restoreFocus(previous: HTMLElement | null): void {
  focusReturnTarget(previous)?.focus();
}

function embeddedShell(): boolean {
  return !probeWebGL();
}

function waitMs(): number {
  return embeddedShell() ? 4000 : 120_000;
}

export function resetMediaAsk(): void {
  for (const w of queue) w.resolve(null);
  queue = [];
  flushScheduled = false;
  if (open) {
    const host = open;
    open = null;
    host.settled = true;
    for (const w of host.waiters) w.resolve(null);
    if (host.modal.open) host.modal.close("abort");
    detachMediaAsk(host);
  }
  granted.mic = false;
  granted.cam = false;
  dismissed.mic = false;
  dismissed.cam = false;
  try {
    localStorage.removeItem(ACCEPT_KEY);
    sessionStorage.removeItem(DISMISS_KEY);
  } catch { /* ignore */ }
}

/** Settings / header toggles call this so Not now can be asked again. */
export function clearMediaDismiss(kind?: MediaAskKind): void {
  if (!kind || kind === "mic") dismissed.mic = false;
  if (!kind || kind === "cam") dismissed.cam = false;
  persistDismissed();
}

export function mediaAskGranted(kind: MediaAskKind): boolean {
  return accepted(kind);
}

export function mediaKindAllowed(kind: MediaAskKind): boolean {
  return kind === "mic" ? micCaptureAllowed() : currentCamPolicy() !== "off";
}

function waiterAllowed(w: Pick<Waiter, "audio" | "video">): boolean {
  return kindsOf(w).every((k) => mediaKindAllowed(k));
}

/** Drop queued / in-page asks when the header mic or cam toggle goes Off. */
export function dropMediaAsk(kind?: MediaAskKind): void {
  const drop = (w: Waiter) => !kind || kindsOf(w).includes(kind);
  for (const w of queue) {
    if (drop(w)) w.resolve(null);
  }
  queue = queue.filter((w) => !drop(w));
  if (!open) return;
  const keep = open.waiters.filter((w) => !drop(w));
  const gone = open.waiters.filter(drop);
  for (const w of gone) w.resolve(null);
  if (!keep.length) {
    const host = open;
    open = null;
    host.settled = true;
    if (host.modal.open) host.modal.close("abort");
    detachMediaAsk(host);
    return;
  }
  open.waiters = keep;
  open.audio = keep.some((w) => w.audio);
  open.video = keep.some((w) => w.video);
  paintCopy(open);
}

function kindsOf(w: Pick<Waiter, "audio" | "video">): MediaAskKind[] {
  const out: MediaAskKind[] = [];
  if (w.audio) out.push("mic");
  if (w.video) out.push("cam");
  return out;
}

function captureOne(constraints: MediaStreamConstraints): Promise<MediaStream | null> {
  let settled: "stream" | "fail" | null = null;
  const gum = navigator.mediaDevices.getUserMedia(constraints);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = "fail";
      resolve(null);
    }, waitMs());
    gum.then((stream) => {
      if (settled === "fail") {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      settled = "stream";
      window.clearTimeout(timer);
      resolve(stream);
    }, () => {
      window.clearTimeout(timer);
      if (settled) return;
      settled = "fail";
      resolve(null);
    });
  });
}

function detachMediaAsk(host: MediaAskHost): void {
  document.body.classList.remove("modal-open");
  host.modal.remove();
  restoreFocus(host.previousFocus);
}

function recordDismiss(host: Pick<MediaAskHost, "audio" | "video">, kind: "dismiss" | "blocked" | "stuck"): void {
  if (host.audio) {
    if (kind === "dismiss") dismissed.mic = true;
    granted.mic = false;
  }
  if (host.video) {
    if (kind === "dismiss") dismissed.cam = true;
    granted.cam = false;
  }
  if (kind === "dismiss") persistDismissed();
}

async function runAllowCapture(host: MediaAskHost): Promise<void> {
  const streams: Array<MediaStream | null> = [];
  let stuck = false;
  for (const w of host.waiters) {
    const stream = await captureOne({ audio: w.audio, video: w.video });
    if (!stream) {
      stuck = true;
      streams.push(null);
      continue;
    }
    if (!waiterAllowed(w)) {
      for (const t of stream.getTracks()) t.stop();
      streams.push(null);
      continue;
    }
    if (w.audio) writeAccept("mic");
    if (w.video) writeAccept("cam");
    streams.push(stream);
  }
  if (stuck && streams.every((s) => !s)) {
    recordDismiss(host, "stuck");
    host.waiters.forEach((w) => w.resolve(null));
    return;
  }
  host.waiters.forEach((w, i) => w.resolve(streams[i] ?? null));
}

function finalizeMediaAskClose(host: MediaAskHost): void {
  if (host.settled) return;
  host.settled = true;
  const rv = host.modal.returnValue;
  detachMediaAsk(host);
  if (open === host) open = null;

  if (rv === "allow") {
    void runAllowCapture(host);
    return;
  }
  if (rv === "abort") return;

  const kind = rv === "stuck" ? "stuck" : rv === "blocked" ? "blocked" : "dismiss";
  recordDismiss(host, kind);
  host.waiters.forEach((w) => w.resolve(null));
}

function watchDialogClosedWithoutCloseEvent(host: MediaAskHost): void {
  host.modal.addEventListener("beforetoggle", (e: Event) => {
    const toggle = e as ToggleEvent;
    if (toggle.newState !== "closed" || host.settled) return;
    queueMicrotask(() => {
      if (host.settled || host.modal.open) return;
      finalizeMediaAskClose(host);
    });
  });
}

function paintCopy(host: NonNullable<typeof open>, extra?: string): void {
  const wants = [
    host.audio ? "the microphone (watchword listening and the pulse)" : "",
    host.video ? "the camera (live sky, gaze, live colour)" : "",
  ].filter(Boolean);
  host.title.textContent = host.audio && host.video
    ? "Allow microphone and camera"
    : host.video ? "Allow the camera" : "Allow the microphone";
  host.body.replaceChildren();
  const p1 = document.createElement("p");
  p1.textContent = `This window needs ${wants.join(" and ")}. The OS microphone light stays off until you accept.`;
  const p2 = document.createElement("p");
  p2.className = "muted";
  p2.textContent = embeddedShell()
    ? "This embedded browser cannot show the usual listening / camera prompt. Allow here is the accept. If nothing happens, open the monitor in Chromium on localhost."
    : "Allow opens the browser permission dialog when this window has one. If that dialog never appears, open the monitor in Chromium on localhost.";
  host.body.append(p1, p2);
  if (extra) {
    const p3 = document.createElement("p");
    p3.className = "muted";
    p3.textContent = extra;
    host.body.append(p3);
  }
}

function mergeOpen(waiters: Waiter[]): void {
  if (!open) return;
  for (const w of waiters) {
    if (!waiterAllowed(w)) {
      w.resolve(null);
      continue;
    }
    open.waiters.push(w);
    if (w.audio) open.audio = true;
    if (w.video) open.video = true;
  }
  paintCopy(open);
}

function openMediaAsk(waiters: Waiter[]): void {
  const previousFocus = capturePreviousFocus();
  const modal = document.createElement("dialog");
  modal.className = "modal ask";
  modal.setAttribute("data-media-ask", "1");
  modal.setAttribute("aria-labelledby", MEDIA_ASK_TITLE_ID);
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const head = document.createElement("div");
  head.className = "mhead";
  const title = document.createElement("strong");
  title.id = MEDIA_ASK_TITLE_ID;
  head.appendChild(title);
  const body = document.createElement("div");
  body.className = "ask-body";
  const row = document.createElement("div");
  row.className = "ask-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn";
  cancel.textContent = "Not now";
  const allow = document.createElement("button");
  allow.type = "button";
  allow.className = "btn primary";
  allow.textContent = "Allow";
  row.append(cancel, allow);
  sheet.append(head, body, row);
  modal.append(sheet);

  const host: MediaAskHost = {
    waiters,
    audio: waiters.some((w) => w.audio),
    video: waiters.some((w) => w.video),
    modal,
    previousFocus,
    title,
    body,
    allow,
    cancel,
    settled: false,
  };
  open = host;
  paintCopy(host);

  modal.addEventListener("close", () => finalizeMediaAskClose(host));
  watchDialogClosedWithoutCloseEvent(host);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.close("not-now");
  });
  cancel.addEventListener("click", () => modal.close("not-now"));

  allow.addEventListener("click", () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      modal.close("blocked");
      return;
    }
    modal.close("allow");
  });

  document.body.classList.add("modal-open");
  document.body.appendChild(modal);
  modal.showModal();
  allow.focus();
}

async function flush(): Promise<void> {
  const batch = queue;
  queue = [];
  if (!batch.length) return;

  if (open) {
    mergeOpen(batch);
    return;
  }

  const needAsk: Waiter[] = [];
  for (const w of batch) {
    const kinds = kindsOf(w);
    if (kinds.some((k) => dismissed[k]) || !waiterAllowed(w)) {
      w.resolve(null);
      continue;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      w.resolve(null);
      continue;
    }
    // Permissions API "granted" is not an accept — Cursor Simple Browser
    // and other embeds auto-grant at the OS (indicator on) with no dialog.
    if (kinds.every((k) => accepted(k))) {
      const stream = await captureOne({ audio: w.audio, video: w.video });
      if (stream && !waiterAllowed(w)) {
        for (const t of stream.getTracks()) t.stop();
        w.resolve(null);
        continue;
      }
      w.resolve(stream);
      continue;
    }
    needAsk.push(w);
  }
  if (needAsk.length) openMediaAsk(needAsk);
}

/** Open the device after an in-page accept (or immediately when already granted). */
export function askUserMedia(constraints: MediaStreamConstraints, reason: string): Promise<MediaStream | null> {
  const audio = !!constraints.audio;
  const video = constraints.video ?? false;
  if (!audio && !video) return Promise.resolve(null);
  if ((audio && !mediaKindAllowed("mic")) || (video && !mediaKindAllowed("cam"))) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    queue.push({ audio, video, reason, resolve });
    if (open) {
      mergeOpen(queue.splice(0, queue.length));
      return;
    }
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      void flush();
    });
  });
}
