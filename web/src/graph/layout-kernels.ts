/**
 * Compiled force kernels behind the layout's charge and magnet forces.
 *
 * d3's `forceManyBody` rebuilds an octree of JS objects every tick; for a few hundred nodes that
 * is the single largest slice of the simulation, and the same-role magnet is an O(n²) pass on top.
 * `ForceKernel` is both of those over flat float arrays so they can run in WebAssembly
 * (`layout-wasm.ts`). The JS side only packs positions, strengths and roles into the kernel's own
 * buffers once per tick and adds the velocity deltas back out.
 */

import type { WNode } from "./layout-core";

export interface KernelBuffers {
  /** x,y,z per body */
  pos: Float32Array;
  /** many-body strength per body */
  str: Float32Array;
  /** role index per body */
  role: Int32Array;
  /** magnet strength per role index */
  mag: Float32Array;
  /** vx,vy,vz delta per body, written by the kernel */
  out: Float32Array;
}

export interface ForceKernel {
  /** Reserve room for `n` bodies. Returns the capacity. */
  reserve(n: number): number;
  /**
   * Views over the kernel's buffers. Re-read after any kernel call: a WebAssembly memory that
   * grows detaches earlier views.
   */
  buffers(): KernelBuffers;
  /**
   * Barnes–Hut many-body over the first `n` bodies; overwrites `out`.
   * `theta2`, `distMin2`, `distMax2` match d3 (`0.81`, `1`, `distanceMax²`).
   * Returns false when the kernel could not run this tick (caller skips the force).
   */
  manyBody(n: number, alpha: number, theta2: number, distMin2: number, distMax2: number): boolean;
  /** Same-role magnet over the first `n` bodies; adds into `out`. */
  magnet(n: number, alpha: number, cross: number, maxD2: number, pulse: number): void;
  dispose?(): void;
}

export interface KernelParams {
  chargeAmt: () => number;
  distMax: () => number;
  /** per ROLES index, already multiplied by nothing: the kernel applies `pulse` itself */
  magnets: () => number[];
  magnetCross: () => number;
  magnetRange: () => number;
  pulse: () => number;
}

/** d3-style force that delegates the many-body sum and the magnets to `kernel` in one pass. */
export function kernelForce(kernel: ForceKernel, p: KernelParams) {
  let nodes: WNode[] = [];
  let cap = 0;
  const force = (alpha: number) => {
    const n = nodes.length;
    if (n < 2) return;
    if (cap < n) cap = kernel.reserve(n);
    let b = kernel.buffers();
    const amt = p.chargeAmt();
    for (let i = 0; i < n; i++) {
      const nd = nodes[i]!;
      b.pos[i * 3] = nd.x;
      b.pos[i * 3 + 1] = nd.y;
      b.pos[i * 3 + 2] = nd.z;
      b.str[i] = nd.charge * amt;
      b.role[i] = nd.roleIdx;
    }
    const dm = p.distMax();
    const ran = kernel.manyBody(n, alpha, 0.81, 1, dm * dm);
    b = kernel.buffers();
    // magnets: same early-outs as physics.ts magnetForce
    const pulse = p.pulse();
    const cross = p.magnetCross();
    const mags = p.magnets();
    let any = pulse > 0 && Math.abs(cross) >= 0.02;
    if (!any && pulse > 0) for (const v of mags) if (Math.abs(v) >= 0.02) { any = true; break; }
    if (any) {
      if (!ran) b.out.fill(0, 0, n * 3);
      const m = Math.min(b.mag.length, mags.length);
      for (let i = 0; i < m; i++) b.mag[i] = mags[i] ?? 0;
      b.mag.fill(0, m);
      const maxD = 80 + 520 * Math.max(0.15, p.magnetRange());
      kernel.magnet(n, alpha, cross, maxD * maxD, pulse);
      b = kernel.buffers();
    } else if (!ran) {
      return;
    }
    const out = b.out;
    for (let i = 0; i < n; i++) {
      const nd = nodes[i]!;
      nd.vx += out[i * 3]!;
      nd.vy += out[i * 3 + 1]!;
      nd.vz += out[i * 3 + 2]!;
    }
  };
  force.initialize = (ns: WNode[]) => { nodes = ns; };
  return force;
}
