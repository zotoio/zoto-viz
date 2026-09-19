import { describe, expect, it } from "vitest";
import { cameraConsumers, currentCamPolicy, parseCamPolicy, setCurrentCamPolicy, shouldRunCamera } from "./want";

describe("cameraConsumers", () => {
  it("does not want the camera for sky cycle alone", () => {
    expect(cameraConsumers({
      backdrop: "space",
      audioCamera: false,
      camGaze: 0,
      camTheme: false,
    })).toEqual([]);
  });

  it("does not want the camera for photographic skies", () => {
    expect(cameraConsumers({
      backdrop: "earth",
      audioCamera: false,
      camGaze: 0,
      camTheme: false,
    })).toEqual([]);
    expect(cameraConsumers({
      backdrop: "meadow",
      audioCamera: false,
      camGaze: 0,
      camTheme: false,
    })).toEqual([]);
    expect(cameraConsumers({
      backdrop: "bomb",
      audioCamera: false,
      camGaze: 0,
      camTheme: false,
    })).toEqual([]);
  });

  it("wants live-sky only when the backdrop is live", () => {
    expect(cameraConsumers({
      backdrop: "live",
      audioCamera: false,
      camGaze: 0,
      camTheme: false,
    })).toEqual(["live-sky"]);
  });

  it("wants gaze when audio camera and gaze amount are on", () => {
    expect(cameraConsumers({
      backdrop: "none",
      audioCamera: true,
      camGaze: 0.5,
      camTheme: false,
    })).toEqual(["gaze"]);
  });

  it("ignores gaze when the amount is ~0", () => {
    expect(cameraConsumers({
      backdrop: "fractal",
      audioCamera: true,
      camGaze: 0,
      camTheme: false,
    })).toEqual([]);
  });

  it("wants cam-theme independently", () => {
    expect(cameraConsumers({
      backdrop: "none",
      audioCamera: false,
      camGaze: 0,
      camTheme: true,
    })).toEqual(["cam-theme"]);
  });
});

describe("shouldRunCamera", () => {
  it("stops the stream when policy is off even with consumers", () => {
    expect(shouldRunCamera("off", ["live-sky"])).toBe(false);
  });

  it("runs in auto when at least one consumer is present", () => {
    expect(shouldRunCamera("auto", ["gaze"])).toBe(true);
    expect(shouldRunCamera("auto", [])).toBe(false);
  });
});

describe("parseCamPolicy", () => {
  it("defaults to off", () => {
    expect(parseCamPolicy(null)).toBe("off");
    expect(parseCamPolicy("auto")).toBe("auto");
    expect(parseCamPolicy("off")).toBe("off");
    expect(parseCamPolicy("nope")).toBe("off");
  });
});

describe("currentCamPolicy", () => {
  it("tracks the header cam toggle for askUserMedia", () => {
    setCurrentCamPolicy("off");
    expect(currentCamPolicy()).toBe("off");
    setCurrentCamPolicy("auto");
    expect(currentCamPolicy()).toBe("auto");
    setCurrentCamPolicy("off");
  });
});
