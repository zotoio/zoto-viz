/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost } from "./render-host";
import { LookStage } from "./look";
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
  }
  return { ...orig, WebGLRenderer: WebGLRendererMock as unknown as typeof orig.WebGLRenderer };
});

describe("LookStage layout DPR resize", () => {
  beforeEach(() => {
    expect.hasAssertions();
    setPixelRatio.mockClear();
    vi.mocked(probeWebGL).mockReturnValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("resize passes capped layout DPR to WebGLRenderer.setPixelRatio", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 10 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 10 });
    document.body.appendChild(wall);
    const capHost = new RenderHost(wall, { software: true, maxLayoutDevicePxRatio: 1.25 });
    cancelAnimationFrame((capHost as unknown as { raf: number }).raf);

    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(host);

    const look = new LookStage(host);
    look.attach();
    expect(setPixelRatio).toHaveBeenCalledWith(1.25);
    look.dispose();
    capHost.dispose();
  });
});
