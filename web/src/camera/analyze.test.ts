import { describe, expect, it } from "vitest";
import { analyzeFrame, findLook, meanLuma, SAMPLE_H, SAMPLE_W } from "./analyze";
import { CamSampler, WORKER_STALL_MS } from "./sampler";

function frame(r: number, g: number, b: number): Uint8ClampedArray {
  const pix = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H * 4);
  for (let i = 0; i < pix.length; i += 4) { pix[i] = r; pix[i + 1] = g; pix[i + 2] = b; pix[i + 3] = 255; }
  return pix;
}

describe("camera frame analysis", () => {
  it("measures luminance on the WCAG scale", () => {
    expect(meanLuma(frame(255, 255, 255))).toBeCloseTo(1, 5);
    expect(meanLuma(frame(0, 0, 0))).toBe(0);
    expect(meanLuma(frame(118, 118, 118))).toBeCloseTo(0.18, 1);
  });

  it("finds no face in a flat grey frame", () => {
    expect(findLook(frame(90, 90, 90), SAMPLE_W, SAMPLE_H)).toBeNull();
  });

  it("finds a centred skin blob with dark eyes and reports a confident look", () => {
    const pix = frame(20, 20, 20);
    const put = (x: number, y: number, r: number, g: number, b: number) => {
      const i = (y * SAMPLE_W + x) * 4;
      pix[i] = r; pix[i + 1] = g; pix[i + 2] = b;
    };
    // face: 30x30 skin-toned block, centred
    for (let y = 12; y < 42; y++) for (let x = 33; x < 63; x++) put(x, y, 220, 170, 140);
    // two dark pupils in the upper half
    for (let y = 18; y < 21; y++) {
      for (let x = 40; x < 44; x++) put(x, y, 10, 10, 10);
      for (let x = 52; x < 56; x++) put(x, y, 10, 10, 10);
    }
    const hit = findLook(pix, SAMPLE_W, SAMPLE_H);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.x)).toBeLessThan(0.15);
    expect(hit!.conf).toBeGreaterThan(0.2);
    const s = analyzeFrame(pix, SAMPLE_W, SAMPLE_H, 123);
    expect(s.at).toBe(123);
    expect(s.gaze).toEqual(hit);
    expect(s.chroma).toBeGreaterThan(0);
  });
});

describe("CamSampler", () => {
  it("has no sample and no backend until a stream starts, and stops cleanly", () => {
    const s = new CamSampler();
    expect(s.backend).toBe("off");
    expect(s.latest).toBeNull();
    expect(s.look()).toBeNull();
    expect(s.chroma()).toBe(0);
    expect(s.luma(0.4)).toBe(0.4);
    s.stop();
    expect(s.backend).toBe("off");
  });

  it("demotes a silent worker to main-thread grabs once the video is playing", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { Worker: g.Worker, Proc: g.MediaStreamTrackProcessor };
    class SilentWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(): void { /* never replies */ }
      terminate(): void { /* noop */ }
    }
    class FakeProc { readable = { cancel: () => Promise.resolve() } }
    g.Worker = SilentWorker;
    g.MediaStreamTrackProcessor = FakeProc;
    const video = { readyState: 0, videoWidth: 0 } as unknown as HTMLVideoElement;
    const stream = { getVideoTracks: () => [{}] } as unknown as MediaStream;
    try {
      const s = new CamSampler();
      s.start(stream, video);
      expect(s.backend).toBe("worker");
      // no frames yet: the clock does not run against the worker
      s.poll(1_000);
      s.poll(1_000 + WORKER_STALL_MS * 2);
      expect(s.backend).toBe("worker");
      (video as unknown as { readyState: number }).readyState = 2;
      s.poll(20_000);
      s.poll(20_000 + WORKER_STALL_MS - 1);
      expect(s.backend).toBe("worker");
      s.poll(20_000 + WORKER_STALL_MS + 1);
      expect(s.backend).toBe("main");
      s.stop();
    } finally {
      g.Worker = saved.Worker;
      g.MediaStreamTrackProcessor = saved.Proc;
    }
  });
});
