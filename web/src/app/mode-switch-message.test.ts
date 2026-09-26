import { afterEach, describe, expect, it } from "vitest";
import {
  flashModeKeptPrevious,
  initModeSwitchStatusStrip,
  isModeSwitchStatusVisible,
  modeSwitchStatusStacksAboveModals,
  clearModeSwitchStatus,
} from "./mode-switch-message";

describe("modeSwitchStatus strip", () => {
  afterEach(() => {
    clearModeSwitchStatus();
    document.querySelectorAll(".modal.ask").forEach((el) => el.remove());
    document.body.classList.remove("modal-open");
  });

  it("stacks above modal backdrop and stays visible after decline message", () => {
    initModeSwitchStatusStrip();
    const modal = document.createElement("div");
    modal.className = "modal ask";
    modal.innerHTML = '<div class="backdrop"></div><div class="sheet"></div>';
    document.body.classList.add("modal-open");
    document.body.appendChild(modal);

    flashModeKeptPrevious("Stereo");

    const el = document.getElementById("modeSwitchStatus");
    expect(el?.getAttribute("role")).toBe("status");
    expect(el?.getAttribute("aria-live")).toBe("polite");
    expect(modeSwitchStatusStacksAboveModals()).toBe(true);
    expect(isModeSwitchStatusVisible()).toBe(true);
    expect(el?.textContent).toMatch(/^Kept Stereo/);
  });
});
