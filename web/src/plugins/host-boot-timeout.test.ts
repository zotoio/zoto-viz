import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSandbox, setSandboxBootWaitInTests, setSandboxMsgTimeoutMs } from "./host";

describe("PluginSandbox boot handshake", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    setSandboxBootWaitInTests(false);
    setSandboxMsgTimeoutMs(15_000);
    vi.restoreAllMocks();
  });

  it("rejects with frame-ready timeout when the sandbox iframe stays silent", async () => {
    setSandboxBootWaitInTests(true);
    setSandboxMsgTimeoutMs(40);
    vi.useFakeTimers();
    const box = new PluginSandbox();
    const boot = box.loadModuleUrl("about:blank", ["viz.read"], {});
    const pending = expect(boot).rejects.toThrow(/sandbox frame-ready timeout/);
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    vi.useRealTimers();
    box.unload();
  });
});
