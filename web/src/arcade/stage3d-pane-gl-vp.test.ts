/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import * as packMirrorRect from "../graph/pack-mirror-rect";
import { PaneChangeProbe } from "../graph/pane-change";
import type { NetScene } from "../graph/scene";
import { probeWebGL } from "../graph/webgl";
import { Stage3D } from "./stage3d";

vi.mock("../graph/webgl", () => ({
  probeWebGL: vi.fn(() => true),
}));

vi.mock("../core/gpu-time", () => ({
  timeGpu: (_gl: WebGL2RenderingContext, draw: () => void) => draw(),
}));

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: 0 };
    outputColorSpace = "";
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    setClearColor = vi.fn();
    dispose = vi.fn();
    forceContextLoss = vi.fn();
    render = vi.fn();
    getContext = () => ({
      drawingBufferWidth: 200,
      drawingBufferHeight: 150,
      isContextLost: () => false,
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

class TestStage3D extends Stage3D {
  readonly controls: HTMLElement[] = [];
  protected query() { return null; }
  protected ingest(): void {}
  protected step(): void {}
}

function sceneStub(): NetScene {
  return { pulseNow: { level: 0, bass: 0 }, selectIp: () => {} } as NetScene;
}

describe("Stage3D pane GlRect viewport", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.mocked(probeWebGL).mockReturnValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("WebGL frame path builds GlRect via toGlRectInto for picture probe", () => {
    vi.spyOn(PaneChangeProbe.prototype, "tick").mockImplementation(() => {});
    const toGl = vi.spyOn(packMirrorRect, "toGlRectInto");
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(container);
    const stage = new TestStage3D(container, sceneStub());
    stage.start();
    (stage as unknown as { W: number; H: number }).W = 200;
    (stage as unknown as { W: number; H: number }).H = 120;
    (stage as unknown as { frame(ts: number): void }).frame(1000);
    expect(toGl).toHaveBeenCalled();
    toGl.mockRestore();
    stage.stop();
  });
});
