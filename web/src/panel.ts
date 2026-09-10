import { escapeHtml, type NetScene } from "./scene";
import { ago, displayName, fmtBytes, type Device } from "./types";

export class Panel {
  constructor(private el: HTMLElement, private scene: NetScene) {
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains("close")) scene.select(null);
      const ip = t.closest<HTMLElement>("[data-ip]")?.dataset.ip;
      if (ip) scene.selectIp(ip);
    });
  }

  show(d: Device | null): void {
    if (!d) { this.el.hidden = true; return; }
    const now = this.scene.currentTime;
    const peers = this.scene.peersOf(d.ip).slice(0, 12);
    const names = d.names?.length ? d.names : d.hostnames;
    const rows = peers.map((f) => {
      const other = f.a === d.ip ? f.b : f.a;
      const od = this.scene.deviceOf(other);
      const label = od ? displayName(od) : other;
      return `<tr><td><a data-ip="${escapeHtml(other)}">${escapeHtml(label)}</a>${label !== other ? `<br><small style="color:var(--muted)">${escapeHtml(other)}</small>` : ""}</td>` +
        `<td>${f.rate > 0 ? `<b>${fmtBytes(f.rate, true)}</b><br>` : ""}${fmtBytes(f.bytes)}<br><small>${escapeHtml(f.ports.slice(0, 3).join(" "))}</small></td></tr>`;
    }).join("");
    this.el.innerHTML = `
      <span class="close" title="close">✕</span>
      <h2>${escapeHtml(displayName(d))}</h2>
      <div class="sub">${escapeHtml(d.role)} · ${d.online ? "online" : "offline"} · last seen ${ago(d.last_seen, now)}</div>
      <dl>
        <dt>IP</dt><dd>${escapeHtml(d.ip)}</dd>
        ${d.mac ? `<dt>MAC</dt><dd>${escapeHtml(d.mac)}</dd>` : ""}
        ${d.vendor ? `<dt>Vendor</dt><dd>${escapeHtml(d.vendor)}</dd>` : ""}
        ${names?.length ? `<dt>Names</dt><dd>${names.slice(0, 6).map(escapeHtml).join("<br>")}</dd>` : ""}
        ${d.mdns_service ? `<dt>mDNS</dt><dd>${escapeHtml(d.mdns_name ?? "")}<br><small>${escapeHtml(d.mdns_service)}</small></dd>` : ""}
        ${d.ports?.length ? `<dt>Serves</dt><dd>${d.ports.slice(0, 10).map(escapeHtml).join(", ")}</dd>` : ""}
        <dt>Traffic</dt><dd>↓ ${fmtBytes(d.bytes_in)} · ↑ ${fmtBytes(d.bytes_out)} · ${d.packets.toLocaleString()} pkts</dd>
        <dt>First seen</dt><dd>${ago(d.first_seen, now)}</dd>
        ${d.sources?.length ? `<dt>Seen by</dt><dd>${d.sources.map(escapeHtml).join(", ")}</dd>` : ""}
      </dl>
      <h3>Conversations (${peers.length})</h3>
      <table>${rows || `<tr><td style="color:var(--muted)">none observed</td></tr>`}</table>`;
    this.el.hidden = false;
  }
}
