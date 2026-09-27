import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_RESTART_NOTICE } from "../core/http-copy";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(here, "../../index.html"), "utf8");
const bodyHtml = (indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "").replace(
  /<script[\s\S]*?<\/script>/gi,
  "",
);

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }
  close() {}
  addEventListener() {}
}

describe("main entry wiring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    document.body.innerHTML = "";
    MockWebSocket.instances = [];
  });

  beforeEach(async () => {
    expect.hasAssertions();
    document.body.innerHTML = bodyHtml;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.resetModules();
    await import("./main.ts");
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
