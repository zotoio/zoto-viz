import { formatCursorStats } from "./debug-log";
import { fillMarkdown } from "./markdown";
import { FEED_REVEAL_CPS, FEED_THINK_CPS, followScrollTop, revealStep } from "./feed-reveal";
import { nearBottom } from "./feed";
import { bindFloatPanel } from "./float-drag";
import { markFrame } from "../core/fps";

export type ChatRole = "you" | "think" | "agent";

export interface ChatDisplay {
  role: ChatRole;
  shown: string;
  want: string;
  done: boolean;
}

export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  usage?: Record<string, unknown>;
}

export interface ChatConfig {
  on: boolean;
  textSize: number;
}

export const DEFAULT_CHAT: ChatConfig = {
  on: true,
  textSize: 12,
};

const ASK_PLACEHOLDER = "Discuss a view, source, or plugin… Enter to send";
const EMPTY_HINT = "chat with the local agent…";
const CHAT_CAP = 4000;
const CHAT_COLOR: Record<ChatRole, string> = {
  you: "#29b6f6",
  think: "#90a4ae",
  agent: "#66bb6a",
};
const CHAT_LABEL: Record<ChatRole, string> = { you: "you", think: "think", agent: "agent" };

interface Line {
  want: string;
  shown: string;
  role: ChatRole;
  el: HTMLDivElement;
}

/** Agent conversation beside the graph. Separate from the packet feed. */
export class ChatPanel {
  readonly el: HTMLElement;
  readonly ask: HTMLTextAreaElement;
  private cfg: ChatConfig = { ...DEFAULT_CHAT };
  private readonly ticker: HTMLDivElement;
  private readonly composer: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private lines: Line[] = [];
  private streamLine: Line | null = null;
  private streamRole: ChatRole | null = null;
  private streamOpen = false;
  private revealDone = true;
  private raf = 0;
  private lastTick = 0;
  private stickToBottom = true;
  private followTick = false;
  private lastScrollTop = 0;
  private listenPin = false;
  onDisplay?: (info: ChatDisplay) => void;
  onSend?: (text: string) => boolean | void;
  onMicDown?: () => void;
  onMicUp?: () => void;

  constructor(host: HTMLElement) {
    this.el = host;
    this.el.className = "livefeed livechat chat-log transcript";
    this.el.innerHTML = `
      <div class="float-handle">chat</div>
      <div class="feed-panel">
        <div class="feed-welcome" hidden>
          <p>Talk through an idea, then ask the agent to build a plugin, add a source, or change the visualisation.</p>
        </div>
        <div class="feed-ticker" aria-label="agent chat"></div>
        <div class="feed-composer">
          <textarea class="feed-ask" rows="2" placeholder="${ASK_PLACEHOLDER}" aria-label="message"></textarea>
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
    this.hint = this.el.querySelector(".feed-hint")!;
    bindFloatPanel(this.el, this.el.querySelector(".float-handle")!, "chat", { min: { w: 240, h: 180 } });
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
    this.composer.querySelector(".feed-send")!.addEventListener("click", () => this.submit());
    this.composer.querySelector(".feed-mic")!.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onMicDown?.();
    });
    this.composer.querySelector(".feed-mic")!.addEventListener("pointerup", () => this.onMicUp?.());
    this.composer.querySelector(".feed-mic")!.addEventListener("pointerleave", () => this.onMicUp?.());
    this.ask.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });
    this.loop = this.loop.bind(this);
  }

  setConfig(c: ChatConfig): void {
    this.cfg = { ...DEFAULT_CHAT, ...c };
    const size = Math.min(20, Math.max(10, this.cfg.textSize || DEFAULT_CHAT.textSize));
    this.cfg.textSize = size;
    this.el.style.setProperty("--feed-size", `${size}px`);
    this.el.classList.toggle("off", !this.cfg.on);
    this.el.hidden = !this.cfg.on;
    this.composer.hidden = !this.cfg.on;
    if (this.cfg.on) this.start();
    else this.stop();
    this.syncWelcome();
  }

  pushChat(role: ChatRole, chunk: string, stream = false): void {
    if (!this.cfg.on) return;
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
      this.writeStream(this.streamLine, (this.streamLine.want + text).slice(0, CHAT_CAP));
      return;
    }
    this.addLine(role, text, stream);
  }

  setListening(on: boolean): void {
    this.listenPin = on;
    this.el.classList.toggle("listening", on);
    if (on) {
      this.stickToBottom = true;
      this.hint.textContent = "listening… say send";
      this.ask.placeholder = "Listening — say send to submit";
      this.pinLatest();
    } else {
      this.ask.placeholder = ASK_PLACEHOLDER;
      if (this.hint.textContent === "listening… say send") this.hint.textContent = this.emptyHint();
    }
  }

  setThinking(on: boolean): void {
    const was = this.el.classList.contains("thinking");
    this.el.classList.toggle("thinking", on);
    this.el.setAttribute("aria-busy", on ? "true" : "false");
    if (on) {
      this.hint.textContent = "thinking…";
      if (!was && !(this.streamRole === "think" && this.streamLine)) {
        this.addLine("think", "thinking…", true);
        this.streamLine?.el.classList.add("pending");
        this.streamLine?.el.setAttribute("aria-live", "polite");
      }
      this.pinLatest();
      return;
    }
    this.dropPendingThink();
    if (this.hint.textContent === "thinking…") this.hint.textContent = this.emptyHint();
    this.syncWelcome();
  }

  seedTranscript(turns: TranscriptTurn[]): void {
    if (!this.cfg.on) return;
    if (!turns.length) {
      this.clear();
      this.snapLatest();
      this.syncWelcome();
      return;
    }
    if (this.lines.length) {
      this.pinLatest();
      return;
    }
    this.closeStream();
    for (const m of turns) {
      if (m.role === "user" && m.content) this.addLine("you", m.content, false);
      if (m.role === "assistant") {
        if (m.thinking?.trim()) this.addLine("think", m.thinking.trim(), false);
        const said = (m.content || "").replace(/```memory\n[\s\S]*?```/gi, "").trim() || m.content;
        if (said?.trim()) this.addLine("agent", said.trim(), false);
        if (m.usage) {
          const spend = formatCursorStats({ op: "chat", ...m.usage });
          if (spend) this.addLine("think", spend, false);
        }
      }
    }
    this.snapLatest();
    this.syncWelcome();
  }

  lockStream(): void {
    this.streamOpen = false;
    if (this.streamLine && this.streamLine.shown === this.streamLine.want) this.finishReveal();
  }

  /** Advance the typewriter and follow-scroll by `dt` seconds. */
  stepClock(dt: number): void {
    this.tickReveal(dt);
    this.tickFollow(dt);
  }

  flushReveal(): void {
    const line = this.streamLine;
    if (!line) return;
    line.shown = line.want;
    this.paintShown(line);
    if (!this.streamOpen) this.finishReveal();
    else this.emitDisplay(false);
  }

  snapshot(limit = 10): string[] {
    return this.lines.slice(-limit).reverse().map((l) => {
      const label = CHAT_LABEL[l.role];
      return `${label} ${l.want}`.trim().slice(0, 160);
    });
  }

  private submit(): void {
    const text = this.ask.value.trim();
    if (!text) return;
    if (this.onSend?.(text) === false) return;
    this.ask.value = "";
    this.stickToBottom = true;
    this.pinLatest();
  }

  private emptyHint(): string {
    return this.lines.length ? "" : EMPTY_HINT;
  }

  private syncWelcome(): void {
    const welcome = this.el.querySelector<HTMLElement>(".feed-welcome");
    const empty = this.cfg.on && !this.lines.length && !this.el.classList.contains("thinking");
    if (welcome) welcome.hidden = !empty;
    if (empty && !this.listenPin && this.hint.textContent !== "thinking…") this.hint.textContent = EMPTY_HINT;
    else if (!this.listenPin && this.hint.textContent === EMPTY_HINT && this.lines.length) this.hint.textContent = "";
  }

  private start(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.loop);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastTick = 0;
  }

  private loop(ts: number): void {
    this.raf = requestAnimationFrame(this.loop);
    markFrame(ts);
    const dt = this.lastTick ? Math.min(0.05, (ts - this.lastTick) / 1000) : 1 / 60;
    this.lastTick = ts;
    if (!this.cfg.on) return;
    this.tickReveal(dt);
    this.tickFollow(dt);
  }

  private addLine(role: ChatRole, text: string, stream: boolean): void {
    const clipped = text.slice(0, CHAT_CAP);
    if (!clipped.trim()) return;
    this.flushAndClose();
    const live = stream && !(role === "think" && clipped === "thinking…");
    const el = document.createElement("div");
    el.className = `row chat ${role}`;
    el.style.setProperty("--c", CHAT_COLOR[role]);
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = CHAT_LABEL[role];
    const tx = document.createElement("span");
    tx.className = "tx";
    const shown = live ? "" : clipped;
    paintChat(tx, role, shown);
    el.append(k, tx, document.createElement("span"));
    el.title = shown || clipped;
    const line: Line = { role, want: clipped, shown, el };
    this.lines.push(line);
    this.ticker.append(el);
    if (stream) {
      this.streamLine = line;
      this.streamRole = role;
      this.streamOpen = true;
      this.revealDone = false;
    }
    this.liftStream();
    this.trim();
    this.stickToBottom = true;
    this.pinLatest();
    this.syncWelcome();
    if (stream && !live) this.emitDisplay(false);
  }

  private writeStream(line: Line, text: string): void {
    line.want = text.slice(0, CHAT_CAP);
    if (!line.want.startsWith(line.shown)) line.shown = "";
    this.revealDone = false;
    this.liftStream();
  }

  private liftStream(): void {
    const line = this.streamLine;
    if (!line) return;
    if (this.lines[this.lines.length - 1] !== line) {
      this.lines = this.lines.filter((l) => l !== line);
      this.lines.push(line);
    }
    this.ticker.append(line.el);
  }

  private dropPendingThink(): void {
    if (!this.streamLine?.el.classList.contains("pending")) return;
    this.streamLine.el.remove();
    this.lines = this.lines.filter((l) => l !== this.streamLine);
    this.closeStream();
  }

  private flushAndClose(): void {
    const line = this.streamLine;
    if (!line) return;
    if (line.shown !== line.want) {
      line.shown = line.want;
      this.paintShown(line);
    }
    this.emitDisplay(true);
    this.closeStream();
    this.revealDone = true;
  }

  private closeStream(): void {
    this.streamLine = null;
    this.streamRole = null;
    this.streamOpen = false;
  }

  private clear(): void {
    this.closeStream();
    for (const l of this.lines) l.el.remove();
    this.lines = [];
  }

  private trim(): void {
    while (this.lines.length > 80) {
      if (this.lines[0] === this.streamLine) break;
      this.lines.shift()?.el.remove();
    }
  }

  private paintShown(line: Line): void {
    const tx = line.el.querySelector(".tx");
    if (tx) paintChat(tx, line.role, line.shown);
    line.el.title = line.shown || line.want;
  }

  private emitDisplay(done: boolean): void {
    const line = this.streamLine;
    if (!line) return;
    this.onDisplay?.({ role: line.role, shown: line.shown, want: line.want, done });
  }

  private finishReveal(): void {
    if (this.revealDone) return;
    this.revealDone = true;
    this.emitDisplay(true);
    this.closeStream();
  }

  private tickReveal(dt: number): void {
    const line = this.streamLine;
    if (!line) return;
    if (line.shown === line.want) {
      if (!this.streamOpen) this.finishReveal();
      return;
    }
    const cps = line.role === "think" ? FEED_THINK_CPS : FEED_REVEAL_CPS;
    const next = revealStep(line.want, line.shown, dt, cps);
    if (next === line.shown) return;
    line.shown = next;
    this.paintShown(line);
    this.emitDisplay(false);
  }

  private tickFollow(dt: number): void {
    const following = this.el.classList.contains("thinking") || !!this.streamLine;
    if (!this.listenPin && !this.stickToBottom && !following) return;
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

  private pinLatest(): void {
    this.stickToBottom = true;
  }

  private snapLatest(): void {
    this.stickToBottom = true;
    this.followTick = true;
    this.ticker.scrollTop = this.ticker.scrollHeight;
    this.lastScrollTop = this.ticker.scrollTop;
    this.followTick = false;
  }
}

function paintChat(tx: Element, role: ChatRole, text: string): void {
  if (role === "agent" || role === "think") fillMarkdown(tx, text);
  else tx.textContent = text;
}
