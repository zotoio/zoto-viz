/**
 * Camera analysis off the main thread. The page hands over a `MediaStreamTrackProcessor` readable
 * (WebCodecs `VideoFrame`s); this worker downsamples each frame it keeps onto a small OffscreenCanvas,
 * runs the gaze / colour / luma analysis, and posts one `CamSample`. The main thread never touches
 * the video pixels, so the GPU→CPU copy that `drawImage(video)` implies cannot stall the render loop.
 */

import { analyzeFrame, SAMPLE_H, SAMPLE_HZ, SAMPLE_W, type CamSample } from "./analyze";

export type CamWorkerIn =
  | { type: "start"; readable: ReadableStream<VideoFrame>; hz?: number }
  | { type: "stop" };

export type CamWorkerOut =
  | { type: "sample"; sample: CamSample }
  | { type: "error"; message: string }
  | { type: "ended" };

let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let generation = 0;

const post = (m: CamWorkerOut): void => { (self as unknown as Worker).postMessage(m); };

async function run(readable: ReadableStream<VideoFrame>, hz: number, gen: number): Promise<void> {
  let canvas: OffscreenCanvas;
  let ctx: OffscreenCanvasRenderingContext2D | null;
  try {
    canvas = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  } catch (e) {
    post({ type: "error", message: `offscreen canvas: ${String(e)}` });
    return;
  }
  if (!ctx) {
    post({ type: "error", message: "offscreen 2d context unavailable" });
    return;
  }
  const r = readable.getReader();
  reader = r;
  const minGap = 1000 / Math.max(1, hz);
  let last = -Infinity;
  try {
    for (;;) {
      const { value: frame, done } = await r.read();
      if (done || gen !== generation) { frame?.close(); break; }
      const now = performance.now();
      if (now - last < minGap) { frame.close(); continue; }
      last = now;
      try {
        // Mirror so +x is the right of the screen, matching a selfie view (the gaze math assumes this).
        ctx.save();
        ctx.translate(SAMPLE_W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(frame, 0, 0, SAMPLE_W, SAMPLE_H);
        ctx.restore();
      } catch (e) {
        frame.close();
        post({ type: "error", message: `drawImage(VideoFrame): ${String(e)}` });
        break;
      }
      frame.close();
      const pix = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      post({ type: "sample", sample: analyzeFrame(pix, SAMPLE_W, SAMPLE_H, now) });
    }
  } catch (e) {
    post({ type: "error", message: String(e) });
  } finally {
    try { r.releaseLock(); } catch { /* stream already gone */ }
    if (reader === r) reader = null;
    post({ type: "ended" });
  }
}

self.onmessage = (ev: MessageEvent<CamWorkerIn>) => {
  const m = ev.data;
  if (m.type === "start") {
    generation++;
    void run(m.readable, m.hz ?? SAMPLE_HZ, generation);
  } else if (m.type === "stop") {
    generation++;
    const r = reader;
    reader = null;
    if (r) void r.cancel().catch(() => undefined);
  }
};
