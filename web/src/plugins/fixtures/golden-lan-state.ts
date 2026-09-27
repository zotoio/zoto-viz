import type { Device, Flow, StateMsg } from "../../core/types";
import { goldenHostViewSlices } from "../golden-host-views";

const PROTOS = ["tcp", "udp", "dns", "tls", "http", "icmp"];

function lanDevice(
  ip: string,
  role: Device["role"],
  packets: number,
  over: Partial<Device> = {},
): Device {
  return {
    ip,
    mac: "aa:bb:cc:dd:ee:ff",
    vendor: "demo",
    hostnames: [],
    names: over.names ?? [ip],
    sources: ["golden"],
    ports: over.ports ?? ["tcp/443"],
    ifaces: ["eth0"],
    aliases: [],
    first_seen: 0,
    last_seen: 100,
    bytes_in: packets * 120,
    bytes_out: packets * 80,
    packets,
    role,
    online: true,
    ...over,
  };
}

function flow(a: string, b: string, rate: number, proto = "tcp"): Flow {
  return {
    a,
    b,
    bytes: rate * 80,
    packets: Math.max(1, Math.round(rate)),
    ports: ["tcp/443"],
    protos: [proto],
    ifaces: ["eth0"],
    first_seen: 0,
    last_seen: 100,
    rate,
    rate_pkt_ab: rate,
    rate_pkt_ba: Math.max(0, rate * 0.25),
  };
}

/** Modest LAN + CPU + source snapshot for change-gated screenshots when capture is quiet. */
export function goldenLanFixture(): StateMsg {
  const gateway = "10.0.0.1";
  const self = "10.0.0.42";
  const lan: Device[] = [
    lanDevice(self, "self", 88, { names: ["zoto-host"], hostnames: ["zoto.local"] }),
    lanDevice(gateway, "gateway", 120, { names: ["gateway"] }),
    lanDevice("10.0.0.15", "lan", 64, { names: ["nest-cam"] }),
    lanDevice("10.0.0.22", "lan", 52, { names: ["printer"] }),
    lanDevice("10.0.0.33", "lan", 41, { names: ["tv"] }),
    lanDevice("10.0.0.51", "lan", 36, { names: ["phone"] }),
    lanDevice("10.0.0.77", "lan", 28, { ssid: "zoto-demo", chan: 36 }),
    lanDevice("8.8.8.8", "internet", 95, { names: ["dns.google"] }),
    lanDevice("1.1.1.1", "internet", 72, { names: ["cloudflare"] }),
    lanDevice("104.16.0.1", "internet", 48, { names: ["cdn"] }),
  ];

  const flows: Flow[] = [
    flow(self, gateway, 6),
    flow("10.0.0.15", gateway, 4, "udp"),
    flow("10.0.0.22", gateway, 3),
    flow("10.0.0.33", "8.8.8.8", 5, "tls"),
    flow("10.0.0.51", "1.1.1.1", 4, "dns"),
    flow(gateway, "104.16.0.1", 7, "http"),
    flow("10.0.0.77", gateway, 2, "arp"),
  ];

  const cpuHost = lanDevice("cpu:host", "self", 40, {
    names: ["zoto-host"],
    ports: ["cpu"],
    sources: ["golden"],
    cpu: 42,
    aliases: ["4 cores", "load 0.8"],
  });
  const cpuCores = [0, 1, 2, 3].map((i) => lanDevice(`cpu:${i}`, "lan", 8 + i, {
    names: [`cpu${i}`],
    ports: ["cpu"],
    sources: ["golden"],
    cpu: 18 + i * 6,
  }));
  const cpuProcs = [
    lanDevice("proc:chrome", "lan", 22, { names: ["chrome"], ports: ["cpu:1"], sources: ["golden"], cpu: 28 }),
    lanDevice("proc:node", "lan", 18, { names: ["node"], ports: ["cpu:2"], sources: ["golden"], cpu: 22 }),
    lanDevice("proc:python", "lan", 14, { names: ["python"], ports: ["cpu:0"], sources: ["golden"], cpu: 16 }),
  ];

  const hostViews = goldenHostViewSlices();

  return {
    type: "state",
    ts: 120,
    iface: "eth0",
    interfaces: ["eth0", "wlan0"],
    network: "10.0.0.0/24",
    local_ip: self,
    gateway,
    uptime: 7200,
    stats: {
      pps: 420,
      bps: 280_000,
      devices: lan.length,
      online: lan.length,
      flows: flows.length,
      active_flows: flows.length,
      packets: 12_000,
      bytes: 4_800_000,
    },
    devices: lan,
    flows,
    views: {
      wifi: {
        devices: lan.filter((d) => d.ssid),
        flows: flows.slice(0, 3),
        hub: gateway,
        self,
        watch: {
          ssids: ["zoto-demo", "guest-wifi"],
          other: false,
          dwell: 2,
          rotate: true,
          iface: "wlan0",
          tuned: 36,
          freq: 5180,
          width: 80,
          since: 0,
          hops: 1,
          home: 36,
          slot: ["zoto-demo"],
          next: null,
          plan: [],
        },
      },
      cpu: {
        devices: [cpuHost, ...cpuCores, ...cpuProcs],
        flows: [
          flow("cpu:host", "cpu:0", 3),
          flow("cpu:host", "cpu:1", 4),
          flow("proc:chrome", "cpu:1", 5),
          flow("proc:node", "cpu:2", 4),
        ],
        hub: "cpu:host",
        self: "cpu:host",
      },
      ...hostViews,
    },
    sources: {
      nasa: {
        id: "nasa",
        kind: "rss",
        label: "NASA IOTD",
        ok: true,
        feed: true,
        items: [
          {
            title: "Pillars of Creation",
            summary: "Golden demo still for carousel and feed checks.",
            image: "https://images-assets.nasa.gov/image/PIA25434/PIA25434~orig.jpg",
            link: "https://www.nasa.gov/",
          },
          {
            title: "Earth at Night",
            summary: "Second golden headline when live capture is empty.",
            image: "https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e001435/GSFC_20171208_Archive_e001435~large.jpg",
            link: "https://www.nasa.gov/",
          },
        ],
      },
      demo: {
        id: "demo",
        kind: "demo",
        label: "Demo",
        ok: true,
        feed: true,
        items: [
          { title: "Zoto viz golden seed", summary: "Live traffic wins when present." },
        ],
      },
    },
  };
}
