/** Microphone device list, deviceId, missing-device announcement, policy off. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockPartial } from "../../test-support/mock-partial";
import { liveMic } from "./want";
import { Settings } from "../ui/settings";
import {
  captureMic,
  listAudioInputs,
  loadMicDevice,
  MIC_DEVICE_MISSING,
  micCaptureRequest,
  micDeviceChoices,
  missingMicDevice,
  saveMicDevice,
  settleMicChoice,
} from "./mic-device";

function devicesSection(root: ParentNode): HTMLElement | undefined {
  return [...root.querySelectorAll("section")].find((sec) => sec.querySelector(".sec-title")?.textContent === "Devices");
}

describe("microphone device", () => {
  afterEach(() => {
    localStorage.clear();
    liveMic.setPolicy("auto");
  });

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
    const src = readFileSync(resolve(import.meta.dirname, "../app/main.ts"), "utf8");
    const fn = src.slice(src.indexOf("function collectSettings"), src.indexOf("function applySettings"));
    expect(fn).not.toContain("micDevice");
    expect(localStorage.getItem("zoto-viz.micDevice")).toBe("mic-2");
  });

  it("names inputs only after permission, and opening the list does not call getUserMedia", async () => {
    const getUserMedia = vi.fn(async () => mockPartial<MediaStream>({ getTracks: () => [] }));
    const enumerateDevices = vi.fn(async () => [
      { kind: "audioinput", deviceId: "a", label: "Built-in" },
      { kind: "audioinput", deviceId: "b", label: "USB" },
      { kind: "videoinput", deviceId: "c", label: "Cam" },
    ]);
    const origDevices = navigator.mediaDevices;
    const origPerms = navigator.permissions;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices, getUserMedia },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "granted" }) },
    });
    try {
      liveMic.setPolicy("auto");
      const s = new Settings({ storePrefix: "zoto-mic-list", onChange: () => {} });
      await vi.waitFor(() => {
        expect(devicesSection(s.privacyHost)?.textContent).toContain("Built-in");
        expect(devicesSection(s.privacyHost)?.textContent).toContain("USB");
      });
      expect(getUserMedia).not.toHaveBeenCalled();
      const before = devicesSection(s.privacyHost)?.textContent ?? "";
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query: async () => ({ state: "prompt" }) },
      });
      const locked = new Settings({ storePrefix: "zoto-mic-locked", onChange: () => {} });
      await vi.waitFor(() => expect(enumerateDevices.mock.calls.length).toBeGreaterThan(0));
      const text = devicesSection(locked.privacyHost)?.textContent ?? "";
      expect(text).toContain("System default");
      expect(text).not.toContain("Built-in");
      expect(before).toContain("Microphone");
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: origDevices });
      Object.defineProperty(navigator, "permissions", { configurable: true, value: origPerms });
    }
  });

  it("passes deviceId through capture and makes no request when policy is off", async () => {
    const calls: MediaStreamConstraints[] = [];
    saveMicDevice("mic-2");
    await captureMic(false, async (c) => {
      calls.push(c);
      return {} as MediaStream;
    });
    expect(calls).toHaveLength(0);
    await captureMic(true, async (c) => {
      calls.push(c);
      return {} as MediaStream;
    });
    expect(calls).toEqual([{ audio: { deviceId: { exact: "mic-2" } }, video: false }]);
    const agent = readFileSync(resolve(import.meta.dirname, "../ui/agent.ts"), "utf8");
    const audio = readFileSync(resolve(import.meta.dirname, "./audio.ts"), "utf8");
    expect(agent).toContain('captureMic(micCaptureAllowed(), (c) => askUserMedia(c, "watchword listening"))');
    expect(agent).toContain('captureMic(micCaptureAllowed(), (c) => askUserMedia(c, "hold to talk"))');
    expect(audio).toContain("captureMic(micCaptureAllowed()");
  });

  it("a missing device falls back once and the Microphone select disables with the policy", async () => {
    saveMicDevice("gone");
    const first = settleMicChoice([{ deviceId: "a", label: "Built-in" }], true, "gone");
    expect(first.announce).toBe(MIC_DEVICE_MISSING);
    expect(first.value).toBe("");
    expect(loadMicDevice()).toBe("");
    const again = settleMicChoice([{ deviceId: "a", label: "Built-in" }], true, "gone");
    expect(again.announce).toBeNull();
    expect(await listAudioInputs(undefined, false)).toEqual([]);

    liveMic.setPolicy("off");
    const s = new Settings({ storePrefix: "zoto-mic-off", onChange: () => {} });
    const devices = devicesSection(s.privacyHost);
    const btn = [...(devices?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.includes("Microphone"));
    expect(btn?.disabled).toBe(true);
    s.setMicPolicy("auto");
    expect(btn?.disabled).toBe(false);
    s.setMicPolicy("off");
    expect(btn?.disabled).toBe(true);
  });
});
