export type Role = "self" | "gateway" | "lan" | "internet" | "multicast";

export interface Device {
  ip: string;
  mac: string;
  vendor: string;
  hostnames: string[];
  names: string[];
  sources: string[];
  ports: string[];
  first_seen: number;
  last_seen: number;
  bytes_in: number;
  bytes_out: number;
  packets: number;
  role: Role;
  online: boolean;
  mdns_name?: string;
  mdns_service?: string;
}

export interface Flow {
  a: string;
  b: string;
  bytes: number;
  packets: number;
  ports: string[];
  protos: string[];
  first_seen: number;
  last_seen: number;
  rate: number;
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

export interface StateMsg {
  type: "state";
  ts: number;
  iface: string;
  network: string;
  local_ip: string;
  gateway: string;
  uptime: number;
  stats: Stats;
  devices: Device[];
  flows: Flow[];
}

export const ROLE_COLOR: Record<Role, number> = {
  self: 0x42a5f5,
  gateway: 0xff7043,
  lan: 0x66bb6a,
  internet: 0xab47bc,
  multicast: 0x9e9e9e,
};

export function fmtBytes(n: number, perSec = false): string {
  const u = ["B", "kB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}${perSec ? "/s" : ""}`;
}

export function displayName(d: Device): string {
  const n = d.names?.find((x) => !x.startsWith("*")) ?? d.hostnames?.[0] ?? d.mdns_name;
  return n ?? d.ip;
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
