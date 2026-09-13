import { escapeHtml, type NetScene } from "../graph/scene";
import { rIp, rName, rText, redaction } from "../core/redact";
import { displayName, fmtBytes, idsOf, type Packet, type TrafficMsg } from "../core/types";
import { decodePacket } from "./decode";
import { TraceModal } from "./trace";

const POLL_MS = 2000;

/**
 * "Captured traffic" section of the detail panel: what a device actually does on the wire.
 * Polls /api/traffic for the selected device and shows rolling counters (protocols, ports, the names it
 * asks DNS/mDNS for, TLS servers it talks to, top peers) as clickable chips over a live packet list.
 * Clicking a chip filters the packet list; the filter box does the same for free text.
 */
export class TrafficView {
  readonly el: HTMLDivElement;
  private ip: string | null = null;
  /** when set, the view is scoped to the conversation ip <-> peer */
  private peer: string | null = null;
  private timer: number | null = null;
  private last: TrafficMsg | null = null;
  private filter = "";
  private paused = false;
  private inflight = false;
  /** packets currently in the table, in row order (rows carry their index in data-i) */
  private shown: Packet[] = [];
  private readonly trace: TraceModal;

  constructor(private scene: NetScene) {
    this.trace = new TraceModal(scene);
    this.el = document.createElement("div");
    this.el.className = "traffic";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="thead">
        <h3>Captured traffic <span class="count"></span></h3>
        <label class="filter"><input type="search" placeholder="filter packets…" spellcheck="false" /></label>
        <button type="button" class="btn small pause" title="pause live updates">pause</button>
      </div>
      <div class="scope" hidden>
        <button type="button" class="btn small all" title="back to everything this device sends and receives">◂ all traffic</button>
        <span class="with">conversation with <a class="peer" data-ip=""></a></span>
      </div>
      <div class="summary"></div>
      <div class="pk"><table><thead><tr><th>time</th><th></th><th>peer</th><th>type</th><th>port</th><th class="n">bytes</th><th>info</th></tr></thead><tbody></tbody></table></div>
      <div class="empty" hidden>no packets captured for this device yet</div>`;

    const input = this.el.querySelector<HTMLInputElement>("input")!;
    input.addEventListener("input", () => { this.filter = input.value.trim().toLowerCase(); this.renderPackets(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") { input.value = ""; this.filter = ""; this.renderPackets(); input.blur(); } e.stopPropagation(); });
    this.el.querySelector<HTMLButtonElement>(".pause")!.addEventListener("click", (e) => {
      this.paused = !this.paused;
      (e.currentTarget as HTMLElement).textContent = this.paused ? "resume" : "pause";
      (e.currentTarget as HTMLElement).classList.toggle("on", this.paused);
      if (!this.paused) void this.poll();
    });
    this.el.querySelector(".summary")!.addEventListener("click", (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>(".chip");
      if (!chip) return;
      if (chip.dataset.peer !== undefined && this.ip) {
        // a peer chip narrows the view to that conversation instead of text-filtering
        e.stopPropagation();
        this.open(this.ip, chip.dataset.peer);
        return;
      }
      const f = chip.dataset.filter ?? "";
      input.value = this.filter === f.toLowerCase() ? "" : f;
      this.filter = input.value.toLowerCase();
      this.renderPackets();
    });
    this.el.querySelector<HTMLButtonElement>(".all")!.addEventListener("click", () => { if (this.ip) this.open(this.ip, null); });
    // the info cell of a packet opens the full bidirectional trace of that conversation, focused on that packet
    this.el.querySelector("tbody")!.addEventListener("click", (e) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>("td.i");
      if (!td || !this.ip) return;
      const p = this.shown[Number(td.closest<HTMLElement>("tr")!.dataset.i)];
      if (p) this.trace.open(this.ip, p[2], p);
    });
  }

  get isOpen(): boolean { return !this.el.hidden; }
  get currentPeer(): string | null { return this.peer; }

  /** Show traffic for `ip`; with `peer`, only the conversation between the two. */
  open(ip: string, peer: string | null = null): void {
    if (this.ip !== ip || this.peer !== peer) {
      this.ip = ip;
      this.peer = peer;
      this.last = null;
      this.el.querySelector("tbody")!.innerHTML = "";
      this.el.querySelector(".summary")!.innerHTML = "";
      this.el.querySelector<HTMLElement>(".count")!.textContent = "";
      this.renderScope();
    }
    this.el.hidden = false;
    if (this.timer === null) this.timer = window.setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
  }

  private renderScope(): void {
    const scope = this.el.querySelector<HTMLElement>(".scope")!;
    scope.hidden = !this.peer;
    if (!this.peer) return;
    const a = scope.querySelector<HTMLAnchorElement>("a.peer")!;
    const d = this.scene.deviceOf(this.peer);
    const n = d ? displayName(d) : this.peer;
    a.textContent = n === this.peer ? rIp(this.peer) : rName(n);
    a.title = rIp(this.peer);
    a.dataset.ip = this.peer;
  }

  close(): void {
    this.el.hidden = true;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  /** Re-render from the last response (e.g. redaction toggled, names learned). */
  refresh(): void {
    this.renderScope();
    if (this.last) this.render(this.last);
    this.trace.refresh();
  }

  private async poll(): Promise<void> {
    if (!this.ip || this.paused || this.inflight) return;
    this.inflight = true;
    const ip = this.ip, peer = this.peer;
    try {
      // a merged node ("merge names") queries every member address at once
      const ids = idsOf(this.scene.deviceOf(ip), ip), pids = peer ? idsOf(this.scene.deviceOf(peer), peer) : "";
      const r = await fetch(`/api/traffic?ip=${encodeURIComponent(ids)}${pids ? `&peer=${encodeURIComponent(pids)}` : ""}`);
      if (!r.ok) return;
      const m = (await r.json()) as TrafficMsg;
      if (this.ip !== ip || this.peer !== peer || this.el.hidden) return; // scope changed or closed while in flight
      this.last = m;
      this.render(m);
    } catch { /* server away; the next tick retries */ } finally {
      this.inflight = false;
    }
  }

  private render(m: TrafficMsg): void {
    const w = m.window;
    this.el.querySelector<HTMLElement>(".count")!.textContent = w
      ? `· ${w.count} pkts · ${spanText(w.first, w.last)}`
      : "";
    const empty = this.el.querySelector<HTMLElement>(".empty")!;
    empty.hidden = !!w;
    empty.textContent = m.peer ? "no packets captured for this conversation since the monitor started" : "no packets captured for this device yet";
    this.renderSummary(m);
    this.renderPackets();
  }

  private renderSummary(m: TrafficMsg): void {
    const s = m.summary;
    const peerLabel = (ip: string) => {
      const d = this.scene.deviceOf(ip);
      const n = d ? displayName(d) : ip;
      return n === ip ? rIp(ip) : rName(n);
    };
    // peers arrive as raw addresses; fold the ones that belong to one merged node into a single chip
    const peers = new Map<string, number>();
    for (const [k, v] of s.peers) { const r = this.scene.resolve(k); if (r !== this.ip) peers.set(r, (peers.get(r) ?? 0) + v); }
    const peerItems = [...peers.entries()].sort((x, y) => y[1] - x[1]);
    const groups: [string, string, [string, number][], (k: string) => string, (v: number) => string, boolean][] = [
      ["Protocols", "what it speaks", s.protos, (k) => k, (v) => `${v}`, false],
      ["Ports", "services involved", s.ports, (k) => k, (v) => `${v}`, false],
      ["Asks for", "DNS / mDNS queries it sends", s.queries, (k) => rName(k), (v) => `${v}`, false],
      ["TLS servers", "SNI in its Client Hellos", s.sni, (k) => rName(k), (v) => `${v}`, false],
      ["Peers", "by bytes · click for that conversation", m.peer ? [] : peerItems, peerLabel, (v) => fmtBytes(v), true],
    ];
    const html = groups
      .filter(([, , items]) => items.length)
      .map(([title, hint, items, label, fmt, isPeer]) => `
        <div class="grp">
          <div class="cap" title="${escapeHtml(hint)}">${title}</div>
          <div class="chips">${items.map(([k, v]) => `<span class="chip${isPeer ? " peer" : ""}" ${isPeer ? `data-peer="${escapeHtml(k)}"` : `data-filter="${escapeHtml(k)}"`} title="${escapeHtml(isPeer ? `${rIp(k)} · show this conversation` : k)}"><span class="k">${escapeHtml(label(k))}</span><span class="v">${escapeHtml(fmt(v))}</span></span>`).join("")}</div>
        </div>`)
      .join("");
    const box = this.el.querySelector<HTMLElement>(".summary")!;
    if (box.innerHTML !== html) box.innerHTML = html;
    for (const c of box.querySelectorAll<HTMLElement>(".chip")) c.classList.toggle("on", !!this.filter && (c.dataset.filter ?? "").toLowerCase() === this.filter);
  }

  private renderPackets(): void {
    const m = this.last;
    if (!m) return;
    const f = this.filter;
    const rows: string[] = [];
    this.shown = [];
    for (const p of m.packets) {
      if (f && !matches(p, f, this.scene)) continue;
      rows.push(this.row(p, this.shown.length));
      this.shown.push(p);
    }
    const tbody = this.el.querySelector("tbody")!;
    tbody.innerHTML = rows.join("");
    const count = this.el.querySelector<HTMLElement>(".count")!;
    if (f && m.window) count.textContent = `· ${this.shown.length} of ${m.window.count} pkts · ${spanText(m.window.first, m.window.last)}`;
  }

  private row(p: Packet, i: number): string {
    const [t, dir, peer, , port, size] = p;
    const d = this.scene.deviceOf(peer);
    const name = d ? displayName(d) : peer;
    const peerText = name === peer ? rIp(peer) : rName(name);
    const dec = decodePacket(p, this.scene);
    const infoText = dec.skip ? rText(p[7]) : dec.text;
    const raw = rText(p[7]);
    return `<tr class="${dir}" data-i="${i}">
      <td class="t">${fmtTime(t)}</td>
      <td class="d" title="${dir === "out" ? "sent by this device" : "received by this device"}">${dir === "out" ? "→" : "←"}</td>
      <td class="p"><a data-ip="${escapeHtml(peer)}" title="${escapeHtml(rIp(peer))}">${escapeHtml(peerText)}</a></td>
      <td><span class="kind" style="--c:${dec.color}">${escapeHtml(dec.label)}</span></td>
      <td>${escapeHtml(port)}</td>
      <td class="n">${size.toLocaleString()}</td>
      <td class="i" title="${escapeHtml(raw)}&#10;click for the full trace of this conversation">${escapeHtml(infoText)}</td>
    </tr>`;
  }
}

function matches(p: Packet, f: string, scene: NetScene): boolean {
  const [, dir, peer, proto, port, , iface, info] = p;
  if (dir === f || proto.toLowerCase().includes(f) || port.includes(f) || peer.includes(f) || iface.includes(f) || info.toLowerCase().includes(f)) return true;
  const d = scene.deviceOf(peer);
  return !!d && displayName(d).toLowerCase().includes(f);
}

function fmtTime(t: number): string {
  const d = new Date(t * 1000);
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0"), ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}.${String(d.getMilliseconds()).padStart(3, "0").slice(0, 1)}`;
}

function spanText(first: number, last: number): string {
  const s = Math.max(0, last - first);
  if (s < 90) return `last ${Math.round(s)}s`;
  if (s < 5400) return `last ${Math.round(s / 60)} min`;
  return `last ${(s / 3600).toFixed(1)} h`;
}
