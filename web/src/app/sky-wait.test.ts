import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKY_WAIT_DEADLINE_MS, SkyWaits } from "./sky-wait";
import { resetViewStatesForTests, viewStateOf } from "./view-state";

function setup() {
  const pane = document.createElement("div");
  let ready = false;
  let clock = 0;
  let blocked = 0;
  const retries: string[] = [];
  const waits = new SkyWaits({
    hostEl: () => pane,
    name: () => "Backrooms",
    skyReady: () => ready,
    retry: (k) => { retries.push(k); waits.begin(k); },
    now: () => Date.now() + blocked + clock,
  });
  return {
    pane, waits, retries,
    setReady: (v: boolean) => { ready = v; },
    /** The main thread is stuck for ms: timers queued behind it fire that much late. */
    block: (ms: number) => { blocked += ms; },
  };
}

describe("SkyWaits: Starting card with a deadline", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "info").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); resetViewStatesForTests(); });

  it("shows the card and stays exempt until the deadline, then lands with a fade", () => {
    const { pane, waits, setReady } = setup();
    waits.begin("plugin:backrooms");
    expect(pane.querySelector(".sky-starting-card")?.textContent).toBe("Backrooms · Starting…");
    expect(viewStateOf("plugin:backrooms")).toEqual({ kind: "starting" });
    expect(pane.dataset.viewState).toBe("starting");
    expect(pane.querySelector<HTMLElement>(".sky-starting-card")?.dataset.viewState).toBe("starting");
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS - 1);
    expect(waits.state("plugin:backrooms")).toBe("starting");
    expect(waits.exempt("plugin:backrooms")).toBe(true);
    setReady(true);
    waits.landed("plugin:backrooms");
    expect(waits.exempt("plugin:backrooms")).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(pane.querySelector(".sky-starting-card")).toBeNull();
    expect(pane.querySelector(".mosaic-pane-notice")).toBeNull();
    expect(pane.dataset.viewState).toBe("ready");
  });

  it("at the deadline with no sky: failed:timeout (Couldn't start) with Retry, still exempt, no card", () => {
    const { pane, waits } = setup();
    waits.begin("plugin:backrooms");
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    expect(waits.state("plugin:backrooms")).toBe("failed:timeout");
    expect(waits.exempt("plugin:backrooms")).toBe(true);
    expect(pane.querySelector(".sky-starting-card")).toBeNull();
    const notice = pane.querySelector<HTMLElement>(".mosaic-pane-notice")!;
    expect(notice.dataset.viewState).toBe("couldnt-start");
    expect(pane.dataset.viewState).toBe("couldnt-start");
    expect(viewStateOf("plugin:backrooms")).toEqual({ kind: "couldnt-start", reason: "timeout", packId: "plugin:backrooms" });
    expect(notice.textContent).toContain("Backrooms couldn't start.");
    expect(notice.querySelector(".mosaic-pane-notice-retry")?.textContent).toBe("Retry");
  });

  it("Retry reloads only that tile and restarts the countdown", () => {
    const { pane, waits, retries } = setup();
    waits.begin("plugin:backrooms");
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    pane.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry")!.click();
    expect(retries).toEqual(["plugin:backrooms"]);
    expect(waits.state("plugin:backrooms")).toBe("starting");
    expect(pane.querySelector(".mosaic-pane-notice")).toBeNull();
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS - 1);
    expect(waits.state("plugin:backrooms")).toBe("starting");
    vi.advanceTimersByTime(1);
    expect(waits.state("plugin:backrooms")).toBe("failed:timeout");
  });

  it("a slow compile that finished before the timer ran is not failed", () => {
    const { waits, setReady } = setup();
    waits.begin("plugin:backrooms");
    setReady(true); // compile blocked the page past the deadline, then the sky landed
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    expect(waits.state("plugin:backrooms")).toBeNull();
  });

  it("cancel removes the card at once and ends the exemption", () => {
    const { pane, waits } = setup();
    waits.begin("plugin:backrooms");
    waits.cancel("plugin:backrooms");
    expect(pane.querySelector(".sky-starting-card")).toBeNull();
    expect(waits.exempt("plugin:backrooms")).toBe(false);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    expect(pane.querySelector(".mosaic-pane-notice")).toBeNull();
  });

  it("QE row: a 60s blocking compile with the sky ready just after ends ready, 0 failed:timeout", () => {
    const { pane, waits, setReady, block } = setup();
    const states: (string | null)[] = [];
    waits.begin("plugin:backrooms");
    block(60_000); // compile holds the page; the 45s timer is queued behind it
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    states.push(waits.state("plugin:backrooms"));
    expect(pane.querySelector(".mosaic-pane-notice")).toBeNull();
    setReady(true); // ready callback lands a frame after the page unblocks
    waits.landed("plugin:backrooms");
    states.push(waits.state("plugin:backrooms"));
    expect(states).toEqual(["starting", null]);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS * 2);
    expect(pane.querySelector(".mosaic-pane-notice")).toBeNull();
  });

  it("QE row: a sky that never arrives reaches failed:timeout at 45s (no block, no restart)", () => {
    const { waits } = setup();
    waits.begin("plugin:backrooms");
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS - 1);
    expect(waits.state("plugin:backrooms")).toBe("starting");
    vi.advanceTimersByTime(1);
    expect(waits.state("plugin:backrooms")).toBe("failed:timeout");
  });
});
