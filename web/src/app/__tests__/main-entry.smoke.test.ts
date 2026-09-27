/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { goldenLanFixture } from "../../plugins/fixtures/golden-lan-state";
import { bootMainEntry } from "./main-entry-harness";

describe("main.ts production entry", () => {
  it("boots via dynamic import and paints golden LAN demo stats", async () => {
    expect.hasAssertions();
    const { pushState } = await bootMainEntry();
    pushState(goldenLanFixture());
    await vi.waitUntil(
      () => Number(document.getElementById("lanDevs")?.textContent || 0) > 0,
      { timeout: 8000 },
    );
    const pps = Number(document.getElementById("pps")?.textContent || 0);
    expect(pps).toBeGreaterThan(0);
    expect(document.getElementById("wall")).toBeTruthy();
  });
});
