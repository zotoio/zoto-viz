import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import {
  PluginSandbox,
  sandboxBootNonceForTests,
  setSandboxMsgTimeoutMs,
} from "./host";
import {
  resetSandboxFrameRuntimeForTests,
  sandboxZotoApi,
} from "./sandbox-frame";
import { installSandboxTestHandshake } from "./sandbox-test-harness";
import { defaultVizContract } from "./viz-host";
import type { VizWriteBatchPayload } from "./viz-write-batch";
import { validateVizWriteBatch } from "./viz-write-batch";

const FRAME_ID = "11111111-1111-4111-8111-111111111111";

function pluginDataUrl(body: string): string {
  const src = `const zoto = globalThis.zoto;\n${body}`;
  return `data:text/javascript,${encodeURIComponent(src)}`;
}

describe("sandbox write path (PluginSandbox + sandbox-frame port)", () => {
  beforeEach(() => {
    installSandboxTestHandshake();
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue(FRAME_ID);
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "tok-sandbox-e2e");
    resetSandboxFrameRuntimeForTests();
    setSandboxMsgTimeoutMs(2_000);
    (globalThis as unknown as { zoto: typeof sandboxZotoApi }).zoto = sandboxZotoApi;
  });

  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    vi.restoreAllMocks();
    setPackAssetTokenForTests("_sandbox", "");
    setSandboxMsgTimeoutMs(15_000);
    resetSandboxFrameRuntimeForTests();
  });

  it("boots over MessageChannel, batches multi-write onPresent, and applies slot-2 mesh buffers", async () => {
    const applySlot = vi.fn();
    const writeBatch = vi.fn((batch: VizWriteBatchPayload) => {
      for (const b of batch.buffers) {
        if (b.slot === 2) applySlot(b.slot, b.data, "host-mesh-demo");
      }
    });
    const box = new PluginSandbox();
    box.handlers = { writeBatch };

    const plugin = `
      zoto.onPresent = () => {
        zoto.writeBuffer(2, [1, 2, 3]);
        zoto.writeUniform("uMeshA", 1);
        zoto.writeUniform("uMeshB", 2);
      };
    `;

    await box.loadModuleUrl(
      pluginDataUrl(plugin),
      ["viz.write"],
      {},
      defaultVizContract({ presentTick: true }),
    );
    expect(sandboxBootNonceForTests()).not.toBe("");
    expect(box.sandboxHostPort()).not.toBeNull();

    box.deliverPresentTick(16, "host-mesh-demo");
    await expect.poll(
      () => writeBatch.mock.calls[0]?.[0],
      { timeout: 3_000 },
    ).toEqual({
      buffers: [{ slot: 2, data: [1, 2, 3] }],
      uniforms: [{ name: "uMeshA", value: 1 }, { name: "uMeshB", value: 2 }],
    });
    expect(applySlot).toHaveBeenCalledWith(2, [1, 2, 3], "host-mesh-demo");

    box.unload();
  });

  it("delivers writeBatch when a frame callback performs two buffer writes", async () => {
    const writeBatch = vi.fn();
    const singles: number[][] = [];
    const box = new PluginSandbox();
    box.handlers = {
      writeBatch,
      writeBuffer: (_slot, data) => singles.push(data),
    };

    const plugin = `
      zoto.onFrame = () => {
        zoto.writeBuffer(0, [9]);
        zoto.writeBuffer(1, [8]);
      };
    `;

    await box.loadModuleUrl(
      pluginDataUrl(plugin),
      ["viz.write", "viz.read"],
      {},
      defaultVizContract(),
    );
    box.frame({ packets: [], talkers: [], links: [], headlines: [] } as never);
    await expect.poll(
      () => writeBatch.mock.calls[0]?.[0],
      { timeout: 3_000 },
    ).toEqual({
      buffers: [{ slot: 0, data: [9] }, { slot: 1, data: [8] }],
      uniforms: [],
    });
    expect(singles).toHaveLength(0);

    box.unload();
  });

  it("splits 40 frame writes into consecutive host-legal writeBatch messages", async () => {
    const writeBatch = vi.fn();
    const writeBuffer = vi.fn();
    const box = new PluginSandbox();
    box.handlers = { writeBatch, writeBuffer };

    const plugin = `
      zoto.onFrame = () => {
        for (let i = 0; i < 40; i++) zoto.writeBuffer(i, [i]);
      };
    `;

    await box.loadModuleUrl(
      pluginDataUrl(plugin),
      ["viz.write", "viz.read"],
      {},
      defaultVizContract(),
    );
    box.frame({ packets: [], talkers: [], links: [], headlines: [] } as never);

    let applied = 0;
    await vi.waitFor(() => {
      applied = writeBatch.mock.calls.reduce((n, c) => n + c[0].buffers.length, 0)
        + writeBuffer.mock.calls.length;
      return applied === 40;
    }, { timeout: 3_000 });

    for (const call of writeBatch.mock.calls) {
      expect(validateVizWriteBatch(call[0]!)).toBeNull();
    }

    box.unload();
  });
});
