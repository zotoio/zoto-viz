import { afterEach, describe, expect, it, vi } from "vitest";
import { WakeStream } from "./wake-stream";

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
  } as unknown as MediaStream;
}

describe("WakeStream", () => {
  const orig = navigator.mediaDevices;

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: orig });
  });

  it("does not open the OS microphone on its own", async () => {
    const getUserMedia = vi.fn(async () => fakeStream());
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    const wake = new WakeStream();
    expect(await wake.enable()).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(wake.live).toBe(false);
  });

  it("keeps a handed-in stream and only stops on disable", async () => {
    const getUserMedia = vi.fn(async () => fakeStream());
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    const track = fakeTrack();
    const handed = fakeStream(track);
    const wake = new WakeStream();
    expect(await wake.enable(handed)).toBe(true);
    expect(await wake.enable()).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(wake.live).toBe(true);
    expect(track.stop).not.toHaveBeenCalled();
    wake.disable();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(wake.live).toBe(false);
  });
});
