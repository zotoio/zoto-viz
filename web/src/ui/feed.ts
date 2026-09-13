import { decodePacket, type FeedKind } from "../inspect/decode";
import { idsOf, type Packet, type TrafficMsg } from "../core/types";
import type { NetScene } from "../graph/scene";
import { markFrame } from "../core/fps";

const POLL_MS = 800;
const BAR_N = 20;
const BAR_S = 1;

export type FeedLayout = "ticker" | "bars" | "both";
export type FeedScope = "lan" | "selected" | "any";
export type FeedSource = "traffic" | "transcript" | "both";
export type ChatRole = "you" | "think" | "agent";

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

export const FEED_SOURCES: { value: FeedSource; label: string; hint: string }[] = [
  { value: "traffic", label: "traffic", hint: "decoded packets from the capture" },
  { value: "transcript", label: "transcript", hint: "agent conversation and chain of thought, newest at the bottom" },
  { value: "both", label: "both", hint: "packets mixed with the agent transcript" },
];

export interface FeedConfig {
  on: boolean;
  layout: FeedLayout;
  scope: FeedScope;
  source: FeedSource;
  density: number;
  modulate: boolean;
}

export const DEFAULT_FEED: FeedConfig = {
  on: true,
  layout: "both",
  scope: "lan",
  source: "traffic",
  density: 36,
  modulate: true,
};

/** Pixels to shift the graph optical center (positive = left). Half the overlay, and only when the view is tighter than 4× the feed. Chrome-right puts the feed on the left. */
export function feedViewShift(width: number, chrome = "top", viewWidth = 0): number {
  if (width <= 0 || viewWidth >= width * 4) return 0;
  const px = width * 0.5;
  return chrome === "right" ? -px : px;
}

export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
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
  chat?: ChatRole;
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
  private streamLine: Line | null = null;
  private streamRole: ChatRole | null = null;
  private readonly ticker: HTMLDivElement;
  private readonly composer: HTMLDivElement;
  readonly ask: HTMLTextAreaElement;
  private readonly bars: HTMLCanvasElement;
  private readonly hint: HTMLDivElement;
  private raf = 0;
  private stickToBottom = true;
  onSourceChange?: () => void;
  /** Return false to keep the draft (chat already in flight). */
  onSend?: (text: string) => boolean | void;
  onMicDown?: () => void;
  onMicUp?: () => void;

  constructor(host: HTMLElement, private scene: NetScene) {
    this.el = host;
    this.el.className = "livefeed";
    this.el.innerHTML = `
      <div class="feed-bars" hidden><canvas></canvas></div>
      <div class="feed-panel">
        <div class="feed-ticker" aria-label="live feed"></div>
        <div class="feed-composer" hidden>
          <textarea class="feed-ask" rows="2" placeholder="Ask about the LAN…" aria-label="message"></textarea>
          <button type="button" class="btn feed-mic" title="hold to talk" aria-label="microphone">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>
          </button>
          <button type="button" class="btn primary feed-send">send</button>
        </div>
      </div>
      <div class="feed-hint"></div>`;
    this.ticker = this.el.querySelector(".feed-ticker")!;
    this.composer = this.el.querySelector(".feed-composer")!;
    this.ask = this.el.querySelector(".feed-ask")!;
    this.bars = this.el.querySelector("canvas")!;
    this.hint = this.el.querySelector(".feed-hint")!;
    this.ticker.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-host]");
      if (row?.dataset.host) this.scene.selectIp(row.dataset.host);
    });
    this.ticker.addEventListener("scroll", () => {
      if (!this.chatLog()) return;
      const el = this.ticker;
      this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
    });
    this.composer.querySelector(".feed-send")!.addEventListener("click", () => this.submitComposer());
    this.composer.querySelector(".feed-mic")!.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onMicDown?.();
    });
    this.composer.querySelector(".feed-mic")!.addEventListener("pointerup", () => this.onMicUp?.());
    this.composer.querySelector(".feed-mic")!.addEventListener("pointerleave", () => this.onMicUp?.());
    this.ask.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submitComposer();
      }
    });
    this.loop = this.loop.bind(this);
  }

  private submitComposer(): void {
    const text = this.ask.value.trim();
    if (!text) return;
    const accepted = this.onSend?.(text);
    if (accepted === false) return;
    this.ask.value = "";
  }

  setConfig(c: FeedConfig): void {
    const prev = this.cfg.source;
    this.cfg = { ...DEFAULT_FEED, ...c };
    this.el.classList.toggle("off", !c.on);
    this.el.classList.toggle("transcript", this.showsTranscript());
    this.el.classList.toggle("chat-log", this.chatLog());
    this.el.hidden = !c.on;
    this.composer.hidden = !c.on || !this.showsTranscript();
    this.el.querySelector<HTMLElement>(".feed-bars")!.hidden = !c.on || c.layout === "ticker" || !this.showsTraffic();
    this.ticker.hidden = !c.on || (c.layout === "bars" && !this.showsTranscript());
    if (c.on) this.start();
    else this.stop();
    if (prev !== this.cfg.source) {
      this.resetTicker();
      this.onSourceChange?.();
    }
    this.trim();
    if (this.showsTranscript() && !this.showsTraffic()) this.hint.textContent = this.lines.length ? "" : "agent transcript…";
  }

  showsTraffic(): boolean { return this.cfg.source !== "transcript"; }
  showsTranscript(): boolean { return this.cfg.source !== "traffic"; }
  /** Transcript-only overlay: chronological chat, newest at the bottom. */
  chatLog(): boolean { return this.cfg.source === "transcript"; }

  /** Newest ticker lines for the agent HUD snapshot. */
  snapshot(limit = 10): string[] {
    const src = this.chatLog() ? this.lines.slice(-limit).reverse() : this.lines.slice(0, limit);
    return src.map((l) => {
      const n = l.count > 1 ? ` ×${l.count}` : "";
      return `${l.label} ${l.text}${n}`.trim().slice(0, 160);
    });
  }

  /** Live agent tokens (and chain of thought) for the right-hand ticker. */
  pushChat(role: ChatRole, chunk: string, stream = false): void {
    if (!this.cfg.on || !this.showsTranscript() || this.ticker.hidden) return;
    const text = chunk ?? "";
    if (!text) return;
    if (role !== "think") this.dropPendingThink();
    this.hint.textContent = "";
    if (stream && role === "think" && this.streamLine?.el.classList.contains("pending")) {
      this.streamLine.el.classList.remove("pending");
      this.writeStream(this.streamLine, text);
      return;
    }
    if (stream && this.streamRole === role && this.streamLine) {
      this.writeStream(this.streamLine, (this.streamLine.text + text).slice(0, CHAT_CAP));
      return;
    }
    this.addChatLine(role, text, stream);
  }

  /** Header / composer wait state: a think row before the first token, gone if the model never thinks. */
  setThinking(on: boolean): void {
    const was = this.el.classList.contains("thinking");
    this.el.classList.toggle("thinking", on);
    this.el.setAttribute("aria-busy", on ? "true" : "false");
    if (on) {
      if (this.showsTranscript()) this.hint.textContent = "thinking…";
      if (!was && this.cfg.on && this.showsTranscript() && !this.ticker.hidden
          && !(this.streamRole === "think" && this.streamLine)) {
        this.addChatLine("think", "thinking…", true);
        this.streamLine?.el.classList.add("pending");
      }
      return;
    }
    this.dropPendingThink();
    if (this.hint.textContent === "thinking…") {
      this.hint.textContent = this.showsTranscript() && !this.showsTraffic() && !this.lines.length
        ? "agent transcript…"
        : "";
    }
  }

  seedTranscript(turns: TranscriptTurn[]): void {
    if (!this.cfg.on || !this.showsTranscript()) return;
    this.closeStream();
    if (!this.showsTraffic()) this.resetTicker();
    else this.dropChatLines();
    for (const m of turns) {
      if (m.role === "user" && m.content) this.addChatLine("you", m.content, false);
      if (m.role === "assistant") {
        if (m.thinking?.trim()) this.addChatLine("think", m.thinking.trim(), false);
        const said = (m.content || "").replace(/```memory\n[\s\S]*?```/gi, "").trim() || m.content;
        if (said?.trim()) this.addChatLine("agent", said.trim(), false);
      }
    }
    this.trim();
    this.stickToBottom = true;
    this.pinChat();
    if (!this.lines.length && !this.showsTraffic()) this.hint.textContent = "agent transcript…";
    if (this.el.classList.contains("thinking") && this.showsTranscript() && !this.ticker.hidden) {
      this.hint.textContent = "thinking…";
      if (!(this.streamRole === "think" && this.streamLine)) {
        this.addChatLine("think", "thinking…", true);
        this.streamLine?.el.classList.add("pending");
      }
    }
  }

  setGraphBase(base: string | undefined): void {
    const next = base ?? "";
    if (next === this.graphBase) return;
    this.graphBase = next;
    if (this.showsTraffic()) this.resetTicker();
  }

  private resetTicker(): void {
    this.closeStream();
    this.lastT = 0;
    for (const l of this.lines) l.el.remove();
    this.lines = [];
    this.buckets = [];
  }

  private dropChatLines(): void {
    this.closeStream();
    this.lines = this.lines.filter((l) => {
      if (!l.chat) return true;
      l.el.remove();
      return false;
    });
  }

  private dropPendingThink(): void {
    if (!this.streamLine?.el.classList.contains("pending")) return;
    this.streamLine.el.remove();
    this.lines = this.lines.filter((l) => l !== this.streamLine);
    this.closeStream();
  }

  private writeStream(line: Line, text: string): void {
    line.text = text.slice(0, CHAT_CAP);
    const tx = line.el.querySelector(".tx");
    if (tx) tx.textContent = line.text;
    line.el.title = line.text;
    this.pinChat();
  }

  private closeStream(): void {
    this.streamLine = null;
    this.streamRole = null;
  }

  private addChatLine(role: ChatRole, text: string, stream: boolean): void {
    const clipped = text.slice(0, CHAT_CAP);
    if (!clipped.trim()) return;
    const line = this.makeLine({
      key: `chat:${role}:${this.lines.length}:${clipped.slice(0, 24)}`,
      t: Date.now() / 1000,
      color: CHAT_COLOR[role],
      label: CHAT_LABEL[role],
      text: clipped,
      count: 1,
      chat: role,
    });
    if (this.chatLog()) {
      this.lines.push(line);
      this.ticker.append(line.el);
    } else {
      this.lines.unshift(line);
      this.ticker.prepend(line.el);
    }
    if (stream) {
      this.streamLine = line;
      this.streamRole = role;
    }
    this.trim();
    this.pinChat();
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
    if (!this.cfg.on || !this.showsTraffic()) return null;
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
      if (!this.lastT && !this.lines.length) {
        this.hint.textContent = this.showsTranscript() ? "agent transcript…" : "waiting for packets…";
      }
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
    this.closeStream();
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
      const old = this.chatLog() ? this.lines.shift() : this.lines.pop();
      old?.el.remove();
    }
  }

  private pinChat(): void {
    if (!this.chatLog() || !this.stickToBottom) return;
    this.ticker.scrollTop = this.ticker.scrollHeight;
  }

  private makeLine(init: Omit<Line, "el" | "nEl">): Line {
    const el = document.createElement("div");
    el.className = "row" + (init.chat ? ` chat ${init.chat}` : "");
    if (init.chat) el.style.cursor = "default";
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

const CHAT_CAP = 4000;
const CHAT_COLOR: Record<ChatRole, string> = {
  you: "#29b6f6",
  think: "#90a4ae",
  agent: "#66bb6a",
};
const CHAT_LABEL: Record<ChatRole, string> = { you: "you", think: "think", agent: "agent" };
