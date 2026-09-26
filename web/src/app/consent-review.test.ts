import { afterEach, describe, expect, it } from "vitest";
import {
  abortAllOpenPackConsents,
  resetSharedPackConsentForTests,
  runSharedPackConsent,
} from "./consent-review";

describe("consent-review shared pack", () => {
  afterEach(() => {
    resetSharedPackConsentForTests();
  });

  it("shares one in-flight consent per pack id", async () => {
    let runs = 0;
    const slow = runSharedPackConsent("pack-a", async () => {
      runs++;
      await new Promise<void>((r) => { setTimeout(r, 20); });
      return "ok";
    });
    const shared = runSharedPackConsent("pack-a", async () => {
      runs++;
      return "ok";
    });
    expect(runs).toBe(1);
    expect(await slow).toBe("ok");
    expect(await shared).toBe("ok");
    expect(runs).toBe(1);
  });

  it("user abort resolves waiters with aborted", async () => {
    const pending = runSharedPackConsent("pack-a", () => new Promise(() => {}));
    abortAllOpenPackConsents();
    await expect(pending).resolves.toBe("aborted");
  });
});
