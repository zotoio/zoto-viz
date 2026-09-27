import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VizDataFrame } from "./viz-host";

const FRAME: VizDataFrame = {
  t: 0, dt: 0.016, audio: 0, packets: [], rf: [], talkers: [], headlines: [],
};

async function loadNixiePack(): Promise<{ fallbackText: (f: VizDataFrame) => string; onConfig: (c: Record<string, string>) => void }> {
  vi.resetModules();
  vi.stubGlobal("zoto", {
    writeBuffer: vi.fn(),
    writeUniform: vi.fn(),
    getConfig: () => ({}),
    onFrame: null,
    onConfig: null,
    fallbackText: null as ((frame: VizDataFrame) => string) | null,
  });
  await import("../../../plugins/src/nixie-clock/frontend/index");
  return globalThis.zoto as { fallbackText: (f: VizDataFrame) => string; onConfig: (c: Record<string, string>) => void };
}

async function loadTunnelPack(): Promise<{ fallbackText: (f: VizDataFrame) => string }> {
  vi.resetModules();
  vi.stubGlobal("zoto", {
    writeBuffer: vi.fn(),
    writeUniform: vi.fn(),
    fallbackText: null as ((frame: VizDataFrame) => string) | null,
    onFrame: null,
  });
  await import("../../../plugins/src/packet-tunnel/frontend/index");
  return globalThis.zoto as { fallbackText: (f: VizDataFrame) => string };
}

function sdkFallbackLoop(
  fallbackText: (frame: VizDataFrame) => string,
  frames: number,
  onPush: (text: string) => void,
): number {
  let last = "";
  let pushes = 0;
  for (let i = 0; i < frames; i++) {
    vi.advanceTimersByTime(16);
    const f = { ...FRAME, t: i * 0.016 };
    const s = String(fallbackText(f));
    if (s !== last) {
      last = s;
      pushes++;
      onPush(s);
    }
  }
  return pushes;
}

describe("shader fallback pack sdk", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 1, 5, 0, 0) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("nixie-pack-pushes", async () => {
    const push = vi.fn();
    const z = await loadNixiePack();
    expect(typeof z.fallbackText).toBe("function");
    const pushes = sdkFallbackLoop(z.fallbackText, 600, (t) => push(t));
    expect(pushes).toBe(10);
    expect(push.mock.calls.length).toBe(10);
  });

  it("nixie-pack-dedupe", async () => {
    const z = await loadNixiePack();
    const pushes = sdkFallbackLoop(z.fallbackText, 600, () => {});
    expect(pushes).toBe(10);
  });

  it("nixie-config-push", async () => {
    const push = vi.fn();
    const z = await loadNixiePack();
    sdkFallbackLoop(z.fallbackText, 600, (t) => push(t));
    expect(push.mock.calls.length).toBe(10);
    z.onConfig({ format: "24", seconds: "0" });
    vi.advanceTimersByTime(16);
    const line = String(z.fallbackText({ ...FRAME, t: 600 * 0.016 }));
    if (line !== push.mock.calls[9]![0]) push(line);
    expect(push.mock.calls.length).toBe(11);
  });

  it("tunnel-pack-pushes", async () => {
    const push = vi.fn();
    const z = await loadTunnelPack();
    expect(typeof z.fallbackText).toBe("function");
    const pushes = sdkFallbackLoop(z.fallbackText, 600, (t) => push(t));
    expect(pushes).toBe(27);
  });

  it("tunnel-pack-dedupe", async () => {
    const z = await loadTunnelPack();
    const pushes = sdkFallbackLoop(z.fallbackText, 600, () => {});
    expect(pushes).toBe(27);
  });
});
