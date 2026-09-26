import { beforeEach, describe, expect, it } from "vitest";
import { packFallbackText } from "./viz-pack-fallback";
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

  it("nixie-text", () => {
    const at105 = new Date(2026, 0, 1, 1, 5, 0, 0).getTime();
    const fn = packFallbackText("nixie-clock", { format: "24", seconds: "1" })!;
    const fn12 = packFallbackText("nixie-clock", { format: "12", seconds: "0" })!;
    expect(fn(frameAt(at105))).toBe("01 05 00");
    const midnight = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
    expect(fn12(frameAt(midnight))).toBe("12 00");
  });

  it("nixie-write-on-change", () => {
    const fn = packFallbackText("nixie-clock", { format: "24", seconds: "1" })!;
    const t0 = new Date(2026, 0, 1, 1, 5, 0, 0).getTime();
    let builds = 0;
    let last = "";
    for (let i = 0; i < 600; i++) {
      const next = fn(frameAt(t0 + i * 16));
      if (next !== last) {
        builds++;
        last = next;
      }
    }
    expect(builds).toBe(10);
    const fnNoSec = packFallbackText("nixie-clock", { format: "24", seconds: "0" })!;
    builds = 0;
    last = "";
    for (let i = 0; i < 600; i++) {
      const next = fnNoSec(frameAt(t0 + i * 16));
      if (next !== last) {
        builds++;
        last = next;
      }
    }
    expect(builds).toBe(1);
  });
});
