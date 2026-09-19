import type { SourceHeadline } from "../core/sources";
import { decodePacket, type FeedKind } from "../inspect/decode";
import { idsOf, type Packet, type TrafficMsg } from "../core/types";
import type { NetScene } from "../graph/scene";
import { markFrame } from "../core/fps";
import { fillMarkdown } from "./markdown";

const POLL_MS = 800;
const BAR_N = 20;
const BAR_S = 1;

export type FeedLayout = "ticker" | "bars" | "both";
export type FeedScope = "lan" | "selected" | "any";
export type FeedSource = "traffic" | "transcript" | "both";
export type ChatRole = "you" | "think" | "agent";

export const FEED_LAYOUTS: { value: FeedLayout; label: string; hint: string }[] = [
  { value: "ticker", label: "ticker", hint: "decoded packet lines, newest at the bottom; older lines scroll up" },
  { value: "bars", label: "bars", hint: "vertical stack of per-second protocol mix" },
  { value: "both", label: "both", hint: "bars above a scrolling ticker" },
];

export const FEED_SCOPES: { value: FeedScope; label: string; hint: string }[] = [
  { value: "lan", label: "LAN", hint: "every local device" },
  { value: "selected", label: "selection", hint: "the selected node, or the LAN if none is picked" },
  { value: "any", label: "all", hint: "LAN plus internet hosts this capture can see" },
];

export const FEED_SOURCES: { value: FeedSource; label: string; hint: string }[] = [
  { value: "traffic", label: "traffic", hint: "decoded packets from the capture; newest at the bottom, older lines scroll up; agent thinking still streams here" },
  { value: "transcript", label: "transcript", hint: "agent conversation and chain of thought; older lines scroll up" },
  { value: "both", label: "both", hint: "packets mixed with the agent transcript; everything scrolls up" },
];

export interface FeedConfig {
  on: boolean;
  layout: FeedLayout;
  scope: FeedScope;
  source: FeedSource;
  density: number;
  /** ticker / transcript type size in px */
  textSize: number;
  modulate: boolean;
  /** RSS / HTTP / file headlines from the host sources registry. */
  includeSources: boolean;
}

export const DEFAULT_FEED: FeedConfig = {
  on: true,
  layout: "both",
  scope: "lan",
  source: "traffic",
  density: 36,
  textSize: 12,
  modulate: true,
  includeSources: true,
};

/** Pixels to shift the graph optical center (positive = left). Half the overlay, and only when the view is tighter than 4× the feed. Chrome-right puts the feed on the left. */
export function feedViewShift(width: number, chrome = "top", viewWidth = 0): number {
  if (width <= 0 || viewWidth >= width * 4) return 0;
  const px = width * 0.5;
  return chrome === "right" ? -px : px;
}

/** True when the ticker is close enough to the latest line to keep following it. */
export function nearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slop = 96): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < slop;
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
 * Right-hand live overlay: decoded capture headlines and agent think/reply on one ticker.
 * Every source appends at the bottom so older lines scroll up; the viewport follows the
 * latest row instead of replacing the visible list.
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
  private pinning = false;
  private pinRaf = 0;
  private pinSmoothTimer = 0;
  private listenPin = false;
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
          <textarea class="feed-ask" rows="2" placeholder="Ask about the LAN… then send" aria-label="message"></textarea>
          <button type="button" class="btn feed-mic" title="hold to talk" aria-label="microphone">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>
          </button>
          <button type="button" class="btn primary feed-send">send</button>
        </div>
      </div>
      <div class="feed-hint" aria-live="polite"></div>`;
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
      if (this.pinning || this.ticker.classList.contains("pin-smooth")) return;
      this.stickToBottom = nearBottom(this.ticker);
    });
    this.ticker.addEventListener("wheel", (e) => {
      if (this.pinning) return;
      if (e.deltaY < 0) this.stickToBottom = false;
    }, { passive: true });
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
    this.stickToBottom = true;
    this.pinLatest(true, true);
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
    this.liftStream();
    this.trim();
    if (added) this.pinLatest(false, true);
  }

  setConfig(c: FeedConfig): void {
    const prev = this.cfg.source;
    this.cfg = { ...DEFAULT_FEED, ...c };
    const size = Math.min(20, Math.max(10, this.cfg.textSize || DEFAULT_FEED.textSize));
    this.cfg.textSize = size;
    this.el.style.setProperty("--feed-size", `${size}px`);
    document.documentElement.style.setProperty("--feed-size", `${size}px`);
    this.el.classList.toggle("off", !c.on);
    this.syncOverlay();
    if (c.on) this.start();
    else this.stop();
    if (prev !== this.cfg.source) {
      this.resetTicker();
      this.onSourceChange?.();
      this.syncOverlay();
    }
    this.trim();
    if (this.showsTranscript() && !this.showsTraffic()) this.hint.textContent = this.lines.length ? "" : "agent transcript…";
    this.pinLatest();
  }

  showsTraffic(): boolean { return this.cfg.source !== "transcript"; }
  showsTranscript(): boolean { return this.cfg.source !== "traffic"; }
  /** Transcript-only overlay: chronological chat, newest at the bottom. */
  chatLog(): boolean { return this.cfg.source === "transcript"; }

  private hasAgentTrace(): boolean {
    return this.el.classList.contains("thinking") || !!this.streamLine || this.lines.some((l) => l.chat);
  }

  /** Composer / history seed follow the source chip; live think/reply rows always land on the overlay. */
  private acceptsChat(): boolean {
    return this.cfg.on;
  }

  private syncOverlay(): void {
    const on = this.cfg.on;
    const chat = this.showsTranscript();
    const trace = on && this.hasAgentTrace();
    this.el.classList.toggle("transcript", chat);
    this.el.classList.toggle("chat-log", this.chatLog());
    this.el.classList.toggle("trace", trace);
    this.el.hidden = !on;
    this.composer.hidden = !on || !chat;
    this.el.querySelector<HTMLElement>(".feed-bars")!.hidden = !on || this.cfg.layout === "ticker" || !this.showsTraffic();
    this.ticker.hidden = !on || (this.cfg.layout === "bars" && !chat && !trace);
  }

  /** Newest ticker lines for the agent HUD snapshot. */
  snapshot(limit = 10): string[] {
    return this.lines.slice(-limit).reverse().map((l) => {
      const n = l.count > 1 ? ` ×${l.count}` : "";
      return `${l.label} ${l.text}${n}`.trim().slice(0, 160);
    });
  }

  /** Live agent tokens (and chain of thought) for the right-hand ticker. */
  pushChat(role: ChatRole, chunk: string, stream = false): void {
    if (!this.acceptsChat()) return;
    const text = chunk ?? "";
    if (!text) return;
    if (role !== "think") this.dropPendingThink();
    this.hint.textContent = "";
    this.syncOverlay();
    if (this.ticker.hidden) return;
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

  /** After the watchword: pin the transcript to the bottom and show that capture is live. */
  setListening(on: boolean): void {
    this.listenPin = on;
    this.el.classList.toggle("listening", on);
    if (on) {
      this.stickToBottom = true;
      this.hint.textContent = "listening… say send";
      this.ask.placeholder = "Listening — say send to submit";
      this.pinLatest(true, true);
    } else {
      this.ask.placeholder = "Ask about the LAN… then send";
      if (this.hint.textContent === "listening… say send") {
        this.hint.textContent = this.showsTranscript() && !this.showsTraffic() && !this.lines.length
          ? "agent transcript…"
          : "";
      }
    }
    this.syncOverlay();
  }

  /** Header / composer wait state: a think row before the first token, gone if the model never thinks. */
  setThinking(on: boolean): void {
    const was = this.el.classList.contains("thinking");
    this.el.classList.toggle("thinking", on);
    this.el.setAttribute("aria-busy", on ? "true" : "false");
    this.syncOverlay();
    if (on) {
      this.hint.textContent = "thinking…";
      if (!was && this.acceptsChat() && !this.ticker.hidden
          && !(this.streamRole === "think" && this.streamLine)) {
        this.addChatLine("think", "thinking…", true);
        this.streamLine?.el.classList.add("pending");
        this.streamLine?.el.setAttribute("aria-live", "polite");
      }
      this.pinLatest();
      return;
    }
    this.dropPendingThink();
    this.syncOverlay();
    if (this.hint.textContent === "thinking…") {
      this.hint.textContent = this.showsTranscript() && !this.showsTraffic() && !this.lines.length
        ? "agent transcript…"
        : "";
    }
  }

  seedTranscript(turns: TranscriptTurn[]): void {
    if (!this.cfg.on || !this.showsTranscript()) return;
    if (!turns.length) {
      this.dropChatLines();
      this.stickToBottom = true;
      this.pinLatest();
      if (!this.lines.length && !this.showsTraffic()) this.hint.textContent = "agent transcript…";
      return;
    }
    // Live pushChat already owns the rows — do not wipe the visible ticker.
    if (this.lines.some((l) => l.chat)) {
      this.stickToBottom = true;
      this.pinLatest();
      return;
    }
    this.closeStream();
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
    this.pinLatest(true);
    if (!this.lines.length && !this.showsTraffic()) this.hint.textContent = "agent transcript…";
    if (this.el.classList.contains("thinking") && !this.ticker.hidden) {
      this.hint.textContent = "thinking…";
      if (!(this.streamRole === "think" && this.streamLine)) {
        this.addChatLine("think", "thinking…", true);
        this.streamLine?.el.classList.add("pending");
        this.streamLine?.el.setAttribute("aria-live", "polite");
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
    this.stickToBottom = true;
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
    if (tx) paintChat(tx, line.chat, line.text);
    line.el.title = line.text;
    this.liftStream();
    this.pinLatest();
  }

  /** Keep the in-flight think/reply as the latest (bottom) row so the ticker scrolls up to it. */
  private liftStream(): void {
    const line = this.streamLine;
    if (!line) return;
    if (this.lines[this.lines.length - 1] === line) {
      if (this.ticker.lastElementChild !== line.el) this.ticker.append(line.el);
      return;
    }
    this.lines = this.lines.filter((l) => l !== line);
    this.lines.push(line);
    this.ticker.append(line.el);
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
    this.lines.push(line);
    this.ticker.append(line.el);
    if (stream) {
      this.streamLine = line;
      this.streamRole = role;
    }
    this.liftStream();
    this.trim();
    if (role === "you" || role === "think" || role === "agent") this.stickToBottom = true;
    this.pinLatest(true, true);
    this.syncOverlay();
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
    if (this.pinRaf) { cancelAnimationFrame(this.pinRaf); this.pinRaf = 0; }
    if (this.pinSmoothTimer) { window.clearTimeout(this.pinSmoothTimer); this.pinSmoothTimer = 0; }
    this.ticker.classList.remove("pin-smooth");
  }

  private query(): string | null {
    if (document.body.classList.contains("arcade")) return null;
    if (!this.cfg.on || !this.showsTraffic()) return null;
    const rf = this.graphBase === "wifi" ? "@wifi" : this.graphBase === "bluetooth" ? "@bluetooth" : "";
    if (this.graphBase === "cpu" || this.graphBase === "sources") return null;
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
    let added = false;
    for (const p of fresh) {
      if (this.eat(p)) added = true;
    }
    this.trim();
    if (added) this.pinLatest(false, true);
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
    this.liftStream();
    return true;
  }

  private trim(): void {
    const cap = Math.max(12, this.cfg.density);
    while (this.lines.length > cap) {
      if (this.lines[0] === this.streamLine) break;
      const old = this.lines.shift();
      old?.el.remove();
    }
  }

  /** Follow the latest row. New rows smooth-scroll up; a long catch-up snaps so the list is not left at the top. */
  private pinLatest(force = false, smooth = false): void {
    const following = this.el.classList.contains("thinking") || !!this.streamLine;
    const pin = force || this.listenPin || this.stickToBottom || following;
    if (!pin) return;
    if (this.pinRaf) cancelAnimationFrame(this.pinRaf);
    if (this.pinSmoothTimer) { window.clearTimeout(this.pinSmoothTimer); this.pinSmoothTimer = 0; }
    this.pinning = true;
    const apply = () => { this.ticker.scrollTop = this.ticker.scrollHeight; };
    const gap = () => this.ticker.scrollHeight - this.ticker.scrollTop - this.ticker.clientHeight;
    const useSmooth = smooth && this.ticker.clientHeight > 8 && gap() < 160;
    this.ticker.classList.toggle("pin-smooth", useSmooth);
    apply();
    this.pinRaf = requestAnimationFrame(() => {
      this.pinRaf = 0;
      if (!force && !this.listenPin && !this.stickToBottom && !this.el.classList.contains("thinking") && !this.streamLine) {
        this.ticker.classList.remove("pin-smooth");
        this.pinning = false;
        return;
      }
      apply();
      const finish = () => {
        this.pinSmoothTimer = 0;
        this.ticker.classList.remove("pin-smooth");
        this.pinning = false;
      };
      if (this.ticker.clientHeight < 8) {
        this.pinSmoothTimer = window.setTimeout(() => {
          if (force || this.listenPin || this.stickToBottom || this.el.classList.contains("thinking") || this.streamLine) apply();
          finish();
        }, 80);
        return;
      }
      if (useSmooth) this.pinSmoothTimer = window.setTimeout(finish, 420);
      else finish();
    });
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
    paintChat(tx, init.chat, init.text);
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

function paintChat(tx: Element, role: ChatRole | undefined, text: string): void {
  if (role === "agent" || role === "think") fillMarkdown(tx, text);
  else tx.textContent = text;
}
