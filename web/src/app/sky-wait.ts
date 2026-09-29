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

  constructor(private readonly host: SkyWaitHost, private readonly deadlineMs = SKY_WAIT_DEADLINE_MS) {}

  state(key: string): SkyWaitState | null {
    return this.waits.get(key)?.state ?? null;
  }

  /** Heal ladder and blank notice skip the tile while it is starting or timed out. */
  exempt(key: string): boolean {
    return this.waits.has(key);
  }

  /** Idempotent while starting; from failed:timeout (Retry) it clears the notice and restarts the countdown. */
  begin(key: string): void {
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
    const cur = this.waits.get(key);
    if (cur?.timer) clearTimeout(cur.timer);
    this.waits.delete(key);
  }
}
