import { escapeHtml, type NetScene } from "../graph/scene";
import { rIp, rMac, rName } from "../core/redact";
import { KIND_LABEL, ago, deviceKind, displayName, fmtBytes, type Device, type Flow, unescapeDns, usefulAlias, usefulName } from "../core/types";
import { TrafficView } from "../inspect/traffic";
import { ForensicsView } from "../inspect/forensics";

type View = "details" | "traffic" | "analysis";

/** Detail panel. Renders once per selection and then patches text in place, so 1 Hz updates do not flicker. */
export class Panel {
  private ip: string | null = null;
  private rows = new Map<string, HTMLTableRowElement>();
  private staticHtml = "";
  private traffic: TrafficView;
  private forensics: ForensicsView;
  /** the open sub-view ("captured traffic" / "deep analysis") stays open across selections until the user goes back */
  private view: View = "details";

  constructor(private el: HTMLElement, private scene: NetScene) {
    this.traffic = new TrafficView(scene);
    this.forensics = new ForensicsView(scene);
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains("close")) scene.select(null);
      const act = t.closest<HTMLElement>("[data-act]")?.dataset.act as View | undefined;
      if (act) { this.setView(this.view === act ? "details" : act); return; }
      const ip = t.closest<HTMLElement>("[data-ip]")?.dataset.ip;
      if (ip) { scene.selectIp(ip); return; }
      // a conversation row (outside the peer's name link) opens the captured traffic of that conversation
      const peer = t.closest<HTMLElement>("tr[data-peer]")?.dataset.peer;
      if (peer) this.setView("traffic", peer);
    });
  }

  private setView(view: View, peer: string | null = null): void {
    this.view = view;
    const wide = view !== "details";
    this.el.classList.toggle("wide", wide);
    document.body.classList.toggle("panel-wide", wide && !this.el.hidden);
    this.el.querySelector<HTMLElement>(".convo")!.hidden = wide;
    for (const btn of this.el.querySelectorAll<HTMLElement>("[data-act]")) {
      const on = btn.dataset.act === view;
      btn.textContent = on ? "◂ details" : btn.dataset.label ?? "";
      btn.classList.toggle("on", on);
    }
    if (view === "traffic" && this.ip) this.traffic.open(this.ip, peer); else this.traffic.close();
    if (view === "analysis" && this.ip) this.forensics.open(this.ip); else this.forensics.close();
  }

  show(d: Device | null): void {
    if (!d) {
      this.el.hidden = true;
      this.ip = null;
      this.traffic.close();
      this.forensics.close();
      document.body.classList.remove("panel-open", "panel-wide");
      return;
    }
    const now = this.scene.currentTime;
    if (d.ip !== this.ip) {
      this.render();
      this.ip = d.ip;
      this.setView(this.view);
    } else if (this.view === "traffic") {
      this.traffic.refresh(); // names or redaction may have changed since the last poll
    } else if (this.view === "analysis") {
      this.forensics.refresh();
    }
    const badge = this.el.querySelector<HTMLElement>("[data-act=analysis] .badge");
    if (badge) {
      const st = d.analysis ?? "";
      badge.textContent = st === "done" ? "✓" : st === "running" ? "⟳" : st === "error" ? "!" : "";
      badge.className = `badge ${st}`;
    }
    this.ip = d.ip;

    setText(this.el.querySelector("h2"), shown(d));
    // slow-changing block: only touch the DOM when its content changes
    const html = this.staticBlock(d);
    if (html !== this.staticHtml) {
      this.staticHtml = html;
      this.el.querySelector<HTMLElement>(".static")!.innerHTML = html;
    }
    setText(this.el.querySelector(".sub"), `${KIND_LABEL[deviceKind(d)]} · ${d.role} · ${d.online ? "online" : "offline"} · last seen ${ago(d.last_seen, now)}`);
    setText(this.el.querySelector("[data-k=traffic]"), `↓ ${fmtBytes(d.bytes_in)} · ↑ ${fmtBytes(d.bytes_out)} · ${d.packets.toLocaleString()} pkts`);
    setText(this.el.querySelector("[data-k=first]"), ago(d.first_seen, now));

    // conversations: keyed rows, patched in place, order kept stable
    const peers = this.scene.peersOf(d.ip).slice(0, 15);
    const tbody = this.el.querySelector(".convo tbody")!;
    const seen = new Set<string>();
    for (const f of peers) {
      const other = f.a === d.ip ? f.b : f.a;
      seen.add(other);
      let row = this.rows.get(other);
      if (!row) {
        row = document.createElement("tr");
        row.dataset.peer = other;
        row.title = "show the captured packets of this conversation";
        row.innerHTML = `<td><a data-ip="${escapeHtml(other)}" title="go to this device"></a><br><small class="peer-ip" style="color:var(--muted)"></small></td><td><b class="rate"></b><span class="bytes"></span><span class="go" aria-hidden="true">▸</span><small class="meta"></small></td>`;
        tbody.appendChild(row);
        this.rows.set(other, row);
      }
      const od = this.scene.deviceOf(other);
      const label = od ? shown(od) : rIp(other);
      setText(row.querySelector("a"), label);
      setText(row.querySelector(".peer-ip"), od && displayName(od) !== other ? rIp(other) : "");
      setText(row.querySelector(".rate"), f.rate > 0 ? `${fmtBytes(f.rate, true)} · ` : "");
      setText(row.querySelector(".bytes"), fmtBytes(f.bytes));
      setText(row.querySelector(".meta"), [...f.ports.slice(0, 3), ...(f.ifaces ?? [])].join(" "));
    }
    for (const [ip, row] of this.rows) if (!seen.has(ip)) { row.remove(); this.rows.delete(ip); }
    setText(this.el.querySelector(".convo h3"), `Conversations (${peers.length})`);
    const none = this.el.querySelector<HTMLElement>(".none")!;
    none.hidden = peers.length > 0;
    none.textContent = (d.packets > 0 || d.bytes_in + d.bytes_out > 0)
      ? `none currently active · last traffic ${ago(d.last_seen, now)}`
      : "none observed";
    this.el.hidden = false;
    document.body.classList.add("panel-open");
    document.body.classList.toggle("panel-wide", this.el.classList.contains("wide"));
  }

  private render(): void {
    this.rows.clear();
    this.staticHtml = "";
    this.el.innerHTML = `
      <span class="close" title="close">✕</span>
      <h2></h2>
      <div class="sub"></div>
      <dl class="static"></dl>
      <dl>
        <dt>Traffic</dt><dd data-k="traffic"></dd>
        <dt>First seen</dt><dd data-k="first"></dd>
      </dl>
      <div class="actions">
        <button type="button" class="btn" data-act="traffic" data-label="captured traffic ▸" title="recent packets and what this device asks for / talks to">captured traffic ▸</button>
        <button type="button" class="btn" data-act="analysis" data-label="deep analysis ▸" title="active probe: port scan, service banners, mDNS / UPnP / NetBIOS details, TLS certificates"><span class="badge"></span>deep analysis ▸</button>
      </div>
      <div class="convo">
        <h3></h3>
        <table><tbody></tbody></table>
        <div class="none" style="color:var(--muted)">none observed</div>
      </div>`;
    this.el.appendChild(this.traffic.el);
    this.el.appendChild(this.forensics.el);
  }

  private staticBlock(d: Device): string {
    const names = (d.names?.length ? d.names : d.hostnames).map((n) => unescapeDns(n)).filter(usefulName);
    const aliases = (d.aliases ?? []).filter(usefulAlias);
    const mdns = d.mdns_name ? unescapeDns(d.mdns_name) : "";
    return `
      <dt>IP</dt><dd>${escapeHtml(rIp(d.ip))}${aliases.length ? `<br><small style="color:var(--muted)" title="${escapeHtml(aliases.slice(0, 60).map(rIp).join("\n"))}${aliases.length > 60 ? "\n…" : ""}">${aliases.slice(0, 5).map((a) => escapeHtml(rIp(a))).join("<br>")}${aliases.length > 5 ? `<br>+${aliases.length - 5} more` : ""}</small>` : ""}</dd>
      ${d.members && d.members.length > 1 ? `<dt>Merged</dt><dd title="the 'merge names' switch folded these addresses into one node">${d.members.length} addresses share this name</dd>` : ""}
      ${d.mac ? `<dt>MAC</dt><dd>${escapeHtml(rMac(d.mac))}</dd>` : ""}
      ${d.ifaces?.length ? `<dt>Interface</dt><dd>${d.ifaces.map(escapeHtml).join(", ")}</dd>` : ""}
      ${d.vendor ? `<dt>Vendor</dt><dd>${escapeHtml(d.vendor)}</dd>` : ""}
      ${names.length ? `<dt>Names</dt><dd>${names.slice(0, 6).map((n) => escapeHtml(rName(n))).join("<br>")}</dd>` : ""}
      ${d.mdns_service ? `<dt>mDNS</dt><dd>${escapeHtml(rName(mdns))}<br><small>${escapeHtml(d.mdns_service)}</small></dd>` : ""}
      ${d.ports?.length ? `<dt>Serves</dt><dd>${d.ports.slice(0, 10).map(escapeHtml).join(", ")}</dd>` : ""}
      ${d.ttl ? `<dt>TTL</dt><dd title="most common IPv4 TTL seen from this device; a passive OS hint (64 Linux/Android/Apple, 128 Windows, 255 network gear)">${d.ttl}</dd>` : ""}
      ${d.sources?.length ? `<dt>Seen by</dt><dd>${d.sources.map(escapeHtml).join(", ")}</dd>` : ""}`;
  }
}

/** Display name with redaction applied (IP fallback goes through the IP rule, names through the name rule). */
function shown(d: Device): string {
  const raw = displayName(d);
  return raw === d.ip ? rIp(raw) : rName(raw);
}

function setText(el: Element | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

export type { Flow };
