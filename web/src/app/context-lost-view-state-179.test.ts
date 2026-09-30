/**
 * #179 part (c) (with #171 (c)): per-tile cant-draw / context-lost over the shared RenderHost, and
 * the host's `contextRecovery` read off the wall notice so it never disagrees with the screen.
 *
 * A real RenderHost over a fake GL context: the lost / restored events come from the canvas,
 * `isContextLost()` agrees with them, and the browser never gives the context back unless the row
 * says so. Tiles are light views that draw through `host.present` (mosaic panes "a", "b", "c").
 * Observable: `viewStateOf` per tile, each tile element's `data-view-state`, the wall notice's text,
 * and `host.contextRecovery`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost, type HostedView } from "../graph/render-host";
import { GFX_INTERRUPTED_NOTICE, GFX_NO_RESTORE_NOTICE, genericShaderFallbackMessage } from "../graph/shader-fallback-copy";
import * as shaderPackFallback from "../graph/shader-pack-fallback";
import { TileShaderFallback } from "../graph/tile-shader-fallback";
import { bindCantDrawViewState } from "./cant-draw-state";
import { bindCantDrawSurface } from "./cant-draw-surface";
import {
  enterCantDrawShader,
  leaveCantDrawShader,
  resetViewStatesForTests,
  setViewState,
  setViewStateTileResolver,
  viewStateCopy,
  viewStateTile,
  viewStateOf,
} from "./view-state";

const LOST = { kind: "cant-draw", reason: "context-lost" };

/** Every GL call the rows don't care about is a no-op that hands back null. */
function fakeGl(state: { lost: boolean }): object {
  const known: Record<string, unknown> = {
    isContextLost: () => state.lost,
    getContextAttributes: () => ({ antialias: false }),
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
  };
  return new Proxy(known, { get: (target, key) => (typeof key === "string" && key in target ? target[key] : () => null) });
}

type Wall = {
  host: RenderHost;
  wall: HTMLElement;
  panes: Map<string, HTMLElement>;
  gl: { lost: boolean };
  frame: () => void;
  lose: () => void;
  restore: () => void;
  stop: () => void;
};

function box(el: HTMLElement): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 640 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 480 });
  el.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
}

/** A wall on the shared host with one light view per tile id; `software` = the Canvas 2D host. */
function bootWall(tileIds: string[], opts: { software?: boolean } = {}): Wall {
  const raf: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => raf.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const wall = document.createElement("div");
  box(wall);
  document.body.appendChild(wall);
  const host = new RenderHost(wall, opts.software ? { software: true } : {});
  const gl = { lost: false };
  if (!opts.software) {
    Object.defineProperty(host, "software", { value: false });
    delete host.canvas.dataset.softgl;
    const ctx = fakeGl(gl);
    Object.assign(host.renderer, {
      getContext: () => ctx,
      forceContextLoss: () => {},
      forceContextRestore: () => {}, // the browser refuses: only the row's restore() brings it back
      render: () => {},
      compile: () => {},
    });
  }
  box(host.canvas);
  const panes = new Map<string, HTMLElement>();
  for (const id of tileIds) {
    const pane = document.createElement("div");
    pane.className = "mosaic-pane";
    pane.dataset.mode = id;
    box(pane);
    wall.appendChild(pane);
    panes.set(id, pane);
    const view: HostedView = {
      viewEl: pane,
      tileId: id,
      hostFrame: () => { host.present(view, 0x000000, new THREE.Scene(), new THREE.PerspectiveCamera()); },
      hostContextLost: () => {},
      hostContextRestored: () => {},
    };
    host.add(view);
  }
  setViewStateTileResolver((id) => panes.get(id) ?? null);
  const stopState = bindCantDrawViewState(host);
  const stopSurface = bindCantDrawSurface((_viewId, packId) => (packId === "fluid" ? "Fluid" : packId));
  const stop = () => { stopState(); stopSurface(); };
  let ts = 0;
  return {
    host,
    wall,
    panes,
    gl,
    frame: () => { ts += 16; host.advanceFrame(ts); },
    lose: () => { gl.lost = true; host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); },
    restore: () => { gl.lost = false; host.canvas.dispatchEvent(new Event("webglcontextrestored")); },
    stop,
  };
}

const noticeTexts = (w: Wall) => [...w.wall.querySelectorAll(".gfx-wall-notice")].map((n) => n.textContent ?? "");
const reloadButtons = (w: Wall) => w.wall.querySelectorAll(".gfx-wall-reload").length;

describe("#179 part (c): every tile on the shared host goes cant-draw / context-lost and recovers", () => {
  let w: Wall | null = null;

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    resetViewStatesForTests();
  });

  afterEach(() => {
    w?.stop();
    w?.host.dispose();
    w?.wall.remove();
    w = null;
    resetViewStatesForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mosaic: three tiles all enter cant-draw on a loss, hold it while lost and through the restored event, and leave it on the first drawn frame", () => {
    w = bootWall(["a", "b", "c"]);
    expect(w.host.drawTileIds()).toEqual(["a", "b", "c"]);
    setViewState("a", "plugin:a", { kind: "ready" });
    setViewState("b", "plugin:b", { kind: "ready" });
    // c has no state yet: it still can't draw while lost, and comes back ready.
    w.frame();

    w.lose();
    for (const id of ["a", "b", "c"]) {
      expect(viewStateOf(id), `tile ${id} while lost`).toEqual(LOST);
      expect(w.panes.get(id)!.dataset.viewState, `tile ${id} element`).toBe("cant-draw");
    }
    w.frame();
    for (const id of ["a", "b", "c"]) expect(viewStateOf(id), `tile ${id} after a frame while lost`).toEqual(LOST);

    w.restore();
    for (const id of ["a", "b", "c"]) expect(viewStateOf(id), `tile ${id} restored, nothing drawn`).toEqual(LOST);

    w.frame();
    for (const id of ["a", "b", "c"]) {
      expect(viewStateOf(id), `tile ${id} after restore + drawn frame`).toEqual({ kind: "ready" });
      expect(w.panes.get(id)!.dataset.viewState).toBe("ready");
    }
    expect(noticeTexts(w)).toEqual([]);
  });

  it("mosaic: a tile waiting on the operator goes back to Needs you, and a write made while lost is what the tile shows after", () => {
    w = bootWall(["a", "b", "c"]);
    setViewState("a", "plugin:a", { kind: "ready" });
    setViewState("b", "plugin:b", { kind: "starting" });
    setViewState("c", "plugin:c", { kind: "needs-you", reason: "consent", packId: "c" });
    w.lose();
    for (const id of ["a", "b", "c"]) expect(viewStateOf(id)).toEqual(LOST);
    // b's sky wait finishes while nothing can draw: the tile stays cant-draw, the write waits.
    setViewState("b", "plugin:b", { kind: "ready" });
    expect(viewStateOf("b"), "a write while lost does not take the tile out of cant-draw").toEqual(LOST);
    w.restore();
    w.frame();
    expect(viewStateOf("a")).toEqual({ kind: "ready" });
    expect(viewStateOf("b")).toEqual({ kind: "ready" });
    expect(viewStateOf("c")).toEqual({ kind: "needs-you", reason: "consent", packId: "c" });
  });

  it("repeat: lost again after a restore that never drew -- still cant-draw; the next restore + drawn frame recovers every tile", () => {
    w = bootWall(["a", "b"]);
    w.lose();
    w.restore();
    w.lose();
    for (const id of ["a", "b"]) expect(viewStateOf(id)).toEqual(LOST);
    w.frame();
    for (const id of ["a", "b"]) expect(viewStateOf(id)).toEqual(LOST);
    w.restore();
    w.frame();
    for (const id of ["a", "b"]) expect(viewStateOf(id)).toEqual({ kind: "ready" });
  });

  it("copy: context-lost is the wall notice's own words (Restoring until reload:true, then the Reload sentence), never 'other tiles', no tile button", () => {
    // The loss copy is the wall's own words whichever tile asks: a mosaic pane or the solo wall.
    const lost = viewStateCopy({ kind: "cant-draw", reason: "context-lost" }, "Backrooms", { tileId: "b", tileCount: 3 });
    expect(lost.text).toBe(GFX_INTERRUPTED_NOTICE);
    expect(viewStateCopy({ kind: "cant-draw", reason: "context-lost" }, "Backrooms", viewStateTile("main", null)).text).toBe(GFX_INTERRUPTED_NOTICE);
    const reload = viewStateCopy({ kind: "cant-draw", reason: "context-lost", reload: true }, "Backrooms", { tileId: "b", tileCount: 3 });
    expect(reload.text).toBe(GFX_NO_RESTORE_NOTICE);
    expect(reload.text).not.toMatch(/restoring/i);
    for (const c of [lost, reload]) {
      expect(c.text).not.toMatch(/other tiles/i);
      expect(c.button).toBeNull();
    }
    const shader = viewStateCopy({ kind: "cant-draw", reason: "shader", packId: "graph-cloth" }, "Graph cloth", { tileId: "b", tileCount: 3 });
    expect(shader.text).toBe("Graph cloth couldn't draw. Other tiles aren't affected. Pick another view, or reload to try again.");
  });
});

describe("#179 UX Pro: contextRecovery agrees with the wall, and no visible string says Restoring once Reload is up", () => {
  let w: Wall | null = null;

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    resetViewStatesForTests();
  });

  afterEach(() => {
    w?.stop();
    w?.host.dispose();
    w?.wall.remove();
    w = null;
    resetViewStatesForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("software host: at 10 s the notice offers Reload and contextRecovery says gave-up, not restoring", () => {
    w = bootWall(["main"], { software: true });
    expect(w.host.contextRecovery).toBe("ok");
    w.lose();
    expect(noticeTexts(w)).toEqual([GFX_INTERRUPTED_NOTICE]);
    expect(w.host.contextRecovery, "the wall says Restoring").toBe("restoring");
    vi.advanceTimersByTime(10_000);
    expect(reloadButtons(w), "Reload is on screen").toBe(1);
    expect(noticeTexts(w)).toEqual([`${GFX_NO_RESTORE_NOTICE}Reload`]);
    expect(w.wall.textContent ?? "", "no visible string says Restoring once Reload is up").not.toMatch(/restoring/i);
    expect(w.host.contextRecovery, "contextRecovery agrees with the screen").toBe("gave-up");
    vi.advanceTimersByTime(20_000);
    expect(w.host.contextRecovery).toBe("gave-up");
  });

  it("GL host restored with no drawn frame: contextRecovery stays restoring while the notice is up, gave-up at the 10 s Reload, ok after a drawn frame", () => {
    w = bootWall(["main"]);
    w.lose();
    vi.advanceTimersByTime(1_500);
    w.restore(); // restored at 1.5 s; nothing draws
    expect(noticeTexts(w), "restored event alone keeps the notice").toEqual([GFX_INTERRUPTED_NOTICE]);
    expect(w.host.contextRecovery, "the wall still says Restoring").toBe("restoring");
    vi.advanceTimersByTime(8_500); // t = 10 s
    expect(reloadButtons(w)).toBe(1);
    expect(w.wall.textContent ?? "").not.toMatch(/restoring/i);
    expect(w.host.contextRecovery, "Reload on screen").toBe("gave-up");
    w.frame();
    expect(noticeTexts(w)).toEqual([]);
    expect(w.host.contextRecovery).toBe("ok");
    expect(viewStateOf("main")).toEqual({ kind: "ready" });
  });
});

/** Every `role="status"` region on the wall that carries a graphics-loss message. */
const lossStatusRegions = (w: Wall) =>
  [...w.wall.querySelectorAll('[role="status"]')].filter((el) => /graphics/i.test(el.textContent ?? ""));
/** Every button on the wall labelled "Reload". */
const reloadLabelled = (w: Wall) => [...w.wall.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "Reload");
const tileSurfaces = (w: Wall) => w.wall.querySelectorAll(".tile-cant-draw");

describe("#179 part (c) surface: a loss is said once, on the wall; only a shader failure paints its own tile", () => {
  let w: Wall | null = null;

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    resetViewStatesForTests();
  });

  afterEach(() => {
    w?.stop();
    w?.host.dispose();
    w?.wall.remove();
    w = null;
    resetViewStatesForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mosaic of 3 in a loss: exactly one role=status region says it, no Reload before reload:true, exactly one Reload after, never Restoring under it", () => {
    w = bootWall(["a", "b", "c"]);
    for (const id of ["a", "b", "c"]) setViewState(id, `plugin:${id}`, { kind: "ready" });
    w.frame();
    w.lose();
    for (const id of ["a", "b", "c"]) expect(viewStateOf(id), `tile ${id}`).toEqual(LOST);
    expect(lossStatusRegions(w).length, "one status region for the loss, not one per tile").toBe(1);
    expect(reloadLabelled(w).length, "no Reload before reload:true").toBe(0);
    expect(tileSurfaces(w).length, "no per-tile loss surface").toBe(0);

    vi.advanceTimersByTime(9_999);
    expect(reloadLabelled(w).length, "still no Reload at 9.999 s").toBe(0);
    for (const id of ["a", "b", "c"]) expect(viewStateOf(id)).toEqual(LOST);

    vi.advanceTimersByTime(1);
    for (const id of ["a", "b", "c"]) expect(viewStateOf(id), `tile ${id} once Reload shows`).toEqual({ ...LOST, reload: true });
    expect(lossStatusRegions(w).length, "still one status region").toBe(1);
    expect(reloadLabelled(w).length, "exactly one Reload once reload:true").toBe(1);
    expect(lossStatusRegions(w)[0]!.contains(reloadLabelled(w)[0]!), "the Reload lives in that status region").toBe(true);
    expect(w.wall.textContent ?? "", "nothing visible says Restoring once Reload is up").not.toMatch(/restoring/i);
    expect(tileSurfaces(w).length).toBe(0);
  });

  it("the loss message leaves with the restore plus a drawn frame, not on the restored event alone", () => {
    w = bootWall(["a", "b", "c"]);
    w.lose();
    w.restore();
    expect(lossStatusRegions(w).length, "restored, nothing drawn yet").toBe(1);
    w.frame();
    expect(lossStatusRegions(w).length, "after the drawn frame").toBe(0);
    expect(reloadLabelled(w).length).toBe(0);
    expect(tileSurfaces(w).length).toBe(0);
  });

  it("shader: only the failed tile paints its own couldn't-draw line (shader copy, never the log), and it goes when the shader clears", () => {
    w = bootWall(["a", "b", "c"]);
    for (const id of ["a", "b", "c"]) setViewState(id, `plugin:${id}`, { kind: "ready" });
    enterCantDrawShader("b", "fluid", "ERROR: 0:12: 'uFoo' : undeclared identifier");
    const b = w.panes.get("b")!;
    const surface = b.querySelector(":scope > .tile-cant-draw");
    expect(surface?.getAttribute("role")).toBe("status");
    expect(surface?.textContent).toBe("Fluid couldn't draw. Other tiles aren't affected. Pick another view, or reload to try again.");
    expect(surface?.textContent ?? "", "the shader log is console-only").not.toMatch(/uFoo|ERROR/);
    expect(surface?.querySelectorAll("button").length, "no tile button").toBe(0);
    expect(tileSurfaces(w).length, "a and c are unaffected").toBe(1);
    expect(lossStatusRegions(w).length, "no wall loss notice for a shader failure").toBe(0);
    leaveCantDrawShader("b");
    expect(tileSurfaces(w).length, "gone once the shader clears").toBe(0);
  });

  it("shader then loss: the tile's line gives way to the one wall message while lost, and comes back after the restore plus a drawn frame", () => {
    w = bootWall(["a", "b"]);
    setViewState("a", "plugin:a", { kind: "ready" });
    enterCantDrawShader("b", "fluid");
    expect(tileSurfaces(w).length).toBe(1);
    w.lose();
    expect(tileSurfaces(w).length, "while lost only the wall speaks").toBe(0);
    expect(lossStatusRegions(w).length).toBe(1);
    w.restore();
    w.frame();
    expect(lossStatusRegions(w).length).toBe(0);
    expect(viewStateOf("b")).toEqual({ kind: "cant-draw", reason: "shader", packId: "fluid" });
    expect(tileSurfaces(w).length, "b's own shader failure still stands").toBe(1);
  });

  it("shader on the solo wall (tile main, one tile): the line drops 'Other tiles aren't affected'", () => {
    w = bootWall(["main"]);
    setViewState("main", "plugin:fluid", { kind: "ready" }); // as production: the solo wall's view id is its mode
    enterCantDrawShader("main", "fluid");
    expect(w.panes.get("main")!.querySelector(":scope > .tile-cant-draw")?.textContent)
      .toBe("Fluid couldn't draw. Pick another view, or reload to try again.");
    leaveCantDrawShader("main");
    enterCantDrawShader("main", ""); // a pack with no name: sanitized to nothing, viewStateCopy says "This view"
    expect(w.panes.get("main")!.querySelector(":scope > .tile-cant-draw")?.textContent)
      .toBe("This view couldn't draw. Pick another view, or reload to try again.");
  });

  it("shader on the only pane of a wall (not main, one tile): viewStateTile counts 1, so the line drops 'Other tiles aren't affected' too", () => {
    w = bootWall(["a"]);
    enterCantDrawShader("a", "fluid");
    expect(w.panes.get("a")!.querySelector(":scope > .tile-cant-draw")?.textContent)
      .toBe("Fluid couldn't draw. Pick another view, or reload to try again.");
  });

  it("a shader tile showing the pack's own simple view (the fallback's chip) gets no second message, and its line stays the pack's", () => {
    w = bootWall(["a"]);
    const simple = new TileShaderFallback(w.panes.get("a")!, { packName: "Nixie Clock", showChip: true, initialText: "12:34:56" });
    enterCantDrawShader("a", "fluid");
    expect(tileSurfaces(w).length).toBe(0);
    expect(w.panes.get("a")!.textContent).toBe("12:34:56Simple view");
    simple.dispose();
  });

  it("the latch's generic fallback in a mosaic pane: 'can't run its graphics on this device' gives way to the one 'couldn't draw' line", () => {
    withPageCss(() => {
      w = bootWall(["a", "b", "c"]);
      const b = w.panes.get("b")!;
      const generic = new TileShaderFallback(b, { packName: "Fluid", showChip: false, initialText: genericShaderFallbackMessage("Fluid") });
      enterCantDrawShader("b", "fluid");
      expect(b.querySelector(":scope > .tile-cant-draw")?.textContent).toBe("Fluid couldn't draw. Other tiles aren't affected. Pick another view, or reload to try again.");
      expect(visibilityNow(b.querySelector(".tile-shader-fallback")!), "the capability line is not shown").toBe("hidden");
      expect(tileSurfaces(w).length, "one line on the wall").toBe(1);
      generic.dispose();
    });
  });

  it("QE: the latch's 5 s fallback tick rewrites its own line when the pack's line changes, and the tile still says 'couldn't draw'", () => {
    let packLine = "";
    const real = shaderPackFallback.shaderPackForId;
    vi.spyOn(shaderPackFallback, "shaderPackForId").mockImplementation((id) => (id === "flaky" ? { fallbackText: () => packLine } : real(id)));
    try {
      withPageCss(() => {
        w = bootWall(["main"]);
        setViewState("main", "plugin:flaky", { kind: "ready" });
        const main = w.panes.get("main")!;
        // The latch's own entry for a failed tile (as its shader-fallback-hook rows drive the tick): the pack's
        // hook has no line yet, so the latch mounts its generic line with no chip, and its 5 s tick is running.
        w.host.beginTilePack("main", "plugin:flaky", "flaky", main, "Flaky", true);
        w.host.onTileShaderCompileFailed("main");
        const sentence = "flaky couldn't draw. Pick another view, or reload to try again.";
        expect(shownLines(main), "before the tick").toEqual([sentence]);
        packLine = "Simple view 12:00";
        vi.advanceTimersByTime(5001);
        expect(main.querySelector(".tile-shader-fallback__text")?.textContent, "the tick ran and rewrote the latch's line").toBe("Simple view 12:00");
        expect(shownLines(main), "5 s after the pack's line changed: still the one couldn't-draw line").toEqual([sentence]);
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("mosaic labels: only the failed tile's graph labels hide while its line shows; they come back when it clears", () => {
    withPageCss(() => {
      w = bootWall(["a", "b", "c"]);
      const labels = new Map<string, HTMLElement>();
      for (const [id, pane] of w.panes) {
        const layer = document.createElement("div");
        const label = document.createElement("div");
        label.className = "label";
        label.textContent = `node-${id}`;
        layer.appendChild(label);
        pane.appendChild(layer);
        labels.set(id, label);
      }
      const hidden = () => [...labels].filter(([, l]) => visibilityNow(l) === "hidden").map(([id]) => id);
      expect(hidden()).toEqual([]);
      enterCantDrawShader("b", "fluid");
      expect(hidden(), "b's labels only, while b's line shows").toEqual(["b"]);
      leaveCantDrawShader("b");
      expect(hidden(), "back once it clears").toEqual([]);
    });
  });

  it("capability: with no WebGL (the Canvas 2D host) a shader pack's tile never goes cant-draw / shader or says 'couldn't draw'; the capability copy still says 'on this device'", () => {
    w = bootWall(["main"], { software: true });
    setViewState("main", "plugin:fluid", { kind: "ready" });
    w.host.beginTilePack("main", "plugin:fluid", "fluid", w.panes.get("main")!, "Fluid", true);
    expect(w.host.probeTileSky("main", new THREE.Scene(), new THREE.PerspectiveCamera()), "no GPU compile to fail").toBeNull();
    expect(viewStateOf("main")).toEqual({ kind: "ready" });
    expect(w.wall.textContent ?? "").not.toMatch(/couldn't draw/);
    expect(genericShaderFallbackMessage("Fluid")).toBe("Fluid can't run its graphics on this device. Other tiles aren't affected.");
  });
});

/**
 * The lines a tile shows now: its own couldn't-draw line and the host latch's fallback line, each when it is
 * mounted and not hidden by the page's CSS.
 */
function shownLines(tile: HTMLElement): string[] {
  return [...tile.querySelectorAll(":scope > .tile-cant-draw, .tile-shader-fallback")]
    .filter((el) => visibilityNow(el) !== "hidden")
    .map((el) => el.textContent ?? "");
}

/** Run `fn` with the page's own stylesheet loaded (the rows read computed visibility from it). */
function withPageCss(fn: () => void): void {
  const css = document.createElement("style");
  css.textContent = readFileSync(resolve(import.meta.dirname, "../style.css"), "utf8");
  document.head.appendChild(css);
  try {
    fn();
  } finally {
    css.remove();
  }
}

/**
 * An element's visibility as the page's CSS gives it now. happy-dom caches an element's computed style and does
 * not drop it when an ancestor's attribute changes (a browser does), so this reads a fresh copy in the same spot.
 */
function visibilityNow(el: Element): string {
  const probe = el.cloneNode(true);
  el.after(probe);
  const vis = probe instanceof Element ? getComputedStyle(probe).visibility : "";
  probe.parentNode?.removeChild(probe);
  return vis;
}

