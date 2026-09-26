import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PackMirrorRegistry } from "./pack-mirror-gl";

describe("PackMirrorSession renderPack DPR", () => {
  it("uses CSS-pixel viewport on the render target at dpr=2", () => {
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
      getPixelRatio: () => 2,
      getContext: () => null,
      forceContextLoss: vi.fn(),
      dispose: vi.fn(),
    };
    reg.renderPrimary("plugin:dpr", renderer as never, scene, camera, { w: 50, h: 40 }, 0x0a1020, false);
    expect(viewports.some((v) => v.w === 50 && v.h === 40)).toBe(true);
    reg.dispose();
  });
});
