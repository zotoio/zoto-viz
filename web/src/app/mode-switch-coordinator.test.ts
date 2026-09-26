import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginCoordinatedModeSwitch,
  getPendingAutoSwitch,
  registerAutoSwitchRunner,
  registerDreamPulseReset,
  resetModeSwitchCoordinatorForTests,
  settleConsentAndDrainAuto,
} from "./mode-switch-coordinator";
import { resetModeSwitchStateForTests } from "./mode-switch-state";
import {
  beginModeSwitchAttempt,
  getActiveModeSwitchSignal,
  resetModeSwitchAttemptForTests,
} from "./mode-switch-attempt";
import {
  ensurePackConsent,
  isPackConsentPending,
  resetPackConsentForTests,
} from "./pack-consent";

describe("mode-switch-coordinator", () => {
  afterEach(() => {
    resetModeSwitchCoordinatorForTests();
    resetModeSwitchStateForTests();
    resetPackConsentForTests();
    resetModeSwitchAttemptForTests();
  });

  it("queued automatic switch does not replace the active attempt signal", () => {
    const attemptSignal = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), attemptSignal);
    for (let i = 0; i < 5; i++) {
      beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, `plugin:x${i}`, {});
    }
    expect(getActiveModeSwitchSignal()).toBe(attemptSignal);
  });

  it("queues dream-cycle while consent is open and does not proceed", () => {
    const signal = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), signal);
    expect(isPackConsentPending()).toBe(true);
    const { proceed } = beginCoordinatedModeSwitch(
      { channel: "automatic", auto: "dream-cycle" },
      "plugin:tunnel",
      {},
    );
    expect(proceed).toBe(false);
    expect(getPendingAutoSwitch()?.modeId).toBe("plugin:tunnel");
  });

  it("replaces older queued automatic switch with a newer one", () => {
    const signal = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), signal);
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:a", {});
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:c", {});
    expect(getPendingAutoSwitch()?.modeId).toBe("plugin:c");
  });

  it("user switch clears queued automatic switch", () => {
    const signal = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), signal);
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:c", {});
    beginCoordinatedModeSwitch({ channel: "user" }, "plugin:c", {});
    expect(getPendingAutoSwitch()).toBeNull();
  });

  it("user switch aborts open pack consent via attempt signal", async () => {
    const first = beginModeSwitchAttempt();
    const pending = ensurePackConsent("pack-b", () => new Promise(() => {}), first);
    beginModeSwitchAttempt();
    await expect(pending).resolves.toBe("aborted");
    await Promise.resolve();
    expect(isPackConsentPending()).toBe(false);
  });

  it("automatic switch never aborts open pack consent", () => {
    const signal = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), signal);
    expect(isPackConsentPending()).toBe(true);
    const { proceed } = beginCoordinatedModeSwitch(
      { channel: "automatic", auto: "dream-cycle" },
      "plugin:tunnel",
      {},
    );
    expect(proceed).toBe(false);
    expect(isPackConsentPending()).toBe(true);
    expect(signal.aborted).toBe(false);
  });

  it("drops queued dream-cycle and resets pulse when consent declines", () => {
    const reset = vi.fn();
    registerDreamPulseReset(reset);
    const signal = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), signal);
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:next", {});
    settleConsentAndDrainAuto("declined");
    expect(getPendingAutoSwitch()).toBeNull();
    expect(reset).toHaveBeenCalled();
  });

  it("restarts dream pulse interval after consent settles with no queued auto", () => {
    const reset = vi.fn();
    registerDreamPulseReset(reset);
    settleConsentAndDrainAuto("ok");
    expect(reset).toHaveBeenCalled();
  });

  it("drops queued dream-cycle and resets pulse when consent accepts", () => {
    const reset = vi.fn();
    registerDreamPulseReset(reset);
    const signal = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), signal);
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:next", {});
    expect(getPendingAutoSwitch()?.modeId).toBe("plugin:next");
    settleConsentAndDrainAuto("ok");
    expect(getPendingAutoSwitch()).toBeNull();
    expect(reset).toHaveBeenCalled();
  });

  it("runs profile-restore once after decline only", () => {
    const run = vi.fn();
    registerAutoSwitchRunner(run);
    const signal = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), signal);
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "profile-restore" }, "plugin:topology", {});
    settleConsentAndDrainAuto("declined");
    expect(run).toHaveBeenCalledTimes(1);
    const signal2 = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), signal2);
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "profile-restore" }, "plugin:topology", {});
    settleConsentAndDrainAuto("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run profile-restore after accept", () => {
    const run = vi.fn();
    registerAutoSwitchRunner(run);
    const signal = beginModeSwitchAttempt();
    void ensurePackConsent("pack-b", () => new Promise(() => {}), signal);
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "profile-restore" }, "plugin:topology", {});
    settleConsentAndDrainAuto("ok");
    expect(run).not.toHaveBeenCalled();
  });
});
