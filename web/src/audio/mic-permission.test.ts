import { afterEach, describe, expect, it, vi } from "vitest";
import { queryMicPermissionState } from "./mic-permission";
import { askUserMedia, resetMediaAsk } from "../ui/media-ask";
import { AudioPulse } from "./audio";

describe("queryMicPermissionState", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMediaAsk();
  });

  it("returns granted when Permissions API says granted", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => ({ state: "granted" })),
      },
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: () => {} }],
        })),
      },
    });
    await expect(queryMicPermissionState()).resolves.toBe("granted");
  });

  it("returns prompt and denied from the Permissions API", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => ({ state: "prompt" })),
      },
    });
    await expect(queryMicPermissionState()).resolves.toBe("prompt");
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => ({ state: "denied" })),
      },
    });
    await expect(queryMicPermissionState()).resolves.toBe("denied");
  });
});

describe("mic boot with Permissions API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMediaAsk();
  });

  it("starts silently when OS permission is already granted", async () => {
    const gum = vi.fn(async () => ({ getTracks: () => [{ stop: () => {} }] }));
    vi.stubGlobal("navigator", {
      permissions: { query: vi.fn(async () => ({ state: "granted" })) },
      mediaDevices: { getUserMedia: gum },
    });
    const pulse = new AudioPulse();
    await pulse.enable();
    expect(gum).toHaveBeenCalled();
    pulse.disable();
  });

  it("does not call getUserMedia on load when permission is denied", async () => {
    const gum = vi.fn(async () => ({ getTracks: () => [{ stop: () => {} }] }));
    vi.stubGlobal("navigator", {
      permissions: { query: vi.fn(async () => ({ state: "denied" })) },
      mediaDevices: { getUserMedia: gum },
    });
    const pulse = new AudioPulse();
    await pulse.enable();
    expect(gum).not.toHaveBeenCalled();
    expect(pulse.awaitingClick).toBe(false);
  });

  it("does not call getUserMedia on load when permission is prompt (even with mediaAccept)", async () => {
    const gum = vi.fn(async () => ({ getTracks: () => [{ stop: () => {} }] }));
    vi.stubGlobal("navigator", {
      permissions: { query: vi.fn(async () => ({ state: "prompt" })) },
      mediaDevices: { getUserMedia: gum },
    });
    localStorage.setItem("zoto-viz.mediaAccept", JSON.stringify({ mic: true, cam: false }));
    const pulse = new AudioPulse();
    await pulse.enable();
    expect(gum).not.toHaveBeenCalled();
    expect(pulse.awaitingClick).toBe(true);
    localStorage.removeItem("zoto-viz.mediaAccept");
  });

  it("resumes capture after an explicit user resume when permission is prompt", async () => {
    const gum = vi.fn(async () => ({ getTracks: () => [{ stop: () => {} }] }));
    vi.stubGlobal("navigator", {
      permissions: { query: vi.fn(async () => ({ state: "prompt" })) },
      mediaDevices: { getUserMedia: gum },
    });
    localStorage.setItem("zoto-viz.mediaAccept", JSON.stringify({ mic: true, cam: false }));
    const pulse = new AudioPulse();
    await pulse.enable();
    expect(gum).not.toHaveBeenCalled();
    await pulse.resumeFromUserClick();
    expect(gum).toHaveBeenCalled();
    localStorage.removeItem("zoto-viz.mediaAccept");
  });
});
