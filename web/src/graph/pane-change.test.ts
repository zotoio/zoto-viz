import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { bytesDiffer, CanvasChangeProbe, probeLines } from "./pane-change";

describe("pack-mirror brands", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("wires pack-mirror brands in probe API (import + DeviceRect param + GlRect ProbeRect)", () => {
    const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "pane-change.ts"), "utf8");
    expect(text.includes('import type { DeviceRect, GlRect } from "./pack-mirror-rect"')).toBe(
      true,
    );
    expect(text.includes("rect?: DeviceRect | null")).toBe(true);
    expect(text.includes("export type ProbeRect = GlRect")).toBe(true);
  });
});

describe("bytesDiffer", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("is false for an identical patch and true when any byte changes", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    expect(bytesDiffer(a, [1, 2, 3, 4])).toBe(false);
    expect(bytesDiffer(a, [1, 2, 3, 5])).toBe(true);
  });
});

describe("probeLines", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("crosses the whole pane with three rows and three columns, clipped to the buffer", () => {
    const lines = probeLines({ x: 100, y: 50, w: 600, h: 300 }, 640, 400);
    expect(lines).toHaveLength(6);
    const rows = lines.filter((l) => l.h === 1);
    const cols = lines.filter((l) => l.w === 1);
    expect(rows.map((r) => r.y)).toEqual([100, 200, 300]);
    expect(rows.every((r) => r.x === 100 && r.w === 540)).toBe(true);
    expect(cols.map((c) => c.x)).toEqual([190, 370, 550]);
    expect(cols.every((c) => c.y === 50 && c.h === 300)).toBe(true);
    expect(probeLines({ x: 0, y: 0, w: 1, h: 1 }, 640, 400)).toEqual([]);
  });
});

describe("CanvasChangeProbe", () => {
  it("ignores the first sample and counts the next differing patch", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#112233";
    ctx.fillRect(0, 0, 32, 32);
    const probe = new CanvasChangeProbe();
    expect(probe.sample(ctx, canvas)).toBe(false);
    expect(probe.sample(ctx, canvas)).toBe(false);
    ctx.fillStyle = "#ff00aa";
    ctx.fillRect(0, 0, 32, 32);
    expect(probe.sample(ctx, canvas)).toBe(true);
  });
});
