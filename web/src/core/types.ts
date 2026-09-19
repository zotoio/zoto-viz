import type { SourceLive } from "./sources";

export type Role = "self" | "gateway" | "lan" | "local" | "internet" | "multicast";

export interface Device {
  ip: string;
  mac: string;
  vendor: string;
  hostnames: string[];
  names: string[];
  sources: string[];
  ports: string[];
  ifaces: string[];
  aliases: string[];
  first_seen: number;
  last_seen: number;
  bytes_in: number;
  bytes_out: number;
  packets: number;
  role: Role;
  online: boolean;
  mdns_name?: string;
  mdns_service?: string;
  /** most common IPv4 TTL seen from this device when it is on our segment (passive OS hint) */
  ttl?: number | null;
  /** status of the last deep analysis, if any */
  analysis?: "running" | "done" | "error" | null;
  /** every address folded into this node by the "merge names" option (client-side; the first is `ip`) */
  members?: string[];
  /** this-host CPU / SYS views: utilisation or pressure, percent */
  cpu?: number;
  /** package or device temperature in °C when the host sampler has hwmon */
  temp?: number;
  /** RAPL / GPU watts when readable */
  watts?: number;
  /* ---- RF nodes (ap: / sta:) */
  /** network the node lives on: an AP's own SSID, the SSID of the AP a station talks to */
  ssid?: string;
  /** channel it was heard on */
  chan?: number;
  /** the monitor radio is on another channel right now: rates and online state are as last heard */
  held?: boolean;
}

/** Air SSIDs channel rotation: the watch list, the plan the hopper cycles through, where the radio is tuned. */
export interface WifiWatch {
  ssids: string[];
  other: boolean;
  dwell: number;
  rotate: boolean;
  iface: string;
  /** channel / MHz / width the monitor radio is on now (0 when there is no monitor radio) */
  tuned: number;
  freq: number;
  width: number;
  /** when it got there (epoch s) */
  since: number;
  /** channel changes seen so far: 0 with a multi-slot plan means the root hopper is not running */
  hops: number;
  /** the associated network's channel */
  home: number;
  /** SSIDs the current channel carries, per the plan */
  slot: string[];
  next: { chan: number; ssids: string[] } | null;
  plan: { chan: number; freq: number; width: number; ssids: string[] }[];
}

/** Comma-separated address list for /api/traffic: all members of a merged node, or the address itself. */
export function idsOf(d: Device | undefined, ip: string): string {
  return d?.members?.length ? d.members.join(",") : ip;
}

/* ---- deep analysis (/api/forensics) */

export type StepName = "identity" | "mdns" | "netbios" | "upnp" | "ports" | "tls";
export const STEP_ORDER: StepName[] = ["identity", "mdns", "netbios", "upnp", "ports", "tls"];

export interface Step<T = unknown> {
  status: "running" | "done" | "skipped" | "error";
  started?: number;
  took?: number;
  reason?: string;
  data?: T;
}

export interface IdentityData { rdns: string[]; mdns_host: string; ttl_hint: string; passive: Facts }
export interface MdnsService { type: string; name: string; host: string; port: number; txt: string[] }
export interface MdnsData { services: MdnsService[]; hints: Record<string, string> }
export interface NetbiosData { names: { name: string; suffix: string }[]; groups: { name: string; suffix: string }[]; mac: string; raw: string[] }
export interface UpnpDevice {
  location: string; error?: string; deviceType?: string; friendlyName?: string; manufacturer?: string; manufacturerURL?: string;
  modelName?: string; modelNumber?: string; modelDescription?: string; modelURL?: string; serialNumber?: string; UDN?: string;
  presentationURL?: string; services?: string[]; embedded?: { deviceType?: string; friendlyName?: string; modelName?: string }[];
}
export interface UpnpData { responses: Record<string, string>[]; devices: UpnpDevice[]; error?: string }
export interface PortEntry {
  port: number; proto: string; state: string; service: string; product: string; version: string; extra: string; tunnel: string;
  cpe: string[]; scripts: Record<string, string>;
}
export interface PortsData {
  command: string; took: number; ports: PortEntry[]; hostscripts: Record<string, string>; os: { name: string; accuracy: number }[];
  privileged: boolean; state?: string; closed?: { state: string; count: number }; uptime?: { seconds: number; lastboot: string }; error?: string;
}
export interface CertInfo {
  port: number; error?: string; subject?: string; issuer?: string; not_before?: string; not_after?: string; serial?: string;
  sans: string[]; protocol?: string; cipher?: string; self_signed?: boolean;
}
export interface TlsData { certs: CertInfo[] }

export interface Facts {
  local: boolean; role: string; aliases: string[]; mac: string; vendor: string; names: string[]; ttl: number | null;
  ports_seen: string[]; serves: string[]; ifaces: string[];
}

export interface Summary {
  names: string[]; make_model: string[]; os: string[]; open_ports: string[]; services_advertised: string[]; cert_names: string[];
  counts: { open_ports: number; mdns: number; upnp: number; certs: number };
}

export interface ForensicsJob {
  ip: string;
  status: "none" | "running" | "done" | "error";
  started?: number;
  finished?: number | null;
  error?: string;
  facts?: Facts;
  steps?: Partial<Record<StepName, Step>>;
  summary?: Summary | null;
}

export interface Flow {
  a: string;
  b: string;
  bytes: number;
  packets: number;
  ports: string[];
  protos: string[];
  ifaces: string[];
  first_seen: number;
  last_seen: number;
  rate: number;
  /** bytes/s a→b (sorted endpoints); missing on older snapshots */
  rate_ab?: number;
  /** bytes/s b→a */
  rate_ba?: number;
}

export interface Stats {
  pps: number;
  bps: number;
  packets: number;
  bytes: number;
  devices: number;
  online: number;
  flows: number;
  active_flows: number;
}

export interface RfView {
  devices: Device[];
  flows: Flow[];
  hub: string;
  self: string;
  /** wifi view only */
  watch?: WifiWatch;
  /** CPU view: package temp / RAPL / GPU watts for look overlays */
  thermal?: { pkg_c?: number; rapl_w?: number; gpu_w?: number; zones?: { name: string; c: number }[] };
}

/** One capture interface for the header lights (State.link_status in the monitor). */
export interface LinkStatus {
  name: string;
  kind: "wifi" | "monitor" | "bridge" | "tunnel" | "ethernet" | "gone";
  /** up = link up and frames in the last few seconds; idle = up but quiet or not capturing; down = no carrier / gone */
  state: "up" | "idle" | "down";
  /** short reason when not up ("not associated", "quiet for 40 s", "interface gone") */
  why: string;
  capturing: boolean;
  up: boolean;
  carrier: boolean;
  operstate: string;
  addrs: string[];
  /** frames captured on it in the last second */
  pps: number;
  last_packet: number;
  /** managed radio: the SSID it is joined to; monitor radio: the channel it is tuned to */
  ssid?: string;
  chan?: number;
}

/** The gateway light: ping plus neighbour cache plus captured traffic (State.gateway_status in the monitor). */
export interface GatewayStatus {
  ip: string;
  state: "up" | "degraded" | "down" | "unknown";
  rtt_ms: number | null;
  neigh: string;
  dev: string;
  mac: string;
  checked: number;
  last_ok: number;
  last_packet: number;
}

export interface StateMsg {
  type: "state";
  ts: number;
  iface: string;
  interfaces: string[];
  links?: LinkStatus[];
  network: string;
  local_ip: string;
  gateway: string;
  gateway_status?: GatewayStatus;
  uptime: number;
  stats: Stats;
  devices: Device[];
  flows: Flow[];
  views?: Partial<Record<string, RfView>>;
  live?: {
    seq: number;
    patch?: Record<string, unknown>;
    temper?: number;
    weather?: string;
    prefix?: string;
  };
  /** Backend and host shadow extensions (e.g. typesafe Sense results). */
  plugin_state?: Record<string, unknown>;
  sources?: Record<string, SourceLive>;
  /** Google Nest Device Access (redacted). */
  sdm?: {
    linked?: boolean;
    pcm_url?: string | null;
    error?: string;
    devices?: Array<{
      id: string;
      label: string;
      room?: string;
      type?: string;
      camera?: boolean;
      webrtc?: boolean;
    }>;
    events?: Array<{
      ts?: string;
      device?: string;
      kinds?: string[];
      event_id?: string;
    }>;
    client_id?: string;
    enterprise_id?: string;
  };
}

/**
 * One captured packet as served by /api/traffic: [time, direction, peer, protocol, service port tag, bytes, interface,
 * info, "src→dst" ports, member?]. `member` is present when `ip` was a group: the address in the group this packet
 * belongs to (the other end being `peer`).
 */
export type Packet = [t: number, dir: "in" | "out", peer: string, proto: string, port: string, size: number, iface: string, info: string, ports: string, member?: string];

export interface TrafficMsg {
  ip: string;
  /** set when the response is scoped to one conversation */
  peer: string | null;
  ts: number;
  packets: Packet[];
  window: { first: number; last: number; count: number } | null;
  summary: {
    protos: [string, number][];
    ports: [string, number][];
    queries: [string, number][];
    sni: [string, number][];
    peers: [string, number][];
  };
}

export const ROLE_COLOR: Record<Role, number> = {
  self: 0x42a5f5,
  gateway: 0xff7043,
  lan: 0x66bb6a,
  local: 0x26c6da,
  internet: 0xab47bc,
  multicast: 0x9e9e9e,
};

/** What a node *is*, as opposed to where it sits (role). Used for default sphere colour. */
export type DeviceKind =
  | "self" | "gateway" | "local"
  | "computer" | "phone" | "tablet"
  | "tv" | "speaker" | "light" | "camera"
  | "printer" | "wifi" | "iot" | "lan"
  | "internet" | "multicast";

export const KIND_ORDER: DeviceKind[] = [
  "self", "gateway", "computer", "phone", "tablet", "tv", "speaker",
  "light", "camera", "printer", "wifi", "iot", "local", "lan", "internet", "multicast",
];

export const KIND_LABEL: Record<DeviceKind, string> = {
  self: "this host",
  gateway: "gateway",
  computer: "computer",
  phone: "phone",
  tablet: "tablet",
  tv: "TV / cast",
  speaker: "speaker",
  light: "light",
  camera: "camera",
  printer: "printer",
  wifi: "Wi-Fi / AP",
  iot: "IoT",
  local: "local (docker / vm)",
  lan: "LAN",
  internet: "service",
  multicast: "multicast",
};

export const KIND_COLOR: Record<DeviceKind, number> = {
  self: 0x42a5f5,
  gateway: 0xff7043,
  computer: 0x29b6f6,
  phone: 0xec407a,
  tablet: 0xce93d8,
  tv: 0x7e57c2,
  speaker: 0x26a69a,
  light: 0xffca28,
  camera: 0xef5350,
  printer: 0x8d6e63,
  wifi: 0x66bb6a,
  iot: 0xffa726,
  local: 0x26c6da,
  lan: 0x9ccc65,
  internet: 0xab47bc,
  multicast: 0x78909c,
};

/** Classify a device from vendor, names, mDNS type and ports. Role wins for self / gateway / local / internet. */
export function deviceKind(d: Device): DeviceKind {
  if (d.ip.startsWith("ap:")) return "wifi";
  if (d.ip.startsWith("bt:")) {
    const blob = [d.vendor, ...(d.names ?? []), ...(d.hostnames ?? [])].join(" ").toLowerCase();
    if (/hue|bulb|light|lifx|nanoleaf/i.test(blob)) return "light";
    if (/tv|display|chromecast/i.test(blob)) return "tv";
    if (/pixel|iphone|android|phone/i.test(blob)) return "phone";
    if (/buds|headset|headphone|speaker/i.test(blob)) return "speaker";
    if (/keyboard|mouse|hid/i.test(blob)) return "iot";
    return "iot";
  }
  if (d.role === "self") return "self";
  if (d.role === "gateway") return "gateway";
  if (d.role === "local") return "local";
  if (d.role === "multicast") return "multicast";
  if (d.role === "internet") return "internet";
  const blob = [d.vendor, ...(d.names ?? []), ...(d.hostnames ?? []), d.mdns_name, d.mdns_service]
    .filter(Boolean).join(" ").toLowerCase();
  const ports = (d.ports ?? []).join(" ");
  if (/chromecast|bravia|webos|roku|fire.?tv|apple.?tv|android.?tv|smart.?tv|shield android|_googlecast/i.test(blob)) return "tv";
  if (/google.?home|nest.?mini|nest.?audio|homepod|echo dot|echo |sonos|_spotify-connect|_raop|_airplay/i.test(blob)) return "speaker";
  if (/lifx|philips.?hue|_hue|_hap|nanoleaf|govee|wiz /i.test(blob)) return "light";
  if (/printer|deskjet|laserjet|officejet|hewlett|hp inc|epson|brother|lexmark|_ipp|_pdl-datastream|_printer/i.test(blob) || /tcp\/9100|tcp\/631/.test(ports)) return "printer";
  if (/unifi|ubiquiti|eero|orbi|nest.?wifi|access.?point|mesh point|asus.*rt-|tp-link.*ap/i.test(blob)) return "wifi";
  if (/ipad|pixel.?tablet|galaxy.?tab/i.test(blob)) return "tablet";
  if (/iphone|android|pixel(?!book)|galaxy s|oneplus|pixel-\d/i.test(blob)) return "phone";
  if (/macbook|imac|mac mini|thinkpad|xps|latitude|inspiron|laptop|desktop|windows|linux/i.test(blob)) return "computer";
  if (/camera|doorbell|ring |wyze|unifi.?protect|hikvision|reolink|_axis-video|tcp\/554/.test(blob + " " + ports)) return "camera";
  if (/espressif|esp[_0-9]|shelly|tuya|sonoff|iot|smart.?plug/i.test(blob)) return "iot";
  return "lan";
}

export function fmtBytes(n: number, perSec = false): string {
  const u = ["B", "kB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}${perSec ? "/s" : ""}`;
}

const PTR_NAME = /\.(in-addr|ip6)\.arpa$/i;
const MDNS_TYPE = /(?:^_|.*\.)_[a-z0-9-]+\._(tcp|udp|tls)\./i;
/** Default mDNS hostnames many phones/TVs share — not a unique identity. */
const GENERIC_HOST = /^(android|iphone|ipad|ipod|macintosh|macbook|macbook-air|macbook-pro|mac|imac|samsung|lgwebostv|desktop|laptop|pc)(-\d+)?(\.local|\.lan)?$/i;
const UUID_HOST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.local|\.lan)?$/i;
const HEX32_HOST = /^[0-9a-f]{32}(\.local|\.lan)?$/i;
const IP_HOST = /^\d{1,3}(-\d{1,3}){3}\.local$/i;
const WEAK_INSTANCE = /^(adb-unidentified|nearby-presence-nsd-)/i;

/** DNS-SD / avahi escaping: \\032 space, \\091 '[', \\. a literal dot. */
export function unescapeDns(name: string): string {
  return name.replace(/\\032/g, " ").replace(/\\\./g, ".").replace(/\\(\d{3})/g, (_, n) => String.fromCharCode(Number(n) % 256));
}

/** `usefulName` verdicts by exact string; a snapshot re-asks the same few thousand names every second. */
const USEFUL_MEMO = new Map<string, boolean>();
const USEFUL_MEMO_MAX = 8192;

/** Hostnames worth showing; drop PTR names, mDNS service types, and service-instance FQDNs. */
export function usefulName(name: string | undefined | null): boolean {
  if (!name) return false;
  const hit = USEFUL_MEMO.get(name);
  if (hit !== undefined) return hit;
  const v = computeUsefulName(name);
  if (USEFUL_MEMO.size >= USEFUL_MEMO_MAX) USEFUL_MEMO.clear();
  USEFUL_MEMO.set(name, v);
  return v;
}

function computeUsefulName(name: string): boolean {
  const n = name.trim().replace(/\.+$/, "");
  if (!n || n === "." || n === "*") return false;
  if (n.startsWith("*") && !n.startsWith("*.")) return false;
  if (PTR_NAME.test(n) || n.toLowerCase().endsWith(".arpa")) return false;
  if (n.startsWith("_") && n.includes("._")) return false;
  if (MDNS_TYPE.test(n) || /\._(tcp|udp|tls)\./i.test(n)) return false;
  if (/^[\d.]+$/.test(n)) return false;
  if (UUID_HOST.test(n) || HEX32_HOST.test(n)) return false;
  return true;
}

/** Shared factory names (Android.local) and mesh IDs — do not collapse devices on these. */
export function isWeakHostName(name: string): boolean {
  const s = name.trim().replace(/\.+$/, "");
  if (!s || s.startsWith("*")) return true;
  return GENERIC_HOST.test(s) || UUID_HOST.test(s) || HEX32_HOST.test(s) || IP_HOST.test(s) || WEAK_INSTANCE.test(s);
}

function nameRank(n: string): number {
  if (n.startsWith("*.")) return 50;
  if (n.startsWith("*")) return 60;
  if (WEAK_INSTANCE.test(n)) return 45;
  if (GENERIC_HOST.test(n)) return 40;
  if (UUID_HOST.test(n) || HEX32_HOST.test(n)) return 35;
  if (IP_HOST.test(n)) return 32;
  return 10;
}

export function usefulAlias(ip: string | undefined | null): boolean {
  return !!ip && ip !== "::" && ip !== "0.0.0.0" && ip !== "::1" && !ip.startsWith("127.");
}

interface NameMemo {
  names: string[] | undefined;
  nLen: number;
  hosts: string[] | undefined;
  hLen: number;
  mdns: string | undefined;
  ip: string;
  name: string;
}

/**
 * `displayName` runs a dozen regexes per candidate name and is called for every device on every
 * visibility pass (filters, labels, matchers). Devices arrive as fresh objects each snapshot, so a
 * WeakMap keyed on the object is a natural per-snapshot memo; the signature guards the few places
 * that push onto `names` / `hostnames` in place after construction.
 */
const NAME_MEMO = new WeakMap<Device, NameMemo>();

function computeDisplayName(d: Device): string {
  const names = (d.names ?? []).map(unescapeDns).filter(usefulName);
  const hosts = (d.hostnames ?? []).map(unescapeDns).filter(usefulName);
  const mdns = d.mdns_name ? unescapeDns(d.mdns_name) : "";
  const seen = new Set<string>();
  const cand: string[] = [];
  for (const x of [...names, ...hosts, ...(usefulName(mdns) ? [mdns] : [])]) {
    if (seen.has(x)) continue;
    seen.add(x);
    cand.push(x);
  }
  if (!cand.length) return d.ip;
  cand.sort((a, b) => nameRank(a) - nameRank(b) || a.length - b.length || a.localeCompare(b));
  return cand[0];
}

export function displayName(d: Device): string {
  const m = NAME_MEMO.get(d);
  if (
    m && m.names === d.names && m.nLen === (d.names?.length ?? 0) && m.hosts === d.hostnames &&
    m.hLen === (d.hostnames?.length ?? 0) && m.mdns === d.mdns_name && m.ip === d.ip
  ) return m.name;
  const name = computeDisplayName(d);
  NAME_MEMO.set(d, {
    names: d.names, nLen: d.names?.length ?? 0, hosts: d.hostnames, hLen: d.hostnames?.length ?? 0,
    mdns: d.mdns_name, ip: d.ip, name,
  });
  return name;
}

export function ago(ts: number, now: number): string {
  if (!ts) return "never";
  const s = Math.max(0, now - ts);
  if (s < 5) return "now";
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h ago`;
  return `${(s / 86400).toFixed(1)}d ago`;
}
