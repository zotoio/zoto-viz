import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HostedView } from "../graph/render-host";
import { RenderHost } from "../graph/render-host";
import { surfaceLetterboxFill } from "../graph/letterbox-fill";
import {
  createReadbackGuard,
  resetSandboxBitmapLanes,
  runSandboxBitmapDuplicateFrame,
  sandboxBitmapLane,
} from "./sandbox-bitmap";
import { PluginSandbox } from "./host";

function mockBitmap(): ImageBitmap {
  const close = vi.fn();
  const bmp = Object.create(ImageBitmap.prototype) as ImageBitmap;
  Object.defineProperties(bmp, {
    width: { value: 64 },
    height: { value: 48 },
    close: { value: close },
  });
  return bmp;
}

function hostedPane(id: string, wall: HTMLElement, box: DOMRect): HostedView {
  const pane = document.createElement("div");
  pane.id = id;
  wall.appendChild(pane);
  pane.getBoundingClientRect = () => box;
  return {
    viewEl: pane,
    hostFrame() {},
    hostContextLost() {},
    hostContextRestored() {},
  };
}

function wallSetup(): { wall: HTMLElement; host: RenderHost; box: DOMRect } {
  const wall = document.createElement("div");
  document.body.appendChild(wall);
  const box = { x: 0, y: 0, width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, toJSON() { return this; } } as DOMRect;
  wall.getBoundingClientRect = () => box;
  Object.defineProperty(wall, "clientWidth", { value: 400 });
  Object.defineProperty(wall, "clientHeight", { value: 200 });
  const host = new RenderHost(wall, { software: true });
  host.canvas.getBoundingClientRect = () => box;
  return { wall, host, box };
}

describe("duplicate pack mirror (Performance Pedant)", () => {
  const guard = createReadbackGuard();

  beforeAll(() => {
    if (typeof globalThis.ImageBitmap === "undefined") {
      vi.stubGlobal("ImageBitmap", class ImageBitmap {
        width = 0;
        height = 0;
        close(): void {}
      });
    }
  });

  afterEach(() => {
    resetSandboxBitmapLanes();
    guard.restore();
    document.body.innerHTML = "";
  });

  it("runs 300 host-canvas mirror frames without readback APIs", () => {
    const { wall, host, box } = wallSetup();
    guard.install();
    const left = { ...box, x: 0, width: 200, right: 200 };
    const right = { ...box, x: 200, left: 200, right: 400 };
    const primary = hostedPane("primary", wall, left as DOMRect);
    const mirror = hostedPane("mirror", wall, right as DOMRect);
    const fill = surfaceLetterboxFill(0x0a1020, 0.25);
    for (let i = 0; i < 300; i++) {
      host.present(primary, 0x112233, {} as never, {} as never);
      host.presentPackMirror(primary, mirror, fill);
    }
    expect(guard.getImageData).toBe(0);
    expect(guard.toDataURL).toBe(0);
    expect(guard.readPixels).toBe(0);
    host.dispose();
  });

  it("runs 300 sandbox bitmap mirror frames without readback APIs", () => {
    const { wall, host, box } = wallSetup();
    guard.install();
    const mirrorA = hostedPane("m1", wall, { ...box, x: 0, width: 200, right: 200 } as DOMRect);
    const mirrorB = hostedPane("m2", wall, { ...box, x: 200, width: 200, left: 200, right: 400 } as DOMRect);
    const fill = surfaceLetterboxFill(0x0a1020, 0.25);
    for (let i = 0; i < 300; i++) {
      const bmp = mockBitmap();
      runSandboxBitmapDuplicateFrame({
        host,
        pluginId: "pulse-ts",
        bitmap: bmp,
        mirrors: [mirrorA, mirrorB],
        fill,
        aspect: 16 / 9,
      });
    }
    expect(guard.getImageData).toBe(0);
    expect(guard.toDataURL).toBe(0);
    expect(guard.readPixels).toBe(0);
    host.dispose();
  });

  it("receives one bitmap and closes once per host frame; teardown leaves zero open", () => {
    const { wall, host, box } = wallSetup();
    const mirror = hostedPane("m", wall, box);
    const fill = surfaceLetterboxFill(0x0a1020, 0.25);
    const lane = sandboxBitmapLane("pack-a");
    const frames = 12;
    for (let i = 0; i < frames; i++) {
      const bmp = mockBitmap();
      runSandboxBitmapDuplicateFrame({
        host,
        pluginId: "pack-a",
        bitmap: bmp,
        mirrors: [mirror],
        fill,
        aspect: 1,
      });
      expect(bmp.close).toHaveBeenCalledOnce();
    }
    expect(lane.stats.received).toBe(frames);
    expect(lane.stats.closed).toBe(frames);
    expect(lane.openCount()).toBe(0);
    resetSandboxBitmapLanes();
    expect(lane.openCount()).toBe(0);
    host.dispose();
  });

  it("shows the labelled placeholder only after publishBitmapFailed, not when idle", () => {
    const { wall, host, box } = wallSetup();
    const mirror = hostedPane("m", wall, box);
    const fill = surfaceLetterboxFill(0x0a1020, 0.25);
    const lane = sandboxBitmapLane("pack-fail");
    expect(lane.shouldShowFailurePlaceholder()).toBe(false);
    host.presentSandboxMirrorLetterbox(mirror, fill, 16 / 9);
    lane.markPublishFailed();
    expect(lane.shouldShowFailurePlaceholder()).toBe(true);
    host.presentSandboxMirrorPlaceholder(mirror, fill, "My pack", 2);
    host.dispose();
  });

  it("routes transferred ImageBitmap from the sandbox iframe message", async () => {
    const box = new PluginSandbox();
    const seen: ImageBitmap[] = [];
    box.handlers = {
      publishBitmap: (id, bmp) => {
        expect(id).toBe("pulse");
        seen.push(bmp);
      },
    };
    await box.load("pulse", "globalThis.ok = true;", ["viz.write"], {});
    const bmp = mockBitmap();
    const src = box["iframe"]!.contentWindow;
    box["onMessage"]({
      source: src ?? null,
      data: { source: "zoto-viz-plugin", type: "publishBitmap", payload: { bitmap: bmp } },
    } as MessageEvent);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(bmp);
    box.unload();
  });

  it("routes publishBitmapFailed from the sandbox iframe message", async () => {
    const box = new PluginSandbox();
    const lane = sandboxBitmapLane("pulse");
    box.handlers = {
      publishBitmapFailed: (id) => {
        expect(id).toBe("pulse");
        lane.markPublishFailed();
      },
    };
    await box.load("pulse", "globalThis.ok = true;", ["viz.write"], {});
    const src = box["iframe"]!.contentWindow;
    box["onMessage"]({
      source: src ?? null,
      data: { source: "zoto-viz-plugin", type: "publishBitmapFailed", payload: {} },
    } as MessageEvent);
    expect(lane.shouldShowFailurePlaceholder()).toBe(true);
    box.unload();
  });
});
