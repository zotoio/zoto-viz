import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { SHADER_FALLBACK_CHIP_CLASS, SHADER_FALLBACK_CLASS } from "./tile-shader-fallback";
import { packFallbackText } from "../plugins/viz-pack-fallback";
import type { VizDataFrame } from "../plugins/viz-host";
import * as tubes from "../../../plugins/src/nixie-clock/frontend/tubes";

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
  const getShaderInfoLog = vi.fn(() => "err");
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
    getShaderParameter: () => !failTiles.has(tileIdForCall.current),
    getProgramParameter: (_p: unknown, p: number) => (p === LINK_STATUS),
    getShaderInfoLog,
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

  it("nixie-per-tile-cache", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const m1 = document.createElement("div");
    const m2 = document.createElement("div");
    const fnOff = packFallbackText("nixie-clock", { seconds: "0" })!;
    const fnOn = packFallbackText("nixie-clock", { seconds: "1" })!;
    host.beginTilePack("a", "nixie:off", m1, "Nixie", fnOff);
    host.beginTilePack("b", "nixie:on", m2, "Nixie", fnOn);
    host.showCompileFallback("a");
    host.showCompileFallback("b");
    const t105 = new Date(2026, 0, 1, 1, 5, 0, 0).getTime();
    expect(fnOff(frameAt(t105))).toBe("01 05");
    expect(fnOn(frameAt(t105))).toBe("01 05 00");
    const formatSpy = vi.spyOn(tubes, "formatNixieFallbackLine");
    let buildsA = 0;
    let buildsB = 0;
    let lastA = "";
    let lastB = "";
    const RealDate = Date;
    let dateNews = 0;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: [] | [number]) => {
      dateNews++;
      return new RealDate(...(args as [number]));
    });
    for (let i = 0; i < 600; i++) {
      const f = frameAt(t105 + i * 16);
      const a = fnOff(f);
      if (a !== lastA) {
        buildsA++;
        lastA = a;
      }
      const b = fnOn(f);
      if (b !== lastB) {
        buildsB++;
        lastB = b;
      }
      host.driveShaderFallback("a", f);
      host.driveShaderFallback("b", f);
    }
    expect(formatSpy.mock.calls.length).toBeGreaterThan(0);
    expect(buildsA).toBe(1);
    expect(buildsB).toBe(10);
    expect(dateNews).toBe(0);
    formatSpy.mockRestore();
    vi.mocked(globalThis.Date).mockRestore();
    host.dispose();
    wall.remove();
  });

  it("healthy-wall-no-fallback", () => {
    const { wall, host, panes } = wall2x2();
    let packCalls = 0;
    for (const [id, pane] of panes) {
      const fn = packFallbackText("nixie-clock", { seconds: "1" });
      const wrapped = (f: VizDataFrame) => {
        packCalls++;
        return fn!(f);
      };
      host.beginTilePack(id, `nixie:${id}`, pane, "Nixie", wrapped);
      expect(host.buildTileShader(id, FRAG)).toBe(true);
    }
    const t0 = Date.now();
    for (let i = 0; i < 600; i++) {
      const f = frameAt(t0 + i * 16);
      for (const id of panes.keys()) host.driveShaderFallback(id, f);
    }
    expect(wall.querySelectorAll(`.${SHADER_FALLBACK_CLASS}`).length).toBe(0);
    expect(packCalls).toBe(0);
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
      host.beginTilePack(id, `p:${id}`, pane, "Pack", packFallbackText("nixie-clock"));
      if (id === "t1") {
        expect(host.buildTileShader(id, FRAG)).toBe(false);
        host.showCompileFallback(id);
      } else {
        expect(host.buildTileShader(id, FRAG)).toBe(true);
      }
    }
    let deliveries = 0;
    const t0 = Date.now();
    for (let i = 0; i < 600; i++) {
      const f = frameAt(t0 + i * 16);
      for (const id of ["t2", "t3", "t4"]) {
        host.driveShaderFallback(id, f);
        deliveries++;
      }
    }
    expect(deliveries).toBe(1800);
    expect(panes.get("t1")!.querySelectorAll(`.${SHADER_FALLBACK_CLASS}`).length).toBe(1);
    for (const id of ["t2", "t3", "t4"]) {
      expect(panes.get(id)!.querySelectorAll(`.${SHADER_FALLBACK_CLASS}`).length).toBe(0);
      expect(panes.get(id)!.querySelectorAll(`.${SHADER_FALLBACK_CHIP_CLASS}`).length).toBe(0);
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
    host.beginTilePack("t1", "bad:1", pane, "Bad", undefined);
    expect(host.buildTileShader("t1", FRAG)).toBe(false);
    host.showCompileFallback("t1");
    expect(pane.querySelectorAll(`.${SHADER_FALLBACK_CLASS}`).length).toBe(1);
    failTiles.clear();
    host.beginTilePack("t1", "good:2", pane, "Good", packFallbackText("nixie-clock"));
    expect(pane.querySelectorAll(`.${SHADER_FALLBACK_CLASS}`).length).toBe(0);
    expect(pane.querySelectorAll(`.${SHADER_FALLBACK_CHIP_CLASS}`).length).toBe(0);
    const before = mocked.compileShader.mock.calls.length;
    expect(host.buildTileShader("t1", FRAG)).toBe(true);
    expect(mocked.compileShader.mock.calls.length - before).toBe(2);
    const after = mocked.compileShader.mock.calls.length;
    host.beginTilePack("t1", "good:2", pane, "Good", packFallbackText("nixie-clock"));
    expect(host.buildTileShader("t1", FRAG)).toBe(true);
    expect(mocked.compileShader.mock.calls.length).toBe(after);
    host.dispose();
    wall.remove();
  });
});
