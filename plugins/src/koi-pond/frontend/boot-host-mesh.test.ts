import { afterEach, describe, expect, it, vi } from "vitest";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { demoFrame } from "./koi-pond";

type FakeHost = {
  getConfig: () => Record<string, string>;
  writeBuffer: ReturnType<typeof vi.fn>;
  writeUniform: ReturnType<typeof vi.fn>;
  onFrame?: (f: VizDataFrame) => void;
  onConfig?: (c: Record<string, string>) => void;
};

describe("koi-pond boot", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "zoto");
    vi.resetModules();
  });

  it("writes moving host-mesh slots over N frames with no onConfig post (koi swim)", async () => {
    const host: FakeHost = {
      getConfig: () => ({ modelGlb: "host" }),
      writeBuffer: vi.fn(),
      writeUniform: vi.fn(),
    };
    Reflect.set(globalThis, "zoto", host);
    await import("./index");
    const seen = new Map<number, Set<string>>();
    for (let i = 0; i < 30; i++) {
      host.onFrame?.(demoFrame(1 + i / 10));
      for (const [slot, data] of host.writeBuffer.mock.calls) {
        if (typeof slot !== "number" || slot < 4) continue;
        const k = Array.prototype.join.call(data, ",");
        if (!seen.has(slot)) seen.set(slot, new Set());
        seen.get(slot)?.add(k);
      }
      host.writeBuffer.mockClear();
    }
    expect(seen.size).toBeGreaterThan(0);
    expect([...seen.values()].some((v) => v.size > 1)).toBe(true);
  });
});
