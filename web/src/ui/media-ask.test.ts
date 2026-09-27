import { afterEach, describe, expect, it, vi } from "vitest";
import { liveMic } from "../audio/want";
import { liveCam } from "../camera/livecam";
import { askUserMedia, clearMediaDismiss, dropMediaAsk, resetMediaAsk } from "./media-ask";

function fakeTrack() {
  return {
    readyState: "live" as MediaStreamTrackState,
    stop: vi.fn(function (this: { readyState: MediaStreamTrackState }) {
      this.readyState = "ended";
    }),
  };
}

function fakeStream(track = fakeTrack()) {
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

function mockCapture(getUserMedia: unknown) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn(async () => ({ state: "prompt" })) },
  });
}

describe("askUserMedia", () => {
  const origDevices = navigator.mediaDevices;
  const origPerms = (navigator as Navigator & { permissions?: unknown }).permissions;

  afterEach(() => {
    resetMediaAsk();
    liveMic.setPolicy("auto", false);
    liveCam.setPolicy("off", false);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: origDevices });
    Object.defineProperty(navigator, "permissions", { configurable: true, value: origPerms });
    vi.useRealTimers();
  });

  async function shown() {
    await vi.waitFor(() => {
      expect(document.querySelector("[data-media-ask]")).toBeTruthy();
    });
  }

  it("shows an in-page accept and only opens the device after Allow", async () => {
    const stream = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    mockCapture(getUserMedia);

    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    expect(document.body.textContent).toMatch(/Allow the microphone/);
    expect(document.body.textContent).toMatch(/embedded browser cannot show/);
    expect(getUserMedia).not.toHaveBeenCalled();

    const allow = [...document.querySelectorAll("button")].find((b) => b.textContent === "Allow");
    allow!.click();
    await expect(pending).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-media-ask]")).toBeNull();
  });

  it("keeps the device closed on Not now and does not ask again until cleared", async () => {
    const getUserMedia = vi.fn(async () => fakeStream());
    mockCapture(getUserMedia);

    const first = askUserMedia({ audio: true, video: false }, "pulse microphone");
    await shown();
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Not now")!.click();
    await expect(first).resolves.toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();

    await expect(askUserMedia({ audio: true, video: false }, "watchword listening")).resolves.toBeNull();
    expect(document.querySelector("[data-media-ask]")).toBeNull();

    clearMediaDismiss("mic");
    const again = askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Not now")!.click();
    await expect(again).resolves.toBeNull();
  });

  it("batches mic and camera into one dialog", async () => {
    const audio = fakeStream();
    const video = fakeStream();
    const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => (c.audio ? audio : video));
    mockCapture(getUserMedia);

    liveCam.setPolicy("auto", false);
    const a = askUserMedia({ audio: true, video: false }, "watchword listening");
    const b = askUserMedia({
      audio: false,
      video: { facingMode: "user" },
    }, "live camera");
    await shown();
    expect(document.querySelectorAll("[data-media-ask]")).toHaveLength(1);
    expect(document.getElementById("media-ask-title")?.textContent).toBe("Allow microphone and camera");

    [...document.querySelectorAll("button")].find((btn) => btn.textContent === "Allow")!.click();
    await expect(a).resolves.toBe(audio);
    await expect(b).resolves.toBe(video);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("does not auto-open the mic when mediaAccept is set but permission is still prompt", async () => {
    localStorage.setItem("zoto-viz.mediaAccept", JSON.stringify({ mic: true, cam: false }));
    const getUserMedia = vi.fn(async () => fakeStream());
    mockCapture(getUserMedia);
    const pending = askUserMedia({ audio: true, video: false }, "pulse microphone");
    await vi.waitFor(() => {
      expect(document.querySelector("[data-media-ask]")).toBeTruthy();
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Not now")!.click();
    await expect(pending).resolves.toBeNull();
    localStorage.removeItem("zoto-viz.mediaAccept");
  });

  it("still asks in-page when the Permissions API already says granted", async () => {
    const stream = fakeStream();
    mockCapture(vi.fn(async () => stream));
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: "granted" })) },
    });
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    expect(document.body.textContent).toMatch(/Allow the microphone/);
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Not now")!.click();
    await expect(pending).resolves.toBeNull();
  });

  it("opens the pulse mic without in-page ask when browser permission is already granted", async () => {
    const stream = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    mockCapture(getUserMedia);
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: "granted" })) },
    });
    await expect(askUserMedia({ audio: true, video: false }, "pulse microphone")).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-media-ask]")).toBeNull();
  });

  it("treats a hanging getUserMedia as a missing browser prompt", async () => {
    mockCapture(vi.fn(() => new Promise(() => { /* never */ })));

    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    vi.useFakeTimers();
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Allow")!.click();
    await vi.advanceTimersByTimeAsync(4000);
    expect(document.querySelector("[data-media-ask]")).toBeNull();
    await expect(pending).resolves.toBeNull();
  });

  it("does not open the OS microphone when header mic is off", async () => {
    const getUserMedia = vi.fn(async () => fakeStream());
    mockCapture(getUserMedia);
    liveMic.setPolicy("off", false);
    await expect(askUserMedia({ audio: true, video: false }, "watchword listening")).resolves.toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(document.querySelector("[data-media-ask]")).toBeNull();
  });

  it("does not open the OS camera when header cam is off", async () => {
    const getUserMedia = vi.fn(async () => fakeStream());
    mockCapture(getUserMedia);
    liveCam.setPolicy("off", false);
    await expect(askUserMedia({ audio: false, video: true }, "live camera")).resolves.toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("closes an in-page ask when the header toggle goes off", async () => {
    mockCapture(vi.fn(async () => fakeStream()));
    const pending = askUserMedia({ audio: true, video: false }, "pulse microphone");
    await shown();
    dropMediaAsk("mic");
    await expect(pending).resolves.toBeNull();
    expect(document.querySelector("[data-media-ask]")).toBeNull();
  });
});
