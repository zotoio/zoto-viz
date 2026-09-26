/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost, type HostedView } from "./render-host";
import { renderHostMirrorTelemetry } from "./render-host-telemetry";
let antialiasFlag = false;

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
    getPixelRatio = () => 1;
    getContext = () => ({
      getContextAttributes: () => ({ antialias: antialiasFlag }),
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

describe("RenderHost context restore antialias", () => {
  let wall: HTMLElement;
  let host: RenderHost;
  let renderPrimaryAntialias: boolean | undefined;

  beforeEach(() => {
    antialiasFlag = false;
    renderHostMirrorTelemetry.reset();
    wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    wall.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120, x: 0, y: 0, toJSON: () => ({}),
    });
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    pane.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120, x: 0, y: 0, toJSON: () => ({}),
    });
    wall.appendChild(pane);
    host = new RenderHost(wall, { software: false });
    host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
    const view: HostedView & {
      packCoalesceGroupKey?: string;
      packCoalesceTileCount?: number;
      isPackMirrorPrimary?: boolean;
    } = {
      viewEl: pane,
      packCoalesceGroupKey: "plugin:aa",
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: true,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    host.add(view);
    vi.spyOn(host.packMirrors, "renderPrimary").mockImplementation((_key, _rd, _scene, _cam, _box, _hex, antialias) => {
      renderPrimaryAntialias = antialias;
    });
  });

  afterEach(() => {
    host.dispose();
    wall.remove();
    renderHostMirrorTelemetry.reset();
  });

  it("re-reads getContextAttributes after webglcontextrestored before the next pack present", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    host.present(host.views[0]!, 0x0a1020, scene, camera);
    expect(renderPrimaryAntialias).toBe(false);
    expect(renderHostMirrorTelemetry.getContextAttributesCalls).toBe(1);

    antialiasFlag = true;
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(renderHostMirrorTelemetry.getContextAttributesCalls).toBe(2);

    renderPrimaryAntialias = undefined;
    host.present(host.views[0]!, 0x0a1020, scene, camera);
    expect(renderPrimaryAntialias).toBe(true);
    expect(renderHostMirrorTelemetry.getContextAttributesCalls).toBe(2);
  });
});
