import * as THREE from "three";
import { parseCamPolicy, shouldRunCamera, type CamConsumer, type CamPolicy, CAM_STORE_KEY } from "./want";

/**
 * One shared webcam stream. Consumers (`live-sky`, `gaze`, `cam-theme`) are refcounted.
 * The global policy (`auto` | `off`) is an override: Off stops tracks immediately.
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
  private sampleCool = 0;
  private sampleHex = 0;

  /** Chromatic peak of the current frame (packed RGB), or 0 when the picture is dark / grey / not ready. */
  sampleMain(now = performance.now()): number {
    if (!this.ready) return 0;
    if (now < this.sampleCool) return this.sampleHex;
    this.sampleCool = now + 120;
    const pix = this.grab(48, 27);
    if (!pix) return this.sampleHex;
    const hex = dominantChroma(pix);
    if (hex) this.sampleHex = hex;
    return this.sampleHex;
  }

  /** A downscaled frame for face / colour sampling. */
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

const HUE_BINS = 24;

/** Highest-chroma hue in the frame, pushed to a usable accent lightness. Greys and near-black do not count. */
export function dominantChroma(img: ImageData): number {
  const pix = img.data;
  const mass = new Float32Array(HUE_BINS);
  const hr = new Float32Array(HUE_BINS), hg = new Float32Array(HUE_BINS), hb = new Float32Array(HUE_BINS);
  for (let i = 0; i < pix.length; i += 4) {
    const r = pix[i]!, g = pix[i + 1]!, b = pix[i + 2]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 510;
    if (d < 18 || l < 0.12 || l > 0.92) continue;
    const s = d / (255 - Math.abs(max + min - 255));
    if (s < 0.18) continue;
    let h = 0;
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    const bin = Math.min(HUE_BINS - 1, Math.floor((h / 6) * HUE_BINS));
    const w = s * (1 - Math.abs(l - 0.5) * 1.4);
    mass[bin] += w;
    hr[bin] += r * w; hg[bin] += g * w; hb[bin] += b * w;
  }
  let best = 0, bi = -1;
  for (let i = 0; i < HUE_BINS; i++) if (mass[i]! > best) { best = mass[i]!; bi = i; }
  if (bi < 0 || best < 4) return 0;
  const r = hr[bi]! / best, g = hg[bi]! / best, b = hb[bi]! / best;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
