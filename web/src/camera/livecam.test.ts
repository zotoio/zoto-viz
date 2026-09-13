import { describe, expect, it } from "vitest";
import { dominantChroma, liveCam } from "./livecam";
import { cycleSkyPool } from "../graph/backdrop";

describe("dominantChroma", () => {
  it("returns 0 for a grey frame and a hue for saturated red", () => {
    const grey = new ImageData(8, 8);
    for (let i = 0; i < grey.data.length; i += 4) {
      grey.data[i] = 80; grey.data[i + 1] = 80; grey.data[i + 2] = 80; grey.data[i + 3] = 255;
    }
    expect(dominantChroma(grey)).toBe(0);
    const red = new ImageData(12, 12);
    for (let i = 0; i < red.data.length; i += 4) {
      red.data[i] = 220; red.data[i + 1] = 20; red.data[i + 2] = 20; red.data[i + 3] = 255;
    }
    expect(dominantChroma(red)).toBeGreaterThan(0);
  });
});

describe("liveCam policy", () => {
  it("refcounts consumers and honour Off", () => {
    liveCam.setPolicy("off");
    liveCam.setWanted("gaze", true);
    expect(liveCam.wanted).toBe(false);
    expect(liveCam.camPolicy).toBe("off");
    expect(cycleSkyPool()).not.toContain("live");
    liveCam.setPolicy("auto", false);
    expect(liveCam.wanted).toBe(true);
    expect(liveCam.consumerIds).toContain("gaze");
    expect(liveCam.sampleMain()).toBe(0);
    expect(liveCam.grab(4, 4)).toBeNull();
    liveCam.setWanted("gaze", false);
    liveCam.setPolicy("off", false);
  });
});
