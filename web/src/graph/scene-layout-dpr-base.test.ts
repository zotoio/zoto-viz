/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost } from "./render-host";
import { NetScene } from "./scene";
import { probeWebGL } from "./webgl";

const setPixelRatio = vi.fn();

vi.mock("./webgl", () => ({
  probeWebGL: vi.fn(() => true),
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
});
