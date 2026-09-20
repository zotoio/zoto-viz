/**
 * Shared 0–1 pulse for sky, floor, camera, and graph nodes. Prefers a microphone analyser when
 * the drive is set to mic; if the user denies it (or the browser has no capture), `tick(traffic)`
 * still follows packet energy so dream mode has something to react to.
 */

import { askUserMedia } from "../ui/media-ask";

export class AudioPulse {
  level = 0;
  bass = 0;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array | null = null;
  private frames: number[][] = [];
  private stream: MediaStream | null = null;
  private wanted = false;
  private starting = false;

  get listening(): boolean { return this.analyser != null; }

  async enable(): Promise<void> {
    this.wanted = true;
    if (this.analyser || this.starting) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    this.starting = true;
    try {
      const stream = await askUserMedia({ audio: true, video: false }, "pulse microphone");
      if (!stream) return;
      if (!this.wanted) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.ctx = ctx;
      this.analyser = analyser;
      this.bins = new Uint8Array(analyser.frequencyBinCount);
      this.stream = stream;
    } catch {
      // permission denied or no device — traffic fallback still runs
    } finally {
      this.starting = false;
    }
  }

  disable(): void {
    this.wanted = false;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.bins = null;
    this.frames = [];
    this.level = 0;
    this.bass = 0;
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
