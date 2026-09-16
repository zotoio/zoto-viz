/**
 * Synthesized CPU Doom SFX. Original envelopes — not ripped from any WAD.
 */

export class DoomSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastStep = 0;

  get ready(): boolean { return this.ctx !== null && this.ctx.state !== "closed"; }

  resume(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.ctx || this.ctx.state === "closed") {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.38;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.noise = this.makeNoise(ctx, 1);
    }
    void this.ctx.resume();
  }

  stop(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.noise = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  fire(): void {
    const ctx = this.ctx, out = this.master, noise = this.noise;
    if (!ctx || !out || !noise || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(220, t + 0.22);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(t); src.stop(t + 0.3);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(og); og.connect(out);
    osc.start(t); osc.stop(t + 0.22);
  }

  boom(dist = 1): void {
    const ctx = this.ctx, out = this.master, noise = this.noise;
    if (!ctx || !out || !noise || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const atten = Math.max(0.22, 1 / (1 + dist * 0.35));
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.85 * atten, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(lp); lp.connect(g); g.connect(out);
    src.start(t); src.stop(t + 0.5);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(72, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.35);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.4 * atten, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(og); og.connect(out);
    osc.start(t); osc.stop(t + 0.4);
  }

  gib(dist = 1): void {
    const ctx = this.ctx, out = this.master, noise = this.noise;
    if (!ctx || !out || !noise || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const atten = Math.max(0.28, 1 / (1 + dist * 0.4));
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(520, t);
    bp.frequency.exponentialRampToValueAtTime(140, t + 0.18);
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * atten, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(t); src.stop(t + 0.22);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(96, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.22 * atten, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(og); og.connect(out);
    osc.start(t); osc.stop(t + 0.16);
  }

  step(now: number, moving: boolean): void {
    if (!moving) return;
    if (now - this.lastStep < 0.36) return;
    this.lastStep = now;
    const ctx = this.ctx, out = this.master, noise = this.noise;
    if (!ctx || !out || !noise || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(lp); lp.connect(g); g.connect(out);
    src.start(t); src.stop(t + 0.08);
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
