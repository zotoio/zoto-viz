/**
 * Lumen Reef: the simulation behind the blob-mesh sky.
 *
 * Every device is a bioluminescent cell. A cell is a damped spring around its anchor (the host's
 * held lattice site), wandering slowly so the reef always breathes, with stiffness and damping set
 * by how it is connected: wired network cells are calm and near-critically damped, Wi-Fi cells
 * sway, Bluetooth cells drift loosely on long soft tethers. Traffic between two devices grows a
 * membrane bridge that eases in, carries pulses, and fades out when the flow stops.
 *
 * No per-frame allocation: every array is preallocated; cells are keyed by id into fixed slots
 * and fade in and out rather than popping.
 */

export const REEF_CELLS = 8;
export const REEF_BRIDGES = 16;
/** Floats per written buffer (16 vec4s, the UBO slot size). */
export const REEF_SLOT_FLOATS = 64;

export const KIND_NETWORK = 0;
export const KIND_WIFI = 1;
export const KIND_BLUETOOTH = 2;
export type ReefKind = typeof KIND_NETWORK | typeof KIND_WIFI | typeof KIND_BLUETOOTH;

/** Spring (stiffness k, damping ratio zeta), wander reach and link ease time per connection type. */
export const REEF_SPRINGS: Record<ReefKind, { k: number; zeta: number; wander: number; freq: number; linkTau: number }> = {
  [KIND_NETWORK]: { k: 5.5, zeta: 1.0, wander: 0.09, freq: 0.11, linkTau: 0.9 },
  [KIND_WIFI]: { k: 2.8, zeta: 0.72, wander: 0.15, freq: 0.08, linkTau: 1.5 },
  [KIND_BLUETOOTH]: { k: 1.6, zeta: 0.8, wander: 0.21, freq: 0.06, linkTau: 2.2 },
};

export function reefKind(role: string, id = ""): ReefKind {
  const r = `${role} ${id}`.toLowerCase();
  if (/bluetooth|\bble\b|\bbt\b|^bt:/.test(r)) return KIND_BLUETOOTH;
  if (/wi-?fi|wlan|ssid|\brf\b|^rf:|\bap\b|air/.test(r)) return KIND_WIFI;
  return KIND_NETWORK;
}

export type ReefCellInput = { id: string; x: number; y: number; r: number; role: string; rate: number };
export type ReefLinkInput = { src: string; dst: string; rate: number };

const FADE_TAU = 1.1; // s, cell fade in/out
const MIN_SEP = 0.08; // extra soft-separation margin between membranes (normalised units)

function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10007) / 10007;
}

export class LumenReef {
  readonly ids: (string | null)[] = new Array(REEF_CELLS).fill(null);
  readonly kind = new Uint8Array(REEF_CELLS);
  readonly x = new Float32Array(REEF_CELLS);
  readonly y = new Float32Array(REEF_CELLS);
  readonly vx = new Float32Array(REEF_CELLS);
  readonly vy = new Float32Array(REEF_CELLS);
  readonly ax = new Float32Array(REEF_CELLS);
  readonly ay = new Float32Array(REEF_CELLS);
  readonly r = new Float32Array(REEF_CELLS);
  readonly rTarget = new Float32Array(REEF_CELLS);
  readonly alive = new Float32Array(REEF_CELLS);
  readonly want = new Uint8Array(REEF_CELLS);
  readonly seed = new Float32Array(REEF_CELLS);
  readonly glow = new Float32Array(REEF_CELLS);
  /** Bridge strength between cells i < j, eased (index i * REEF_CELLS + j). */
  readonly bridge = new Float32Array(REEF_CELLS * REEF_CELLS);
  readonly bridgeTarget = new Float32Array(REEF_CELLS * REEF_CELLS);
  readonly slotCells = new Float32Array(REEF_SLOT_FLOATS);
  readonly slotBridges = new Float32Array(REEF_SLOT_FLOATS);
  readonly slotMeta = new Float32Array(4);
  time = 0;
  demo = false;

  private slotOf(id: string): number {
    for (let i = 0; i < REEF_CELLS; i++) if (this.ids[i] === id) return i;
    return -1;
  }

  private claim(c: ReefCellInput): number {
    // Free slot first, else the faintest fading one.
    let best = -1;
    let bestAlive = 2;
    for (let i = 0; i < REEF_CELLS; i++) {
      if (this.ids[i] === null) { best = i; break; }
      if (!this.want[i] && this.alive[i] < bestAlive) { best = i; bestAlive = this.alive[i]!; }
    }
    if (best < 0) return -1;
    this.ids[best] = c.id;
    this.kind[best] = reefKind(c.role, c.id);
    this.x[best] = c.x;
    this.y[best] = c.y;
    this.vx[best] = 0;
    this.vy[best] = 0;
    this.r[best] = 0;
    this.alive[best] = 0;
    this.seed[best] = hash01(c.id);
    for (let j = 0; j < REEF_CELLS; j++) {
      this.bridge[best * REEF_CELLS + j] = 0;
      this.bridge[j * REEF_CELLS + best] = 0;
    }
    return best;
  }

  /**
   * Advance by dt seconds toward `cells` (anchors in normalised [-1, 1] units) and `links`.
   * dt is clamped so a stalled tab or a throttled fps hook never kicks the springs.
   */
  step(dt: number, cells: readonly ReefCellInput[], links: readonly ReefLinkInput[], demo = false): void {
    const h = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    this.time += h;
    this.demo = demo;
    this.want.fill(0);
    let maxRate = 1;
    for (const c of cells) maxRate = Math.max(maxRate, c.rate);
    for (const c of cells) {
      let i = this.slotOf(c.id);
      if (i < 0) i = this.claim(c);
      if (i < 0) continue;
      this.want[i] = 1;
      this.ax[i] = c.x;
      this.ay[i] = c.y;
      this.rTarget[i] = c.r;
      this.glow[i] = Math.log1p(Math.max(0, c.rate)) / Math.log1p(maxRate);
    }
    this.bridgeTarget.fill(0);
    let maxLink = 1;
    for (const l of links) maxLink = Math.max(maxLink, l.rate);
    for (const l of links) {
      const a = this.slotOf(l.src);
      const b = this.slotOf(l.dst);
      if (a < 0 || b < 0 || a === b) continue;
      const i = Math.min(a, b);
      const j = Math.max(a, b);
      const s = 0.2 + 0.8 * Math.log1p(Math.max(0, l.rate)) / Math.log1p(maxLink);
      const k = i * REEF_CELLS + j;
      this.bridgeTarget[k] = Math.max(this.bridgeTarget[k]!, s);
    }
    const fade = 1 - Math.exp(-h / FADE_TAU);
    for (let i = 0; i < REEF_CELLS; i++) {
      if (this.ids[i] === null) continue;
      this.alive[i]! += ((this.want[i] ? 1 : 0) - this.alive[i]!) * fade;
      if (!this.want[i] && this.alive[i]! < 0.005) { this.ids[i] = null; this.alive[i] = 0; continue; }
      const sp = REEF_SPRINGS[this.kind[i] as ReefKind];
      const ph = this.seed[i]! * 6.2831853;
      const w = this.time * sp.freq * 6.2831853;
      // Slow Lissajous wander around the anchor: the spring follows it, so motion is smooth.
      const tx = this.ax[i]! + sp.wander * Math.sin(w + ph) * (1 + 0.35 * Math.sin(w * 0.37 + ph * 2));
      const ty = this.ay[i]! + sp.wander * 0.8 * Math.cos(w * 0.83 + ph * 1.7);
      const c = 2 * sp.zeta * Math.sqrt(sp.k);
      let fx = sp.k * (tx - this.x[i]!) - c * this.vx[i]!;
      let fy = sp.k * (ty - this.y[i]!) - c * this.vy[i]!;
      // Soft separation so membranes kiss and merge through bridges rather than overlap.
      for (let j = 0; j < REEF_CELLS; j++) {
        if (j === i || this.ids[j] === null) continue;
        const dx = this.x[i]! - this.x[j]!;
        const dy = this.y[i]! - this.y[j]!;
        const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
        const minD = this.r[i]! + this.r[j]! + MIN_SEP;
        if (d < minD) {
          const push = 2.2 * (minD - d) * this.alive[j]!;
          fx += (dx / d) * push;
          fy += (dy / d) * push;
        }
      }
      this.vx[i]! += fx * h;
      this.vy[i]! += fy * h;
      this.x[i]! += this.vx[i]! * h;
      this.y[i]! += this.vy[i]! * h;
      this.r[i]! += (this.rTarget[i]! * (this.want[i] ? 1 : 0.6) - this.r[i]!) * (1 - Math.exp(-h / 0.8));
    }
    for (let i = 0; i < REEF_CELLS; i++) {
      for (let j = i + 1; j < REEF_CELLS; j++) {
        const k = i * REEF_CELLS + j;
        const live = this.ids[i] !== null && this.ids[j] !== null ? 1 : 0;
        // A link eases at the pace of its softer end (Bluetooth slowest).
        const tau = Math.max(REEF_SPRINGS[this.kind[i] as ReefKind].linkTau, REEF_SPRINGS[this.kind[j] as ReefKind].linkTau);
        this.bridge[k]! += (this.bridgeTarget[k]! * live - this.bridge[k]!) * (1 - Math.exp(-h / tau));
      }
    }
    this.pack();
  }

  /** Fill the three buffers the sky reads (slot 1 cells, slot 2 bridges, slot 3 meta). */
  private pack(): void {
    const c = this.slotCells;
    c.fill(0);
    for (let i = 0; i < REEF_CELLS; i++) {
      if (this.ids[i] === null) continue;
      const sp = Math.hypot(this.vx[i]!, this.vy[i]!);
      c[i * 4] = this.x[i]!;
      c[i * 4 + 1] = this.y[i]!;
      c[i * 4 + 2] = this.r[i]!;
      c[i * 4 + 3] = this.kind[i]!;
      c[32 + i * 4] = this.alive[i]!;
      c[32 + i * 4 + 1] = this.glow[i]!;
      c[32 + i * 4 + 2] = this.seed[i]!;
      c[32 + i * 4 + 3] = Math.min(0.25, sp * 0.6); // stretch along the swim direction
    }
    const b = this.slotBridges;
    b.fill(0);
    let n = 0;
    // Strongest bridges first, up to REEF_BRIDGES; faded ones (< 0.01) are skipped.
    for (let pass = 0; pass < REEF_BRIDGES; pass++) {
      let best = -1;
      let bestS = 0.01;
      for (let k = 0; k < this.bridge.length; k++) {
        const s = this.bridge[k]!;
        if (s > bestS && !(this.bridgeTarget[k]! < 0)) {
          let used = false;
          for (let m = 0; m < n; m++) if (b[m * 4]! * REEF_CELLS + b[m * 4 + 1]! === k) used = true;
          if (!used) { best = k; bestS = s; }
        }
      }
      if (best < 0) break;
      const i = Math.floor(best / REEF_CELLS);
      const j = best % REEF_CELLS;
      b[n * 4] = i;
      b[n * 4 + 1] = j;
      b[n * 4 + 2] = this.bridge[best]! * Math.min(this.alive[i]!, this.alive[j]!);
      b[n * 4 + 3] = Math.max(this.kind[i]!, this.kind[j]!);
      n++;
    }
    this.slotMeta[0] = 1; // the reef sim is live (else the sky animates slot 0 itself)
    this.slotMeta[1] = this.demo ? 1 : 0;
    this.slotMeta[2] = n;
    this.slotMeta[3] = this.time % 3600;
  }

  /** Drop all state (pane unload / pack switch). Arrays are reused, nothing is retained. */
  dispose(): void {
    this.ids.fill(null);
    this.alive.fill(0);
    this.bridge.fill(0);
    this.bridgeTarget.fill(0);
    this.slotCells.fill(0);
    this.slotBridges.fill(0);
    this.slotMeta.fill(0);
    this.time = 0;
  }
}

/** Idle fallback: a small reef of mixed connection types, so an empty tile still lives. */
export const DEMO_CELLS: readonly ReefCellInput[] = [
  { id: "demo:gateway", x: 0, y: 0.05, r: 0.34, role: "gateway", rate: 80 },
  { id: "demo:laptop", x: -0.62, y: 0.38, r: 0.22, role: "lan", rate: 30 },
  { id: "demo:tv", x: 0.6, y: 0.42, r: 0.2, role: "lan", rate: 22 },
  { id: "demo:phone", x: -0.55, y: -0.45, r: 0.18, role: "wifi", rate: 14 },
  { id: "demo:ssid", x: 0.66, y: -0.4, r: 0.16, role: "wifi", rate: 9 },
  { id: "demo:watch", x: -0.95, y: -0.05, r: 0.12, role: "bluetooth", rate: 3 },
  { id: "demo:buds", x: 0.97, y: 0.0, r: 0.12, role: "bluetooth", rate: 4 },
];
export const DEMO_LINKS: readonly ReefLinkInput[] = [
  { src: "demo:laptop", dst: "demo:gateway", rate: 40 },
  { src: "demo:tv", dst: "demo:gateway", rate: 25 },
  { src: "demo:phone", dst: "demo:gateway", rate: 12 },
  { src: "demo:ssid", dst: "demo:gateway", rate: 8 },
  { src: "demo:watch", dst: "demo:phone", rate: 2 },
  { src: "demo:buds", dst: "demo:tv", rate: 3 },
];
