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
    this.level = 0;
    this.bass = 0;
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
    return { level: this.level, bass: this.bass };
  }
}
