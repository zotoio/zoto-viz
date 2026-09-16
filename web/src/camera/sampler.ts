/**
 * One shared analysis of the webcam for every consumer (gaze, live colour, live luma).
 *
 * Preferred backend: a `MediaStreamTrackProcessor` readable handed to `cam.worker.ts`, so frames are
 * decoded, downsampled and analysed off the main thread and the render loop only reads the latest
 * numbers. Fallback (no WebCodecs track processor, no Worker, or the worker failed): one small
 * main-thread `drawImage(video)` at most every `FALLBACK_MS`, shared by all three consumers, instead
 * of the three separate grabs at up to 30 Hz that used to stall the frame.
 */

import { analyzeFrame, SAMPLE_H, SAMPLE_HZ, SAMPLE_W, type CamSample, type LookHit } from "./analyze";
import type { CamWorkerIn, CamWorkerOut } from "./cam.worker";

/** Main-thread fallback cadence. */
export const FALLBACK_MS = 100;
/** A look sample older than this no longer steers the camera. */
export const STALE_MS = 700;
/**
 * No sample from the worker for this long while the video is playing means it is dead or never
 * started (some embedded browsers construct Workers that never run): grab on the main thread instead.
 */
export const WORKER_STALL_MS = 2500;

interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack; maxBufferSize?: number }): { readable: ReadableStream<VideoFrame> };
}

function trackProcessor(): TrackProcessorCtor | null {
  const g = globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor };
  return typeof g.MediaStreamTrackProcessor === "function" ? g.MediaStreamTrackProcessor : null;
}

export type CamBackend = "worker" | "main" | "off";

export class CamSampler {
  private worker: Worker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private fallbackAt = -Infinity;
  /** when the video first had frames while the worker backend was active (watchdog reference) */
  private readyAt = 0;
  private _latest: CamSample | null = null;
  private _backend: CamBackend = "off";
  /** true once the worker path failed for this stream; stay on the main thread until the next start */
  private workerBroken = false;

  get latest(): CamSample | null { return this._latest; }
  get backend(): CamBackend { return this._backend; }

  start(stream: MediaStream, video: HTMLVideoElement): void {
    this.stop();
    this.stream = stream;
    this.video = video;
    this.workerBroken = false;
    if (!this.startWorker()) this._backend = "main";
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage({ type: "stop" } satisfies CamWorkerIn);
      this.worker.terminate();
      this.worker = null;
    }
    this.stream = null;
    this.video = null;
    this._latest = null;
    this._backend = "off";
    this.fallbackAt = -Infinity;
    this.readyAt = 0;
  }

  /**
   * Main-thread fallback grab, rate-limited. A no-op while the worker backend is live. Consumers call
   * this before reading so the fallback only costs when something actually wants the numbers.
   */
  poll(now = performance.now()): void {
    if (!this.video) return;
    if (this._backend === "worker") {
      // watchdog: the video is playing but nothing has come back from the worker
      if (this.video.readyState < 2) { this.readyAt = 0; return; }
      if (!this.readyAt) this.readyAt = now;
      const last = this._latest?.at ?? this.readyAt;
      if (now - last > WORKER_STALL_MS && this.worker) this.demote(this.worker, this.stream);
      return;
    }
    if (this._backend !== "main") return;
    if (now - this.fallbackAt < FALLBACK_MS) return;
    const v = this.video;
    if (v.readyState < 2 || v.videoWidth < 8) return;
    this.fallbackAt = now;
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = SAMPLE_W;
      this.canvas.height = SAMPLE_H;
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      ctx.save();
      ctx.translate(SAMPLE_W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H);
      ctx.restore();
      const pix = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      this._latest = analyzeFrame(pix, SAMPLE_W, SAMPLE_H, now);
    } catch {
      /* a tainted or not-yet-decodable frame; try again next interval */
    }
  }

  /** Latest face / pupil estimate, or null (also when the last sample is stale — worker stalled or stream gone). */
  look(now = performance.now()): LookHit | null {
    this.poll(now);
    const s = this._latest;
    if (!s || now - s.at > STALE_MS) return null;
    return s.gaze;
  }

  /** Latest dominant hue (packed RGB) or 0. */
  chroma(now = performance.now()): number {
    this.poll(now);
    return this._latest?.chroma ?? 0;
  }

  /** Latest mean luminance, or `fallback` before the first frame. */
  luma(fallback: number, now = performance.now()): number {
    this.poll(now);
    return this._latest?.luma ?? fallback;
  }

  private startWorker(): boolean {
    if (this.workerBroken || typeof Worker === "undefined") return false;
    const Proc = trackProcessor();
    const track = this.stream?.getVideoTracks()[0];
    if (!Proc || !track) return false;
    let readable: ReadableStream<VideoFrame>;
    try {
      readable = new Proc({ track, maxBufferSize: 1 }).readable;
    } catch {
      return false;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./cam.worker.ts", import.meta.url), { type: "module", name: "zoto-cam" });
    } catch {
      try { void readable.cancel(); } catch { /* ignore */ }
      return false;
    }
    const stream = this.stream;
    worker.onmessage = (ev: MessageEvent<CamWorkerOut>) => {
      if (this.worker !== worker) return;
      const m = ev.data;
      if (m.type === "sample") {
        // stamp in this thread's clock so age checks compare like with like
        this._latest = { ...m.sample, at: performance.now() };
      } else if (m.type === "error" || m.type === "ended") {
        this.demote(worker, stream);
      }
    };
    worker.onerror = () => this.demote(worker, stream);
    worker.postMessage({ type: "start", readable, hz: SAMPLE_HZ } satisfies CamWorkerIn, [readable as unknown as Transferable]);
    this.worker = worker;
    this._backend = "worker";
    this.readyAt = 0;
    return true;
  }

  /** The worker path failed for this stream: fall back to main-thread grabs for the rest of it. */
  private demote(worker: Worker, stream: MediaStream | null): void {
    if (this.worker !== worker) return;
    worker.terminate();
    this.worker = null;
    this.workerBroken = true;
    if (this.stream && this.stream === stream) this._backend = "main";
    else this._backend = "off";
  }
}
