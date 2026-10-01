/**
 * #241: two pack tiles lose the shared context together, and one Retry brings both back. Retry
 * only asks the host for the context again (`recreateContext`, shared by every tile); when the
 * context draws again, bindCantDrawViewState (cant-draw-state.ts) takes every tile that lost it out
 * of context-lost. #216's row covers one pack tile; this row pins the multi-tile path.
 *
 * The real path: bindCantDrawViewState over a host that sends the draw events the way RenderHost
 * does (`context-lost`, then `context-drawn` once a restored context drew, each naming every drawn
 * tile), bindCantDrawSurface painting each pack tile's "<Pack> couldn't draw." line with Retry (as
 * main.ts does), and Retry pressed by clicking the tile's real Retry button.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { TileDrawEvent } from "../graph/render-host";
import { pluginViewId } from "../plugins/instances";
import { bindCantDrawViewState, type TileDrawSource } from "./cant-draw-state";
import { bindCantDrawSurface } from "./cant-draw-surface";
import { resetViewStatesForTests, setViewState, setViewStateTileResolver, viewStateOf } from "./view-state";

const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST: unknown = parseYaml(readFileSync(resolve(here, "../../../plugins/src/rocket-car-soccer/plugin.yml"), "utf8"));

function manifestField(m: unknown, key: "id" | "name"): string {
  if (m && typeof m === "object" && key in m) {
    const v: unknown = Reflect.get(m, key);
    if (typeof v === "string" && v) return v;
  }
  throw new Error(`rocket-car-soccer plugin.yml has no ${key}`);
}

const PACK_ID = manifestField(MANIFEST, "id");
const PACK_NAME = manifestField(MANIFEST, "name");
const PACK_VIEW = pluginViewId(PACK_ID);
const NOTICE = `${PACK_NAME} couldn't draw.`;

/** A host as bindCantDrawViewState sees it; Retry's `recreateContext` gets a context that draws. */
class FakeHost implements TileDrawSource {
  private readonly listeners = new Set<(e: TileDrawEvent) => void>();
  recreateAsks = 0;
  constructor(private readonly tileIds: readonly string[]) {}
  onDrawEvent(fn: (e: TileDrawEvent) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit(e: TileDrawEvent): void {
    for (const fn of this.listeners) fn(e);
  }
  lose(): void {
    this.emit({ type: "context-lost", tileIds: this.tileIds });
  }
  recreateContext(): void {
    this.recreateAsks += 1;
    this.emit({ type: "context-drawn", tileIds: this.tileIds });
  }
}

/** The tile's own notices (role=status) that carry the pack's couldn't-draw sentence. */
const tileNotices = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[role=status]")]
  .filter((n) => (n.textContent ?? "").includes(NOTICE));

describe("#241: one Retry brings back every pack tile that lost the shared context", () => {
  let wall: HTMLElement | null = null;
  let stop: (() => void) | null = null;

  beforeEach(() => {
    expect.hasAssertions();
    resetViewStatesForTests();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    wall?.remove();
    wall = null;
    resetViewStatesForTests();
    setViewStateTileResolver(null);
  });

  it("two pack tiles: 2 notices and 2 markers after the loss, 0 and 0 after one Retry, each tile back", () => {
    wall = document.createElement("div");
    document.body.appendChild(wall);
    const panes = new Map<string, HTMLElement>();
    for (const id of ["a", "b"]) {
      const pane = document.createElement("div");
      pane.className = "mosaic-pane";
      pane.dataset.mode = PACK_VIEW;
      wall.appendChild(pane);
      panes.set(id, pane);
    }
    setViewStateTileResolver((id) => panes.get(id) ?? null);
    const host = new FakeHost(["a", "b"]);
    const stopState = bindCantDrawViewState(host);
    const stopSurface = bindCantDrawSurface(
      (viewId, packId) => (viewId === PACK_VIEW ? PACK_NAME : packId),
      { isPack: (viewId) => viewId === PACK_VIEW, retry: () => host.recreateContext() },
    );
    stop = () => { stopState(); stopSurface(); };
    // Before the loss: "a" shows the pack, "b" is still starting it.
    setViewState("a", PACK_VIEW, { kind: "ready" }, panes.get("a"));
    setViewState("b", PACK_VIEW, { kind: "starting" }, panes.get("b"));
    const all = [...panes.values()];
    const counts = () => ({
      notices: all.reduce((n, el) => n + tileNotices(el).length, 0),
      markers: all.filter((el) => el.dataset.cantDrawSurface === "context-lost").length,
    });
    expect(counts()).toEqual({ notices: 0, markers: 0 });

    host.lose();
    expect(counts()).toEqual({ notices: 2, markers: 2 });
    for (const [id, el] of panes) {
      expect(viewStateOf(id)).toMatchObject({ kind: "cant-draw", reason: "context-lost" });
      expect(tileNotices(el)).toHaveLength(1);
    }
    const retry = tileNotices(panes.get("a")!)[0]!.querySelector("button");
    expect(retry?.textContent).toBe("Retry");

    retry!.click();
    expect(host.recreateAsks).toBe(1);
    expect(counts()).toEqual({ notices: 0, markers: 0 });
    expect(viewStateOf("a")).toEqual({ kind: "ready" });
    expect(viewStateOf("b")).toEqual({ kind: "starting" });
  });
});
