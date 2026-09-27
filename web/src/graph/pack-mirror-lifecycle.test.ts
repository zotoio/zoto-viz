import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  PACK_MSAA_SAMPLES,
  PackMirrorRegistry,
  PackMirrorSession,
  PackTexturePresenter,
  packMirrorResourceStats,
} from "./pack-mirror-gl";
import { packMirrorSizeStats } from "./pack-mirror-size-stats";
import { asCanvasDeviceHeight, asCssRect, type CssRectLoose } from "./pack-mirror-rect";
import type { PackMirrorHostGl } from "./pack-mirror-gl";
import { getSurfaceLetterboxFill, letterboxFillStats } from "./letterbox-fill";

function stubRenderer(antialias: boolean, pr = 1): THREE.WebGLRenderer {
  const rd = {
    getPixelRatio: () => pr,
    setRenderTarget: vi.fn(),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    setClearColor: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    getContext: () => ({ getContextAttributes: () => ({ antialias }) }),
    getRenderTarget: () => null,
  };
  return rd as unknown as THREE.WebGLRenderer;
}

function emptyScene(): { scene: THREE.Scene; camera: THREE.Camera } {
  return { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() };
}

const lifecycleLetterboxFill = getSurfaceLetterboxFill(0x0a1020, 0.25);

function testHostGl(layoutPixelRatio = 1, canvasCssHeight = 120): PackMirrorHostGl {
  return {
    layoutPixelRatio,
    canvasCssHeight,
    canvasDeviceHeight: asCanvasDeviceHeight(Math.max(1, Math.round(canvasCssHeight * layoutPixelRatio))),
  };
}

function simulateTwoTileFrame(
  reg: PackMirrorRegistry,
  rd: THREE.WebGLRenderer,
  key: string,
  antialias: boolean,
  box: CssRectLoose = { x: 0, y: 0, w: 64, h: 48 },
  hostGl = testHostGl(1),
): void {
  reg.beginFrame();
  const { scene, camera } = emptyScene();
  reg.renderPrimary(key, rd, scene, camera, box, 0x0a1020, antialias, hostGl);
  reg.presentPack(key, rd, asCssRect({ x: 0, y: 0, w: box.w, h: box.h }), {
    letterbox: false,
    fill: null,
    aspect: box.w / box.h,
  }, hostGl);
  reg.presentPack(key, rd, asCssRect({ x: 80, y: 0, w: 90, h: 70 }), {
    letterbox: true,
    fill: lifecycleLetterboxFill,
    aspect: box.w / box.h,
  }, hostGl);
}

function simulateThreeTileFrame(
  reg: PackMirrorRegistry,
  rd: THREE.WebGLRenderer,
  key: string,
  antialias: boolean,
  box: CssRectLoose = { x: 0, y: 0, w: 64, h: 48 },
  hostGl = testHostGl(1),
): void {
  reg.beginFrame();
  const { scene, camera } = emptyScene();
  reg.renderPrimary(key, rd, scene, camera, box, 0x0a1020, antialias, hostGl);
  reg.presentPack(key, rd, asCssRect({ x: 0, y: 0, w: box.w, h: box.h }), {
    letterbox: false,
    fill: null,
    aspect: box.w / box.h,
  }, hostGl);
  reg.presentPack(key, rd, asCssRect({ x: 70, y: 0, w: 50, h: 40 }), {
    letterbox: true,
    fill: lifecycleLetterboxFill,
    aspect: box.w / box.h,
  }, hostGl);
  reg.presentPack(key, rd, asCssRect({ x: 130, y: 0, w: 50, h: 40 }), {
    letterbox: true,
    fill: lifecycleLetterboxFill,
    aspect: box.w / box.h,
  }, hostGl);
}

describe("PackMirrorSession resource lifecycle", () => {
  beforeEach(() => {
    expect.hasAssertions();
    letterboxFillStats.reset();
    packMirrorResourceStats.reset();
    packMirrorSizeStats.reset();
  });
  afterEach(() => {
    letterboxFillStats.reset();
    packMirrorResourceStats.reset();
    packMirrorSizeStats.reset();
  });

  it("300 frames / 2 tiles: one RT, one quad graph, reused mirror scratch rects", () => {
    const reg = new PackMirrorRegistry();
    const rd = stubRenderer(false);
    reg.syncScopes(new Map([["plugin:pack", { tileCount: 2, antialias: false }]]));
    expect(packMirrorResourceStats.presenterCreated).toBe(1);
    const session = reg.sessionFor("plugin:pack")!;
    const barsRef = session.presenter.scratch.bars;
    const innerRef = session.presenter.scratch.innerTd;
    const outRef = session.presenter.scratch.out;
    const sizeScratchRef = reg.devicePackSizeScratch;
    let packSizeRef: typeof session.lastRenderDeviceSize = null;
    for (let i = 0; i < 300; i++) {
      simulateTwoTileFrame(reg, rd, "plugin:pack", false);
      expect(session.presenter.scratch.bars).toBe(barsRef);
      expect(session.presenter.scratch.innerTd).toBe(innerRef);
      expect(packMirrorSizeStats.deviceSizeAllocated).toBe(0);
      expect(session.presenter.scratch.out).toBe(outRef);
      expect(reg.devicePackSizeScratch).toBe(sizeScratchRef);
      if (packSizeRef === null) packSizeRef = session.lastRenderDeviceSize;
      expect(session.lastRenderDeviceSize).toBe(packSizeRef);
    }
    expect(packMirrorResourceStats.renderTargetCreated).toBe(1);
    expect(packMirrorResourceStats.renderTargetSetSize).toBe(0);
    expect(packMirrorResourceStats.presenterCreated).toBe(1);
    expect(packMirrorSizeStats.deviceSizeAllocated).toBe(0);
    reg.dispose();
  });

  it("renderPrimary: sub-pixel CSS width clamps to 2 device pixels", () => {
    const rd = stubRenderer(false);
    const reg = new PackMirrorRegistry();
    reg.syncScopes(new Map([["plugin:pack", { tileCount: 2, antialias: false }]]));
    const box: CssRectLoose = { x: 0, y: 0, w: 0.4, h: 48 };
    simulateTwoTileFrame(reg, rd, "plugin:pack", false, box, testHostGl(1, 48));
    const size = reg.sessionFor("plugin:pack")!.lastRenderDeviceSize!;
    expect(size.pw).toBe(2);
    expect(size.ph).toBe(48);
    expect(packMirrorResourceStats.renderTargetSetSize).toBe(0);
    reg.dispose();
  });

  it("300 steady frames: 0 setSize; one resize: exactly 1 setSize", () => {
    const session = new PackMirrorSession();
    const rd = stubRenderer(false);
    const { scene, camera } = emptyScene();
    const size64 = { x: 0, y: 0, w: 64, h: 48 };
    const dev64 = { pw: 64, ph: 48 };
    for (let i = 0; i < 300; i++) session.renderPack(rd, scene, camera, size64, dev64, 0x0a1020, false);
    expect(packMirrorResourceStats.renderTargetSetSize).toBe(0);
    const size96 = { x: 0, y: 0, w: 96, h: 72 };
    const dev96 = { pw: 96, ph: 72 };
    session.renderPack(rd, scene, camera, size96, dev96, 0x0a1020, false);
    expect(packMirrorResourceStats.renderTargetSetSize).toBe(1);
    session.dispose();
  });

  it("samples=4 only when context antialias is true", () => {
    const sessionOff = new PackMirrorSession();
    const rtOff = sessionOff.ensure(32, 24, false);
    expect(rtOff?.samples).toBe(0);
    sessionOff.dispose();
    packMirrorResourceStats.reset();
    const sessionOn = new PackMirrorSession();
    const rtOn = sessionOn.ensure(32, 24, true);
    expect(rtOn?.samples).toBe(PACK_MSAA_SAMPLES);
    sessionOn.dispose();
  });

  it("teardown disposes RT, geometry, and material; single tile creates nothing", () => {
    const reg = new PackMirrorRegistry();
    reg.syncScopes(new Map([["plugin:p", { tileCount: 2, antialias: false }]]));
    const rd = stubRenderer(false);
    simulateTwoTileFrame(reg, rd, "plugin:p", false);
    reg.syncScopes(new Map([["plugin:p", { tileCount: 1, antialias: false }]]));
    expect(packMirrorResourceStats.renderTargetDisposed).toBe(1);
    expect(packMirrorResourceStats.geometryDisposed).toBe(1);
    expect(packMirrorResourceStats.materialDisposed).toBe(1);
    expect(packMirrorResourceStats.renderTargetCreated).toBe(1);
    packMirrorResourceStats.reset();
    reg.syncScopes(new Map([["plugin:lonely", { tileCount: 1, antialias: false }]]));
    expect(packMirrorResourceStats.renderTargetCreated).toBe(0);
    expect(packMirrorResourceStats.presenterCreated).toBe(0);
    reg.dispose();
  });

  it("three tiles on one pack: one render target and one presenter", () => {
    const reg = new PackMirrorRegistry();
    reg.syncScopes(new Map([["plugin:trio", { tileCount: 3, antialias: false }]]));
    expect(packMirrorResourceStats.presenterCreated).toBe(1);
    const rd = stubRenderer(false);
    simulateThreeTileFrame(reg, rd, "plugin:trio", false);
    expect(packMirrorResourceStats.renderTargetCreated).toBe(1);
    expect(packMirrorResourceStats.presenterCreated).toBe(1);
    reg.dispose();
  });

  it("two pack keys get two targets; dropping one duplicate leaves the other", () => {
    const reg = new PackMirrorRegistry();
    reg.syncScopes(new Map([
      ["plugin:a", { tileCount: 2, antialias: false }],
      ["plugin:b", { tileCount: 2, antialias: false }],
    ]));
    expect(packMirrorResourceStats.renderTargetCreated).toBe(0);
    const rd = stubRenderer(false);
    simulateTwoTileFrame(reg, rd, "plugin:a", false);
    simulateTwoTileFrame(reg, rd, "plugin:b", false);
    expect(packMirrorResourceStats.renderTargetCreated).toBe(2);
    const a = reg.sessionFor("plugin:a");
    reg.syncScopes(new Map([["plugin:a", { tileCount: 2, antialias: false }]]));
    expect(reg.sessionFor("plugin:b")).toBeUndefined();
    expect(reg.sessionFor("plugin:a")).toBe(a);
    expect(packMirrorResourceStats.renderTargetDisposed).toBe(1);
    reg.dispose();
  });
});

describe("PackTexturePresenter", () => {
  beforeEach(() => {
    expect.hasAssertions();
    packMirrorResourceStats.reset();
  });
  it("constructs quad resources once", () => {
    const p = new PackTexturePresenter();
    expect(packMirrorResourceStats.presenterCreated).toBe(1);
    p.dispose();
  });

  it("keeps material.version stable over 300 draws with the same texture", () => {
    const p = new PackTexturePresenter();
    const rd = stubRenderer(false);
    const tex = new THREE.Texture();
    const hostGl = testHostGl(1, 10);
    p.draw(rd, tex, asCssRect({ x: 0, y: 0, w: 10, h: 10 }), null, 1, { letterbox: false }, hostGl);
    const v0 = p.material.version;
    for (let i = 0; i < 299; i++) {
      p.draw(rd, tex, asCssRect({ x: 0, y: 0, w: 10, h: 10 }), null, 1, { letterbox: false }, hostGl);
    }
    expect(p.material.version).toBe(v0);
    p.dispose();
  });
});
