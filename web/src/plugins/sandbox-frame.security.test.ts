import { describe, expect, it, vi } from "vitest";
import {
  freezeSandboxWebRtc,
  handleSandboxBootChannel,
  redactSandboxAssetPath,
  type SandboxZoto,
} from "./sandbox-frame";

describe("sandbox-frame boot security", () => {
  it("ignores boot-channel postMessage from a foreign frame", () => {
    const foreign = {} as MessageEventSource;
    const ev = {
      data: {
        source: "zoto-viz-host",
        type: "boot-channel",
        bootNonce: "nonce-1",
        parentOrigin: "http://127.0.0.1:7020",
      },
      source: foreign,
      ports: [{} as MessagePort],
      origin: "http://127.0.0.1:7020",
    } as MessageEvent;
    const out = handleSandboxBootChannel(ev, { bootDone: false, bootNonce: "nonce-1" });
    expect(out.port).toBeNull();
    expect(out.postTargetOrigin).toBe("");
  });

  it("freezes WebRTC constructors in the bootstrap", () => {
    freezeSandboxWebRtc();
    expect((globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection).toBeUndefined();
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
