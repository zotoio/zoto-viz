import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  PACK_MSAA_SAMPLES,
  PackMirrorRegistry,
  PackMirrorSession,
  PackTexturePresenter,
  packMirrorResourceStats,
  sandboxBitmapGl,
  sandboxBitmapGpuCount,
  syncSandboxBitmapGpuScopes,
} from "./pack-mirror-gl";
import { surfaceLetterboxFill } from "./letterbox-fill";

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

function simulateTwoTileFrame(
  reg: PackMirrorRegistry,
  rd: THREE.WebGLRenderer,
  key: string,
  antialias: boolean,
  box = { w: 64, h: 48 },
): void {
  reg.beginFrame();
  const { scene, camera } = emptyScene();
  reg.renderPrimary(key, rd, scene, camera, box, 0x0a1020, antialias);
  reg.presentPack(key, rd, { x: 0, y: 0, w: box.w, h: box.h }, {
    letterbox: false,
    fill: null,
    aspect: box.w / box.h,
  });
  reg.presentPack(key, rd, { x: 80, y: 0, w: 90, h: 70 }, {
    letterbox: true,
    fill: surfaceLetterboxFill(0x0a1020, 0.25),
    aspect: box.w / box.h,
  });
}

function simulateThreeTileFrame(
  reg: PackMirrorRegistry,
  rd: THREE.WebGLRenderer,
  key: string,
  antialias: boolean,
  box = { w: 64, h: 48 },
): void {
  reg.beginFrame();
  const { scene, camera } = emptyScene();
  reg.renderPrimary(key, rd, scene, camera, box, 0x0a1020, antialias);
  reg.presentPack(key, rd, { x: 0, y: 0, w: box.w, h: box.h }, {
    letterbox: false,
    fill: null,
    aspect: box.w / box.h,
  });
  reg.presentPack(key, rd, { x: 70, y: 0, w: 50, h: 40 }, {
    letterbox: true,
    fill: surfaceLetterboxFill(0x0a1020, 0.25),
    aspect: box.w / box.h,
  });
  reg.presentPack(key, rd, { x: 130, y: 0, w: 50, h: 40 }, {
    letterbox: true,
    fill: surfaceLetterboxFill(0x0a1020, 0.25),
    aspect: box.w / box.h,
  });
}

describe("PackMirrorSession resource lifecycle", () => {
  beforeEach(() => packMirrorResourceStats.reset());
  afterEach(() => packMirrorResourceStats.reset());

  it("300 frames / 2 tiles: one RT, one quad graph, reused mirror scratch rects", () => {
    const reg = new PackMirrorRegistry();
    const rd = stubRenderer(false);
    reg.syncScopes(new Map([["plugin:pack", { tileCount: 2, antialias: false }]]));
    expect(packMirrorResourceStats.presenterCreated).toBe(1);
    const session = reg.sessionFor("plugin:pack")!;
    const barsRef = session.presenter.scratch.bars;
    const innerRef = session.presenter.scratch.innerTd;
    const outRef = session.presenter.scratch.out;
    for (let i = 0; i < 300; i++) {
      simulateTwoTileFrame(reg, rd, "plugin:pack", false);
      expect(session.presenter.scratch.bars).toBe(barsRef);
      expect(session.presenter.scratch.innerTd).toBe(innerRef);
      expect(session.presenter.scratch.out).toBe(outRef);
    }
    expect(packMirrorResourceStats.renderTargetCreated).toBe(1);
    expect(packMirrorResourceStats.renderTargetSetSize).toBe(0);
    expect(packMirrorResourceStats.presenterCreated).toBe(1);
    reg.dispose();
  });

  it("300 steady frames: 0 setSize; one resize: exactly 1 setSize", () => {
    const session = new PackMirrorSession();
    const rd = stubRenderer(false);
    const { scene, camera } = emptyScene();
    for (let i = 0; i < 300; i++) session.renderPack(rd, scene, camera, 64, 48, 0x0a1020, false);
    expect(packMirrorResourceStats.renderTargetSetSize).toBe(0);
    session.renderPack(rd, scene, camera, 96, 72, 0x0a1020, false);
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

describe("sandbox bitmap GPU scope sync", () => {
  beforeEach(() => {
    packMirrorResourceStats.reset();
    syncSandboxBitmapGpuScopes(new Map());
  });
  afterEach(() => syncSandboxBitmapGpuScopes(new Map()));

  it("ten 2↔1 tile toggles balance creates/disposes; one tile leaves no sandbox GPU", () => {
    for (let i = 0; i < 10; i++) {
      syncSandboxBitmapGpuScopes(new Map([["plugin:sandbox", 2]]));
      const gpu = sandboxBitmapGl("plugin:sandbox");
      gpu.ensureTexture(32, 24);
      syncSandboxBitmapGpuScopes(new Map([["plugin:sandbox", 1]]));
    }
    expect(packMirrorResourceStats.textureCreated).toBe(packMirrorResourceStats.textureDisposed);
    expect(packMirrorResourceStats.presenterCreated).toBe(packMirrorResourceStats.materialDisposed);
    expect(sandboxBitmapGpuCount()).toBe(0);
  });
});

describe("PackTexturePresenter", () => {
  beforeEach(() => packMirrorResourceStats.reset());
  it("constructs quad resources once", () => {
    const p = new PackTexturePresenter();
    expect(packMirrorResourceStats.presenterCreated).toBe(1);
    p.dispose();
  });

  it("keeps material.version stable over 300 draws with the same texture", () => {
    const p = new PackTexturePresenter();
    const rd = stubRenderer(false);
    const tex = new THREE.Texture();
    p.draw(rd, tex, { x: 0, y: 0, w: 10, h: 10 }, null, 1, { letterbox: false });
    const v0 = p.material.version;
    for (let i = 0; i < 299; i++) {
      p.draw(rd, tex, { x: 0, y: 0, w: 10, h: 10 }, null, 1, { letterbox: false });
    }
    expect(p.material.version).toBe(v0);
    p.dispose();
  });
});
