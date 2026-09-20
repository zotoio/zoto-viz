/** Low creature roar for viz plugins. Host-side so the sandboxed iframe never owns audio. */

export function roarAmp(level: number): number {
  const x = Math.max(0, Math.min(1, level));
  return x * x * 0.38;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function hold(ph: number, a: number, b: number): number {
  return smoothstep(0, a, ph) * smoothstep(b + 0.12, b, ph);
}

function band(ph: number, a: number, b: number): number {
  return smoothstep(a, a + 0.07, ph) * smoothstep(b + 0.10, b, ph);
}

/** Locked to `plugins` local Backrooms sky (`uTime`). Roar on glance, spot, and the turn-and-run. */
export function backroomsRoarLevel(t: number): number {
  const phA = t * 0.040 - Math.floor(t * 0.040);
  const seen = smoothstep(0.11, 0.145, phA);
  const come = seen * (1 - smoothstep(0.20, 0.26, phA));
  const lookUp = hold(phA, 0.04, 0.10) * (1 - seen);
  const turned = smoothstep(0.16, 0.22, phA);
  const flee = Math.max(band(phA, 0.16, 0.88), turned);
  const spot = come * (1 - turned);
  return Math.max(spot * 0.55, flee);
}

export class PluginSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private level = 0;

  setRoar(level: number): void {
    this.level = Math.max(0, Math.min(1, level));
    if (this.level <= 0.008) {
      this.fade(0);
      return;
    }
    this.ensure();
    this.fade(roarAmp(this.level));
  }

  silence(): void {
    this.level = 0;
    this.fade(0);
  }

  dispose(): void {
    this.silence();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close();
  }

  private fade(amp: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    void ctx.resume();
    master.gain.setTargetAtTime(amp, ctx.currentTime, 0.09);
  }

  private ensure(): void {
    if (this.ctx || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = 0.92 * last + 0.08 * (Math.random() * 2 - 1);
      data[i] = last;
    }
    noise.buffer = buf;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 78;
    lp.Q.value = 1.6;
    const growl = ctx.createOscillator();
    growl.type = "sine";
    growl.frequency.value = 2.4;
    const growlGain = ctx.createGain();
    growlGain.gain.value = 28;
    growl.connect(growlGain);
    growlGain.connect(lp.frequency);
    noise.connect(lp);
    lp.connect(master);
    noise.start();
    growl.start();

    for (const hz of [32, 47, 63]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = hz < 40 ? 0.55 : 0.22;
      osc.connect(g);
      g.connect(master);
      osc.start();
    }

    this.ctx = ctx;
    this.master = master;
    void ctx.resume();
  }
}
