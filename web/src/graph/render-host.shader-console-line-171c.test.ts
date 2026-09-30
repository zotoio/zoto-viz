/**
 * #171 (c) item 3: when a tile's shader-error latch trips (the tile goes cant-draw), the host logs one
 * console line, `console.warn("zoto-viz tile shader:", <id>, "failed to compile", stage, infoLog)`, or
 * `"failed to link", "program"` when both stages compiled and the link failed. <id> is the tile's pack id, or
 * `view:<viewId>` (leading `plugin:` dropped) when the tile has no pack (Graph Cloth prints `view:graph-fabric`);
 * infoLog is the failed stage's raw info log, last. Once per latch trip, however many frames fail.
 *
 * three's WebGLRenderer is module-mocked as in render-host.lazy-compile-latch-171c.test.ts: `render()` calls
 * `debug.onShaderError` on every render of a scene holding a broken material (worse than three's once per
 * program), and its GL context reports which stage failed (`getShaderParameter(COMPILE_STATUS)`) with that
 * stage's info log. Counts only.
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { RenderHost, type HostedView, type TileDrawEvent } from "./render-host";
import { GraphFabric } from "./fabric";
import { pluginViewId } from "../plugins/instances";

type Stage = "vertex" | "fragment" | "link";
type Hook = ((gl: object, program: object, vs: object, fs: object) => void) | null;

const t = vi.hoisted(() => {
  /** Raw info logs (trailing newline kept, as GL drivers hand them back). */
  const LOGS = {
    vertex: "ERROR: 0:442: 'uEdgeOpacity' : undeclared identifier\n",
    fragment: "ERROR: 0:17: 'skyGlow' : syntax error\n",
    link: "Vertex and fragment shaders disagree on varying vUv\n",
  };
  /** Materials whose (lazy) compile fails on the GPU, and at which stage. */
  const broken = new Map<unknown, "vertex" | "fragment" | "link">();
  return { LOGS, broken };
});

vi.mock("three", async (importOriginal) => {
  const THREE = await importOriginal<typeof import("three")>();
  class Gl {
    readonly COMPILE_STATUS = 0x8b81;
    readonly vs = {};
    readonly fs = {};
    readonly program = {};
    /** The stage failing in the render in progress. */
    failing: Stage | null = null;
    constructor() {
      // GL calls the host makes that this row doesn't care about: no-ops handing back null.
      return new Proxy(this, { get: (target, key, recv) => (key in target ? Reflect.get(target, key, recv) : () => null) });
    }
    isContextLost(): boolean { return false; }
    getExtension(): null { return null; }
    getContextAttributes(): { antialias: boolean } { return { antialias: false }; }
    getShaderParameter(s: object, pname: number): boolean | null {
      if (pname !== this.COMPILE_STATUS) return null;
      return !((s === this.vs && this.failing === "vertex") || (s === this.fs && this.failing === "fragment"));
    }
    getShaderInfoLog(s: object): string {
      if (s === this.vs && this.failing === "vertex") return t.LOGS.vertex;
      if (s === this.fs && this.failing === "fragment") return t.LOGS.fragment;
      return "";
    }
    getProgramInfoLog(): string { return this.failing === "link" ? t.LOGS.link : ""; }
  }
  class WebGLRenderer {
    readonly domElement = document.createElement("canvas");
    private readonly gl = new Gl();
    debug: { checkShaderErrors: boolean; onShaderError: Hook } = { checkShaderErrors: true, onShaderError: null };
    getContext() { return this.gl; }
    render(scene: THREE.Object3D) {
      const stages: Stage[] = [];
      scene.traverseVisible((o) => {
        const stage = o instanceof THREE.Mesh ? t.broken.get(o.material) : undefined;
        if (stage) stages.push(stage);
      });
      const failing = stages[0] ?? null;
      this.gl.failing = failing;
      try {
        if (failing && this.debug.checkShaderErrors) this.debug.onShaderError?.(this.gl, this.gl.program, this.gl.vs, this.gl.fs);
      } finally {
        this.gl.failing = null;
      }
    }
    compile() {}
    setClearColor() {}
    setPixelRatio() {}
    getPixelRatio() { return 1; }
    setSize(w: number, h: number) { this.domElement.width = w; this.domElement.height = h; }
    setScissorTest() {}
    setScissor() {}
    setViewport() {}
    clear() {}
    dispose() {}
    forceContextLoss() {}
    forceContextRestore() {}
  }
  return { ...THREE, WebGLRenderer };
});

const PREFIX = "zoto-viz tile shader:";
const FRAMES = 6;

function rect(el: Element, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () => DOMRect.fromRect({ x, y, width: w, height: h });
}

const view = (tileId: string, viewEl: HTMLElement, viewId: string): HostedView => ({
  viewEl, tileId, viewId, hostFrame() {}, hostContextLost() {}, hostContextRestored() {},
});

/** A wall of `n` side-by-side tiles and a GPU host over it. */
function wallOf(n: number): { host: RenderHost; tiles: HTMLElement[] } {
  const wall = document.createElement("div");
  const tiles = Array.from({ length: n }, () => document.createElement("div"));
  wall.append(...tiles);
  document.body.appendChild(wall);
  rect(wall, 0, 0, 400 * n, 600);
  tiles.forEach((tile, i) => rect(tile, 400 * i, 0, 400, 600));
  const host = new RenderHost(wall, { software: false, dpr: 1 });
  rect(host.canvas, 0, 0, 400 * n, 600);
  return { host, tiles };
}

/** A scene with one mesh; `stage` breaks its material's compile at that stage. */
function sceneWith(stage: Stage | null): THREE.Scene {
  const scene = new THREE.Scene();
  const mat = new THREE.MeshBasicMaterial();
  if (stage) t.broken.set(mat, stage);
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), mat));
  return scene;
}

describe("#171 (c) item 3: one console line per tile shader-latch trip", () => {
  let warn: MockInstance<typeof console.warn>;
  const lines = () => warn.mock.calls.filter((args) => args[0] === PREFIX);
  const unbind: Array<() => void> = [];

  beforeEach(() => {
    expect.hasAssertions();
    t.broken.clear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const u of unbind.splice(0)) u();
    warn.mockRestore();
    document.body.replaceChildren();
  });

  it("broken Graph Cloth tile (no pack): exactly one line over several frames, id view:graph-fabric, raw info log last; healthy tile logs none", () => {
    const { host, tiles: [tileA, tileB] } = wallOf(2);
    if (!tileA || !tileB) throw new Error("wall has no tiles");
    const events: TileDrawEvent[] = [];
    unbind.push(host.onDrawEvent((e) => events.push(e)));

    const fabric = new GraphFabric();
    fabric.mesh.visible = true;
    t.broken.set(fabric.mesh.material, "vertex");
    const sceneA = new THREE.Scene();
    sceneA.add(fabric.mesh);
    const sceneB = sceneWith(null);
    const camera = new THREE.PerspectiveCamera();
    const vA = view("pane-a", tileA, pluginViewId("graph-fabric"));
    const vB = view("pane-b", tileB, "topology");

    for (let i = 0; i < FRAMES; i++) {
      host.present(vA, 0, sceneA, camera);
      host.present(vB, 0, sceneB, camera);
    }

    expect(events.filter((e) => e.type === "shader-failed" && e.tileId === "pane-a").length, "pane-a went cant-draw (shader-failed)").toBe(1);
    expect(lines().length, `"${PREFIX}" lines over ${FRAMES} frames`).toBe(1);
    expect(lines()[0]).toEqual([PREFIX, "view:graph-fabric", "failed to compile", "vertex", t.LOGS.vertex]);
    expect(lines().filter((args) => args[1] === "view:topology").length, "lines for the healthy tile").toBe(0);
    host.dispose();
  });

  it("a tile with a pack logs its pack id (not its view id), once", () => {
    const { host, tiles: [tileP] } = wallOf(1);
    if (!tileP) throw new Error("wall has no tiles");
    host.beginTilePack("pane-p", "star-sines", "star-sines", tileP, "Star sines", true);
    const scene = sceneWith("fragment");
    const camera = new THREE.PerspectiveCamera();
    const vP = view("pane-p", tileP, "plugin:star-sines");

    for (let i = 0; i < FRAMES; i++) host.present(vP, 0, scene, camera);

    expect(lines().length, `"${PREFIX}" lines over ${FRAMES} frames`).toBe(1);
    expect(lines()[0]).toEqual([PREFIX, "star-sines", "failed to compile", "fragment", t.LOGS.fragment]);
    host.dispose();
  });

  it("a link failure (both stages compiled): one line, failed to link program, the program log last", () => {
    const { host, tiles: [tileL] } = wallOf(1);
    if (!tileL) throw new Error("wall has no tiles");
    const scene = sceneWith("link");
    const camera = new THREE.PerspectiveCamera();
    const vL = view("pane-l", tileL, pluginViewId("graph-fabric"));

    for (let i = 0; i < FRAMES; i++) host.present(vL, 0, scene, camera);

    expect(lines().length, `"${PREFIX}" lines over ${FRAMES} frames`).toBe(1);
    expect(lines()[0]).toEqual([PREFIX, "view:graph-fabric", "failed to link", "program", t.LOGS.link]);
    host.dispose();
  });

  it("a healthy tile logs no line", () => {
    const { host, tiles: [tileH] } = wallOf(1);
    if (!tileH) throw new Error("wall has no tiles");
    const scene = sceneWith(null);
    const camera = new THREE.PerspectiveCamera();
    const vH = view("pane-h", tileH, pluginViewId("graph-fabric"));

    for (let i = 0; i < FRAMES; i++) host.present(vH, 0, scene, camera);

    expect(host.tileShaderDead("pane-h"), "pane-h's latch").toBe(false);
    expect(lines().length, `"${PREFIX}" lines for a healthy tile`).toBe(0);
    host.dispose();
  });
});
