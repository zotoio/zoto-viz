/**
 * Shared 0–1 pulse for sky, floor, camera, and graph nodes. Prefers a microphone analyser when
 * the drive is set to mic; if the user denies it (or the browser has no capture), `tick(traffic)`
 * still follows packet energy so dream mode has something to react to.
 */

import { askUserMedia } from "../ui/media-ask";
import { queryMicPermissionState } from "./mic-permission";

/**
 * Log-spaced 0–1 bands from an analyser byte spectrum (dB, low frequency first).
 * Skips DC. Empty capture stays at 0 — no invented shape.
 */
export function logSpectrum(
  bins: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  count: number,
): number[] {
  const out = new Array<number>(count).fill(0);
  if (count < 1 || fftSize < 4 || sampleRate <= 0 || bins.length < 2) return out;
  const hzPer = sampleRate / fftSize;
  const nyquist = sampleRate / 2;
  const f0 = 40;
  const f1 = Math.min(nyquist * 0.95, 16000);
  if (f1 <= f0) return out;
  for (let i = 0; i < count; i++) {
    const aHz = f0 * Math.pow(f1 / f0, i / count);
    const bHz = f0 * Math.pow(f1 / f0, (i + 1) / count);
    const a = Math.max(1, Math.floor(aHz / hzPer));
    const b = Math.min(bins.length, Math.max(a + 1, Math.ceil(bHz / hzPer)));
    let s = 0;
    for (let j = a; j < b; j++) s += bins[j]! / 255;
    out[i] = s / (b - a);
  }
  return out;
}

export class AudioPulse {
  level = 0;
  bass = 0;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array | null = null;
  /** Higher-resolution analyser for a real spectrum. Not the traffic stand-in. */
  private spectrumNode: AnalyserNode | null = null;
  private specBins: Uint8Array | null = null;
  private frames: number[][] = [];
  private stream: MediaStream | null = null;
  private wanted = false;
  private starting = false;
  /** Mic policy is on but capture waits for a click (Permissions API not granted yet). */
  awaitingClick = false;

  get listening(): boolean { return this.analyser != null; }

  async enable(fromUserGesture = false): Promise<void> {
    this.wanted = true;
    if (this.analyser || this.starting) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    if (!fromUserGesture) {
      const perm = await queryMicPermissionState();
      if (perm !== "granted") {
        this.awaitingClick = perm !== "denied";
        return;
      }
    }
    this.awaitingClick = false;
    this.starting = true;
    try {
      const stream = fromUserGesture
        ? await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(() => null)
        : await askUserMedia({ audio: true, video: false }, "pulse microphone");
      if (!stream) return;
      if (!this.wanted) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const spectrumNode = ctx.createAnalyser();
      spectrumNode.fftSize = 2048;
      spectrumNode.smoothingTimeConstant = 0.35;
      spectrumNode.minDecibels = -90;
      spectrumNode.maxDecibels = -20;
      source.connect(spectrumNode);
      void ctx.resume();
      this.ctx = ctx;
      this.analyser = analyser;
      this.bins = new Uint8Array(analyser.frequencyBinCount);
      this.spectrumNode = spectrumNode;
      this.specBins = new Uint8Array(spectrumNode.frequencyBinCount);
      this.stream = stream;
    } catch {
      // permission denied or no device — traffic fallback still runs
    } finally {
      this.starting = false;
    }
  }

  disable(): void {
    this.wanted = false;
    this.awaitingClick = false;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.bins = null;
    this.spectrumNode = null;
    this.specBins = null;
    this.frames = [];
    this.level = 0;
    this.bass = 0;
  }

  resumeFromUserClick(): Promise<void> {
    return this.enable(true);
  }

  /**
   * Log-frequency bands of the live microphone. All zeros when the mic is not capturing —
   * traffic is not substituted.
   */
  heard(count = 16): number[] {
    if (!this.spectrumNode || !this.specBins || !this.ctx) return new Array(count).fill(0);
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.spectrumNode.getByteFrequencyData(this.specBins as Uint8Array<ArrayBuffer>);
    return logSpectrum(this.specBins, this.ctx.sampleRate, this.spectrumNode.fftSize, count);
  }

  /**
   * Last tick's spectrum, resampled to `count` bins, low frequency first.
   * Mic FFT when the analyser is running; otherwise the traffic-shaped frame `tick` stored.
   */
  bands(count = 16): number[] {
    const frame = this.frames[this.frames.length - 1];
    const out = new Array<number>(count).fill(0);
    if (!frame?.length || count < 1) return out;
    for (let i = 0; i < count; i++) {
      const a = Math.floor((i * frame.length) / count);
      const b = Math.max(a + 1, Math.floor(((i + 1) * frame.length) / count));
      let s = 0;
      for (let j = a; j < b; j++) s += frame[j] ?? 0;
      out[i] = s / (b - a);
    }
    return out;
  }

  /** Downsampled 0–1 FFT magnitudes (mic). Empty when the analyser is off — layouts then DFT traffic. */
  spectrum(count = 32): number[] {
    const out = new Array(count).fill(0);
    if (!this.bins?.length) return out;
    const n = this.bins.length;
    for (let i = 0; i < count; i++) {
      const a = Math.floor((i * n) / count);
      const b = Math.max(a + 1, Math.floor(((i + 1) * n) / count));
      let s = 0;
      for (let j = a; j < b; j++) s += this.bins[j]! / 255;
      out[i] = s / (b - a);
    }
    return out;
  }

  /** Recent spectrum frames, oldest first (radio waterfall). */
  waterfall(): number[][] {
    return this.frames;
  }

  /** `traffic` is a 0–1 stand-in from live packet rate, used when the mic is not capturing. */
  tick(traffic = 0): { level: number; bass: number } {
    let raw = traffic, bass = traffic;
    if (this.analyser && this.bins) {
      this.analyser.getByteFrequencyData(this.bins as Uint8Array<ArrayBuffer>);
      const n = this.bins.length;
      const lo = Math.max(1, Math.floor(n * 0.14));
      let sum = 0, bsum = 0;
      for (let i = 0; i < n; i++) {
        const v = this.bins[i]! / 255;
        sum += v;
        if (i < lo) bsum += v;
      }
      raw = Math.min(1, (sum / n) * 2.4);
      bass = Math.min(1, (bsum / lo) * 1.6);
    }
    const k = 0.2;
    this.level += (raw - this.level) * k;
    this.bass += (bass - this.bass) * k;
    const frame = this.spectrum(32);
    if (!this.bins?.length) {
      for (let i = 0; i < frame.length; i++) {
        frame[i] = Math.min(1, this.level * Math.exp(-i / 9) + this.bass * Math.exp(-((i - 3) ** 2) / 18));
      }
    }
    this.frames.push(frame);
    if (this.frames.length > 18) this.frames.shift();
    return { level: this.level, bass: this.bass };
  }
}
