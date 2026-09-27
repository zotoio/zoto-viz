import type { Device, Flow, StateMsg } from "../../core/types";

const PROTOS = ["tcp", "udp", "icmp", "dns", "tls", "http", "quic", "arp"];

export interface FatLanFixtureOptions {
  deviceCount?: number;
  flowCount?: number;
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Large LAN snapshot used to exercise viz frame-budget gates. */
export function fatLanFixture(opts: FatLanFixtureOptions = {}): StateMsg {
  const deviceCount = opts.deviceCount ?? 420;
  const flowCount = opts.flowCount ?? 1200;
  const rand = mulberry32(opts.seed ?? 0x5a5a);

  const devices: Device[] = Array.from({ length: deviceCount }, (_, i) => ({
    ip: `10.${(i >> 8) & 255}.${i & 255}.${(i * 7) & 255}`,
    mac: `aa:bb:cc:${(i >> 16) & 255}:${(i >> 8) & 255}:${i & 255}`,
    vendor: "fixture",
    hostnames: [],
    names: [],
    sources: ["fixture"],
    ports: ["tcp/443"],
    ifaces: ["eth0"],
    aliases: i % 17 === 0 ? [`${-40 - (i % 30)} dBm`] : [],
    first_seen: 0,
    last_seen: 100,
    role: i % 11 === 0 ? "internet" : "lan",
    online: true,
    packets: 10 + (i % 200),
    bytes_in: 1000 + i,
    bytes_out: 500 + i,
    ssid: i % 23 === 0 ? `ssid-${i % 8}` : undefined,
    chan: i % 23 === 0 ? 36 + (i % 12) : undefined,
  }));

  const flows: Flow[] = Array.from({ length: flowCount }, (_, i) => {
    const pktRate = 1 + (i % 5);
    return {
      a: devices[Math.floor(rand() * devices.length)]!.ip,
      b: devices[Math.floor(rand() * devices.length)]!.ip,
      bytes: 100 + i,
      packets: 1 + (i % 40),
      ports: [`tcp/${443 + (i % 20)}`],
      protos: [PROTOS[i % PROTOS.length]!],
      ifaces: ["eth0"],
      first_seen: 0,
      last_seen: 100,
      rate: pktRate,
      rate_pkt_ab: pktRate,
      rate_pkt_ba: pktRate * 0.2,
    };
  });

  return {
    type: "state",
    ts: 200,
    iface: "eth0",
    interfaces: ["eth0"],
    network: "10.0.0.0/8",
    local_ip: "10.0.0.1",
    gateway: "10.0.0.254",
    uptime: 3600,
    stats: {
      pps: 12000,
      bps: 9_000_000,
      devices: devices.length,
      online: devices.length,
      flows: flows.length,
      active_flows: flows.length,
      packets: 2_000_000,
      bytes: 900_000_000,
    },
    devices,
    flows,
    views: {
      wifi: {
        devices: devices.filter((d) => d.ssid),
        flows: flows.slice(0, 40),
        hub: "10.0.0.254",
        self: "10.0.0.1",
        watch: {
          ssids: ["ssid-0", "ssid-1", "ssid-2", "ssid-3"],
          other: false,
          dwell: 2,
          rotate: true,
          iface: "wlan0",
          tuned: 36,
          freq: 5180,
          width: 80,
          since: 0,
          hops: 3,
          home: 36,
          slot: ["ssid-0"],
          next: null,
          plan: [],
        },
      },
    },
  };
}
