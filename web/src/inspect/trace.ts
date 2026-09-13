import { escapeHtml, type NetScene } from "../graph/scene";
import { rIp, rName, rText, redaction } from "../core/redact";
import { displayName, fmtBytes, type Packet, type TrafficMsg, idsOf } from "../core/types";
import { decodePayload, hexDump, hexToBytes, type PayloadMsg } from "./payload";

const POLL_MS = 2000;

/** a packet's identity within a conversation: its capture time and size (what /api/payload looks up) */
const keyOf = (t: number, size: number): string => `${t}|${size}`;

/**
 * Full-detail trace of one conversation in a modal: the complete captured sequence between two endpoints,
 * both directions in time order (oldest first, like Wireshark's packet list), with real source/destination
 * ports, inter-packet delta, and the un-truncated info column. Opened from a packet row in the traffic view;
 * that packet is highlighted and scrolled into view. Live by default, can be frozen, and copies as text.
 * Clicking a row expands the packet's payload: a protocol decode (TLS record layer and hellos, HTTP, DNS,
 * QUIC, DHCP, NTP, plain text) over a hex + ASCII dump of the head the monitor kept.
 */
export class TraceModal {
  private readonly el: HTMLDivElement;
  private ip: string | null = null;
  private peer: string | null = null;
  private focus: { t: number; size: number; info: string } | null = null;
  private focused = false;
  private live = true;
  private timer: number | null = null;
  private last: TrafficMsg | null = null;
  private inflight = false;
  /** packets as last rendered, oldest first, so a row click can find its packet */
  private pk: Packet[] = [];
  /** the row whose payload decode is expanded */
  private openKey: string | null = null;
  /** fetched payloads by packet key; null when the ring had already rolled past the packet */
  private readonly decoded = new Map<string, PayloadMsg | null>();
  private readonly fetching = new Set<string>();

  constructor(private scene: NetScene) {
    this.el = document.createElement("div");
    this.el.className = "modal";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="backdrop"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="conversation trace">
        <div class="mhead">
          <div class="who">
            <span class="end a"><b class="name"></b><small class="ip"></small></span>
            <span class="arrows" aria-hidden="true">⇄</span>
            <span class="end b"><b class="name"></b><small class="ip"></small></span>
          </div>
          <div class="stats"></div>
          <div class="tools">
            <button type="button" class="btn small live on" title="keep appending new packets">live</button>
            <button type="button" class="btn small copy" title="copy the trace as text">copy</button>
            <button type="button" class="btn small close" title="close (Esc)">✕</button>
          </div>
        </div>
        <div class="tbody">
          <table>
            <thead><tr><th>#</th><th>time</th><th class="n">Δ ms</th><th class="flow">direction</th><th>proto</th><th>ports</th><th class="n">bytes</th><th>info <span class="hint">click a row to decode its payload</span></th></tr></thead>
            <tbody></tbody>
          </table>
          <div class="empty" hidden>no packets captured for this conversation since the monitor started</div>
        </div>
      </div>`;
    document.body.appendChild(this.el);

    this.el.querySelector(".backdrop")!.addEventListener("click", () => this.close());
    this.el.querySelector(".close")!.addEventListener("click", () => this.close());
    this.el.querySelector<HTMLButtonElement>(".live")!.addEventListener("click", (e) => {
      this.live = !this.live;
      (e.currentTarget as HTMLElement).classList.toggle("on", this.live);
      if (this.live) void this.poll();
    });
    this.el.querySelector(".copy")!.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLElement;
      void navigator.clipboard.writeText(this.asText()).then(() => {
        btn.textContent = "copied";
        setTimeout(() => (btn.textContent = "copy"), 1200);
      });
    });
    this.el.querySelector("tbody")!.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const ip = target.closest<HTMLElement>("[data-ip]")?.dataset.ip;
      if (ip) { this.close(); this.scene.selectIp(ip); return; }
      if (window.getSelection()?.toString()) return; // selecting text in a decode must not collapse it
      const row = target.closest<HTMLElement>("tr[data-i]");
      if (!row) return;
      const p = this.pk[Number(row.dataset.i)];
      if (!p) return;
      const key = keyOf(p[0], p[5]);
      this.openKey = this.openKey === key ? null : key;
      if (this.openKey) this.ensurePayload(p);
      if (this.last) this.render(this.last);
    });
    // Escape closes the modal and must not reach the scene's "deselect" handler
    window.addEventListener("keydown", (e) => {
      if (this.el.hidden || e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.close();
    }, true);
  }

  get isOpen(): boolean { return !this.el.hidden; }

  /** Open the trace for ip <-> peer; `focus` identifies the packet that was clicked so it can be highlighted. */
  open(ip: string, peer: string, focus: Packet | null = null): void {
    this.ip = ip;
    this.peer = peer;
    this.focus = focus ? { t: focus[0], size: focus[5], info: focus[7] } : null;
    this.focused = false;
    this.last = null;
    this.pk = [];
    this.decoded.clear();
    this.fetching.clear();
    // the packet that was clicked arrives already decoded
    this.openKey = focus ? keyOf(focus[0], focus[5]) : null;
    if (focus) this.ensurePayload(focus, ip);
    this.el.querySelector("tbody")!.innerHTML = "";
    this.el.querySelector<HTMLElement>(".stats")!.textContent = "";
    this.renderHeader();
    this.el.hidden = false;
    document.body.classList.add("modal-open");
    if (this.timer === null) this.timer = window.setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
    this.el.querySelector<HTMLButtonElement>(".close")!.focus();
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    document.body.classList.remove("modal-open");
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  /** Re-render (redaction toggled, names learned). */
  refresh(): void {
    if (this.el.hidden) return;
    this.renderHeader();
    if (this.last) this.render(this.last);
  }

  private label(ip: string): { name: string; ip: string } {
    const d = this.scene.deviceOf(ip);
    const n = d ? displayName(d) : ip;
    return { name: n === ip ? rIp(ip) : rName(n), ip: rIp(ip) };
  }

  private renderHeader(): void {
    if (!this.ip || !this.peer) return;
    for (const [sel, ip] of [[".end.a", this.ip], [".end.b", this.peer]] as const) {
      const l = this.label(ip);
      const end = this.el.querySelector<HTMLElement>(sel)!;
      end.querySelector(".name")!.textContent = l.name;
      end.querySelector(".ip")!.textContent = l.name === l.ip ? "" : l.ip;
    }
  }

  private async poll(): Promise<void> {
    if (!this.ip || !this.peer || this.inflight || (!this.live && this.last)) return;
    this.inflight = true;
    const ip = this.ip, peer = this.peer;
    try {
      const ids = idsOf(this.scene.deviceOf(ip), ip), pids = idsOf(this.scene.deviceOf(peer), peer);
      const r = await fetch(`/api/traffic?ip=${encodeURIComponent(ids)}&peer=${encodeURIComponent(pids)}`);
      if (!r.ok) return;
      const m = (await r.json()) as TrafficMsg;
      if (this.ip !== ip || this.peer !== peer || this.el.hidden) return;
      this.last = m;
      this.render(m);
    } catch { /* retried on the next tick */ } finally {
      this.inflight = false;
    }
  }

  private render(m: TrafficMsg): void {
    const pk = [...m.packets].reverse(); // API is newest first; a trace reads oldest first
    const body = this.el.querySelector<HTMLElement>(".tbody")!;
    const stuckToBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    let out = 0, inn = 0, bOut = 0, bIn = 0;
    for (const p of pk) { if (p[1] === "out") { out++; bOut += p[5]; } else { inn++; bIn += p[5]; } }
    const span = pk.length > 1 ? pk[pk.length - 1][0] - pk[0][0] : 0;
    const a = this.label(this.ip!).name, b = this.label(this.peer!).name;
    this.el.querySelector<HTMLElement>(".stats")!.textContent = pk.length
      ? `${pk.length} packets over ${fmtSpan(span)} · ${a} → ${b}: ${out} pkts, ${fmtBytes(bOut)} · ${b} → ${a}: ${inn} pkts, ${fmtBytes(bIn)}${m.window && m.window.count >= 300 ? " · showing the most recent 300" : ""}`
      : "";
    this.el.querySelector<HTMLElement>(".empty")!.hidden = pk.length > 0;

    const rows: string[] = [];
    let prev: number | null = null;
    let focusIdx = -1;
    this.pk = pk;
    pk.forEach((p, i) => {
      const [t, dir, , proto, , size, iface, info, ports] = p;
      const delta = prev === null ? "" : ((t - prev) * 1000).toFixed(1);
      prev = t;
      const isFocus = !!this.focus && this.focus.t === t && this.focus.size === size && this.focus.info === info;
      if (isFocus && focusIdx < 0) focusIdx = i;
      const key = keyOf(t, size);
      const open = key === this.openKey;
      const infoText = rText(info);
      rows.push(`<tr class="${dir}${isFocus ? " focus" : ""}${open ? " open" : ""}" data-i="${i}" title="${open ? "click to collapse" : "click to decode the payload"}">
        <td class="n idx">${i + 1}</td>
        <td class="t">${fmtTime(t)}</td>
        <td class="n">${delta}</td>
        <td class="flow"><span class="lanes"><span class="lane a">${dir === "out" ? "●" : ""}</span><span class="arrow">${dir === "out" ? "⟶" : "⟵"}</span><span class="lane b">${dir === "in" ? "●" : ""}</span></span></td>
        <td>${escapeHtml(proto)}</td>
        <td class="ports">${escapeHtml(ports || "")}</td>
        <td class="n">${size.toLocaleString()}</td>
        <td class="i">${escapeHtml(infoText)}${iface ? `<small class="if">${escapeHtml(iface)}</small>` : ""}</td>
      </tr>`);
      if (open) rows.push(`<tr class="decode ${dir}"><td colspan="8">${this.decodeHtml(key)}</td></tr>`);
    });
    this.el.querySelector("tbody")!.innerHTML = rows.join("");

    if (!this.focused && focusIdx >= 0) {
      this.el.querySelector(".focus")?.scrollIntoView({ block: "center" });
      this.focused = true;
    } else if (this.focused && stuckToBottom && this.live) {
      body.scrollTop = body.scrollHeight;
    }
  }

  /** Fetch the packet's payload head once; the row re-renders when it lands. `me` overrides this.ip before open() has set it. */
  private ensurePayload(p: Packet, me: string | null = this.ip): void {
    const key = keyOf(p[0], p[5]);
    if (this.decoded.has(key) || this.fetching.has(key)) return;
    // a merged-name group answers with the member each packet belongs to; the ring is per real pair
    const ip = p[9] || me;
    const peer = p[2];
    if (!ip || !peer) return;
    this.fetching.add(key);
    const url = `/api/payload?ip=${encodeURIComponent(ip)}&peer=${encodeURIComponent(peer)}&t=${p[0]}&size=${p[5]}`;
    void fetch(url)
      .then(async (r) => (r.ok ? ((await r.json()) as PayloadMsg) : null))
      .catch(() => null)
      .then((m) => {
        this.decoded.set(key, m);
        this.fetching.delete(key);
        if (!this.el.hidden && this.openKey === key && this.last) this.render(this.last);
      });
  }

  private decodeHtml(key: string): string {
    if (!this.decoded.has(key)) return `<div class="pd"><span class="wait">decoding…</span></div>`;
    const m = this.decoded.get(key);
    if (!m) return `<div class="pd"><span class="gone">payload not available: the monitor keeps the last 300 packets of a conversation and this one has rolled out of that window</span></div>`;
    const d = decodePayload(m);
    const bytes = hexToBytes(m.payload);
    const facts = d.facts.map((f) => `<li>${escapeHtml(rText(f))}</li>`).join("");
    return `<div class="pd">
      <div class="sum"><b>${escapeHtml(rText(d.title))}</b>${d.note ? `<small>${escapeHtml(d.note)}</small>` : ""}</div>
      ${facts ? `<ul class="facts">${facts}</ul>` : ""}
      ${d.text ? `<pre class="txt">${escapeHtml(rText(d.text))}</pre>` : ""}
      ${bytes.length ? `<pre class="hex">${escapeHtml(hexDump(bytes))}</pre>` : ""}
    </div>`;
  }

  private asText(): string {
    if (!this.last || !this.ip || !this.peer) return "";
    const a = this.label(this.ip), b = this.label(this.peer);
    const lines = [`${a.name}${a.ip !== a.name ? ` (${a.ip})` : ""}  <->  ${b.name}${b.ip !== b.name ? ` (${b.ip})` : ""}`, ""];
    for (const p of [...this.last.packets].reverse()) {
      const [t, dir, , proto, , size, iface, info, ports] = p;
      lines.push(`${fmtTime(t)}  ${dir === "out" ? "->" : "<-"}  ${proto.padEnd(8)} ${(ports || "").padEnd(13)} ${String(size).padStart(6)}  ${rText(info)}${iface ? `  [${iface}]` : ""}`);
    }
    return lines.join("\n");
  }
}

function fmtTime(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function fmtSpan(s: number): string {
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  if (s < 90) return `${s.toFixed(1)} s`;
  if (s < 5400) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
