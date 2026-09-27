/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Stage3D } from "../arcade/stage3d";
import type { NetScene } from "./scene";
import { RenderHost } from "./render-host";
import {
  DEFAULT_MAX_DEVICE_PX_RATIO,
  configureLayoutMaxDevicePxRatio,
  layoutBackingDevicePx,
  layoutDevicePxRatio,
  devicePxRatioNumber,
  resetLayoutDevicePxRatioWatch,
} from "../../test-support/layout-device-px-ratio";
import { LiveFeed } from "../ui/feed";
import { probeWebGL } from "./webgl";

vi.mock("./webgl", () => ({
  probeWebGL: vi.fn(() => false),
}));

class TestStage3D extends Stage3D {
  readonly controls: HTMLElement[] = [];
  protected query() { return null; }
  protected ingest(): void {}
  protected step(): void {}

  /** Software canvas path only (counts backing-store pixels from `fit`). */
  layoutCanvas2d(cssW: number, cssH: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const ctx = {
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx);
    const stage = this as unknown as {
      canvas: HTMLCanvasElement | null;
      fallback: CanvasRenderingContext2D | null;
      fit(): void;
    };
    defineClientSize(this.container, cssW, cssH);
    expect(this.container.clientWidth).toBe(cssW);
    stage.canvas = canvas;
    stage.fallback = ctx;
    this.container.appendChild(canvas);
    stage.fit();
    expect(canvas.width).toBe(layoutBackingDevicePx(cssW));
    return canvas;
  }
}

function defineClientSize(el: HTMLElement, w: number, h: number): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: w });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: h });
}

function sceneStub(): NetScene {
  return {
    pulseNow: { level: 0, bass: 0 },
    selectIp: () => {},
  } as NetScene;
}

function mountStage3d(cssW: number, cssH: number): HTMLCanvasElement {
  const container = document.createElement("div");
  defineClientSize(container, cssW, cssH);
  document.body.appendChild(container);
  const stage = new TestStage3D(container, sceneStub());
  return stage.layoutCanvas2d(cssW, cssH);
}

function mountFeedBars(cssW: number, cssH: number): HTMLCanvasElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const feed = new LiveFeed(host, sceneStub());
  feed.setConfig({ layout: "bars", modulate: false });
  const barsWrap = host.querySelector(".feed-bars") as HTMLElement;
  barsWrap.hidden = false;
  defineClientSize(barsWrap, cssW, cssH);
  (feed as unknown as { drawBars(): void }).drawBars();
  const canvas = host.querySelector("canvas")!;
  return canvas;
}

describe("layout DPR surfaces (RenderHost cap, stage3d + feed)", () => {
  let wall: HTMLElement;

  beforeEach(() => {
    expect.hasAssertions();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
    wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
    vi.mocked(probeWebGL).mockReturnValue(false);
  });

  afterEach(() => {
    wall.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
  });

  it("window DPR 2: stage3d and feed backing store is CSS size × 1.5 after RenderHost configures cap", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    new RenderHost(wall, { software: true });
    expect(devicePxRatioNumber(layoutDevicePxRatio())).toBe(1.5);
    expect(layoutBackingDevicePx(100)).toBe(150);
    const stageCanvas = mountStage3d(100, 80);
    expect(stageCanvas.width).toBe(150);
    expect(stageCanvas.height).toBe(layoutBackingDevicePx(80));
    const feedCanvas = mountFeedBars(100, 80);
    expect(feedCanvas.width).toBe(150);
    expect(feedCanvas.height).toBe(layoutBackingDevicePx(80));
  });

  it("window DPR 1.75: stage3d and feed backing store is CSS size × 1.5 (not legacy 1.75)", () => {
    vi.stubGlobal("devicePixelRatio", 1.75);
    new RenderHost(wall, { software: true });
    expect(layoutBackingDevicePx(100)).toBe(150);
    const stageCanvas = mountStage3d(100, 64);
    expect(stageCanvas.width).toBe(150);
    const feedCanvas = mountFeedBars(100, 64);
    expect(feedCanvas.width).toBe(150);
  });

  it("configureLayoutMaxDevicePxRatio 1.25 at window DPR 2: stage3d and feed backing store is CSS × 1.25", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    configureLayoutMaxDevicePxRatio(1.25);
    new RenderHost(wall, { software: true });
    expect(layoutBackingDevicePx(100)).toBe(125);
    const stageCanvas = mountStage3d(100, 80);
    expect(stageCanvas.width).toBe(125);
    const feedCanvas = mountFeedBars(100, 80);
    expect(feedCanvas.width).toBe(125);
  });
});
