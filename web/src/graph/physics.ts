/** Layout extras (magnets, gravity, stringy edges) and the traffic-particle budget. */

export const MAX_PARTICLES = 3000;

export const MAGNET_FIELDS = [
  { key: "magnetSelf", role: "self", label: "this host", hint: "pull or push this machine versus other this-host nodes" },
  { key: "magnetGateway", role: "gateway", label: "gateway", hint: "pull or push gateway nodes versus each other" },
  { key: "magnetLan", role: "lan", label: "LAN", hint: "pull or push LAN devices toward or away from other LAN nodes" },
  { key: "magnetLocal", role: "local", label: "local", hint: "containers / VMs / CPU processes tagged local" },
  { key: "magnetInternet", role: "internet", label: "internet", hint: "pull or push internet destinations versus each other" },
  { key: "magnetMulticast", role: "multicast", label: "multicast", hint: "discovery hubs and kernel/idle CPU tags" },
] as const;

export type MagnetKey = (typeof MAGNET_FIELDS)[number]["key"];

/** Layout knobs the scene eases toward (same settle as a theme fade). Sparks still snap. */
export const PHYS_EASE_KEYS = [
  "magnetSelf",
  "magnetGateway",
  "magnetLan",
  "magnetLocal",
  "magnetInternet",
  "magnetMulticast",
  "magnetCross",
  "magnetRange",
  "gravity",
  "swirl",
  "chargeAmt",
  "spring",
  "linkSpan",
  "drag",
  "centerPull",
  "stringAmt",
] as const;

export type PhysEaseKey = (typeof PHYS_EASE_KEYS)[number];
export type PhysEase = Record<PhysEaseKey, number>;

/** Wall-clock to settle ~98% of the way (four time constants). */
export const PHYS_EASE_S = 1.8;
export const PHYS_EASE_TAU_S = PHYS_EASE_S / 4;

export function pickPhys(a: PhysEase): PhysEase {
  const o = {} as PhysEase;
  for (const k of PHYS_EASE_KEYS) o[k] = a[k];
  return o;
}

export function applyPhys(dst: PhysEase, src: PhysEase): void {
  for (const k of PHYS_EASE_KEYS) dst[k] = src[k];
}

/** Exponential chase. Mutates `live`. Returns true while any field is still moving. */
export function easePhysToward(live: PhysEase, want: PhysEase, dt: number): boolean {
  const k = 1 - Math.exp(-Math.max(0, dt) / PHYS_EASE_TAU_S);
  let moving = false;
  for (const key of PHYS_EASE_KEYS) {
    const a = live[key];
    const b = want[key];
    let n = a + (b - a) * k;
    if (Math.abs(n - b) < 1e-3) n = b;
    else moving = true;
    live[key] = n;
  }
  return moving;
}

export interface PhysNode {
  x?: number; y?: number; z?: number;
  vx?: number; vy?: number; vz?: number;
  visible?: boolean;
  device: { role: string };
}

export interface ParticleBudget {
  /** 0–2 overall density */
  amt: number;
  /** 0.25–3 how hard byte-rate feeds count */
  busy: number;
  /** bytes/s below this spawn nothing */
  quiet: number;
  /** max sparks on one edge */
  peak: number;
  /** global cap */
  cap: number;
}

/** How many sparks one conversation wants before the global cap. */
export function particlesOnLink(rate: number, b: ParticleBudget): number {
  if (rate <= 0 || b.amt <= 0.001 || rate < b.quiet) return 0;
  const busy = Math.max(0.25, b.busy);
  const peak = Math.max(1, b.peak);
  const raw = 1 + Math.floor(Math.sqrt(rate / (200 / busy)));
  return Math.max(0, Math.min(peak, Math.round(raw * b.amt)));
}

export function clampParticleCap(n: number): number {
  return Math.min(MAX_PARTICLES, Math.max(20, Math.round(n)));
}

/** Straight line at 0; up to 8 segments when the string is fully slack. */
export function stringSegs(stringAmt: number): number {
  const a = Math.max(0, Math.min(1, stringAmt));
  if (a < 0.04) return 1;
  return Math.min(8, 2 + Math.round(a * 6));
}

/**
 * Point along a catenary-ish quadratic from A to B.
 * `sag` 0–1 droops the middle; `wave` 0–1 adds a sideways ripple.
 */
export function stringPoint(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  t: number,
  sag: number,
  wave = 0,
): [number, number, number] {
  if (sag < 0.01 && Math.abs(wave) < 0.01) {
    return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
  }
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5 - sag * dist * 0.28;
  const mz = (az + bz) * 0.5;
  const nx = -dz / dist, nz = dx / dist;
  const w = Math.sin(t * Math.PI) * wave * dist * 0.08;
  const cx = mx + nx * w;
  const cy = my;
  const cz = mz + nz * w;
  const u = 1 - t;
  return [
    u * u * ax + 2 * u * t * cx + t * t * bx,
    u * u * ay + 2 * u * t * cy + t * t * by,
    u * u * az + 2 * u * t * cz + t * t * bz,
  ];
}

/** Same-type magnet, or the cross slider between different types. Positive attracts. */
export function magnetPair(roleA: string, roleB: string, mag: Record<string, number>, cross: number): number {
  if (roleA === roleB) return mag[roleA] ?? 0;
  return cross;
}

export function magnetForce(
  magnets: () => Record<string, number>,
  cross: () => number,
  range: () => number,
  scale: () => number,
) {
  let nodes: PhysNode[] = [];
  const force = (alpha: number) => {
    const mag = magnets();
    const xk = cross();
    const s = scale();
    if (s <= 0) return;
    let any = Math.abs(xk) >= 0.02;
    if (!any) {
      for (const v of Object.values(mag)) if (Math.abs(v) >= 0.02) { any = true; break; }
    }
    if (!any) return;
    const maxD = 80 + 520 * Math.max(0.15, range());
    const maxD2 = maxD * maxD;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      if (a.visible === false) continue;
      const ra = a.device.role;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]!;
        if (b.visible === false) continue;
        const k = magnetPair(ra, b.device.role, mag, xk);
        if (Math.abs(k) < 0.02) continue;
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const dz = (b.z ?? 0) - (a.z ?? 0);
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD2 || d2 < 4) continue;
        const d = Math.sqrt(d2);
        const f = k * s * 90 * alpha / Math.max(d, 18);
        const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
        a.vx = (a.vx ?? 0) + fx;
        a.vy = (a.vy ?? 0) + fy;
        a.vz = (a.vz ?? 0) + fz;
        b.vx = (b.vx ?? 0) - fx;
        b.vy = (b.vy ?? 0) - fy;
        b.vz = (b.vz ?? 0) - fz;
      }
    }
  };
  force.initialize = (ns: PhysNode[]) => { nodes = ns; };
  return force;
}

/** Pull toward -Y (the floor). */
export function gravityForce(amount: () => number, scale: () => number) {
  let nodes: PhysNode[] = [];
  const force = (alpha: number) => {
    const g = amount() * scale();
    if (g <= 0.001) return;
    const k = g * 42 * alpha;
    for (const n of nodes) {
      if (n.visible === false) continue;
      n.vy = (n.vy ?? 0) - k;
    }
  };
  force.initialize = (ns: PhysNode[]) => { nodes = ns; };
  return force;
}

/** Yaw torque around the origin so the cloud slowly orbits. */
export function swirlForce(amount: () => number, scale: () => number) {
  let nodes: PhysNode[] = [];
  const force = (alpha: number) => {
    const w = amount() * scale();
    if (Math.abs(w) < 0.01) return;
    const k = w * 0.018 * alpha;
    for (const n of nodes) {
      if (n.visible === false) continue;
      const x = n.x ?? 0, z = n.z ?? 0;
      n.vx = (n.vx ?? 0) + -z * k;
      n.vz = (n.vz ?? 0) + x * k;
    }
  };
  force.initialize = (ns: PhysNode[]) => { nodes = ns; };
  return force;
}
