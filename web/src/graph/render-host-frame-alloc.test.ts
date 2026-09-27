/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostRaf = vi.hoisted(() => {
  const queue: FrameRequestCallback[] = [];
  let nextId = 1;
  const byId = new Map<number, FrameRequestCallback>();
  return {
    requestAnimationFrame(cb: FrameRequestCallback): number {
      const id = nextId++;
      byId.set(id, cb);
      queue.push(cb);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      const cb = byId.get(id);
      if (!cb) return;
      byId.delete(id);
      const i = queue.indexOf(cb);
      if (i >= 0) queue.splice(i, 1);
    },
    runNext(ts: number): void {
      const cb = queue.shift();
      if (!cb) return;
      for (const [id, fn] of byId) {
        if (fn === cb) byId.delete(id);
      }
      cb(ts);
    },
    clear(): void {
      queue.length = 0;
      byId.clear();
    },
    pending(): number {
      return queue.length;
    },
  };
});

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
import { surfaceLetterboxFill } from "./letterbox-fill";
import { packMirrorSizeStats } from "./pack-mirror-size-stats";

type MirrorMetaView = HostedView & {
  packCoalesceGroupKey?: string;
  packCoalesceTileCount?: number;
  isPackMirrorPrimary?: boolean;
};

type HostWithViewBox = RenderHost & {
  viewBox(view: HostedView): { x: number; y: number; w: number; h: number } | null;
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

function tickHost(host: RenderHost, ts: number): void {
  const frame = (host as unknown as { frame: (t: number) => void }).frame;
  if (hostRaf.pending() === 0) requestAnimationFrame(frame);
  hostRaf.runNext(ts);
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
    expect.hasAssertions();
    hostRaf.clear();
    vi.stubGlobal("requestAnimationFrame", hostRaf.requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", hostRaf.cancelAnimationFrame);
    packMirrorSizeStats.reset();
    wall = document.createElement("div");
    document.body.appendChild(wall);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    const tiles = layout2x4(wall);
    host = new RenderHost(wall, { software: false, dpr: 1.5 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
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
    mirrors.length = 0;
    vi.unstubAllGlobals();
  });

  it("300 frames at 2×4 in-page mirror: stable viewBox, present arg identity", () => {
    const renderPrimary = vi.spyOn(host.packMirrors, "renderPrimary");
    const presentPack = vi.spyOn(host.packMirrors, "presentPack");
    const hostViewBox = (host as HostWithViewBox).viewBox.bind(host);

    tickHost(host, 0);
    const box = hostViewBox(primary);
    expect(box).not.toBeNull();

    const sizeRef = renderPrimary.mock.calls[0]![4];
    const primaryPackCalls = () => presentPack.mock.calls.filter((c) => c[3]?.letterbox === false);
    const mirrorPackCalls = () => presentPack.mock.calls.filter((c) => c[3]?.letterbox === true);
    const vpRef = primaryPackCalls()[0]![2];
    const optsRef = primaryPackCalls()[0]![3];
    const mirrorOptsRef = mirrorPackCalls()[0]![3];

    renderPrimary.mockClear();
    presentPack.mockClear();
    for (let f = 0; f < 300; f++) {
      tickHost(host, f + 1);
      expect(hostViewBox(primary)).toBe(box);
      for (const c of renderPrimary.mock.calls) expect(c[4]).toBe(sizeRef);
      for (const c of primaryPackCalls()) {
        expect(c[2]).toBe(vpRef);
        expect(c[3]).toBe(optsRef);
      }
      for (const c of mirrorPackCalls()) expect(c[3]).toBe(mirrorOptsRef);
      renderPrimary.mockClear();
      presentPack.mockClear();
    }
    expect(renderPrimary).toHaveBeenCalledTimes(0);
    expect(presentPack).toHaveBeenCalledTimes(0);
  });

  it("300 frames at 2×4 pr 1.5: zero render-path object allocations after warm-up", () => {
    tickHost(host, 0);
    packMirrorSizeStats.reset();
    for (let f = 0; f < 300; f++) tickHost(host, f + 1);
    expect(packMirrorSizeStats.deviceSizeAllocated).toBe(0);
    expect(packMirrorSizeStats.converterEdgeObjectsAllocated).toBe(0);
  });
});
