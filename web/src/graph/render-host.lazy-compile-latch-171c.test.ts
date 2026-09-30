/**
 * #171 (c) item 2: the graph fabric's material compiles lazily inside `renderer.render()` (fabric.ts,
 * MeshStandardMaterial + onBeforeCompile), with no plugin sky and so no probe compile. RenderHost puts the
 * drawn tile's own `renderer.debug.onShaderError` hook on the renderer around that tile's render, so a lazy
 * compile failure trips that tile's latch and the tile goes cant-draw ("Graph cloth couldn't draw."), while
 * the next tile drawn is untouched.
 *
 * three's WebGLRenderer is module-mocked by a stand-in whose `render()` does what three does when a program
 * fails and `debug.checkShaderErrors` is on: it calls `debug.onShaderError` (here on every render of the broken
 * scene, worse than three's once per program, so "trips once" is the latch's doing). RenderHost's own GL setup
 * (`software: false`) builds and configures that instance; the row reads it back. Counts only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost, type HostedView, type TileDrawEvent } from "./render-host";
import { GraphFabric } from "./fabric";
import { bindCantDrawViewState } from "../app/cant-draw-state";
import { bindCantDrawSurface } from "../app/cant-draw-surface";
import { resetViewStatesForTests, setViewState, viewStateOf } from "../app/view-state";

type FakeGl = { isContextLost(): boolean; getShaderInfoLog(s: object): string; getProgramInfoLog(p: object): string };
type Hook = ((gl: FakeGl, program: object, vs: object, fs: object) => void) | null;

const t = vi.hoisted(() => {
  /** Every stand-in renderer constructed (RenderHost's own). */
  const renderers: Array<{ debug: { checkShaderErrors: boolean; onShaderError: Hook } }> = [];
  /** Each render: the scene drawn and the hook on the renderer while it drew. */
  const renders: Array<{ scene: object; hook: Hook }> = [];
  /** Materials whose (lazy) compile fails on the GPU. */
  const broken = new Set<unknown>();
  return { renderers, renders, broken };
});

vi.mock("three", async (importOriginal) => {
  const THREE = await importOriginal<typeof import("three")>();
  class Gl {
    constructor() {
      // GL calls the host makes that this row doesn't care about: no-ops handing back null.
      return new Proxy(this, { get: (target, key, recv) => (key in target ? Reflect.get(target, key, recv) : () => null) });
    }
    isContextLost(): boolean { return false; }
    getExtension(): null { return null; }
    getContextAttributes(): { antialias: boolean } { return { antialias: false }; }
    getShaderInfoLog(): string { return "ERROR: 0:442: 'uBroken' : undeclared identifier"; }
    getProgramInfoLog(): string { return ""; }
  }
  class WebGLRenderer {
    readonly domElement = document.createElement("canvas");
    private readonly gl = new Gl();
    /** three's default (`{ checkShaderErrors: true, onShaderError: null }`). */
    debug: { checkShaderErrors: boolean; onShaderError: Hook } = { checkShaderErrors: true, onShaderError: null };
    constructor() { t.renderers.push(this); }
    getContext() { return this.gl; }
    render(scene: THREE.Object3D) {
      t.renders.push({ scene, hook: this.debug.onShaderError });
      let fails = false;
      scene.traverseVisible((o) => { if (o instanceof THREE.Mesh && t.broken.has(o.material)) fails = true; });
      if (fails && this.debug.checkShaderErrors) this.debug.onShaderError?.(this.gl, {}, {}, {});
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

function rect(el: Element, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () => DOMRect.fromRect({ x, y, width: w, height: h });
}

/** Computed visibility now (happy-dom caches computed style across ancestor attribute changes: read a fresh clone). */
function visibilityNow(el: Element): string {
  const probe = el.cloneNode(true);
  el.after(probe);
  const vis = probe instanceof Element ? getComputedStyle(probe).visibility : "";
  probe.parentNode?.removeChild(probe);
  return vis;
}

/** A tile's floating graph label, where NetScene's LabelLayer puts them (inside the tile). */
function graphLabel(tile: HTMLElement): HTMLElement {
  const layer = document.createElement("div");
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = "192.168.1.1";
  layer.appendChild(label);
  tile.appendChild(layer);
  return label;
}

const visibleLabels = (tile: HTMLElement) => [...tile.querySelectorAll(".label")].filter((l) => visibilityNow(l) !== "hidden").length;

const view = (tileId: string, viewEl: HTMLElement): HostedView => ({
  viewEl, tileId, hostFrame() {}, hostContextLost() {}, hostContextRestored() {},
});

describe("#171 (c) item 2: a lazy compile failure inside a tile's render trips that tile's latch", () => {
  const unbind: Array<() => void> = [];

  beforeEach(() => {
    expect.hasAssertions();
    t.renderers.length = 0;
    t.renders.length = 0;
    t.broken.clear();
  });

  afterEach(() => {
    for (const u of unbind.splice(0)) u();
    resetViewStatesForTests();
    document.body.replaceChildren();
    document.head.querySelectorAll("style[data-row-171c2]").forEach((s) => s.remove());
  });

  it("broken Graph cloth fabric (no plugin sky): latch trips once, tile shows couldn't-draw, labels hidden; healthy tile and its hook untouched (#171 c)", () => {
    const css = document.createElement("style");
    css.dataset.row171c2 = "";
    css.textContent = readFileSync(resolve(import.meta.dirname, "../style.css"), "utf8");
    document.head.appendChild(css);

    const wall = document.createElement("div");
    const tileA = document.createElement("div");
    const tileB = document.createElement("div");
    tileA.className = "mosaic-pane";
    tileB.className = "mosaic-pane";
    wall.append(tileA, tileB);
    document.body.appendChild(wall);
    rect(wall, 0, 0, 800, 600);
    rect(tileA, 0, 0, 400, 600);
    rect(tileB, 400, 0, 400, 600);

    const host = new RenderHost(wall, { software: false, dpr: 1 });
    rect(host.canvas, 0, 0, 800, 600);
    // The renderer RenderHost built and configured (its real GL setup path), read back after that setup.
    expect(t.renderers.length, "RenderHost built one GL renderer").toBe(1);
    const [rd] = t.renderers;
    if (!rd) throw new Error("RenderHost built no GL renderer");
    expect(host.renderer, "the host draws with the renderer it built").toBe(rd);
    expect(rd.debug.checkShaderErrors, "three reports shader errors on the host's renderer").toBe(true);

    const events: TileDrawEvent[] = [];
    unbind.push(host.onDrawEvent((e) => events.push(e)));
    unbind.push(bindCantDrawViewState(host));
    // main.ts's resolver: the view's pack name, else the pack id.
    unbind.push(bindCantDrawSurface((viewId, packId) => (viewId === "plugin:graph-fabric" ? "Graph cloth" : packId)));
    setViewState("pane-a", "plugin:graph-fabric", { kind: "ready" }, tileA);
    setViewState("pane-b", "plugin:topology-demo", { kind: "ready" }, tileB);
    graphLabel(tileA);
    graphLabel(tileB);
    expect(visibleLabels(tileA), "pane-a's label shows before the failure").toBe(1);

    // Tile A: the graph fabric, built-in sky (no plugin sky, no probe compile). Its lazy compile fails.
    const fabric = new GraphFabric();
    fabric.mesh.visible = true;
    t.broken.add(fabric.mesh.material);
    const sceneA = new THREE.Scene();
    sceneA.add(fabric.mesh);
    const sceneB = new THREE.Scene();
    sceneB.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    const camera = new THREE.PerspectiveCamera();
    const vA = view("pane-a", tileA);
    const vB = view("pane-b", tileB);

    const FRAMES = 6;
    let hookLeftOn = 0;
    for (let i = 0; i < FRAMES; i++) {
      host.present(vA, 0, sceneA, camera);
      if (rd.debug.onShaderError !== null) hookLeftOn++;
      host.present(vB, 0, sceneB, camera);
      if (rd.debug.onShaderError !== null) hookLeftOn++;
    }

    const failed = (id: string) => events.filter((e) => e.type === "shader-failed" && e.tileId === id).length;
    expect(failed("pane-a"), "shader-failed events for the broken fabric tile").toBe(1);
    expect(host.tileShaderDead("pane-a"), "pane-a's latch is tripped").toBe(true);

    const hooksA = new Set(t.renders.filter((r) => r.scene === sceneA).map((r) => r.hook));
    const hooksB = new Set(t.renders.filter((r) => r.scene === sceneB).map((r) => r.hook));
    expect(t.renders.filter((r) => r.scene === sceneA).length, "pane-a renders").toBe(FRAMES);
    expect(t.renders.filter((r) => r.scene === sceneB).length, "pane-b renders").toBe(FRAMES);
    expect(hooksA.size, "one hook object for pane-a on every frame").toBe(1);
    expect(hooksB.size, "one hook object for pane-b on every frame").toBe(1);
    expect(hooksA.has(null) || hooksB.has(null), "a tile rendered with no hook on").toBe(false);
    expect([...hooksA][0] === [...hooksB][0], "pane-a and pane-b share a hook").toBe(false);
    expect(hookLeftOn, "renders that left a tile's hook on the renderer").toBe(0);

    // The broken tile: cant-draw / shader, the existing couldn't-draw line, no labels over it.
    expect(viewStateOf("pane-a")?.kind, "pane-a view state").toBe("cant-draw");
    expect(tileA.querySelectorAll(":scope > .tile-cant-draw").length, "pane-a couldn't-draw surfaces").toBe(1);
    expect(tileA.querySelector(":scope > .tile-cant-draw")?.textContent ?? "").toContain("Graph cloth couldn't draw.");
    expect(visibleLabels(tileA), "visible .label nodes over pane-a's fallback").toBe(0);

    // The healthy tile: its hook was on for every render, nothing failed, nothing mounted.
    expect(failed("pane-b"), "shader-failed events for the healthy tile").toBe(0);
    expect(host.tileShaderDead("pane-b"), "pane-b's latch").toBe(false);
    expect(viewStateOf("pane-b")?.kind, "pane-b view state").toBe("ready");
    expect(tileB.querySelectorAll(".tile-cant-draw, .tile-shader-fallback").length, "fallbacks on pane-b").toBe(0);
    expect(visibleLabels(tileB), "pane-b's label still shows").toBe(1);

    host.dispose();
  });
});
