/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import * as dprMod from "./render-host-device-px-ratio";
import { Stage3D } from "../arcade/stage3d";
import type { NetScene } from "./scene";
import { RenderHost, type HostedView } from "./render-host";
import {
  DEFAULT_MAX_DEVICE_PX_RATIO,
  configureLayoutMaxDevicePxRatio,
  layoutBackingDevicePx,
  layoutDevicePxRatio,
  resetLayoutDevicePxRatioWatch,
} from "../../test-support/layout-device-px-ratio";
import { LiveFeed } from "../ui/feed";
import { mockPartial } from "../../test-support/mock-partial";
import { probeWebGL } from "./webgl";

const hostRaf = vi.hoisted(() => {
  const queue: FrameRequestCallback[] = [];
  let nextId = 1;
  const byId = new Map<number, FrameRequestCallback>();
  return {
    requestAnimationFrame(cb: FrameRequestCallback): number {
      const id = nextId++;
      byId.set(id, cb);
      queue.push(cb);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      const cb = byId.get(id);
      if (!cb) return;
      byId.delete(id);
      const i = queue.indexOf(cb);
      if (i >= 0) queue.splice(i, 1);
    },
    runNext(ts: number): void {
      const cb = queue.shift();
      if (!cb) return;
      for (const [id, fn] of byId) {
        if (fn === cb) byId.delete(id);
      }
      cb(ts);
    },
    hasPending(): boolean {
      return queue.length > 0;
    },
    clear(): void {
      queue.length = 0;
      byId.clear();
    },
  };
});

const dprGet = vi.hoisted(() => vi.fn(() => dprMedia.dpr));

const dprMedia = vi.hoisted(() => {
  let dpr = 1;
  let onChange: (() => void) | null = null;
  let armed = true;
  return {
    get dpr() {
      return dpr;
    },
    set dpr(n: number) {
      dpr = n;
    },
    matchMedia: vi.fn((_query: string) => {
      armed = true;
      return {
        matches: false,
        media: _query,
        addEventListener: (_type: string, fn: () => void) => {
          onChange = fn;
        },
        removeEventListener: (_type: string, fn: () => void) => {
          if (onChange === fn) onChange = null;
        },
        dispatchEvent: () => false,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
      };
    }),
    fireChange() {
      if (!armed) return;
      armed = false;
      onChange?.();
    },
    resetHandlers() {
      onChange = null;
      armed = true;
    },
  };
});

const { hostSetSizeLog, WebGLRendererMock } = vi.hoisted(() => {
  const hostSetSizeLog: { calls: number } = { calls: 0 };
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    setPixelRatio = vi.fn();
    setClearColor = vi.fn();
    setSize = vi.fn(() => {
      hostSetSizeLog.calls += 1;
    });
    setScissorTest = vi.fn();
    setScissor = vi.fn();
    setViewport = vi.fn();
    setRenderTarget = vi.fn();
    getRenderTarget = () => null;
    clear = vi.fn();
    render = vi.fn();
    getPixelRatio = () => 1;
    getContext = () => ({
      getContextAttributes: () => ({ antialias: false }),
      fenceSync: () => ({}),
      getExtension: () => null,
      viewport: vi.fn(),
      scissor: vi.fn(),
    });
    forceContextLoss = vi.fn();
    dispose = vi.fn();
  }
  return { hostSetSizeLog, WebGLRendererMock };
});

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  return { ...orig, WebGLRenderer: WebGLRendererMock as unknown as typeof orig.WebGLRenderer };
});

vi.mock("./webgl", () => ({
  probeWebGL: vi.fn(() => false),
}));

class TestStage3D extends Stage3D {
  readonly controls: HTMLElement[] = [];
  protected query() {
    return null;
  }
  protected ingest(): void {}
  protected step(): void {}
}

function sceneStub(): NetScene {
  return mockPartial<NetScene>({
    pulseNow: mockPartial<NetScene["pulseNow"]>({ level: 0, bass: 0 }),
    selectIp: () => {},
  });
}

function defineClientSize(el: HTMLElement, w: number, h: number): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: w });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: h });
}

type Fixture = {
  wall: HTMLElement;
  host: RenderHost;
  dispose: () => void;
  stage: TestStage3D;
  stageCanvas: HTMLCanvasElement;
  feedCanvas: HTMLCanvasElement;
  tickFrame: (ts: number) => void;
  hostSetSizeCalls: () => number;
  stageResizeCalls: () => number;
  feedResizeCalls: () => number;
  matchMediaCalls: () => number;
};

function mountThreeSurfaceFixture(initialDpr: number): Fixture {
  dprMedia.dpr = initialDpr;
  dprMedia.resetHandlers();
  dprGet.mockClear();
  dprMedia.matchMedia.mockClear();
  hostSetSizeLog.calls = 0;
  let stageResizeCalls = 0;
  let feedResizeCalls = 0;

  const wall = document.createElement("div");
  defineClientSize(wall, 200, 120);
  wall.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120, x: 0, y: 0, toJSON: () => ({}),
  });
  document.body.appendChild(wall);

  const stagePane = document.createElement("div");
  defineClientSize(stagePane, 100, 80);
  stagePane.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80, x: 0, y: 0, toJSON: () => ({}),
  });
  wall.appendChild(stagePane);

  const feedPane = document.createElement("div");
  defineClientSize(feedPane, 100, 80);
  wall.appendChild(feedPane);

  const host = new RenderHost(wall, { software: false });
  cancelAnimationFrame((host as unknown as { raf: number }).raf);
  hostRaf.clear();
  host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
  const hostFrame = (host as unknown as { frame: (ts: number) => void }).frame;

  const stage = new TestStage3D(stagePane, sceneStub());
  const canvas = document.createElement("canvas");
  const ctx = { setTransform: vi.fn() } as unknown as CanvasRenderingContext2D;
  vi.spyOn(canvas, "getContext").mockReturnValue(ctx);
  const stageInternal = stage as unknown as {
    canvas: HTMLCanvasElement | null;
    fallback: CanvasRenderingContext2D | null;
    fit(): void;
  };
  stageInternal.canvas = canvas;
  stageInternal.fallback = ctx;
  stagePane.appendChild(canvas);
  let lastStageW = -1;
  const stageCanvas = canvas;
  Object.defineProperty(stageCanvas, "width", {
    configurable: true,
    get() {
      return (canvas as unknown as { _w: number })._w ?? 0;
    },
    set(v: number) {
      if (v !== lastStageW) stageResizeCalls += 1;
      lastStageW = v;
      (canvas as unknown as { _w: number })._w = v;
    },
  });

  const feed = new LiveFeed(feedPane, sceneStub());
  // #198: with no `on` the feed is on and queues its own rAF loop. This fixture draws the bars from
  // hostFrame and counts per-frame work, so drop that one queued frame (nothing else is queued here).
  expect(hostRaf.hasPending()).toBe(false);
  feed.setConfig({ layout: "bars", modulate: false });
  hostRaf.clear();
  const barsWrap = feedPane.querySelector(".feed-bars") as HTMLElement;
  barsWrap.hidden = false;
  defineClientSize(barsWrap, 100, 80);
  const feedCanvas = feedPane.querySelector("canvas")!;
  let lastFeedW = -1;
  Object.defineProperty(feedCanvas, "width", {
    configurable: true,
    get() {
      return (feedCanvas as unknown as { _w: number })._w ?? 0;
    },
    set(v: number) {
      if (v !== lastFeedW) feedResizeCalls += 1;
      lastFeedW = v;
      (feedCanvas as unknown as { _w: number })._w = v;
    },
  });

  const stageFit = () => stageInternal.fit();
  const feedDraw = () => (feed as unknown as { drawBars(): void }).drawBars();

  host.add({
    viewEl: stagePane,
    hostFrame() {
      stageFit();
    },
    hostContextLost() {},
    hostContextRestored() {},
  });
  host.add({
    viewEl: feedPane,
    hostFrame() {
      feedDraw();
    },
    hostContextLost() {},
    hostContextRestored() {},
  });

  stageFit();
  feedDraw();
  dprMedia.matchMedia("(resolution: 1dppx)");
  const matchMediaBaseline = dprMedia.matchMedia.mock.calls.length;
  dprGet.mockClear();
  hostSetSizeLog.calls = 0;
  stageResizeCalls = 0;
  feedResizeCalls = 0;
  lastStageW = stageCanvas.width;
  lastFeedW = feedCanvas.width;

  return {
    wall,
    host,
    dispose: () => {
      feed.setConfig({ on: false }); // #198: the feed runs now; stop its poll interval with the fixture
      host.dispose();
    },
    stage,
    stageCanvas,
    feedCanvas,
    tickFrame: (ts) => {
      if (!hostRaf.hasPending()) requestAnimationFrame(hostFrame);
      hostRaf.runNext(ts);
    },
    hostSetSizeCalls: () => hostSetSizeLog.calls,
    stageResizeCalls: () => stageResizeCalls,
    feedResizeCalls: () => feedResizeCalls,
    matchMediaCalls: () => dprMedia.matchMedia.mock.calls.length - matchMediaBaseline,
  };
}

describe("layout DevicePxRatio getter (cached, matchMedia re-arm)", () => {
  let activeDispose: (() => void) | null = null;
  let getterSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    expect.hasAssertions();
    hostRaf.clear();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
    dprMedia.resetHandlers();
    dprGet.mockClear();
    getterSpy = vi.spyOn(dprMod, "layoutDevicePxRatio");
    vi.stubGlobal("requestAnimationFrame", hostRaf.requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", hostRaf.cancelAnimationFrame);
    vi.stubGlobal("matchMedia", dprMedia.matchMedia);
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      get: dprGet,
    });
  });

  afterEach(() => {
    activeDispose?.();
    activeDispose = null;
    getterSpy.mockRestore();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
  });

  it("(a) steady frames: 0 window reads and 0 setSize; 2 getter calls per frame", () => {
    const fx = mountThreeSurfaceFixture(2);
    activeDispose = fx.dispose;
    getterSpy.mockClear();
    dprGet.mockClear();
    const { tickFrame, hostSetSizeCalls, stageResizeCalls, feedResizeCalls, matchMediaCalls } = fx;
    for (let f = 0; f < 600; f++) tickFrame(f);
    expect(dprGet.mock.calls.length).toBe(0);
    expect(matchMediaCalls()).toBe(0);
    expect(hostSetSizeCalls()).toBe(0);
    expect(stageResizeCalls()).toBe(0);
    expect(feedResizeCalls()).toBe(0);
    expect(getterSpy.mock.calls.length).toBe(600 * 2);
    expect(layoutBackingDevicePx(100)).toBe(150);
  });

  it("(b) window DPR 1 → 2: 1 read, 1 re-arm, 1 resize per surface at ×1.5", () => {
    const fx = mountThreeSurfaceFixture(1);
    activeDispose = fx.dispose;
    dprGet.mockClear();
    dprMedia.dpr = 2;
    dprMedia.fireChange();
    expect(dprGet.mock.calls.length).toBe(1);
    expect(fx.matchMediaCalls()).toBe(1);
    expect(fx.hostSetSizeCalls()).toBe(1);
    expect(fx.stageResizeCalls()).toBe(1);
    expect(fx.feedResizeCalls()).toBe(1);
    expect(fx.stageCanvas.width).toBe(150);
    expect(fx.feedCanvas.width).toBe(150);
    expect(fx.host.pixelRatio).toBe(1.5);
  });

  it("(c) window DPR 2 → 1.5: 1 read, 1 re-arm, 0 resizes (cap still 1.5)", () => {
    const fx = mountThreeSurfaceFixture(2);
    activeDispose = fx.dispose;
    dprGet.mockClear();
    dprMedia.dpr = 1.5;
    dprMedia.fireChange();
    expect(dprGet.mock.calls.length).toBe(1);
    expect(fx.matchMediaCalls()).toBe(1);
    expect(fx.hostSetSizeCalls()).toBe(0);
    expect(fx.stageResizeCalls()).toBe(0);
    expect(fx.feedResizeCalls()).toBe(0);
    expect(fx.host.pixelRatio).toBe(1.5);
  });

  it("(d) window DPR 1.5 → 1: 1 read, 1 re-arm, 1 resize per surface at ×1.0", () => {
    dprMedia.dpr = 1.5;
    const fx = mountThreeSurfaceFixture(1.5);
    activeDispose = fx.dispose;
    hostSetSizeLog.calls = 0;
    dprGet.mockClear();
    dprMedia.dpr = 1;
    dprMedia.fireChange();
    expect(dprGet.mock.calls.length).toBe(1);
    expect(fx.matchMediaCalls()).toBe(1);
    expect(fx.hostSetSizeCalls()).toBe(1);
    expect(fx.stageResizeCalls()).toBe(1);
    expect(fx.feedResizeCalls()).toBe(1);
    expect(fx.stageCanvas.width).toBe(100);
    expect(fx.feedCanvas.width).toBe(100);
    expect(fx.host.pixelRatio).toBe(1);
  });

  it("(e) re-armed listener: second DPR change performs another window read", () => {
    const fx = mountThreeSurfaceFixture(1);
    activeDispose = fx.dispose;
    dprMedia.dpr = 2;
    dprMedia.fireChange();
    expect(dprGet.mock.calls.length).toBe(1);
    dprGet.mockClear();
    dprMedia.dpr = 1;
    dprMedia.fireChange();
    expect(dprGet.mock.calls.length).toBe(1);
  });
});
