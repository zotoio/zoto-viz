/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetScene } from "../graph/scene";
import { RenderHost } from "../graph/render-host";
import { PongView } from "./pong";

function sceneStub(): NetScene {
  return {
    pulseNow: { level: 0 },
    selectIp: () => {},
  } as NetScene;
}

describe("pong layout DPR fit", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("fit uses capped layout DPR for canvas backing height", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 10 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 10 });
    document.body.appendChild(wall);
    const capHost = new RenderHost(wall, { software: true, maxLayoutDevicePxRatio: 1.25 });
    cancelAnimationFrame((capHost as unknown as { raf: number }).raf);

    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 64 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 48 });
    document.body.appendChild(container);
    const ctx = { setTransform: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);

    const pong = new PongView(container, sceneStub());
    const canvas = (pong as unknown as { canvas: HTMLCanvasElement }).canvas;
    (pong as unknown as { fit(): void }).fit();
    expect(canvas.height).toBe(60);
    expect(canvas.width).toBe(80);
    capHost.dispose();
  });
});
