import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame } from "../../../sdk/viz-contract";

type Host = {
  getConfig: () => Record<string, string>;
  writeBuffer: ReturnType<typeof vi.fn>;
  writeUniform: ReturnType<typeof vi.fn>;
  onFrame?: (f: VizDataFrame) => void;
  onConfig?: (c: Record<string, string>) => void;
};

const talkers = [
  { id: "10.0.0.1", rate: 180, role: "gateway" },
  { id: "10.0.0.42", rate: 120, role: "lan" },
];
const frame = (t: number): VizDataFrame => ({
  t, dt: 1 / 60, audio: 0.2, talkers, packets: [], sys: EMPTY_SYS_TELEMETRY,
} as unknown as VizDataFrame);

describe("koi-pond boot", () => {
  afterEach(() => {
    delete (globalThis as { zoto?: unknown }).zoto;
    vi.resetModules();
  });

  it("writes moving host-mesh slots over N frames with no onConfig post (koi swim)", async () => {
    const host: Host = {
      getConfig: () => ({ modelGlb: "host" }),
      writeBuffer: vi.fn(),
      writeUniform: vi.fn(),
    };
    (globalThis as { zoto?: unknown }).zoto = host;
    await import("./index");
    const seen = new Map<number, string[]>();
    for (let i = 0; i < 30; i++) {
      host.onFrame!(frame(1 + i / 10));
      for (const [slot, data] of host.writeBuffer.mock.calls as [number, ArrayLike<number>][]) {
        if (slot < 3) continue;
        const k = Array.from(data).join(",");
        (seen.get(slot) ?? seen.set(slot, []).get(slot)!).push(k);
      }
      host.writeBuffer.mockClear();
    }
    expect(seen.size).toBeGreaterThan(0);
    const advanced = [...seen.values()].some((v) => new Set(v).size > 1);
    expect(advanced).toBe(true);
  });
});
