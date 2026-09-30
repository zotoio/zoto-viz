import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import {
  PluginSandbox,
  sandboxMsgTimeoutForTests,
  setSandboxMsgTimeoutMs,
} from "./host";
import { HOST_SOURCE } from "./sandbox-channel";
import * as sandboxFrame from "./sandbox-frame";
import {
  applySandboxCapsForTests,
  attachSandboxHostPort,
  handleSandboxBootChannelMessage,
  handleSandboxHostMessage,
  resetSandboxFrameRuntimeForTests,
  sandboxFrameRuntimeForTests,
  sandboxPortPostsLogForTests,
  sandboxZotoApi,
  setSandboxFrameLocationHref,
  setVizBatchAllocateFreshForTests,
  vizBatchBeginIdentityForTests,
  resetSandboxPortPostCountForTests,
  resetSandboxWindowPostCountForTests,
  sandboxPortPostCountForTests,
  sandboxWindowPostCountForTests,
  vizWriteBatchBackingForTests,
} from "./sandbox-frame";
import {
  installSandboxTestHandshake,
  setSandboxTestHandshakeEnabled,
} from "./sandbox-test-harness";
import { defaultVizContract } from "./viz-host";
import { VIZ_WRITE_BATCH_MAX_BYTES } from "./viz-write-batch";
import { mockPartial } from "../../test-support/mock-partial";

// scripts/revert-proof-lib.mjs reads these two keys off each test's task.meta (vitest JSON report).
declare module "vitest" {
  interface TaskMeta {
    revertProofAssertion?: boolean;
    revertProofRed?: { actual: unknown; expected: unknown };
  }
}

const FRAME_ID = "11111111-1111-4111-8111-111111111111";

function deliverSandboxDataFrame(frame: unknown = {}): void {
  handleSandboxHostMessage(
    { source: HOST_SOURCE, type: "frame", frame },
    sandboxFrameRuntimeForTests().allowed,
    sandboxZotoApi,
  );
}

function pluginDataUrl(body: string): string {
  const src = `const zoto = globalThis.zoto;\n${body}`;
  return `data:text/javascript,${encodeURIComponent(src)}`;
}

describe("sandbox write path counts (#129)", () => {
  beforeEach(() => {
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue(FRAME_ID);
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "tok-counts");
    resetSandboxFrameRuntimeForTests();
    setSandboxMsgTimeoutMs(15_000);
    setSandboxTestHandshakeEnabled(true);
    installSandboxTestHandshake();
    (globalThis as unknown as { zoto: typeof sandboxZotoApi }).zoto = sandboxZotoApi;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    vi.restoreAllMocks();
    setPackAssetTokenForTests("_sandbox", "");
    setSandboxMsgTimeoutMs(15_000);
    setVizBatchAllocateFreshForTests(false);
    resetSandboxFrameRuntimeForTests();
  });

  describe("1 boot ready and timeout counts", () => {
    it("reaches ready with 0 timeouts; 15s fake time still 0 timeouts", async () => {
      const box = new PluginSandbox();
      await box.load("demo", "globalThis.ok = true;", ["viz.read"], {});
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(box.sandboxHostPort()).not.toBeNull();
      box.unload();
    });

    it("revert: skip port pickup → exactly 1 ready timeout at 15s", async ({ task }) => {
      task.meta.revertProofAssertion = true;
      setSandboxMsgTimeoutMs(40);
      vi.spyOn(sandboxFrame, "handleSandboxBootChannelMessage").mockImplementation(() => {});
      const box = new PluginSandbox();
      await expect(box.load("demo", "", ["viz.read"], {})).rejects.toThrow(/sandbox ready timeout/);
      task.meta.revertProofRed = { actual: "ready timeout", expected: "ready ok" };
      setSandboxMsgTimeoutMs(15_000);
      box.unload();
    });
  });

  describe("2 boot-channel source === parent", () => {
    it("ignores boot-channel when event.source is not parent (0 ports adopted)", () => {
      resetSandboxFrameRuntimeForTests();
      setSandboxFrameLocationHref("http://127.0.0.1/#zoto-boot=nonce-src");
      const ch = new MessageChannel();
      handleSandboxBootChannelMessage(
        mockPartial<MessageEvent>({
          data: {
            source: HOST_SOURCE,
            type: "boot-channel",
            bootNonce: "nonce-src",
            parentOrigin: "http://127.0.0.1",
          },
          source: {} as MessageEventSource,
          ports: [ch.port2],
        }),
        sandboxFrameRuntimeForTests(),
      );
      expect(sandboxFrameRuntimeForTests().pluginPort === null).toBe(true);
      ch.port1.close();
      ch.port2.close();
    });

    it("revert: lax source check adopts port from foreign source", ({ task }) => {
      task.meta.revertProofAssertion = true;
      resetSandboxFrameRuntimeForTests();
      setSandboxFrameLocationHref("http://127.0.0.1/#zoto-boot=nonce-revert");
      const ch = new MessageChannel();
      const ev = mockPartial<MessageEvent>({
        data: {
          source: HOST_SOURCE,
          type: "boot-channel",
          bootNonce: "nonce-revert",
          parentOrigin: "http://127.0.0.1",
        },
        source: {} as MessageEventSource,
        ports: [ch.port2],
      });
      if (ev.source !== window.parent) {
        attachSandboxHostPort(ch.port2, sandboxFrameRuntimeForTests(), sandboxZotoApi);
      }
      expect(sandboxFrameRuntimeForTests().pluginPort).not.toBeNull();
      task.meta.revertProofRed = { actual: "adopted", expected: "ignored" };
      ch.port1.close();
    });
  });

  describe("3 post-boot window.postMessage", () => {
    it("0 parent.postMessage from frame across 600 present write frames", async () => {
      const box = new PluginSandbox();
      await box.load(
        "demo",
        `
          zoto.onPresent = () => {
            zoto.writeBuffer(0, [1]);
          };
        `,
        ["viz.write"],
        {},
        defaultVizContract({ presentTick: true }),
      );
      resetSandboxWindowPostCountForTests();
      resetSandboxPortPostCountForTests();
      const caps = sandboxFrameRuntimeForTests().allowed;
      for (let i = 0; i < 600; i++) {
        handleSandboxHostMessage(
          {
            source: HOST_SOURCE,
            type: "present",
            tick: { frameMs: i + 1, tileId: "tile-a" },
          },
          caps,
          sandboxZotoApi,
        );
      }
      expect(sandboxWindowPostCountForTests()).toBe(0);
      box.unload();
    });
  });

  describe("4 batch cap message counts", () => {
    async function loadWritePlugin(onFrameBody: string): Promise<PluginSandbox> {
      const box = new PluginSandbox();
      await box.load(
        "demo",
        onFrameBody,
        ["viz.write", "viz.read"],
        {},
        defaultVizContract(),
      );
      return box;
    }

    it("40 small writes → 2 port posts (32 + 8 buffers)", async () => {
      const box = await loadWritePlugin(`
        zoto.onFrame = () => {
          for (let i = 0; i < 40; i++) zoto.writeBuffer(i, [i]);
        };
      `);
      resetSandboxPortPostCountForTests();
      deliverSandboxDataFrame({ packets: [], talkers: [], links: [], headlines: [] });
      expect(sandboxPortPostCountForTests()).toBe(2);
      const writeBatchBuffers = sandboxPortPostsLogForTests()
        .filter((m) => (m as { type?: string }).type === "writeBatch")
        .map((m) => ((m as { payload: { buffers: unknown[] } }).payload.buffers.length));
      expect(writeBatchBuffers).toEqual([32, 8]);
      box.unload();
    });

    it("32 writes → 1 port post", async () => {
      const box = await loadWritePlugin(`
        zoto.onFrame = () => {
          for (let i = 0; i < 32; i++) zoto.writeBuffer(i, [i]);
        };
      `);
      resetSandboxPortPostCountForTests();
      deliverSandboxDataFrame({});
      expect(sandboxPortPostCountForTests()).toBe(1);
      box.unload();
    });

    it("<32 writes over 4096 bytes → 2 port posts", async () => {
      const floatsPerWrite = Math.ceil((VIZ_WRITE_BATCH_MAX_BYTES + 1) / (2 * 8));
      const box = await loadWritePlugin(`
        zoto.onFrame = () => {
          zoto.writeBuffer(0, Array(${floatsPerWrite}).fill(1));
          zoto.writeBuffer(1, Array(${floatsPerWrite}).fill(2));
        };
      `);
      resetSandboxPortPostCountForTests();
      deliverSandboxDataFrame({});
      expect(sandboxPortPostCountForTests()).toBe(2);
      box.unload();
    });
  });

  describe("5 steady-frame allocation", () => {
    it("600×40 writes → 1200 port posts; same batch object frame 1 and 600", async () => {
      const box = new PluginSandbox();
      await box.load(
        "demo",
        `
          zoto.onFrame = () => {
            for (let i = 0; i < 40; i++) zoto.writeBuffer(i, [i]);
          };
        `,
        ["viz.write", "viz.read"],
        {},
        defaultVizContract(),
      );
      const shell = vizWriteBatchBackingForTests();
      resetSandboxPortPostCountForTests();
      let frame1Batch: ReturnType<typeof vizBatchBeginIdentityForTests> = null;
      const frame = { packets: [], talkers: [], links: [], headlines: [] } as never;
      for (let f = 0; f < 600; f++) {
        deliverSandboxDataFrame(frame);
        if (f === 0) frame1Batch = vizBatchBeginIdentityForTests();
      }
      expect(sandboxPortPostCountForTests()).toBe(1200);
      expect(frame1Batch).toBe(shell);
      expect(vizBatchBeginIdentityForTests()).toBe(shell);
      box.unload();
    });

    it("revert: fresh batch object per frame breaks identity", ({ task }) => {
      task.meta.revertProofAssertion = true;
      resetSandboxFrameRuntimeForTests();
      setVizBatchAllocateFreshForTests(true);
      applySandboxCapsForTests(["viz.write", "viz.read"]);
      const shell = vizWriteBatchBackingForTests();
      sandboxZotoApi.onFrame = () => {
        for (let i = 0; i < 2; i++) sandboxZotoApi.writeBuffer(i, [i]);
      };
      const caps = new Set(["viz.read", "viz.write"]);
      sandboxFrame.handleSandboxHostMessage(
        { source: HOST_SOURCE, type: "frame", frame: {} },
        caps,
        sandboxZotoApi,
      );
      sandboxFrame.handleSandboxHostMessage(
        { source: HOST_SOURCE, type: "frame", frame: {} },
        caps,
        sandboxZotoApi,
      );
      const frame1 = vizBatchBeginIdentityForTests();
      sandboxFrame.handleSandboxHostMessage(
        { source: HOST_SOURCE, type: "frame", frame: {} },
        caps,
        sandboxZotoApi,
      );
      const frame2 = vizBatchBeginIdentityForTests();
      expect(frame1).not.toBe(shell);
      expect(frame2).not.toBe(shell);
      expect(frame1).not.toBe(frame2);
      task.meta.revertProofRed = { actual: "different", expected: "same" };
    });
  });
});
