/**
 * Per-edge-type damping for the force graph.
 *
 * Snapshots arrive about once a second and bursty sources (packet flows, Bluetooth adverts, Wi-Fi
 * channel hops, discovery chatter) make edges blink in and out and their rates jump by orders of
 * magnitude between snapshots. Each of those jumps used to reach the layout raw: a vanished flow
 * dropped its spring at once, a reappearing one snapped back at full strength, and node rates (which
 * drive the slot ring, traffic hubs and labels) followed every spike. This module smooths that
 * signal per edge before it reaches the simulation:
 *
 *  - rate: asymmetric EMA (fast-ish attack, slow release) so a burst lifts an edge without a whiplash
 *  - presence: hysteresis on the smoothed rate plus a minimum lifetime and a linger/fade-out window
 *    before a missing edge is removed, so scan gaps do not tear edges down and rebuild them
 *  - spring: the effective strength is presence × target strength, and its change per second is capped
 *  - layout: per-type alpha bump scale and a velocity-decay floor (heavier nodes for bursty sources)
 */

export type EdgeKind = "flow" | "discovery" | "tether" | "bt" | "wifi" | "cpu" | "graph";

export interface EdgePreset {
  /** EMA time constant (s) while the rate rises */
  attackS: number;
  /** EMA time constant (s) while the rate falls */
  releaseS: number;
  /** smoothed rate (bytes/s) at which a lingering edge counts as active again */
  onRate: number;
  /** smoothed rate under which an edge counts as idle (hysteresis: offRate <= onRate) */
  offRate: number;
  /** an edge lives at least this long (s) after it first appears */
  minLifeS: number;
  /** seconds a missing edge is kept (spring fading) before removal */
  lingerS: number;
  /** presence fade-in time (s) for a new edge */
  fadeInS: number;
  /** max change of the spring scale per second (0..1 units) */
  springSlew: number;
  /** multiplier on alpha bumps caused by structure changes of this type */
  alphaScale: number;
  /** velocity-decay floor while this type dominates the graph (0 = none) */
  dragFloor: number;
}

/** Calm defaults. Bursty radio sources get the longest windows. */
export const EDGE_PRESETS: Readonly<Record<EdgeKind, EdgePreset>> = Object.freeze({
  // packet flows: bursty but meaningful; follow rises in ~1 snapshot, decay over several
  flow: { attackS: 0.8, releaseS: 4, onRate: 64, offRate: 16, minLifeS: 3, lingerS: 6, fadeInS: 1.2, springSlew: 0.6, alphaScale: 0.5, dragFloor: 0.5 },
  // multicast / mDNS / SSDP / DNS-to-gateway chatter: very bursty, low information in each burst
  discovery: { attackS: 1.5, releaseS: 8, onRate: 32, offRate: 8, minLifeS: 5, lingerS: 12, fadeInS: 2, springSlew: 0.35, alphaScale: 0.3, dragFloor: 0.55 },
  // structural "~" tethers to the hub: stable, just ease in and out
  tether: { attackS: 0.5, releaseS: 1, onRate: 0, offRate: 0, minLifeS: 2, lingerS: 3, fadeInS: 1.5, springSlew: 0.5, alphaScale: 0.5, dragFloor: 0 },
  // BLE adverts: devices pop in and out between inquiry scans and random-MAC churn
  bt: { attackS: 2, releaseS: 10, onRate: 1, offRate: 0.25, minLifeS: 8, lingerS: 20, fadeInS: 2.5, springSlew: 0.25, alphaScale: 0.25, dragFloor: 0.6 },
  // Wi-Fi: the monitor radio hops channels (dwell ~60 s) so whole networks go quiet in turn
  wifi: { attackS: 2, releaseS: 12, onRate: 1, offRate: 0.25, minLifeS: 10, lingerS: 30, fadeInS: 2.5, springSlew: 0.2, alphaScale: 0.25, dragFloor: 0.6 },
  // CPU cores/processes: smooth load, already has its own idle fade
  cpu: { attackS: 0.6, releaseS: 2.5, onRate: 1, offRate: 0.25, minLifeS: 2, lingerS: 4, fadeInS: 1, springSlew: 0.8, alphaScale: 0.6, dragFloor: 0.45 },
  // plugin / sources graphs (graph.read consumers): mostly static structure, refreshed in batches
  graph: { attackS: 1, releaseS: 3, onRate: 0, offRate: 0, minLifeS: 3, lingerS: 5, fadeInS: 1.5, springSlew: 0.5, alphaScale: 0.4, dragFloor: 0.45 },
});

/** Legacy behaviour: no smoothing, no linger, instant springs. */
export const RAW_PRESET: Readonly<EdgePreset> = Object.freeze({
  attackS: 0, releaseS: 0, onRate: 0, offRate: 0, minLifeS: 0, lingerS: 0, fadeInS: 0, springSlew: 0, alphaScale: 1, dragFloor: 0,
});

export interface EdgeDampingConfig {
  /** false restores the raw (pre-damping) behaviour */
  enabled: boolean;
  /** 0..3 multiplier on every time window (1 = presets as written) */
  calm: number;
  /** per-type overrides */
  presets?: Partial<Record<EdgeKind, Partial<EdgePreset>>>;
}

export const DEFAULT_EDGE_DAMPING: Readonly<EdgeDampingConfig> = Object.freeze({ enabled: true, calm: 1 });

export const EDGE_DAMPING_STORAGE_KEY = "zotoviz.edgeDamping";

/** Parse a stored / user config; anything malformed falls back to the default. */
export function parseEdgeDamping(raw: unknown): EdgeDampingConfig {
  let v: unknown = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== "object") return { ...DEFAULT_EDGE_DAMPING };
  const o = v as Record<string, unknown>;
  const calm = Number(o.calm);
  const out: EdgeDampingConfig = {
    enabled: o.enabled !== false,
    calm: Number.isFinite(calm) ? Math.max(0, Math.min(3, calm)) : 1,
  };
  if (o.presets && typeof o.presets === "object") {
    const p: Partial<Record<EdgeKind, Partial<EdgePreset>>> = {};
    for (const k of Object.keys(EDGE_PRESETS) as EdgeKind[]) {
      const src = (o.presets as Record<string, unknown>)[k];
      if (!src || typeof src !== "object") continue;
      const part: Partial<EdgePreset> = {};
      for (const f of Object.keys(EDGE_PRESETS[k]) as (keyof EdgePreset)[]) {
        const n = Number((src as Record<string, unknown>)[f]);
        if (Number.isFinite(n) && n >= 0) part[f] = n;
      }
      p[k] = part;
    }
    out.presets = p;
  }
  return out;
}

const TIME_KEYS: readonly (keyof EdgePreset)[] = ["attackS", "releaseS", "minLifeS", "lingerS", "fadeInS"];

export function resolvePreset(kind: EdgeKind, cfg: EdgeDampingConfig): EdgePreset {
  if (!cfg.enabled) return { ...RAW_PRESET };
  const p: EdgePreset = { ...EDGE_PRESETS[kind], ...(cfg.presets?.[kind] ?? {}) };
  for (const k of TIME_KEYS) p[k] *= cfg.calm;
  if (cfg.calm > 0) p.springSlew /= cfg.calm;
  if (p.offRate > p.onRate) p.offRate = p.onRate;
  return p;
}

/** Edge type from the graph base the view draws and the link itself. */
export function edgeKindFor(
  graphBase: string | undefined,
  linkId: string,
  roles: readonly [string, string],
  protos: readonly string[] = [],
): EdgeKind {
  if (graphBase === "bluetooth") return "bt";
  if (graphBase === "wifi") return "wifi";
  if (graphBase === "cpu") return "cpu";
  if (graphBase && graphBase !== "lan") return "graph";
  if (linkId.startsWith("~")) return "tether";
  if (roles[0] === "multicast" || roles[1] === "multicast") return "discovery";
  for (const p of protos) {
    const s = p.toLowerCase();
    if (s === "mdns" || s === "ssdp" || s === "llmnr" || s === "nbns" || s === "arp" || s === "dhcp" || s === "igmp") return "discovery";
  }
  return "flow";
}

/** Exponential smoothing step with separate rise / fall time constants. */
export function emaStep(prev: number, next: number, dt: number, attackS: number, releaseS: number): number {
  const tau = next > prev ? attackS : releaseS;
  if (tau <= 0 || dt <= 0) return tau <= 0 ? next : prev;
  return prev + (next - prev) * (1 - Math.exp(-dt / tau));
}

/** Move `cur` toward `want` by at most `rate * dt` (rate 0 = jump). */
export function slew(cur: number, want: number, dt: number, rate: number): number {
  if (rate <= 0) return want;
  const d = want - cur;
  const m = rate * Math.max(0, dt);
  return Math.abs(d) <= m ? want : cur + Math.sign(d) * m;
}

export interface EdgeState {
  kind: EdgeKind;
  born: number;
  lastSeen: number;
  rate: number;
  /** hysteresis latch: true while the smoothed rate counts as active */
  active: boolean;
  /** 0..1 spring presence after fade / slew */
  presence: number;
}

export interface EdgeSample {
  /** smoothed bytes/s */
  rate: number;
  /** 0..1 multiplier for the spring */
  presence: number;
  /** hysteresis-latched activity */
  active: boolean;
  /** false once the edge is gone for good and should be removed */
  keep: boolean;
}

/**
 * Tracks every edge across snapshots. Call `observe` for each edge in the snapshot and `step`
 * once per snapshot with the snapshot time; missing edges linger until their window runs out.
 */
export class EdgeDamper {
  private readonly edges = new Map<string, EdgeState>();
  private cfg: EdgeDampingConfig;
  private cache = new Map<EdgeKind, EdgePreset>();
  private last = Number.NaN;

  constructor(cfg: EdgeDampingConfig = DEFAULT_EDGE_DAMPING) { this.cfg = { ...cfg }; }

  get config(): EdgeDampingConfig { return this.cfg; }

  setConfig(cfg: EdgeDampingConfig): void { this.cfg = { ...cfg }; this.cache.clear(); }

  preset(kind: EdgeKind): EdgePreset {
    let p = this.cache.get(kind);
    if (!p) { p = resolvePreset(kind, this.cfg); this.cache.set(kind, p); }
    return p;
  }

  get size(): number { return this.edges.size; }
  has(id: string): boolean { return this.edges.has(id); }
  state(id: string): EdgeState | undefined { return this.edges.get(id); }

  /**
   * Advance every edge to `now` (seconds). `seen` maps id → [kind, raw rate] for edges in this
   * snapshot. Returns the samples for every edge still kept (seen or lingering).
   */
  step(now: number, seen: ReadonlyMap<string, readonly [EdgeKind, number]>): Map<string, EdgeSample> {
    const dt = Number.isFinite(this.last) ? Math.max(0, Math.min(5, now - this.last)) : 0;
    this.last = now;
    const out = new Map<string, EdgeSample>();
    for (const [id, [kind, raw]] of seen) {
      let e = this.edges.get(id);
      const p = this.preset(kind);
      if (!e || e.kind !== kind) {
        e = { kind, born: now, lastSeen: now, rate: p.attackS > 0 ? 0 : raw, active: false, presence: p.fadeInS > 0 ? 0 : 1 };
        this.edges.set(id, e);
      }
      e.lastSeen = now;
      e.rate = emaStep(e.rate, Math.max(0, raw), dt || (p.attackS > 0 ? 0.5 : 0), p.attackS, p.releaseS);
      if (p.attackS <= 0 && p.releaseS <= 0) e.rate = Math.max(0, raw);
      this.latch(e, p);
      e.presence = p.fadeInS > 0 ? slewPresence(e.presence, 1, dt, p) : 1;
      out.set(id, { rate: e.rate, presence: e.presence, active: e.active, keep: true });
    }
    for (const [id, e] of this.edges) {
      if (seen.has(id)) continue;
      const p = this.preset(e.kind);
      const gone = now - e.lastSeen;
      const life = now - e.born;
      if (gone >= p.lingerS && life >= p.minLifeS) { this.edges.delete(id); continue; }
      e.rate = emaStep(e.rate, 0, dt, p.attackS, p.releaseS);
      this.latch(e, p);
      // fade the spring out over the linger window (or the remaining min life, whichever is longer)
      const window = Math.max(p.lingerS, p.minLifeS - (e.lastSeen - e.born), 1e-3);
      const want = Math.max(0, 1 - gone / window);
      e.presence = Math.min(e.presence, slew(e.presence, want, dt, p.springSlew > 0 ? Math.max(p.springSlew, 1 / window) : 0));
      out.set(id, { rate: e.rate, presence: e.presence, active: e.active, keep: true });
    }
    return out;
  }

  forget(id: string): void { this.edges.delete(id); }
  clear(): void { this.edges.clear(); this.last = Number.NaN; }

  private latch(e: EdgeState, p: EdgePreset): void {
    if (e.active) { if (e.rate < p.offRate || (p.offRate <= 0 && e.rate <= 0)) e.active = false; }
    else if (e.rate >= Math.max(p.onRate, 1e-9)) e.active = true;
  }
}

function slewPresence(cur: number, want: number, dt: number, p: EdgePreset): number {
  const fade = p.fadeInS > 0 ? 1 / p.fadeInS : 0;
  const rate = p.springSlew > 0 ? Math.min(fade || Infinity, p.springSlew * 4) : fade;
  return slew(cur, want, dt, rate);
}

/** The dominant edge type's velocity-decay floor and alpha scale for the whole graph. */
export function layoutDampingFor(kinds: Iterable<EdgeKind>, damper: EdgeDamper): { dragFloor: number; alphaScale: number } {
  const count = new Map<EdgeKind, number>();
  for (const k of kinds) count.set(k, (count.get(k) ?? 0) + 1);
  let best: EdgeKind | null = null;
  let n = -1;
  for (const [k, c] of count) {
    if (k === "tether") continue;
    if (c > n) { best = k; n = c; }
  }
  if (!best) best = count.size ? "tether" : "flow";
  const p = damper.preset(best);
  return { dragFloor: p.dragFloor, alphaScale: p.alphaScale };
}
