import { describe, expect, it, vi } from "vitest";
import { handleSandboxHostMessage, type SandboxZoto, type VizPresentTick } from "./sandbox-frame";

function stubZoto(over: Partial<SandboxZoto> = {}): SandboxZoto {
  return {
    onTick: null,
    onConfig: null,
    onFrame: null,
    onPresent: null,
    setStyle: vi.fn(),
    setNodeColor: vi.fn(),
    writeBuffer: vi.fn(),
    writeUniform: vi.fn(),
    writeParticles: vi.fn(),
    getConfig: () => ({}),
    ...over,
  };
}

describe("sandbox-frame present tick", () => {
  it("forwards host present messages to zoto.onPresent with the tick object", () => {
    const tick: VizPresentTick = { frameMs: 42.5, tileId: "plugin:backrooms", pluginClock: 1.25 };
    let seen: VizPresentTick | null = null;
    const api = stubZoto({ onPresent: (t) => { seen = t; } });
    const caps = new Set(["viz.write"]);
    handleSandboxHostMessage(
      { source: "zoto-viz-host", type: "present", tick },
      caps,
      api,
    );
    expect(seen).toBe(tick);
  });

  it("no-ops when onPresent is unset", () => {
    const tick: VizPresentTick = { frameMs: 0, tileId: "" };
    const api = stubZoto({ onPresent: null });
    expect(() => handleSandboxHostMessage(
      { source: "zoto-viz-host", type: "present", tick },
      new Set(["viz.write"]),
      api,
    )).not.toThrow();
  });

  it("ignores present when viz.write is not allowed", () => {
    const tick: VizPresentTick = { frameMs: 1, tileId: "plugin:a" };
    const onPresent = vi.fn();
    handleSandboxHostMessage(
      { source: "zoto-viz-host", type: "present", tick },
      new Set(["viz.read"]),
      stubZoto({ onPresent }),
    );
    expect(onPresent).not.toHaveBeenCalled();
  });
});
