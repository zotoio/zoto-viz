/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { importMainEntryModule } from "./main-entry-harness";

describe("main.ts production entry connect()", () => {
  it("opens the live websocket and marks #conn ok", async () => {
    expect.hasAssertions();
    await importMainEntryModule();
    const { mainEntryTestConnect } = await import("../main-entry-test-host");
    mainEntryTestConnect();
    await vi.waitFor(() => {
      expect(document.getElementById("conn")?.classList.contains("ok")).toBe(true);
    }, { timeout: 3000 });
  });
});
