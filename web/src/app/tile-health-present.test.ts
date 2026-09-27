import { describe, expect, it, vi } from "vitest";
import type { TileHealthMonitor } from "../plugins/tile-health-monitor";
import { bindTileHealthPresentTick } from "./tile-health-present";

describe("tile health present tick", () => {
  it("bindTileHealthPresentTick registers a present listener that ticks tile health", () => {
    const tick = vi.fn();
    const tileHealth = { tick } as TileHealthMonitor;
    const listeners: Array<(ts: number) => void> = [];
    bindTileHealthPresentTick(tileHealth, (fn) => {
      listeners.push(fn);
    });
    expect(listeners).toHaveLength(1);
    listeners[0]!(1234);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledWith(1234);
  });
});
