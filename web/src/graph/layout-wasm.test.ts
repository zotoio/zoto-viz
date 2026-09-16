import { forceManyBody } from "d3-force-3d";
import { beforeAll, describe, expect, it } from "vitest";
import { kernelForce, type ForceKernel } from "./layout-kernels";
import { DEFAULT_PARAMS, LayoutSim, NODE_STRIDE, N_CHARGE, N_KEY, N_ROLE, ROLES, type WNode } from "./layout-core";
import { kernelFromBytes } from "./layout-wasm";
import wasmDataUrl from "./layout.wasm?inline";
import { magnetForce } from "./physics";

let kernel: ForceKernel;

beforeAll(async () => {
  const b64 = wasmDataUrl.slice(wasmDataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  kernel = await kernelFromBytes(bytes);
});

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function bodies(n: number, seed = 7, spread = 600): WNode[] {
  const r = rng(seed);
  const out: WNode[] = [];
  for (let i = 0; i < n; i++) {
    const role = ROLES[i % ROLES.length]!;
    // f32-exact coordinates so the JS reference and the kernel see identical positions
    const f = (v: number) => Math.fround(v);
    out.push({
      index: i, key: i,
      x: f((r() - 0.5) * spread), y: f((r() - 0.5) * spread * 0.3), z: f((r() - 0.5) * spread),
      vx: 0, vy: 0, vz: 0,
      device: { role }, roleIdx: i % ROLES.length,
      shellR: 0, shellK: 0, slotOn: false, theta: 0, relax: 1, charge: -20 - Math.round(r() * 40), rate: 0,
    });
  }
  return out;
}

const clone = (ns: WNode[]): WNode[] => ns.map((n) => ({ ...n, device: { ...n.device } }));

describe("wasm many-body kernel", () => {
  it("matches d3's Barnes–Hut force to float precision", () => {
    const n = 300;
    const ref = bodies(n);
    const got = clone(ref);
    const amt = 1.3, distMax = 700;
    const js = forceManyBody<WNode>().strength((d) => d.charge * amt).distanceMax(distMax);
    js.initialize?.(ref, Math.random, 3);
    js(0.7);
    const k = kernelForce(kernel, {
      chargeAmt: () => amt, distMax: () => distMax, magnets: () => ROLES.map(() => 0),
      magnetCross: () => 0, magnetRange: () => 0.5, pulse: () => 1,
    });
    k.initialize(got);
    k(0.7);
    let maxErr = 0, maxMag = 0;
    for (let i = 0; i < n; i++) {
      const a = ref[i]!, b = got[i]!;
      maxErr = Math.max(maxErr, Math.abs(a.vx - b.vx), Math.abs(a.vy - b.vy), Math.abs(a.vz - b.vz));
      maxMag = Math.max(maxMag, Math.abs(a.vx), Math.abs(a.vy), Math.abs(a.vz));
    }
    expect(maxMag).toBeGreaterThan(0.01);
    expect(maxErr).toBeLessThan(maxMag * 1e-4);
  });

  it("handles coincident bodies without NaN and pushes them apart", () => {
    const ns = bodies(6, 3, 0);
    for (const b of ns) { b.x = 5; b.y = 5; b.z = 5; }
    const k = kernelForce(kernel, {
      chargeAmt: () => 1, distMax: () => 700, magnets: () => ROLES.map(() => 0),
      magnetCross: () => 0, magnetRange: () => 0.5, pulse: () => 1,
    });
    k.initialize(ns);
    k(1);
    for (const b of ns) {
      expect(Number.isFinite(b.vx) && Number.isFinite(b.vy) && Number.isFinite(b.vz)).toBe(true);
    }
    expect(ns.some((b) => b.vx !== 0 || b.vy !== 0 || b.vz !== 0)).toBe(true);
  });

  it("grows its buffers for larger structures", () => {
    const small = bodies(10);
    const big = bodies(2000, 11, 2000);
    const k = kernelForce(kernel, {
      chargeAmt: () => 1, distMax: () => 700, magnets: () => ROLES.map(() => 0),
      magnetCross: () => 0, magnetRange: () => 0.5, pulse: () => 1,
    });
    k.initialize(small); k(0.5);
    k.initialize(big); k(0.5);
    expect(big.every((b) => Number.isFinite(b.vx))).toBe(true);
    expect(big.some((b) => b.vx !== 0)).toBe(true);
  });
});

describe("wasm magnet kernel", () => {
  it("matches physics.ts magnetForce", () => {
    const n = 120;
    const ref = bodies(n, 21, 400);
    const got = clone(ref);
    const mags = ROLES.map((_, i) => (i % 2 ? 0.8 : -0.5));
    const table: Record<string, number> = {};
    ROLES.forEach((r, i) => { table[r] = mags[i]!; });
    const cross = 0.3, range = 0.6, pulse = 1.2, alpha = 0.4;
    const js = magnetForce(() => table, () => cross, () => range, () => pulse);
    js.initialize(ref);
    js(alpha);
    // kernel: zero many-body (charge 0) so only the magnets contribute
    for (const b of got) b.charge = 0;
    const k = kernelForce(kernel, {
      chargeAmt: () => 1, distMax: () => 700, magnets: () => mags,
      magnetCross: () => cross, magnetRange: () => range, pulse: () => pulse,
    });
    k.initialize(got);
    k(alpha);
    let maxErr = 0, maxMag = 0;
    for (let i = 0; i < n; i++) {
      const a = ref[i]!, b = got[i]!;
      maxErr = Math.max(maxErr, Math.abs(a.vx - b.vx), Math.abs(a.vy - b.vy), Math.abs(a.vz - b.vz));
      maxMag = Math.max(maxMag, Math.abs(a.vx), Math.abs(a.vy), Math.abs(a.vz));
    }
    expect(maxMag).toBeGreaterThan(0.01);
    expect(maxErr).toBeLessThan(maxMag * 1e-4);
  });

  it("is a no-op when every magnet is off", () => {
    const ns = bodies(30, 5, 300);
    for (const b of ns) b.charge = 0;
    const k = kernelForce(kernel, {
      chargeAmt: () => 1, distMax: () => 700, magnets: () => ROLES.map(() => 0),
      magnetCross: () => 0, magnetRange: () => 0.5, pulse: () => 1,
    });
    k.initialize(ns);
    k(1);
    expect(ns.every((b) => b.vx === 0 && b.vy === 0 && b.vz === 0)).toBe(true);
  });
});

describe("LayoutSim with the wasm kernel", () => {
  const structure = (n: number) => {
    const nodes = new Float32Array(n * NODE_STRIDE);
    const pos = new Float32Array(n * 3);
    const r = rng(99);
    for (let i = 0; i < n; i++) {
      nodes[i * NODE_STRIDE + N_KEY] = i;
      nodes[i * NODE_STRIDE + N_ROLE] = i % ROLES.length;
      nodes[i * NODE_STRIDE + N_CHARGE] = -30;
      pos[i * 3] = (r() - 0.5) * 200; pos[i * 3 + 1] = (r() - 0.5) * 50; pos[i * 3 + 2] = (r() - 0.5) * 200;
    }
    return { type: "structure" as const, gen: 1, n, nodes, pos, links: new Float32Array(0), minAlpha: 1 };
  };

  it("reports the kernel kind and keeps ticking after a swap", () => {
    const sim = new LayoutSim();
    sim.setStructure(structure(40));
    sim.setParams({ ...DEFAULT_PARAMS, magnets: ROLES.map(() => 0.5) });
    expect(sim.kernelKind).toBe("js");
    const a = sim.frame({ type: "frame", gen: 1, alphaMin: 1, nudge: null, pin: null, release: null, recycle: null });
    sim.useKernel(kernel);
    expect(sim.kernelKind).toBe("wasm");
    const b = sim.frame({ type: "frame", gen: 1, alphaMin: 1, nudge: null, pin: null, release: null, recycle: null });
    expect(b.n).toBe(40);
    expect(Array.from(b.pos).every(Number.isFinite)).toBe(true);
    expect(b.pos).not.toEqual(a.pos);
    sim.useKernel(null);
    expect(sim.kernelKind).toBe("js");
    const c = sim.frame({ type: "frame", gen: 1, alphaMin: 1, nudge: null, pin: null, release: null, recycle: null });
    expect(Array.from(c.pos).every(Number.isFinite)).toBe(true);
  });

  it("produces the same trajectory as the JavaScript forces", () => {
    const js = new LayoutSim();
    const wasm = new LayoutSim();
    js.setStructure(structure(60));
    wasm.setStructure(structure(60));
    const params = { ...DEFAULT_PARAMS, magnets: ROLES.map((_, i) => (i % 2 ? 0.6 : 0)), magnetCross: 0.2 };
    js.setParams(params);
    wasm.setParams(params);
    wasm.useKernel(kernel);
    let a!: Float32Array, b!: Float32Array;
    for (let t = 0; t < 30; t++) {
      a = js.frame({ type: "frame", gen: 1, alphaMin: 0, nudge: null, pin: null, release: null, recycle: null }).pos;
      b = wasm.frame({ type: "frame", gen: 1, alphaMin: 0, nudge: null, pin: null, release: null, recycle: null }).pos;
    }
    let maxErr = 0, span = 0;
    for (let i = 0; i < a.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(a[i]! - b[i]!));
      span = Math.max(span, Math.abs(a[i]!));
    }
    expect(span).toBeGreaterThan(10);
    // f32 packing of positions each tick drifts the two runs apart slowly; they must stay on the same layout
    expect(maxErr).toBeLessThan(span * 0.01);
  });
});
