import { afterEach, describe, expect, it } from "vitest";
import {
  resetSharedPackConsentForTests,
  runSharedPackConsent,
} from "./consent-review";

describe("consent-review shared pack", () => {
  afterEach(() => {
    resetSharedPackConsentForTests();
  });

  it("shares one in-flight consent per pack id", async () => {
    let runs = 0;
    const ac = new AbortController();
    const slow = runSharedPackConsent("pack-a", async () => {
      runs++;
      await new Promise<void>((r) => { setTimeout(r, 20); });
      return "ok";
    }, ac.signal);
    const shared = runSharedPackConsent("pack-a", async () => {
      runs++;
      return "ok";
    }, ac.signal);
    expect(runs).toBe(1);
    expect(await slow).toBe("ok");
    expect(await shared).toBe("ok");
    expect(runs).toBe(1);
  });

  it("user abort resolves waiters with aborted", async () => {
    const ac = new AbortController();
    const pending = runSharedPackConsent("pack-a", () => new Promise(() => {}), ac.signal);
    ac.abort();
    await expect(pending).resolves.toBe("aborted");
  });
});
