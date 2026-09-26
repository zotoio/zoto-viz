import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { getWallNotice } from "../core/wall-notice-region";
import type { VizDataFrame } from "../plugins/viz-host";

const CLEAR = 0x050a16;
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
      wall.appendChild(pane);
      panes.set(id, pane);
    }
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    vi.spyOn(host, "compilePluginSky").mockReturnValue(true);
    Object.defineProperty(host, "software", { value: false });
    const gl = {
      fenceSync: () => null,
    };
    vi.spyOn(host, "gl", "get").mockReturnValue(gl as WebGL2RenderingContext);
    const render = vi.fn();
    vi.spyOn(host.renderer as THREE.WebGLRenderer, "render").mockImplementation(render);
    return { host, wall, panes, render };
  }

  it("restore-resets-keys", () => {
    const { host, wall } = hostWithGl();
    const look = { seconds: "0", format: "24" };
    const tSec = new Date(2026, 0, 1, 1, 5, 30).getTime() / 1000;
    for (let i = 0; i < 600; i++) {
      host.syncNixieUpload(tSec, look);
      host.syncLetterboxFill(160, 120, CLEAR);
    }
    host.dispatchContextLost();
    host.dispatchContextRestored();
    expect(host.syncNixieUpload(tSec, look)).toBe(true);
    let uploads = 0;
    for (let i = 0; i < 600; i++) {
      if (host.syncNixieUpload(tSec, look)) uploads++;
    }
    expect(uploads).toBe(0);
    host.dispose();
    wall.remove();
  });

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
            CLEAR,
            scene,
            camera,
          );
        },
        hostContextLost: () => {},
        hostContextRestored: () => {},
      };
    });
    for (const v of views) host.add(v);
    host.dispatchContextLost();
    for (let i = 0; i < 600; i++) {
      for (const v of views) v.hostFrame();
    }
    expect(render.mock.calls.length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("listeners-once", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 320 });
    Object.defineProperty(wall, "clientHeight", { value: 240 });
    document.body.appendChild(wall);
    const add = vi.spyOn(HTMLCanvasElement.prototype, "addEventListener");
    const host = new RenderHost(wall);
    vi.spyOn(host, "compilePluginSky").mockReturnValue(true);
    for (let cycle = 0; cycle < 3; cycle++) {
      host.dispatchContextLost();
      host.dispatchContextRestored();
    }
    const lostRegs = add.mock.calls.filter((c) => c[0] === "webglcontextlost").length;
    expect(lostRegs).toBe(1);
    host.dispose();
    wall.remove();
    add.mockRestore();
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
    host.dispatchContextLost();
    host.dispatchContextRestored();
    vi.advanceTimersByTime(10_000);
    expect(getWallNotice(wall, "context-lost")).toBeNull();
    expect(getWallNotice(wall, "context-not-restored")).toBeNull();
    host.dispose();
    wall.remove();
  });
});
