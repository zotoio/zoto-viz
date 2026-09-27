/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetScene } from "../graph/scene";
import { RenderHost } from "../graph/render-host";
import { ArcadeView } from "./arcade";

class ArcadeFitProbe extends ArcadeView {
  readonly controls: HTMLElement[] = [];

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
  }

  protected query(): { ip: string; peer?: string } | null {
    return null;
  }

  protected ingest(): void {}

  protected step(): void {}

  protected draw(): void {}

  runFit(): void {
    this.fit();
  }
}

function sceneStub(): NetScene {
  return { pulseNow: { level: 0 } } as NetScene;
}

describe("arcade layout DPR fit", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("fit uses capped layout DPR for canvas backing width", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 10 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 10 });
    document.body.appendChild(wall);
    const capHost = new RenderHost(wall, { software: true, maxLayoutDevicePxRatio: 1.25 });
    cancelAnimationFrame((capHost as unknown as { raf: number }).raf);

    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 80 });
    document.body.appendChild(container);
    const ctx = { setTransform: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);

    const view = new ArcadeFitProbe(container, sceneStub());
    view.runFit();
    expect(view.canvas.width).toBe(125);
    expect(view.canvas.height).toBe(100);
    capHost.dispose();
  });
});
