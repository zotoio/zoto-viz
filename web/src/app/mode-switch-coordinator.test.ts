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
import { isPackConsentPending, resetSharedPackConsentForTests, runSharedPackConsent } from "./consent-review";

describe("mode-switch-coordinator", () => {
  afterEach(() => {
    resetModeSwitchCoordinatorForTests();
    resetModeSwitchStateForTests();
    resetSharedPackConsentForTests();
  });

  it("queues dream-cycle while consent is open and does not proceed", () => {
    void runSharedPackConsent("pack-b", () => new Promise(() => {}));
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
    void runSharedPackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:a", {});
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:c", {});
    expect(getPendingAutoSwitch()?.modeId).toBe("plugin:c");
  });

  it("user switch clears queued automatic switch", () => {
    void runSharedPackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:c", {});
    beginCoordinatedModeSwitch({ channel: "user" }, "plugin:c", {});
    expect(getPendingAutoSwitch()).toBeNull();
  });

  it("drops queued dream-cycle and resets pulse when consent accepts", () => {
    const reset = vi.fn();
    registerDreamPulseReset(reset);
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "dream-cycle" }, "plugin:next", {});
    settleConsentAndDrainAuto("ok");
    expect(getPendingAutoSwitch()).toBeNull();
    expect(reset).toHaveBeenCalled();
  });

  it("runs profile-restore once after decline only", () => {
    const run = vi.fn();
    registerAutoSwitchRunner(run);
    void runSharedPackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "profile-restore" }, "plugin:topology", {});
    settleConsentAndDrainAuto("declined");
    expect(run).toHaveBeenCalledTimes(1);
    settleConsentAndDrainAuto("declined");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run profile-restore after accept", () => {
    const run = vi.fn();
    registerAutoSwitchRunner(run);
    void runSharedPackConsent("pack-b", () => new Promise(() => {}));
    beginCoordinatedModeSwitch({ channel: "automatic", auto: "profile-restore" }, "plugin:topology", {});
    settleConsentAndDrainAuto("ok");
    expect(run).not.toHaveBeenCalled();
  });
});
