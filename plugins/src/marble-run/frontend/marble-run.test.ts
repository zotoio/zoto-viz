import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame } from "../../../sdk/viz-contract";
import {
  MARBLE_DATA_MAPPING,
  parseMarbleOptions,
} from "./config";
import {
  MR_MARBLE_FLOATS,
  MR_MARBLES_PER_SLOT,
  MR_MARBLE_SLOT0,
  MR_MAX_MARBLES,
  MR_SLOT,
  applyPackWorkBudget,
  camState,
  chaseTarget,
  decodeMarbleLook,
  disposeMarblePack,
  ingestFrame,
  isFrameFailed,
  marbleHudSkipCount,
  marbleHueForPacket,
  marbleIngestStats,
  marbleQueueLength,
  marbleSim,
  marbleWorkBudget,
  packMarbleSlots,
  parseMarbleWorkBudgetYaml,
  resetPackWorkBudget,
  setMarbleOptions,
} from "./pack";
import { LIFT_PITCH, MarbleSim, SIM_DT, TAG, TrackPath } from "./sim";
import { TRACK } from "./track-data";
import { probePluginSkyCompile, wrapPluginSky } from "./sky-probe";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(frontendDir, "..");
const FRAG = readFileSync(path.join(packRoot, "sky/fragment.glsl"), "utf8");
const PLUGIN = readFileSync(path.join(packRoot, "plugin.yml"), "utf8");
const VIS = readFileSync(path.join(packRoot, "visualisation.yml"), "utf8");
const GLB = readFileSync(path.join(packRoot, "assets/marble-track.glb"));

const TRADEMARKS = ["minecraft", "mojang", "rocket league", "psyonix"];

function liveFrame(over: Partial<VizDataFrame> = {}): VizDataFrame {
  return { t: 0, dt: SIM_DT, audio: 0, packets: [], rf: [], talkers: [], headlines: [], sys: { ...EMPTY_SYS_TELEMETRY, failed: 0 }, ...over };
}

function run(sim: MarbleSim, seconds: number, dt = SIM_DT): void {
  for (let t = 0; t < seconds; t += dt) sim.step(dt, 4);
}

describe("marble-run shipped pack", () => {
  beforeEach(() => {
    disposeMarblePack();
    resetPackWorkBudget();
    applyPackWorkBudget(parseMarbleWorkBudgetYaml(VIS));
  });

  it("declares mapping, work budget, the track asset, and compiles the sky", () => {
    expect(PLUGIN).toContain("id: marble-run");
    expect(PLUGIN).toMatch(/idle:\n\s+fixture: host/);
    expect(VIS).toMatch(/workBudget/);
    expect(MARBLE_DATA_MAPPING.length).toBe(4);
    expect(parseMarbleWorkBudgetYaml(VIS)).toEqual(marbleWorkBudget());
    const blob = `${PLUGIN}\n${VIS}\n${FRAG}`.toLowerCase();
    for (const mark of TRADEMARKS) expect(blob.includes(mark)).toBe(false);
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("ships a GLB whose size and digest match plugin.yml", async () => {
    expect(GLB.subarray(0, 4).toString("latin1")).toBe("glTF");
    const bytes = Number(/bytes: (\d+)/.exec(PLUGIN)?.[1]);
    expect(GLB.length).toBe(bytes);
    expect(GLB.length).toBeLessThan(1_500_000);
    const { createHash } = await import("node:crypto");
    expect(PLUGIN).toContain(createHash("sha256").update(GLB).digest("hex"));
    const json = JSON.parse(GLB.subarray(20, 20 + GLB.readUInt32LE(12)).toString("utf8")) as { nodes: { name: string }[] };
    const names = json.nodes.map((n) => n.name);
    for (const part of ["rails", "lift-thread", "funnel", "bell", "xylo-bar-0", "xylo-bar-7", "base"]) expect(names).toContain(part);
  });
});

describe("track data (Blender export)", () => {
  it("is a closed, evenly sampled loop with every piece", () => {
    const tr = new TrackPath();
    expect(tr.n).toBe(TRACK.tags.length);
    expect(tr.length).toBeGreaterThan(12);
    let maxGap = 0;
    for (let i = 0; i < tr.n; i++) {
      const j = (i + 1) % tr.n;
      maxGap = Math.max(maxGap, Math.hypot(tr.px[j]! - tr.px[i]!, tr.py[j]! - tr.py[i]!, tr.pz[j]! - tr.pz[i]!));
    }
    // no tears: neighbours (including the wrap from the lift bottom back) are one step apart
    expect(maxGap).toBeLessThan(TRACK.step * 2.5);
    const tags = new Set(Array.from(tr.tag));
    for (const t of ["lift", "spiral", "zigzag", "xylo", "loop", "bell", "funnel"] as const) expect(tags.has(TAG[t])).toBe(true);
    expect(tr.xyloS).toHaveLength(8);
    // the lift climbs and the run descends overall
    const top = tr.index(tr.liftEnd - 0.001), bottom = tr.index(tr.liftStart);
    expect(tr.py[top]! - tr.py[bottom]!).toBeGreaterThan(1.3);
  });

  it("rejects malformed data", () => {
    expect(() => new TrackPath({ ...TRACK, tags: TRACK.tags.slice(1) })).toThrow(/bad data/);
  });
});

describe("marble sim", () => {
  it("rolls marbles round the whole run and back up the lift", () => {
    const sim = new MarbleSim(8);
    sim.setCount(8);
    const start = Float64Array.from(sim.s);
    let laps = 0;
    const prev = Float64Array.from(sim.s);
    for (let f = 0; f < 60 * 90; f++) {
      sim.step(SIM_DT, 4);
      for (let i = 0; i < sim.count; i++) {
        if (sim.s[i]! < prev[i]! - sim.track.length / 2) laps++;
        prev[i] = sim.s[i]!;
      }
    }
    expect(laps).toBeGreaterThanOrEqual(8);
    expect(Array.from(sim.s)).not.toEqual(Array.from(start));
  });

  it("speeds up downhill and holds the lift speed on the lift", () => {
    const sim = new MarbleSim(1);
    sim.setCount(1);
    sim.s[0] = sim.track.liftEnd + 0.02;
    sim.v[0] = 0.2;
    run(sim, 1.2);
    expect(sim.v[0]).toBeGreaterThan(0.3);
    sim.s[0] = sim.track.liftStart + 0.3;
    sim.step(SIM_DT, 4);
    expect(sim.v[0]).toBeCloseTo(sim.liftSpeed, 5);
  });

  it("keeps marbles apart and admits one per lift pitch", () => {
    const sim = new MarbleSim(24);
    sim.setCount(24);
    for (let f = 0; f < 60 * 30; f++) {
      sim.step(SIM_DT, 4);
      const on: number[] = [];
      for (let i = 0; i < sim.count; i++) if (sim.track.onLift(sim.s[i]!)) on.push(sim.s[i]!);
      on.sort((a, b) => a - b);
      for (let k = 1; k < on.length; k++) expect(on[k]! - on[k - 1]!).toBeGreaterThan(LIFT_PITCH * 0.9);
    }
    const s = Array.from(sim.s.subarray(0, sim.count)).sort((a, b) => a - b);
    for (let k = 1; k < s.length; k++) expect(s[k]! - s[k - 1]!).toBeGreaterThan(0.03);
  });

  it("strikes the bell and the xylophone", () => {
    const sim = new MarbleSim(6);
    sim.setCount(6);
    let bell = 0, xylo = 0;
    for (let f = 0; f < 60 * 60; f++) {
      sim.step(SIM_DT, 4);
      bell += sim.bellHits; sim.bellHits = 0;
      for (let k = 0; k < sim.xyloHits.length; k++) { xylo += sim.xyloHits[k]!; sim.xyloHits[k] = 0; }
    }
    expect(bell).toBeGreaterThan(3);
    expect(xylo).toBeGreaterThan(3 * 8);
  });

  it("is deterministic", () => {
    const a = new MarbleSim(16); a.setCount(16); run(a, 20);
    const b = new MarbleSim(16); b.setCount(16); run(b, 20);
    expect(a.digest()).toBe(b.digest());
  });

  it("bounds integrate steps by the work budget", () => {
    const sim = new MarbleSim(4); sim.setCount(4);
    sim.step(0.25, 4);
    expect(sim.integrateStepsLastFrame()).toBe(4);
    sim.step(1 / 240, 4);
    expect(sim.integrateStepsLastFrame()).toBe(1);
  });
});

describe("marble pack data mapping", () => {
  beforeEach(() => {
    disposeMarblePack();
    resetPackWorkBudget();
    applyPackWorkBudget(parseMarbleWorkBudgetYaml(VIS));
  });

  it("queues packet colours and caps packets per frame", () => {
    const pkts = Array.from({ length: 20 }, (_, i) => ({ proto: i % 2 ? "udp" : "tcp", size: 1500, field: 0.5 }));
    ingestFrame(liveFrame({ packets: pkts }));
    expect(marbleIngestStats().consumedPackets).toBe(8);
    expect(marbleHudSkipCount()).toBe(12);
    expect(marbleQueueLength()).toBeGreaterThan(0);
  });

  it("colours marbles leaving the lift from the queue, Zoto Fail red when failing", () => {
    setMarbleOptions(parseMarbleOptions({ maxMarbles: "16" }));
    const tcp = marbleHueForPacket({ proto: "tcp", size: 64, field: 0 });
    let lit = 0;
    for (let f = 0; f < 60 * 25; f++) {
      ingestFrame(liveFrame({ t: f * SIM_DT, packets: f % 10 === 0 ? [{ proto: "tcp", size: 64, field: 0 }] : [] }));
    }
    const s = marbleSim();
    for (let i = 0; i < s.count; i++) if (Math.abs(s.hue[i]! - tcp) < 1e-6) lit++;
    expect(lit).toBeGreaterThan(0);
    const failing = liveFrame({ sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.9 } });
    expect(isFrameFailed(failing)).toBe(true);
  });

  it("packs the slot contract the host scenery reads", () => {
    setMarbleOptions(parseMarbleOptions({ maxMarbles: "40" }));
    ingestFrame(liveFrame());
    const slots = packMarbleSlots(liveFrame());
    expect(slots).toHaveLength(4);
    for (const b of slots) expect(b.length).toBe(64);
    const h = slots[0]!;
    expect(h[MR_SLOT.mark]).toBe(1);
    expect(h[MR_SLOT.count]).toBe(40);
    expect(h[MR_SLOT.fov]).toBeGreaterThan(20);
    expect(MR_MAX_MARBLES).toBe(48);
    const m = slots[MR_MARBLE_SLOT0 + 2]!;
    const o = (39 % MR_MARBLES_PER_SLOT) * MR_MARBLE_FLOATS;
    expect(Math.abs(m[o]!) + Math.abs(m[o + 1]!) + Math.abs(m[o + 2]!)).toBeGreaterThan(0);
    expect(decodeMarbleLook(m[o + 3]!).radius).toBeGreaterThan(0.01);
    expect(decodeMarbleLook(18.25)).toEqual({ radius: 0.018, hue: 0.25 });
    expect(decodeMarbleLook(-17)).toEqual({ radius: 0.017, hue: -1 });
  });

  it("does not reallocate slot buffers between frames", () => {
    ingestFrame(liveFrame());
    const a = packMarbleSlots(liveFrame());
    ingestFrame(liveFrame());
    const b = packMarbleSlots(liveFrame());
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
  });
});

describe("chase camera", () => {
  beforeEach(() => {
    disposeMarblePack();
    resetPackWorkBudget();
    applyPackWorkBudget(parseMarbleWorkBudgetYaml(VIS));
    setMarbleOptions(parseMarbleOptions({ cameraMode: "chase", maxMarbles: "12" }));
  });

  it("is a selectable camera mode", () => {
    expect(parseMarbleOptions({ cameraMode: "chase" }).cameraMode).toBe("chase");
    expect(VIS).toMatch(/\[chase, /);
  });

  it("springs smoothly behind its marble and looks down the track", () => {
    let maxStep = 0;
    const prev = new Float32Array(3);
    for (let f = 0; f < 60 * 20; f++) {
      prev.set(camState.pos);
      ingestFrame(liveFrame({ t: f * SIM_DT }));
      if (camState.sinceCut > 0) maxStep = Math.max(maxStep, Math.hypot(camState.pos[0]! - prev[0]!, camState.pos[1]! - prev[1]!, camState.pos[2]! - prev[2]!));
    }
    const s = marbleSim();
    const t = camState.target;
    expect(t).toBeGreaterThanOrEqual(0);
    expect(s.track.onLift(s.s[t]!)).toBe(false);
    const p = new Float32Array(3);
    s.track.sample(s.s[t]!, p);
    const d = Math.hypot(camState.pos[0]! - p[0]!, camState.pos[1]! - p[1]!, camState.pos[2]! - p[2]!);
    expect(d).toBeLessThan(0.9);
    expect(d).toBeGreaterThan(0.05);
    // between cuts the eye never jumps more than marble speed allows (spring, no teleports)
    expect(maxStep).toBeLessThan(0.08);
    expect(camState.fov).toBeGreaterThan(50);
  });

  it("switches to the next marble once its marble reaches the lift", () => {
    ingestFrame(liveFrame());
    const s = marbleSim();
    const first = camState.target;
    expect(first).toBeGreaterThanOrEqual(0);
    s.s[first] = s.track.liftStart + 0.05;
    const next = chaseTarget(s, first);
    expect(next).not.toBe(first);
    expect(s.track.onLift(s.s[next]!)).toBe(false);
    ingestFrame(liveFrame());
    expect(camState.target).toBe(next);
    expect(camState.sinceCut).toBe(0);
  });
});
