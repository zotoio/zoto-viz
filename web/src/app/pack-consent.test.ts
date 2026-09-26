import { afterEach, describe, expect, it } from "vitest";
import type { ConsentReviewResult } from "./pack-consent";
import {
  abortAllOpenPackConsents,
  ensurePackConsent,
  resetPackConsentForTests,
} from "./pack-consent";

describe("pack-consent session", () => {
  afterEach(() => {
    resetPackConsentForTests();
  });

  it("shares one in-flight consent per pack id", async () => {
    let runs = 0;
    const slow = ensurePackConsent("pack-a", async () => {
      runs++;
      await new Promise<void>((r) => { setTimeout(r, 20); });
      return "ok";
    });
    const shared = ensurePackConsent("pack-a", async () => {
      runs++;
      return "ok";
    });
    expect(runs).toBe(1);
    expect(await slow).toBe("ok");
    expect(await shared).toBe("ok");
    expect(runs).toBe(1);
  });

  it("user abort resolves waiters with aborted", async () => {
    const pending = ensurePackConsent("pack-a", () => new Promise(() => {}));
    abortAllOpenPackConsents();
    await expect(pending).resolves.toBe("aborted");
  });

  it("sequence A then B then C then B again runs fresh B consent after B completes", async () => {
    let bRuns = 0;
    await ensurePackConsent("pack-a", async () => "ok");
    await ensurePackConsent("pack-b", async () => {
      bRuns++;
      return "ok";
    });
    await ensurePackConsent("pack-c", async () => "ok");
    await ensurePackConsent("pack-b", async () => {
      bRuns++;
      return "ok";
    });
    expect(bRuns).toBe(2);
  });

  it("sequence A then B then C then B again has no stale B after abort between visits", async () => {
    await ensurePackConsent("pack-a", async () => "ok");
    const bFirst = ensurePackConsent("pack-b", () => new Promise<ConsentReviewResult>(() => {}));
    await ensurePackConsent("pack-c", async () => "ok");
    abortAllOpenPackConsents();
    await expect(bFirst).resolves.toBe("aborted");

    let bRunsAfterReturn = 0;
    await ensurePackConsent("pack-b", async () => {
      bRunsAfterReturn++;
      return "ok";
    });
    expect(bRunsAfterReturn).toBe(1);
  });
});
