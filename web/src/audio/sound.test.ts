import { describe, expect, it } from "vitest";
import { liveSound, parseSoundOn, soundAllowed, SOUND_STORE_KEY } from "./sound";

describe("parseSoundOn", () => {
  it("defaults off and only enables on explicit on/1/true", () => {
    expect(parseSoundOn(null)).toBe(false);
    expect(parseSoundOn(undefined)).toBe(false);
    expect(parseSoundOn("off")).toBe(false);
    expect(parseSoundOn("0")).toBe(false);
    expect(parseSoundOn("nope")).toBe(false);
    expect(parseSoundOn(false)).toBe(false);
    expect(parseSoundOn("on")).toBe(true);
    expect(parseSoundOn("1")).toBe(true);
    expect(parseSoundOn(true)).toBe(true);
  });
});

describe("soundAllowed", () => {
  it("follows the header sound toggle", () => {
    liveSound.setOn(true, false);
    expect(soundAllowed()).toBe(true);
    liveSound.setOn(false, false);
    expect(soundAllowed()).toBe(false);
    expect(SOUND_STORE_KEY).toBe("zoto-viz.sound");
  });
});
