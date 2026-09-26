import type { NetScene } from "../graph/scene";
import { LookStage } from "../graph/look";
import { Select, type SelectOption } from "../ui/ui";
import { hashColor } from "../core/modes";
import { rIp, rName } from "../core/redact";
import { displayName, idsOf, type Device, type Packet, type Role, type StateMsg, type TrafficMsg } from "../core/types";
import { DEFAULT_THEME, type Theme } from "../core/themes";
import { markFrame, PaneFps } from "../core/fps";
import { CanvasChangeProbe } from "../graph/pane-change";
import { observeResize } from "../core/resize";
import { devicePxRatioNumber, layoutDevicePxRatio } from "../graph/render-host-device-px-ratio";

/**
 * Shared machinery for the arcade views (NetPong's siblings: Invaders, Command, Frogger). Each is a standalone
 * mode with its own 2D canvas fed by /api/traffic, polled once a second with a `since` cursor so only the new
 * packets travel; the packets of one poll are then animated with their real relative timing over the next
 * second, so the rhythm on screen is the rhythm on the wire.
 *
 * ArcadeView owns the canvas, the frame loop, the poll loop, the theme and the pointer; a game implements
 * `query` (what to poll), `ingest` (turn the new packets into things on screen), `step` and `draw`.
 * DevicePicker is the "whose traffic" selector the three games share: the LAN as a group, or one device.
 * FadeLog is the strip of fading event lines above the footer (Pong's failed-request log, generalised).
 */

export const POLL_MS = 1000;
export const REPLAY_S = 3;            // history replayed on (re)start so the view is not empty at first
export const ROW_TTL_S = 30;          // things fade out this long after their last packet
export const ROW_FADE_S = 5;
export const BOTTOM = 84;             // room for the footer legend
export const MISS_RED = "#ef5350";
export const OK_GREEN = "#66bb6a";

export const css = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

/** known devices: the ones that can be "ours" */
export const isKnown = (d: Device | undefined): boolean => !!d && (d.role === "lan" || d.role === "local" || d.role === "gateway" || d.role === "self");

/** multicast, broadcast and link-local-all-nodes addresses: a question to them is not owed an answer */
export function noReplyExpected(ip: string): boolean {
  return /^(22[4-9]|23\d)\./.test(ip) || ip === "255.255.255.255" || ip.endsWith(".255") || /^ff[0-9a-f]{2}:/i.test(ip);
}

/**
 * Who asked, from the real ports. The end holding the service port (`tcp/443` → 443) is the server: a packet
 * *to* that port is a request, a packet *from* it an answer. No ports, or the same port both ways (mDNS 5353↔5353,
 * NBNS 137↔137), is ambiguous; so is ICMP.
 */
export function portRole(proto: string, tag: string, ports: string): "request" | "answer" | "ambiguous" {
  if (!tag || !ports || /^icmp/i.test(proto)) return "ambiguous";
  const svc = Number(tag.split("/")[1]);
  const [sp, dp] = ports.split("→").map(Number);
  if (!Number.isFinite(sp) || !Number.isFinite(dp) || sp === dp) return "ambiguous";
  if (dp === svc) return "request";
  if (sp === svc) return "answer";
  return "ambiguous";
}

/** TLS Application Data, TCP keep-alives and ACK-only packets are not a new request/exchange. */
export function isExchangeStart(_proto: string, info: string): boolean {
  if (/Application Data|Continuation Data/i.test(info)) return false;
  if (/Keep-Alive/i.test(info)) return false;
  if (/\[ACK\]/.test(info) && !/\[(SYN|FIN|RST|PSH)/.test(info)) return false;
  return true;
}

/** Radius / thickness from bytes: 64 B ≈ 3, a full frame ≈ 6.4, a coalesced burst tops out at 8. */
export function sizeOf(bytes: number): number {
  return 2.5 + 5.5 * Math.max(0, Math.min(1, Math.log10(1 + bytes) / 4.5));
}

export function fade(now: number, last: number, ttl = ROW_TTL_S, over = ROW_FADE_S): number {
  return Math.max(0.25, Math.min(1, (ttl - (now - last)) / over));
}

export function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

export function fitText(g: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (g.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(s.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo) + "…";
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Draw a pixel sprite: rows of `#` / `.`, `px` screen pixels per cell, centred on (cx, cy). */
export function sprite(g: CanvasRenderingContext2D, rows: string[], cx: number, cy: number, px: number, color: string): void {
  const w = rows[0].length * px, h = rows.length * px;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  g.fillStyle = color;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      if (row[c] !== "#") { c++; continue; }
      let e = c;
      while (e < row.length && row[e] === "#") e++;
      g.fillRect(x0 + c * px, y0 + r * px, (e - c) * px, px);
      c = e;
    }
  }
}

export function hms(wall: number): string {
  const d = new Date(wall * 1000), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** An expanding ring (a hit, an interception, a splash). */
export interface Ring { x: number; y: number; t0: number; color: string; r0?: number; r1?: number; dur?: number; width?: number }
export function drawRings(g: CanvasRenderingContext2D, rings: Ring[], now: number): Ring[] {
  const keep: Ring[] = [];
  for (const r of rings) {
    const dur = r.dur ?? 0.5, p = (now - r.t0) / dur;
    if (p >= 1) continue;
    keep.push(r);
    if (p < 0) continue;
    g.globalAlpha = (1 - p) * 0.85;
    g.strokeStyle = r.color; g.lineWidth = r.width ?? 2;
    g.beginPath(); g.arc(r.x, r.y, (r.r0 ?? 4) + p * ((r.r1 ?? 30) - (r.r0 ?? 4)), 0, Math.PI * 2); g.stroke();
  }
  g.globalAlpha = 1;
  return keep;
}

// ------------------------------------------------------------------ fading event log

export interface LogLine {
  /** repeats of the same key fold into one line with a count */
  key: string;
  /** animation-clock time of the (latest) event */
  t: number;
  /** wall-clock time of the packet */
  wall: number;
  count: number;
  /** marker glyph and its colour (✕ red for a failure, ↯ for a hit …) */
  mark: string;
  markColor: string;
  /** dot colour (who) */
  color: string;
  head: string;
  tail: string;
}

export const LOG_ROW_H = 17;
export const CAPTION_H = 26;
const LOG_TTL_S = 12;
const LOG_FADE_S = 4;

export class FadeLog {
  lines: LogLine[] = [];
  constructor(readonly rows: number, readonly caption: string, readonly empty: string) {}

  /** height the strip needs, rule included */
  get height(): number { return 6 + CAPTION_H + this.rows * LOG_ROW_H + 12; }

  push(l: Omit<LogLine, "count">): void {
    const cur = this.lines.find((m) => m.key === l.key);
    if (cur) {
      cur.t = l.t; cur.wall = l.wall; cur.count++; cur.tail = l.tail || cur.tail; cur.head = l.head;
      this.lines.splice(this.lines.indexOf(cur), 1);
      this.lines.unshift(cur);
      return;
    }
    this.lines.unshift({ ...l, count: 1 });
    if (this.lines.length > this.rows * 2) this.lines.length = this.rows * 2;
  }

  expire(now: number): void { this.lines = this.lines.filter((m) => now - m.t < LOG_TTL_S); }
  clear(): void { this.lines = []; }

  draw(g: CanvasRenderingContext2D, u: Theme["ui"], font: string, x: number, top: number, w: number, now: number): void {
    g.textAlign = "left"; g.textBaseline = "middle";
    g.strokeStyle = u.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, top + 6); g.lineTo(x + w, top + 6); g.stroke();
    g.font = `10px ${font}`; g.fillStyle = u.muted;
    g.fillText(this.caption, x, top + 6 + CAPTION_H / 2 + 2);
    if (!this.lines.length) {
      g.font = `11px ${font}`; g.globalAlpha = 0.6;
      g.fillText(this.empty, x, top + 6 + CAPTION_H + LOG_ROW_H / 2);
      g.globalAlpha = 1;
      return;
    }
    this.lines.slice(0, this.rows).forEach((m, i) => {
      const y = top + 6 + CAPTION_H + i * LOG_ROW_H + LOG_ROW_H / 2;
      g.globalAlpha = Math.max(0, Math.min(1, (LOG_TTL_S - (now - m.t)) / LOG_FADE_S));
      g.fillStyle = m.markColor; g.font = `11px ${font}`;
      g.fillText(m.mark, x, y);
      g.fillStyle = u.muted;
      g.fillText(hms(m.wall), x + 14, y);
      let cx = x + 14 + g.measureText("00:00:00").width + 10;
      g.fillStyle = m.color; g.beginPath(); g.arc(cx + 3, y, 3, 0, Math.PI * 2); g.fill();
      cx += 12;
      g.fillStyle = u.fg; g.font = `12px ${font}`;
      const head = fitText(g, m.head, Math.min(w * 0.45, x + w - cx));
      g.fillText(head, cx, y);
      cx += g.measureText(head).width + 10;
      g.fillStyle = u.muted; g.font = `11px ${font}`;
      const tail = `${m.tail}${m.count > 1 ? ` · ×${m.count}` : ""}`;
      if (x + w - cx > 40) g.fillText(fitText(g, tail, x + w - cx), cx, y);
    });
    g.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ "whose traffic" picker

export interface DevicePickerConfig {
  id: string;
  caption: string;
  title: string;
  /** localStorage key */
  key: string;
  /** label and hint of the group entry */
  group: { label: string; hint: string };
  onChange: (choice: string) => void;
}

/**
 * The LAN as a group (`lan`: this host, the gateway, LAN and local devices) or one known device (`gateway`,
 * `self`, or an address). `token()` is what /api/traffic is polled for; `has()` tells whether an address is ours.
 */
export class DevicePicker {
  readonly sel: Select;
  choice: string;
  private sig = "";
  private msg: StateMsg | null = null;

  constructor(private readonly cfg: DevicePickerConfig, private readonly scene: NetScene) {
    this.choice = localStorage.getItem(cfg.key) ?? "lan";
    this.sel = new Select({
      id: cfg.id, caption: cfg.caption, title: cfg.title,
      options: this.baseOptions(),
      value: this.choice,
      onChange: (v) => this.set(v),
    });
  }

  get el(): HTMLElement { return this.sel.el; }
  get isGroup(): boolean { return this.choice === "lan"; }

  private baseOptions(): SelectOption[] {
    return [
      { value: "lan", label: this.cfg.group.label, hint: this.cfg.group.hint },
      { value: "gateway", label: "gateway" },
      { value: "self", label: "this host" },
    ];
  }

  /** Pick programmatically (a click inside the view). Fires onChange when it changes. */
  set(v: string, fire = true): void {
    const m = this.msg;
    if (m && v === m.gateway) v = "gateway";
    else if (m && v === m.local_ip) v = "self";
    if (v === this.choice) return;
    this.choice = v;
    localStorage.setItem(this.cfg.key, v);
    this.sel.value = v;
    this.rebuild(true);
    if (fire) this.cfg.onChange(v);
  }

  /** Every snapshot: the device list changes, and the gateway / merged aliases can move. */
  update(msg: StateMsg): void { this.msg = msg; this.rebuild(); }

  private rebuild(force = false): void {
    const m = this.msg;
    if (!m || (this.sel.isOpen && !force)) return;
    const label = (ip: string) => { const d = m.devices.find((x) => x.ip === ip); const n = d ? displayName(d) : ip; return n === ip ? rIp(ip) : rName(n); };
    const devs = m.devices
      .filter((d) => (d.role === "lan" || d.role === "local") && d.online && d.ip !== m.gateway && d.ip !== m.local_ip)
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const opts = this.baseOptions();
    opts[1].hint = label(m.gateway); opts[2].hint = label(m.local_ip);
    opts.push(...devs.map((d) => ({ value: d.ip, label: label(d.ip), hint: rIp(d.ip) })));
    if (!opts.some((o) => o.value === this.choice)) opts.push({ value: this.choice, label: label(this.choice), hint: rIp(this.choice) });
    const sig = opts.map((o) => `${o.value}\u0001${o.label}\u0001${o.hint}`).join("\u0002");
    if (sig !== this.sig) { this.sig = sig; this.sel.setOptions(opts); }
    this.sel.value = this.choice;
  }

  /** The single device's address (aliases resolved), or "" for the group. */
  ip(): string {
    const m = this.msg;
    if (!m || this.isGroup) return "";
    if (this.choice === "gateway") return m.gateway;
    if (this.choice === "self") return m.local_ip;
    const ip = this.scene.resolve(this.choice);
    return m.devices.some((d) => d.ip === ip) ? ip : m.gateway;
  }

  /** what /api/traffic is polled for: `@lan`, or the device's addresses ("merge names": every address behind the name) */
  token(): string {
    if (!this.msg) return "";
    if (this.isGroup) return "@lan";
    const ip = this.ip();
    return idsOf(this.scene.deviceOf(ip), ip);
  }

  /** Whether an address is ours. */
  has(ip: string): boolean {
    if (this.isGroup) return isKnown(this.scene.deviceOf(ip) ?? this.msg?.devices.find((d) => d.ip === ip));
    return this.scene.resolve(ip) === this.ip();
  }

  /** A key that changes when what we poll for changes (a restart is due). */
  signature(): string { return `${this.choice}\u0001${this.isGroup ? "" : this.ip()}`; }

  label(nameOf: (ip: string) => string): string {
    if (this.isGroup) return this.cfg.group.label;
    return this.ip() ? nameOf(this.ip()) : "waiting for a snapshot…";
  }

  count(): number {
    const m = this.msg;
    if (!m) return 0;
    return this.isGroup ? m.devices.filter((d) => isKnown(d)).length : 1;
  }
}

// ------------------------------------------------------------------ base view

export abstract class ArcadeView {
  abstract readonly controls: HTMLElement[];
  protected readonly canvas: HTMLCanvasElement;
  protected readonly g: CanvasRenderingContext2D;
  protected msg: StateMsg | null = null;
  protected theme: Theme = DEFAULT_THEME;
  protected font = "ui-sans-serif, system-ui, sans-serif";
  protected running = false;
  protected W = 0; protected H = 0; protected dpr = 1;
  protected pointer = { x: -1, y: -1 };
  /** packets per second of the polled traffic, smoothed */
  protected pps = 0;
  /** newest packet time seen (the poll cursor); 0 before the first poll */
  protected lastT = 0;
  private raf = 0;
  private timer: number | null = null;
  private inflight = false;
  private gen = 0;
  private lastFrame = 0;
  private dataKey = "";
  private readonly look: LookStage;
  private readonly paneFps: PaneFps;
  private readonly picture = new CanvasChangeProbe();

  constructor(protected readonly container: HTMLElement, protected readonly scene: NetScene) {
    this.paneFps = new PaneFps(container);
    this.look = new LookStage(container);
    this.canvas = document.createElement("canvas");
    this.g = this.canvas.getContext("2d")!;
    container.appendChild(this.canvas);
    this.font = getComputedStyle(document.documentElement).fontFamily || this.font;
    this.canvas.addEventListener("pointermove", (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    this.canvas.addEventListener("pointerleave", () => { this.pointer = { x: -1, y: -1 }; });
    this.canvas.addEventListener("click", (e) => this.onClick(e));
    observeResize(container, () => this.fit());
  }

  // ---- lifecycle

  /** Show the view. `preferIp` is the device selected in the graph when the mode was entered. */
  start(preferIp?: string | null): void {
    if (document.body.classList.contains("mosaic")) this.look.attach();
    this.onStart(preferIp ?? null);
    this.running = true;
    this.lastFrame = 0;
    this.resync();
    this.onSnapshot();
    if (this.useTraffic()) {
      if (this.timer === null) this.timer = window.setInterval(() => void this.poll(), POLL_MS);
      void this.poll();
    }
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.look.detach();
  }

  update(msg: StateMsg): void {
    this.msg = msg;
    if (!this.running) return;
    this.resync();
    this.onSnapshot();
  }

  setTheme(t: Theme): void { this.theme = t; }

  // ---- hooks

  /** Packet poll against `/api/traffic`. CPU arcade views feed from the websocket snapshot instead. */
  protected useTraffic(): boolean { return true; }
  /** What to poll: the `ip=` token and an optional `peer=`; null when nothing can be polled yet. */
  protected abstract query(): { ip: string; peer?: string } | null;
  /** New packets, oldest first, already past the cursor. `first` is the time of the oldest so `t - first` is the spawn delay. */
  protected abstract ingest(fresh: Packet[], first: number, newest: number): void;
  protected abstract step(now: number, dt: number): void;
  protected abstract draw(now: number): void;
  /** Called before the run starts, with the graph's selection. */
  protected onStart(_preferIp: string | null): void {}
  /** Every snapshot while running: refresh menus. */
  protected onSnapshot(): void {}
  protected onClick(_e: MouseEvent): void {}
  /** Drop everything on screen: called when the query changes. Subclasses extend and call super. */
  protected reset(): void {
    this.gen++;
    this.lastT = 0;
    this.inflight = false;
    this.pps = 0;
  }

  /** Client-side choices that change what is on screen (a filter): part of the restart key. */
  protected variant(): string { return ""; }

  /** Apply the current picks: if what we poll for (or how we filter it) changed since the run started, start over. */
  protected resync(): void {
    const q = this.query();
    const key = `${q?.ip ?? ""}\u0001${q?.peer ?? ""}\u0001${this.variant()}`;
    if (key === this.dataKey) return;
    this.dataKey = key;
    this.reset();
    if (this.running) this.onSnapshot();
    if (this.running && this.useTraffic()) void this.poll();
  }

  // ---- data

  private async poll(): Promise<void> {
    if (!this.useTraffic()) return;
    const q = this.query();
    if (!this.running || !q || !q.ip || this.inflight) return;
    this.inflight = true;
    const gen = this.gen;
    try {
      let url = `/api/traffic?ip=${encodeURIComponent(q.ip)}`;
      if (q.peer) url += `&peer=${encodeURIComponent(q.peer)}`;
      if (this.lastT) url += `&since=${this.lastT}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const m = (await r.json()) as TrafficMsg;
      if (gen !== this.gen) return; // the query changed meanwhile: this is the old run's traffic
      const pk = m.packets.slice().reverse(); // oldest first
      if (!pk.length) { this.pps *= 0.6; return; }
      const newest = pk[pk.length - 1][0];
      if (this.lastT === 0) this.lastT = newest - REPLAY_S;
      const fresh = pk.filter((p) => p[0] > this.lastT);
      this.lastT = newest;
      this.pps = this.pps * 0.6 + (fresh.length / (POLL_MS / 1000)) * 0.4;
      if (fresh.length) {
        this.fit();
        this.ingest(fresh, fresh[0][0], newest);
      }
    } catch {
      // server away; the next tick retries
    } finally {
      if (gen === this.gen) this.inflight = false;
    }
  }

  // ---- frame

  protected fit(): void {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const dpr = devicePxRatioNumber(layoutDevicePxRatio());
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** top of the play area: under the header */
  protected barTop(): number {
    return (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 76) + 16;
  }

  /** bottom of the play area: above the footer (hint + legend), whose height depends on the mode's text and the width */
  protected footTop(): number {
    const foot = document.getElementById("foot");
    return this.H - Math.max(BOTTOM, (foot?.offsetHeight ?? 0) + 14);
  }

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
    this.step(now, dt);
    this.look.frame(this.scene, this.theme, dt, now);
    this.g.clearRect(0, 0, this.W, this.H);
    this.draw(now);
    if (this.picture.sample(this.g, this.canvas)) this.paneFps.mark(ts);
  };

  // ---- helpers

  protected deviceAt(ip: string): Device | undefined { return this.scene.deviceOf(ip) ?? this.msg?.devices.find((d) => d.ip === ip); }

  protected nameOf(ip: string): string {
    const d = this.deviceAt(ip);
    const n = d ? displayName(d) : ip;
    return n === ip ? rIp(ip) : rName(n);
  }

  /** a short name: the first label of a hostname, the address otherwise */
  protected shortName(ip: string): string {
    const n = this.nameOf(ip);
    if (n === rIp(ip)) return n;
    return n.replace(/\.(local|lan|home|arpa)$/i, "");
  }

  protected roleCss(role: Role): string { return css(this.theme.roles[role]); }

  protected colorOf(ip: string): string {
    const d = this.deviceAt(ip);
    return d && d.role !== "internet" && d.role !== "lan" ? this.roleCss(d.role) : css(hashColor(ip));
  }

  protected roleColor(ip: string): string {
    const d = this.deviceAt(ip);
    return this.roleCss(d?.role ?? "internet");
  }

  /** Draw the idle notice in the middle of the play area. */
  protected drawIdle(now: number, text: string, cx: number, cy: number): void {
    const g = this.g;
    g.textAlign = "center"; g.textBaseline = "middle"; g.font = `12px ${this.font}`; g.fillStyle = this.theme.ui.muted;
    g.globalAlpha = 0.6 + 0.3 * Math.sin(now * 2);
    g.fillText(text, cx, cy);
    g.globalAlpha = 1;
  }
}

/** `tcp/443` → `:443`; no tag → `· PROTO` */
export function portSuffix(tag: string, proto: string): string {
  return tag ? `:${tag.split("/")[1]}` : `· ${proto || "?"}`;
}
