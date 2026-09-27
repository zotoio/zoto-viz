import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import type { VizDataFrame } from "../plugins/viz-host";

const EMPTY: VizDataFrame = {
  t: 0, dt: 0.016, audio: 0, packets: [], rf: [], talkers: [], headlines: [],
};

describe("shader fallback context gen", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function hostWithGl(tileIds = ["t"]): {
    host: RenderHost;
    wall: HTMLElement;
    panes: Map<string, HTMLElement>;
    render: ReturnType<typeof vi.fn>;
  } {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 320 });
    Object.defineProperty(wall, "clientHeight", { value: 240 });
    const panes = new Map<string, HTMLElement>();
    for (const id of tileIds) {
      const pane = document.createElement("div");
      Object.defineProperty(pane, "clientWidth", { value: 160 });
      Object.defineProperty(pane, "clientHeight", { value: 120 });
      wall.appendChild(pane);
      panes.set(id, pane);
    }
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const rect = () =>
      ({
        left: 0,
        top: 0,
        width: 160,
        height: 120,
        right: 160,
        bottom: 120,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    for (const pane of panes.values()) pane.getBoundingClientRect = rect;
    host.canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 320,
        height: 240,
        right: 320,
        bottom: 240,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    vi.spyOn(host, "compilePluginSky").mockReturnValue(true);
    Object.defineProperty(host, "software", { value: false });
    const gl = {
      fenceSync: () => null,
      getExtension: () => null,
    };
    vi.spyOn(host, "gl", "get").mockReturnValue(gl as WebGL2RenderingContext);
    const render = vi.fn();
    vi.spyOn(host.renderer as THREE.WebGLRenderer, "render").mockImplementation(render);
    return { host, wall, panes, render };
  }

  it("no-gl-while-lost", () => {
    const ids = ["a", "b", "c", "d"];
    const { host, wall, panes, render } = hostWithGl(ids);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const views = ids.map((id) => {
      const viewEl = panes.get(id)!;
      return {
        viewEl,
        hostFrame: () => {
          host.present(
            { viewEl, hostFrame: () => {}, hostContextLost: () => {}, hostContextRestored: () => {} },
            0x050a16,
            scene,
            camera,
          );
        },
        hostContextLost: () => {},
        hostContextRestored: () => {},
      };
    });
    for (const v of views) host.add(v);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    for (let i = 0; i < 600; i++) {
      for (const v of views) v.hostFrame();
    }
    expect(render.mock.calls.length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("loss-prevent-default", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const e = new Event("webglcontextlost", { cancelable: true });
    host.canvas.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    host.dispose();
    wall.remove();
  });

  it("timer-cleared", () => {
    const { host, wall } = hostWithGl();
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(5_000);
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(5_000);
    expect(wall.querySelectorAll(".gfx-wall-reload").length).toBe(0);
    host.dispose();
    wall.remove();
  });
});
