/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost, type HostedView } from "./render-host";

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

describe("RenderHost GPU pack present", () => {
  let wall: HTMLElement;
  let host: RenderHost;
  let view: HostedView & { packCoalesceGroupKey?: string; packCoalesceTileCount?: number; isPackMirrorPrimary?: boolean };

  beforeEach(() => {
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
    view = {
      viewEl: pane,
      packCoalesceGroupKey: "plugin:gpu",
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: true,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    host.add(view);
  });

  it("routes pack primary tiles through renderPrimary on the GPU host", () => {
    const spy = vi.spyOn(host.packMirrors, "renderPrimary");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    host.present(view, 0x0a1020, scene, camera);
    expect(spy).toHaveBeenCalled();
    host.dispose();
    wall.remove();
  });
});
