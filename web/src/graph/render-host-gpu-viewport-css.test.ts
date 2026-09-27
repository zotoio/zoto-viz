/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost, type HostedView } from "./render-host";
import { deviceRectFromHostViewBoxInto, toGlRectInto, asCanvasDeviceHeight } from "./pack-mirror-rect";
import {
  DEFAULT_MAX_DEVICE_PX_RATIO,
  configureLayoutMaxDevicePxRatio,
  resetLayoutDevicePxRatioWatch,
} from "../../test-support/layout-device-px-ratio";

/** GL viewport/scissor for the standard tile at layout pr 1.5 (device H 180). */
export const EXPECTED_TILE_GL_VIEWPORT = [2, 87, 151, 91] as const;

const { glLog, WebGLRendererMock } = vi.hoisted(() => {
  const glLog = {
    viewport: [] as number[][],
    scissor: [] as number[][],
  };
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    private ratio = 1;
    setPixelRatio = vi.fn((n: number) => {
      this.ratio = n;
    });
    setClearColor = vi.fn();
    setSize = vi.fn((w: number, h: number) => {
      this.domElement.width = w;
      this.domElement.height = h;
    });
    setScissorTest = vi.fn();
    setScissor = vi.fn((x: number, y: number, w: number, h: number) => {
      const pr = this.ratio;
      this.getContext().scissor(
        Math.round(x * pr),
        Math.round(y * pr),
        Math.round(w * pr),
        Math.round(h * pr),
      );
    });
    setViewport = vi.fn((x: number, y: number, w: number, h: number) => {
      const pr = this.ratio;
      this.getContext().viewport(
        Math.round(x * pr),
        Math.round(y * pr),
        Math.round(w * pr),
        Math.round(h * pr),
      );
    });
    setRenderTarget = vi.fn();
    getRenderTarget = () => null;
    clear = vi.fn();
    render = vi.fn();
    getPixelRatio = () => this.ratio;
    getContext = () => ({
      getContextAttributes: () => ({ antialias: false }),
      fenceSync: () => ({}),
      getExtension: () => null,
      viewport: (...args: number[]) => {
        glLog.viewport.push(args);
      },
      scissor: (...args: number[]) => {
        glLog.scissor.push(args);
      },
    });
    forceContextLoss = vi.fn();
    dispose = vi.fn();
  }
  return { glLog, WebGLRendererMock };
});

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  return { ...orig, WebGLRenderer: WebGLRendererMock as unknown as typeof orig.WebGLRenderer };
});

function expectedGlViewportForTile(layoutPr: number, canvasCssH: number): readonly number[] {
  const dev = { x: 0, y: 0, w: 0, h: 0 };
  const box = { x: 1, y: 58, w: 101, h: 61 };
  const devH = Math.round(canvasCssH * layoutPr);
  deviceRectFromHostViewBoxInto(box, false, canvasCssH, layoutPr, dev, asCanvasDeviceHeight(devH));
  const gl = { x: 0, y: 0, w: 0, h: 0 };
  toGlRectInto(dev as never, asCanvasDeviceHeight(devH), gl);
  return [gl.x, gl.y, gl.w, gl.h];
}

function mountGpuViewportFixture(dpr: number | "window"): {
  wall: HTMLElement;
  host: RenderHost;
  view: HostedView;
  layoutPr: number;
} {
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
  Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
  wall.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120, x: 0, y: 0, toJSON: () => ({}),
  });
  document.body.appendChild(wall);
  const pane = document.createElement("div");
  pane.getBoundingClientRect = () => ({
    left: 1, top: 1, right: 102, bottom: 62, width: 101, height: 61, x: 1, y: 1, toJSON: () => ({}),
  });
  wall.appendChild(pane);
  const host =
    dpr === "window"
      ? new RenderHost(wall, { software: false })
      : new RenderHost(wall, { software: false, dpr });
  host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
  const view: HostedView = {
    viewEl: pane,
    hostFrame() {},
    hostContextLost() {},
    hostContextRestored() {},
  };
  host.add(view);
  return { wall, host, view, layoutPr: host.pixelRatio };
}

describe("RenderHost GPU viewport (device rect, renderer pr 1)", () => {
  let wall: HTMLElement;
  let host: RenderHost;
  let view: HostedView;

  beforeEach(() => {
    expect.hasAssertions();
    glLog.viewport.length = 0;
    glLog.scissor.length = 0;
  });

  afterEach(() => {
    host?.dispose();
    wall?.remove();
    vi.unstubAllGlobals();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
  });

  it("setup: WebGLRenderer getPixelRatio is always 1", () => {
    ({ wall, host, view } = mountGpuViewportFixture(1.5));
    const rd = host.renderer as THREE.WebGLRenderer;
    expect(rd.getPixelRatio()).toBe(1);
    expect(host.pixelRatio).toBe(1.5);
  });

  it("gl.viewport and gl.scissor match converter device rect at layout pr 1.5", () => {
    ({ wall, host, view } = mountGpuViewportFixture(1.5));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    host.present(view, 0x0a1020, scene, camera);
    const expected = expectedGlViewportForTile(1.5, 120);
    expect(expected).toEqual(EXPECTED_TILE_GL_VIEWPORT);
    const lastVp = glLog.viewport.at(-1)!;
    const lastSc = glLog.scissor.at(-1)!;
    expect(lastVp).toEqual([...EXPECTED_TILE_GL_VIEWPORT]);
    expect(lastSc).toEqual([...EXPECTED_TILE_GL_VIEWPORT]);
  });

  it("gl.viewport and gl.scissor match converter at window devicePixelRatio 2 with layout pr capped at 1.5", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const mounted = mountGpuViewportFixture("window");
    ({ wall, host, view } = mounted);
    expect(host.pixelRatio).toBe(1.5);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    host.present(view, 0x0a1020, scene, camera);
    const expected = expectedGlViewportForTile(1.5, 120);
    expect(glLog.viewport.at(-1)).toEqual([...expected]);
    expect(glLog.scissor.at(-1)).toEqual([...expected]);
  });
});
