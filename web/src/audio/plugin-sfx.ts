import { soundAllowed } from "./sound";

/** Low creature roar plus Backrooms bed (buzz / screech / pant). Host-side so the iframe never owns audio. */

export function roarAmp(level: number): number {
  const x = Math.max(0, Math.min(1, level));
  return x * x * 0.38;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function h11(n: number): number {
  return fract(Math.sin(n) * 43758.5453123);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function band(ph: number, a: number, b: number): number {
  return smoothstep(a, a + 0.07, ph) * smoothstep(b + 0.10, b, ph);
}

/** Locked to `plugin:backrooms` sky (`uTime` × 0.040). Pillar peek, freeze, 90° cut. */
export function backroomsPhase(t: number): {
  phA: number;
  cycle: number;
  peekOn: boolean;
  turnOn: boolean;
  peekPh: number;
  peek: number;
  freeze: number;
  flee: number;
  sprint: number;
  threat: number;
} {
  const phA = fract(t * 0.040);
  const cycle = Math.floor(t * 0.040);
  const peekOn = h11(cycle + 17) > 0.42;
  const peekPh = 0.26 + 0.05 * h11(cycle + 9);
  const peek = peekOn ? band(phA, peekPh, peekPh + 0.08) : 0;
  const freeze = peekOn
    ? smoothstep(peekPh, peekPh + 0.015, phA) * smoothstep(peekPh + 0.12, peekPh + 0.085, phA)
    : 0;
  const fleePh = peekPh + 0.12;
  const flee = peekOn ? smoothstep(fleePh, fleePh + 0.06, phA) : 0;
  const sprint = peekOn
    ? smoothstep(fleePh, fleePh + 0.04, phA) * smoothstep(0.86, 0.70, phA)
    : 0;
  const threat = Math.max(peek * 0.95, sprint * 0.75, freeze * 0.8);
  return { phA, cycle, peekOn, turnOn: flee > 0.5, peekPh, peek, freeze, flee, sprint, threat };
}

export type BackroomsSfxLevels = {
  roar: number;
  screech: number;
  pant: number;
  buzz: number;
};

/** Fluorescent bed, peek screech, close roar, pant after the sprint. */
export function backroomsSfxLevels(t: number): BackroomsSfxLevels {
  const p = backroomsPhase(t);
  const pant = smoothstep(0.72, 0.78, p.phA) * smoothstep(0.98, 0.88, p.phA);
  const chirp = h11(Math.floor(t * 0.72) + p.cycle * 3.1) > 0.93 ? 0.35 : 0;
  return {
    roar: Math.max(p.peek * 0.45, p.flee * 0.35, p.threat * 0.25),
    screech: Math.max(p.peek * 0.92, p.flee * 0.25 * (1 - p.sprint), chirp),
    pant,
    buzz: 1,
  };
}

/** @deprecated use backroomsSfxLevels — kept for the close-creature roar gate. */
export function backroomsRoarLevel(t: number): number {
  return backroomsSfxLevels(t).roar;
}

/** CC0 Freesound recordings — see `web/public/sfx/backrooms/ATTRIBUTION.md`. */
export const BACKROOMS_SAMPLE_PATHS = {
  buzz: "/sfx/backrooms/buzz.mp3",
  fluoro: "/sfx/backrooms/fluoro.mp3",
  screech: "/sfx/backrooms/screech.mp3",
  roar: "/sfx/backrooms/roar.mp3",
  pant: "/sfx/backrooms/pant.mp3",
} as const;

type SampleId = keyof typeof BACKROOMS_SAMPLE_PATHS;

let liveSampleRev = "";

function bakedSampleRev(): string {
  const env = import.meta.env.VITE_ZOTO_REV;
  return typeof env === "string" && env ? env : "dev";
}

/** Checkout SHA baked at build, or the live `repoRev` once the monitor reports it. */
export function backroomsSampleRev(): string {
  return liveSampleRev || bakedSampleRev();
}

/** Host `repoRev` — a new commit changes `?v=` so browsers drop the old mp3 cache. */
export function setBackroomsSampleRev(rev: string): void {
  const next = rev.trim();
  if (!next || next === liveSampleRev) return;
  liveSampleRev = next;
}

export function backroomsSampleUrl(id: SampleId, rev = backroomsSampleRev()): string {
  return `${BACKROOMS_SAMPLE_PATHS[id]}?v=${encodeURIComponent(rev)}`;
}

export const BACKROOMS_SAMPLE_URLS = {
  buzz: backroomsSampleUrl("buzz"),
  fluoro: backroomsSampleUrl("fluoro"),
  screech: backroomsSampleUrl("screech"),
  roar: backroomsSampleUrl("roar"),
  pant: backroomsSampleUrl("pant"),
} as const;

export class PluginSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private roarGain: GainNode | null = null;
  private buzzGain: GainNode | null = null;
  private screechGain: GainNode | null = null;
  private pantGain: GainNode | null = null;
  private pantLfo: OscillatorNode | null = null;
  private buffers = new Map<SampleId, AudioBuffer>();
  private loops: AudioBufferSourceNode[] = [];
  private lastScreech = 0;
  private lastRoar = 0;
  private loadedRev = "";
  private hydrate: Promise<void> | null = null;

  setRoar(level: number): void {
    this.setBackrooms(0, { roar: level, screech: 0, pant: 0, buzz: 0 });
  }

  setBackrooms(t: number, levels?: BackroomsSfxLevels): void {
    const L = levels ?? backroomsSfxLevels(t);
    if (!soundAllowed() || (L.roar + L.screech + L.pant + L.buzz) <= 0.008) {
      this.fadeAll(0, 0, 0, 0);
      return;
    }
    this.ensure();
    this.loadSamples();
    const sampled = this.buffers.size > 0;
    this.fadeAll(
      roarAmp(L.roar) * (sampled ? 1.15 : 1),
      (sampled ? 0.22 : 0.032) * L.buzz,
      (sampled ? 0.42 : 0.11) * L.screech,
      (sampled ? 0.32 : 0.14) * L.pant,
    );
    this.fireEdges(L);
  }

  silence(): void {
    this.fadeAll(0, 0, 0, 0);
  }

  dispose(): void {
    this.silence();
    for (const src of this.loops) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.loops = [];
    this.buffers.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.roarGain = null;
    this.buzzGain = null;
    this.screechGain = null;
    this.pantGain = null;
    this.pantLfo = null;
    this.loadedRev = "";
    this.hydrate = null;
    if (ctx) void ctx.close();
  }

  private fadeAll(roar: number, buzz: number, screech: number, pant: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    void ctx.resume();
    const now = ctx.currentTime;
    this.roarGain?.gain.setTargetAtTime(roar, now, 0.09);
    this.buzzGain?.gain.setTargetAtTime(buzz, now, 0.18);
    this.screechGain?.gain.setTargetAtTime(screech, now, 0.04);
    this.pantGain?.gain.setTargetAtTime(pant, now, 0.12);
  }

  private ensure(): void {
    if (this.ctx || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    const roarGain = ctx.createGain();
    roarGain.gain.value = 0;
    roarGain.connect(master);

    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0;
    buzzGain.connect(master);

    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    screechGain.connect(master);

    const pantGain = ctx.createGain();
    pantGain.gain.value = 0;
    pantGain.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.roarGain = roarGain;
    this.buzzGain = buzzGain;
    this.screechGain = screechGain;
    this.pantGain = pantGain;
    void ctx.resume();
    this.loadSamples();
  }

  private fireEdges(L: BackroomsSfxLevels): void {
    if (L.screech > 0.35 && this.lastScreech <= 0.35) {
      this.playOnce("screech", this.screechGain);
    }
    if (L.roar > 0.28 && this.lastRoar <= 0.28) {
      this.playOnce("roar", this.roarGain);
    }
    this.lastScreech = L.screech;
    this.lastRoar = L.roar;
  }

  private playOnce(id: SampleId, dest: GainNode | null): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !dest || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();
  }

  private startLoop(id: SampleId, dest: GainNode): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(dest);
    src.start();
    this.loops.push(src);
  }

  private loadSamples(): void {
    if (!this.ctx) return;
    const rev = backroomsSampleRev();
    if (this.hydrate && this.loadedRev === rev) return;
    if (this.hydrate && this.loadedRev !== rev) {
      for (const src of this.loops) {
        try { src.stop(); } catch { /* already stopped */ }
      }
      this.loops = [];
      this.buffers.clear();
    }
    const ctx = this.ctx;
    this.loadedRev = rev;
    this.hydrate = (async () => {
      await Promise.all(
        (Object.keys(BACKROOMS_SAMPLE_PATHS) as SampleId[]).map(async (id) => {
          try {
            const res = await fetch(backroomsSampleUrl(id, rev), { cache: "reload" });
            if (!res.ok) return;
            const raw = await res.arrayBuffer();
            this.buffers.set(id, await ctx.decodeAudioData(raw.slice(0)));
          } catch {
            /* keep synth fallback */
          }
        }),
      );
      if (!this.ctx) return;
      if (this.buzzGain) {
        if (this.buffers.has("buzz")) this.startLoop("buzz", this.buzzGain);
        if (this.buffers.has("fluoro")) this.startLoop("fluoro", this.buzzGain);
        if (!this.buffers.has("buzz") && !this.buffers.has("fluoro")) this.wireBuzz(ctx, this.buzzGain);
      }
      if (this.pantGain) {
        if (this.buffers.has("pant")) this.startLoop("pant", this.pantGain);
        else this.wirePant(ctx, this.pantGain);
      }
      if (this.roarGain && !this.buffers.has("roar")) this.wireRoar(ctx, this.roarGain);
      if (this.screechGain && !this.buffers.has("screech")) this.wireScreech(ctx, this.screechGain);
    })();
  }

  private wireRoar(ctx: AudioContext, dest: GainNode): void {
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
    lp.connect(dest);
    noise.start();
    growl.start();
    for (const hz of [32, 47, 63]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = hz < 40 ? 0.55 : 0.22;
      osc.connect(g);
      g.connect(dest);
      osc.start();
    }
  }

  private wireBuzz(ctx: AudioContext, dest: GainNode): void {
    for (const hz of [60, 119.7, 240]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = hz < 80 ? 0.22 : hz < 150 ? 0.12 : 0.04;
      osc.connect(g);
      g.connect(dest);
      osc.start();
    }
    const hiss = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    hiss.buffer = buf;
    hiss.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 4200;
    hp.Q.value = 0.7;
    const hg = ctx.createGain();
    hg.gain.value = 0.08;
    hiss.connect(hp);
    hp.connect(hg);
    hg.connect(dest);
    hiss.start();
  }

  private wireScreech(ctx: AudioContext, dest: GainNode): void {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 2760;
    const vib = ctx.createOscillator();
    vib.type = "sine";
    vib.frequency.value = 17;
    const vg = ctx.createGain();
    vg.gain.value = 90;
    vib.connect(vg);
    vg.connect(osc.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3100;
    bp.Q.value = 6;
    osc.connect(bp);
    bp.connect(dest);
    osc.start();
    vib.start();
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    noise.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = "highpass";
    nbp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.value = 0.22;
    noise.connect(nbp);
    nbp.connect(ng);
    ng.connect(dest);
    noise.start();
  }

  private wirePant(ctx: AudioContext, dest: GainNode): void {
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = 0.6 * last + 0.4 * (Math.random() * 2 - 1);
      data[i] = last;
    }
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 720;
    bp.Q.value = 0.9;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 3.4;
    const lg = ctx.createGain();
    lg.gain.value = 0.55;
    const shaped = ctx.createGain();
    shaped.gain.value = 0.45;
    lfo.connect(lg);
    lg.connect(shaped.gain);
    noise.connect(bp);
    bp.connect(shaped);
    shaped.connect(dest);
    noise.start();
    lfo.start();
    this.pantLfo = lfo;
  }
}
