import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatNixieFallbackLine,
  parseNixieLook,
} from "../../../plugins/src/nixie-clock/frontend/tubes";
import { TileShaderFallback } from "../graph/tile-shader-fallback";
import type { VizDataFrame } from "./viz-host";

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

describe("nixie shader fallback text", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nixie-text", () => {
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 1, 5, 0, 0) });
    const look24sec = parseNixieLook({ format: "24", seconds: "1" });
    const look12 = parseNixieLook({ format: "12", seconds: "0" });
    const scratch = { h: 0, m: 0, s: 0 };
    const cache = { key: -1, text: "" };
    const now = new Date();
    now.setTime(Date.now());
    expect(formatNixieFallbackLine(now, look24sec, scratch, cache)).toBe("01 05 00");
    vi.setSystemTime(new Date(2026, 0, 1, 1, 5, 30, 0));
    now.setTime(Date.now());
    const cacheNoSec = { key: -1, text: "" };
    expect(formatNixieFallbackLine(now, parseNixieLook({ format: "24", seconds: "0" }), scratch, cacheNoSec))
      .toBe("01 05");
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, 0));
    now.setTime(Date.now());
    expect(formatNixieFallbackLine(now, look12, scratch, { key: -1, text: "" })).toBe("12 00");
  });

  it("nixie-write-on-change-dom", () => {
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 1, 5, 0, 0) });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fb = new TileShaderFallback(mount, { packName: "Nixie", showChip: true });
    const node = mount.querySelector(".tile-shader-fallback__text") as HTMLSpanElement;
    let builds = 0;
    let last = "";
    for (let i = 0; i < 600; i++) {
      vi.advanceTimersByTime(16);
      const next = formatNixieFallbackLine(
        new Date(Date.now()),
        parseNixieLook({ format: "24", seconds: "1" }),
        { h: 0, m: 0, s: 0 },
        { key: -1, text: "" },
      );
      if (next !== last) {
        fb.pushPackText(next);
        builds++;
        last = next;
      }
    }
    expect(builds).toBe(10);
    expect(node.isConnected).toBe(true);
    expect(node).toBe(mount.querySelector(".tile-shader-fallback__text"));
    fb.dispose();
    const fb2 = new TileShaderFallback(mount, { packName: "Nixie", showChip: true });
    const node2 = mount.querySelector(".tile-shader-fallback__text") as HTMLSpanElement;
    const lookNoSec = parseNixieLook({ format: "24", seconds: "0" });
    const cache = { key: -1, text: "" };
    const scratch = { h: 0, m: 0, s: 0 };
    const now = new Date();
    builds = 0;
    last = "";
    for (let i = 0; i < 600; i++) {
      vi.advanceTimersByTime(16);
      now.setTime(Date.now());
      const next = formatNixieFallbackLine(now, lookNoSec, scratch, cache);
      if (next !== last) {
        fb2.pushPackText(next);
        builds++;
        last = next;
      }
    }
    expect(builds).toBe(1);
    expect(node2.isConnected).toBe(true);
    expect(node2).toBe(mount.querySelector(".tile-shader-fallback__text"));
    fb2.dispose();
    mount.remove();
  });

  it("nixie-write-on-change", () => {
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 1, 5, 0, 0) });
    const lookSec = parseNixieLook({ format: "24", seconds: "1" });
    const scratch = { h: 0, m: 0, s: 0 };
    const cache = { key: -1, text: "" };
    const now = new Date();
    const line = () => {
      now.setTime(Date.now());
      return formatNixieFallbackLine(now, lookSec, scratch, cache);
    };
    let builds = 0;
    let last = "";
    for (let i = 0; i < 600; i++) {
      vi.advanceTimersByTime(16);
      const next = line();
      if (next !== last) {
        builds++;
        last = next;
      }
    }
    expect(builds).toBe(10);
    const cacheNoSec = { key: -1, text: "" };
    builds = 0;
    last = "";
    const lookNoSec = parseNixieLook({ format: "24", seconds: "0" });
    for (let i = 0; i < 600; i++) {
      vi.advanceTimersByTime(16);
      now.setTime(Date.now());
      const next = formatNixieFallbackLine(now, lookNoSec, scratch, cacheNoSec);
      if (next !== last) {
        builds++;
        last = next;
      }
    }
    expect(builds).toBe(1);
  });

  it("nixie-per-tile-cache", () => {
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 1, 5, 0, 0) });
    const lookOff = parseNixieLook({ seconds: "0" });
    const lookOn = parseNixieLook({ seconds: "1" });
    const scratchA = { h: 0, m: 0, s: 0 };
    const scratchB = { h: 0, m: 0, s: 0 };
    const cacheA = { key: -1, text: "" };
    const cacheB = { key: -1, text: "" };
    const nowA = new Date();
    const nowB = new Date();
    const fnOff = () => {
      nowA.setTime(Date.now());
      return formatNixieFallbackLine(nowA, lookOff, scratchA, cacheA);
    };
    const fnOn = () => {
      nowB.setTime(Date.now());
      return formatNixieFallbackLine(nowB, lookOn, scratchB, cacheB);
    };
    expect(fnOff()).toBe("01 05");
    expect(fnOn()).toBe("01 05 00");
    let buildsA = 0;
    let buildsB = 0;
    let lastA = "";
    let lastB = "";
    let setTimes = 0;
    const origSetTime = Date.prototype.setTime;
    vi.spyOn(Date.prototype, "setTime").mockImplementation(function (this: Date, ...args: [number]) {
      setTimes++;
      return origSetTime.apply(this, args);
    });
    for (let i = 0; i < 600; i++) {
      vi.advanceTimersByTime(16);
      const a = fnOff();
      if (a !== lastA) {
        buildsA++;
        lastA = a;
      }
      const b = fnOn();
      if (b !== lastB) {
        buildsB++;
        lastB = b;
      }
    }
    expect(buildsA).toBe(1);
    expect(buildsB).toBe(10);
    expect(setTimes).toBe(1200);
    vi.mocked(Date.prototype.setTime).mockRestore();
  });
});
