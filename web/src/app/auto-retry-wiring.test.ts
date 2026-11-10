/**
 * Every "couldn't start" with Retry retries on its own (auto-retry.ts), through the same action its
 * Retry button runs: sky-wait's failed:timeout (host.retry), a pane sandbox's load-failed
 * (TileSandboxes.restart) and apply-mode's load-failed / grant-failed (host.retryDeclinedMode).
 * The notice stays up (or the tile shows Starting) until the retry works or fails again, one try is
 * in flight per tile, a start that works or a manual Retry resets the backoff, and switching the
 * view or removing the pane stops it. Missing, Needs you and can't draw are never retried.
 *
 * Fake timers; Math.random is pinned at 0.5 so the steps are exactly 3 s, 10 s, 30 s, 60 s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockPartial } from "../../test-support/mock-partial";
import type { ViewMode } from "../core/modes";
import type { Mosaic } from "../graph/mosaic";
import type { PluginView } from "../plugins/plugin";
import type { Select } from "../ui/ui";
import { showPickCouldntStart, type ApplyModeHost } from "./apply-mode";
import { SKY_WAIT_DEADLINE_MS, SkyWaits } from "./sky-wait";
import { TileSandboxes, type TileSandboxLike } from "./tile-sandboxes";
import {
  autoRetryPending,
  enterCantDrawShader,
  resetViewStatesForTests,
  setViewState,
  setViewStateTileResolver,
  showViewState,
  viewStateOf,
} from "./view-state";

const PACK = "ant-colony";
const NAME = "Ant Colony";
const VIEW = `plugin:${PACK}`;

function paneEl(id: string): HTMLElement {
  const pane = document.createElement("div");
  pane.className = "mosaic-pane";
  pane.dataset.mode = id;
  document.body.appendChild(pane);
  return pane;
}

const notices = (pane: HTMLElement) => pane.querySelectorAll(".mosaic-pane-notice");
const retryButton = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry");

beforeEach(() => {
  expect.hasAssertions();
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetViewStatesForTests();
});

afterEach(() => {
  resetViewStatesForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("sky-wait failed:timeout retries its sky on its own", () => {
  function rig() {
    const pane = paneEl(VIEW);
    setViewStateTileResolver((id) => (id === VIEW ? pane : null));
    const sky = { drawn: false };
    const retries: string[] = [];
    const waits: SkyWaits = new SkyWaits({
      hostEl: () => pane,
      name: () => NAME,
      viewId: () => VIEW,
      packId: () => PACK,
      skyReady: () => sky.drawn,
      // main.ts: reload only this tile's sky, then begin its wait again.
      retry: (k) => { retries.push(k); waits.begin(k); },
      now: () => Date.now(),
    });
    return { pane, sky, retries, waits };
  }

  it("times out, retries at 3 s, times out again, retries 10 s later, then lands and stops", () => {
    const { pane, sky, retries, waits } = rig();
    waits.begin(VIEW);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    expect(viewStateOf(VIEW)).toMatchObject({ kind: "couldnt-start", reason: "timeout" });
    expect(notices(pane)).toHaveLength(1);
    expect(retryButton(pane)?.textContent).toBe("Retry");

    vi.advanceTimersByTime(2_999);
    expect(retries).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(retries).toEqual([VIEW]);
    // Quietly Starting: the couldn't-start notice gave way to the card, never two messages.
    expect(viewStateOf(VIEW)).toEqual({ kind: "starting" });
    expect(notices(pane)).toHaveLength(0);

    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    expect(viewStateOf(VIEW)).toMatchObject({ kind: "couldnt-start", reason: "timeout" });
    vi.advanceTimersByTime(9_999);
    expect(retries).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(retries).toHaveLength(2);

    sky.drawn = true;
    waits.landed(VIEW);
    expect(viewStateOf(VIEW)).toEqual({ kind: "ready" });
    expect(autoRetryPending(VIEW)).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(retries).toHaveLength(2);
    waits.dispose();
  });

  it("a manual Retry resets the backoff: the next failure retries at 3 s again", () => {
    const { pane, retries, waits } = rig();
    waits.begin(VIEW);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS + 3_000);
    expect(retries).toHaveLength(1);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    retryButton(pane)!.click();
    expect(retries).toHaveLength(2);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS + 3_000);
    expect(retries).toHaveLength(3);
    waits.dispose();
  });

  it("switching the view away (cancel) stops the waiting retry", () => {
    const { retries, waits } = rig();
    waits.begin(VIEW);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    expect(autoRetryPending(VIEW)).toBe(true);
    waits.cancel(VIEW);
    expect(autoRetryPending(VIEW)).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(retries).toEqual([]);
    waits.dispose();
  });
});

describe("a pane sandbox's load-failed restarts that pane on its own", () => {
  type Sb = TileSandboxLike & { readyPack: string };
  const SPEC = mockPartial<PluginView>({ id: PACK, name: NAME, hash: "h-ant", has_frontend: true, capabilities: [] });

  function rig(failures: number) {
    const pane = paneEl(VIEW);
    setViewStateTileResolver((id) => (id === VIEW ? pane : null));
    const made: Sb[] = [];
    const stub = (): Sb => mockPartial<Sb>({ readyPack: "", setActiveTile: vi.fn(), frame: vi.fn(), unload: vi.fn() });
    const load = { attaches: 0, failures };
    const tiles = new TileSandboxes<Sb>({
      main: stub(),
      create: () => { const sb = stub(); made.push(sb); return sb; },
      drivenTile: () => "main",
      target: () => null,
      mayLoad: () => true,
      attach: async (sb, spec) => {
        load.attaches += 1;
        if (load.failures > 0) {
          load.failures -= 1;
          throw new Error("pack asset fetch failed");
        }
        sb.readyPack = spec.id;
      },
    });
    return { pane, made, load, tiles };
  }

  it("fails twice, retries at 3 s and 10 s on one sandbox at a time, then starts and stops retrying", async () => {
    const { pane, made, load, tiles } = rig(2);
    tiles.sync([{ id: VIEW, spec: SPEC }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(viewStateOf(VIEW)).toMatchObject({ kind: "couldnt-start", reason: "load-failed" });
    expect(notices(pane)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(load.attaches).toBe(2);
    // Failed again: still the one notice (repainted in place), the old sandbox unloaded.
    expect(viewStateOf(VIEW)).toMatchObject({ kind: "couldnt-start", reason: "load-failed" });
    expect(notices(pane)).toHaveLength(1);
    expect(made).toHaveLength(2);
    expect(made[0]!.unload).toHaveBeenCalled();
    expect(tiles.size).toBe(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(load.attaches).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load.attaches).toBe(3);
    expect(tiles.readyPackFor(VIEW)).toBe(PACK);
    expect(viewStateOf(VIEW)).toEqual({ kind: "ready" });
    expect(notices(pane)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(load.attaches).toBe(3);
    expect(made).toHaveLength(3);
  });

  it("removing the pane (drop) stops its retry", async () => {
    const { load, tiles } = rig(5);
    tiles.sync([{ id: VIEW, spec: SPEC }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(autoRetryPending(VIEW)).toBe(true);
    tiles.drop(VIEW);
    expect(autoRetryPending(VIEW)).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(load.attaches).toBe(1);
  });

  it("the pack's sky failed to compile (can't draw): no couldn't start, no retry", async () => {
    const { load, tiles } = rig(5);
    enterCantDrawShader(VIEW, PACK, "ERROR: 0:1");
    tiles.sync([{ id: VIEW, spec: SPEC }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(viewStateOf(VIEW)).toMatchObject({ kind: "cant-draw", reason: "shader" });
    expect(autoRetryPending(VIEW)).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(load.attaches).toBe(1);
  });
});

describe("apply-mode's couldn't start re-applies the pick on its own", () => {
  const SPEC: PluginView = { id: PACK, name: NAME, version: 1, runtime: "typescript", capabilities: [] };
  const MODE: ViewMode = { id: VIEW, pluginId: PACK, label: NAME, hint: NAME, kind: "demo", legend: () => [] };
  const TILE = "main";

  function rig(opts: { mosaic?: boolean } = {}) {
    const pane = paneEl(VIEW);
    setViewStateTileResolver((id) => (id === TILE || id === VIEW ? pane : null));
    const modeSel = mockPartial<Select>({ value: VIEW });
    const onWall = { has: true };
    const outcome: { next: "fail" | "ok" } = { next: "fail" };
    const host: ApplyModeHost = mockPartial<ApplyModeHost>({
      mosaic: opts.mosaic ? mockPartial<Mosaic>({ on: true }) : null,
      modeSel,
      modeLabel: (m) => m.label,
      mosaicHasTile: () => onWall.has,
    });
    const tile = opts.mosaic ? VIEW : TILE;
    // main.ts: retryDeclinedMode -> applyMode: starting, then ready or couldn't start again.
    const retry = vi.fn((modeId: string) => {
      setViewState(tile, modeId, { kind: "starting" });
      if (outcome.next === "ok") setViewState(tile, modeId, { kind: "ready" });
      else showPickCouldntStart(host, MODE, SPEC, "load-failed", new Error("pack load failed"));
    });
    host.retryDeclinedMode = retry;
    return { pane, modeSel, onWall, outcome, host, retry, tile };
  }

  it("load-failed: re-applied at 3 s, then 10 s, then it starts and nothing more runs", () => {
    const { pane, outcome, host, retry, tile } = rig();
    showPickCouldntStart(host, MODE, SPEC, "load-failed", new Error("pack load failed"));
    expect(viewStateOf(tile)).toMatchObject({ kind: "couldnt-start", reason: "load-failed" });
    vi.advanceTimersByTime(3_000);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(VIEW);
    expect(notices(pane)).toHaveLength(1);
    outcome.next = "ok";
    vi.advanceTimersByTime(10_000);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(viewStateOf(tile)).toEqual({ kind: "ready" });
    expect(notices(pane)).toHaveLength(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("grant-failed (the OK could not be saved) is retried too", () => {
    const { outcome, host, retry } = rig();
    outcome.next = "ok";
    showPickCouldntStart(host, MODE, SPEC, "grant-failed");
    vi.advanceTimersByTime(3_000);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("the operator picked another view: the waiting retry never re-applies this one", () => {
    const { modeSel, host, retry } = rig();
    showPickCouldntStart(host, MODE, SPEC, "load-failed");
    modeSel.value = "topology";
    vi.advanceTimersByTime(10 * 60_000);
    expect(retry).not.toHaveBeenCalled();
    expect(autoRetryPending(TILE)).toBe(false);
  });

  it("a mosaic pane: retried while it is on the wall, dropped once it is not", () => {
    const { onWall, host, retry, tile } = rig({ mosaic: true });
    expect(tile).toBe(VIEW);
    showPickCouldntStart(host, MODE, SPEC, "load-failed");
    vi.advanceTimersByTime(3_000);
    expect(retry).toHaveBeenCalledTimes(1);
    onWall.has = false;
    vi.advanceTimersByTime(10 * 60_000);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("Needs you after the failure ends the retries (the operator's answer, never a retry)", () => {
    const { host, retry, tile } = rig();
    showPickCouldntStart(host, MODE, SPEC, "load-failed");
    setViewState(tile, VIEW, { kind: "needs-you", reason: "consent", packId: PACK });
    vi.advanceTimersByTime(10 * 60_000);
    expect(retry).not.toHaveBeenCalled();
  });

  it("the sky already can't draw (shader): no couldn't start is shown, nothing is retried", () => {
    const { host, retry, tile } = rig();
    enterCantDrawShader(tile, PACK, "ERROR: 0:1");
    showPickCouldntStart(host, MODE, SPEC, "load-failed");
    expect(viewStateOf(tile)).toMatchObject({ kind: "cant-draw", reason: "shader" });
    vi.advanceTimersByTime(10 * 60_000);
    expect(retry).not.toHaveBeenCalled();
  });

  it("a view that isn't installed (missing) is never retried", () => {
    const retry = vi.fn();
    showViewState(VIEW, VIEW, PACK, { kind: "couldnt-start", reason: "missing", packId: PACK }, { onRetry: retry });
    expect(autoRetryPending(VIEW)).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(retry).not.toHaveBeenCalled();
  });
});
