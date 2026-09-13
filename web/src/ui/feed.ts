import { decodePacket, type FeedKind } from "../inspect/decode";
import { idsOf, type Packet, type TrafficMsg } from "../core/types";
import type { NetScene } from "../graph/scene";
import { markFrame } from "../core/fps";

const POLL_MS = 800;
const BAR_N = 20;
const BAR_S = 1;

export type FeedLayout = "ticker" | "bars" | "both";
export type FeedScope = "lan" | "selected" | "any";

export const FEED_LAYOUTS: { value: FeedLayout; label: string; hint: string }[] = [
  { value: "ticker", label: "ticker", hint: "decoded packet lines, newest at the top" },
  { value: "bars", label: "bars", hint: "vertical stack of per-second protocol mix" },
  { value: "both", label: "both", hint: "bars above a scrolling ticker" },
];

export const FEED_SCOPES: { value: FeedScope; label: string; hint: string }[] = [
  { value: "lan", label: "LAN", hint: "every local device" },
  { value: "selected", label: "selection", hint: "the selected node, or the LAN if none is picked" },
  { value: "any", label: "all", hint: "LAN plus internet hosts this capture can see" },
];

export interface FeedConfig {
  on: boolean;
  layout: FeedLayout;
  scope: FeedScope;
  density: number;
  modulate: boolean;
}

export const DEFAULT_FEED: FeedConfig = {
  on: true,
  layout: "both",
  scope: "lan",
  density: 36,
  modulate: true,
};

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
 * Right-hand live overlay: decoded capture headlines (newest on top) and a vertical strip of
 * horizontal stacked bars for the last few seconds of protocol mix.
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

  constructor(host: HTMLElement, private scene: NetScene) {
    this.el = host;
    this.el.className = "livefeed";
    this.el.innerHTML = `
      <div class="feed-bars" hidden><canvas></canvas></div>
      <div class="feed-ticker" aria-label="decoded traffic"></div>
      <div class="feed-hint"></div>`;
    this.ticker = this.el.querySelector(".feed-ticker")!;
    this.bars = this.el.querySelector("canvas")!;
    this.hint = this.el.querySelector(".feed-hint")!;
    this.ticker.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-host]");
      if (row?.dataset.host) this.scene.selectIp(row.dataset.host);
    });
    this.loop = this.loop.bind(this);
  }

  setConfig(c: FeedConfig): void {
    this.cfg = { ...c };
    this.el.classList.toggle("off", !c.on);
    this.el.hidden = !c.on;
    this.el.querySelector<HTMLElement>(".feed-bars")!.hidden = !c.on || c.layout === "ticker";
    this.ticker.hidden = !c.on || c.layout === "bars";
    if (c.on) this.start();
    else this.stop();
    this.trim();
  }

  setGraphBase(base: string | undefined): void {
    const next = base ?? "";
    if (next === this.graphBase) return;
    this.graphBase = next;
    this.lastT = 0;
    for (const l of this.lines) l.el.remove();
    this.lines = [];
    this.buckets = [];
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
  }

  private query(): string | null {
    if (document.body.classList.contains("arcade")) return null;
    if (!this.cfg.on) return null;
    const rf = this.graphBase === "wifi" ? "@wifi" : this.graphBase === "bluetooth" ? "@bluetooth" : "";
    if (this.graphBase === "cpu") return null;
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
      this.hint.textContent = this.lastT ? "" : "waiting for packets…";
      return;
    }
    const newest = pk[pk.length - 1]![0];
    if (!this.lastT) this.lastT = newest - 2;
    const fresh = pk.filter((p) => p[0] > this.lastT);
    this.lastT = newest;
    if (!fresh.length) return;
    this.hint.textContent = "";
    for (const p of fresh) this.eat(p);
    this.trim();
  }

  private eat(p: Packet): void {
    const d = decodePacket(p, this.scene);
    this.addBytes(p[0], d.kind, p[5]);
    if (d.skip) return;
    const host = p[9] ?? (p[1] === "out" ? this.scene.selectedIp ?? undefined : p[2]);
    const key = `${d.kind}|${d.text}`;
    const same = this.lines.find((l, i) => i < 8 && l.key === key && p[0] - l.t < 2.5);
    if (same) {
      same.count++;
      same.t = p[0];
      this.paintCount(same);
      return;
    }
    const line = this.makeLine({
      key, t: p[0], color: d.color, label: d.label, text: d.text,
      host: host ?? d.host, peer: d.peer, count: 1,
    });
    this.lines.unshift(line);
    this.ticker.prepend(line.el);
  }

  private trim(): void {
    const cap = Math.max(12, this.cfg.density);
    while (this.lines.length > cap) {
      const old = this.lines.pop();
      old?.el.remove();
    }
  }

  private makeLine(init: Omit<Line, "el" | "nEl">): Line {
    const el = document.createElement("div");
    el.className = "row";
    el.dataset.host = init.host ?? "";
    el.style.setProperty("--c", init.color);
    el.title = init.text;
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = init.label;
    const tx = document.createElement("span");
    tx.className = "tx";
    tx.textContent = init.text;
    const nEl = document.createElement("span");
    nEl.className = "n";
    el.append(k, tx, nEl);
    const line: Line = { ...init, el, nEl };
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
    if (!this.cfg.on || this.cfg.layout === "ticker") return;
    if (!this.cfg.modulate && ts - this.lastBar < 80) return;
    this.lastBar = ts;
    this.drawBars();
  }

  private drawBars(): void {
    const wrap = this.bars.parentElement!;
    const w = Math.max(80, wrap.clientWidth);
    const h = Math.max(80, wrap.clientHeight || 160);
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (this.bars.width !== Math.round(w * dpr) || this.bars.height !== Math.round(h * dpr)) {
      this.bars.width = Math.round(w * dpr);
      this.bars.height = Math.round(h * dpr);
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
