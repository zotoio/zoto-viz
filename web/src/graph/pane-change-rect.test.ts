import { appendFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetScene } from "./scene";
import { RenderHost } from "./render-host";
import { PaneChangeProbe, probeLines, type ProbeRect } from "./pane-change";
import { mosaicSceneOpts } from "./mosaic";
import { deviceRect } from "./pack-mirror-rect";
import { PaneFps } from "../core/fps";

/**
 * Spy WebGL2 context on a fake 800x600 framebuffer. three's WebGLRenderer is replaced (module mock)
 * by a stand-in whose `getContext()` returns this spy, so `RenderHost.gl` and `NetScene.notePaneChange`
 * get it. `readPixels` into a bound pixel-pack buffer snapshots the fake framebuffer (`state.pixel`)
 * into that buffer at the given offset; `getBufferSubData` copies it back out. Fences are signalled at
 * once, so the probe harvests every read on its next tick. Reads made inside `PaneChangeProbe.tick`
 * are logged with the probe that made them.
 */
const spy = vi.hoisted(() => {
  const K: Record<string, number> = {
    TIMEOUT_EXPIRED: 0x911b, ALREADY_SIGNALED: 0x911a, CONDITION_SATISFIED: 0x911c, WAIT_FAILED: 0x911d,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117, PIXEL_PACK_BUFFER: 0x88eb, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    QUERY_RESULT: 0x8866, QUERY_RESULT_AVAILABLE: 0x8867, STREAM_READ: 0x88e1, FRAMEBUFFER: 0x8d40,
  };
  let nextConst = 0x10000;
  type Read = { probe: object | null; x: number; y: number; w: number; h: number };
  const state = {
    reads: [] as Read[],
    probe: null as object | null,
    /** Fake framebuffer, GL coordinates (origin bottom-left): byte `c` of pixel (x, y). */
    pixel: (_x: number, _y: number, _c: number) => 0,
    packBound: null as object | null,
    pbos: new Map<object, Uint8Array>(),
    /** Last `renderer.setViewport` (GL bottom-left, renderer pixel ratio 1): where the host drew. */
    viewport: null as { x: number; y: number; w: number; h: number } | null,
  };
  const fill = (dst: Uint8Array, off: number, x: number, y: number, w: number, h: number) => {
    let i = off;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        for (let c = 0; c < 4; c++) {
          if (i < dst.length) dst[i] = state.pixel(xx, yy, c) & 255;
          i++;
        }
      }
    }
  };
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
    bindBuffer: (target, buf) => {
      if (target === K.PIXEL_PACK_BUFFER) state.packBound = (buf as object | null) ?? null;
    },
    bufferData: (target, size) => {
      if (target === K.PIXEL_PACK_BUFFER && state.packBound && typeof size === "number") {
        state.pbos.set(state.packBound, new Uint8Array(size));
      }
    },
    readPixels: (x, y, w, h, _f, _t, dst) => {
      const [rx, ry, rw, rh] = [x, y, w, h] as number[];
      if (state.probe) state.reads.push({ probe: state.probe, x: rx!, y: ry!, w: rw!, h: rh! });
      if (typeof dst === "number") {
        const pbo = state.packBound ? state.pbos.get(state.packBound) : undefined;
        if (pbo) fill(pbo, dst, rx!, ry!, rw!, rh!);
      } else if (ArrayBuffer.isView(dst)) {
        fill(new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength), 0, rx!, ry!, rw!, rh!);
      }
    },
    getBufferSubData: (target, srcOff, view) => {
      if (target !== K.PIXEL_PACK_BUFFER || !state.packBound || !ArrayBuffer.isView(view)) return;
      const pbo = state.pbos.get(state.packBound);
      if (!pbo) return;
      const out = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      out.set(pbo.subarray(srcOff as number, (srcOff as number) + out.length));
    },
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
          f = (...args: unknown[]) => body(...args);
          fns.set(p, f);
        }
        return f;
      },
    }) as unknown as WebGL2RenderingContext;
  }
  return { state, makeGl };
});

vi.mock("three", async (importOriginal) => {
  const THREE = await importOriginal<typeof import("three")>();
  /** Stand-in renderer: real canvas, spy GL, draws are no-ops (the fake framebuffer is the picture). */
  class WebGLRenderer {
    readonly domElement = document.createElement("canvas");
    private readonly gl = spy.makeGl(this.domElement);
    debug = { checkShaderErrors: false };
    getContext() { return this.gl; }
    render() {}
    compile() {}
    setClearColor() {}
    setPixelRatio() {}
    getPixelRatio() { return 1; }
    setSize(w: number, h: number) { this.domElement.width = w; this.domElement.height = h; }
    setScissorTest() {}
    setScissor() {}
    setViewport(x: number, y: number, w: number, h: number) { spy.state.viewport = { x, y, w, h }; }
    clear() {}
    dispose() {}
    forceContextLoss() {}
    forceContextRestore() {}
  }
  return { ...THREE, WebGLRenderer };
});

function rect(el: Element, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () => ({
    x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}),
  }) as DOMRect;
}

type Internals = { changeProbe: PaneChangeProbe; paneFps: PaneFps };
const internals = (s: NetScene) => s as unknown as Internals;

const BUF_W = 800;
const BUF_H = 600;

/**
 * One RenderHost (shared spy GL, 800x600 canvas) with NetScenes hosted on it, driven by the browser's
 * animation-frame queue (host frame → hostFrame → animate → present → notePaneChange).
 */
function mountWall(panes: 1 | 4) {
  const raf: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { raf.push(cb); return raf.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: BUF_W, configurable: true });
  Object.defineProperty(wall, "clientHeight", { value: BUF_H, configurable: true });
  document.body.append(wall);
  const host = new RenderHost(wall, { software: false, dpr: 1 });
  expect(host.software).toBe(false);
  rect(host.canvas, 0, 0, BUF_W, BUF_H);
  const scenes: { id: string; scene: NetScene }[] = [];
  const boxes = panes === 1
    ? [[0, 0, 800, 600]]
    : [[0, 0, 400, 300], [400, 0, 400, 300], [0, 300, 400, 300], [400, 300, 400, 300]];
  boxes.forEach(([x, y, w, h], i) => {
    const el = document.createElement("div");
    el.className = "scene";
    wall.append(el);
    rect(el, x!, y!, w!, h!);
    const id = i === 0 ? "main" : `p${i}`;
    const scene = new NetScene(el, i === 0 ? { host } : mosaicSceneOpts(id, host));
    scene.setActive(true);
    scenes.push({ id, scene });
  });
  let ts = 1000;
  let frame = 0;
  /** One browser frame: run the queued animation-frame callbacks. */
  const browserFrame = () => {
    ts += 16;
    frame++;
    for (const cb of raf.splice(0)) cb(ts);
  };
  return { host, scenes, browserFrame, frameNo: () => frame };
}

/** Set PANE_PROBE_REPORT=<file> to append the per-pane numbers the rows assert on to that file. */
const report = (label: string, v: unknown) => {
  const out = process.env.PANE_PROBE_REPORT;
  if (out) appendFileSync(out, `[pane-probe] ${label} ${JSON.stringify(v)}\n`);
};
const inside = (r: ProbeRect, box: ProbeRect) =>
  r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
const inBox = (x: number, y: number, box: ProbeRect) => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;

describe("pane-change probe on a shared RenderHost reads only its own pane (real NetScene/RenderHost, spy GL)", () => {
  type HostPresent = { present: (...a: unknown[]) => unknown };
  const tickOrig = PaneChangeProbe.prototype.tick;
  const presentOrig = (RenderHost.prototype as unknown as HostPresent).present;
  const markOrig = PaneFps.prototype.mark;
  /** Per view: the GL box host.present drew it into (its setViewport), and a copy of the viewport it returned. */
  let hostBoxes: Map<object, ProbeRect>;
  let returned: Map<object, ProbeRect>;
  let marks: Map<PaneFps, number>;
  beforeEach(() => {
    spy.state.reads.length = 0;
    spy.state.probe = null;
    spy.state.pbos.clear();
    spy.state.packBound = null;
    hostBoxes = new Map();
    returned = new Map();
    marks = new Map();
    vi.spyOn(PaneChangeProbe.prototype, "tick").mockImplementation(function (this: PaneChangeProbe, ...a) {
      const outer = spy.state.probe;
      spy.state.probe = this;
      try { tickOrig.apply(this, a); } finally { spy.state.probe = outer; }
    });
    vi.spyOn(RenderHost.prototype as unknown as HostPresent, "present").mockImplementation(function (this: RenderHost, ...a: unknown[]) {
      spy.state.viewport = null;
      const vp = presentOrig.apply(this, a) as ProbeRect | null;
      if (spy.state.viewport) hostBoxes.set(a[0] as object, { ...spy.state.viewport });
      if (vp) returned.set(a[0] as object, { x: vp.x, y: vp.y, w: vp.w, h: vp.h });
      return vp;
    });
    vi.spyOn(PaneFps.prototype, "mark").mockImplementation(function (this: PaneFps, ts: number) {
      marks.set(this, (marks.get(this) ?? 0) + 1);
      markOrig.call(this, ts);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  /** Pane `moving` changes every frame; every other pixel of the canvas is constant. */
  function movingPane(moving: () => ProbeRect | undefined, frameNo: () => number) {
    spy.state.pixel = (x, y, c) => {
      const box = moving();
      if (box && inBox(x, y, box)) return x + y * 3 + c + frameNo() * 7;
      return x * 3 + y * 5 + c * 11;
    };
  }

  const N = 60;

  it("2x2: every rect a pane's probe reads lies inside that pane's own viewport (the box host.present drew it into)", () => {
    const { scenes, browserFrame, frameNo } = mountWall(4);
    const a = scenes[0]!.scene;
    movingPane(() => hostBoxes.has(a) ? hostBoxes.get(a)! : undefined, frameNo);
    for (let i = 0; i < 3; i++) browserFrame();
    const from = spy.state.reads.length;
    for (let i = 0; i < N; i++) browserFrame();
    const reads = spy.state.reads.slice(from);
    const rows = scenes.map(({ id, scene }) => {
      const box = hostBoxes.get(scene)!;
      const mine = reads.filter((r) => r.probe === internals(scene).changeProbe);
      const outside = mine.filter((r) => !inside(r, box));
      const { x, y, w, h } = outside[0] ?? { x: 0, y: 0, w: 0, h: 0 };
      return {
        id, box, returned: returned.get(scene), reads: mine.length, outside: outside.length,
        firstOutside: outside.length ? { x, y, w, h } : null,
      };
    });
    report("2x2 rects", rows);
    // Every read in the window was made by one of the four panes' probes.
    expect(rows.reduce((n, r) => n + r.reads, 0)).toBe(reads.length);
    expect(rows.map((r) => r.reads)).toEqual([6 * N, 6 * N, 6 * N, 6 * N]);
    // Viewports of the 2x2 in GL (bottom-left) pixels.
    expect(rows.map((r) => r.box)).toEqual([
      { x: 0, y: 300, w: 400, h: 300 }, { x: 400, y: 300, w: 400, h: 300 },
      { x: 0, y: 0, w: 400, h: 300 }, { x: 400, y: 0, w: 400, h: 300 },
    ]);
    expect(rows.map(({ id, outside }) => ({ id, outside }))).toEqual(
      scenes.map(({ id }) => ({ id, outside: 0 })),
    );
  });

  it(`2x2: over ${N} frames the still pane gets 0 paneFps marks while the moving pane gets >= ${N - 3}`, () => {
    const { scenes, browserFrame, frameNo } = mountWall(4);
    const a = scenes[0]!.scene;
    movingPane(() => hostBoxes.has(a) ? hostBoxes.get(a)! : undefined, frameNo);
    for (let i = 0; i < 3; i++) browserFrame();
    const fps = scenes.map(({ scene }) => internals(scene).paneFps);
    const before = fps.map((f) => marks.get(f) ?? 0);
    const serialBefore = scenes.map(({ scene }) => scene.pictureSerial);
    for (let i = 0; i < N; i++) browserFrame();
    const got = fps.map((f, i) => (marks.get(f) ?? 0) - before[i]!);
    const serial = scenes.map(({ scene }, i) => scene.pictureSerial - serialBefore[i]!);
    report("2x2 marks", { N, main: got[0], p1: got[1], p2: got[2], p3: got[3] });
    expect(serial).toEqual(got); // every mark counted a picture change
    expect(got[0]).toBeGreaterThanOrEqual(N - 3); // moving pane (main, top-left)
    expect({ p1: got[1], p2: got[2], p3: got[3] }).toEqual({ p1: 0, p2: 0, p3: 0 }); // still panes
  });

  it("single view: the probe reads the full-canvas lines (its viewport is the whole canvas) and counts a moving picture", () => {
    const { scenes, browserFrame, frameNo } = mountWall(1);
    const s = scenes[0]!.scene;
    movingPane(() => hostBoxes.has(s) ? hostBoxes.get(s)! : undefined, frameNo);
    for (let i = 0; i < 3; i++) browserFrame();
    const from = spy.state.reads.length;
    const fps = internals(s).paneFps;
    const before = marks.get(fps) ?? 0;
    for (let i = 0; i < N; i++) browserFrame();
    expect(hostBoxes.get(s)!).toEqual({ x: 0, y: 0, w: BUF_W, h: BUF_H });
    const reads = spy.state.reads.slice(from).map(({ x, y, w, h }) => ({ x, y, w, h }));
    const full = probeLines({ x: 0, y: 0, w: BUF_W, h: BUF_H }, BUF_W, BUF_H);
    report("single view", { reads: reads.length, marks: (marks.get(fps) ?? 0) - before, box: hostBoxes.get(s) });
    expect(reads).toEqual(Array.from({ length: N }, () => full).flat());
    expect((marks.get(fps) ?? 0) - before).toBeGreaterThanOrEqual(N - 3);
  });
  it("hosted WebGL notePaneChange (scene-layout-dpr-base setup): tick gets the GL rect of the 64x48 lastVp, not the 200x150 buffer", () => {
    const ticks: ProbeRect[] = [];
    vi.mocked(PaneChangeProbe.prototype.tick).mockImplementation((_gl, vp) => { ticks.push({ x: vp.x, y: vp.y, w: vp.w, h: vp.h }); });
    vi.stubGlobal("devicePixelRatio", 1.5);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    rect(wall, 0, 0, 200, 120);
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: false, maxLayoutDevicePxRatio: 1.5 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    vi.spyOn(host, "gl", "get").mockReturnValue({ drawingBufferWidth: 200, drawingBufferHeight: 150 } as WebGL2RenderingContext);
    const pane = document.createElement("div");
    Object.defineProperty(pane, "clientWidth", { configurable: true, value: 180 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 100 });
    rect(pane, 10, 10, 180, 100);
    wall.appendChild(pane);
    const scene = new NetScene(pane, { host });
    // What host.present returns: a framebuffer viewport tagged as a device rect.
    (scene as unknown as { lastVp: unknown }).lastVp = deviceRect(0, 0, 64, 48);
    (scene as unknown as { notePaneChange(): void }).notePaneChange();
    report("dpr-base tick rect", ticks);
    expect(ticks).toHaveLength(1);
    const vp = ticks[0]!;
    // The pane's 64x48, not the whole 200x150 buffer. Its bottom edge is 0 or 102 depending on which
    // corner lastVp's y counts from; the 2x2 rows pin the orientation against where the host drew.
    expect({ x: vp.x, w: vp.w, h: vp.h }).toEqual({ x: 0, w: 64, h: 48 });
    expect([0, 150 - 48]).toContain(vp.y);
    scene.dispose();
    host.dispose();
  });
});
