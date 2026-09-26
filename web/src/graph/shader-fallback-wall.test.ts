import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import type { VizDataFrame } from "../plugins/viz-host";

const FRAG = "void main() { fragColor = vec4(1.0); }";
const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;

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

function mockGl(failTiles: Set<string>, tileIdForCall: { current: string }) {
  const compileShader = vi.fn();
  const linkProgram = vi.fn();
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
    linkProgram,
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    getShaderParameter: () => !failTiles.has(tileIdForCall.current),
    getProgramParameter: (_p: unknown, p: number) => (p === LINK_STATUS),
    getShaderInfoLog: () => "err",
    getProgramInfoLog: () => "link err",
  };
  return { gl, compileShader, linkProgram };
}

function wall2x2(): {
  wall: HTMLElement;
  host: RenderHost;
  panes: Map<string, HTMLElement>;
  tileIdForCall: { current: string };
} {
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: 640 });
  Object.defineProperty(wall, "clientHeight", { value: 480 });
  const ids = ["t1", "t2", "t3", "t4"];
  const panes = new Map<string, HTMLElement>();
  for (const id of ids) {
    const p = document.createElement("div");
    panes.set(id, p);
    wall.appendChild(p);
  }
  document.body.appendChild(wall);
  const host = new RenderHost(wall);
  const tileIdForCall = { current: "t1" };
  const failTiles = new Set<string>();
  const mocked = mockGl(failTiles, tileIdForCall);
  vi.spyOn(host, "gl", "get").mockReturnValue(mocked.gl as WebGL2RenderingContext);
  Object.defineProperty(host, "software", { value: false });
  const origBuild = host.buildTileShader.bind(host);
  host.buildTileShader = (tileId, frag, log) => {
    tileIdForCall.current = tileId;
    return origBuild(tileId, frag, log);
  };
  return { wall, host, panes, tileIdForCall };
}

describe("shader fallback wall", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("healthy-wall-no-fallback", () => {
    const { wall, host, panes } = wall2x2();
    for (const [id, pane] of panes) {
      host.beginTilePack(id, `nixie:${id}`, "nixie-clock", pane, "Nixie", true);
      expect(host.buildTileShader(id, FRAG)).toBe(true);
    }
    let pushes = 0;
    const orig = host.pushPackFallbackText.bind(host);
    host.pushPackFallbackText = (...args) => {
      pushes++;
      return orig(...args);
    };
    for (let i = 0; i < 600; i++) {
      host.driveShaderFallbacks(frameAt(Date.now() + i * 16));
    }
    expect(wall.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    expect(pushes).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("isolated-tile-failure", () => {
    const failTiles = new Set(["t1"]);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 640 });
    Object.defineProperty(wall, "clientHeight", { value: 480 });
    const panes = new Map<string, HTMLElement>();
    for (const id of ["t1", "t2", "t3", "t4"]) {
      const p = document.createElement("div");
      panes.set(id, p);
      wall.appendChild(p);
    }
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const tileIdForCall = { current: "t1" };
    const mocked = mockGl(failTiles, tileIdForCall);
    vi.spyOn(host, "gl", "get").mockReturnValue(mocked.gl as WebGL2RenderingContext);
    Object.defineProperty(host, "software", { value: false });
    const origBuild = host.buildTileShader.bind(host);
    host.buildTileShader = (tileId, frag, log) => {
      tileIdForCall.current = tileId;
      return origBuild(tileId, frag, log);
    };
    for (const [id, pane] of panes) {
      host.beginTilePack(id, `p:${id}`, "nixie-clock", pane, "Pack", true);
      if (id === "t1") {
        expect(host.buildTileShader(id, FRAG)).toBe(false);
        host.mountShaderFallback(id);
      } else {
        expect(host.buildTileShader(id, FRAG)).toBe(true);
      }
    }
    for (let i = 0; i < 600; i++) {
      host.driveShaderFallbacks(frameAt(Date.now() + i * 16));
    }
    expect(panes.get("t1")!.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    for (const id of ["t2", "t3", "t4"]) {
      expect(panes.get(id)!.querySelectorAll(".tile-shader-fallback").length).toBe(0);
      expect(panes.get(id)!.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    }
    host.dispose();
    wall.remove();
  });

  it("pack-swap-clears-fallback", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const failTiles = new Set(["t1"]);
    const tileIdForCall = { current: "t1" };
    const mocked = mockGl(failTiles, tileIdForCall);
    vi.spyOn(host, "gl", "get").mockReturnValue(mocked.gl as WebGL2RenderingContext);
    Object.defineProperty(host, "software", { value: false });
    const origBuild = host.buildTileShader.bind(host);
    host.buildTileShader = (tileId, frag, log) => {
      tileIdForCall.current = tileId;
      return origBuild(tileId, frag, log);
    };
    host.beginTilePack("t1", "bad:1", "bad", pane, "Bad", false);
    expect(host.buildTileShader("t1", FRAG)).toBe(false);
    host.mountShaderFallback("t1");
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    failTiles.clear();
    host.beginTilePack("t1", "good:2", "nixie-clock", pane, "Good", true);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    const before = mocked.compileShader.mock.calls.length;
    expect(host.buildTileShader("t1", FRAG)).toBe(true);
    expect(mocked.compileShader.mock.calls.length - before).toBe(2);
    const after = mocked.compileShader.mock.calls.length;
    host.beginTilePack("t1", "good:2", "nixie-clock", pane, "Good", true);
    expect(host.buildTileShader("t1", FRAG)).toBe(true);
    expect(mocked.compileShader.mock.calls.length).toBe(after);
    host.dispose();
    wall.remove();
  });

  it("drive-writes-tile", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.beginTilePack("pane-b", "p:1", "nixie-clock", pane, "Nixie", true);
    host.mountShaderFallback("pane-b");
    host.pushPackFallbackText("pane-b", "X");
    expect(pane.querySelector(".tile-shader-fallback__text")?.textContent).toBe("X");
    host.dispose();
    wall.remove();
  });

  it("mosaic-tile-keyed", () => {
    const failTiles = new Set<string>();
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 640 });
    Object.defineProperty(wall, "clientHeight", { value: 480 });
    const panes = new Map<string, HTMLElement>();
    for (const id of ["t1", "t2"]) {
      const p = document.createElement("div");
      panes.set(id, p);
      wall.appendChild(p);
    }
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const tileIdForCall = { current: "t1" };
    const mocked = mockGl(failTiles, tileIdForCall);
    vi.spyOn(host, "gl", "get").mockReturnValue(mocked.gl as WebGL2RenderingContext);
    Object.defineProperty(host, "software", { value: false });
    const origBuild = host.buildTileShader.bind(host);
    host.buildTileShader = (tileId, frag, log) => {
      tileIdForCall.current = tileId;
      return origBuild(tileId, frag, log);
    };
    failTiles.add("t1");
    host.beginTilePack("t1", "k:t1", "nixie-clock", panes.get("t1")!, "N", true);
    expect(host.buildTileShader("t1", FRAG)).toBe(false);
    host.beginTilePack("t2", "k:t2", "nixie-clock", panes.get("t2")!, "N", true);
    const beforeT2 = mocked.compileShader.mock.calls.length;
    expect(host.buildTileShader("t2", FRAG)).toBe(true);
    expect(mocked.compileShader.mock.calls.length - beforeT2).toBe(2);
    host.dispose();
    wall.remove();
  });

  it("scene-mounts-fallback", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const failTiles = new Set(["pane-a"]);
    const tileIdForCall = { current: "pane-a" };
    const mocked = mockGl(failTiles, tileIdForCall);
    vi.spyOn(host, "gl", "get").mockReturnValue(mocked.gl as WebGL2RenderingContext);
    Object.defineProperty(host, "software", { value: false });
    const origBuild = host.buildTileShader.bind(host);
    host.buildTileShader = (tileId, frag, log) => {
      tileIdForCall.current = tileId;
      return origBuild(tileId, frag, log);
    };
    host.loadTileShader("pane-a", pane, FRAG, {
      packKey: "bad:1",
      packId: "nixie-clock",
      packName: "Nixie",
      supportsPackFallback: true,
    });
    expect(pane.querySelectorAll(".tile-shader-fallback")).toHaveLength(1);
    host.dispose();
    wall.remove();
  });

  it("fallback-survives-sky-reset", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const failTiles = new Set(["main"]);
    const tileIdForCall = { current: "main" };
    const mocked = mockGl(failTiles, tileIdForCall);
    vi.spyOn(host, "gl", "get").mockReturnValue(mocked.gl as WebGL2RenderingContext);
    Object.defineProperty(host, "software", { value: false });
    const origBuild = host.buildTileShader.bind(host);
    host.buildTileShader = (tileId, frag, log) => {
      tileIdForCall.current = tileId;
      return origBuild(tileId, frag, log);
    };
    const meta = {
      packKey: "k:1",
      packId: "nixie-clock",
      packName: "Nixie",
      supportsPackFallback: true,
    };
    expect(host.loadTileShader("main", pane, FRAG, meta)).toBe(false);
    expect(pane.querySelectorAll(".tile-shader-fallback")).toHaveLength(1);
    expect(host.loadTileShader("main", pane, FRAG, meta)).toBe(false);
    expect(pane.querySelectorAll(".tile-shader-fallback")).toHaveLength(1);
    host.dispose();
    wall.remove();
  });
});
