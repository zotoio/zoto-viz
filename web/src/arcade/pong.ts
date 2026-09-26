import type { NetScene } from "../graph/scene";
import { Select, TextField, type SelectOption } from "../ui/ui";
import { categorize, hashColor } from "../core/modes";
import { rIp, rName, rText } from "../core/redact";
import { displayName, idsOf, type Device, type StateMsg, type TrafficMsg } from "../core/types";
import { DEFAULT_THEME, type Theme } from "../core/themes";
import { compileMatcher } from "../ui/settings";
import { LookStage } from "../graph/look";
import { fitText, isExchangeStart, noReplyExpected, portRole, roundRect } from "./arcade";
import { markFrame, PaneFps } from "../core/fps";
import { CanvasChangeProbe } from "../graph/pane-change";
import { observeResize } from "../core/resize";
import { devicePxRatioFromWindow, devicePxRatioNumber } from "../graph/render-host-device-px-ratio";

/**
 * NetPong: Logstalgia ("Apache Pong") for one host on the network.
 *
 * Whoever asks is on the left, whatever they ask for is on the right, always. Every request is a ball that
 * leaves the asker's row and flies to the lane of the service it aims at (`udp/53 · DNS`,
 * `api.example.com :443`); an answer within 2.5 s returns it, no answer and it passes through and off the
 * right edge in red. The *source* (gateway by default, or any known device) is the host whose traffic is
 * shown. The paddle returns every answered request, whichever end served it: it plans for the ball that lands
 * next and covers the gap at whatever speed that takes, so it is always in front of the lane when the ball
 * arrives (a dart when two lanes answer back to back). So for a server the left column is its clients; for a
 * laptop the left column is mostly the laptop itself and the right column the services it talks to. Lanes
 * rank by request volume, busiest on top, and glide to their new place when the order changes. Every miss is
 * also written to a failed-request log above the footer (time, asker → lane, the packet's decoded info), newest
 * first, repeats folded into one line with a count, each line fading out after a few seconds.
 *
 * The *target* narrows which of the source's peers are shown: any, internet (peers off the local network),
 * LAN (everything on the local segment, multicast included), one individual host, or a matcher, a free-text
 * pattern list (name glob / substring, CIDR, address prefix) using the same syntax as the settings filters.
 *
 * Who asked is read from the real source→destination ports against the service port (`tcp/443`): the end
 * holding the service port is the server. Protocols without ports (ICMP, ARP) and same-port protocols (mDNS,
 * NBNS) fall back to "first packet is the request, the next one back is the answer". Requests to multicast
 * and broadcast never count as missed. Answers that match no request are drawn faint, flowing back from the
 * lane to the asker.
 *
 * Data comes from /api/traffic for the source, polled once a second (scoped server-side to one conversation
 * when the target is a single host, filtered client-side otherwise); each poll's new packets are spawned with
 * their real relative timing over the next second so the rhythm on screen is the rhythm on the wire. Busy
 * hosts are coalesced per asker + lane so the view stays readable.
 */

const POLL_MS = 1000;
const FLIGHT_S = 2.4;           // crossing time at speed 1x
const REPLY_WINDOW_S = 2.5;     // an answer this soon after the request (same hosts, same lane) is its answer
const REPLAY_S = 3;             // history replayed on (re)targeting so the view is not empty at first
const ROW_TTL_S = 30;           // rows fade out this long after their last packet
const ROW_FADE_S = 5;
const VOL_DECAY_S = 30;         // lane request volume decays with this time constant, so the ranking follows current traffic
const LANE_MOVE_S = 0.35;       // lanes glide to their rank in about this long
const PADDLE_MARGIN = 0.7;      // the paddle plans to arrive when this fraction of the ball's remaining flight is left
const MAX_BALLS_PER_POLL = 48;  // above this, one poll's packets are coalesced per asker + lane
const ROW_H = 20;
const LEFT_W = 224;             // sources column
const RIGHT_W = 290;            // destinations column
const CAPTION_H = 26;
const HUD_H = 84;               // source, address, target, tally
const BOTTOM = 84;              // room for the footer legend
const LOG_ROWS = 5;             // failed-request log: lines shown above the footer
const LOG_ROW_H = 17;
const LOG_H = 6 + CAPTION_H + LOG_ROWS * LOG_ROW_H + 12; // rule, caption, rows, breathing room above the footer
const LOG_TTL_S = 12;           // a failed request stays in the log this long, fading over the last few seconds
const LOG_FADE_S = 4;
const PADDLE_W = 8, PADDLE_H = 48;
const MISS_RED = "#ef5350";
const MAX_PEER_OPTS = 40;       // individual hosts offered in the target menu (the source's busiest peers)
const KEY_SOURCE = "zoto-viz.pong.source";
const KEY_SOURCE_PATTERN = "zoto-viz.pong.source.pattern";
const KEY_TARGET = "zoto-viz.pong.target";
const KEY_PATTERN = "zoto-viz.pong.pattern";
const MAX_MATCH_IPS = 120;      // addresses a matcher source may expand to in one poll URL
const KEY_SPEED = "zoto-viz.pong.speed";

const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** the fixed target choices; anything else is an individual peer address */
const TARGET_GROUPS = ["any", "internet", "lan", "match"] as const;
type TargetGroup = (typeof TARGET_GROUPS)[number];
const isGroup = (v: string): v is TargetGroup => (TARGET_GROUPS as readonly string[]).includes(v);

/** known devices: what the source selector offers and what a click inside the view promotes to source */
const isKnown = (d: Device | undefined): boolean => !!d && (d.role === "lan" || d.role === "local" || d.role === "gateway" || d.role === "self");

/** which end owns the service port: the source ("server": a request to it) or the peer ("client": a request by it) */
type Side = "server" | "client";
type Kind = "request" | "other";
interface Rec { t: number; answered: boolean }
interface Row { id: string; slot: number; last: number; y: number; color: string; count: number; bytes: number }
interface Lane extends Row {
  label: string;
  /** the host that serves this lane: the source, or a peer */
  host: string;
  owner: "source" | "peer";
  hits: number; misses: number; flash: number;
  /** decayed request count: the ranking key. Lanes sort by it, busiest on top, and glide to their rank */
  vol: number;
  rank: number;
}
interface Spawn { side: Side; kind: Kind; src: string; laneKey: string; laneHost: string; label: string; t: number; bytes: number; count: number; recs: Rec[]; info: string }
/** one line of the failed-request log; repeats of the same asker → lane fold into one line with a count */
interface Miss { key: string; t: number; wall: number; count: number; color: string; who: string; what: string; info: string }
type Phase = "fly" | "bounce" | "miss" | "pop";
interface Ball {
  kind: Kind;
  /** requests: the packet records whose `answered` flag the matching answers flip */
  recs: Rec[];
  src: Row;
  lane: Lane;
  /** spawn time (animation clock, seconds) and crossing time */
  t0: number;
  dur: number;
  r: number;
  color: string;
  count: number;
  /** wall-clock time of the (first) packet and its decoded info column, for the failed-request log */
  wall: number;
  info: string;
  phase: Phase;
  x: number; y: number; vx: number; vy: number;
  /** seconds since the phase changed away from "fly" */
  age: number;
}
interface Ring { x: number; y: number; t0: number; color: string }

/** A column of rows keyed by id. Rows take the lowest free slot and keep it until they expire. */
class Column<R extends Row> {
  readonly rows = new Map<string, R>();
  constructor(private readonly make: (base: Row) => R) {}

  get(id: string, now: number, color: string, max: number): R {
    let r = this.rows.get(id);
    if (!r) {
      const used = new Set([...this.rows.values()].map((x) => x.slot));
      let slot = 0;
      while (used.has(slot) && slot < max - 1) slot++;
      r = this.make({ id, slot, last: now, y: 0, color, count: 0, bytes: 0 });
      this.rows.set(id, r);
    }
    r.last = now;
    return r;
  }

  expire(now: number, inUse: (r: R) => boolean): void {
    for (const [id, r] of this.rows) if (now - r.last > ROW_TTL_S && !inUse(r)) this.rows.delete(id);
  }

  /** Assign y from the slot; rows beyond the visible capacity share the last line. */
  layout(top: number, max: number): void {
    for (const r of this.rows.values()) r.y = top + Math.min(r.slot, Math.max(0, max - 1)) * ROW_H + ROW_H / 2;
  }

  clear(): void { this.rows.clear(); }
}

export class PongView {
  /** This view settings: source / target / speed while the mode is active */
  readonly controls: HTMLElement[];
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly sourceSel: Select;
  private readonly srcPatternField: TextField;
  private readonly targetSel: Select;
  private readonly patternField: TextField;
  private readonly speedSel: Select;
  private running = false;
  private raf = 0;
  private timer: number | null = null;
  private inflight = false;
  private msg: StateMsg | null = null;
  private theme: Theme = DEFAULT_THEME;
  private font = "ui-sans-serif, system-ui, sans-serif";
  /** source pick: a group ("any" / "internet" / "lan" / "match"), "gateway", "self", or an address */
  private srcChoice: string;
  /** target pick: a group ("any" / "internet" / "lan" / "match") or a peer address */
  private tgtChoice: string;
  /** the matcher pattern lists (source = "match" / target = "match") */
  private srcPattern: string;
  private pattern: string;
  private srcMatcher: (d: Device | undefined, ip: string) => boolean = () => false;
  private matcher: (d: Device | undefined, ip: string) => boolean = () => false;
  private patternTimer: number | null = null;
  /**
   * What /api/traffic is polled for: one address, a role token (`@lan`…) or a comma list (matcher); and the
   * resolved individual target address when the target is one host.
   */
  private srcIp = "";
  private tgtIp = "";
  /** the source group's members, for a group source (which end of a packet is "ours") */
  private srcMembers = new Set<string>();
  /** source|target|pattern the current run was started for; a change resets the view */
  private dataKey = "";
  private srcSig = "";
  private tgtSig = "";
  private lastT = 0;
  /** bumped on every reset so a poll answered for the previous source / target is dropped */
  private gen = 0;
  /** requests awaiting an answer, by side|peer|lane */
  private pending = new Map<string, Rec[]>();
  private sources = new Column<Row>((b) => b);
  private lanes = new Column<Lane>((b) => ({ ...b, label: "", host: "", owner: "peer", hits: 0, misses: 0, flash: -1, vol: 0, rank: -1 }));
  /** how many lanes are squeezed onto the shared last line */
  private laneOverflow = 0;
  private balls: Ball[] = [];
  private rings: Ring[] = [];
  /** failed-request log, newest first */
  private misses: Miss[] = [];
  private paddle = { y: -1, vy: 0, glow: 0 };
  private stats = { hits: 0, misses: 0, other: 0, pps: 0 };
  /** hovered host (a source row or a peer-served lane); click makes it the source (known device) or the target */
  private hover: { host: string; row: Row } | null = null;
  private pointer = { x: -1, y: -1 };
  private lastFrame = 0;
  private W = 0; private H = 0; private dpr = 1;
  private geom = { top: 0, bottom: 0, xL: 0, xP: 0, maxLeft: 1, maxRight: 1 };
  private readonly look: LookStage;
  private readonly paneFps: PaneFps;
  private readonly picture = new CanvasChangeProbe();

  constructor(private readonly container: HTMLElement, private readonly scene: NetScene) {
    this.paneFps = new PaneFps(container);
    this.look = new LookStage(container);
    this.canvas = document.createElement("canvas");
    this.g = this.canvas.getContext("2d")!;
    container.appendChild(this.canvas);
    this.font = getComputedStyle(document.documentElement).fontFamily || this.font;

    // the pick that used to live under the "target" key was the focal host: it is the source now
    if (localStorage.getItem(KEY_SOURCE) === null && localStorage.getItem(KEY_TARGET) !== null) {
      localStorage.setItem(KEY_SOURCE, localStorage.getItem(KEY_TARGET)!);
      localStorage.removeItem(KEY_TARGET);
    }
    this.srcChoice = localStorage.getItem(KEY_SOURCE) ?? "gateway";
    this.tgtChoice = localStorage.getItem(KEY_TARGET) ?? "any";
    this.srcPattern = localStorage.getItem(KEY_SOURCE_PATTERN) ?? "";
    this.pattern = localStorage.getItem(KEY_PATTERN) ?? "";
    this.srcMatcher = compileMatcher(this.srcPattern);
    this.matcher = compileMatcher(this.pattern);

    this.sourceSel = new Select({
      id: "pongSource",
      caption: "source",
      title: "whose traffic is shown: every device, all internet hosts, the local network, a pattern, or one device",
      options: [...this.groupOptions("source"), { value: "gateway", label: "gateway" }, { value: "self", label: "this host" }],
      value: this.srcChoice,
      onChange: (v) => this.chooseSource(v),
    });
    this.srcPatternField = new TextField({
      id: "pongSourcePattern",
      caption: "pattern",
      title: "devices to take as the source, comma-separated: a name glob (phone-*), a substring, a CIDR (192.168.1.0/24) or an address prefix",
      placeholder: "phone-*, 192.168.1.0/24",
      value: this.srcPattern,
      onInput: (v) => this.setSourcePattern(v),
    });
    this.srcPatternField.hidden = this.srcChoice !== "match";
    this.targetSel = new Select({
      id: "pongTarget",
      caption: "target",
      title: "which of the source's peers to show: everything, internet only, the local network only, one host, or a pattern",
      options: this.groupOptions(),
      value: this.tgtChoice,
      onChange: (v) => this.chooseTarget(v),
    });
    this.patternField = new TextField({
      id: "pongPattern",
      caption: "pattern",
      title: "peers to show, comma-separated: a name glob (*.example*), a substring, a CIDR (10.0.0.0/8) or an address prefix (192.168.1.)",
      placeholder: "*.google*, 10.0.0.0/8",
      value: this.pattern,
      onInput: (v) => this.setPattern(v),
    });
    this.patternField.hidden = this.tgtChoice !== "match";
    this.speedSel = new Select({
      caption: "speed",
      title: "how fast the balls cross the screen",
      options: [{ value: "0.5", label: "slow" }, { value: "1", label: "normal" }, { value: "2", label: "fast" }],
      value: localStorage.getItem(KEY_SPEED) ?? "1",
      onChange: (v) => localStorage.setItem(KEY_SPEED, v),
    });
    this.controls = [this.sourceSel.el, this.srcPatternField.el, this.targetSel.el, this.patternField.el, this.speedSel.el];

    this.canvas.addEventListener("pointermove", (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    this.canvas.addEventListener("pointerleave", () => { this.pointer = { x: -1, y: -1 }; });
    // a known device becomes the source, anything else (or any host with shift held) becomes the target
    this.canvas.addEventListener("click", (e) => {
      if (!this.hover) return;
      if (!e.shiftKey && isKnown(this.deviceAt(this.hover.host))) this.chooseSource(this.hover.host);
      else this.chooseTarget(this.hover.host);
    });
    observeResize(container, () => this.fit());
  }

  // ------------------------------------------------------------------ lifecycle

  /** Show the view. `preferIp` (the device selected in the graph) becomes the source when it is a known device, the target otherwise. */
  start(preferIp?: string | null): void {
    if (document.body.classList.contains("mosaic")) this.look.attach();
    if (preferIp) {
      if (isKnown(this.deviceAt(preferIp))) this.chooseSource(preferIp, false);
      else this.chooseTarget(preferIp, false);
    }
    this.running = true;
    this.lastFrame = 0;
    this.rebuildOptions();
    this.resync();
    if (this.timer === null) this.timer = window.setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.look.detach();
  }

  /** Every snapshot: refresh both menus and re-resolve source / target (gateway / merged aliases can change). */
  update(msg: StateMsg): void {
    this.msg = msg;
    if (!this.running) return;
    this.rebuildOptions();
    this.resync();
  }

  setTheme(t: Theme): void { this.theme = t; }

  /** what /api/traffic is polled for: an address, a role token (`@lan`) or a comma list */
  get source(): string { return this.srcIp; }
  /** the target pick: a group name or a peer address */
  get target(): string { return this.tgtChoice; }

  // ------------------------------------------------------------------ source / target

  private get srcIsGroup(): boolean { return isGroup(this.srcChoice); }

  private chooseSource(v: string, restart = true): void {
    const m = this.msg;
    if (m && v === m.gateway) v = "gateway";
    else if (m && v === m.local_ip) v = "self";
    this.srcChoice = v;
    localStorage.setItem(KEY_SOURCE, v);
    this.srcPatternField.hidden = v !== "match";
    // a single-host target that is the new single-host source itself would show nothing
    if (!isGroup(v) && !isGroup(this.tgtChoice) && this.scene.resolve(this.tgtChoice) === this.resolveSource()) this.setTargetChoice("any");
    this.rebuildOptions(true);
    if (restart) {
      this.resync();
      if (v === "match") this.srcPatternField.focus();
    }
  }

  private chooseTarget(v: string, restart = true): void {
    if (!isGroup(v) && !this.srcIsGroup && this.scene.resolve(v) === this.resolveSource()) return; // the source is not its own peer
    this.setTargetChoice(v);
    this.rebuildOptions(true);
    if (restart) {
      this.resync();
      if (v === "match") this.patternField.focus();
    }
  }

  private setTargetChoice(v: string): void {
    this.tgtChoice = v;
    localStorage.setItem(KEY_TARGET, v);
    this.patternField.hidden = v !== "match";
  }

  /** Pattern edits restart the view after a short pause, so typing does not reset it on every keystroke. */
  private setPattern(v: string): void {
    this.pattern = v;
    localStorage.setItem(KEY_PATTERN, v);
    this.schedulePatternResync();
  }

  private setSourcePattern(v: string): void {
    this.srcPattern = v;
    localStorage.setItem(KEY_SOURCE_PATTERN, v);
    this.srcMatcher = compileMatcher(v);
    this.schedulePatternResync();
  }

  private schedulePatternResync(): void {
    if (this.patternTimer !== null) clearTimeout(this.patternTimer);
    this.patternTimer = window.setTimeout(() => { this.patternTimer = null; this.rebuildOptions(true); this.resync(); }, 350);
  }

  /** Whether an address belongs to the source: the one device, or a member of the source group. */
  private inSource(ip: string): boolean {
    switch (this.srcChoice) {
      case "any": return true;
      case "internet": return this.deviceAt(ip)?.role === "internet";
      case "lan": return isKnown(this.deviceAt(ip));
      case "match": return this.srcMembers.has(ip);
      default: return ip === this.srcIp;
    }
  }

  /**
   * The `ip=` value to poll: a device address, a role token the server expands (`@any` / `@internet` / `@lan`),
   * or, for a matcher, the matching devices' addresses (busiest first, capped so the URL stays sane).
   */
  private resolveSource(): string {
    const m = this.msg;
    if (!m) return "";
    switch (this.srcChoice) {
      case "gateway": return m.gateway;
      case "self": return m.local_ip;
      case "any": return "@any";
      case "internet": return "@internet";
      case "lan": return "@lan";
      case "match":
        return m.devices
          .filter((d) => this.srcMatcher(d, d.ip))
          .sort((a, b) => (b.bytes_in + b.bytes_out) - (a.bytes_in + a.bytes_out))
          .slice(0, MAX_MATCH_IPS)
          .flatMap((d) => idsOf(d, d.ip).split(",")) // "merge names": every address behind the name
          .join(",");
      default: {
        const ip = this.scene.resolve(this.srcChoice);
        return m.devices.some((d) => d.ip === ip) ? ip : m.gateway;
      }
    }
  }

  /** How many devices the source stands for (1 for a single host). */
  private sourceCount(): number {
    const m = this.msg;
    if (!m) return 0;
    if (this.srcChoice === "match") return this.srcMembers.size;
    return this.srcIsGroup ? m.devices.filter((d) => this.inSource(d.ip)).length : 1;
  }

  /** Apply the current picks: when source, target or pattern changed since the run started, start over. */
  private resync(): void {
    const src = this.resolveSource();
    const tgt = isGroup(this.tgtChoice) ? "" : this.scene.resolve(this.tgtChoice);
    // a matcher source's address list follows the snapshot (a new matching device, "merge names"); that must not
    // restart the view, so the list itself is not part of the key, only the pattern that produced it
    this.srcIp = src;
    this.srcMembers = new Set(this.srcChoice === "match" && src ? src.split(",") : []);
    const key = [this.srcChoice, this.srcIsGroup ? "" : src, this.srcChoice === "match" ? this.srcPattern : "", this.tgtChoice, tgt, this.tgtChoice === "match" ? this.pattern : ""].join("\u0001");
    if (key === this.dataKey) return;
    this.dataKey = key;
    this.tgtIp = tgt;
    this.matcher = compileMatcher(this.pattern);
    this.reset();
    if (this.running) void this.poll();
  }

  /** What the source pick means, for the HUD. */
  private sourceLabel(): string {
    switch (this.srcChoice) {
      case "any": return "every device";
      case "internet": return "internet hosts";
      case "lan": return "LAN devices";
      case "match": {
        const parts = this.srcPattern.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
        return parts.length ? `devices matching ${parts.map(rText).join(", ")}` : "matching nothing · type a pattern";
      }
      default: return this.srcIp ? this.nameOf(this.srcIp) : "waiting for a snapshot…";
    }
  }

  /** Whether a (resolved) peer of the source passes the target pick. */
  private peerOk(peer: string): boolean {
    switch (this.tgtChoice) {
      case "any": return true;
      case "internet": return this.deviceAt(peer)?.role === "internet";
      case "lan": return this.deviceAt(peer)?.role !== "internet"; // the local segment, multicast / broadcast included
      case "match": return this.matcher(this.deviceAt(peer), peer);
      default: return peer === this.tgtIp;
    }
  }

  /** What the target pick means, for the HUD. */
  private targetLabel(): string {
    switch (this.tgtChoice) {
      case "any": return "any peer";
      case "internet": return "internet";
      case "lan": return "LAN";
      case "match": {
        const parts = this.pattern.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
        return parts.length ? `matching ${parts.map(rText).join(", ")}` : "matching nothing · type a pattern";
      }
      default: return this.nameOf(this.tgtChoice);
    }
  }

  private reset(): void {
    this.balls = [];
    this.rings = [];
    this.misses = [];
    this.sources.clear();
    this.lanes.clear();
    this.pending.clear();
    this.stats = { hits: 0, misses: 0, other: 0, pps: 0 };
    this.lastT = 0;
    this.paddle = { y: -1, vy: 0, glow: 0 };
    this.laneOverflow = 0;
    this.inflight = false;
    this.gen++;
  }

  /**
   * Source menu: gateway, this host, then every online LAN / local device by name (plus the current pick if it is
   * something else). Target menu: the groups, then the source's busiest peers by name.
   */
  private rebuildOptions(force = false): void {
    const m = this.msg;
    if (!m) return;
    const label = (ip: string) => { const d = m.devices.find((x) => x.ip === ip); const n = d ? displayName(d) : ip; return n === ip ? rIp(ip) : rName(n); };
    const sig = (opts: SelectOption[]) => opts.map((o) => `${o.value}\u0001${o.label}\u0001${o.hint}`).join("\u0002");

    if (!this.sourceSel.isOpen || force) {
      const devs = m.devices
        .filter((d) => (d.role === "lan" || d.role === "local") && d.online && d.ip !== m.gateway && d.ip !== m.local_ip)
        .sort((a, b) => displayName(a).localeCompare(displayName(b)));
      const opts: SelectOption[] = [
        ...this.groupOptions("source"),
        { value: "gateway", label: "gateway", hint: label(m.gateway) },
        { value: "self", label: "this host", hint: label(m.local_ip) },
        ...devs.map((d) => ({ value: d.ip, label: label(d.ip), hint: rIp(d.ip) })),
      ];
      if (!opts.some((o) => o.value === this.srcChoice)) {
        opts.push({ value: this.srcChoice, label: label(this.srcChoice), hint: rIp(this.srcChoice) });
      }
      const s = sig(opts);
      if (s !== this.srcSig) { this.srcSig = s; this.sourceSel.setOptions(opts); }
      this.sourceSel.value = this.srcChoice;
    }

    if (!this.targetSel.isOpen || force) {
      // peers: the other end of every flow that has exactly one end in the source
      const src = this.srcIsGroup ? "" : this.resolveSource();
      const mine = (ip: string) => (src ? ip === src : this.inSource(ip));
      const bytes = new Map<string, number>();
      for (const f of m.flows) {
        const a = mine(f.a), b = mine(f.b);
        const peer = a && !b ? f.b : b && !a ? f.a : null;
        if (peer) bytes.set(peer, (bytes.get(peer) ?? 0) + f.bytes);
      }
      const peers = [...bytes].sort((a, b) => b[1] - a[1]).slice(0, MAX_PEER_OPTS).map(([ip]) => ip);
      const peerOpt = (ip: string): SelectOption => {
        const d = m.devices.find((x) => x.ip === ip);
        return { value: ip, label: label(ip), hint: `${rIp(ip)}${d ? ` · ${d.role}` : ""}` };
      };
      const opts: SelectOption[] = [...this.groupOptions(), ...peers.map(peerOpt)];
      if (!isGroup(this.tgtChoice) && !opts.some((o) => o.value === this.tgtChoice)) opts.push(peerOpt(this.tgtChoice));
      const s = sig(opts);
      if (s !== this.tgtSig) { this.tgtSig = s; this.targetSel.setOptions(opts); }
      this.targetSel.value = this.tgtChoice;
    }
  }

  /** The group entries both menus start with; the hints read from the source's or the target's point of view. */
  private groupOptions(kind: "source" | "target" = "target"): SelectOption[] {
    const t = kind === "target";
    return [
      { value: "any", label: "any", hint: t ? "every peer of the source" : "every device on the network" },
      { value: "internet", label: "internet", hint: t ? "peers off the local network" : "every internet host" },
      { value: "lan", label: "LAN", hint: t ? "peers on the local segment" : "this host, the gateway, LAN and local devices" },
      { value: "match", label: "matcher…", hint: "name glob, CIDR or prefix" },
    ];
  }

  private get speed(): number { return Number(this.speedSel.value) || 1; }

  private deviceAt(ip: string): Device | undefined { return this.scene.deviceOf(ip) ?? this.msg?.devices.find((d) => d.ip === ip); }

  /** the source device for a single-host source; undefined for a group */
  private sourceDevice(): Device | undefined { return this.srcIsGroup ? undefined : this.deviceAt(this.srcIp); }

  private sourceColor(): string {
    switch (this.srcChoice) {
      case "any": return css(this.theme.roles.self);
      case "internet": return css(this.theme.roles.internet);
      case "lan": return css(this.theme.roles.lan);
      case "match": return css(this.theme.roles.local);
      default: return css(this.theme.roles[this.sourceDevice()?.role ?? "lan"]);
    }
  }

  private nameOf(ip: string): string {
    const d = this.scene.deviceOf(ip);
    const n = d ? displayName(d) : ip;
    return n === ip ? rIp(ip) : rName(n);
  }

  // ------------------------------------------------------------------ data

  private async poll(): Promise<void> {
    if (!this.running || !this.srcIp || this.inflight) return;
    this.inflight = true;
    const gen = this.gen;
    try {
      const ids = this.srcIsGroup ? this.srcIp : idsOf(this.sourceDevice(), this.srcIp);
      let url = `/api/traffic?ip=${encodeURIComponent(ids)}`;
      // one host as the target: let the server scope to that conversation (deeper per-conversation history)
      if (this.tgtIp) url += `&peer=${encodeURIComponent(idsOf(this.deviceAt(this.tgtIp), this.tgtIp))}`;
      // after the first poll only ask for what is new: cheap for the server even when the source is every device
      if (this.lastT) url += `&since=${this.lastT}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const m = (await r.json()) as TrafficMsg;
      if (gen === this.gen) this.ingest(m); // source / target changed meanwhile: this is the old run's traffic
    } catch {
      // server away; the next tick retries
    } finally {
      if (gen === this.gen) this.inflight = false;
    }
  }

  private ingest(m: TrafficMsg): void {
    const pk = m.packets.slice().reverse(); // oldest first
    if (!pk.length) return;
    const newest = pk[pk.length - 1][0];
    if (this.lastT === 0) this.lastT = newest - REPLAY_S;
    // "merge names" folds the addresses behind one name into one row; the target pick then narrows the peers.
    // A group source sees a packet between two of its members twice (once from each member's ring): keep the copy
    // whose peer passes the target pick, and the outbound one when both do.
    const group = this.srcIsGroup;
    const fresh = pk
      .filter((p) => p[0] > this.lastT)
      .map((p) => [p, this.scene.resolve(p[2]), group ? this.scene.resolve(p[9] ?? this.srcIp) : this.srcIp] as const)
      .filter(([p, peer, me]) => {
        if (!this.peerOk(peer)) return false;
        return !(group && this.inSource(peer) && this.peerOk(me) && p[1] === "in");
      });
    this.lastT = newest;
    this.stats.pps = this.stats.pps * 0.6 + (fresh.length / (POLL_MS / 1000)) * 0.4;
    if (!fresh.length) return;

    // pair requests with the answers that follow them; whatever answers nothing is drawn as a faint ball back
    const spawns: Spawn[] = [];
    for (const [[t, dir, , proto, tag, size, , info, ports], peer, me] of fresh) {
      const laneKey = tag || proto || "?";
      const role = portRole(proto, tag, ports);
      // a member's own ports get their own lanes when the source is a group ("nas :445", not just ":445")
      const memberLane = group;
      // server side: the peer asks the source (lane = the source's port); client side: the source asks the peer
      const spawn = (side: Side, kind: Kind, recs: Rec[]) => spawns.push({
        side, kind, t, bytes: size, count: 1, recs, info,
        src: side === "server" ? peer : me,
        laneHost: side === "server" ? me : peer,
        laneKey: side === "server" ? (memberLane ? `${me}|${laneKey}` : laneKey) : `${peer}|${laneKey}`,
        label: side === "server" && !memberLane ? laneLabel(tag, proto) : `${this.nameOf(side === "server" ? me : peer)} ${tag ? `:${tag.split("/")[1]}` : `· ${proto || "?"}`}`,
      });
      // a conversation inside the group is seen from whichever member's ring survived above, so key it by the pair
      const pendingKey = (side: Side) => (group && this.inSource(peer) ? `${[me, peer].sort().join("|")}|${laneKey}` : `${side}|${me}|${peer}|${laneKey}`);
      const answer = (side: Side): boolean => {
        const rec = this.pending.get(pendingKey(side))?.find((x) => !x.answered && t >= x.t - 0.01 && t - x.t <= REPLY_WINDOW_S);
        if (rec) rec.answered = true;
        return !!rec;
      };
      const request = (side: Side) => {
        const rec: Rec = { t, answered: noReplyExpected(side === "server" ? me : peer) }; // multicast / broadcast: nobody owes an answer
        const key = pendingKey(side);
        (this.pending.get(key) ?? this.pending.set(key, []).get(key)!).push(rec);
        spawn(side, "request", [rec]);
      };
      if (role === "request" && isExchangeStart(proto, info)) request(dir === "in" ? "server" : "client");
      else if (role === "answer") { const side: Side = dir === "in" ? "client" : "server"; if (!answer(side)) spawn(side, "other", []); }
      else if (role === "request") spawn(dir === "in" ? "server" : "client", "other", []);
      else {
        // no ports or the same port both ways: the first packet is the request, the one back is the answer
        const answers: Side = dir === "in" ? "client" : "server";
        if (!answer(answers)) {
          if (isExchangeStart(proto, info)) request(dir === "in" ? "server" : "client");
          else spawn(dir === "in" ? "server" : "client", "other", []);
        }
      }
    }
    for (const [k, list] of this.pending) {
      const keep = list.filter((x) => newest - x.t < REPLY_WINDOW_S * 4);
      if (keep.length) this.pending.set(k, keep); else this.pending.delete(k);
    }

    let list = spawns;
    if (list.length > MAX_BALLS_PER_POLL) {
      const grouped = new Map<string, Spawn>();
      for (const s of list) {
        const k = `${s.kind}|${s.src}|${s.laneKey}`;
        const e = grouped.get(k);
        if (e) { e.bytes += s.bytes; e.count += s.count; e.recs.push(...s.recs); } else grouped.set(k, { ...s, recs: [...s.recs] });
      }
      list = [...grouped.values()];
      if (list.length > MAX_BALLS_PER_POLL) list = list.sort((a, b) => b.bytes - a.bytes).slice(0, MAX_BALLS_PER_POLL);
      list.sort((a, b) => a.t - b.t);
    }

    const now = performance.now() / 1000;
    const first = fresh[0][0][0];
    this.fit();
    this.layout(); // slot capacity comes from the geometry; before the first frame it is still the placeholder
    const sourceColor = this.sourceColor();
    // one source device wears the paddle's colour; the members of a group source are told apart by their own
    const colorOf = (host: string) => (!group && host === this.srcIp ? sourceColor : css(hashColor(host)));
    const dur = FLIGHT_S / this.speed;
    for (const s of list) {
      const src = this.sources.get(s.src, now, colorOf(s.src), this.geom.maxLeft);
      src.count += s.count; src.bytes += s.bytes;
      const lane = this.lanes.get(s.laneKey, now, colorOf(s.laneHost), this.geom.maxRight);
      lane.label = s.label; lane.host = s.laneHost; lane.owner = !group && s.laneHost === this.srcIp ? "source" : "peer";
      lane.count += s.count; lane.bytes += s.bytes;
      if (s.kind === "request") lane.vol += s.count;
      // keep the wire's rhythm: spawn spread over the next second in the order (and spacing) the packets arrived
      const delay = Math.min(REPLAY_S, Math.max(0, s.t - first));
      this.balls.push({
        kind: s.kind, recs: s.recs, src, lane, t0: now + delay, dur, r: radius(s.bytes), count: s.count, wall: s.t, info: s.info,
        color: s.kind === "other" ? lane.color : src.color, phase: "fly", x: 0, y: 0, vx: 0, vy: 0, age: 0,
      });
    }
  }

  // ------------------------------------------------------------------ frame

  private fit(): void {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const dpr = devicePxRatioNumber(devicePxRatioFromWindow());
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Geometry and row positions. `dt` drives the lanes' glide; 0 (from ingest) places new lanes straight at their rank. */
  private layout(dt = 0): void {
    const barH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 76;
    const top = barH + 16, bottom = this.H - BOTTOM - LOG_H; // the failed-request log sits between the play area and the footer
    const avail = Math.max(ROW_H * 2, bottom - top);
    this.geom = {
      top, bottom,
      xL: LEFT_W, xP: this.W - RIGHT_W - 28,
      maxLeft: Math.max(1, Math.floor((avail - CAPTION_H) / ROW_H)),
      maxRight: Math.max(1, Math.floor((avail - CAPTION_H - HUD_H) / ROW_H)),
    };
    this.sources.layout(top + CAPTION_H, this.geom.maxLeft);
    this.layoutLanes(top + CAPTION_H + HUD_H, this.geom.maxRight, dt);
  }

  /**
   * Destinations sit in request-volume order, busiest on top, and glide to a new rank when the order changes.
   * Volume decays so the ranking follows what is busy now, not what was busy an hour ago; ties keep arrival order.
   * Lanes past the visible capacity share the last line (drawn as "… N more").
   */
  private layoutLanes(top: number, max: number, dt: number): void {
    const decay = dt > 0 ? Math.exp(-dt / VOL_DECAY_S) : 1;
    const ranked = [...this.lanes.rows.values()].sort((a, b) => b.vol - a.vol || a.slot - b.slot);
    this.laneOverflow = Math.max(0, ranked.length - (max - 1));
    if (this.laneOverflow === 1) this.laneOverflow = 0; // one lane on the last line is just a lane
    const k = dt > 0 ? Math.min(1, dt / LANE_MOVE_S) : 1;
    ranked.forEach((l, i) => {
      l.vol *= decay;
      l.rank = i;
      const y = top + Math.min(i, Math.max(0, max - 1)) * ROW_H + ROW_H / 2;
      l.y = l.y === 0 ? y : l.y + (y - l.y) * k; // a lane on its first frame appears in place
    });
  }

  /** Whether a lane is one of the "… N more" squeezed onto the shared last line. */
  private isOverflow(l: Lane): boolean { return this.laneOverflow > 0 && l.rank >= this.geom.maxRight - 1; }

  private frame = (ts: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    markFrame(ts);
    this.paneFps.tick(ts);
    const now = ts / 1000;
    const dt = Math.min(0.05, this.lastFrame ? now - this.lastFrame : 0.016);
    this.lastFrame = now;
    this.fit();
    if (!this.W || !this.H) return;
    this.layout(dt);
    const inUse = (r: Row) => this.balls.some((b) => b.src === r || b.lane === r);
    this.sources.expire(now, inUse);
    this.lanes.expire(now, inUse);
    this.step(now, dt);
    this.look.frame(this.scene, this.theme, dt, now);

    const g = this.g;
    g.clearRect(0, 0, this.W, this.H);
    this.drawColumns(now);
    this.drawPaddle();
    this.drawBalls(now);
    this.drawRings(now);
    this.drawHud(now);
    this.drawLog(now);
    if (this.picture.sample(g, this.canvas)) this.paneFps.mark(ts);
  };

  private step(now: number, dt: number): void {
    const { xP, xL, top, bottom } = this.geom;
    if (this.paddle.y < 0) this.paddle.y = (top + bottom) / 2;

    for (const b of this.balls) {
      if (b.phase === "fly") {
        const p = (now - b.t0) / b.dur;
        if (p < 0) continue;
        // requests fly asker → lane; stray answers flow back lane → asker
        const [x0, y0, x1, y1] = b.kind === "request" ? [xL, b.src.y, xP, b.lane.y] : [xP, b.lane.y, xL, b.src.y];
        b.vx = (x1 - x0) / b.dur; b.vy = (y1 - y0) / b.dur;
        b.x = x0 + (x1 - x0) * Math.min(1, p); b.y = y0 + (y1 - y0) * Math.min(1, p);
        if (p < 1) continue;
        b.age = 0;
        if (b.kind === "other") { b.phase = "pop"; this.stats.other += b.count; continue; }
        if (b.recs.some((r) => r.answered)) {
          b.phase = "bounce";
          // the paddle returns every answered request: it should already be here, but never let one slip past it
          if (Math.abs(b.y - this.paddle.y) > PADDLE_H / 2) this.paddle.y = b.y;
          const off = Math.max(-1, Math.min(1, (b.y - this.paddle.y) / (PADDLE_H / 2)));
          b.vx = -Math.abs(b.vx) * 0.9; b.vy = off * 260;
          this.paddle.glow = 1;
          this.rings.push({ x: xP, y: b.y, t0: now, color: b.color });
          b.lane.hits += b.count; this.stats.hits += b.count;
        } else {
          b.phase = "miss";
          b.lane.misses += b.count; this.stats.misses += b.count;
          b.lane.flash = now;
          this.logMiss(b, now);
        }
      } else {
        b.age += dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.phase === "bounce") b.vy += 320 * dt;
      }
    }
    this.balls = this.balls.filter((b) =>
      b.phase === "fly" || (b.phase === "bounce" && b.age < 0.8) || (b.phase === "pop" && b.age < 0.35)
      || (b.phase === "miss" && b.age < 4 && b.x < this.W + 30));
    this.rings = this.rings.filter((r) => now - r.t0 < 0.5);
    this.misses = this.misses.filter((m) => now - m.t < LOG_TTL_S);

    // the paddle goes for the answered request that lands next, planning to be there with time to spare: it
    // covers the gap at whatever speed that takes (a dart when two lanes answer back to back)
    let next: Ball | null = null, remaining = Infinity;
    for (const b of this.balls) {
      if (b.kind !== "request" || b.phase !== "fly" || !b.recs.some((r) => r.answered)) continue;
      const rem = b.t0 + b.dur - now;
      if (rem < remaining) { remaining = rem; next = b; }
    }
    const before = this.paddle.y;
    if (next) {
      const gap = next.lane.y - this.paddle.y;
      const budget = Math.max(dt, remaining * PADDLE_MARGIN);
      this.paddle.y += Math.abs(gap) <= 0.5 ? gap : gap * Math.min(1, dt / budget);
    }
    this.paddle.y = Math.max(top + PADDLE_H / 2, Math.min(bottom - PADDLE_H / 2, this.paddle.y));
    this.paddle.vy = dt > 0 ? (this.paddle.y - before) / dt : 0;
    this.paddle.glow = Math.max(0, this.paddle.glow - dt * 3);

    // hover over a source row or a peer-served lane (click makes that host the source or the target)
    this.hover = null;
    if (this.pointer.x >= 0 && this.pointer.x < xL - 8) {
      for (const r of this.sources.rows.values()) if (r.id !== this.srcIp && Math.abs(this.pointer.y - r.y) < ROW_H / 2) { this.hover = { host: r.id, row: r }; break; }
    } else if (this.pointer.x > xP + 8) {
      for (const l of this.lanes.rows.values()) if (l.owner === "peer" && !this.isOverflow(l) && Math.abs(this.pointer.y - l.y) < ROW_H / 2) { this.hover = { host: l.host, row: l }; break; }
    }
    this.canvas.style.cursor = this.hover ? "pointer" : "";
  }

  /** Add a failed request to the log; the same asker → lane failing again refreshes its line and bumps the count. */
  private logMiss(b: Ball, now: number): void {
    const key = `${b.src.id}|${b.lane.id}`;
    const cur = this.misses.find((m) => m.key === key);
    if (cur) {
      cur.t = now; cur.wall = b.wall; cur.count += b.count; cur.info = b.info || cur.info;
      this.misses.splice(this.misses.indexOf(cur), 1);
      this.misses.unshift(cur);
      return;
    }
    this.misses.unshift({ key, t: now, wall: b.wall, count: b.count, color: b.src.color, who: b.src.id, what: b.lane.label, info: b.info });
    if (this.misses.length > LOG_ROWS * 2) this.misses.length = LOG_ROWS * 2;
  }

  // ------------------------------------------------------------------ drawing

  /** Failed requests, newest first, in the strip above the footer; each line fades out over its last seconds. */
  private drawLog(now: number): void {
    const g = this.g, u = this.theme.ui, { bottom } = this.geom;
    const x = 16, w = this.W - 30;
    g.textAlign = "left"; g.textBaseline = "middle";
    g.strokeStyle = u.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, bottom + 6); g.lineTo(this.W - 14, bottom + 6); g.stroke();
    g.font = `10px ${this.font}`; g.fillStyle = u.muted;
    g.fillText("FAILED REQUESTS", x, bottom + 6 + CAPTION_H / 2 + 2);
    if (!this.misses.length) {
      g.font = `11px ${this.font}`; g.globalAlpha = 0.6;
      g.fillText("none in the last few seconds", x, bottom + 6 + CAPTION_H + LOG_ROW_H / 2);
      g.globalAlpha = 1;
      return;
    }
    const time = (wall: number) => {
      const d = new Date(wall * 1000), p = (n: number) => String(n).padStart(2, "0");
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    this.misses.slice(0, LOG_ROWS).forEach((m, i) => {
      const y = bottom + 6 + CAPTION_H + i * LOG_ROW_H + LOG_ROW_H / 2;
      const age = now - m.t;
      g.globalAlpha = Math.max(0, Math.min(1, (LOG_TTL_S - age) / LOG_FADE_S));
      // ✕ marker, time, asker → lane, then the packet's info and the reason, muted
      g.fillStyle = MISS_RED; g.font = `11px ${this.font}`;
      g.fillText("✕", x, y);
      g.fillStyle = u.muted; g.font = `11px ${this.font}`;
      g.fillText(time(m.wall), x + 14, y);
      let cx = x + 14 + g.measureText("00:00:00").width + 10;
      g.fillStyle = m.color; g.beginPath(); g.arc(cx + 3, y, 3, 0, Math.PI * 2); g.fill();
      cx += 12;
      g.fillStyle = u.fg; g.font = `12px ${this.font}`;
      const head = `${this.nameOf(m.who)} → ${m.what}`;
      const tail = `${m.info ? `${rText(m.info)} · ` : ""}no answer within ${REPLY_WINDOW_S} s${m.count > 1 ? ` · ×${m.count}` : ""}`;
      const headShown = fitText(g, head, Math.min(w * 0.45, x + w - cx));
      g.fillText(headShown, cx, y);
      cx += g.measureText(headShown).width + 10;
      g.fillStyle = u.muted; g.font = `11px ${this.font}`;
      if (x + w - cx > 40) g.fillText(fitText(g, tail, x + w - cx), cx, y);
    });
    g.globalAlpha = 1;
  }

  private drawColumns(now: number): void {
    const g = this.g, u = this.theme.ui, { xL, xP, top, bottom } = this.geom;
    g.textBaseline = "middle";

    g.strokeStyle = u.line; g.lineWidth = 1; g.setLineDash([2, 5]);
    g.beginPath(); g.moveTo(xL - 8, top); g.lineTo(xL - 8, bottom); g.stroke();
    g.setLineDash([]);

    // sources: whoever asks
    g.font = `10px ${this.font}`; g.fillStyle = u.muted; g.textAlign = "left";
    g.fillText("SOURCES", 16, top + 8);
    const shared = new Map<number, number>();
    for (const r of this.sources.rows.values()) shared.set(r.slot, (shared.get(r.slot) ?? 0) + 1);
    let overflowDrawn = false;
    for (const r of [...this.sources.rows.values()].sort((a, b) => a.slot - b.slot)) {
      const overflow = r.slot >= this.geom.maxLeft - 1 && (shared.get(r.slot) ?? 0) > 1;
      if (overflow) {
        if (overflowDrawn) continue;
        overflowDrawn = true;
        g.font = `12px ${this.font}`; g.fillStyle = u.muted;
        g.fillText(`… ${shared.get(r.slot)} more hosts`, 16, r.y);
        continue;
      }
      const hovered = this.hover?.row === r;
      g.globalAlpha = fade(now, r.last);
      if (hovered) { g.fillStyle = u.chipHover; roundRect(g, 8, r.y - ROW_H / 2 + 1, xL - 20, ROW_H - 2, 5); g.fill(); }
      g.fillStyle = r.color; g.beginPath(); g.arc(20, r.y, 3.5, 0, Math.PI * 2); g.fill();
      // name, then the address small and muted when it fits
      const name = this.nameOf(r.id), ip = rIp(r.id);
      const maxW = xL - 16 - 30;
      g.font = `12px ${this.font}`; g.fillStyle = hovered ? u.accent : r.id === this.srcIp ? r.color : u.fg;
      const shown = fitText(g, name, maxW);
      const shownW = g.measureText(shown).width;
      g.fillText(shown, 30, r.y);
      if (name !== ip) {
        g.font = `10px ${this.font}`; g.fillStyle = u.muted;
        if (shownW + 6 + g.measureText(ip).width <= maxW) g.fillText(ip, 30 + shownW + 6, r.y);
      }
      g.globalAlpha = 1;
    }

    // destinations: what they ask for, with the running hit / miss tally
    g.font = `10px ${this.font}`; g.fillStyle = u.muted; g.textAlign = "left";
    g.fillText("DESTINATIONS", xP + 18, top + HUD_H + 8);
    let laneOverflowDrawn = false;
    for (const l of [...this.lanes.rows.values()].sort((a, b) => a.rank - b.rank)) {
      if (this.isOverflow(l)) {
        if (laneOverflowDrawn) continue;
        laneOverflowDrawn = true;
        g.font = `12px ${this.font}`; g.fillStyle = u.muted;
        g.fillText(`… ${this.laneOverflow} more`, xP + 30, l.y);
        continue;
      }
      const hovered = this.hover?.row === l;
      g.globalAlpha = fade(now, l.last);
      if (hovered) { g.fillStyle = u.chipHover; roundRect(g, xP + 10, l.y - ROW_H / 2 + 1, this.W - xP - 18, ROW_H - 2, 5); g.fill(); }
      const flashing = now - l.flash < 0.6;
      g.fillStyle = l.color; g.beginPath(); g.arc(xP + 20, l.y, 3.5, 0, Math.PI * 2); g.fill();
      g.font = `12px ${this.font}`; g.fillStyle = hovered ? u.accent : flashing ? MISS_RED : u.fg;
      g.fillText(fitText(g, l.label, RIGHT_W - 92), xP + 30, l.y);
      g.font = `10.5px ${this.font}`; g.fillStyle = u.muted; g.textAlign = "right";
      g.fillText(`${l.hits}↩ ${l.misses}✕`, this.W - 14, l.y);
      g.textAlign = "left";
      g.globalAlpha = 1;
    }
  }

  private drawPaddle(): void {
    const g = this.g, u = this.theme.ui, { xP, top, bottom } = this.geom;
    g.strokeStyle = u.line; g.lineWidth = 1; g.setLineDash([3, 6]);
    g.beginPath(); g.moveTo(xP, top); g.lineTo(xP, bottom); g.stroke();
    g.setLineDash([]);
    const color = this.sourceColor();
    const { y, vy } = this.paddle;
    // motion trail: a fading smear behind a fast-moving paddle, so a dart between lanes reads as movement
    const trail = Math.min(PADDLE_H * 2.5, Math.abs(vy) * 0.08);
    if (trail > 4) {
      const back = y - Math.sign(vy) * trail;
      const grad = g.createLinearGradient(0, y, 0, back);
      grad.addColorStop(0, color); grad.addColorStop(1, "transparent");
      g.globalAlpha = 0.45; g.fillStyle = grad;
      roundRect(g, xP - PADDLE_W / 2 + 1, Math.min(y, back) - PADDLE_H / 2, PADDLE_W - 2, PADDLE_H + trail, 3); g.fill();
      g.globalAlpha = 1;
    }
    g.save();
    g.shadowColor = color; g.shadowBlur = 6 + 18 * this.paddle.glow;
    g.fillStyle = color;
    roundRect(g, xP - PADDLE_W / 2, y - PADDLE_H / 2, PADDLE_W, PADDLE_H, 3); g.fill();
    g.restore();
  }

  private drawBalls(now: number): void {
    const g = this.g;
    for (const b of this.balls) {
      if (b.phase === "fly" && now < b.t0) continue;
      let alpha = 1, r = b.r, color = b.color;
      if (b.phase === "bounce") alpha = 1 - b.age / 0.8;
      else if (b.phase === "pop") { alpha = 1 - b.age / 0.35; r = b.r * (1 + b.age * 4); }
      else if (b.phase === "miss") { color = MISS_RED; alpha = 0.9; }
      else if (b.kind === "other") alpha = 0.45;
      g.globalAlpha = Math.max(0, alpha);
      // short trail against the direction of travel
      g.strokeStyle = color; g.lineWidth = Math.max(1, r * 0.8); g.lineCap = "round";
      g.beginPath(); g.moveTo(b.x - b.vx * 0.06, b.y - b.vy * 0.06); g.lineTo(b.x, b.y); g.stroke();
      g.fillStyle = color;
      g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.fill();
      if (b.count >= 3 && b.phase === "fly") {
        g.font = `10px ${this.font}`; g.fillStyle = this.theme.ui.fg; g.textAlign = "left"; g.textBaseline = "middle";
        g.fillText(`×${b.count}`, b.x + r + 3, b.y - r);
      }
    }
    g.globalAlpha = 1;
    g.lineCap = "butt";
  }

  private drawRings(now: number): void {
    const g = this.g;
    for (const r of this.rings) {
      const p = (now - r.t0) / 0.5;
      g.globalAlpha = (1 - p) * 0.8;
      g.strokeStyle = r.color; g.lineWidth = 2;
      g.beginPath(); g.arc(r.x, r.y, 4 + p * 26, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
  }

  private drawHud(now: number): void {
    const g = this.g, u = this.theme.ui, { xP, top } = this.geom;
    const src = this.sourceDevice();
    const x = xP + 18, y = top + CAPTION_H;
    g.textAlign = "left"; g.textBaseline = "middle";
    g.font = `600 14px ${this.font}`; g.fillStyle = this.sourceColor();
    g.fillText(fitText(g, this.sourceLabel(), RIGHT_W - 10), x, y);
    g.font = `11px ${this.font}`; g.fillStyle = u.muted;
    let sub = "";
    if (this.srcIsGroup) { const n = this.sourceCount(); sub = `${n} device${n === 1 ? "" : "s"}${this.srcChoice === "match" && n >= MAX_MATCH_IPS ? ` · busiest ${MAX_MATCH_IPS}` : ""}`; }
    else if (this.srcIp) sub = `${rIp(this.srcIp)}${src ? ` · ${src.role}` : ""}${src?.members && src.members.length > 1 ? ` · ${src.members.length} addresses` : ""}`;
    g.fillText(fitText(g, sub, RIGHT_W - 10), x, y + 16);
    // the target pick, in the accent when it narrows the view
    g.fillStyle = this.tgtChoice === "any" ? u.muted : u.accent;
    g.fillText(fitText(g, `→ ${this.targetLabel()}`, RIGHT_W - 10), x, y + 31);
    const s = this.stats;
    g.fillStyle = u.muted;
    g.fillText(fitText(g, `${Math.round(s.pps)} pkt/s · ${s.hits} returned · ${s.misses} missed · ${s.other} other`, RIGHT_W - 10), x, y + 46);

    if (!this.balls.length && (this.srcIp || this.srcChoice === "match")) {
      const idle = !this.srcIp
        ? "no device matches the source pattern"
        : this.lastT
          ? `no packets between ${this.sourceLabel()} and ${this.targetLabel()} in the last few seconds`
          : "waiting for packets…";
      g.textAlign = "center"; g.font = `12px ${this.font}`; g.fillStyle = u.muted; g.globalAlpha = 0.6 + 0.3 * Math.sin(now * 2);
      g.fillText(idle, (this.geom.xL + xP) / 2, (this.geom.top + this.geom.bottom) / 2);
      g.globalAlpha = 1;
    }
  }
}

// -------------------------------------------------------------------- helpers
// (portRole, noReplyExpected, fitText and roundRect are shared with the other arcade views: see arcade.ts)

/** `tcp/443 · TLS`, `udp/5353 · discovery`, or the protocol column when there is no port (ARP, ICMP). */
function laneLabel(tag: string, proto: string): string {
  if (!tag) return proto || "unknown";
  const c = categorize([tag]);
  return `${tag} · ${c.id === "other" ? proto || "other" : c.short}`;
}

/** Ball radius from bytes: 64 B ≈ 4.5 px, a full frame ≈ 6.4, a coalesced burst tops out at 8. */
function radius(bytes: number): number {
  return 2.5 + 5.5 * Math.max(0, Math.min(1, Math.log10(1 + bytes) / 4.5));
}

function fade(now: number, last: number): number {
  return Math.max(0.25, Math.min(1, (ROW_TTL_S - (now - last)) / ROW_FADE_S));
}
