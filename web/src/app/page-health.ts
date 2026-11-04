/**
 * Page-side crash/remediation hooks:
 *  - global `error` / `unhandledrejection` reporting into the monitor log (/api/page/error),
 *    deduplicated and rate-limited so a per-frame throw cannot flood the backend,
 *  - a heartbeat (/api/page/heartbeat) with fps, JS heap, live AudioContexts and uptime; the
 *    backend watchdog may answer `{"action": "reload"}` when thresholds are crossed,
 *  - a soft self-reload backstop after N hours, at a quiet moment (no input, nothing speaking).
 */
import { liveAudioContexts } from "../audio/audio-manager";
import { apiFetch } from "../core/http";
import { recoveryConfig, type RecoveryConfig } from "./recovery-config";

const PAGE_ID = (() => {
  try { return crypto.randomUUID().slice(0, 8); } catch { return Math.random().toString(36).slice(2, 10); }
})();
export function pageId(): string { return PAGE_ID; }

// ---------------------------------------------------------------- frame + health counters

let frames = 0;
let disabledViews = 0;
let contextLosses = 0;
let lowQuality = false;

/** Render host calls this once per animation frame (drawn or idle-skipped). */
export function notePageFrame(): void { frames++; }
export function noteViewDisabled(): void { disabledViews++; }
export function noteContextLoss(): void { contextLosses++; }
export function noteLowQuality(on: boolean): void { lowQuality = on; }

// ---------------------------------------------------------------- error reporting

type Post = (path: string, body: unknown) => Promise<unknown>;

const defaultPost: Post = (path, body) => apiFetch(path, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  keepalive: true,
}).catch(() => undefined);

export class ErrorReporter {
  private pending = new Map<string, { kind: string; message: string; source: string; count: number }>();
  private seen = new Map<string, number>();
  private timer: unknown = null;
  sentTotal = 0;

  constructor(
    private readonly post: Post = defaultPost,
    private readonly flushMs = 2_000,
    private readonly perKeyCooldownMs = 60_000,
    private readonly now: () => number = () => Date.now(),
    private readonly schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  ) {}

  report(kind: string, message: string, source = ""): void {
    const key = `${kind}|${message}|${source}`.slice(0, 600);
    const p = this.pending.get(key);
    if (p) { p.count++; return; }
    const last = this.seen.get(key);
    if (last !== undefined && this.now() - last < this.perKeyCooldownMs) return;
    this.pending.set(key, { kind, message: message.slice(0, 1200), source: source.slice(0, 200), count: 1 });
    if (this.timer === null) this.timer = this.schedule(() => this.flush(), this.flushMs);
  }

  flush(): void {
    this.timer = null;
    for (const [key, row] of this.pending) {
      this.seen.set(key, this.now());
      this.sentTotal++;
      void this.post("/api/page/error", { page: PAGE_ID, ...row });
    }
    this.pending.clear();
    if (this.seen.size > 500) this.seen.clear();
  }
}

function describe(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack.split("\n").slice(1, 4).join("\n")}` : ""}`;
  try { return typeof reason === "string" ? reason : JSON.stringify(reason); } catch { return String(reason); }
}

let reporter: ErrorReporter | null = null;
export function errorReporter(): ErrorReporter {
  reporter ??= new ErrorReporter();
  return reporter;
}

/** Report a caught error (render loop, view disable, ...) through the same channel. */
export function reportPageError(kind: string, err: unknown, source = ""): void {
  errorReporter().report(kind, describe(err), source);
}

export function installGlobalErrorReporting(target: EventTarget = window, rep: Pick<ErrorReporter, "report"> = errorReporter()): void {
  target.addEventListener("error", (ev: Event) => {
    const e = ev as ErrorEvent;
    // ResizeObserver loop noise is swallowed by core/resize.ts in the capture phase
    const where = e.filename ? `${e.filename.replace(/^.*\/src\//, "src/")}:${e.lineno}:${e.colno}` : "";
    rep.report("error", e.error ? describe(e.error) : String(e.message || "error"), where);
  });
  target.addEventListener("unhandledrejection", (ev: Event) => {
    rep.report("unhandledrejection", describe((ev as PromiseRejectionEvent).reason));
  });
}

// ---------------------------------------------------------------- heartbeat + watchdog

export type HeartbeatBody = {
  page: string; fps: number; heapMb: number | null; audioContexts: number; uptimeS: number;
  visible: boolean; disabledViews: number; contextLosses: number; lowQuality: boolean; errors: number;
};

export function heartbeatBody(fps: number, uptimeS: number, doc: Pick<Document, "visibilityState"> = document): HeartbeatBody {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    page: PAGE_ID,
    fps: Math.round(fps * 10) / 10,
    heapMb: mem ? Math.round(mem.usedJSHeapSize / 1e5) / 10 : null,
    audioContexts: liveAudioContexts(),
    uptimeS: Math.round(uptimeS),
    visible: doc.visibilityState === "visible",
    disabledViews,
    contextLosses,
    lowQuality,
    errors: reporter?.sentTotal ?? 0,
  };
}

const RELOAD_GUARD_KEY = "zoto-viz.watchdog-reload-at";
/** Never reload more often than this (a reload loop is worse than a slow wall). */
export const MIN_RELOAD_GAP_MS = 10 * 60_000;

export function guardedReload(reason: string, now = Date.now(), store: Pick<Storage, "getItem" | "setItem"> | null = safeSession(), reload: () => void = () => location.reload()): boolean {
  const last = Number(store?.getItem(RELOAD_GUARD_KEY) || 0);
  if (last && now - last < MIN_RELOAD_GAP_MS) return false;
  store?.setItem(RELOAD_GUARD_KEY, String(now));
  console.warn(`zoto-viz watchdog: reloading (${reason})`);
  reload();
  return true;
}

function safeSession(): Storage | null {
  try { return sessionStorage; } catch { return null; }
}

/** True when a soft reload is due: uptime past the limit and no input for the quiet window. */
export function softReloadDue(cfg: Pick<RecoveryConfig, "softReloadAfterH" | "softReloadQuietMs">, uptimeMs: number, sinceInputMs: number, busy: boolean): boolean {
  if (!cfg.softReloadAfterH) return false;
  return uptimeMs >= cfg.softReloadAfterH * 3_600_000 && sinceInputMs >= cfg.softReloadQuietMs && !busy;
}

export function startPageHealth(isBusy: () => boolean = () => false): void {
  const cfg = recoveryConfig();
  const t0 = performance.now();
  let lastInput = performance.now();
  const mark = () => { lastInput = performance.now(); };
  for (const ev of ["pointerdown", "keydown", "wheel"]) window.addEventListener(ev, mark, { passive: true, capture: true });
  let lastFrames = frames;
  let lastAt = performance.now();
  const tick = async () => {
    const now = performance.now();
    const fps = ((frames - lastFrames) * 1000) / Math.max(1, now - lastAt);
    lastFrames = frames;
    lastAt = now;
    if (softReloadDue(cfg, now - t0, now - lastInput, isBusy())) {
      guardedReload(`soft reload after ${cfg.softReloadAfterH} h`);
      return;
    }
    try {
      const r = await apiFetch("/api/page/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(heartbeatBody(fps, (now - t0) / 1000)),
      });
      const j = (await r.json().catch(() => ({}))) as { action?: string; reason?: string };
      if (j.action === "reload") guardedReload(`watchdog: ${j.reason ?? "unhealthy"}`);
    } catch { /* backend down: the ws stream handles reconnect */ }
  };
  window.setInterval(() => { void tick(); }, cfg.heartbeatMs);
}
