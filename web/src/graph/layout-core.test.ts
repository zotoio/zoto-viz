import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PARAMS, L_BASE, L_DST, L_K, L_SRC, LINK_STRIDE, LayoutSim, N_CHARGE, N_FIXED, N_FX, N_KEY, N_RELAX, N_ROLE,
  N_SHELL_K, N_SHELL_R, N_SLOT, NODE_STRIDE, roleIdx, type FrameMsg, type StructureMsg,
} from "./layout-core";
import { LayoutClient, STALL_MS } from "./layout";

interface Spec { key: number; role: string; shell: number; x: number; y: number; z: number; fixed?: boolean; charge?: number }

function structure(gen: number, specs: Spec[], links: [number, number][] = [], minAlpha = 1): StructureMsg {
  const n = specs.length;
  const nodes = new Float32Array(n * NODE_STRIDE);
  const pos = new Float32Array(n * 3);
  specs.forEach((s, i) => {
    const o = i * NODE_STRIDE;
    nodes[o + N_KEY] = s.key;
    nodes[o + N_ROLE] = roleIdx(s.role);
    nodes[o + N_SHELL_R] = s.shell;
    nodes[o + N_SHELL_K] = s.role === "gateway" ? 1 : 0.9;
    nodes[o + N_SLOT] = 1;
    nodes[o + N_RELAX] = 1;
    nodes[o + N_CHARGE] = s.charge ?? -90;
    nodes[o + N_FIXED] = s.fixed ? 1 : 0;
    nodes[o + N_FX] = 0;
    pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
  });
  const la = new Float32Array(links.length * LINK_STRIDE);
  links.forEach(([s, t], i) => {
    la[i * LINK_STRIDE + L_SRC] = s;
    la[i * LINK_STRIDE + L_DST] = t;
    la[i * LINK_STRIDE + L_BASE] = 160;
    la[i * LINK_STRIDE + L_K] = 0.12;
  });
  return { type: "structure", gen, n, nodes, pos, links: la, minAlpha };
}

const frame = (gen: number, extra: Partial<FrameMsg> = {}): FrameMsg =>
  ({ type: "frame", gen, alphaMin: 0, nudge: null, pin: null, release: null, recycle: null, ...extra });

describe("LayoutSim", () => {
  it("keeps the pinned gateway at the origin and pulls a LAN node toward its shell", () => {
    const sim = new LayoutSim();
    sim.setParams({ ...DEFAULT_PARAMS, magnets: [...DEFAULT_PARAMS.magnets] });
    sim.setStructure(structure(1, [
      { key: 1, role: "gateway", shell: 0, x: 0, y: 0, z: 0, fixed: true },
      { key: 2, role: "lan", shell: 360, x: 40, y: 0, z: 0 },
    ], [[1, 0]]));
    let out = sim.frame(frame(1));
    for (let i = 0; i < 300; i++) out = sim.frame(frame(1, { recycle: out.pos }));
    expect(out.n).toBe(2);
    expect(Math.hypot(out.pos[0]!, out.pos[1]!, out.pos[2]!)).toBeLessThan(1e-6);
    const r = Math.hypot(out.pos[3]!, out.pos[4]!, out.pos[5]!);
    expect(r).toBeGreaterThan(150);
    expect(r).toBeLessThan(400);
  });

  it("carries a node's position across a structure resend and drops the ones that left", () => {
    const sim = new LayoutSim();
    sim.setStructure(structure(1, [
      { key: 1, role: "gateway", shell: 0, x: 0, y: 0, z: 0, fixed: true },
      { key: 2, role: "lan", shell: 360, x: 40, y: 0, z: 0 },
      { key: 3, role: "internet", shell: 580, x: -30, y: 10, z: 0 },
    ]));
    let out = sim.frame(frame(1));
    for (let i = 0; i < 50; i++) out = sim.frame(frame(1, { recycle: out.pos }));
    const before = [out.pos[3]!, out.pos[4]!, out.pos[5]!];
    // node 3 leaves; node 2's spawn position in the resend is deliberately wrong and must be ignored
    sim.setStructure(structure(2, [
      { key: 1, role: "gateway", shell: 0, x: 0, y: 0, z: 0, fixed: true },
      { key: 2, role: "lan", shell: 360, x: 9999, y: 9999, z: 9999 },
    ], [], 0));
    const next = sim.frame(frame(2));
    expect(next.n).toBe(2);
    expect(Math.abs(next.pos[3]! - before[0]!)).toBeLessThan(30);
    expect(Math.abs(next.pos[4]! - before[1]!)).toBeLessThan(30);
  });

  it("applies nudges, pins and releases by index", () => {
    const sim = new LayoutSim();
    sim.setStructure(structure(1, [
      { key: 1, role: "lan", shell: 360, x: 0, y: 0, z: 0 },
      { key: 2, role: "lan", shell: 360, x: 100, y: 0, z: 0 },
    ], [], 0.3));
    const pinned = sim.frame(frame(1, { pin: Float32Array.of(0, 5, 6, 7) }));
    expect([pinned.pos[0], pinned.pos[1], pinned.pos[2]]).toEqual([5, 6, 7]);
    const held = sim.frame(frame(1));
    expect([held.pos[0], held.pos[1], held.pos[2]]).toEqual([5, 6, 7]);
    const released = sim.frame(frame(1, { release: Float32Array.of(0, 50, 0, 0) }));
    expect(released.pos[0]!).toBeGreaterThan(5);
    const nudge = new Float32Array([0, 0, 0, 0, 200, 0]);
    const y0 = released.pos[4]!;
    const nudged = sim.frame(frame(1, { nudge }));
    expect(nudged.pos[4]!).toBeGreaterThan(y0 + 50);
    // a frame stamped with a stale generation must not apply its indices
    const stale = sim.frame(frame(0, { pin: Float32Array.of(1, -1, -1, -1) }));
    expect(stale.pos[3]).not.toBe(-1);
  });
});

describe("LayoutClient", () => {
  it("runs inline when Workers are unavailable and reports positions synchronously", () => {
    const got: number[] = [];
    const client = new LayoutClient((m) => got.push(m.n), { wasm: false });
    expect(client.backend).toBe("inline");
    client.setParams({ ...DEFAULT_PARAMS, magnets: [...DEFAULT_PARAMS.magnets] });
    client.setStructure(structure(1, [{ key: 1, role: "lan", shell: 360, x: 1, y: 2, z: 3 }]));
    expect(client.frame(frame(1))).toBe(true);
    expect(got).toEqual([1]);
    expect(client.kernel).toBe("js");
    client.dispose();
  });

  it("falls back to inline ticking when a Worker never answers", () => {
    const g = globalThis as unknown as { Worker?: unknown };
    const hadWorker = "Worker" in g;
    const realWorker = g.Worker;
    class SilentWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(): void { /* never replies: the worker thread never started */ }
      terminate(): void { /* noop */ }
    }
    g.Worker = SilentWorker;
    const nowSpy = vi.spyOn(performance, "now");
    let now = 10_000;
    nowSpy.mockImplementation(() => now);
    try {
      const got: number[] = [];
      const client = new LayoutClient((m) => got.push(m.n), { wasm: false });
      expect(client.backend).toBe("worker");
      client.setParams({ ...DEFAULT_PARAMS, magnets: [...DEFAULT_PARAMS.magnets] });
      client.setStructure(structure(1, [{ key: 1, role: "lan", shell: 360, x: 1, y: 2, z: 3 }]));
      expect(client.frame(frame(1))).toBe(true);   // posted to the (silent) worker
      expect(client.frame(frame(1))).toBe(false);  // still in flight
      expect(client.busy).toBe(true);
      expect(got).toEqual([]);
      now += STALL_MS + 1;
      // the scene skips frame() while busy, so the watchdog has to trip from busy itself
      expect(client.busy).toBe(false);
      expect(client.backend).toBe("inline");
      expect(client.frame(frame(1))).toBe(true);   // ticks inline with the same structure
      expect(got).toEqual([1]);
      client.dispose();
    } finally {
      nowSpy.mockRestore();
      if (hadWorker) g.Worker = realWorker; else delete g.Worker;
    }
  });
});
