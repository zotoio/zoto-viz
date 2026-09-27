import { describe, expect, it } from "vitest";
import { formatVizBudgetOverlay, vizBudgetOverlayFromStats } from "./viz-budget-overlay";

describe("viz budget overlay", () => {
  it("labels GPU when stats say gpu", () => {
    const text = formatVizBudgetOverlay({
      timingSource: "gpu",
      lastMs: 12.4,
      p95Ms: 14.1,
      renderScale: 0.75,
      governorEnabled: true,
    });
    expect(text).toMatch(/^gov on · GPU /);
    expect(text).toContain("p95 14.1");
    expect(text).toContain("scale 0.75");
  });

  it("labels CPU when stats say cpu", () => {
    const text = formatVizBudgetOverlay({
      timingSource: "cpu",
      lastMs: 9.2,
      p95Ms: 11.0,
      renderScale: null,
      governorEnabled: false,
    });
    expect(text).toMatch(/^gov off · CPU /);
    expect(text).not.toContain("scale");
  });

  it("shows dashes when there are no samples", () => {
    const model = vizBudgetOverlayFromStats({
      lastMs: 0,
      p95Ms: 0,
      overBudget: 0,
      skipped: 0,
      total: 0,
      timingSource: "cpu",
      hasSamples: false,
    }, 1);
    expect(formatVizBudgetOverlay(model)).toBe("gov off · CPU — ms · p95 — · scale 1");
  });

  it("shows gov off with scale 1 when the host governor is disabled", () => {
    const model = vizBudgetOverlayFromStats({
      lastMs: 8,
      p95Ms: 9,
      overBudget: 0,
      skipped: 0,
      total: 3,
      timingSource: "cpu",
      hasSamples: true,
    }, 1, false);
    expect(model.governorEnabled).toBe(false);
    expect(model.renderScale).toBe(1);
    expect(formatVizBudgetOverlay(model)).toMatch(/^gov off ·/);
    expect(formatVizBudgetOverlay(model)).toContain("scale 1");
  });
});
