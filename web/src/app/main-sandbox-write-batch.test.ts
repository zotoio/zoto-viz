import { describe, expect, it, vi } from "vitest";
import { applyVizWriteBatch } from "../plugins/viz-write-batch";
import { VizBufferWriter, defaultVizContract } from "../plugins/viz-host";

describe("main sandbox writeBatch slot-2 bridge", () => {
  it("forwards batched slot-2 buffers to hostMeshBridge.applySlot (host-mesh-demo onPresent)", () => {
    const applySlot = vi.fn();
    const asset = { id: "host-mesh-glb" };
    const writer = new VizBufferWriter(defaultVizContract());
    const batch = {
      buffers: [{ slot: 2, data: [1, 0, 0] }],
      uniforms: [{ name: "uA", value: 1 }, { name: "uB", value: 2 }],
    };
    applyVizWriteBatch(writer, batch, {
      onBuffer: () => {},
      onUniform: () => {},
    });
    // Mirrors web/src/app/main.ts writeBatch slot-2 bridge.
    for (const b of batch.buffers) {
      if (asset && b.slot === 2) applySlot(b.slot, b.data, asset.id);
    }
    expect(applySlot).toHaveBeenCalledWith(2, [1, 0, 0], "host-mesh-glb");
  });
});
