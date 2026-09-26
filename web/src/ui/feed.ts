import { isSysBase } from "../core/modes";
import type { SourceHeadline } from "../core/sources";
import { decodePacket, type FeedKind } from "../inspect/decode";
import { idsOf, type Packet, type TrafficMsg } from "../core/types";
import type { NetScene } from "../graph/scene";
import { markFrame } from "../core/fps";
import { followScrollTop } from "./feed-reveal";
import { bindFloatPanel } from "./float-drag";
import {
  devicePxRatioNumber,
  layoutDevicePxRatio,
  onLayoutDevicePxRatioChange,
} from "../graph/render-host-device-px-ratio";
export type { ChatRole, TranscriptTurn } from "./chat";

const POLL_MS = 800;
const BAR_N = 20;
const BAR_S = 1;
const LINE_CAP = 400;

export type FeedLayout = "ticker" | "bars" | "both";
export type FeedScope = "lan" | "selected" | "any";
/** Kept for stored profiles / MCP; the feed panel is always traffic. */
export type FeedSource = "traffic" | "transcript" | "both";

export const FEED_LAYOUTS: { value: FeedLayout; label: string; hint: string }[] = [
  { value: "ticker", label: "ticker", hint: "decoded packet lines, newest at the bottom; older lines scroll up" },
  { value: "bars", label: "bars", hint: "vertical stack of per-second protocol mix" },
  { value: "both", label: "both", hint: "bars above a scrolling ticker" },
];

export const FEED_SCOPES: { value: FeedScope; label: "LAN" | "selection" | "all"; hint: string }[] = [
  { value: "lan", label: "LAN", hint: "every local device" },
  { value: "selected", label: "selection", hint: "the selected node, or the LAN if none is picked" },
  { value: "any", label: "all", hint: "LAN plus internet hosts this capture can see" },
];

export const FEED_SOURCES: { value: FeedSource; label: string; hint: string }[] = [
  { value: "traffic", label: "traffic", hint: "decoded packets from the capture" },
  { value: "transcript", label: "chat", hint: "legacy — opens the Chat panel instead" },
  { value: "both", label: "both", hint: "legacy — feed stays traffic; chat is a separate panel" },
];

export interface FeedConfig {
  on: boolean;
  layout: FeedLayout;
  scope: FeedScope;
  source: FeedSource;
  density: number;
  textSize: number;
  modulate: boolean;
  includeSources: boolean;
}

export const DEFAULT_FEED: FeedConfig = {
  on: true,
  layout: "ticker",
  scope: "lan",
  source: "traffic",
  density: 36,
  textSize: 12,
  modulate: true,
  includeSources: true,
};

/** One-time split: old feed-as-chat source becomes a dedicated chat panel. */
export const FEED_CHAT_SPLIT_MARK = "zoto-viz.feed.chat2";

export function migrateFeedChatSplit(prefix: string): { chatOn?: boolean; source?: FeedSource } {
  if (typeof localStorage === "undefined") return {};
  if (localStorage.getItem(FEED_CHAT_SPLIT_MARK) === "1") return {};
  localStorage.setItem(FEED_CHAT_SPLIT_MARK, "1");
  const source = localStorage.getItem(`${prefix}.feed.source`);
  if (source === "transcript" || source === "both") {
    return { chatOn: true, source: "traffic" };
  }
  return {};
}

/** Pixels to shift the graph optical center (positive = left). Half the overlay, and only when the view is tighter than 4× the overlay. Chrome-right puts the overlay on the left. */
export function feedViewShift(width: number, chrome = "top", viewWidth = 0): number {
  if (width <= 0 || viewWidth >= width * 4) return 0;
  const px = width * 0.5;
  return chrome === "right" ? -px : px;
}

/** True when the ticker is close enough to the latest line to keep following it. */
export function nearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slop = 96): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < slop;
}

interface Line {
  key: string;
  t: number;
  color: string;
  label: string;
  text: string;
  host?: string;
  peer?: string;
  count: number;
  el: HTMLDivElement;
  nEl: HTMLSpanElement;
}

type Bucket = Record<FeedKind, number>;
const KINDS: FeedKind[] = ["tls", "quic", "dns", "mdns", "http", "media", "ssdp", "dhcp", "remote", "plain", "wifi", "bt", "other"];

/**
 * Right-hand live overlay: decoded capture headlines and source titles.
 * Chat lives on `#livechat`. Every source appends at the bottom so older lines
 * scroll up; new rows queue below the viewport and the ticker scrolls until it catches up.
 */
export class LiveFeed {
  readonly el: HTMLElement;
  private cfg: FeedConfig = { ...DEFAULT_FEED };
  private graphBase = "";
  private timer: number | null = null;
  private inflight = false;
  private lastT = 0;
  private lines: Line[] = [];
  private buckets: { t: number; bytes: Bucket }[] = [];
  private barPulse = 1;
  private lastBar = 0;
  private readonly ticker: HTMLDivElement;
  private readonly bars: HTMLCanvasElement;
  private readonly hint: HTMLDivElement;
  private raf = 0;
  private lastTick = 0;
  private stickToBottom = true;
  private followTick = false;
  private lastScrollTop = 0;

  constructor(host: HTMLElement, private scene: NetScene) {
    this.el = host;
    this.el.className = "livefeed";
    this.el.innerHTML = `
      <div class="float-handle">feed</div>
      <div class="feed-bars" hidden><canvas></canvas></div>
      <div class="feed-panel">
        <div class="feed-ticker" aria-label="live feed"></div>
      </div>
      <div class="feed-hint" aria-live="polite"></div>`;
    this.ticker = this.el.querySelector(".feed-ticker")!;
    this.bars = this.el.querySelector("canvas")!;
    this.hint = this.el.querySelector(".feed-hint")!;
    bindFloatPanel(this.el, this.el.querySelector(".float-handle")!, "feed", { min: { w: 220, h: 160 } });
    this.ticker.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-host]");
      if (row?.dataset.host) this.scene.selectIp(row.dataset.host);
    });
    onLayoutDevicePxRatioChange(() => {
      if (this.cfg.layout === "bars" || this.cfg.layout === "both") this.drawBars();
    });
    this.ticker.addEventListener("scroll", () => {
      if (this.followTick) {
        this.lastScrollTop = this.ticker.scrollTop;
        return;
      }
      if (this.ticker.scrollTop < this.lastScrollTop - 1) this.stickToBottom = false;
      else if (nearBottom(this.ticker)) this.stickToBottom = true;
      this.lastScrollTop = this.ticker.scrollTop;
    });
    this.ticker.addEventListener("wheel", (e) => {
      if (e.deltaY < 0) this.stickToBottom = false;
    }, { passive: true });
    this.loop = this.loop.bind(this);
  }

  /** RSS / HTTP / file headlines from the host sources registry. */
  setSourceHeadlines(rows: SourceHeadline[]): void {
    const want = this.cfg.includeSources !== false ? rows : [];
    const keep = new Set(want.map((r) => `src:${r.id}`));
    this.lines = this.lines.filter((l) => {
      if (!l.key.startsWith("src:")) return true;
      if (keep.has(l.key)) return true;
      l.el.remove();
      return false;
    });
    if (!want.length) return;
    let added = false;
    for (const row of want) {
      const key = `src:${row.id}`;
      const existing = this.lines.find((l) => l.key === key);
      if (existing) {
        if (existing.text !== row.text) {
          existing.text = row.text;
          existing.label = row.label;
          existing.el.title = row.text;
          const k = existing.el.querySelector(".k");
          const tx = existing.el.querySelector(".tx");
          if (k) k.textContent = row.label;
          if (tx) tx.textContent = row.text;
        }
        continue;
      }
      const line = this.makeLine({
        key,
        t: Date.now() / 1000,
        color: "#8cb4ff",
        label: row.label,
        text: row.text,
        count: 1,
      });
      this.lines.push(line);
      this.ticker.append(line.el);
      added = true;
    }
    this.trim();
    if (added) this.pinLatest(false);
  }

  setConfig(c: FeedConfig): void {
    this.cfg = { ...DEFAULT_FEED, ...c, source: "traffic" };
    const size = Math.min(20, Math.max(10, this.cfg.textSize || DEFAULT_FEED.textSize));
    this.cfg.textSize = size;
    this.el.style.setProperty("--feed-size", `${size}px`);
    document.documentElement.style.setProperty("--feed-size", `${size}px`);
    this.el.classList.toggle("off", !c.on);
    this.syncOverlay();
    if (c.on) this.start();
    else this.stop();
    this.trim();
    this.pinLatest();
  }

  showsTraffic(): boolean { return true; }

  private syncOverlay(): void {
    const on = this.cfg.on;
    this.el.hidden = !on;
    this.el.querySelector<HTMLElement>(".feed-bars")!.hidden = !on || this.cfg.layout === "ticker";
    this.ticker.hidden = !on || this.cfg.layout === "bars";
  }

  /** Newest ticker lines for the agent HUD snapshot. */
  snapshot(limit = 10): string[] {
    return this.lines.slice(-limit).reverse().map((l) => {
      const n = l.count > 1 ? ` ×${l.count}` : "";
      return `${l.label} ${l.text}${n}`.trim().slice(0, 160);
    });
  }

  setGraphBase(base: string | undefined): void {
    const next = base ?? "";
    if (next === this.graphBase) return;
    this.graphBase = next;
    this.resetTicker();
  }

  private resetTicker(): void {
    this.lastT = 0;
    for (const l of this.lines) l.el.remove();
    this.lines = [];
    this.buckets = [];
    this.stickToBottom = true;
  }

  /** Advance follow-scroll by `dt` seconds. */
  stepClock(dt: number): void {
    this.tickFollow(dt);
  }

  private start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => void this.poll(), POLL_MS);
    this.raf = requestAnimationFrame(this.loop);
    void this.poll();
  }

  private stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastTick = 0;
  }

  private query(): string | null {
    if (document.body.classList.contains("arcade")) return null;
    if (!this.cfg.on) return null;
    const rf = this.graphBase === "wifi" ? "@wifi" : this.graphBase === "bluetooth" ? "@bluetooth" : "";
    if (this.graphBase === "cpu" || this.graphBase === "sources" || isSysBase(this.graphBase)) return null;
    if (this.cfg.scope === "selected") {
      const ip = this.scene.selectedIp;
      if (ip) return idsOf(this.scene.deviceOf(ip), ip);
      return rf || "@lan";
    }
    if (rf) return rf;
    return this.cfg.scope === "any" ? "@any" : "@lan";
  }

  private async poll(): Promise<void> {
    const q = this.query();
    if (!q || this.inflight) return;
    this.inflight = true;
    try {
      let url = `/api/traffic?ip=${encodeURIComponent(q)}`;
      if (this.lastT) url += `&since=${this.lastT}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const m = (await r.json()) as TrafficMsg;
      this.ingest(m);
    } catch {
      /* next tick */
    } finally {
      this.inflight = false;
    }
  }

  private ingest(m: TrafficMsg): void {
    const pk = m.packets.slice().reverse();
    if (!pk.length) {
      if (!this.lastT && !this.lines.length) this.hint.textContent = "waiting for packets…";
      return;
    }
    const newest = pk[pk.length - 1]![0];
    if (!this.lastT) this.lastT = newest - 2;
    const fresh = pk.filter((p) => p[0] > this.lastT);
    this.lastT = newest;
    if (!fresh.length) return;
    this.hint.textContent = "";
    let added = false;
    for (const p of fresh) {
      if (this.eat(p)) added = true;
    }
    this.trim();
    if (added) this.pinLatest(false);
  }

  private eat(p: Packet): boolean {
    const d = decodePacket(p, this.scene);
    this.addBytes(p[0], d.kind, p[5]);
    if (d.skip) return false;
    const host = p[9] ?? (p[1] === "out" ? this.scene.selectedIp ?? undefined : p[2]);
    const key = `${d.kind}|${d.text}`;
    const same = this.lines.slice(-8).find((l) => l.key === key && p[0] - l.t < 2.5);
    if (same) {
      same.count++;
      same.t = p[0];
      this.paintCount(same);
      return false;
    }
    const line = this.makeLine({
      key, t: p[0], color: d.color, label: d.label, text: d.text,
      host: host ?? d.host, peer: d.peer, count: 1,
    });
    this.lines.push(line);
    this.ticker.append(line.el);
    return true;
  }

  private trim(): void {
    const cap = Math.max(12, this.cfg.density);
    while (this.lines.length > cap) {
      const old = this.lines.shift();
      old?.el.remove();
    }
  }

  private pinLatest(force = false): void {
    if (force) this.stickToBottom = true;
  }

  private tickFollow(dt: number): void {
    if (!this.stickToBottom) return;
    this.followTick = true;
    this.ticker.scrollTop = followScrollTop(
      this.ticker.scrollTop,
      this.ticker.scrollHeight,
      this.ticker.clientHeight,
      dt,
    );
    this.lastScrollTop = this.ticker.scrollTop;
    this.followTick = false;
  }

  private makeLine(init: Omit<Line, "el" | "nEl">): Line {
    const text = init.text.slice(0, LINE_CAP);
    const el = document.createElement("div");
    el.className = "row";
    el.dataset.host = init.host ?? "";
    el.style.setProperty("--c", init.color);
    el.title = text;
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = init.label;
    const tx = document.createElement("span");
    tx.className = "tx";
    tx.textContent = text;
    const nEl = document.createElement("span");
    nEl.className = "n";
    el.append(k, tx, nEl);
    const line: Line = { ...init, text, el, nEl };
    this.paintCount(line);
    return line;
  }

  private paintCount(l: Line): void {
    const t = l.count > 1 ? `×${l.count}` : "";
    if (l.nEl.textContent !== t) l.nEl.textContent = t;
  }

  private addBytes(t: number, kind: FeedKind, size: number): void {
    const slot = Math.floor(t / BAR_S) * BAR_S;
    let b = this.buckets[0];
    if (!b || b.t !== slot) {
      const empty = emptyBucket();
      this.buckets.unshift({ t: slot, bytes: empty });
      if (this.buckets.length > BAR_N) this.buckets.length = BAR_N;
      b = this.buckets[0]!;
    }
    b.bytes[kind] += size;
  }

  private loop(ts: number): void {
    this.raf = requestAnimationFrame(this.loop);
    markFrame(ts);
    const dt = this.lastTick ? Math.min(0.05, (ts - this.lastTick) / 1000) : 1 / 60;
    this.lastTick = ts;
    if (!this.cfg.on) return;
    this.tickFollow(dt);
    if (this.cfg.layout === "ticker") return;
    if (!this.cfg.modulate && ts - this.lastBar < 80) return;
    this.lastBar = ts;
    this.drawBars();
  }

  private drawBars(): void {
    const wrap = this.bars.parentElement!;
    const w = Math.max(80, wrap.clientWidth);
    const h = Math.max(80, wrap.clientHeight || 160);
    const dpr = devicePxRatioNumber(layoutDevicePxRatio());
    const devW = Math.round(w * dpr);
    const devH = Math.round(h * dpr);
    if (this.bars.width !== devW || this.bars.height !== devH) {
      this.bars.width = devW;
      this.bars.height = devH;
      this.bars.style.width = `${w}px`;
      this.bars.style.height = `${h}px`;
    }
    const g = this.bars.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const target = this.cfg.modulate ? 0.72 + 0.4 * this.scene.pulseNow.level : 1;
    this.barPulse += (target - this.barPulse) * 0.14;
    const pulse = this.barPulse;
    const rowH = h / BAR_N;
    let max = 1;
    for (const b of this.buckets) {
      let s = 0;
      for (const k of KINDS) s += b.bytes[k];
      if (s > max) max = s;
    }
    const logMax = Math.log10(1 + max);
    for (let i = 0; i < BAR_N; i++) {
      const b = this.buckets[i];
      const y = i * rowH + 1;
      const bh = Math.max(3, rowH - 2);
      g.globalAlpha = 0.18;
      g.fillStyle = "rgba(255,255,255,0.06)";
      g.fillRect(0, y, w, bh);
      if (!b) continue;
      let total = 0;
      for (const k of KINDS) total += b.bytes[k];
      if (!total) continue;
      const frac = Math.log10(1 + total) / logMax;
      const barW = Math.max(8, w * frac * pulse);
      let x = 0;
      for (const k of KINDS) {
        const v = b.bytes[k];
        if (!v) continue;
        const ww = barW * (v / total);
        g.globalAlpha = 0.92;
        g.fillStyle = colorOf(k);
        g.fillRect(x, y, Math.max(1, ww), bh);
        x += ww;
      }
    }
    g.globalAlpha = 1;
  }
}

function emptyBucket(): Bucket {
  const b = {} as Bucket;
  for (const k of KINDS) b[k] = 0;
  return b;
}

function colorOf(k: FeedKind): string {
  return ({
    dns: "#26a69a", mdns: "#ffca28", tls: "#7e57c2", quic: "#29b6f6", http: "#ef5350",
    dhcp: "#ffca28", ssdp: "#ffca28", media: "#26c6da", remote: "#ff7043", plain: "#ef5350", other: "#607d8b",
  } as Record<FeedKind, string>)[k];
}
