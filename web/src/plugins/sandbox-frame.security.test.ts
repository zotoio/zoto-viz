import { describe, expect, it, vi } from "vitest";
import { HOST_SOURCE } from "./sandbox-channel";
import {
  handleSandboxBootChannelMessage,
  redactSandboxAssetPath,
  resetSandboxFrameRuntimeForTests,
  sandboxFrameRuntimeForTests,
  setSandboxFrameLocationHref,
  type SandboxZoto,
} from "./sandbox-frame";
import { mockPartial } from "../../test-support/mock-partial";

describe("sandbox-frame boot security", () => {
  it("ignores boot-channel when event.source is not window.parent", () => {
    resetSandboxFrameRuntimeForTests();
    setSandboxFrameLocationHref("http://127.0.0.1/#zoto-boot=nonce-1");
    const foreign = {} as MessageEventSource;
    const ch = new MessageChannel();
    const ev = mockPartial<MessageEvent>({
      data: {
        source: HOST_SOURCE,
        type: "boot-channel",
        bootNonce: "nonce-1",
        parentOrigin: "http://127.0.0.1:7020",
      },
      source: foreign,
      ports: [ch.port2],
    });
    // The runtime the nonce was just set on, so only the source check can keep the port out.
    handleSandboxBootChannelMessage(ev, sandboxFrameRuntimeForTests());
    expect(sandboxFrameRuntimeForTests().pluginPort).toBeNull();
  });

  it("does not leak pack asset token in log postMessage payloads", () => {
    const tok = "super-secret-pack-asset-token";
    const raw = `TypeError: Failed to fetch dynamically imported module: http://127.0.0.1:7020/pack-assets/${tok}/demo/module.js`;
    const redacted = redactSandboxAssetPath(raw, tok);
    const posted: unknown[] = [];
    vi.stubGlobal("parent", {
      postMessage: (payload: unknown) => {
        posted.push(payload);
      },
    });
    const api = {} as SandboxZoto;
    void api;
    parent.postMessage({ source: "zoto-viz-plugin", type: "log", payload: redacted }, "*");
    const msg = posted[0] as { payload?: string };
    expect(msg.payload ?? "").not.toContain(tok);
    expect(msg.payload ?? "").toContain("<sandbox-token>");
    vi.unstubAllGlobals();
  });
});
