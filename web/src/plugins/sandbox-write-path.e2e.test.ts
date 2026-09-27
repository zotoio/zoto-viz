import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import {
  PluginSandbox,
  sandboxBootNonceForTests,
  setSandboxBootWaitInTests,
  setSandboxMsgTimeoutMs,
} from "./host";
import { HOST_SOURCE, PLUGIN_SOURCE } from "./sandbox-channel";
import {
  attachSandboxHostPort,
  installSandboxBootChannelListener,
  resetSandboxFrameRuntimeForTests,
  sandboxFrameRuntimeForTests,
  sandboxZotoApi,
  setSandboxFrameLocationHref,
} from "./sandbox-frame";
import { defaultVizContract } from "./viz-host";
import type { VizWriteBatchPayload } from "./viz-write-batch";

const FRAME_ID = "11111111-1111-4111-8111-111111111111";

function pluginDataUrl(body: string): string {
  const src = `const zoto = globalThis.zoto;\n${body}`;
  return `data:text/javascript,${encodeURIComponent(src)}`;
}

function armSandboxHandshake(): () => void {
  const OrigChannel = globalThis.MessageChannel;
  const appendOrig = document.body.appendChild.bind(document.body);
  const appendSpy = vi.spyOn(document.body, "appendChild").mockImplementation((node: Node) => {
    const inserted = appendOrig(node);
    if (node instanceof HTMLIFrameElement) {
      setSandboxFrameLocationHref(node.src);
      const win = node.contentWindow;
      if (win) {
        installSandboxBootChannelListener(win, window);
        (win as unknown as { zoto: typeof sandboxZotoApi }).zoto = sandboxZotoApi;
      }
      queueMicrotask(() => {
        window.dispatchEvent(new MessageEvent("message", {
          source: node.contentWindow,
          data: { source: PLUGIN_SOURCE, type: "frame-ready" },
        }));
      });
    }
    return inserted;
  });
  const channelSpy = vi.spyOn(globalThis, "MessageChannel").mockImplementation(function messageChannelMock() {
    const ch = new OrigChannel();
    attachSandboxHostPort(ch.port2, sandboxFrameRuntimeForTests(), sandboxZotoApi);
    return ch;
  });
  return () => {
    channelSpy.mockRestore();
    appendSpy.mockRestore();
  };
}

describe("sandbox write path (PluginSandbox + sandbox-frame port)", () => {
  beforeEach(() => {
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue(FRAME_ID);
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "tok-sandbox-e2e");
    resetSandboxFrameRuntimeForTests();
    setSandboxBootWaitInTests(true);
    setSandboxMsgTimeoutMs(2_000);
    (globalThis as unknown as { zoto: typeof sandboxZotoApi }).zoto = sandboxZotoApi;
  });

  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    vi.restoreAllMocks();
    setPackAssetTokenForTests("_sandbox", "");
    setSandboxBootWaitInTests(false);
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

    const disarm = armSandboxHandshake();
    await box.loadModuleUrl(
      pluginDataUrl(plugin),
      ["viz.write"],
      {},
      defaultVizContract({ presentTick: true }),
    );
    disarm();

    expect(sandboxBootNonceForTests()).not.toBe("");
    expect(box.sandboxHostPort()).not.toBeNull();

    box.deliverPresentTick(16, "host-mesh-demo");
    await vi.waitFor(() => writeBatch.mock.calls.length === 1, { timeout: 2_000 });
    expect(writeBatch).toHaveBeenCalledWith({
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

    const disarm = armSandboxHandshake();
    await box.loadModuleUrl(
      pluginDataUrl(plugin),
      ["viz.write", "viz.read"],
      {},
      defaultVizContract(),
    );
    disarm();

    const port = box.sandboxHostPort()!;
    box.frame({ packets: [], talkers: [], links: [], headlines: [] } as never);
    await vi.waitFor(() => writeBatch.mock.calls.length === 1, { timeout: 2_000 });
    expect(writeBatch).toHaveBeenCalledWith({
      buffers: [{ slot: 0, data: [9] }, { slot: 1, data: [8] }],
      uniforms: [],
    });
    expect(singles).toHaveLength(0);

    box.unload();
  });
});
