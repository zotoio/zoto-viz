import { apiFetch } from "../core/http";
import { nearBottom } from "./feed";
import { bindFloatPanel } from "./float-drag";

export const DEBUG_STORE = "zoto-viz.debugLogs";
const POLL_MS = 800;
const MAX_LINES = 400;

export interface MonitorLogLine {
  seq: number;
  t: number;
  text: string;
}

export function readDebugOn(): boolean {
  return localStorage.getItem(DEBUG_STORE) === "1";
}

export function writeDebugOn(on: boolean): void {
  localStorage.setItem(DEBUG_STORE, on ? "1" : "0");
}

export function logsPath(after: number): string {
  return `/api/logs?after=${Math.max(0, Math.floor(Number(after) || 0))}`;
}

export function cursorStatsPath(): string {
  return "/api/ai/cursor-stats?tail=40";
}

export function formatCursorStats(row: Record<string, unknown> | null | undefined): string {
  if (!row || typeof row !== "object") return "";
  const usage = (row.usage && typeof row.usage === "object") ? row.usage as Record<string, unknown> : {};
  const billed = (row.billed && typeof row.billed === "object") ? row.billed as Record<string, unknown> : {};
  const billedUsage = (billed.usage && typeof billed.usage === "object") ? billed.usage as Record<string, unknown> : {};
  const cost = (row.cost && typeof row.cost === "object")
    ? row.cost as Record<string, unknown>
    : (billed.cost && typeof billed.cost === "object") ? billed.cost as Record<string, unknown> : {};
  const tokens = Object.keys(usage).length ? usage : billedUsage;
  const account = (row.account && typeof row.account === "object") ? row.account as Record<string, unknown> : {};
  const bits = ["cursor stats", String(row.op || "cursor")];
  if (row.model) bits.push(String(row.model));
  if (row.status) bits.push(String(row.status));
  if (tokens.inputTokens != null) bits.push(`in=${tokens.inputTokens}`);
  if (tokens.outputTokens != null) bits.push(`out=${tokens.outputTokens}`);
  if (tokens.totalTokens != null) bits.push(`total=${tokens.totalTokens}`);
  if (tokens.cacheReadTokens) bits.push(`cache=${tokens.cacheReadTokens}`);
  if (tokens.reasoningTokens) bits.push(`think=${tokens.reasoningTokens}`);
  if (cost.chargedCents != null) bits.push(`charged=${cost.chargedCents}¢`);
  if (cost.rawCostCents != null) bits.push(`raw=${cost.rawCostCents}¢`);
  if (account.apiKeyName) bits.push(`key=${account.apiKeyName}`);
  if (row.models != null) bits.push(`models=${row.models}`);
  if (row.error) bits.push(String(row.error).slice(0, 120));
  else if (typeof billed.error === "string" && billed.error) bits.push(billed.error.slice(0, 120));
  return bits.join(" ");
}

export function formatLogTime(t: number): string {
  const d = new Date((Number(t) || 0) * 1000);
  if (Number.isNaN(d.getTime()) || d.getTime() <= 0) return "--:--:--";
  return d.toLocaleTimeString(undefined, { hour12: false });
}

export class DebugLog {
  readonly el: HTMLElement;
  onClose?: () => void;
  private readonly cursor: HTMLDivElement;
  private readonly ticker: HTMLDivElement;
  private after = 0;
  private seenStats = new Set<string>();
  private timer = 0;
  private on = false;
  private stickCursor = true;
  private stick = true;

  constructor(host: HTMLElement) {
    this.el = host;
    host.classList.add("debuglog");
    host.hidden = true;
    const close = document.createElement("span");
    close.className = "close";
    close.title = "close";
    close.textContent = "✕";
    close.addEventListener("click", () => {
      if (this.onClose) this.onClose();
      else this.setOn(false);
    });
    const title = document.createElement("h2");
    title.textContent = "debug";
    bindFloatPanel(host, title, "debug", { min: { w: 280, h: 200 } });
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = "monitor log · Cursor tokens / cost";
    const cursorCap = document.createElement("h3");
    cursorCap.textContent = "Cursor";
    this.cursor = document.createElement("div");
    this.cursor.className = "debuglog-ticker debuglog-cursor";
    this.cursor.addEventListener("scroll", () => {
      this.stickCursor = nearBottom(this.cursor, 32);
    }, { passive: true });
    const monCap = document.createElement("h3");
    monCap.textContent = "monitor";
    this.ticker = document.createElement("div");
    this.ticker.className = "debuglog-ticker debuglog-monitor";
    this.ticker.addEventListener("scroll", () => {
      this.stick = nearBottom(this.ticker, 48);
    }, { passive: true });
    host.append(close, title, sub, cursorCap, this.cursor, monCap, this.ticker);
  }

  setOn(on: boolean): void {
    this.on = on;
    this.el.hidden = !on;
    document.body.classList.toggle("debug-open", on);
    writeDebugOn(on);
    if (on) this.start();
    else this.stop();
  }

  private start(): void {
    if (this.timer) return;
    void this.pull();
    this.timer = window.setInterval(() => { void this.pull(); }, POLL_MS);
  }

  private stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private async pull(): Promise<void> {
    if (!this.on) return;
    try {
      const r = await apiFetch(logsPath(this.after));
      if (!r.ok) return;
      const data = await r.json() as { seq?: number; lines?: MonitorLogLine[] };
      const rows = Array.isArray(data.lines) ? data.lines : [];
      for (const row of rows) this.append(row);
      if (typeof data.seq === "number" && data.seq > this.after) this.after = data.seq;
    } catch { /* monitor down */ }
    await this.pullCursorStats();
  }

  private async pullCursorStats(): Promise<void> {
    if (!this.on) return;
    try {
      const r = await apiFetch(cursorStatsPath());
      if (!r.ok) return;
      const data = await r.json() as { lines?: Record<string, unknown>[] };
      const rows = Array.isArray(data.lines) ? data.lines : [];
      for (const row of rows) {
        const id = String(row.id || `${row.t}:${row.op}:${row.runId || ""}`);
        if (!id || this.seenStats.has(id)) continue;
        this.seenStats.add(id);
        const text = formatCursorStats(row);
        if (!text) continue;
        this.append({ seq: this.after + 1, t: Number(row.t) || Date.now() / 1000, text }, this.cursor);
      }
    } catch { /* monitor down */ }
  }

  private append(row: MonitorLogLine, into: HTMLDivElement = this.ticker): void {
    const seq = Number(row.seq) || 0;
    if (into === this.ticker && seq <= this.after && into.childElementCount) return;
    const line = document.createElement("div");
    line.className = "debuglog-line";
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = formatLogTime(row.t);
    const tx = document.createElement("span");
    tx.className = "tx";
    tx.textContent = String(row.text || "");
    line.append(t, tx);
    into.append(line);
    const cap = into === this.cursor ? 80 : MAX_LINES;
    while (into.childElementCount > cap) into.firstElementChild?.remove();
    const stick = into === this.cursor ? this.stickCursor : this.stick;
    if (stick) into.scrollTop = into.scrollHeight;
  }

  dispose(): void {
    this.stop();
    document.body.classList.remove("debug-open");
    this.el.replaceChildren();
  }
}
