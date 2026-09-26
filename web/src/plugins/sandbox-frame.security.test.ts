import { describe, expect, it, vi } from "vitest";
import {
  handleSandboxBootMessage,
  redactSandboxAssetPath,
  type SandboxZoto,
} from "./sandbox-frame";

describe("sandbox-frame boot security", () => {
  it("ignores boot postMessage from a foreign frame", () => {
    const foreign = {} as MessageEventSource;
    const ev = {
      data: {
        source: "zoto-viz-host",
        type: "boot",
        bootNonce: "nonce-1",
        parentOrigin: "http://127.0.0.1:7020",
        moduleSrc: "blob:http://127.0.0.1/abc",
        caps: [],
        config: {},
      },
      source: foreign,
    } as MessageEvent;
    const out = handleSandboxBootMessage(ev, { bootDone: false, bootNonce: "nonce-1" });
    expect(out.bootDone).toBe(false);
    expect(out.postTargetOrigin).toBe("");
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
