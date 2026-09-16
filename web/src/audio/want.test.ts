import { describe, expect, it } from "vitest";
import { parseMicPolicy, shouldRunMic } from "./want";

describe("parseMicPolicy", () => {
  it("defaults to auto", () => {
    expect(parseMicPolicy(null)).toBe("auto");
    expect(parseMicPolicy("auto")).toBe("auto");
    expect(parseMicPolicy("off")).toBe("off");
    expect(parseMicPolicy("nope")).toBe("auto");
  });
});

describe("shouldRunMic", () => {
  it("starts the pulse mic only for Auto + mic drive + a live consumer", () => {
    expect(shouldRunMic("auto", "mic", true)).toBe(true);
    expect(shouldRunMic("off", "mic", true)).toBe(false);
    expect(shouldRunMic("auto", "traffic", true)).toBe(false);
    expect(shouldRunMic("auto", "mic", false)).toBe(false);
  });
});
