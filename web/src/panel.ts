import { escapeHtml, type NetScene } from "./scene";
import { ago, displayName, fmtBytes, type Device, type Flow } from "./types";

/** Detail panel. Renders once per selection and then patches text in place, so 1 Hz updates do not flicker. */
export class Panel {
  private ip: string | null = null;
  private rows = new Map<string, HTMLTableRowElement>();
  private staticHtml = "";

  constructor(private el: HTMLElement, private scene: NetScene) {
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains("close")) scene.select(null);
      const ip = t.closest<HTMLElement>("[data-ip]")?.dataset.ip;
      if (ip) scene.selectIp(ip);
    });
  }

  show(d: Device | null): void {
    if (!d) { this.el.hidden = true; this.ip = null; return; }
    const now = this.scene.currentTime;
    if (d.ip !== this.ip) this.render(d);
    this.ip = d.ip;

    // slow-changing block: only touch the DOM when its content changes
    const html = this.staticBlock(d);
    if (html !== this.staticHtml) {
      this.staticHtml = html;
      this.el.querySelector<HTMLElement>(".static")!.innerHTML = html;
    }
    setText(this.el.querySelector(".sub"), `${d.role} · ${d.online ? "online" : "offline"} · last seen ${ago(d.last_seen, now)}`);
    setText(this.el.querySelector("[data-k=traffic]"), `↓ ${fmtBytes(d.bytes_in)} · ↑ ${fmtBytes(d.bytes_out)} · ${d.packets.toLocaleString()} pkts`);
    setText(this.el.querySelector("[data-k=first]"), ago(d.first_seen, now));

    // conversations: keyed rows, patched in place, order kept stable
    const peers = this.scene.peersOf(d.ip).slice(0, 15);
    const tbody = this.el.querySelector("tbody")!;
    const seen = new Set<string>();
    for (const f of peers) {
      const other = f.a === d.ip ? f.b : f.a;
      seen.add(other);
      let row = this.rows.get(other);
      if (!row) {
        row = document.createElement("tr");
        row.innerHTML = `<td><a data-ip="${escapeHtml(other)}"></a><br><small class="peer-ip" style="color:var(--muted)"></small></td><td><b class="rate"></b><span class="bytes"></span><small class="meta"></small></td>`;
        tbody.appendChild(row);
        this.rows.set(other, row);
      }
      const od = this.scene.deviceOf(other);
      const label = od ? displayName(od) : other;
      setText(row.querySelector("a"), label);
      setText(row.querySelector(".peer-ip"), label !== other ? other : "");
      setText(row.querySelector(".rate"), f.rate > 0 ? `${fmtBytes(f.rate, true)} · ` : "");
      setText(row.querySelector(".bytes"), fmtBytes(f.bytes));
      setText(row.querySelector(".meta"), [...f.ports.slice(0, 3), ...(f.ifaces ?? [])].join(" "));
    }
    for (const [ip, row] of this.rows) if (!seen.has(ip)) { row.remove(); this.rows.delete(ip); }
    setText(this.el.querySelector("h3"), `Conversations (${peers.length})`);
    this.el.querySelector<HTMLElement>(".none")!.hidden = peers.length > 0;
    this.el.hidden = false;
  }

  private render(d: Device): void {
    this.rows.clear();
    this.staticHtml = "";
    this.el.innerHTML = `
      <span class="close" title="close">✕</span>
      <h2>${escapeHtml(displayName(d))}</h2>
      <div class="sub"></div>
      <dl class="static"></dl>
      <dl>
        <dt>Traffic</dt><dd data-k="traffic"></dd>
        <dt>First seen</dt><dd data-k="first"></dd>
      </dl>
      <h3></h3>
      <table><tbody></tbody></table>
      <div class="none" style="color:var(--muted)">none observed</div>`;
  }

  private staticBlock(d: Device): string {
    const names = d.names?.length ? d.names : d.hostnames;
    return `
      <dt>IP</dt><dd>${escapeHtml(d.ip)}${d.aliases?.length ? `<br><small style="color:var(--muted)">${d.aliases.map(escapeHtml).join("<br>")}</small>` : ""}</dd>
      ${d.mac ? `<dt>MAC</dt><dd>${escapeHtml(d.mac)}</dd>` : ""}
      ${d.ifaces?.length ? `<dt>Interface</dt><dd>${d.ifaces.map(escapeHtml).join(", ")}</dd>` : ""}
      ${d.vendor ? `<dt>Vendor</dt><dd>${escapeHtml(d.vendor)}</dd>` : ""}
      ${names?.length ? `<dt>Names</dt><dd>${names.slice(0, 6).map(escapeHtml).join("<br>")}</dd>` : ""}
      ${d.mdns_service ? `<dt>mDNS</dt><dd>${escapeHtml(d.mdns_name ?? "")}<br><small>${escapeHtml(d.mdns_service)}</small></dd>` : ""}
      ${d.ports?.length ? `<dt>Serves</dt><dd>${d.ports.slice(0, 10).map(escapeHtml).join(", ")}</dd>` : ""}
      ${d.sources?.length ? `<dt>Seen by</dt><dd>${d.sources.map(escapeHtml).join(", ")}</dd>` : ""}`;
  }
}

function setText(el: Element | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

export type { Flow };
