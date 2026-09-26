import { afterEach, describe, expect, it } from "vitest";
import { ensurePackConsent, isPackConsentPending, resetPackConsentForTests } from "./pack-consent";
import { isPackConsentPending as isPendingViaShim, runSharedPackConsent } from "./consent-review";

describe("pack-consent single map (shim)", () => {
  afterEach(() => {
    resetPackConsentForTests();
  });

  it("consent started via consent-review shim is pending in pack-consent", () => {
    void runSharedPackConsent("pack-shim", () => new Promise(() => {}), new AbortController().signal);
    expect(isPendingViaShim("pack-shim")).toBe(true);
    expect(isPackConsentPending("pack-shim")).toBe(true);
  });

  it("consent started via pack-consent is pending via consent-review shim", () => {
    void ensurePackConsent("pack-shim", () => new Promise(() => {}), new AbortController().signal);
    expect(isPackConsentPending("pack-shim")).toBe(true);
    expect(isPendingViaShim("pack-shim")).toBe(true);
  });
});
