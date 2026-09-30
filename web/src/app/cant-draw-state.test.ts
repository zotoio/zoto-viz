/**
 * #171 (c): each tile's `cant-draw` view state, from the host's own paths.
 * - A lost shared context stops every tile (`reason: "context-lost"`); a failed shader compile
 *   stops only its tile (`reason: "shader"`, with the pack id and the info log).
 * - Context-lost holds until the context is back and a frame has drawn (when the wall notice
 *   clears), then each tile goes back to what it showed. `reload: true` once the wall offers Reload.
 * - A shader failure ends when the tile's pack is swapped or its sky cleared.
 * The shader rows drive the real RenderHostTileShader (latch, three's `onShaderError` hook, wall
 * notice) over a fake renderer; one row drives a real RenderHost through its canvas events.
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { RenderHost, type HostedView } from "../graph/render-host";
import { RenderHostTileShader, type RenderHostShaderGpu } from "../graph/render-host-tile-shader";
import { GFX_INTERRUPTED_NOTICE, GFX_NO_RESTORE_NOTICE } from "../graph/shader-fallback-copy";
import { bindCantDrawViewState } from "./cant-draw-state";
import {
  clearViewState,
  onViewStateChange,
  resetViewStatesForTests,
  setViewState,
  viewStateCopy,
  viewStateOf,
  viewStateTile,
  type ViewState,
  type ViewStateCopyTile,
} from "./view-state";

type FakeGl = { isContextLost(): boolean; getShaderInfoLog(s: object): string; getProgramInfoLog(p: object): string };
type FakeRenderer = {
  getContext(): WebGL2RenderingContext | null;
  compile(scene: THREE.Scene, camera: THREE.Camera): void;
  debug: { checkShaderErrors: boolean; onShaderError: ((gl: FakeGl, program: object, vs: object, fs: object) => void) | null };
};

const TILES = ["main", "pane-b", "pane-c"];

type FakeHost = RenderHostShaderGpu & { renderer: FakeRenderer; failNext: string | null };

/** A GL host whose next compile fails with `failNext` as the info log (three's onShaderError path). */
function fakeHost(): FakeHost {
  const renderer: FakeRenderer = {
    getContext: () => null,
    debug: { checkShaderErrors: false, onShaderError: null },
    compile(): void {
      const log = fake.failNext;
      if (log === null) return;
      const gl: FakeGl = { isContextLost: () => false, getShaderInfoLog: () => log, getProgramInfoLog: () => "" };
      this.debug.onShaderError?.(gl, {}, {}, {});
    },
  };
  const fake: FakeHost = {
    software: false,
    glContextLost: false,
    failNext: null,
    invalidate: () => {},
    drawTileIds: () => TILES,
    renderer,
  };
  return fake;
}

let wall: HTMLElement;
let host: FakeHost;
let shader: RenderHostTileShader;
let unbind: () => void;
const scene3 = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();

function pane(id: string): HTMLElement {
  const el = document.createElement("div");
  el.dataset.pane = id;
  wall.appendChild(el);
  return el;
}

/** A tile's pack sky compiles now (and fails with `log` when given). */
function compileSky(tileId: string, packId: string, log: string | null): string | null {
  shader.beginTilePack(tileId, `plugin:${packId}`, packId, pane(tileId), packId, true);
  host.failNext = log;
  return shader.probeTileSky(tileId, scene3, camera);
}

const CONTEXT_LOST = { kind: "cant-draw", reason: "context-lost" };

describe("#171 (c) per-tile cant-draw view state", () => {
  beforeEach(() => {
    expect.hasAssertions();
    resetViewStatesForTests();
    document.body.innerHTML = "";
    wall = document.createElement("div");
    document.body.appendChild(wall);
    host = fakeHost();
    shader = new RenderHostTileShader(wall, host);
    unbind = bindCantDrawViewState(shader);
  });
  afterEach(() => {
    unbind();
    shader.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loss: every tile on the host is cant-draw / context-lost (#171 c)", () => {
    setViewState("main", "plugin:backrooms", { kind: "ready" });
    shader.onSharedContextLost();
    for (const id of TILES) expect(viewStateOf(id), `tile ${id}`).toEqual(CONTEXT_LOST);
  });

  it("draw failure: a failed shader compile puts that tile in cant-draw / shader with the pack id and info log (#171 c)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(compileSky("pane-b", "graph-cloth", "ERROR: 0:12: 'uEdgeOpacity' : undeclared identifier")).toBe("shader failed");
    expect(viewStateOf("pane-b")).toEqual({
      kind: "cant-draw",
      reason: "shader",
      packId: "graph-cloth",
      log: "ERROR: 0:12: 'uEdgeOpacity' : undeclared identifier",
    });
  });

  it("other tiles unaffected: a shader failure on one tile leaves every other tile's state alone (#171 c)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setViewState("main", "plugin:backrooms", { kind: "ready" });
    setViewState("pane-c", "plugin:fluid-dyn", { kind: "starting" });
    compileSky("pane-b", "graph-cloth", "compile error");
    expect(viewStateOf("pane-b")?.kind).toBe("cant-draw");
    expect(viewStateOf("main")).toEqual({ kind: "ready" });
    expect(viewStateOf("pane-c")).toEqual({ kind: "starting" });
  });

  it("restore: context-lost holds until a frame draws after the restore, then each tile goes back to what it showed (#171 c)", () => {
    setViewState("main", "plugin:backrooms", { kind: "ready" });
    setViewState("pane-b", "plugin:fractal-zoom", { kind: "needs-you", reason: "consent", packId: "fractal-zoom" });
    shader.onSharedContextLost();
    shader.onSharedContextRestored();
    // The context is back but nothing has drawn yet: the wall notice is still up, and so is the state.
    for (const id of TILES) expect(viewStateOf(id), `tile ${id} restored, no frame yet`).toEqual(CONTEXT_LOST);
    expect(wall.querySelectorAll(".gfx-wall-notice").length).toBe(1);
    shader.onFirstFrameAfterRestore();
    expect(wall.querySelectorAll(".gfx-wall-notice").length).toBe(0);
    expect(viewStateOf("main")).toEqual({ kind: "ready" });
    expect(viewStateOf("pane-b")).toEqual({ kind: "needs-you", reason: "consent", packId: "fractal-zoom" });
    expect(viewStateOf("pane-c"), "a tile with no state before the loss drew: ready").toEqual({ kind: "ready" });
  });

  it("pack swap: a new pack on the tile ends its shader cant-draw (#171 c)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    compileSky("pane-b", "graph-cloth", "compile error");
    expect(viewStateOf("pane-b")?.kind).toBe("cant-draw");
    shader.beginTilePack("pane-b", "plugin:nixie-clock", "nixie-clock", pane("pane-b2"), "Nixie Clock", true);
    expect(viewStateOf("pane-b")).toBeNull();
  });

  it("sky cleared: clearing the tile's pack sky ends its shader cant-draw (#171 c)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    compileSky("pane-b", "graph-cloth", "compile error");
    expect(viewStateOf("pane-b")?.kind).toBe("cant-draw");
    shader.clearShaderFallback("pane-b");
    expect(viewStateOf("pane-b")).toBeNull();
  });

  it("viewStateOf on an unknown tile is null (#171 c)", () => {
    shader.onSharedContextLost();
    expect(viewStateOf("no-such-tile")).toBeNull();
    expect(viewStateOf("")).toBeNull();
  });

  it("Reload offered: once the wall shows Reload the state says so (reload: true); a new loss goes back to restoring (#171 c)", () => {
    vi.useFakeTimers();
    shader.onSharedContextLost();
    expect(viewStateOf("main")).toEqual(CONTEXT_LOST);
    vi.advanceTimersByTime(9_999);
    expect(wall.querySelector(".gfx-wall-reload"), "no Reload yet").toBeNull();
    expect(viewStateOf("main")).toEqual(CONTEXT_LOST);
    vi.advanceTimersByTime(1);
    expect(wall.querySelector(".gfx-wall-notice")?.textContent).toContain(GFX_NO_RESTORE_NOTICE);
    expect(wall.querySelector(".gfx-wall-reload")?.textContent).toBe("Reload");
    for (const id of TILES) expect(viewStateOf(id), `tile ${id}`).toEqual({ ...CONTEXT_LOST, reload: true });
    // Restored, no frame drawn, lost again: the notice restarts "Restoring…", so reload goes away.
    shader.onSharedContextRestored();
    shader.onSharedContextLost();
    expect(wall.querySelector(".gfx-wall-reload")).toBeNull();
    for (const id of TILES) expect(viewStateOf(id), `tile ${id} lost again`).toEqual(CONTEXT_LOST);
  });

  it("while lost, other writers wait underneath: a sky wait's starting or a clear does not replace cant-draw, and applies after the restore (#171 c)", () => {
    setViewState("main", "plugin:backrooms", { kind: "ready" });
    setViewState("pane-b", "plugin:fluid-dyn", { kind: "ready" });
    shader.onSharedContextLost();
    setViewState("main", "plugin:fluid-dyn", { kind: "starting" });
    clearViewState("pane-b");
    expect(viewStateOf("main")).toEqual(CONTEXT_LOST);
    expect(viewStateOf("pane-b")).toEqual(CONTEXT_LOST);
    shader.onSharedContextRestored();
    shader.onFirstFrameAfterRestore();
    expect(viewStateOf("main"), "the pick made while lost").toEqual({ kind: "starting" });
    expect(viewStateOf("pane-b"), "torn down while lost").toBeNull();
  });

  it("copy: context-lost is word for word the wall notice: GFX_INTERRUPTED_NOTICE until Reload, then GFX_NO_RESTORE_NOTICE (#171 c)", () => {
    for (const tile of [{ tileId: "main", tileCount: 1 }, { tileId: "pane-b", tileCount: 3 }]) {
      expect(viewStateCopy({ kind: "cant-draw", reason: "context-lost" }, "Graph cloth", tile).text).toBe(GFX_INTERRUPTED_NOTICE);
      expect(viewStateCopy({ kind: "cant-draw", reason: "context-lost", reload: true }, "Graph cloth", tile).text).toBe(GFX_NO_RESTORE_NOTICE);
    }
  });

  it("copy: a solo tile's shader failure drops \"Other tiles aren't affected\"; a mosaic tile keeps it (#171 c)", () => {
    const shader: ViewState = { kind: "cant-draw", reason: "shader", packId: "graph-cloth" };
    const solo = "Graph cloth couldn't draw. Pick another view, or reload to try again.";
    const mosaic = "Graph cloth couldn't draw. Other tiles aren't affected. Pick another view, or reload to try again.";
    expect(viewStateCopy(shader, "Graph cloth", { tileId: "main", tileCount: 1 }).text, "solo wall (tile main)").toBe(solo);
    expect(viewStateCopy(shader, "Graph cloth", { tileId: "pane-b", tileCount: 1 }).text, "the only tile").toBe(solo);
    expect(viewStateCopy(shader, "Graph cloth", { tileId: "pane-b", tileCount: 3 }).text, "mosaic tile").toBe(mosaic);
  });

  it("type: viewStateCopy's tile is required and whole, so leaving it out (or its tileId / tileCount) fails tsc (#171 c)", () => {
    // Checked by tsc -p tsconfig.test.json, not at runtime: an optional or defaulted `tile`, or an
    // optional field, no longer matches these and the test program fails to compile.
    expectTypeOf(viewStateCopy).parameter(2).toEqualTypeOf<ViewStateCopyTile>();
    expectTypeOf<ViewStateCopyTile>().toEqualTypeOf<{ tileId: string; tileCount: number }>();
    // At runtime a default parameter drops out of Function.length, so a defaulted `tile` is red here too.
    expect(viewStateCopy.length, "viewStateCopy's required parameters").toBe(3);
  });

  it("viewStateTile: solo wall is 1 tile; a mosaic pane counts its wall's panes; a lone pane is 1 (#171 c)", () => {
    const wall = document.createElement("div");
    const panes = ["a", "b", "c"].map((id) => {
      const el = document.createElement("div");
      el.className = "mosaic-pane";
      el.dataset.mode = id;
      wall.appendChild(el);
      return el;
    });
    const notice = document.createElement("div");
    notice.className = "gfx-wall-notice";
    wall.appendChild(notice);
    expect(viewStateTile("main", document.createElement("div"))).toEqual({ tileId: "main", tileCount: 1 });
    expect(viewStateTile("main", null)).toEqual({ tileId: "main", tileCount: 1 });
    expect(viewStateTile("b", panes[1])).toEqual({ tileId: "b", tileCount: 3 });
    const lone = document.createElement("div");
    const only = document.createElement("div");
    only.className = "mosaic-pane";
    lone.appendChild(only);
    expect(viewStateTile("x", only)).toEqual({ tileId: "x", tileCount: 1 });
    expect(viewStateTile("x", null), "no element: nothing else is known to share the wall").toEqual({ tileId: "x", tileCount: 1 });
  });
});

describe("#171 (c) real RenderHost: the canvas's lost / restored events drive each tile's state", () => {
  it("webglcontextlost marks the host's tiles cant-draw / context-lost; webglcontextrestored (software: drawn at once) clears it (#171 c)", () => {
    expect.hasAssertions();
    resetViewStatesForTests();
    document.body.innerHTML = "";
    const w = document.createElement("div");
    document.body.appendChild(w);
    const rh = new RenderHost(w, { software: true });
    const view: HostedView = {
      viewEl: w,
      tileId: "main",
      hostFrame: () => {},
      hostContextLost: () => {},
      hostContextRestored: () => {},
    };
    rh.add(view);
    const off = bindCantDrawViewState(rh);
    try {
      setViewState("main", "plugin:backrooms", { kind: "ready" });
      rh.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      expect(rh.glContextLost).toBe(true);
      expect(viewStateOf("main")).toEqual(CONTEXT_LOST);
      rh.canvas.dispatchEvent(new Event("webglcontextrestored"));
      expect(viewStateOf("main")).toEqual({ kind: "ready" });
    } finally {
      off();
      rh.dispose();
    }
  });
});

/** A GL context that is never lost unless the row says so; every call the host makes that the row ignores is a no-op. */
class ProxyGl {
  lost = false;
  constructor() {
    return new Proxy(this, { get: (target, key, recv) => (key in target ? Reflect.get(target, key, recv) : () => null) });
  }
  isContextLost(): boolean { return this.lost; }
  fenceSync(): null { return null; }
  getContextAttributes(): { antialias: boolean } { return { antialias: false }; }
  getExtension(): null { return null; }
}

describe("#171 (c) context-drawn fires once per restore, not once per frame (Pedant)", () => {
  it("lose, restore, 120 drawn frames: exactly 1 context-drawn event and 1 view-state change; 120 frames with no loss: 0 and 0 (#171 c)", () => {
    expect.hasAssertions();
    resetViewStatesForTests();
    document.body.innerHTML = "";
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const w = document.createElement("div");
    const p = document.createElement("div");
    for (const el of [w, p]) {
      Object.defineProperty(el, "clientWidth", { value: 640 });
      Object.defineProperty(el, "clientHeight", { value: 480 });
      el.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
    }
    w.appendChild(p);
    document.body.appendChild(w);
    const rh = new RenderHost(w);
    Object.defineProperty(rh, "software", { value: false });
    delete rh.canvas.dataset.softgl;
    const gl = new ProxyGl();
    let draws = 0;
    Object.assign(rh.renderer, {
      getContext: () => gl,
      forceContextLoss: () => {},
      forceContextRestore: () => {},
      render: () => { draws += 1; },
      compile: () => {},
    });
    rh.canvas.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
    const probe: HostedView = {
      viewEl: p,
      tileId: "main",
      hostFrame: () => { rh.present(probe, 0x000000, scene3, camera); },
      hostContextLost: () => {},
      hostContextRestored: () => {},
    };
    rh.add(probe);
    const off = bindCantDrawViewState(rh);
    let ts = 0;
    const frames = (n: number) => { for (let i = 0; i < n; i++) { ts += 16; rh.advanceFrame(ts); } };
    let drawnEvents = 0;
    let changes = 0;
    const offEvents = rh.onDrawEvent((e) => { if (e.type === "context-drawn") drawnEvents += 1; });
    try {
      setViewState("main", "plugin:backrooms", { kind: "ready" });
      frames(1);
      expect(draws, "the probe draws through the GL path").toBeGreaterThan(0);

      gl.lost = true;
      rh.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      expect(viewStateOf("main")).toEqual(CONTEXT_LOST);
      gl.lost = false;
      rh.canvas.dispatchEvent(new Event("webglcontextrestored"));
      const offChanges = onViewStateChange(() => { changes += 1; });
      drawnEvents = 0;
      draws = 0;
      frames(120);
      expect(draws, "120 frames drew").toBeGreaterThanOrEqual(120);
      expect(drawnEvents, "context-drawn events over 120 frames after one restore").toBe(1);
      expect(changes, "view-state changes over 120 frames after one restore").toBe(1);
      expect(viewStateOf("main")).toEqual({ kind: "ready" });

      drawnEvents = 0;
      changes = 0;
      frames(120);
      expect(drawnEvents, "context-drawn events over 120 frames with no loss").toBe(0);
      expect(changes, "view-state changes over 120 frames with no loss").toBe(0);
      offChanges();
    } finally {
      offEvents();
      off();
      rh.dispose();
      vi.unstubAllGlobals();
    }
  });
});
