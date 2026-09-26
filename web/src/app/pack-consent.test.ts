import { afterEach, describe, expect, it } from "vitest";
import type { ConsentReviewResult } from "./pack-consent";
import {
  ensurePackConsent,
  resetPackConsentForTests,
} from "./pack-consent";

describe("pack-consent session", () => {
  afterEach(() => {
    resetPackConsentForTests();
  });

  it("shares one in-flight consent per pack id", async () => {
    let runs = 0;
    const ac = new AbortController();
    const slow = ensurePackConsent("pack-a", async (_signal) => {
      runs++;
      await new Promise<void>((r) => { setTimeout(r, 20); });
      return "ok";
    }, ac.signal);
    const shared = ensurePackConsent("pack-a", async (_signal) => {
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
    const pending = ensurePackConsent("pack-a", () => new Promise(() => {}), ac.signal);
    ac.abort();
    await expect(pending).resolves.toBe("aborted");
  });

  it("sequence A then B then C then B again runs fresh B consent after B completes", async () => {
    let bRuns = 0;
    const acA = new AbortController();
    await ensurePackConsent("pack-a", async () => "ok", acA.signal);
    const acB1 = new AbortController();
    await ensurePackConsent("pack-b", async () => {
      bRuns++;
      return "ok";
    }, acB1.signal);
    const acC = new AbortController();
    await ensurePackConsent("pack-c", async () => "ok", acC.signal);
    const acB2 = new AbortController();
    await ensurePackConsent("pack-b", async () => {
      bRuns++;
      return "ok";
    }, acB2.signal);
    expect(bRuns).toBe(2);
  });

  it("sequence A then B then C then B again has no stale B after abort between visits", async () => {
    const acA = new AbortController();
    await ensurePackConsent("pack-a", async () => "ok", acA.signal);
    const acB = new AbortController();
    const bFirst = ensurePackConsent("pack-b", () => new Promise<ConsentReviewResult>(() => {}), acB.signal);
    const acC = new AbortController();
    await ensurePackConsent("pack-c", async () => "ok", acC.signal);
    acB.abort();
    await expect(bFirst).resolves.toBe("aborted");

    let bRunsAfterReturn = 0;
    const acB2 = new AbortController();
    await ensurePackConsent("pack-b", async () => {
      bRunsAfterReturn++;
      return "ok";
    }, acB2.signal);
    expect(bRunsAfterReturn).toBe(1);
  });
});
