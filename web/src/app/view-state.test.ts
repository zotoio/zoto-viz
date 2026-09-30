/**
 * ViewState: copy comes from one switch per kind / reason, and each tile (solo "main", or a mosaic
 * pane) carries its own `data-view-state` / `data-view-id`, on the tile and its card / notice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKY_WAIT_DEADLINE_MS, SkyWaits } from "./sky-wait";
import {
  assertNever,
  clearViewState,
  needsYouReasonFor,
  resetViewStatesForTests,
  setViewState,
  showViewState,
  viewStateCopy,
  viewStateOf,
  viewStatePickerSuffix,
  type ViewState,
  type ViewStateCopyTile,
} from "./view-state";

/** These kinds' copy doesn't depend on the tile; the solo wall is the real tile they land on. */
const SOLO: ViewStateCopyTile = { tileId: "main", tileCount: 1 };

describe("viewStateCopy: one switch, plain words, at most one button", () => {
  const rows: Array<[ViewState, string, string | null]> = [
    [{ kind: "starting" }, "Backrooms · Starting…", null],
    [{ kind: "ready" }, "", null],
    [{ kind: "needs-you", reason: "consent", packId: "backrooms" }, "Backrooms needs your OK to run.", "Review"],
    [{ kind: "needs-you", reason: "changed", packId: "backrooms" }, "Backrooms needs your OK again.", "Review"],
    [{ kind: "needs-you", reason: "incomplete", packId: "backrooms" }, "Backrooms needs your OK again.", "Review"],
    [{ kind: "couldnt-start", reason: "timeout", packId: "backrooms" }, "Backrooms couldn't start.", "Retry"],
    [{ kind: "couldnt-start", reason: "load-failed", packId: "backrooms", log: "403" }, "Backrooms couldn't start.", "Retry"],
    [{ kind: "couldnt-start", reason: "grant-failed", packId: "backrooms" }, "Backrooms couldn't start.", "Retry"],
    [{ kind: "couldnt-start", reason: "missing", packId: "backrooms" }, "Backrooms isn't installed. Pick another view for this tile.", null],
  ];
  for (const [state, text, button] of rows) {
    it(`${state.kind}${"reason" in state ? `/${state.reason}` : ""}`, () => {
      const copy = viewStateCopy(state, "Backrooms", SOLO);
      expect(copy.text ?? "").toContain(text);
      expect(copy.button).toBe(button);
    });
  }

  it("an unknown kind is a thrown error, not blank copy (assertNever)", () => {
    // A persisted or foreign state the union doesn't know (cant-draw with no reason), as it would arrive at runtime.
    const unknownKind: ViewState = JSON.parse('{"kind":"cant-draw"}');
    expect(() => viewStateCopy(unknownKind, "Backrooms", SOLO)).toThrow(/unhandled view state/);
    expect(() => assertNever("x" as never)).toThrow(/unhandled view state/);
  });

  it("picker suffix: needs OK only for Needs you; consent states map to reasons", () => {
    expect(viewStatePickerSuffix({ kind: "needs-you", reason: "consent", packId: "a" })).toBe("needs OK");
    expect(viewStatePickerSuffix({ kind: "ready" })).toBeNull();
    expect(viewStatePickerSuffix({ kind: "starting" })).toBeNull();
    expect(needsYouReasonFor("none")).toBe("consent");
    expect(needsYouReasonFor("changed")).toBe("changed");
    expect(needsYouReasonFor("stale")).toBe("incomplete");
  });
});

function mountMosaic(): { scene: HTMLElement; pane: HTMLElement; other: HTMLElement } {
  document.body.innerHTML = `
    <div id="wall"><div id="scene">
      <div class="mosaic-pane" data-mode="plugin:backrooms"></div>
      <div class="mosaic-pane" data-mode="topology"></div>
    </div></div>`;
  return {
    scene: document.getElementById("scene")!,
    pane: document.querySelector<HTMLElement>('.mosaic-pane[data-mode="plugin:backrooms"]')!,
    other: document.querySelector<HTMLElement>('.mosaic-pane[data-mode="topology"]')!,
  };
}

describe("data-view-state / data-view-id per tile", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "info").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); resetViewStatesForTests(); document.body.innerHTML = ""; });

  it("solo: #scene (tile main) carries the state and view id; its notice agrees; clear takes them off", () => {
    const { scene } = mountMosaic();
    scene.innerHTML = "";
    showViewState("main", "plugin:backrooms", "Backrooms", { kind: "needs-you", reason: "consent", packId: "backrooms" }, { onReview: () => {} });
    const notice = scene.querySelector<HTMLElement>(":scope > .mosaic-pane-notice")!;
    expect([scene.dataset.viewState, scene.dataset.viewId]).toEqual(["needs-you", "plugin:backrooms"]);
    expect([notice.dataset.viewState, notice.dataset.viewId]).toEqual(["needs-you", "plugin:backrooms"]);
    expect(notice.querySelector("button[data-action=review]")?.textContent).toBe("Review");
    setViewState("main", "plugin:backrooms", { kind: "ready" });
    expect(scene.dataset.viewState).toBe("ready");
    expect(scene.querySelector(".mosaic-pane-notice"), "Needs you notice goes once it is ready").toBeNull();
    clearViewState("main");
    expect(scene.dataset.viewState).toBeUndefined();
  });

  it("mosaic tile: the pane's sky wait stamps only that pane (starting → couldn't start), not #scene or the next pane", () => {
    const { scene, pane, other } = mountMosaic();
    const waits = new SkyWaits({
      hostEl: () => pane,
      name: () => "Backrooms",
      viewId: (k) => k,
      packId: () => "backrooms",
      skyReady: () => false,
      retry: () => {},
    });
    setViewState("main", "mosaic", { kind: "ready" });
    setViewState("topology", "topology", { kind: "ready" });
    waits.begin("plugin:backrooms");
    const card = pane.querySelector<HTMLElement>(".sky-starting-card")!;
    expect([pane.dataset.viewState, pane.dataset.viewId]).toEqual(["starting", "plugin:backrooms"]);
    expect([card.dataset.viewState, card.dataset.viewId]).toEqual(["starting", "plugin:backrooms"]);
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    const notice = pane.querySelector<HTMLElement>(".mosaic-pane-notice")!;
    expect(viewStateOf("plugin:backrooms")).toEqual({ kind: "couldnt-start", reason: "timeout", packId: "backrooms" });
    expect([pane.dataset.viewState, notice.dataset.viewState, notice.dataset.viewId]).toEqual(["couldnt-start", "couldnt-start", "plugin:backrooms"]);
    expect(notice.querySelector("button[data-action=retry]")?.textContent).toBe("Retry");
    // The solo tile and the other pane keep their own state; a restamp of "main" leaves the pane alone.
    setViewState("main", "mosaic", { kind: "ready" });
    expect([scene.dataset.viewState, scene.dataset.viewId]).toEqual(["ready", "mosaic"]);
    expect([other.dataset.viewState, other.dataset.viewId]).toEqual(["ready", "topology"]);
    expect([notice.dataset.viewState, notice.dataset.viewId], "pane notice keeps its own tile's state").toEqual(["couldnt-start", "plugin:backrooms"]);
  });

  it("a late sky landing does not turn a load failure into ready", () => {
    const { pane } = mountMosaic();
    const waits = new SkyWaits({ hostEl: () => pane, name: () => "Backrooms", skyReady: () => true, retry: () => {} });
    waits.begin("plugin:backrooms");
    showViewState("plugin:backrooms", "plugin:backrooms", "Backrooms", { kind: "couldnt-start", reason: "load-failed", packId: "backrooms" });
    waits.landed("plugin:backrooms");
    expect(pane.dataset.viewState).toBe("couldnt-start");
  });
});
