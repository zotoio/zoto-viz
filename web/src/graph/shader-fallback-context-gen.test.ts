import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { GFX_WALL_NOTICE_CLASS, GFX_WALL_RELOAD_CLASS } from "./gfx-wall-notice";
import { packFallbackText } from "../plugins/viz-pack-fallback";
import type { VizDataFrame } from "../plugins/viz-host";

const FRAG = "void main() { fragColor = vec4(1.0); }";
const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;
const CLEAR = 0x050a16;

function frameAt(ms: number): VizDataFrame {
  return {
    t: ms / 1000,
    dt: 0.016,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
  };
}

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
    compileShader: ReturnType<typeof vi.fn>;
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
    const compileShader = vi.fn();
    const render = vi.fn();
    const gl = {
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS,
      LINK_STATUS,
      createShader: () => ({}),
      createProgram: () => ({}),
      shaderSource: vi.fn(),
      compileShader,
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getShaderParameter: () => true,
      getProgramParameter: (_p: unknown, p: number) => (p === LINK_STATUS),
      getShaderInfoLog: () => "",
      getProgramInfoLog: () => "",
    };
    vi.spyOn(host, "gl", "get").mockReturnValue(gl as WebGL2RenderingContext);
    Object.defineProperty(host, "software", { value: false });
    vi.spyOn(host.renderer as THREE.WebGLRenderer, "render").mockImplementation(render);
    return { host, wall, panes, compileShader, render };
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
    expect(host.syncLetterboxFill(160, 120, CLEAR)).toBe(true);
    let uploads = 0;
    let letterbox = 0;
    for (let i = 0; i < 600; i++) {
      if (host.syncNixieUpload(tSec, look)) uploads++;
      if (host.syncLetterboxFill(160, 120, CLEAR)) letterbox++;
    }
    expect(uploads).toBe(0);
    expect(letterbox).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("no-gl-while-lost", () => {
    const ids = ["a", "b", "c", "d"];
    const { host, wall, panes, compileShader, render } = hostWithGl(ids);
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
    for (const id of ids) {
      host.beginTilePack(id, `nixie:${id}`, panes.get(id)!, "Nixie", packFallbackText("nixie-clock"));
      host.buildTileShader(id, FRAG);
    }
    const t0 = new Date(2026, 0, 1, 1, 5, 0, 0).getTime();
    const fallback = packFallbackText("nixie-clock", { seconds: "1", format: "24" })!;
    host.dispatchContextLost();
    const compilesAfterLoss = compileShader.mock.calls.length;
    let writes = 0;
    let last = "";
    let uploads = 0;
    for (let i = 0; i < 600; i++) {
      const next = fallback(frameAt(t0 + i * 16));
      if (next !== last) {
        writes++;
        last = next;
      }
      if (host.syncNixieUpload((t0 + i * 16) / 1000, { seconds: "1", format: "24" })) uploads++;
      for (const id of ids) host.buildTileShader(id, FRAG);
      for (const v of views) v.hostFrame();
    }
    expect(render.mock.calls.length).toBe(0);
    expect(compileShader.mock.calls.length).toBe(compilesAfterLoss);
    expect(uploads).toBe(0);
    expect(writes).toBe(10);
    host.dispose();
    wall.remove();
  });

  it("listeners-once", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 320 });
    Object.defineProperty(wall, "clientHeight", { value: 240 });
    const ids = ["a", "b", "c", "d"];
    const panes = new Map<string, HTMLElement>();
    for (const id of ids) {
      const pane = document.createElement("div");
      wall.appendChild(pane);
      panes.set(id, pane);
    }
    document.body.appendChild(wall);
    const add = vi.spyOn(HTMLCanvasElement.prototype, "addEventListener");
    const host = new RenderHost(wall);
    const compileShader = vi.fn();
    const gl = {
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS,
      LINK_STATUS,
      createShader: () => ({}),
      createProgram: () => ({}),
      shaderSource: vi.fn(),
      compileShader,
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getShaderParameter: () => true,
      getProgramParameter: (_p: unknown, p: number) => (p === LINK_STATUS),
      getShaderInfoLog: () => "",
      getProgramInfoLog: () => "",
    };
    vi.spyOn(host, "gl", "get").mockReturnValue(gl as WebGL2RenderingContext);
    Object.defineProperty(host, "software", { value: false });
    for (const id of ids) {
      host.beginTilePack(id, `nixie:${id}`, panes.get(id)!, "Nixie", packFallbackText("nixie-clock"));
      host.buildTileShader(id, FRAG);
    }
    for (let cycle = 0; cycle < 3; cycle++) {
      const before = compileShader.mock.calls.length;
      host.dispatchContextLost();
      host.dispatchContextRestored();
      for (const id of ids) host.buildTileShader(id, FRAG);
      expect(compileShader.mock.calls.length - before).toBe(ids.length * 2);
    }
    const lostRegs = add.mock.calls.filter((c) => c[0] === "webglcontextlost").length;
    const restoredRegs = add.mock.calls.filter((c) => c[0] === "webglcontextrestored").length;
    expect(lostRegs).toBe(1);
    expect(restoredRegs).toBe(1);
    host.dispose();
    wall.remove();
    add.mockRestore();
  });

  it("loss-prevent-default", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 320 });
    Object.defineProperty(wall, "clientHeight", { value: 240 });
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
    host.dispatchContextLost();
    host.dispatchContextLost();
    host.dispatchContextRestored();
    vi.advanceTimersByTime(10_000);
    expect(wall.querySelectorAll(`.${GFX_WALL_NOTICE_CLASS}`).length).toBe(0);
    expect(wall.querySelectorAll(`.${GFX_WALL_RELOAD_CLASS}`).length).toBe(0);
    expect(host.gfxWallNotice.hasPendingReloadTimer).toBe(false);
    host.dispose();
    wall.remove();
  });
});
