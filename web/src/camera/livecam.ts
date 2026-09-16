import * as THREE from "three";
import { parseCamPolicy, shouldRunCamera, type CamConsumer, type CamPolicy, CAM_STORE_KEY } from "./want";
import { dominantChroma, type LookHit } from "./analyze";
import { CamSampler } from "./sampler";

export { dominantChroma };

/**
 * One shared webcam stream. Consumers (`live-sky`, `gaze`, `cam-theme`) are refcounted.
 * The global policy (`auto` | `off`) is an override: Off stops tracks immediately.
 *
 * Pixel analysis (face, dominant colour, luminance) runs through one `CamSampler` — in a worker when
 * the browser has WebCodecs track processors — so the render loop never copies video frames itself.
 */

class LiveCam {
  readonly video = document.createElement("video");
  private tex: THREE.VideoTexture | null = null;
  private stream: MediaStream | null = null;
  private starting = false;
  private policy: CamPolicy = parseCamPolicy(
    typeof localStorage !== "undefined" ? localStorage.getItem(CAM_STORE_KEY) : "off",
  );
  private readonly consumers = new Set<CamConsumer>();
  blocked = false;
  onPolicy?: (p: CamPolicy) => void;

  constructor() {
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.setAttribute("playsinline", "");
  }

  get texture(): THREE.VideoTexture | null { return this.tex; }
  get ready(): boolean { return this.tex != null && this.video.readyState >= 2 && this.video.videoWidth > 0; }
  get wanted(): boolean { return shouldRunCamera(this.policy, this.consumers); }
  get camPolicy(): CamPolicy { return this.policy; }

  private grabCanvas: HTMLCanvasElement | null = null;
  private grabCtx: CanvasRenderingContext2D | null = null;
  private sampleHex = 0;
  private lumaSample = 0.55;
  /** shared frame analysis (worker when available); started with the stream, stopped with it */
  readonly sampler = new CamSampler();

  /** Chromatic peak of the current frame (packed RGB), or 0 when the picture is dark / grey / not ready. */
  sampleMain(now = performance.now()): number {
    if (!this.ready) return 0;
    const hex = this.sampler.chroma(now);
    if (hex) this.sampleHex = hex;
    return this.sampleHex;
  }

  /** Mean WCAG luminance of the current frame (0–1), for label ink. */
  sampleLuma(now = performance.now()): number {
    if (!this.ready) return this.lumaSample;
    this.lumaSample = this.sampler.luma(this.lumaSample, now);
    return this.lumaSample;
  }

  /** Latest face / pupil estimate on the mirrored frame, or null when not ready / nobody in frame. */
  lookSample(now = performance.now()): LookHit | null {
    if (!this.ready) return null;
    return this.sampler.look(now);
  }

  /**
   * A downscaled frame copied on the main thread. This is the expensive path (it forces a GPU→CPU copy
   * of the whole video frame); nothing in the render loop uses it any more. Kept for one-off callers.
   */
  grab(w: number, h: number): ImageData | null {
    if (!this.ready) return null;
    if (!this.grabCanvas) {
      this.grabCanvas = document.createElement("canvas");
      this.grabCtx = this.grabCanvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = this.grabCtx;
    if (!ctx) return null;
    this.grabCanvas.width = w;
    this.grabCanvas.height = h;
    ctx.drawImage(this.video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  setPolicy(policy: CamPolicy, persist = true): void {
    this.policy = policy;
    if (persist && typeof localStorage !== "undefined") localStorage.setItem(CAM_STORE_KEY, policy);
    this.sync();
    this.onPolicy?.(policy);
  }

  setWanted(consumer: CamConsumer, on: boolean): void {
    if (on) this.consumers.add(consumer);
    else this.consumers.delete(consumer);
    this.sync();
  }

  private sync(): void {
    if (this.wanted) void this.ensure();
    else this.stop();
  }

  async ensure(): Promise<THREE.VideoTexture | null> {
    if (!this.wanted) return this.tex;
    if (this.tex) return this.tex;
    if (this.starting || this.blocked) return null;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.blocked = true;
      return null;
    }
    this.starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (!this.wanted) {
        for (const t of stream.getTracks()) t.stop();
        return null;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      this.sampler.start(stream, this.video);
      const tex = new THREE.VideoTexture(this.video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.tex = tex;
      return tex;
    } catch {
      this.blocked = true;
      return null;
    } finally {
      this.starting = false;
    }
  }

  private stop(): void {
    this.sampler.stop();
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    this.tex?.dispose();
    this.tex = null;
  }

  /** Test helper: who currently holds a want. */
  get consumerIds(): CamConsumer[] { return [...this.consumers]; }
}

export const liveCam = new LiveCam();
