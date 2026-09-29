/**
 * The force layout, detached from the scene so it can run in a Worker.
 *
 * The scene describes the graph as flat typed arrays (`StructureMsg`): one row of numbers per node
 * (its shell radius, strengths, charge, slot angle…) already resolved through the active view mode
 * and crowd measurement on the main thread, plus links as index pairs. Per-frame knobs travel in
 * `LayoutParams`; each `FrameMsg` ticks the simulation once and answers with packed positions.
 *
 * Mode-specific forces (`ViewMode.force`) stay on the main thread: they read positions the scene
 * already has and write velocity deltas, which the scene forwards as a `nudge` array. That keeps the
 * worker generic for plugin-defined modes.
 *
 * The same class is driven directly (`LayoutClient` inline mode) when Workers are unavailable.
 */

import { forceCenter, forceLink, forceManyBody, forceSimulation, type Simulation } from "d3-force-3d";
import {
  ellipseShell, flattenLan, gravityForce, magnetForce, slotRing, swirlForce, trafficNeighbourForce, type PhysNode,
} from "./physics";
import { kernelForce, type ForceKernel } from "./layout-kernels";

/** Roles as the wire encodes them; anything else maps to `ROLES.length - 1`. */
export const ROLES = ["self", "gateway", "local", "lan", "multicast", "internet", "other"] as const;
export const ROLE_IDX: Record<string, number> = Object.fromEntries(ROLES.map((r, i) => [r, i]));
export function roleIdx(role: string): number { return ROLE_IDX[role] ?? ROLES.length - 1; }

/** Floats per node in `StructureMsg.nodes`. */
export const NODE_STRIDE = 13;
export const N_KEY = 0;      // stable id the worker uses to carry state across structure changes
export const N_ROLE = 1;     // ROLES index
export const N_SHELL_R = 2;  // shell radius after crowd widening
export const N_SHELL_K = 3;  // ellipse shell strength (0 = the mode places this node itself)
export const N_SLOT = 4;     // 1 when the slot ring may act on this node
export const N_THETA = 5;    // slot azimuth
export const N_RELAX = 6;    // 0..1 flatten multiplier
export const N_CHARGE = 7;   // many-body strength before the chargeAmt slider
export const N_RATE = 8;     // bytes/s for the slot ring's "hot" sharpening
export const N_FIXED = 9;    // 1 when pinned at the fixed position (gateway at the origin)
export const N_FX = 10;      // fixed position
export const N_FY = 11;
export const N_FZ = 12;

/** Floats per link in `StructureMsg.links`. */
export const LINK_STRIDE = 4;
export const L_SRC = 0;
export const L_DST = 1;
export const L_BASE = 2;     // rest length before the linkSpan slider
export const L_K = 3;        // strength before the spring slider

export interface LayoutParams {
  spring: number;
  chargeAmt: number;
  linkSpan: number;
  /** d3 velocityDecay */
  drag: number;
  centerPull: number;
  /** by ROLES index */
  magnets: number[];
  magnetCross: number;
  magnetRange: number;
  /** −1 repel … +1 attract: highest-traffic nodes vs their linked neighbours */
  magnetTraffic: number;
  gravity: number;
  swirl: number;
  /** audio pulse multiplier on magnets / gravity / swirl */
  pulse: number;
  spreadX: number;
  spreadZ: number;
  flatten: boolean;
  /** 0..1 blend of the new velocity into the smoothed one (moveEase); 1 disables the smoothing */
  moveK: number;
}

export const DEFAULT_PARAMS: LayoutParams = {
  spring: 1, chargeAmt: 1, linkSpan: 1, drag: 0.35, centerPull: 1,
  magnets: ROLES.map(() => 0), magnetCross: 0, magnetRange: 0.5, magnetTraffic: 0, gravity: 0, swirl: 0, pulse: 1,
  spreadX: 1, spreadZ: 1, flatten: true, moveK: 1,
};

export interface StructureMsg {
  type: "structure";
  gen: number;
  n: number;
  nodes: Float32Array;
  /** x,y,z per node: spawn position for nodes the worker has not seen; ignored for ones it has */
  pos: Float32Array;
  links: Float32Array;
  minAlpha: number;
}

export interface ParamsMsg { type: "params"; params: LayoutParams }

export interface FrameMsg {
  type: "frame";
  gen: number;
  /** raise alpha to at least this before ticking */
  alphaMin: number;
  /** vx,vy,vz deltas per node from mode forces, or null */
  nudge: Float32Array | null;
  /** node being dragged: index, x, y, z */
  pin: Float32Array | null;
  /** drag released this frame: index, vx, vy, vz to add */
  release: Float32Array | null;
  /** a positions buffer from an earlier reply, handed back for reuse */
  recycle: Float32Array | null;
}

export interface PositionsMsg { type: "positions"; gen: number; n: number; pos: Float32Array; alpha: number }

export type LayoutIn = StructureMsg | ParamsMsg | FrameMsg | { type: "kernel"; kind: "js" | "wasm" };
export type LayoutOut = PositionsMsg | { type: "kernel"; kind: "js" | "wasm" };

/** A node as the simulation sees it. `device.role` keeps `physics.ts` forces reusable unchanged. */
export interface WNode extends PhysNode {
  index: number;
  key: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fx?: number; fy?: number; fz?: number;
  /** pinned by the structure (the gateway at the origin), restored when a drag on it ends */
  sfx?: number; sfy?: number; sfz?: number;
  device: { role: string };
  /** ROLES index of `device.role`, for the compiled magnet kernel */
  roleIdx: number;
  shellR: number;
  shellK: number;
  slotOn: boolean;
  theta: number;
  relax: number;
  charge: number;
  rate: number;
  svx?: number; svy?: number; svz?: number;
}

interface WLink { source: WNode; target: WNode; base: number; k: number; index?: number }

const ALPHA_FLOOR = 0.003;

export class LayoutSim {
  params: LayoutParams = { ...DEFAULT_PARAMS, magnets: [...DEFAULT_PARAMS.magnets] };
  private gen = 0;
  private nodes: WNode[] = [];
  private links: WLink[] = [];
  private byKey = new Map<number, WNode>();
  private readonly sim: Simulation<WNode, WLink>;
  private readonly link = forceLink<WNode, WLink>([]);
  private readonly charge = forceManyBody<WNode>();
  private readonly center = forceCenter<WNode>(0, 0, 0).strength(0.02);
  private readonly magnet = magnetForce(
    () => this.magnetTable(), () => this.params.magnetCross, () => this.params.magnetRange, () => this.params.pulse,
  );
  private kernel: ForceKernel | null = null;
  private pinned: WNode | null = null;

  constructor() {
    const p = () => this.params;
    this.sim = forceSimulation<WNode, WLink>([], 3)
      .alphaDecay(0.006)
      .velocityDecay(0.35)
      .force("link", this.link
        .distance((l) => l.base * p().linkSpan)
        .strength((l) => l.k * p().spring))
      .force("charge", this.charge
        .strength((n) => n.charge * p().chargeAmt)
        .distanceMax(700))
      .force("center", this.center)
      .force("shell", ellipseShell<WNode>((n) => n.shellR, (n) => n.shellK, () => p().spreadX, () => p().spreadZ))
      .force("slot", slotRing<WNode>((n) => n.shellR, (n) => (n.slotOn ? undefined : 0), (n) => n.theta, (n) => n.rate, () => p().spreadX, () => p().spreadZ))
      .force("flatten", flattenLan<WNode>(0.12, () => p().flatten, (n) => n.relax))
      .force("magnet", this.magnet)
      .force("traffic", trafficNeighbourForce(
        () => this.links, () => this.nodes, () => p().magnetTraffic * p().pulse,
      ))
      .force("gravity", gravityForce(() => p().gravity, () => p().pulse))
      .force("swirl", swirlForce(() => p().swirl, () => p().pulse))
      .stop();
  }

  /**
   * Swap the many-body and magnet forces for one compiled kernel pass (or back to the JavaScript
   * forces when null). Positions and velocities are untouched, so this is safe mid-run.
   */
  useKernel(k: ForceKernel | null): void {
    this.kernel = k;
    const p = () => this.params;
    if (k) {
      this.sim.force("charge", kernelForce(k, {
        chargeAmt: () => p().chargeAmt,
        distMax: () => 700 * p().spreadX,
        magnets: () => p().magnets,
        magnetCross: () => p().magnetCross,
        magnetRange: () => p().magnetRange,
        pulse: () => p().pulse,
      }));
      this.sim.force("magnet", null);
    } else {
      this.sim.force("charge", this.charge
        .strength((n) => n.charge * p().chargeAmt)
        .distanceMax(700 * p().spreadX));
      this.sim.force("magnet", this.magnet);
    }
    this.sim.nodes(this.nodes);
  }

  get kernelKind(): "js" | "wasm" { return this.kernel ? "wasm" : "js"; }

  get alpha(): number { return this.sim.alpha(); }
  get size(): number { return this.nodes.length; }

  private magnetTable(): Record<string, number> {
    const m = this.params.magnets;
    const out: Record<string, number> = {};
    for (let i = 0; i < ROLES.length; i++) out[ROLES[i]!] = m[i] ?? 0;
    return out;
  }

  setParams(next: LayoutParams): void {
    const prev = this.params;
    const spread = next.spreadX !== prev.spreadX;
    const links = next.linkSpan !== prev.linkSpan || next.spring !== prev.spring;
    const charge = next.chargeAmt !== prev.chargeAmt;
    this.params = next;
    this.sim.velocityDecay(next.drag);
    this.center.strength(0.02 * next.centerPull);
    if (spread && !this.kernel) this.charge.distanceMax(700 * next.spreadX);
    // d3 samples these accessors when the force initialises; re-setting them re-samples without a full re-init
    if (links) { this.link.distance((l) => l.base * this.params.linkSpan); this.link.strength((l) => l.k * this.params.spring); }
    if (charge && !this.kernel) this.charge.strength((n) => n.charge * this.params.chargeAmt);
  }

  setStructure(m: StructureMsg): void {
    this.gen = m.gen;
    const nodes: WNode[] = new Array(m.n);
    const keep = new Map<number, WNode>();
    const a = m.nodes;
    for (let i = 0; i < m.n; i++) {
      const o = i * NODE_STRIDE;
      const key = a[o + N_KEY]!;
      const role = ROLES[a[o + N_ROLE]!] ?? "other";
      let n = this.byKey.get(key);
      if (!n) {
        n = {
          index: i, key, x: m.pos[i * 3]!, y: m.pos[i * 3 + 1]!, z: m.pos[i * 3 + 2]!, vx: 0, vy: 0, vz: 0,
          device: { role }, roleIdx: roleIdx(role),
          shellR: 0, shellK: 0, slotOn: false, theta: 0, relax: 1, charge: 0, rate: 0,
        };
      } else {
        n.index = i;
        if (n.device.role !== role) { n.device = { role }; n.roleIdx = roleIdx(role); }
      }
      n.shellR = a[o + N_SHELL_R]!;
      n.shellK = a[o + N_SHELL_K]!;
      n.slotOn = a[o + N_SLOT]! > 0.5;
      n.theta = a[o + N_THETA]!;
      n.relax = a[o + N_RELAX]!;
      n.charge = a[o + N_CHARGE]!;
      n.rate = a[o + N_RATE]!;
      if (a[o + N_FIXED]! > 0.5) {
        n.sfx = a[o + N_FX]!;
        n.sfy = a[o + N_FY]!;
        n.sfz = a[o + N_FZ]!;
        if (n !== this.pinned) { n.fx = n.sfx; n.fy = n.sfy; n.fz = n.sfz; }
      } else {
        n.sfx = n.sfy = n.sfz = undefined;
        if (n !== this.pinned) n.fx = n.fy = n.fz = undefined;
      }
      nodes[i] = n;
      keep.set(key, n);
    }
    if (this.pinned && !keep.has(this.pinned.key)) this.pinned = null;
    this.nodes = nodes;
    this.byKey = keep;
    const links: WLink[] = [];
    const L = m.links;
    for (let i = 0; i + LINK_STRIDE - 1 < L.length; i += LINK_STRIDE) {
      const s = nodes[L[i + L_SRC]!], t = nodes[L[i + L_DST]!];
      if (!s || !t) continue;
      links.push({ source: s, target: t, base: L[i + L_BASE]!, k: L[i + L_K]! });
    }
    this.links = links;
    this.sim.nodes(nodes);
    this.link.links(links);
    if (m.minAlpha > 0) this.sim.alpha(Math.max(this.sim.alpha(), m.minAlpha));
  }

  /** One tick. Returns the packed positions for the current structure (into `recycle` when it fits). */
  frame(f: FrameMsg): PositionsMsg {
    const nodes = this.nodes;
    const n = nodes.length;
    if (f.alphaMin > 0) this.sim.alpha(Math.max(this.sim.alpha(), f.alphaMin));
    const same = f.gen === this.gen; // indices in this frame refer to the structure the worker holds
    if (same && f.pin && f.pin.length >= 4) {
      const p = nodes[f.pin[0]!];
      if (p) {
        if (this.pinned && this.pinned !== p) this.unpin(this.pinned);
        this.pinned = p;
        p.x = p.fx = f.pin[1]!;
        p.y = p.fy = f.pin[2]!;
        p.z = p.fz = f.pin[3]!;
      }
    }
    if (same && f.release && f.release.length >= 4) {
      const r = nodes[f.release[0]!];
      if (r) {
        if (this.pinned === r) this.pinned = null;
        this.unpin(r);
        r.vx += f.release[1]!;
        r.vy += f.release[2]!;
        r.vz += f.release[3]!;
      }
    }
    if (same && f.nudge) {
      const d = f.nudge;
      const m = Math.min(n, d.length / 3);
      for (let i = 0; i < m; i++) {
        const nd = nodes[i]!;
        nd.vx += d[i * 3]!;
        nd.vy += d[i * 3 + 1]!;
        nd.vz += d[i * 3 + 2]!;
      }
    }
    if (this.sim.alpha() > ALPHA_FLOOR) this.sim.tick();
    else this.sim.alpha(ALPHA_FLOOR); // keep a gentle drift so new nodes always settle
    // moveEase: blend layout velocity so a force reversal has to slow the node before it can turn around
    const e = this.params.moveK;
    if (e < 0.999) {
      for (const nd of nodes) {
        if (nd === this.pinned) continue;
        const vx = nd.vx, vy = nd.vy, vz = nd.vz;
        nd.svx = (nd.svx ?? vx) + (vx - (nd.svx ?? vx)) * e;
        nd.svy = (nd.svy ?? vy) + (vy - (nd.svy ?? vy)) * e;
        nd.svz = (nd.svz ?? vz) + (vz - (nd.svz ?? vz)) * e;
        nd.vx = nd.svx;
        nd.vy = nd.svy;
        nd.vz = nd.svz;
      }
    }
    const out = f.recycle && f.recycle.length >= n * 3 ? f.recycle : new Float32Array(Math.max(n * 3, 3));
    for (let i = 0; i < n; i++) {
      const nd = nodes[i]!;
      out[i * 3] = nd.x;
      out[i * 3 + 1] = nd.y;
      out[i * 3 + 2] = nd.z;
    }
    return { type: "positions", gen: this.gen, n, pos: out, alpha: this.sim.alpha() };
  }

  /** End a drag pin. A node the structure pins (the gateway) goes back to its fixed spot. */
  private unpin(n: WNode): void {
    if (n.sfx !== undefined) { n.fx = n.sfx; n.fy = n.sfy ?? 0; n.fz = n.sfz ?? 0; }
    else n.fx = n.fy = n.fz = undefined;
  }
}
