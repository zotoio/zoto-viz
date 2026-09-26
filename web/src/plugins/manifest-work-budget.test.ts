import { describe, expect, it } from "vitest";
import {
  clampManifestWorkBudgetAtRuntime,
  manifestWorkBudgetCeilings,
  validateManifestWorkBudget,
} from "../../../plugins/sdk/manifest-work-budget";
import { hostClampManifestWorkBudget } from "./manifest-work-budget-host";

function shippedBudget(): Record<string, number> {
  const ceilings = manifestWorkBudgetCeilings();
  return { ...ceilings };
}

describe("manifest workBudget schema (#45)", () => {
  it("rejects a manifest at ten times the host ceiling with a plain reason", () => {
    const ceilings = manifestWorkBudgetCeilings();
    const over = { ...ceilings, maxDrawCalls: ceilings.maxDrawCalls * 10 };
    expect(() => validateManifestWorkBudget(over)).toThrow(
      /maxDrawCalls must be at most 256 \(got 2560\)/,
    );
  });

  it("rejects fractions, negatives, and non-numbers with plain reasons", () => {
    const base = shippedBudget();
    expect(() => validateManifestWorkBudget({ ...base, maxTriangles: 1.5 })).toThrow(
      /whole number from 0 to/,
    );
    expect(() => validateManifestWorkBudget({ ...base, maxInstances: -1 })).toThrow(/at least 0/);
    expect(() => validateManifestWorkBudget({ ...base, maxGpuBytes: "1e9" })).toThrow(
      /whole number from 0 to/,
    );
    expect(() => validateManifestWorkBudget({ ...base, maxPacketsPerFrame: 1e9 })).toThrow(
      /must be at most 128/,
    );
  });

  it("clamps a direct host runtime call above the ceiling", () => {
    const ceilings = manifestWorkBudgetCeilings();
    const clamped = hostClampManifestWorkBudget({
      ...ceilings,
      maxDrawCalls: ceilings.maxDrawCalls + 500,
      maxPacketsPerFrame: ceilings.maxPacketsPerFrame + 99,
    });
    expect(clamped.maxDrawCalls).toBe(ceilings.maxDrawCalls);
    expect(clamped.maxPacketsPerFrame).toBe(ceilings.maxPacketsPerFrame);
    expect(clamped).toEqual(clampManifestWorkBudgetAtRuntime({
      ...ceilings,
      maxDrawCalls: ceilings.maxDrawCalls + 500,
      maxPacketsPerFrame: ceilings.maxPacketsPerFrame + 99,
    }));
  });
});
