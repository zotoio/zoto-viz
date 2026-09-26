/**
 * In-page microphone / camera accept. Cursor Simple Browser and other
 * embedded Chromium shells have no permission chrome — getUserMedia then
 * hangs or auto-grants at the OS (indicator on) with nothing to click.
 * Allow is the user gesture that opens the device; Not now leaves it closed.
 */

import { probeWebGL } from "../graph/webgl";
import { micCaptureAllowed } from "../audio/want";
import { currentCamPolicy } from "../camera/want";
import { isPackConsentPending } from "../app/pack-consent";

export type MediaAskKind = "mic" | "cam";

type Waiter = {
  audio: boolean;
  video: boolean | MediaTrackConstraints;
  reason: string;
  resolve: (stream: MediaStream | null) => void;
};

const ACCEPT_KEY = "zoto-viz.mediaAccept";

const granted: Record<MediaAskKind, boolean> = { mic: false, cam: false };
const dismissed: Record<MediaAskKind, boolean> = { mic: false, cam: false };

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
const gatedWhilePackConsent = new Set<Waiter>();
let flushScheduled = false;
let open: {
  waiters: Waiter[];
  audio: boolean;
  video: boolean;
  modal: HTMLDivElement;
  title: HTMLElement;
  body: HTMLDivElement;
  allow: HTMLButtonElement;
  cancel: HTMLButtonElement;
  onKey: (e: KeyboardEvent) => void;
} | null = null;

function embeddedShell(): boolean {
  return !probeWebGL();
}

function waitMs(): number {
  return embeddedShell() ? 4000 : 120_000;
}

export function resetMediaAsk(): void {
  for (const w of queue) w.resolve(null);
  queue = [];
  gatedWhilePackConsent.clear();
  flushScheduled = false;
  if (open) {
    for (const w of open.waiters) w.resolve(null);
    teardown(open.modal);
    open = null;
  }
  granted.mic = false;
  granted.cam = false;
  dismissed.mic = false;
  dismissed.cam = false;
  try { localStorage.removeItem(ACCEPT_KEY); } catch { /* ignore */ }
}

/** Settings / header toggles call this so Not now can be asked again. */
export function clearMediaDismiss(kind?: MediaAskKind): void {
  if (!kind || kind === "mic") dismissed.mic = false;
  if (!kind || kind === "cam") dismissed.cam = false;
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
/** Drop mic/cam asks queued while a pack consent dialog was open (decline / abort). */
export function dropMediaAskGatedByPackConsent(): void {
  for (const w of gatedWhilePackConsent) {
    w.resolve(null);
    queue = queue.filter((x) => x !== w);
  }
  gatedWhilePackConsent.clear();
}

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
    document.removeEventListener("keydown", host.onKey, true);
    teardown(host.modal);
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

function teardown(modal: HTMLDivElement): void {
  document.body.classList.remove("modal-open");
  modal.remove();
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

function showModal(waiters: Waiter[]): void {
  const modal = document.createElement("div");
  modal.className = "modal ask";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("data-media-ask", "1");
  const back = document.createElement("div");
  back.className = "backdrop";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const head = document.createElement("div");
  head.className = "mhead";
  const title = document.createElement("strong");
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
  modal.append(back, sheet);

  const host = {
    waiters,
    audio: waiters.some((w) => w.audio),
    video: waiters.some((w) => w.video),
    modal,
    title,
    body,
    allow,
    cancel,
    onKey: (_e: KeyboardEvent) => { /* set below */ },
  };
  open = host;
  paintCopy(host);

  const finish = (streams: Array<MediaStream | null>): void => {
    if (open !== host) return;
    open = null;
    document.removeEventListener("keydown", host.onKey, true);
    teardown(modal);
    host.waiters.forEach((w, i) => w.resolve(streams[i] ?? null));
  };

  const deny = (kind: "dismiss" | "blocked" | "stuck"): void => {
    if (host.audio) {
      if (kind === "dismiss") dismissed.mic = true;
      granted.mic = false;
    }
    if (host.video) {
      if (kind === "dismiss") dismissed.cam = true;
      granted.cam = false;
    }
    finish(host.waiters.map(() => null));
  };

  host.onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); deny("dismiss"); }
  };
  cancel.addEventListener("click", () => deny("dismiss"));
  back.addEventListener("click", () => deny("dismiss"));
  document.addEventListener("keydown", host.onKey, true);

  allow.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      paintCopy(host, "This window has no media capture.");
      allow.remove();
      cancel.textContent = "OK";
      deny("blocked");
      return;
    }
    allow.disabled = true;
    cancel.disabled = true;
    paintCopy(host, "Waiting for this window to grant the device…");
    const streams: Array<MediaStream | null> = [];
    let stuck = false;
    for (const w of host.waiters) {
      const constraints: MediaStreamConstraints = {
        audio: w.audio,
        video: w.video,
      };
      const stream = await captureOne(constraints);
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
      allow.remove();
      cancel.disabled = false;
      cancel.textContent = "OK";
      paintCopy(host, "The browser never presented a listening or camera prompt. The OS light can still be on if Cursor or another app already holds the microphone. Open this monitor in Chromium on localhost, then accept there.");
      const ok = () => deny("stuck");
      cancel.onclick = ok;
      back.onclick = ok;
      return;
    }
    finish(streams);
  });

  document.body.classList.add("modal-open");
  document.body.appendChild(modal);
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
  if (needAsk.length) {
    if (isPackConsentPending()) {
      for (const w of needAsk) gatedWhilePackConsent.add(w);
      queue.push(...needAsk);
      return;
    }
    showModal(needAsk);
  }
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
    const waiter: Waiter = { audio, video, reason, resolve };
    queue.push(waiter);
    if (isPackConsentPending()) gatedWhilePackConsent.add(waiter);
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
