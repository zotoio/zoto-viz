import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY, parseRecoveryConfig } from "./recovery-config";

describe("parseRecoveryConfig", () => {
  it("defaults on missing or broken input", () => {
    expect(parseRecoveryConfig(null)).toEqual(DEFAULT_RECOVERY);
    expect(parseRecoveryConfig("{nope")).toEqual(DEFAULT_RECOVERY);
    expect(parseRecoveryConfig("[1]")).toEqual(DEFAULT_RECOVERY);
  });
  it("accepts overrides and clamps nonsense", () => {
    const c = parseRecoveryConfig(JSON.stringify({ fpsCap: 30, viewErrorBudget: 0, softReloadAfterH: 0, stream: { staleMs: 10, jitter: 5 } }));
    expect(c.fpsCap).toBe(30);
    expect(c.viewErrorBudget).toBe(DEFAULT_RECOVERY.viewErrorBudget);
    expect(c.softReloadAfterH).toBe(0);
    expect(c.stream.staleMs).toBe(DEFAULT_RECOVERY.stream.staleMs);
    expect(c.stream.jitter).toBe(1);
  });
});
