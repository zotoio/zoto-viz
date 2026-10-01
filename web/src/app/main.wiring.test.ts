import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_RESTART_NOTICE } from "../core/http-copy";
// #239: the page first, then main.ts, both while the file is collected (see main-entry-env.ts).
import { MockWebSocket } from "../../test-support/main-entry-env";
import "./main";

async function settleMainBoot(): Promise<void> {
  await vi.waitFor(
    () => document.querySelector("#modeBox select") !== null,
    { timeout: 10_000, interval: 20 },
  );
  for (let i = 0; i < 48; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("main entry wiring", () => {
  afterEach(async () => {
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    vi.unstubAllGlobals();
    vi.resetModules();
    document.body.innerHTML = "";
    MockWebSocket.instances = [];
  });

  beforeEach(async () => {
    expect.hasAssertions();
    await settleMainBoot();
  });

  it("shows the restart strip when the server-restart event fires after entry bind", () => {
    window.dispatchEvent(
      new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
    );
    const row = document.querySelector('[data-notice-key="server-restarted"]');
    expect(row).not.toBeNull();
    expect(row!.querySelector(".wall-notice-text")!.textContent).toBe(SERVER_RESTART_NOTICE);
  });
});
