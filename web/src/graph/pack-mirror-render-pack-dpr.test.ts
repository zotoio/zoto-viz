import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PackMirrorRegistry } from "./pack-mirror-gl";
import { asCanvasDeviceHeight } from "./pack-mirror-rect";

describe("PackMirrorSession renderPack DPR", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("uses device-pixel viewport on the render target at layout dpr=2", () => {
    const reg = new PackMirrorRegistry();
    reg.syncScopes(new Map([["plugin:dpr", { tileCount: 2, antialias: false }]]));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const viewports: Array<{ w: number; h: number }> = [];
    const renderer = {
      setPixelRatio: vi.fn(),
      setClearColor: vi.fn(),
      setSize: vi.fn(),
      setScissorTest: vi.fn(),
      setScissor: vi.fn(( _x: number, _y: number, w: number, h: number) => { viewports.push({ w, h }); }),
      setViewport: vi.fn((_x: number, _y: number, w: number, h: number) => { viewports.push({ w, h }); }),
      setRenderTarget: vi.fn(),
      getRenderTarget: () => null,
      clear: vi.fn(),
      render: vi.fn(),
      getPixelRatio: () => 1,
      getContext: () => null,
      forceContextLoss: vi.fn(),
      dispose: vi.fn(),
    };
    const hostGl = {
      layoutPixelRatio: 2,
      canvasCssHeight: 120,
      canvasDeviceHeight: asCanvasDeviceHeight(240),
    };
    reg.renderPrimary("plugin:dpr", renderer as never, scene, camera, { x: 0, y: 0, w: 50, h: 40 }, 0x0a1020, false, hostGl);
    expect(viewports.some((v) => v.w === 100 && v.h === 80)).toBe(true);
    reg.dispose();
  });
});
