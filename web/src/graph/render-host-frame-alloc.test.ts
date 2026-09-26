/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { WebGLRendererMock } = vi.hoisted(() => {
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    setPixelRatio = vi.fn();
    setClearColor = vi.fn();
    setSize = vi.fn();
    setScissorTest = vi.fn();
    setScissor = vi.fn();
    setViewport = vi.fn();
    setRenderTarget = vi.fn();
    getRenderTarget = () => null;
    clear = vi.fn();
    render = vi.fn();
    getPixelRatio = () => 1.5;
    getContext = () => ({
      getContextAttributes: () => ({ antialias: false }),
      fenceSync: () => ({}),
      getExtension: () => null,
    });
    forceContextLoss = vi.fn();
    dispose = vi.fn();
  }
  return { WebGLRendererMock };
});

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  return { ...orig, WebGLRenderer: WebGLRendererMock as unknown as typeof orig.WebGLRenderer };
});

import * as THREE from "three";
import { RenderHost, type HostedView } from "./render-host";
import { renderHostMirrorTelemetry } from "./render-host-telemetry";
import { surfaceLetterboxFill } from "./letterbox-fill";

type MirrorMetaView = HostedView & {
  packCoalesceGroupKey?: string;
  packCoalesceTileCount?: number;
  isPackMirrorPrimary?: boolean;
};

function layout2x4(wall: HTMLElement): Map<string, HTMLElement> {
  wall.style.width = "400px";
  wall.style.height = "240px";
  Object.defineProperty(wall, "clientWidth", { configurable: true, value: 400 });
  Object.defineProperty(wall, "clientHeight", { configurable: true, value: 240 });
  wall.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 400, bottom: 240, width: 400, height: 240, x: 0, y: 0, toJSON: () => ({}),
  });
  const cols = 2;
  const rows = 4;
  const tw = 200;
  const th = 60;
  const els = new Map<string, HTMLElement>();
  let i = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const el = document.createElement("div");
      const id = `t${i}`;
      el.id = id;
      const x = col * tw;
      const y = row * th;
      el.getBoundingClientRect = () => ({
        left: x, top: y, right: x + tw, bottom: y + th, width: tw, height: th, x, y, toJSON: () => ({}),
      });
      wall.appendChild(el);
      els.set(id, el);
      i += 1;
    }
  }
  return els;
}

describe("RenderHost frame allocations", () => {
  let wall: HTMLElement;
  let host: RenderHost;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let primary: MirrorMetaView;
  const mirrors: MirrorMetaView[] = [];
  const fill = surfaceLetterboxFill(0x0a1020, 0.25);

  beforeEach(() => {
    renderHostMirrorTelemetry.reset();
    wall = document.createElement("div");
    document.body.appendChild(wall);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    const tiles = layout2x4(wall);
    host = new RenderHost(wall, { software: false, dpr: 1.5 });
    host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();

    const packKey = "plugin:wall-pack";
    const tileCount = 8;
    primary = {
      viewEl: tiles.get("t0")!,
      packCoalesceGroupKey: packKey,
      packCoalesceTileCount: tileCount,
      isPackMirrorPrimary: true,
      hostFrame() {
        host.present(this, 0x0a1020, scene, camera);
      },
      hostContextLost() {},
      hostContextRestored() {},
    };
    host.add(primary);

    for (let i = 1; i < 8; i++) {
      const mirror: MirrorMetaView = {
        viewEl: tiles.get(`t${i}`)!,
        packCoalesceGroupKey: packKey,
        packCoalesceTileCount: tileCount,
        isPackMirrorPrimary: false,
        hostFrame() {
          host.presentPackMirror(primary, this, fill);
        },
        hostContextLost() {},
        hostContextRestored() {},
      };
      mirrors.push(mirror);
      host.add(mirror);
    }
  });

  afterEach(() => {
    host.dispose();
    wall.remove();
    renderHostMirrorTelemetry.reset();
  });

  it("300 frames at 2×4 in-page mirror: one scope sync, stable viewBox, present arg identity", () => {
    const renderPrimary = vi.spyOn(host.packMirrors, "renderPrimary");
    const presentPack = vi.spyOn(host.packMirrors, "presentPack");

    host.advanceFrame(0);
    expect(renderHostMirrorTelemetry.scopeSyncRuns).toBe(1);
    const box = host.viewBox(primary);
    expect(box).not.toBeNull();

    expect(renderPrimary).toHaveBeenCalled();
    expect(presentPack).toHaveBeenCalled();
    const sizeRef = renderPrimary.mock.calls[0]![4];
    const primaryPackCalls = () => presentPack.mock.calls.filter((c) => c[3]?.letterbox === false);
    const mirrorPackCalls = () => presentPack.mock.calls.filter((c) => c[3]?.letterbox === true);
    expect(primaryPackCalls().length).toBeGreaterThan(0);
    const vpRef = primaryPackCalls()[0]![2];
    const optsRef = primaryPackCalls()[0]![3];
    const mirrorOptsRef = mirrorPackCalls()[0]![3];
    for (let f = 0; f < 300; f++) {
      renderPrimary.mockClear();
      presentPack.mockClear();
      host.advanceFrame(f + 1);
      expect(host.viewBox(primary)).toBe(box);
      for (const c of renderPrimary.mock.calls) expect(c[4]).toBe(sizeRef);
      for (const c of primaryPackCalls()) {
        expect(c[2]).toBe(vpRef);
        expect(c[3]).toBe(optsRef);
      }
      for (const c of mirrorPackCalls()) expect(c[3]).toBe(mirrorOptsRef);
    }

    expect(renderHostMirrorTelemetry.scopeSyncRuns).toBe(1);
    expect(renderHostMirrorTelemetry.viewSortRuns).toBe(1);
    expect(renderHostMirrorTelemetry.getContextAttributesCalls).toBe(1);
    expect(renderHostMirrorTelemetry.scopeFingerprintBuilds).toBe(0);
  });
});
