import { soundAllowed } from "./sound";
import {
  backroomsEvents,
  backroomsFrame,
  backroomsOptions,
  type BrEvent,
  type BrOptions,
  type BrSfx,
} from "../../../plugins/src/backrooms/frontend/director";

/** Backrooms sound bed, driven by the same director track as the sky. Host-side so the iframe never owns audio. */

/** CC0 Freesound recordings — see `web/public/sfx/backrooms/ATTRIBUTION.md`. */
export const BACKROOMS_SAMPLE_PATHS = {
  buzz: "/sfx/backrooms/buzz.mp3",
  fluoro: "/sfx/backrooms/fluoro.mp3",
  screech: "/sfx/backrooms/screech.mp3",
  roar: "/sfx/backrooms/roar.mp3",
  pant: "/sfx/backrooms/pant.mp3",
  box: "/sfx/backrooms/box.mp3",
  frozen: "/sfx/backrooms/frozen.mp3",
  scared: "/sfx/backrooms/scared.mp3",
  gasp: "/sfx/backrooms/gasp.mp3",
  gasp2: "/sfx/backrooms/gasp2.mp3",
  walk: "/sfx/backrooms/walk.mp3",
  run: "/sfx/backrooms/run.mp3",
  heart: "/sfx/backrooms/heart.mp3",
  handle: "/sfx/backrooms/handle.mp3",
  scream: "/sfx/backrooms/scream.mp3",
  yelp: "/sfx/backrooms/yelp.mp3",
  roar2: "/sfx/backrooms/roar2.mp3",
  roar3: "/sfx/backrooms/roar3.mp3",
  cry1: "/sfx/backrooms/cry1.mp3",
  cry2: "/sfx/backrooms/cry2.mp3",
  cry3: "/sfx/backrooms/cry3.mp3",
  cry4: "/sfx/backrooms/cry4.mp3",
} as const;

type SampleId = keyof typeof BACKROOMS_SAMPLE_PATHS;

/** Footfall onsets (s) in `walk.mp3` / `run.mp3`; each director step plays one slice. */
export const BACKROOMS_WALK_STEPS = [0.418, 0.808, 1.338, 1.748, 2.088, 3.208, 4.198, 4.838, 5.318, 5.868, 6.408, 8.758, 9.798];
export const BACKROOMS_RUN_STEPS = [0.438, 1.488, 2.178, 2.498, 3.198, 3.548, 4.218, 4.568, 4.908, 9.708, 14.108, 16.468, 17.818, 18.508, 19.858, 20.538, 21.208];

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

export const BACKROOMS_SAMPLE_URLS = Object.fromEntries(
  (Object.keys(BACKROOMS_SAMPLE_PATHS) as SampleId[]).map((id) => [id, backroomsSampleUrl(id)]),
) as Record<SampleId, string>;

/** Bed gains (before master) for the director's continuous levels, scaled by the view's mix sliders. */
export function backroomsBedGains(s: BrSfx, mix: Pick<BrOptions, "breathing" | "heartbeat" | "creatureVolume"> = { breathing: 1, heartbeat: 1, creatureVolume: 1 }): Record<"buzz" | "frozen" | "pant" | "scared" | "heart" | "rumble", number> {
  return {
    buzz: 0.22 * s.buzz,
    frozen: 0.55 * s.frozen * mix.breathing,
    pant: 0.4 * s.pant * mix.breathing,
    scared: 0.38 * s.heavy * mix.breathing,
    heart: 0.24 * s.heart * mix.heartbeat,
    rumble: 0.22 * s.near * mix.creatureVolume,
  };
}

type Bed = "buzz" | "frozen" | "pant" | "scared" | "heart" | "rumble";

export class PluginSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 0–1 master for the Backrooms bed; UI stores 0–100. */
  private masterVolume = 1;
  private beds = new Map<Bed, GainNode>();
  private heartSrc: AudioBufferSourceNode | null = null;
  private buffers = new Map<SampleId, AudioBuffer>();
  private loops: AudioBufferSourceNode[] = [];
  private noise: AudioBuffer | null = null;
  private lastT = -1;
  private gaspFlip = false;
  private loadedRev = "";
  private hydrate: Promise<void> | null = null;

  setBackrooms(t: number): void {
    const prev = this.lastT;
    this.lastT = t;
    if (!soundAllowed()) {
      this.fadeBeds(null);
      return;
    }
    this.ensure();
    this.loadSamples();
    const f = backroomsFrame(t);
    this.fadeBeds(backroomsBedGains(f.sfx, backroomsOptions()));
    if (this.heartSrc && this.ctx) this.heartSrc.playbackRate.setTargetAtTime(f.sfx.heartRate, this.ctx.currentTime, 0.4);
    if (prev >= 0 && t > prev && t - prev < 0.5) {
      for (const ev of backroomsEvents(prev, t)) this.cue(ev);
    }
  }

  silence(): void {
    this.fadeBeds(null);
    this.lastT = -1;
  }

  /** Master volume for all Backrooms beds (0–1). */
  setMasterVolume(level: number): void {
    const v = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
    this.masterVolume = v;
    const ctx = this.ctx;
    if (ctx && this.master) {
      this.master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    }
  }

  masterVolumeLevel(): number {
    return this.masterVolume;
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
    this.beds.clear();
    this.heartSrc = null;
    this.noise = null;
    this.loadedRev = "";
    this.hydrate = null;
    if (ctx) void ctx.close();
  }

  private fadeBeds(g: Record<Bed, number> | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (g) void ctx.resume();
    const now = ctx.currentTime;
    for (const [id, node] of this.beds) {
      const tau = id === "buzz" ? 0.18 : id === "frozen" ? 0.25 : 0.35;
      node.gain.setTargetAtTime(g ? g[id] : 0, now, tau);
    }
  }

  private ensure(): void {
    if (this.ctx || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.masterVolume;
    master.connect(ctx.destination);
    for (const id of ["buzz", "frozen", "pant", "scared", "heart", "rumble"] as Bed[]) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(master);
      this.beds.set(id, g);
    }
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;
    this.ctx = ctx;
    this.master = master;
    this.wireRumble(ctx, this.beds.get("rumble")!);
    void ctx.resume();
    this.loadSamples();
  }

  /** Output chain for a one-shot: gain → optional stereo pan → master. */
  private out(gain: number, pan: number): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (typeof ctx.createStereoPanner === "function" && pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  private slice(id: SampleId, offset: number, dur: number, gain: number, pan = 0, rate = 1): boolean {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf) return false;
    const dest = this.out(0, pan);
    if (!dest) return false;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(dest);
    const end = Math.min(dur, Math.max(0.05, buf.duration - offset));
    dest.gain.setValueAtTime(0, now);
    dest.gain.linearRampToValueAtTime(gain, now + 0.012);
    dest.gain.setValueAtTime(gain, now + Math.max(0.02, end - 0.25));
    dest.gain.linearRampToValueAtTime(0, now + end);
    src.start(now, Math.max(0, offset), end + 0.05);
    return true;
  }

  private cue(ev: BrEvent): void {
    const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.abs(ev.t * 37.3)) % list.length]!;
    const vary = 0.94 + 0.12 * ((ev.t * 13.7) % 1);
    const mix = backroomsOptions();
    const cv = mix.creatureVolume;
    switch (ev.id) {
      case "step":
        if (!this.slice("walk", pick(BACKROOMS_WALK_STEPS) - 0.015, 0.32, 0.55 * ev.gain * mix.footsteps, ev.pan * 0.3, vary)) this.thud(0.25 * ev.gain * mix.footsteps, 140, ev.pan);
        break;
      case "run":
        if (!this.slice("run", pick(BACKROOMS_RUN_STEPS) - 0.015, 0.28, 0.75 * ev.gain * mix.footsteps, ev.pan * 0.3, vary)) this.thud(0.4 * ev.gain * mix.footsteps, 110, ev.pan);
        break;
      case "cstep":
        this.knock(ev.gain * cv, ev.pan);
        break;
      case "shriek": {
        // Chase screams: a different throat each time.
        const id = pick(["screech", "cry1", "cry2", "cry3", "cry4"] as const);
        const off = id === "screech" ? 3 * Math.floor(Math.abs(ev.t * 7.1) % 7) : id === "cry2" ? Math.abs(ev.t * 3.3) % 4 : 0;
        this.slice(id, off, 1.4 + 0.8 * ((ev.t * 5.9) % 1), 0.75 * ev.gain * cv, ev.pan * 0.7, vary);
        break;
      }
      case "gasp":
        this.gaspFlip = !this.gaspFlip;
        this.slice(this.gaspFlip ? "gasp" : "gasp2", 0, 1.0, 0.9 * ev.gain * mix.breathing);
        break;
      case "scream":
        this.slice("scream", 0, 3.0, 0.7 * ev.gain);
        break;
      case "yelp":
        this.slice("yelp", 0, 0.9, 0.65 * ev.gain);
        break;
      case "drop":
        this.thud(0.7 * ev.gain, 95, 0);
        this.slice("handle", 0.2, 0.8, 0.8 * ev.gain);
        break;
      case "roar": {
        const id = pick(["roar", "roar2", "roar3"] as const);
        if (!this.slice(id, 0, 3.8, 0.9 * ev.gain * cv, ev.pan * 0.7)) this.thud(0.5 * ev.gain * cv, 48, ev.pan);
        break;
      }
      case "screech":
        this.slice("screech", 0.2, 2.6, 0.6 * ev.gain * cv, ev.pan * 0.7);
        break;
      case "hoo":
        this.hoo(ev.gain * cv, ev.pan);
        break;
      case "handle":
        this.slice("handle", 0, 0.55, 0.45 * ev.gain);
        break;
      case "box":
        this.slice("box", 0, 6.6, 0.3 * ev.gain);
        break;
      case "tapeIn":
      case "tapeOut":
        this.tape(ev.id === "tapeIn", ev.gain);
        break;
    }
  }

  /** Soft carpet thud when the footstep recordings have not loaded. */
  private thud(gain: number, hz: number, pan: number): void {
    const ctx = this.ctx;
    const dest = this.out(gain, pan);
    if (!ctx || !dest) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(hz, now);
    osc.frequency.exponentialRampToValueAtTime(hz * 0.5, now + 0.12);
    dest.gain.setValueAtTime(gain, now);
    dest.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(dest);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  /** The Lifeform's limbs on carpet: a dry knock plus a clicking tick. */
  private knock(gain: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    this.thud(0.35 * gain, 75 + 30 * Math.random(), pan);
    const dest = this.out(0.25 * gain, pan);
    if (!dest) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500 + 1200 * Math.random();
    bp.Q.value = 4;
    dest.gain.setValueAtTime(0.25 * gain, now);
    dest.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    src.connect(bp);
    bp.connect(dest);
    src.start(now, Math.random() * 0.8, 0.06);
  }

  /** Deep owl-like "HOO" from down the hall, with a short slap-back off the walls. */
  private hoo(gain: number, pan: number): void {
    const ctx = this.ctx;
    const dest = this.out(0, pan);
    if (!ctx || !dest) return;
    const now = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.17;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    for (const [hz, amp] of [[92, 1], [184, 0.35], [276, 0.12]] as const) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(hz * 1.08, now);
      o.frequency.exponentialRampToValueAtTime(hz * 0.9, now + 0.7);
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og);
      og.connect(lp);
      o.start(now);
      o.stop(now + 0.95);
    }
    lp.connect(dest);
    lp.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    fb.connect(dest);
    dest.gain.setValueAtTime(0, now);
    dest.gain.linearRampToValueAtTime(0.28 * gain, now + 0.09);
    dest.gain.setTargetAtTime(0, now + 0.6, 0.18);
  }

  /** Camcorder record start / stop: a mechanism clunk and a burst of tape hiss. */
  private tape(start: boolean, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    this.thud(0.3 * gain, start ? 220 : 160, 0);
    const dest = this.out(0, 0);
    if (!dest) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2400;
    src.connect(hp);
    hp.connect(dest);
    dest.gain.setValueAtTime(0.12 * gain, now);
    dest.gain.exponentialRampToValueAtTime(0.001, now + (start ? 0.45 : 0.3));
    src.start(now, 0, 0.5);
  }

  private startLoop(id: SampleId, dest: GainNode): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(dest);
    src.start(0, Math.random() * buf.duration);
    this.loops.push(src);
    return src;
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
      const bed = (id: Bed): GainNode => this.beds.get(id)!;
      if (this.buffers.has("buzz")) this.startLoop("buzz", bed("buzz"));
      if (this.buffers.has("fluoro")) this.startLoop("fluoro", bed("buzz"));
      if (!this.buffers.has("buzz") && !this.buffers.has("fluoro")) this.wireBuzz(ctx, bed("buzz"));
      if (this.buffers.has("pant")) this.startLoop("pant", bed("pant"));
      else this.wireBreath(ctx, bed("pant"), 3.4);
      if (this.buffers.has("frozen")) this.startLoop("frozen", bed("frozen"));
      else this.wireBreath(ctx, bed("frozen"), 1.1);
      if (this.buffers.has("scared")) this.startLoop("scared", bed("scared"));
      else this.wireBreath(ctx, bed("scared"), 1.8);
      this.heartSrc = this.startLoop("heart", bed("heart"));
    })();
  }

  private wireRumble(ctx: AudioContext, dest: GainNode): void {
    for (const hz of [31, 44]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = hz < 40 ? 0.6 : 0.25;
      osc.connect(g);
      g.connect(dest);
      osc.start();
    }
  }

  private wireBuzz(ctx: AudioContext, dest: GainNode): void {
    for (const hz of [60, 119.7, 240]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = hz < 80 ? 0.22 : hz < 150 ? 0.12 : 0.04;
      osc.connect(g);
      g.connect(dest);
      osc.start();
    }
  }

  /** Band-passed noise breathing at `hz` breaths per second, when a recording is missing. */
  private wireBreath(ctx: AudioContext, dest: GainNode, hz: number): void {
    if (!this.noise) return;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 720;
    bp.Q.value = 0.9;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = hz;
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
  }
}
