import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "../graph/render-host";
import { TileShaderFallback, FALLBACK_GRACE_FRAMES } from "../graph/tile-shader-fallback";
import { genericShaderFallbackMessage } from "../graph/shader-fallback-copy";
import {
  formatNixieFallbackLine,
  parseNixieLook,
} from "../../../plugins/src/nixie-clock/frontend/tubes";
import { packetTunnelFallbackText } from "../../../plugins/src/packet-tunnel/frontend/tunnel";
import type { VizDataFrame } from "./viz-host";

const EMPTY: VizDataFrame = {
  t: 0, dt: 0.016, audio: 0, packets: [], rf: [], talkers: [], headlines: [],
};

function drive(host: RenderHost, n: number): void {
  for (let i = 0; i < n; i++) host.driveShaderFallbacks(EMPTY);
}

/** Mirrors plugins/src/nixie-clock/frontend/index.ts push path. */
function nixiePackPushLoop(
  push: (text: string) => void,
  look: ReturnType<typeof parseNixieLook>,
  frames: number,
): { pushes: number; writes: number } {
  const now = new Date();
  const scratch = { h: 0, m: 0, s: 0 };
  const cache = { key: -1, text: "" };
  let lastPushed = "";
  let pushes = 0;
  let writes = 0;
  let lastWrite = "";
  const doPush = () => {
    now.setTime(Date.now());
    const line = formatNixieFallbackLine(now, look, scratch, cache);
    if (line === lastPushed) return;
    lastPushed = line;
    pushes++;
    if (line !== lastWrite) {
      writes++;
      lastWrite = line;
    }
    push(line);
  };
  for (let i = 0; i < frames; i++) {
    vi.advanceTimersByTime(16);
    doPush();
  }
  return { pushes, writes };
}

describe("shader fallback push contract", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 1, 5, 0, 0) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nixie-push-ten-writes", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "k", "nixie-clock", wall, "Nixie", true);
    host.onTileShaderCompileFailed("t");
    const look = parseNixieLook({ format: "24", seconds: "1" });
    const hostWrites: string[] = [];
    const { pushes, writes } = nixiePackPushLoop((text) => {
      host.receiveFallbackPush("t", text);
      const el = wall.querySelector(".tile-shader-fallback__text");
      if (el && el.textContent !== hostWrites[hostWrites.length - 1]) hostWrites.push(el.textContent ?? "");
    }, look, 600);
    expect(pushes).toBe(10);
    expect(writes).toBe(10);
    expect(hostWrites.length).toBe(10);
    host.dispose();
    wall.remove();
  });

  it("push-on-frame-three", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const host = new RenderHost(mount);
    host.beginTilePack("t", "k", "demo", mount, "Demo", true);
    host.onTileShaderCompileFailed("t");
    drive(host, 2);
    host.receiveFallbackPush("t", "hello");
    drive(host, 10);
    const fb = mount.querySelector(".tile-shader-fallback")!;
    expect(fb.textContent).not.toContain(genericShaderFallbackMessage("Demo"));
    expect((fb.querySelector(".tile-shader-fallback__text") as HTMLElement).textContent).toBe("hello");
    expect(fb.querySelectorAll(".tile-shader-fallback-chip").length).toBe(1);
    mount.remove();
  });

  it("never-push-grace-generic", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const host = new RenderHost(mount);
    host.beginTilePack("t", "k", "demo", mount, "Quiet", true);
    host.onTileShaderCompileFailed("t");
    drive(host, FALLBACK_GRACE_FRAMES - 1);
    expect(mount.querySelector(".tile-shader-fallback__text")?.textContent ?? "").toBe("");
    expect(mount.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    drive(host, 1);
    expect(mount.querySelector(".tile-shader-fallback__text")?.textContent)
      .toBe(genericShaderFallbackMessage("Quiet"));
    expect(mount.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    mount.remove();
  });

  it("identical-pushes-one-write", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fb = new TileShaderFallback(mount, { packName: "P", packPush: true });
    fb.pushPackText("same");
    for (let i = 0; i < 600; i++) fb.pushPackText("same");
    expect(fb.writes).toBe(1);
    fb.dispose();
    mount.remove();
  });

  it("nixie-two-tile-amendment-a", () => {
    const mountA = document.createElement("div");
    const mountB = document.createElement("div");
    document.body.append(mountA, mountB);
    const host = new RenderHost(mountA);
    host.beginTilePack("a", "ka", "nixie-clock", mountA, "A", true);
    host.beginTilePack("b", "kb", "nixie-clock", mountB, "B", true);
    host.onTileShaderCompileFailed("a");
    host.onTileShaderCompileFailed("b");
    const lookOff = parseNixieLook({ seconds: "0" });
    const lookOn = parseNixieLook({ seconds: "1" });
    const nowA = new Date();
    const nowB = new Date();
    const scratchA = { h: 0, m: 0, s: 0 };
    const scratchB = { h: 0, m: 0, s: 0 };
    const cacheA = { key: -1, text: "" };
    const cacheB = { key: -1, text: "" };
    nowA.setTime(Date.now());
    nowB.setTime(Date.now());
    host.receiveFallbackPush("a", formatNixieFallbackLine(nowA, lookOff, scratchA, cacheA));
    host.receiveFallbackPush("b", formatNixieFallbackLine(nowB, lookOn, scratchB, cacheB));
    expect(mountA.querySelector(".tile-shader-fallback__text")?.textContent).toBe("01 05");
    expect(mountB.querySelector(".tile-shader-fallback__text")?.textContent).toBe("01 05 00");
    mountA.remove();
    mountB.remove();
  });

  it("nixie-hour12-key-one-push", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 13, 5, 0, 0));
    const look12 = parseNixieLook({ format: "12", seconds: "0" });
    const look24 = parseNixieLook({ format: "24", seconds: "0" });
    const now = new Date();
    const scratch = { h: 0, m: 0, s: 0 };
    const cache = { key: -1, text: "" };
    let pushes = 0;
    let lastPushed = "";
    const maybePush = (look: ReturnType<typeof parseNixieLook>) => {
      now.setTime(Date.now());
      const line = formatNixieFallbackLine(now, look, scratch, cache);
      if (line === lastPushed) return line;
      lastPushed = line;
      pushes++;
      return line;
    };
    expect(maybePush(look24)).toBe("13 05");
    for (let i = 0; i < 120; i++) {
      vi.advanceTimersByTime(16);
      maybePush(look24);
    }
    expect(pushes).toBe(1);
    expect(maybePush(look12)).toBe("01 05");
    expect(pushes).toBe(2);
  });

  it("nixie-seconds-key-one-write", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 1, 5, 0, 0));
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fb = new TileShaderFallback(mount, { packName: "N", packPush: true });
    const lookOff = parseNixieLook({ seconds: "0" });
    const lookOn = parseNixieLook({ seconds: "1" });
    const now = new Date();
    const scratch = { h: 0, m: 0, s: 0 };
    const cache = { key: -1, text: "" };
    now.setTime(Date.now());
    fb.pushPackText(formatNixieFallbackLine(now, lookOff, scratch, cache));
    fb.pushPackText(formatNixieFallbackLine(now, lookOn, scratch, cache));
    expect(fb.writes).toBe(2);
    fb.dispose();
    mount.remove();
  });

  it("failed-tile-survives-restore", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    const rd = host.renderer as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const log = vi.fn();
    const compile = vi.fn(() => {
      host.tileSlot("t").latch.fail("compile error", log);
    });
    rd.compile = compile as typeof rd.compile;
    host.beginTilePack("t", "k", "nixie-clock", pane, "Nixie", true);
    expect(host.compilePluginSky("t", scene, camera, log)).toBe(false);
    host.onTileShaderCompileFailed("t");
    host.receiveFallbackPush("t", "01 05 00");
    const chipBefore = pane.querySelector(".tile-shader-fallback-chip");
    const textEl = pane.querySelector(".tile-shader-fallback__text") as HTMLElement & { __writes?: number };
    const writesBefore = textEl.__writes ?? 0;
    const graceBefore = host.fallbackGraceFrames("t");
    const generic = genericShaderFallbackMessage("Nixie");
    for (let cycle = 0; cycle < 3; cycle++) {
      host.dispatchContextLost();
      host.dispatchContextRestored();
      compile.mockClear();
      expect(host.compilePluginSky("t", scene, camera, log)).toBe(false);
      expect(compile).toHaveBeenCalledTimes(1);
      expect(pane.querySelector(".tile-shader-fallback-chip")).toBe(chipBefore);
      expect(host.fallbackGraceFrames("t")).toBe(graceBefore);
      expect(textEl.__writes ?? 0).toBe(writesBefore);
      expect(pane.textContent).not.toContain(generic);
    }
    host.dispose();
    wall.remove();
  });

  it("healthy-tile-ignores-push", () => {
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
    vi.spyOn(host, "compilePluginSky").mockReturnValue(true);
    const look = parseNixieLook({ format: "24", seconds: "1" });
    for (const [id, pane] of panes) {
      host.beginTilePack(id, `k:${id}`, "nixie-clock", pane, "Nixie", true);
      expect(host.compilePluginSky(id, {} as never, {} as never)).toBe(true);
    }
    for (const id of panes.keys()) {
      vi.setSystemTime(new Date(2026, 0, 1, 1, 5, 0, 0));
      let pushes = 0;
      nixiePackPushLoop((text) => {
        pushes++;
        host.receiveFallbackPush(id, text);
      }, look, 600);
      expect(pushes).toBe(10);
    }
    for (const pane of panes.values()) {
      expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
      expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    }
    for (const id of panes.keys()) {
      expect(host.fallbackGraceFrames(id)).toBe(0);
    }
    host.dispose();
    wall.remove();
  });

  it("staged-push-before-fail-immediate", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const host = new RenderHost(pane);
    host.beginTilePack("t", "k", "nixie-clock", pane, "Nixie", true);
    const look = parseNixieLook({ format: "24", seconds: "1" });
    const now = new Date();
    const scratch = { h: 0, m: 0, s: 0 };
    const cache = { key: -1, text: "" };
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(16);
      now.setTime(Date.now());
      host.receiveFallbackPush("t", formatNixieFallbackLine(now, look, scratch, cache));
    }
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    for (let i = 0; i < 95; i++) drive(host, 1);
    host.onTileShaderCompileFailed("t");
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    const text = pane.querySelector(".tile-shader-fallback__text") as HTMLElement & { __writes?: number };
    expect(text.textContent).toMatch(/01 05/);
    expect(text.__writes ?? 0).toBe(1);
    expect(pane.textContent).not.toContain(genericShaderFallbackMessage("Nixie"));
    drive(host, FALLBACK_GRACE_FRAMES + 5);
    expect(text.__writes ?? 0).toBe(1);
    pane.remove();
  });

  it("tunnel-idle-fake-clock", () => {
    const frame: VizDataFrame = { ...EMPTY, t: 1000 };
    let pushes = 0;
    let last = "";
    for (let i = 0; i < 600; i++) {
      const line = packetTunnelFallbackText(frame);
      if (line !== last) {
        pushes++;
        last = line;
      }
    }
    expect(pushes).toBe(1);
  });
});
