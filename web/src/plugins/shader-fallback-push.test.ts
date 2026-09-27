import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "../graph/render-host";
import { TileShaderFallback } from "../graph/tile-shader-fallback";
import { genericShaderFallbackMessage } from "../graph/shader-fallback-copy";
import { FALLBACK_GRACE_FRAMES, trackTextWrites } from "../graph/shader-fallback-test-helpers";
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

function nixiePackPushLoop(
  push: (text: string) => void,
  look: ReturnType<typeof parseNixieLook>,
  frames: number,
): { pushes: number } {
  const now = new Date();
  const scratch = { h: 0, m: 0, s: 0 };
  const cache = { key: -1, text: "" };
  let lastPushed = "";
  let pushes = 0;
  const doPush = () => {
    now.setTime(Date.now());
    const line = formatNixieFallbackLine(now, look, scratch, cache);
    if (line === lastPushed) return;
    lastPushed = line;
    pushes++;
    push(line);
  };
  for (let i = 0; i < frames; i++) {
    vi.advanceTimersByTime(16);
    doPush();
  }
  return { pushes };
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
    host.beginTilePack("t", "k", "nixie-clock", wall, "Nixie");
    host.onTileShaderCompileFailed("t");
    const look = parseNixieLook({ format: "24", seconds: "1" });
    const { pushes } = nixiePackPushLoop((text) => {
      host.receiveFallbackPush("t", text);
    }, look, 600);
    expect(pushes).toBe(10);
    host.dispose();
    wall.remove();
  });

  it("push-on-frame-three", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const host = new RenderHost(mount);
    host.beginTilePack("t", "k", "demo", mount, "Demo");
    host.onTileShaderCompileFailed("t");
    drive(host, 2);
    host.receiveFallbackPush("t", "hello");
    drive(host, 10);
    const text = mount.querySelector(".tile-shader-fallback__text") as HTMLElement;
    expect(text.textContent).toBe("hello");
    expect(mount.querySelectorAll(".tile-shader-fallback-chip").length).toBe(1);
    mount.remove();
  });

  it("never-push-grace-generic", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const host = new RenderHost(mount);
    host.beginTilePack("t", "k", "demo", mount, "Quiet");
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
    const textEl = mount.querySelector(".tile-shader-fallback__text") as HTMLElement;
    const tracker = trackTextWrites(textEl);
    fb.pushPackText("same");
    for (let i = 0; i < 600; i++) fb.pushPackText("same");
    expect(tracker.writes).toBe(1);
    fb.dispose();
    mount.remove();
  });

  it("nixie-two-tile-amendment-a", () => {
    const mountA = document.createElement("div");
    const mountB = document.createElement("div");
    document.body.append(mountA, mountB);
    const host = new RenderHost(mountA);
    host.beginTilePack("a", "ka", "nixie-clock", mountA, "A");
    host.beginTilePack("b", "kb", "nixie-clock", mountB, "B");
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
    const textEl = mount.querySelector(".tile-shader-fallback__text") as HTMLElement;
    const tracker = trackTextWrites(textEl);
    now.setTime(Date.now());
    fb.pushPackText(formatNixieFallbackLine(now, lookOff, scratch, cache));
    fb.pushPackText(formatNixieFallbackLine(now, lookOn, scratch, cache));
    expect(tracker.writes).toBe(2);
    fb.dispose();
    mount.remove();
  });

  it("staged-push-before-fail-immediate", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const host = new RenderHost(pane);
    host.beginTilePack("t", "k", "nixie-clock", pane, "Nixie");
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
    const text = pane.querySelector(".tile-shader-fallback__text") as HTMLElement;
    expect(text.textContent).toBe("01 05 00");
    drive(host, FALLBACK_GRACE_FRAMES + 5);
    expect(text.textContent).toBe("01 05 00");
    pane.remove();
  });

  it("pack-push-same-id", () => {
    const mountA = document.createElement("div");
    const mountB = document.createElement("div");
    document.body.append(mountA, mountB);
    const host = new RenderHost(mountA);
    host.beginTilePack("a", "ka", "nixie-clock", mountA, "A");
    host.beginTilePack("b", "kb", "nixie-clock", mountB, "B");
    host.onTileShaderCompileFailed("a");
    host.onTileShaderCompileFailed("b");
    host.receiveFallbackPushForPack("nixie-clock", "01 05 00");
    expect(mountA.querySelector(".tile-shader-fallback__text")?.textContent).toBe("01 05 00");
    expect(mountB.querySelector(".tile-shader-fallback__text")?.textContent).toBe("01 05 00");
    host.dispose();
    mountA.remove();
    mountB.remove();
  });

  it("failed-tile-survives-restore", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    host.beginTilePack("t", "k", "nixie-clock", pane, "N");
    host.onTileShaderCompileFailed("t");
    const chip = pane.querySelector(".tile-shader-fallback-chip");
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(pane.contains(chip!)).toBe(true);
    expect(pane.querySelector(".tile-shader-fallback-chip")).toBe(chip);
    host.dispose();
    wall.remove();
  });

  it("tunnel-write-on-change", () => {
    let pushes = 0;
    let last = "";
    for (let i = 0; i < 600; i++) {
      const line = packetTunnelFallbackText({ t: i * 0.016, packets: [] });
      if (line !== last) {
        pushes++;
        last = line;
      }
    }
    expect(pushes).toBe(27);
  });
});
