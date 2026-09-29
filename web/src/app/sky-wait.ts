import { hideSkyStartingCard, showSkyStartingCard } from "../graph/sky-starting-card";
import { paintPackAssetPaneNotice } from "../plugins/pack-asset-pane-notice";
import { packSkyTimedOut } from "../plugins/plugin-copy";

/** How long a view may show "Starting…" before it becomes "couldn't start". */
export const SKY_WAIT_DEADLINE_MS = 45_000;

/** A deadline that fires this late means the page was blocked (e.g. a synchronous shader compile). */
export const SKY_WAIT_DRIFT_MS = 2_000;

export type SkyWaitState = "starting" | "failed:timeout";

export interface SkyWaitHost {
  /** Element that carries the tile's card and notice (mosaic pane, or the solo scene). */
  hostEl: (key: string) => HTMLElement | null;
  name: (key: string) => string;
  /** The tile's own sky is on screen. */
  skyReady: (key: string) => boolean;
  /** Reload only this tile's sky (Retry). */
  retry: (key: string) => void;
  now?: () => number;
}

/**
 * A tile whose view draws its own sky, from the moment it is shown without it. It is one of:
 * starting (name card, never healed, never judged blank) until the sky lands, or, after
 * SKY_WAIT_DEADLINE_MS, failed:timeout ("<View> couldn't start." with Retry, still never healed
 * to another view). It never gets a built-in stand-in sky or a fallback pack.
 */
export class SkyWaits {
  private readonly waits = new Map<
    string,
    { state: SkyWaitState; timer: ReturnType<typeof setTimeout> | null; due: number }
  >();

  /** Which load (its signal) owns each tile's wait: only the owner's abort may end it. */
  private readonly owners = new Map<string, AbortSignal>();

  constructor(private readonly host: SkyWaitHost, private readonly deadlineMs = SKY_WAIT_DEADLINE_MS) {}

  state(key: string): SkyWaitState | null {
    return this.waits.get(key)?.state ?? null;
  }

  /** Heal ladder and blank notice skip the tile while it is starting or timed out. */
  exempt(key: string): boolean {
    return this.waits.has(key);
  }

  /** Idempotent while starting; from failed:timeout (Retry) it clears the notice and restarts the countdown. */
  begin(key: string, owner?: AbortSignal): void {
    if (owner) this.owners.set(key, owner);
    const cur = this.waits.get(key);
    if (cur?.state === "starting") return;
    if (cur) this.clearFailed(key);
    const el = this.host.hostEl(key);
    showSkyStartingCard(el, this.host.name(key));
    this.arm(key);
  }

  private now(): number {
    return this.host.now?.() ?? performance.now();
  }

  private arm(key: string): void {
    const due = this.now() + this.deadlineMs;
    const timer = setTimeout(() => this.deadline(key), this.deadlineMs);
    this.waits.set(key, { state: "starting", timer, due });
  }

  /** The sky is on screen: the card fades out. */
  landed(key: string): void {
    const cur = this.waits.get(key);
    if (!cur) return;
    this.drop(key);
    if (cur.state === "failed:timeout") this.clearFailed(key);
    else hideSkyStartingCard(this.host.hostEl(key), true);
  }

  /** The newest sync for this tile takes the wait over (a no-op when the tile isn't waiting). */
  own(key: string, owner: AbortSignal): void {
    if (this.waits.has(key)) this.owners.set(key, owner);
  }

  /**
   * A load was aborted or failed: end the wait only if that load owns it. A superseded sync's
   * abort never removes the card or the deadline a newer sync armed.
   */
  cancelOwned(key: string, owner: AbortSignal): void {
    const cur = this.owners.get(key);
    if (cur && cur !== owner) return;
    this.cancel(key);
  }

  /** Not waiting any more for another reason (view switched away, consent wait, compile error). */
  cancel(key: string): void {
    const cur = this.waits.get(key);
    if (!cur) return;
    this.drop(key);
    hideSkyStartingCard(this.host.hostEl(key), false);
    if (cur.state === "failed:timeout") this.clearFailed(key);
  }

  keys(): string[] {
    return [...this.waits.keys()];
  }

  private deadline(key: string): void {
    const cur = this.waits.get(key);
    if (!cur || cur.state !== "starting") return;
    if (this.host.skyReady(key)) {
      this.landed(key);
      return;
    }
    // Fired late: the page was blocked, so the tile had no real chance to draw. Start again
    // rather than flash "couldn't start" on a sky whose ready signal is a frame away.
    if (this.now() - cur.due > SKY_WAIT_DRIFT_MS) {
      console.info(`[zoto-viz sky] tile=${key} step=deadline-restart reason=main-thread-blocked`);
      this.arm(key);
      return;
    }
    const el = this.host.hostEl(key);
    if (!el) {
      this.drop(key);
      return;
    }
    hideSkyStartingCard(el, false);
    this.waits.set(key, { state: "failed:timeout", timer: null, due: cur.due });
    console.info(`[zoto-viz sky] tile=${key} step=notice reason=sky-timeout`);
    paintPackAssetPaneNotice(el, packSkyTimedOut(this.host.name(key)), "fail", {
      showRetry: true,
      onRetry: () => this.host.retry(key),
    });
    const notice = el.querySelector<HTMLElement>(".mosaic-pane-notice");
    if (notice) notice.dataset.viewState = "failed:timeout";
  }

  private clearFailed(key: string): void {
    const el = this.host.hostEl(key);
    const notice = el?.querySelector<HTMLElement>(".mosaic-pane-notice");
    if (notice?.dataset.viewState === "failed:timeout") notice.remove();
  }

  private drop(key: string): void {
    this.owners.delete(key);
    const cur = this.waits.get(key);
    if (cur?.timer) clearTimeout(cur.timer);
    this.waits.delete(key);
  }
}

/** The part of a tile scene the wait needs: the sky it has actually drawn a frame with. */
export interface SkyDrawnSource {
  readonly pluginSkyDrawn: string | null;
  onPluginSkyDrawn(cb: (id: string) => void): () => void;
}

/** Land the tile's wait on the first frame drawn with `skyId`, not when the sky is handed over. */
export function landWhenDrawn(waits: SkyWaits, key: string, target: SkyDrawnSource, skyId: string): void {
  if (target.pluginSkyDrawn === skyId) {
    waits.landed(key);
    return;
  }
  const off = target.onPluginSkyDrawn((id) => {
    if (!waits.state(key)) return void off();
    if (id !== skyId) return;
    off();
    waits.landed(key);
  });
}

type SkyLoad = { packKey: string; signal: AbortSignal; p: Promise<void>; token: object };

/** What a shared load checks: still the tile's newest load, and the newest caller's signal. */
export interface SkyLoadCtl {
  current(): boolean;
  signal(): AbortSignal;
}

/**
 * One sky request per tile: concurrent syncs for the same sky (mode apply, pane mount, refresh)
 * share the in-flight load. The newest live caller owns it: a sync that joins takes over the
 * signal, so an older, superseded sync's abort can no longer cancel the load, the card or the
 * wait. `forget` (Retry) lets the next call start fresh, and the stale load sees `current()`
 * false and does not install.
 */
export class SkyLoads<T extends object> {
  private readonly loads = new WeakMap<T, SkyLoad>();

  share(target: T, packKey: string, signal: AbortSignal, start: (ctl: SkyLoadCtl) => Promise<void>): Promise<void> {
    const cur = this.loads.get(target);
    if (cur && cur.packKey === packKey && !signal.aborted) {
      cur.signal = signal;
      return cur.p;
    }
    const token = {};
    const entry: SkyLoad = { packKey, signal, p: Promise.resolve(), token };
    this.loads.set(target, entry);
    const ctl: SkyLoadCtl = {
      current: () => this.loads.get(target)?.token === token,
      signal: () => entry.signal,
    };
    entry.p = start(ctl);
    const clear = () => {
      if (this.loads.get(target)?.token === token) this.loads.delete(target);
    };
    entry.p.then(clear, clear);
    return entry.p;
  }

  forget(target: T): void {
    this.loads.delete(target);
  }
}
