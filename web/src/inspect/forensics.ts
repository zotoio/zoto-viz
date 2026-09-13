import { escapeHtml, type NetScene } from "../graph/scene";
import { apiFetch } from "../core/http";
import { rIp, rMac, rName, rText, redaction } from "../core/redact";
import {
  STEP_ORDER, type CertInfo, type ForensicsJob, type IdentityData, type MdnsData, type NetbiosData, type PortsData, type Step,
  type StepName, type TlsData, type UpnpData,
} from "../core/types";

export function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

const POLL_MS = 2000;

const STEP_LABEL: Record<StepName, [string, string]> = {
  identity: ["identity", "reverse DNS, mDNS host name, passive TTL hint"],
  mdns: ["mDNS", "services the host advertises, with TXT records"],
  netbios: ["NetBIOS", "name table and workgroup"],
  upnp: ["UPnP", "SSDP discovery and the device description"],
  ports: ["ports", "nmap TCP scan with service detection and default scripts"],
  tls: ["TLS", "certificates on the TLS ports found"],
};

/**
 * "Deep analysis" section of the detail panel. Starts a forensics job on the server (POST /api/forensics),
 * polls it while it runs and renders every step's findings: identity, advertised services, UPnP description,
 * open ports with service banners and NSE script output, and TLS certificates.
 */
export class ForensicsView {
  readonly el: HTMLDivElement;
  private ip: string | null = null;
  private job: ForensicsJob | null = null;
  private timer: number | null = null;
  private inflight = false;
  /** <details> sections the user opened/closed, remembered across re-renders */
  private openSections = new Set<string>(["summary", "ports", "mdns", "upnp", "hostscripts"]);

  /** open/closed state of a <details> block, remembered so the 1 Hz re-render does not snap it shut */
  private det(id: string): string { return `data-sec="${id}"${this.openSections.has(id) ? " open" : ""}`; }

  constructor(private scene: NetScene) {
    this.el = document.createElement("div");
    this.el.className = "forensics";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="thead">
        <h3>Deep analysis <span class="count"></span></h3>
        <button type="button" class="btn small run">run</button>
      </div>
      <div class="note"></div>
      <div class="steps"></div>
      <div class="body"></div>`;
    this.el.querySelector<HTMLButtonElement>(".run")!.addEventListener("click", () => void this.start());
    this.el.querySelector(".body")!.addEventListener("toggle", (e) => {
      const d = e.target as HTMLDetailsElement;
      if (!d.dataset.sec) return;
      if (d.open) this.openSections.add(d.dataset.sec); else this.openSections.delete(d.dataset.sec);
    }, true);
  }

  get isOpen(): boolean { return !this.el.hidden; }

  open(ip: string): void {
    if (this.ip !== ip) {
      this.ip = ip;
      this.job = null;
      this.el.querySelector(".steps")!.innerHTML = "";
      this.el.querySelector(".body")!.innerHTML = "";
      this.el.querySelector(".count")!.textContent = "";
    }
    this.el.hidden = false;
    void this.poll();
  }

  close(): void {
    this.el.hidden = true;
    this.stopTimer();
  }

  /** Re-render from the last job (redaction toggled, names learned). */
  refresh(): void {
    if (this.job) this.render(this.job);
  }

  private stopTimer(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  private async start(): Promise<void> {
    if (!this.ip) return;
    const btn = this.el.querySelector<HTMLButtonElement>(".run")!;
    btn.disabled = true;
    try {
      const r = await apiFetch(`/api/forensics?ip=${encodeURIComponent(this.ip)}`, { method: "POST" });
      if (r.ok || r.status === 409) {
        this.job = (await r.json()) as ForensicsJob;
        this.render(this.job);
        this.ensurePolling();
      } else {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        this.el.querySelector(".body")!.innerHTML = `<div class="empty">${escapeHtml(err.error ?? `request failed (${r.status})`)}</div>`;
        btn.disabled = false;
      }
    } catch {
      btn.disabled = false;
    }
  }

  private ensurePolling(): void {
    if (this.timer === null) this.timer = window.setInterval(() => void this.poll(), POLL_MS);
  }

  private async poll(): Promise<void> {
    if (!this.ip || this.inflight) return;
    this.inflight = true;
    const ip = this.ip;
    try {
      const r = await fetch(`/api/forensics?ip=${encodeURIComponent(ip)}`);
      if (!r.ok) return;
      const job = (await r.json()) as ForensicsJob;
      if (this.ip !== ip || this.el.hidden) return;
      this.job = job;
      this.render(job);
      if (job.status === "running") this.ensurePolling(); else this.stopTimer();
    } catch { /* retried on the next tick */ } finally {
      this.inflight = false;
    }
  }

  // ---- rendering

  private render(job: ForensicsJob): void {
    const btn = this.el.querySelector<HTMLButtonElement>(".run")!;
    const count = this.el.querySelector<HTMLElement>(".count")!;
    const note = this.el.querySelector<HTMLElement>(".note")!;
    const running = job.status === "running";
    btn.disabled = running;
    btn.textContent = running ? "running…" : job.status === "none" ? "run analysis" : "re-run";
    btn.classList.toggle("on", running);

    const steps = job.steps ?? {};
    const done = STEP_ORDER.filter((s) => steps[s] && steps[s]!.status !== "running").length;
    const now = this.scene.currentTime;
    if (job.status === "none") count.textContent = "· not run yet";
    else if (running) count.textContent = `· running · ${done}/${STEP_ORDER.length} steps · ${Math.round(now - (job.started ?? now))}s`;
    else if (job.status === "error") count.textContent = `· failed`;
    else count.textContent = `· ${fmtWhen(job.finished ?? 0)} · took ${Math.round((job.finished ?? 0) - (job.started ?? 0))}s`;

    const local = job.facts?.local ?? true;
    note.textContent = job.status === "none"
      ? (local
        ? "Actively probes this host: mDNS / NetBIOS / SSDP queries, an nmap TCP scan of ~1,200 common ports plus any the host advertises, service detection and default NSE scripts on what is open, then the certificates on any TLS ports. Usually 30 s to 4 min; the device will see the scan."
        : "Internet host: active scanning is limited to local networks, so this only does reverse DNS and reads the certificate on TLS ports the capture saw us use.")
      : "";

    this.renderSteps(steps);
    this.renderBody(job);
  }

  private renderSteps(steps: Partial<Record<StepName, Step>>): void {
    const html = STEP_ORDER.map((s) => {
      const st = steps[s];
      const status = st?.status ?? "pending";
      const [label, hint] = STEP_LABEL[s];
      const tip = st?.reason ? `${hint}\n${text(st.reason)}` : hint;
      const took = st?.took ? `${st.took}s` : status === "running" ? "…" : status === "skipped" ? "skip" : status === "pending" ? "" : "";
      return `<span class="chip step ${status}" title="${escapeHtml(tip)}"><span class="dot"></span><span class="k">${label}</span>${took ? `<span class="v">${took}</span>` : ""}</span>`;
    }).join("");
    const box = this.el.querySelector<HTMLElement>(".steps")!;
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  private renderBody(job: ForensicsJob): void {
    const body = this.el.querySelector<HTMLElement>(".body")!;
    if (job.status === "none") { body.innerHTML = ""; return; }
    const steps = job.steps ?? {};
    const parts: string[] = [];
    if (job.status === "error") parts.push(`<div class="empty">${escapeHtml(text(job.error ?? "analysis failed"))}</div>`);
    if (job.summary) parts.push(this.section("summary", "Findings", this.summaryHtml(job)));
    const id = steps.identity;
    if (id?.data) parts.push(this.section("identity", "Identity", this.identityHtml(id.data as IdentityData, job)));
    const p = steps.ports;
    if (p?.data) parts.push(this.section("ports", `Open ports (${(p.data as PortsData).ports.length})`, this.portsHtml(p.data as PortsData)));
    else if (p && p.status !== "running") parts.push(this.section("ports", "Open ports", `<div class="empty">${escapeHtml(p.reason ?? "")}</div>`));
    const m = steps.mdns;
    if (m?.data && (m.data as MdnsData).services.length) parts.push(this.section("mdns", `mDNS services (${(m.data as MdnsData).services.length})`, this.mdnsHtml(m.data as MdnsData)));
    const u = steps.upnp;
    if (u?.data && (u.data as UpnpData).devices.length) parts.push(this.section("upnp", `UPnP (${(u.data as UpnpData).devices.length})`, this.upnpHtml(u.data as UpnpData)));
    const nb = steps.netbios;
    if (nb?.data && ((nb.data as NetbiosData).names.length || (nb.data as NetbiosData).groups.length)) parts.push(this.section("netbios", "NetBIOS", this.netbiosHtml(nb.data as NetbiosData)));
    const t = steps.tls;
    if (t?.data && (t.data as TlsData).certs.length) parts.push(this.section("tls", `TLS certificates (${(t.data as TlsData).certs.length})`, this.tlsHtml(t.data as TlsData)));
    if (job.status === "running" && parts.length === 0) parts.push(`<div class="empty">collecting…</div>`);
    const html = parts.join("");
    if (body.innerHTML !== html) body.innerHTML = html;
  }

  private section(id: string, title: string, inner: string): string {
    return `<details class="sec" ${this.det(id)}><summary>${escapeHtml(title)}</summary><div class="sec-body">${inner}</div></details>`;
  }

  private summaryHtml(job: ForensicsJob): string {
    const s = job.summary!;
    const facts = job.facts;
    const rows: [string, string][] = [];
    if (s.names.length) rows.push(["Names", s.names.map((n) => name(n)).join("<br>")]);
    if (s.make_model.length) rows.push(["Make / model", s.make_model.map(escapeHtml).join("<br>")]);
    else if (facts?.vendor) rows.push(["Vendor", escapeHtml(facts.vendor)]);
    if (s.os.length) rows.push(["OS", s.os.map(escapeHtml).join("<br>")]);
    if (s.open_ports.length) rows.push(["Open ports", chips(s.open_ports)]);
    else if (job.steps?.ports?.status === "done") rows.push(["Open ports", `<span class="muted">none in the scanned range</span>`]);
    if (s.services_advertised.length) rows.push(["Advertises", chips(s.services_advertised)]);
    if (s.cert_names.length) rows.push(["Cert names", chips(s.cert_names.map((n) => rName(n)))]);
    if (facts?.ports_seen.length) rows.push(["Seen using", chips(facts.ports_seen.slice(0, 16))]);
    if (!rows.length) return `<div class="empty">nothing beyond what the passive capture already knew</div>`;
    return `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  }

  private identityHtml(d: IdentityData, job: ForensicsJob): string {
    const rows: [string, string][] = [];
    rows.push(["Reverse DNS", d.rdns.length ? d.rdns.map((n) => name(n)).join("<br>") : `<span class="muted">no PTR record</span>`]);
    if (d.mdns_host) rows.push(["mDNS host", name(d.mdns_host)]);
    if (job.facts?.mac) rows.push(["MAC", `${escapeHtml(rMac(job.facts.mac))}${job.facts.vendor ? ` <span class="muted">${escapeHtml(job.facts.vendor)}</span>` : ""}`]);
    if (d.ttl_hint) rows.push(["TTL hint", escapeHtml(d.ttl_hint)]);
    if (job.facts?.aliases.length) rows.push(["Also", job.facts.aliases.map((a) => escapeHtml(rIp(a))).join("<br>")]);
    if (job.facts?.names.length) rows.push(["Known as", job.facts.names.slice(0, 8).map((n) => name(n)).join("<br>")]);
    return `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  }

  private portsHtml(p: PortsData): string {
    const head = [
      p.error ? `<div class="warn">${escapeHtml(text(p.error))}</div>` : "",
      `<details class="cmd" ${this.det("cmd")}><summary class="muted small">${p.took}s${p.closed ? ` · ${p.closed.count} ${p.closed.state}` : ""}${p.privileged ? "" : " · unprivileged: connect scan, no OS fingerprint"} · nmap command</summary><pre>${escapeHtml(text(p.command.replace("  ▸  ", "\n")))}</pre></details>`,
    ].join("");
    if (!p.ports.length) return `${head}<div class="empty">no open TCP ports in the scanned range</div>`;
    const rows = p.ports.map((e) => {
      const svc = [e.product, e.version, e.extra ? `(${e.extra})` : ""].filter(Boolean).join(" ");
      const scripts = Object.entries(e.scripts);
      const scriptHtml = scripts.length
        ? `<details class="scripts" ${this.det(`scripts-${e.port}`)}><summary>${scripts.length} script${scripts.length > 1 ? "s" : ""}: ${scripts.map(([k]) => escapeHtml(k)).join(", ")}</summary>${scripts.map(([k, v]) => `<div class="script"><b>${escapeHtml(k)}</b><pre>${escapeHtml(text(v))}</pre></div>`).join("")}</details>`
        : "";
      return `<tr>
        <td class="port">${e.port}<span class="muted">/${escapeHtml(e.proto)}</span>${e.tunnel ? `<span class="tunnel" title="wrapped in ${escapeHtml(e.tunnel)}">🔒</span>` : ""}</td>
        <td class="svc">${escapeHtml(e.service || "?")}</td>
        <td class="ver">${escapeHtml(svc) || `<span class="muted">${e.state}</span>`}${e.cpe.length ? `<div class="muted small">${e.cpe.map(escapeHtml).join(" ")}</div>` : ""}${scriptHtml}</td>
      </tr>`;
    }).join("");
    const host = Object.entries(p.hostscripts);
    const hostHtml = host.length
      ? `<details class="scripts host" ${this.det("hostscripts")}><summary>host scripts: ${host.map(([k]) => escapeHtml(k)).join(", ")}</summary>${host.map(([k, v]) => `<div class="script"><b>${escapeHtml(k)}</b><pre>${escapeHtml(text(v))}</pre></div>`).join("")}</details>`
      : "";
    const os = p.os.length ? `<div class="os">OS: ${p.os.map((o) => `${escapeHtml(o.name)} <span class="muted">${o.accuracy}%</span>`).join(" · ")}</div>` : "";
    const up = p.uptime ? `<div class="muted small">uptime ≈ ${fmtDur(p.uptime.seconds)} (since ${escapeHtml(p.uptime.lastboot)})</div>` : "";
    return `${head}<table class="ports"><thead><tr><th>port</th><th>service</th><th>version / banner</th></tr></thead><tbody>${rows}</tbody></table>${os}${up}${hostHtml}`;
  }

  private mdnsHtml(m: MdnsData): string {
    const hints = Object.entries(m.hints);
    const hintHtml = hints.length ? `<div class="hints">${hints.map(([k, v]) => `<span class="chip" title="${escapeHtml(k)}"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(text(v))}</span></span>`).join("")}</div>` : "";
    const rows = m.services.map((s) => `<tr>
      <td class="type">${escapeHtml(s.type)}<div class="muted small">:${s.port}</div></td>
      <td class="nm">${name(s.name)}${s.host ? `<div class="muted small">${name(s.host)}</div>` : ""}</td>
      <td class="txt">${s.txt.length ? s.txt.map((t) => `<code>${escapeHtml(text(t))}</code>`).join(" ") : ""}</td>
    </tr>`).join("");
    return `${hintHtml}<table class="mdns"><thead><tr><th>service</th><th>name</th><th>TXT</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  private upnpHtml(u: UpnpData): string {
    return u.devices.map((d) => {
      if (d.error) return `<div class="dev"><div class="muted small">${escapeHtml(text(d.location))}</div><div class="warn">${escapeHtml(text(d.error))}</div></div>`;
      const rows: [string, string][] = [];
      if (d.friendlyName) rows.push(["Name", name(d.friendlyName)]);
      if (d.manufacturer) rows.push(["Manufacturer", `${escapeHtml(d.manufacturer)}${d.manufacturerURL ? ` <span class="muted small">${escapeHtml(d.manufacturerURL)}</span>` : ""}`]);
      const model = [d.modelName, d.modelNumber].filter(Boolean).join(" ");
      if (model) rows.push(["Model", `${escapeHtml(model)}${d.modelDescription ? `<div class="muted small">${escapeHtml(d.modelDescription)}</div>` : ""}`]);
      if (d.serialNumber) rows.push(["Serial", escapeHtml(text(d.serialNumber))]);
      if (d.deviceType) rows.push(["Type", escapeHtml(d.deviceType.replace("urn:schemas-upnp-org:device:", ""))]);
      if (d.UDN) rows.push(["UDN", `<span class="small">${escapeHtml(text(d.UDN))}</span>`]);
      if (d.presentationURL) {
        const href = safeHttpUrl(d.presentationURL);
        rows.push(["Web UI", href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(rText(d.presentationURL))}</a>`
          : escapeHtml(rText(d.presentationURL))]);
      }
      if (d.services?.length) rows.push(["Services", chips(d.services)]);
      if (d.embedded?.length) rows.push(["Embedded", d.embedded.map((e) => [e.friendlyName ? name(e.friendlyName) : "", escapeHtml(e.modelName ?? ""), escapeHtml(e.deviceType?.replace("urn:schemas-upnp-org:device:", "") ?? "")].filter(Boolean).join(" · ")).join("<br>")]);
      rows.push(["Description", `<span class="small">${escapeHtml(rText(d.location))}</span>`]);
      return `<div class="dev"><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`;
    }).join("");
  }

  private netbiosHtml(nb: NetbiosData): string {
    const rows: [string, string][] = [];
    if (nb.names.length) rows.push(["Names", nb.names.map((n) => `${name(n.name)} <span class="muted small">&lt;${escapeHtml(n.suffix)}&gt;</span>`).join("<br>")]);
    if (nb.groups.length) rows.push(["Workgroups", nb.groups.map((n) => `${name(n.name)} <span class="muted small">&lt;${escapeHtml(n.suffix)}&gt;</span>`).join("<br>")]);
    if (nb.mac) rows.push(["MAC", escapeHtml(rMac(nb.mac))]);
    return `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  }

  private tlsHtml(t: TlsData): string {
    return t.certs.map((c: CertInfo) => {
      if (c.error) return `<div class="dev"><b>:${c.port}</b> <span class="warn">${escapeHtml(text(c.error))}</span></div>`;
      const rows: [string, string][] = [];
      if (c.subject) rows.push(["Subject", escapeHtml(rText(c.subject))]);
      if (c.issuer) rows.push(["Issuer", `${escapeHtml(rText(c.issuer))}${c.self_signed ? ` <span class="tag">self-signed</span>` : ""}`]);
      if (c.sans.length) rows.push(["SANs", chips(c.sans.map((n) => rName(n)))]);
      if (c.not_before || c.not_after) rows.push(["Valid", `${escapeHtml(c.not_before ?? "?")} → ${escapeHtml(c.not_after ?? "?")}${expired(c.not_after) ? ` <span class="tag warn">expired</span>` : ""}`]);
      if (c.protocol || c.cipher) rows.push(["Session", escapeHtml([c.protocol, c.cipher].filter(Boolean).join(" · "))]);
      if (c.serial) rows.push(["Serial", `<span class="small">${escapeHtml(c.serial)}</span>`]);
      return `<div class="dev"><div class="devh">port ${c.port}</div><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`;
    }).join("");
  }
}

function name(n: string): string { return escapeHtml(rName(n)); }
function text(s: string): string { return redaction.enabled ? rText(s) : s; }
function chips(items: string[]): string {
  return `<div class="chips">${items.map((i) => `<span class="chip"><span class="k">${escapeHtml(i)}</span></span>`).join("")}</div>`;
}
function expired(notAfter?: string): boolean {
  if (!notAfter) return false;
  const t = Date.parse(notAfter);
  return !Number.isNaN(t) && t < Date.now();
}
function fmtWhen(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const today = new Date().toDateString() === d.toDateString();
  return (today ? "" : `${d.toLocaleDateString()} `) + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDur(s: number): string {
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
}
