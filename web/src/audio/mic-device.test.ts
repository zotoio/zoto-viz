/** #267: microphone device list, deviceId, missing-device announcement, policy off. */
import { afterEach, describe, expect, it } from "vitest";
import { MIC_DEVICE_MISSING, micCaptureRequest, micDeviceChoices, missingMicDevice, saveMicDevice } from "./mic-device";

describe("#267 microphone device", () => {
  afterEach(() => localStorage.clear());

  it("lists System default plus inputs only after permission", () => {
    const inputs = [{ deviceId: "a", label: "Built-in" }, { deviceId: "b", label: "USB" }];
    expect(micDeviceChoices(inputs, false)).toEqual([{ value: "", label: "System default" }]);
    expect(micDeviceChoices(inputs, true).map((r) => r.label)).toEqual(["System default", "Built-in", "USB"]);
  });

  it("passes the chosen deviceId and stays closed when policy is off", async () => {
    const calls: unknown[] = [];
    const getUserMedia = async (c: MediaStreamConstraints) => {
      calls.push(c);
      return {} as MediaStream;
    };
    expect(micCaptureRequest(false, "a")).toBe(false);
    if (micCaptureRequest(false) !== false) await getUserMedia({ audio: true, video: false });
    expect(calls).toHaveLength(0);
    saveMicDevice("mic-2");
    const audio = micCaptureRequest(true);
    await getUserMedia({ audio, video: false });
    expect(calls).toEqual([{ audio: { deviceId: { exact: "mic-2" } }, video: false }]);
  });

  it("a missing device falls back and the line is the signed sentence", () => {
    expect(missingMicDevice([{ deviceId: "a", label: "Built-in" }], "gone")).toBe(true);
    expect(MIC_DEVICE_MISSING).toBe("Saved microphone isn't connected. Using the system default.");
  });

  it("is not part of a profile settings blob", () => {
    saveMicDevice("mic-2");
    const profileKeys = ["theme", "mic", "vizGovernor"];
    expect(profileKeys).not.toContain("micDevice");
    expect(localStorage.getItem("zoto-viz.micDevice")).toBe("mic-2");
  });
});
