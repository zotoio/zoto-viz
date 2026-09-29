import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkyWaits, landWhenDrawn } from "../app/sky-wait";
import { skyStartingShown } from "./sky-starting-card";
import { SkyDrawnSignal } from "./sky-drawn";
import { DEFAULT_DREAM, NetScene } from "./scene";
import { RenderHost } from "./render-host";
import { PaneChangeProbe } from "./pane-change";
import { mosaicSceneOpts } from "./mosaic";

/**
 * Spy WebGL2 context for the production rows. three's WebGLRenderer is replaced (module mock) by a
 * stand-in whose `getContext()` returns this spy, so `RenderHost.gl`, `timeGpu` and anything in
 * `NetScene.present` that calls `this.renderer.getContext()` get it. Every GL method call is logged
 * with where it was made from; the GPU waits (finish, readPixels, fences, sync polls) are counted.
 */
const spy = vi.hoisted(() => {
  const STALLS = ["finish", "readPixels", "fenceSync", "clientWaitSync", "getSyncParameter"];
  const K: Record<string, number> = {
    TIMEOUT_EXPIRED: 0x911b, ALREADY_SIGNALED: 0x911a, CONDITION_SATISFIED: 0x911c, WAIT_FAILED: 0x911d,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117, PIXEL_PACK_BUFFER: 0x88eb, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    QUERY_RESULT: 0x8866, QUERY_RESULT_AVAILABLE: 0x8867, STREAM_READ: 0x88e1, FRAMEBUFFER: 0x8d40,
  };
  let nextConst = 0x10000;
  type Call = { name: string; args: unknown[]; inPresent: boolean; inPaneProbe: boolean; inSkyFrame: boolean };
  const state = { calls: [] as Call[], presentDepth: 0, paneProbeDepth: 0, skyFrameDepth: 0, renders: 0 };
  const impl: Record<string, (...a: unknown[]) => unknown> = {
    getExtension: (n) => (n === "EXT_disjoint_timer_query_webgl2" ? { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb } : null),
    createQuery: () => ({}),
    createBuffer: () => ({}),
    fenceSync: () => ({}),
    clientWaitSync: () => K.ALREADY_SIGNALED,
    getQueryParameter: (_q, p) => (p === K.QUERY_RESULT_AVAILABLE ? true : 1_000_000),
    getParameter: () => 0,
    isContextLost: () => false,
    getContextAttributes: () => ({ antialias: false }),
  };
  function makeGl(canvas: HTMLCanvasElement): WebGL2RenderingContext {
    const fns = new Map<string, (...a: unknown[]) => unknown>();
    const own: Record<string, unknown> = { canvas, drawingBufferWidth: 800, drawingBufferHeight: 600 };
    return new Proxy(own, {
      get(t, p) {
        if (typeof p !== "string") return undefined;
        if (p in t) return t[p];
        if (/^[A-Z][A-Z0-9_]*$/.test(p)) return (K[p] ??= nextConst++);
        let f = fns.get(p);
        if (!f) {
          const body = impl[p] ?? (() => undefined);
          f = (...args: unknown[]) => {
            state.calls.push({
              name: p, args, inPresent: state.presentDepth > 0, inPaneProbe: state.paneProbeDepth > 0,
              inSkyFrame: state.skyFrameDepth > 0,
            });
            return body(...args);
          };
          fns.set(p, f);
        }
        return f;
      },
    }) as unknown as WebGL2RenderingContext;
  }
  /** GPU-wait calls logged since call index `from`, by name, for the calls `filter` keeps. */
  function stalls(from: number, filter: (c: Call) => boolean): Record<string, number> {
    const out: Record<string, number> = Object.fromEntries(STALLS.map((n) => [n, 0]));
    for (const c of state.calls.slice(from)) if (STALLS.includes(c.name) && filter(c)) out[c.name]!++;
    return out;
  }
  return { state, makeGl, stalls, STALLS };
});

vi.mock("three", async (importOriginal) => {
  const THREE = await importOriginal<typeof import("three")>();
  /** Stand-in renderer: real canvas, spy GL, draws are counted no-ops (no three.js GL traffic). */
  class WebGLRenderer {
    readonly domElement = document.createElement("canvas");
    private readonly gl = spy.makeGl(this.domElement);
    debug = { checkShaderErrors: false };
    getContext() { return this.gl; }
    render() { spy.state.renders++; }
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

const OK_FRAG = `
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = mix(uBg, uAccent, 0.5 + 0.5 * dir.y);
  fragColor = vec4(col * uBright, uOpacity);
}
`;

function rect(el: Element, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () => ({
    x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}),
  }) as DOMRect;
}

type SceneInternals = { skyDrawn: SkyDrawnSignal };
const skyOf = (s: NetScene) => (s as unknown as SceneInternals).skyDrawn;

/**
 * The production wall: one RenderHost (shared spy GL) and NetScenes hosted on it, driven by the
 * browser's animation-frame queue (host frame → hostFrame → animate → present).
 */
function mountWall(panes: 1 | 4) {
  const raf: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { raf.push(cb); return raf.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
  document.body.append(wall);
  const host = new RenderHost(wall, { software: false, dpr: 1 });
  expect(host.software).toBe(false);
  rect(host.canvas, 0, 0, 800, 600);
  const scenes: { id: string; scene: NetScene; el: HTMLElement }[] = [];
  const boxes = panes === 1 ? [[0, 0, 800, 600]] : [[0, 0, 400, 300], [400, 0, 400, 300], [0, 300, 400, 300], [400, 300, 400, 300]];
  boxes.forEach(([x, y, w, h], i) => {
    const el = document.createElement("div");
    el.className = "scene";
    wall.append(el);
    rect(el, x!, y!, w!, h!);
    const id = i === 0 ? "main" : `p${i}`;
    const scene = new NetScene(el, i === 0 ? { host } : mosaicSceneOpts(id, host));
    scene.setActive(true);
    scene.setAnim({ ...DEFAULT_DREAM, backdrop: "plugin" });
    scenes.push({ id, scene, el });
  });
  let ts = 1000;
  /** One browser frame: run the queued animation-frame callbacks (the previous frame was presented). */
  const browserFrame = () => {
    ts += 16;
    for (const cb of raf.splice(0)) cb(ts);
  };
  return { host, scenes, browserFrame, rafQueued: () => raf.length };
}

const NO_WAITS = { finish: 0, readPixels: 0, fenceSync: 0, clientWaitSync: 0, getSyncParameter: 0 };
/** In `present()` but not inside the pane-change probe it calls last (notePaneChange). */
const presentOutsidePaneProbe = (c: { inPresent: boolean; inPaneProbe: boolean }) => c.inPresent && !c.inPaneProbe;

function waitFor(el: HTMLElement) {
  return new SkyWaits({ hostEl: () => el, name: () => "Backrooms", skyReady: () => false, retry: () => {} });
}

describe("NetScene.present on a spy GL (production path: RenderHost frame → animate → present → skyDrawn.frame)", () => {
  type Present = { present: (...a: unknown[]) => void };
  const presentOrig = (NetScene.prototype as unknown as Present).present;
  const tickOrig = PaneChangeProbe.prototype.tick;
  const frameOrig = SkyDrawnSignal.prototype.frame;
  /** skyDrawn.frame() calls made from inside NetScene.present, and from anywhere. */
  let skyFramesInPresent = 0;
  let skyFrames = 0;
  beforeEach(() => {
    spy.state.calls.length = 0;
    spy.state.renders = 0;
    skyFramesInPresent = 0;
    skyFrames = 0;
    // Pass-through wrappers: they only mark where a GL call was made from.
    vi.spyOn(NetScene.prototype as unknown as Present, "present").mockImplementation(function (this: NetScene, ...a: unknown[]) {
      spy.state.presentDepth++;
      try { presentOrig.apply(this, a); } finally { spy.state.presentDepth--; }
    });
    vi.spyOn(PaneChangeProbe.prototype, "tick").mockImplementation(function (this: PaneChangeProbe, ...a) {
      spy.state.paneProbeDepth++;
      try { tickOrig.apply(this, a); } finally { spy.state.paneProbeDepth--; }
    });
    vi.spyOn(SkyDrawnSignal.prototype, "frame").mockImplementation(function (this: SkyDrawnSignal) {
      skyFrames++;
      if (spy.state.presentDepth > 0) skyFramesInPresent++;
      spy.state.skyFrameDepth++;
      try { frameOrig.apply(this); } finally { spy.state.skyFrameDepth--; }
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("single view: 1 event after the frame is presented, listener removed, then 600 frames give 0 reads and 0 GPU waits in present()", () => {
    const { scenes, browserFrame } = mountWall(1);
    const { scene, el } = scenes[0]!;
    const waits = waitFor(el);
    let events = 0;
    scene.onPluginSkyDrawn(() => { events++; });
    waits.begin("main");
    expect(scene.setPluginShader({ id: "backrooms", source: OK_FRAG })).toBeNull();
    landWhenDrawn(waits, "main", scene, "backrooms");
    expect(skyOf(scene).listenerCount).toBe(2);
    browserFrame(); // draws with the sky; the event waits for the next animation frame
    expect(spy.state.renders).toBe(1);
    expect(events).toBe(0);
    expect(waits.state("main")).toBe("starting");
    expect(skyStartingShown(el)).toBe(true);
    browserFrame(); // the frame that drew the sky has been presented
    expect(events).toBe(1);
    expect(waits.state("main")).toBeNull();
    expect(scene.pluginSkyDrawn).toBe("backrooms");
    expect(skyOf(scene).listenerCount).toBe(1); // the wait's listener removed itself
    const checksAtReady = skyOf(scene).checks;
    const mark = spy.state.calls.length;
    const rendersAtReady = spy.state.renders;
    const inPresentAtReady = skyFramesInPresent;
    for (let i = 0; i < 600; i++) browserFrame();
    expect(spy.state.renders - rendersAtReady).toBe(600);
    expect(skyFramesInPresent - inPresentAtReady).toBe(600);
    expect(events).toBe(1);
    expect(skyOf(scene).checks - checksAtReady).toBe(0);
    expect(skyOf(scene).scheduled).toBe(1);
    expect(spy.stalls(mark, presentOutsidePaneProbe)).toEqual(NO_WAITS);
  });

  it("2x2 on one RenderHost: 4 one-shot events, 0 listeners, then 600 frames give 0 reads and 0 GPU waits in present()", () => {
    const { scenes, browserFrame } = mountWall(4);
    const waits = waitFor(scenes[0]!.el);
    for (const { id, scene } of scenes) {
      waits.begin(id);
      expect(scene.setPluginShader({ id: "backrooms", source: OK_FRAG })).toBeNull();
      landWhenDrawn(waits, id, scene, "backrooms");
    }
    browserFrame();
    expect(spy.state.renders).toBe(4);
    expect(waits.keys().length).toBe(4); // drawn, not yet presented: every pane keeps its card
    browserFrame();
    expect(waits.keys().length).toBe(0);
    expect(scenes.map(({ scene }) => skyOf(scene).checks)).toEqual([1, 1, 1, 1]);
    expect(scenes.map(({ scene }) => skyOf(scene).listenerCount)).toEqual([0, 0, 0, 0]);
    const mark = spy.state.calls.length;
    const rendersAtReady = spy.state.renders;
    const inPresentAtReady = skyFramesInPresent;
    for (let f = 0; f < 600; f++) browserFrame();
    expect(spy.state.renders - rendersAtReady).toBe(2400);
    expect(skyFramesInPresent - inPresentAtReady).toBe(2400);
    expect(scenes.map(({ scene }) => skyOf(scene).checks)).toEqual([1, 1, 1, 1]);
    expect(scenes.map(({ scene }) => skyOf(scene).scheduled)).toEqual([1, 1, 1, 1]);
    expect(scenes.every(({ scene }) => scene.pluginSkyDrawn === "backrooms")).toBe(true);
    expect(spy.stalls(mark, presentOutsidePaneProbe)).toEqual(NO_WAITS);
  });

  it("skyDrawn.frame() is only called from present(), once per presented frame, and makes no GL call", () => {
    const { scenes, browserFrame } = mountWall(1);
    const { scene } = scenes[0]!;
    expect(scene.setPluginShader({ id: "backrooms", source: OK_FRAG })).toBeNull();
    for (let i = 0; i < 602; i++) browserFrame();
    expect(spy.state.renders).toBe(602);
    expect(skyFrames).toBe(602);
    expect(skyFramesInPresent).toBe(602);
    expect(spy.state.calls.filter((c) => c.inSkyFrame).length).toBe(0);
  });

  it("the only reads in a frame are fenced pixel-pack-buffer reads polled with timeout 0; in present() only the pane-change probe reads", () => {
    const { scenes, browserFrame } = mountWall(1);
    const { scene } = scenes[0]!;
    expect(scene.setPluginShader({ id: "backrooms", source: OK_FRAG })).toBeNull();
    browserFrame();
    browserFrame();
    const mark = spy.state.calls.length;
    for (let i = 0; i < 600; i++) browserFrame();
    const calls = spy.state.calls.slice(mark);
    // Pane-change probe (notePaneChange, end of present): 3 rows + 3 columns per frame into a PBO,
    // one fence per frame, the previous fence polled with timeout 0.
    expect(spy.stalls(mark, (c) => c.inPaneProbe)).toEqual({
      finish: 0, readPixels: 3600, fenceSync: 600, clientWaitSync: 600, getSyncParameter: 0,
    });
    const all = spy.stalls(mark, () => true);
    expect(all.finish).toBe(0);
    expect(all.getSyncParameter).toBe(0);
    const reads = calls.filter((c) => c.name === "readPixels");
    expect(reads.every((c) => typeof c.args[6] === "number")).toBe(true); // PBO offset, never a CPU array
    const polls = calls.filter((c) => c.name === "clientWaitSync");
    expect(polls.every((c) => c.args[1] === 0 && c.args[2] === 0)).toBe(true);
  });
});

/**
 * Signal-only behaviour rows: SkyDrawnSignal on a stand-in render loop. They check the one-shot
 * and presentation-callback logic; they do not measure GPU waits (the rows above do, on the real
 * NetScene.present path).
 */
function tile() {
  let sky: string | null = null;
  let compilePending = false;
  let draws = 0;
  const raf: (() => void)[] = [];
  const sig = new SkyDrawnSignal(() => sky, (cb) => { raf.push(cb); });
  return {
    sig,
    install(id: string | null, pendingCompile = true) { sig.arm(id !== null); sky = id; compilePending = id !== null && pendingCompile; },
    showSky(id: string | null) { sky = id; },
    /** The render loop's frame: draw (queued, not executed), then the signal's hook. */
    draw() { draws++; sig.frame(); },
    compileDone() { compilePending = false; },
    /** The browser presents the frame and runs the next animation-frame callbacks, unless blocked. */
    present() {
      if (compilePending) return false;
      for (const cb of raf.splice(0)) cb();
      return true;
    },
    /** A whole frame: draw, then present if the GPU let it through. */
    frame() { this.draw(); this.present(); },
    rafQueued: () => raf.length,
    draws: () => draws,
    source: { get pluginSkyDrawn() { return sig.drawn(sky); }, onPluginSkyDrawn: (cb: (id: string) => void) => sig.on(cb) },
  };
}

describe("first-frame signal fires after presentation, not the draw (signal-only behaviour rows, stand-in loop)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a draw with the compile still pending keeps the card; it clears only once the frame is presented", () => {
    const t = tile();
    const pane = document.createElement("div");
    const waits = waitFor(pane);
    waits.begin("main");
    t.install("backrooms", true);
    landWhenDrawn(waits, "main", t.source, "backrooms");
    t.draw(); // first draw with the sky: queued behind the compile
    for (let i = 0; i < 5; i++) expect(t.present()).toBe(false);
    expect(waits.state("main")).toBe("starting");
    expect(skyStartingShown(pane)).toBe(true);
    expect(t.source.pluginSkyDrawn).toBeNull();
    t.compileDone();
    expect(t.present()).toBe(true);
    expect(waits.state("main")).toBeNull();
    expect(skyStartingShown(pane)).toBe(false); // fading
    expect(t.source.pluginSkyDrawn).toBe("backrooms");
  });

  it("signal only, single view: 600 frames after ready give 1 event, 0 reads, listener removed", () => {
    const t = tile();
    const pane = document.createElement("div");
    const waits = waitFor(pane);
    let events = 0;
    t.sig.on(() => { events++; });
    waits.begin("main");
    t.install("backrooms", false);
    landWhenDrawn(waits, "main", t.source, "backrooms");
    expect(t.sig.listenerCount).toBe(2);
    t.frame();
    expect(events).toBe(1);
    expect(waits.state("main")).toBeNull();
    expect(t.sig.listenerCount).toBe(1); // the wait's listener removed itself
    const checksAtReady = t.sig.checks;
    for (let i = 0; i < 600; i++) t.frame();
    expect(events).toBe(1);
    expect(t.sig.checks - checksAtReady).toBe(0);
    expect(t.sig.scheduled).toBe(1);
    expect(t.rafQueued()).toBe(0);
    expect(t.draws()).toBe(601);
  });

  it("signal only, 2x2: 4 panes give 4 one-shot events, then 0 reads, 0 listeners", () => {
    const tiles = [tile(), tile(), tile(), tile()];
    const pane = document.createElement("div");
    const waits = waitFor(pane);
    tiles.forEach((t, i) => {
      waits.begin(`p${i}`);
      t.install("backrooms", true);
      landWhenDrawn(waits, `p${i}`, t.source, "backrooms");
    });
    for (const t of tiles) t.draw();
    expect(waits.keys().length).toBe(4); // compiles pending: every pane keeps its card
    for (const t of tiles) { t.compileDone(); t.present(); }
    expect(waits.keys().length).toBe(0);
    expect(tiles.map((t) => t.sig.checks)).toEqual([1, 1, 1, 1]);
    expect(tiles.map((t) => t.sig.listenerCount)).toEqual([0, 0, 0, 0]);
    for (let f = 0; f < 600; f++) for (const t of tiles) t.frame();
    expect(tiles.map((t) => t.sig.checks)).toEqual([1, 1, 1, 1]);
    expect(tiles.map((t) => t.sig.scheduled)).toEqual([1, 1, 1, 1]);
    expect(tiles.every((t) => t.source.pluginSkyDrawn === "backrooms")).toBe(true);
  });

  it("a reinstall before presentation drops the old callback; the new install fires once", () => {
    const t = tile();
    let events = 0;
    t.sig.on(() => { events++; });
    t.install("backrooms", true);
    t.draw();
    t.install("backrooms", false); // Retry: new program
    t.present(); // the old install's callback runs and does nothing
    expect(events).toBe(0);
    t.frame();
    expect(events).toBe(1);
  });

  it("a clear reports nothing drawn and does no per-frame reads", () => {
    const t = tile();
    t.install("backrooms", false);
    t.frame();
    t.install(null);
    for (let i = 0; i < 600; i++) t.frame();
    expect(t.source.pluginSkyDrawn).toBeNull();
    expect(t.sig.checks).toBe(1);
  });

  it("installed before the backdrop switches to it: stays armed, fires on the first presented frame with it", () => {
    const t = tile();
    let events = 0;
    t.sig.on(() => { events++; });
    t.install("backrooms", false);
    t.showSky(null);
    t.frame();
    t.frame();
    expect(events).toBe(0);
    t.showSky("backrooms");
    for (let i = 0; i < 600; i++) t.frame();
    expect(events).toBe(1);
    expect(t.sig.checks).toBe(3);
  });

  it("scene hook: present() runs the signal after the render call", () => {
    const scene = readFileSync(resolve(__dirname, "scene.ts"), "utf8");
    const present = scene.slice(scene.indexOf("  private present("), scene.indexOf("  private notePaneChange("));
    expect(present).toContain("this.skyDrawn.frame();");
    expect(present.indexOf("this.skyDrawn.frame();")).toBeGreaterThan(present.indexOf("this.renderer.render("));
  });
});
