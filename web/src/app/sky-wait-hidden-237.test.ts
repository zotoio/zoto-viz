/**
 * #237: a background tab pauses requestAnimationFrame, so no sky frame can draw, but the 45 s
 * sky-wait deadline kept counting and painted a false "<Pack> couldn't start." The deadline counts
 * visible time only: it pauses while `document.visibilityState` is "hidden" and resumes on
 * `visibilitychange`. A genuine failure while visible still times out with Retry at 45 s.
 *
 * Fake timers, a stubbed `document.visibilityState` / `document.hidden`, and the real
 * `visibilitychange` event on `document`. "A frame drew" goes through `landWhenDrawn`, as in the app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKY_WAIT_DEADLINE_MS, SkyWaits, landWhenDrawn, type SkyDrawnSource } from "./sky-wait";
import { resetViewStatesForTests, viewStateOf } from "./view-state";

const KEY = "plugin:backrooms";
const SKY = "backrooms";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(v: DocumentVisibilityState): void {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A tile scene whose sky draws a frame only when the row says so. */
function drawnSource() {
  const cbs = new Set<(id: string) => void>();
  const src: SkyDrawnSource & { draw: (id: string) => void } = {
    pluginSkyDrawn: null,
    onPluginSkyDrawn: (cb) => { cbs.add(cb); return () => { cbs.delete(cb); }; },
    draw: (id) => { src.pluginSkyDrawn = id; for (const cb of [...cbs]) cb(id); },
  };
  return src;
}

function setup() {
  const pane = document.createElement("div");
  document.body.appendChild(pane);
  const scene = drawnSource();
  const retries: string[] = [];
  const waits = new SkyWaits({
    hostEl: () => pane,
    name: () => "Backrooms",
    skyReady: () => scene.pluginSkyDrawn === SKY,
    retry: (k) => { retries.push(k); },
    now: () => Date.now(),
  });
  return { pane, scene, waits, retries };
}

const couldntStart = (pane: HTMLElement) => pane.querySelectorAll(".mosaic-pane-notice[data-view-state='couldnt-start']").length;

function expectNoCouldntStart(pane: HTMLElement, waits: SkyWaits): void {
  expect(couldntStart(pane)).toBe(0);
  expect(pane.textContent ?? "").not.toContain("couldn't start");
  expect(waits.state(KEY)).not.toBe("failed:timeout");
  expect(viewStateOf(KEY)?.kind).not.toBe("couldnt-start");
}

function expectCouldntStartWithRetry(pane: HTMLElement, waits: SkyWaits): void {
  expect(waits.state(KEY)).toBe("failed:timeout");
  expect(couldntStart(pane)).toBe(1);
  const notice = pane.querySelector<HTMLElement>(".mosaic-pane-notice[data-view-state='couldnt-start']")!;
  expect(notice.textContent).toContain("Backrooms couldn't start.");
  expect(notice.querySelector(".mosaic-pane-notice-retry")?.textContent).toBe("Retry");
}

describe("#237: the sky-wait deadline counts visible time only", () => {
  let panes: HTMLElement[] = [];
  let live: SkyWaits[] = [];

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility === "hidden" });
    resetViewStatesForTests();
  });

  afterEach(() => {
    for (const w of live) w.cancel(KEY);
    live = [];
    for (const p of panes) p.remove();
    panes = [];
    Reflect.deleteProperty(document, "visibilityState");
    Reflect.deleteProperty(document, "hidden");
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetViewStatesForTests();
  });

  function boot() {
    const s = setup();
    panes.push(s.pane);
    live.push(s.waits);
    return s;
  }

  it("(a) hidden from the start: no couldn't start past 45 s; shown, a frame draws, it lands", () => {
    const { pane, scene, waits } = boot();
    setVisibility("hidden");
    waits.begin(KEY);
    landWhenDrawn(waits, KEY, scene, SKY);
    expect(viewStateOf(KEY)).toEqual({ kind: "starting" });

    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS + 30_000);
    expectNoCouldntStart(pane, waits);
    expect(waits.state(KEY)).toBe("starting");

    setVisibility("visible");
    vi.advanceTimersByTime(500);
    scene.draw(SKY);
    expect(waits.state(KEY)).toBeNull();
    expect(viewStateOf(KEY)).toEqual({ kind: "ready" });
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS * 2);
    expectNoCouldntStart(pane, waits);
  });

  it("(b) visible 20 s, hidden 60 s, visible 20 s: no notice; 6 s more visible: couldn't start", () => {
    const { pane, waits } = boot();
    waits.begin(KEY);
    vi.advanceTimersByTime(20_000);
    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expectNoCouldntStart(pane, waits);
    setVisibility("visible");
    vi.advanceTimersByTime(20_000);
    expectNoCouldntStart(pane, waits);
    expect(waits.state(KEY)).toBe("starting");

    vi.advanceTimersByTime(6_000);
    expectCouldntStartWithRetry(pane, waits);
  });

  it("(c) control, always visible: couldn't start with Retry at 45 s", () => {
    const { pane, waits, retries } = boot();
    waits.begin(KEY);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS - 1);
    expectNoCouldntStart(pane, waits);
    vi.advanceTimersByTime(1);
    expectCouldntStartWithRetry(pane, waits);
    pane.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry")!.click();
    expect(retries).toEqual([KEY]);
  });
});
