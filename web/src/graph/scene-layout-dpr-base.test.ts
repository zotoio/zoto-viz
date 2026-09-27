/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import * as packMirrorRect from "./pack-mirror-rect";
import { PaneChangeProbe } from "./pane-change";
import { RenderHost } from "./render-host";
import { NetScene } from "./scene";
import { probeWebGL } from "./webgl";

const setPixelRatio = vi.fn();

vi.mock("./webgl", () => ({
  probeWebGL: vi.fn(() => true),
  disposeOwnedWebGLRenderer: vi.fn(),
}));

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    setPixelRatio = setPixelRatio;
    setSize = vi.fn();
    setClearColor = vi.fn();
    dispose = vi.fn();
    forceContextLoss = vi.fn();
    render = vi.fn();
    getContext = () => ({
      isContextLost: () => false,
      getContextAttributes: () => ({ antialias: false }),
      fenceSync: () => ({}),
      getExtension: () => null,
      deleteSync: () => {},
    });
    setRenderTarget = vi.fn();
    getRenderTarget = () => null;
    setViewport = vi.fn();
    setScissor = vi.fn();
    setScissorTest = vi.fn();
    clear = vi.fn();
    getPixelRatio = () => 1;
  }
  return { ...orig, WebGLRenderer: WebGLRendererMock as unknown as typeof orig.WebGLRenderer };
});

describe("NetScene layout DPR base", () => {
  beforeEach(() => {
    expect.hasAssertions();
    setPixelRatio.mockClear();
    vi.mocked(probeWebGL).mockReturnValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("own renderer uses RenderHost-capped layout DPR instead of legacy min(devicePixelRatio, 1.5)", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
    const capHost = new RenderHost(wall, { software: true, maxLayoutDevicePxRatio: 1.25 });
    cancelAnimationFrame((capHost as unknown as { raf: number }).raf);

    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 240 });
    document.body.appendChild(container);

    const scene = new NetScene(container, { satellite: false });
    expect(setPixelRatio).toHaveBeenCalledWith(1.25);
    scene.dispose();
    capHost.dispose();
  });

  it("hosted WebGL notePaneChange builds GlRect via toGlRectInto when lastVp is unset", () => {
    vi.spyOn(PaneChangeProbe.prototype, "tick").mockImplementation(() => {});
    const toGl = vi.spyOn(packMirrorRect, "toGlRectInto");
    vi.stubGlobal("devicePixelRatio", 1.5);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    wall.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120, x: 0, y: 0, toJSON: () => ({}),
    });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: false, maxLayoutDevicePxRatio: 1.5 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    vi.spyOn(host, "gl", "get").mockReturnValue({ drawingBufferWidth: 200, drawingBufferHeight: 150 } as WebGL2RenderingContext);

    const pane = document.createElement("div");
    Object.defineProperty(pane, "clientWidth", { configurable: true, value: 180 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 100 });
    pane.getBoundingClientRect = () => ({
      left: 10, top: 10, right: 190, bottom: 110, width: 180, height: 100, x: 10, y: 10, toJSON: () => ({}),
    });
    wall.appendChild(pane);

    const scene = new NetScene(pane, { host });
    (scene as unknown as { lastVp: unknown }).lastVp = packMirrorRect.viewMutAsDeviceRect({
      x: 0,
      y: 0,
      w: 64,
      h: 48,
    });
    (scene as unknown as { notePaneChange(): void }).notePaneChange();
    expect(toGl).toHaveBeenCalled();
    toGl.mockRestore();
    scene.dispose();
    host.dispose();
  });
});
