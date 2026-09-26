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
  abortAllOpenPackConsents,
  ensurePackConsent,
  isPackConsentPending,
  resetPackConsentForTests,
} from "./pack-consent";

describe("mode-switch-coordinator", () => {
  afterEach(() => {
    resetModeSwitchCoordinatorForTests();
    resetModeSwitchStateForTests();
    resetPackConsentForTests();
  });

  it("queues dream-cycle while consent is open and does not proceed", () => {
    void ensurePackConsent("pack-b", () => new Promise(() => {}));
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
    void ensurePackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:a", {});
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:c", {});
    expect(getPendingAutoSwitch()?.modeId).toBe("plugin:c");
  });

  it("user switch clears queued automatic switch", () => {
    void ensurePackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:c", {});
    beginCoordinatedModeSwitch({ channel: "user" }, "plugin:c", {});
    expect(getPendingAutoSwitch()).toBeNull();
  });

  it("user switch aborts open pack consent silently", async () => {
    const pending = ensurePackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "user" }, "plugin:other", {});
    await expect(pending).resolves.toBe("aborted");
    expect(isPackConsentPending()).toBe(false);
  });

  it("automatic switch never aborts open pack consent", () => {
    void ensurePackConsent("pack-b", () => new Promise(() => {}));
    expect(isPackConsentPending()).toBe(true);
    const { proceed } = beginCoordinatedModeSwitch(
      { channel: "automatic", auto: "dream-cycle" },
      "plugin:tunnel",
      {},
    );
    expect(proceed).toBe(false);
    expect(isPackConsentPending()).toBe(true);
    abortAllOpenPackConsents();
  });

  it("drops queued dream-cycle and resets pulse when consent declines", () => {
    const reset = vi.fn();
    registerDreamPulseReset(reset);
    void ensurePackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:next", {});
    settleConsentAndDrainAuto("declined");
    expect(getPendingAutoSwitch()).toBeNull();
    expect(reset).toHaveBeenCalled();
    abortAllOpenPackConsents();
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
    void ensurePackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:next", {});
    expect(getPendingAutoSwitch()?.modeId).toBe("plugin:next");
    settleConsentAndDrainAuto("ok");
    expect(getPendingAutoSwitch()).toBeNull();
    expect(reset).toHaveBeenCalled();
    abortAllOpenPackConsents();
  });

  it("runs profile-restore once after decline only", () => {
    const run = vi.fn();
    registerAutoSwitchRunner(run);
    void ensurePackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "profile-restore" }, "plugin:topology", {});
    settleConsentAndDrainAuto("declined");
    expect(run).toHaveBeenCalledTimes(1);
    void ensurePackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "profile-restore" }, "plugin:topology", {});
    settleConsentAndDrainAuto("ok");
    expect(run).toHaveBeenCalledTimes(1);
    abortAllOpenPackConsents();
  });

  it("does not run profile-restore after accept", () => {
    const run = vi.fn();
    registerAutoSwitchRunner(run);
    void ensurePackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "profile-restore" }, "plugin:topology", {});
    settleConsentAndDrainAuto("ok");
    expect(run).not.toHaveBeenCalled();
  });
});
