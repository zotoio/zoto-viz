/**
 * /ws state stream with recovery:
 *  - opts into the delta protocol (`/ws?proto=delta`); falls back to full frames transparently
 *    (old backends just keep sending `state`),
 *  - reconnects with exponential backoff + jitter instead of a fixed 2 s loop,
 *  - treats a socket that has been silent for `staleMs` (frames arrive every ~1 s) as dead,
 *  - asks the server to pause while the tab is hidden and resyncs (full frame) on return,
 *  - requests a resync when a delta does not line up with the last applied sequence.
 */
import { applyPatch, type Patch } from "./state-delta";

/** The bit of `document` the stream needs (tests pass a tiny fake). */
export type VisDoc = {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", fn: () => void): void;
  removeEventListener(type: "visibilitychange", fn: () => void): void;
};

export type StreamConfig = {
  staleMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** 0..1: share of each backoff that is randomised */
  jitter: number;
  pauseWhenHidden: boolean;
};

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  staleMs: 5_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 30_000,
  jitter: 0.3,
  pauseWhenHidden: true,
};

type WsLike = {
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  send(data: string): void;
  close(): void;
};

export type StreamDeps = {
  url: string;
  makeSocket?: (url: string) => WsLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  now?: () => number;
  random?: () => number;
  doc?: VisDoc;
};

export type StreamHandlers = {
  onState: (msg: Record<string, unknown>) => void;
  /** `reconnect` is false for the first open of this stream. */
  onOpen?: (reconnect: boolean) => void;
  onClose?: () => void;
  onLog?: (text: string) => void;
};

/** Before a socket's first frame the stale limit is this many times `staleMs` (page load can stall). */
export const FIRST_FRAME_STALE_FACTOR = 4;
/** A stale timer this late (ms) is a main-thread stall, not a dead socket. */
export const STALL_TOLERANCE_MS = 1000;

export function backoffDelay(attempt: number, cfg: StreamConfig, random: () => number): number {
  const exp = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * 2 ** Math.max(0, attempt));
  const j = exp * cfg.jitter;
  return Math.max(0, Math.round(exp - j + random() * 2 * j));
}

export class StateStream {
  private ws: WsLike | null = null;
  private state: Record<string, unknown> | null = null;
  private seq = -1;
  private attempt = 0;
  private lastMsgAt = 0;
  private staleTimer: unknown = null;
  private retryTimer: unknown = null;
  private stopped = false;
  private paused = false;
  /** True once the current socket delivered a frame; the stale check only runs after that. */
  private gotFrame = false;
  /** Opens so far (0 before the first); handlers see whether an open is a reconnect. */
  private opens = 0;
  readonly cfg: StreamConfig;
  private readonly d: Required<Omit<StreamDeps, "doc">> & { doc: StreamDeps["doc"] };

  constructor(deps: StreamDeps, private readonly h: StreamHandlers, cfg: Partial<StreamConfig> = {}) {
    this.cfg = { ...DEFAULT_STREAM_CONFIG, ...cfg };
    this.d = {
      url: deps.url,
      makeSocket: deps.makeSocket ?? ((u) => new WebSocket(u) as unknown as WsLike),
      setTimeout: deps.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms)),
      clearTimeout: deps.clearTimeout ?? ((id) => window.clearTimeout(id as number)),
      now: deps.now ?? (() => Date.now()),
      random: deps.random ?? Math.random,
      doc: deps.doc ?? (typeof document !== "undefined" ? document : undefined),
    };
    this.d.doc?.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Reconnect attempts since the last successful frame. */
  get attempts(): number { return this.attempt; }
  get lastSeq(): number { return this.seq; }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.d.doc?.removeEventListener("visibilitychange", this.onVisibility);
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; ws.close(); }
  }

  private clearTimers(): void {
    if (this.staleTimer !== null) this.d.clearTimeout(this.staleTimer);
    if (this.retryTimer !== null) this.d.clearTimeout(this.retryTimer);
    this.staleTimer = this.retryTimer = null;
  }

  private open(): void {
    if (this.stopped) return;
    const ws = this.d.makeSocket(this.d.url);
    this.ws = ws;
    this.seq = -1;
    this.gotFrame = false;
    // a replacement socket starts unpaused on the server; mirror that here (Codex P2)
    this.paused = false;
    ws.onopen = () => {
      this.lastMsgAt = this.d.now();
      // Page load can block the main thread for many seconds, so the normal stale check waits
      // for this socket's first frame. Until then only a generous first-frame deadline applies.
      this.armStale(this.cfg.staleMs * FIRST_FRAME_STALE_FACTOR);
      if (this.hidden()) this.sendCmd("pause");
      this.h.onOpen?.(this.opens++ > 0);
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.staleTimer !== null) { this.d.clearTimeout(this.staleTimer); this.staleTimer = null; }
      this.h.onClose?.();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const ms = backoffDelay(this.attempt, this.cfg, this.d.random);
    this.attempt++;
    this.h.onLog?.(`ws: reconnect in ${ms} ms (attempt ${this.attempt})`);
    this.retryTimer = this.d.setTimeout(() => { this.retryTimer = null; this.open(); }, ms);
  }

  private hidden(): boolean {
    return this.cfg.pauseWhenHidden && this.d.doc?.visibilityState === "hidden";
  }

  private sendCmd(type: "pause" | "resume" | "resync"): void {
    try { this.ws?.send(JSON.stringify({ type })); } catch { /* closing */ }
    if (type === "pause") this.paused = true;
    if (type === "resume" || type === "resync") this.paused = false;
  }

  private readonly onVisibility = (): void => {
    if (!this.cfg.pauseWhenHidden || !this.ws) return;
    if (this.d.doc?.visibilityState === "hidden") this.sendCmd("pause");
    else {
      this.sendCmd("resync");
      this.lastMsgAt = this.d.now();
      this.armStale();
    }
  };

  private armStale(ms = this.cfg.staleMs): void {
    if (this.staleTimer !== null) this.d.clearTimeout(this.staleTimer);
    const armedAt = this.d.now();
    this.staleTimer = this.d.setTimeout(() => {
      this.staleTimer = null;
      if (!this.ws) return;
      if (this.paused) { this.armStale(ms); return; }
      // A timer that fires well past its deadline means the page's main thread stalled (boot,
      // a heavy view switch), not the socket: frames are queued behind the stall. Look again.
      if (this.d.now() - armedAt - ms > STALL_TOLERANCE_MS) {
        this.lastMsgAt = Math.max(this.lastMsgAt, this.d.now() - ms / 2);
        this.armStale(ms);
        return;
      }
      const limit = this.gotFrame ? this.cfg.staleMs : this.cfg.staleMs * FIRST_FRAME_STALE_FACTOR;
      const idle = this.d.now() - this.lastMsgAt;
      if (idle >= limit) {
        this.h.onLog?.(`ws: no frame for ${idle} ms; reconnecting`);
        const ws = this.ws;
        ws.close();
        // some engines delay onclose on a dead socket; do not wait for it
        if (this.ws === ws) ws.onclose?.();
        return;
      }
      this.armStale(this.gotFrame ? this.cfg.staleMs : ms);
    }, ms);
  }

  private onMessage(data: string): void {
    this.lastMsgAt = this.d.now();
    if (!this.gotFrame) {
      this.gotFrame = true;
      this.armStale();
    }
    let m: Record<string, unknown>;
    try { m = JSON.parse(data) as Record<string, unknown>; } catch { return; }
    if (m.type === "state") {
      const { type: _t, seq, ...rest } = m;
      this.state = rest;
      this.seq = typeof seq === "number" ? seq : -1;
      this.attempt = 0;
      this.h.onState({ type: "state", ...rest });
      return;
    }
    if (m.type === "delta") {
      if (!this.state || typeof m.base !== "number" || m.base !== this.seq) {
        this.sendCmd("resync");
        return;
      }
      this.state = applyPatch(this.state, (m.patch ?? null) as Patch) as Record<string, unknown>;
      this.seq = m.seq as number;
      this.attempt = 0;
      if (m.patch !== null) this.h.onState({ ...this.state, type: "state" });
    }
  }
}
