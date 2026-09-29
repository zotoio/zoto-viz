import type { Device } from "../core/types";
import { DEMO_DATA_LABEL, DEMO_LABEL_CLASS } from "../core/demo-source";
import { IDLE_VIZ_DEMO_HOSTS, IDLE_VIZ_DEMO_SEED, type IdleVizDemoHost } from "../plugins/fixtures/idle-viz-frame";

/**
 * #181: demo traffic for the packet-polled arcade views (frogger, netpong, invaders) when the LAN is quiet.
 *
 * Those views fill their board from `/api/traffic` polls, not from the StateMsg, so the host's VizDataFrame idle
 * fixture never reaches them. This feed hands a view's own `ingest` a batch of seeded, engine-shaped packet rows
 * whenever a poll comes back empty. It has no clock of its own (no setInterval, no requestAnimationFrame): it
 * moves one step per empty-poll callback, so a hidden tab (timers throttled) or a stopped view stops it for free.
 *
 * One takeover rule: the feed turns off on the first real non-empty poll, and turns back on only after
 * {@link ARCADE_IDLE_RESUME_EMPTY_POLLS} empty polls in a row (not after a time), so a quiet LAN does not make the
 * demo label flicker. Every endpoint and name comes from {@link IDLE_VIZ_DEMO_HOSTS}, the header's demo hosts.
 *
 * Tetris keeps its own feed (`tetris-idle-feed.ts` / `tetris-idle-scheduler.ts`): it is a Stage3D engine whose
 * idle packets are rate-scheduled on the viz clock and metered by its traffic budget / top-out logic.
 */

/** Empty polls in a row, after live traffic, before the demo comes back. */
export const ARCADE_IDLE_RESUME_EMPTY_POLLS = 3;
/** Upper bound on the rows of one step: a shaper's batch is cut to this. */
export const ARCADE_IDLE_MAX_ROWS_PER_STEP = 32;
/** Default seed: the idle fixture's pinned seed, so QE's headed shots are the same on every run. */
export const ARCADE_IDLE_DEFAULT_SEED = IDLE_VIZ_DEMO_SEED;

/** What a shaper gets for one step. */
export interface ArcadeIdleShapeCtx {
  /** 0-based step: one per delivered batch (an empty poll while the feed is on) */
  readonly step: number;
  /** wire time (seconds) the step's rows are laid out from */
  readonly t0: number;
  /** the demo host list: the only source of endpoints and names */
  readonly hosts: readonly IdleVizDemoHost[];
  /** the view's single-device pick ("" when the view shows a group) */
  readonly me: string;
  /** the view's group pick when `me` is "" (NetPong: any / lan / internet / match; the others: lan), "" otherwise */
  readonly scope: string;
  /** a seeded generator for a key (an exchange index …): the same seed and key give the same sequence */
  rng(key: number): () => number;
}

/** A per-engine shaper: rows of that engine's own packet row type, oldest first or in any order (the feed sorts by time). */
export type ArcadeIdleShaper<P> = (ctx: ArcadeIdleShapeCtx) => P[];

/** Row types the feed can order: a tuple whose first field is the wire time. */
type TimedRow = readonly [number, ...unknown[]];

export interface ArcadeIdleFeedOptions<P extends TimedRow> {
  shaper: ArcadeIdleShaper<P>;
  /** hands one batch to the engine's real ingest */
  deliver: (rows: P[]) => void;
  seed?: number;
  /** wire clock in seconds (default: Date.now()) */
  clock?: () => number;
  /** the demo label element: gets `is-visible` while the demo is on screen */
  label?: HTMLElement | null;
  hosts?: readonly IdleVizDemoHost[];
}

function mix32(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 */
export function arcadeIdleRng(seed: number, key: number): () => number {
  let s = mix32(seed >>> 0, key >>> 0);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The demo label element (same class and text as Tetris's), hidden until the feed shows demo rows. */
export function mountArcadeDemoLabel(container: HTMLElement): HTMLElement {
  const el = document.createElement("span");
  el.className = `${DEMO_LABEL_CLASS} arcade-idle-label`;
  el.textContent = DEMO_DATA_LABEL;
  container.appendChild(el);
  return el;
}

export class ArcadeIdleFeed<P extends TimedRow> {
  private readonly shaper: ArcadeIdleShaper<P>;
  private readonly deliverRows: (rows: P[]) => void;
  private readonly seed: number;
  private readonly clock: () => number;
  private readonly label: HTMLElement | null;
  private readonly hosts: readonly IdleVizDemoHost[];
  private readonly demoDevices = new Map<string, Device>();
  private isOn = true;
  private active = false;
  private shown = 0;
  private empties = 0;
  private stepNo = 0;
  private deliveries = 0;

  constructor(o: ArcadeIdleFeedOptions<P>) {
    this.shaper = o.shaper;
    this.deliverRows = o.deliver;
    this.seed = (o.seed ?? ARCADE_IDLE_DEFAULT_SEED) >>> 0;
    this.clock = o.clock ?? (() => Date.now() / 1000);
    this.label = o.label ?? null;
    this.hosts = o.hosts ?? IDLE_VIZ_DEMO_HOSTS;
    for (const h of this.hosts) this.demoDevices.set(h.ip, demoDevice(h));
  }

  /** On: no live traffic since the last {@link ARCADE_IDLE_RESUME_EMPTY_POLLS} empty polls (or ever). */
  get on(): boolean { return this.isOn; }
  /** On and a demo batch is on screen: what the label and the "waiting for packets…" text follow. */
  get showing(): boolean { return this.isOn && this.shown > 0; }
  /** Batches delivered since construction (a count, for rows). */
  get delivered(): number { return this.deliveries; }

  /** The view is running: empty polls may deliver. */
  start(): void { this.active = true; }
  /** The view stopped: an empty-poll callback that lands afterwards (an in-flight poll) delivers nothing. */
  stop(): void { this.active = false; }

  /** One empty poll came back. On: deliver the next step. Off: count it, and come back on at the 3rd in a row. */
  pollEmpty(me = "", scope = me ? "" : "lan"): void {
    if (!this.active) return;
    if (!this.isOn) {
      this.empties++;
      if (this.empties < ARCADE_IDLE_RESUME_EMPTY_POLLS) return;
      this.isOn = true;
      this.shown = 0;
    }
    const rows = this.shape(this.stepNo, me, this.clock(), scope);
    this.stepNo++;
    if (!rows.length) return;
    this.deliveries++;
    this.shown++;
    this.syncLabel();
    this.deliverRows(rows);
  }

  /**
   * A real non-empty poll came back: the feed turns off (and the label goes) at once. Returns true when demo rows
   * were on screen, so the view can drop them before the live rows go in.
   */
  pollLive(): boolean {
    this.empties = 0;
    const had = this.showing;
    this.isOn = false;
    this.shown = 0;
    this.syncLabel();
    return had;
  }

  /** The demo device behind a fixture address, while the demo is on screen (names and roles for the board). */
  device(ip: string): Device | undefined { return this.showing ? this.demoDevices.get(ip) : undefined; }

  /** Pure: the rows of one step for a seed. Two feeds with the same seed give the same rows for the same inputs. */
  shape(step: number, me: string, t0: number, scope = me ? "" : "lan"): P[] {
    const seed = this.seed;
    const rows = this.shaper({ step, t0, hosts: this.hosts, me, scope, rng: (key) => arcadeIdleRng(seed, key) });
    return rows.slice(0, ARCADE_IDLE_MAX_ROWS_PER_STEP).sort((a, b) => a[0] - b[0]);
  }

  private syncLabel(): void { this.label?.classList.toggle("is-visible", this.showing); }
}

function demoDevice(h: IdleVizDemoHost): Device {
  return {
    ip: h.ip, mac: "", vendor: "demo", hostnames: [], names: [h.name], sources: ["demo"], ports: [], ifaces: [],
    aliases: [], first_seen: 0, last_seen: 0, bytes_in: 0, bytes_out: 0, packets: 0, role: h.role, online: true,
  };
}
