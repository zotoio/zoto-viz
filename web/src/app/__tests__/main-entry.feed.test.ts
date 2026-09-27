/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { goldenLanFixture } from "../../plugins/fixtures/golden-lan-state";
import { bootMainEntry } from "./main-entry-harness";

describe("main.ts production entry feed()", () => {
  it("applies websocket state to the demo LAN counters", async () => {
    expect.hasAssertions();
    const { pushState } = await bootMainEntry();
    pushState(goldenLanFixture());
    await vi.waitFor(() => {
      expect(Number(document.getElementById("lanDevs")?.textContent || 0)).toBeGreaterThan(0);
    }, { timeout: 8000 });
    expect(Number(document.getElementById("pps")?.textContent || 0)).toBeGreaterThan(0);
  });
});
