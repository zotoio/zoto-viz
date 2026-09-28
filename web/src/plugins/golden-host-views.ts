import type { Device, Flow } from "../core/types";

/** Deterministic pseudo-random in [0, 1) from integer seed (no Math.random). */
function unit(seed: number): number {
  let x = (seed >>> 0) * 1664525 + 1013904223;
  x >>>= 0;
  return (x & 0xfffffff) / 0x10000000;
}

function sysDevice(
  ip: string,
  name: string,
  role: Device["role"],
  over: Partial<Device> = {},
): Device {
  return {
    ip,
    mac: "",
    vendor: over.vendor ?? "sys",
    hostnames: [name],
    names: [name],
    sources: over.sources ?? ["golden"],
    ports: over.ports ?? [],
    ifaces: [],
    aliases: over.aliases ?? [],
    first_seen: 0,
    last_seen: 100,
    bytes_in: over.bytes_in ?? 0,
    bytes_out: over.bytes_out ?? 0,
    packets: over.packets ?? 1,
    role,
    online: over.online ?? true,
    cpu: over.cpu,
    temp: over.temp,
    watts: over.watts,
  };
}

function sysFlow(a: string, b: string, rate: number, proto: string): Flow {
  const x = a > b ? b : a;
  const y = a > b ? a : b;
  return {
    a: x,
    b: y,
    bytes: Math.round(rate),
    packets: 1,
    ports: [proto],
    protos: [proto],
    ifaces: [],
    first_seen: 0,
    last_seen: 100,
    rate,
  };
}

function viewSlice(hub: string, devices: Device[], flows: Flow[]) {
  return { devices, flows, hub, self: hub };
}

const HOST = "zoto-host";
const RATE = 100;

function btDevice(
  addr: string,
  name: string,
  role: Device["role"],
  rssi: number,
  over: Partial<Device> = {},
): Device {
  return {
    ip: `bt:${addr}`,
    mac: addr,
    vendor: over.vendor ?? "demo",
    hostnames: name ? [name] : [],
    names: name ? [name] : [addr],
    sources: ["golden"],
    ports: over.ports ?? ["btle/adv"],
    ifaces: ["bluetooth0"],
    aliases: [`${rssi} dBm`, ...(over.aliases ?? [])],
    first_seen: 0,
    last_seen: 100,
    bytes_in: over.bytes_in ?? 24,
    bytes_out: 0,
    packets: over.packets ?? 12,
    role,
    online: true,
    ...over,
  };
}

export function goldenBluetoothSlice() {
  const selfMac = "aa:bb:cc:dd:ee:ff";
  const self = btDevice(selfMac, "zoto-host", "self", -42, { packets: 40, vendor: "intel" });
  const peers = [
    ["11:22:33:44:55:01", "Hue bulb", -58, "signify"],
    ["11:22:33:44:55:02", "Sonos Move", -64, "sonos"],
    ["11:22:33:44:55:03", "Pixel Buds", -71, "google"],
    ["11:22:33:44:55:04", "Magic Keyboard", -55, "apple"],
    ["11:22:33:44:55:05", "Tile Mate", -78, "tile"],
    ["11:22:33:44:55:06", "WHOOP", -69, "whoop"],
  ] as const;
  const devices: Device[] = [self];
  const flows: Flow[] = [];
  for (let i = 0; i < peers.length; i++) {
    const [mac, name, rssi, vendor] = peers[i]!;
    const d = btDevice(mac, name, "lan", rssi, { vendor, packets: 8 + i });
    devices.push(d);
    flows.push(sysFlow(d.ip, self.ip, 12 + i * 2, "BTLE"));
  }
  return viewSlice(self.ip, devices, flows);
}

export function goldenMemorySlice() {
  const hub = "mem:host";
  const devices: Device[] = [
    sysDevice(hub, HOST, "self", {
      aliases: ["12.4 GiB avail", "load psi"],
      ports: ["mem"],
      vendor: "memory",
      cpu: 62,
      bytes_in: 18_000_000_000,
      bytes_out: 12_400_000_000,
      packets: 620,
    }),
  ];
  const flows: Flow[] = [];
  for (const [kind, role] of [["cpu", "lan"], ["memory", "local"], ["io", "internet"]] as const) {
    const some = 4 + unit(kind.length) * 8;
    devices.push(sysDevice(`psi:${kind}`, `psi ${kind}`, role, {
      aliases: [`${some.toFixed(2)} avg10`],
      ports: ["psi"],
      vendor: "psi",
      cpu: Math.min(100, some * 20),
      packets: Math.round(some * 40),
    }));
    flows.push(sysFlow(hub, `psi:${kind}`, some * RATE, "psi"));
  }
  devices.push(sysDevice("mem:swap", "swap", "gateway", {
    aliases: ["2.1 GiB"],
    ports: ["swap"],
    vendor: "swap",
    cpu: 18,
    bytes_in: 2_100_000_000,
    packets: 18,
  }));
  flows.push(sysFlow(hub, "mem:swap", 18 * RATE, "swap"));
  const procs = [
    ["mem:proc:1204", "chrome", 4_200_000_000],
    ["mem:proc:882", "node", 2_800_000_000],
    ["mem:proc:441", "python", 1_600_000_000],
    ["mem:proc:319", "systemd", 900_000_000],
    ["mem:proc:205", "postgres", 720_000_000],
  ] as const;
  for (let i = 0; i < procs.length; i++) {
    const [ip, name, rss] = procs[i]!;
    const pct = 100 - i * 14;
    devices.push(sysDevice(ip, name, "lan", {
      aliases: [`pid ${1000 + i}`, `${Math.round(rss / 1_000_000)} MB`],
      ports: ["rss"],
      vendor: "proc",
      cpu: pct,
      bytes_in: rss,
      packets: pct * 10,
    }));
    flows.push(sysFlow(ip, hub, pct * RATE, "rss"));
  }
  return viewSlice(hub, devices, flows);
}

export function goldenDiskSlice() {
  const hub = "disk:host";
  const devices: Device[] = [
    sysDevice(hub, HOST, "self", { ports: ["disk"], vendor: "disk", cpu: 34, aliases: ["48 MiB/s"] }),
  ];
  const flows: Flow[] = [];
  const disks = ["nvme0n1", "sda", "mmcblk0"] as const;
  for (let i = 0; i < disks.length; i++) {
    const name = disks[i]!;
    const ip = `disk:${name}`;
    const bps = 8_000_000 + i * 4_000_000;
    devices.push(sysDevice(ip, name, "lan", {
      aliases: [`${Math.round(bps / 1_000_000)} MiB/s`],
      ports: ["disk"],
      vendor: "block",
      cpu: 20 + i * 8,
      bytes_in: bps / 2,
      bytes_out: bps / 2,
      packets: Math.max(1, bps / 4096),
    }));
    flows.push(sysFlow(hub, ip, (20 + i * 8) * RATE, "disk"));
  }
  const ioProcs = [
    ["disk:proc:1204", "chrome", 12_000_000],
    ["disk:proc:882", "node", 6_500_000],
    ["disk:proc:441", "python", 4_200_000],
  ] as const;
  for (const [ip, name, bps] of ioProcs) {
    devices.push(sysDevice(ip, name, "lan", {
      aliases: [`pid ${ip.split(":").pop()}`, `${Math.round(bps / 1_000_000)} MiB/s`],
      ports: ["io"],
      vendor: "proc",
      cpu: 28,
      bytes_in: bps / 2,
      bytes_out: bps / 2,
      packets: Math.max(1, bps / 4096),
    }));
    flows.push(sysFlow(ip, hub, 28 * RATE, "io"));
  }
  return viewSlice(hub, devices, flows);
}

export function goldenGpuSlice() {
  const hub = "gpu:host";
  const devices: Device[] = [
    sysDevice(hub, HOST, "self", {
      ports: ["gpu"],
      vendor: "gpu",
      cpu: 44,
      aliases: ["2 gpu", "118 W"],
      watts: 118,
    }),
  ];
  const flows: Flow[] = [];
  const cards = [
    ["gpu:0", "NVIDIA RTX 4080", 72, 68, 12_000_000_000, 16_000_000_000, 98],
    ["gpu:1", "Intel UHD", 18, 52, 512_000_000, 2_000_000_000, 0],
  ] as const;
  for (const [ip, name, util, temp, vramU, vramT, watts] of cards) {
    devices.push(sysDevice(ip, name, "lan", {
      aliases: ["nvidia", `${temp}°C`, `${watts} W`, `${Math.round(vramU / 1e9)} / ${Math.round(vramT / 1e9)} GiB`],
      ports: ["gpu"],
      vendor: ip === "gpu:0" ? "nvidia" : "intel",
      cpu: util,
      bytes_in: vramU,
      bytes_out: vramT,
      packets: util * 10,
      watts,
      temp,
    }));
    flows.push(sysFlow(hub, ip, util * RATE, "gpu"));
  }
  return viewSlice(hub, devices, flows);
}

export function goldenSocketsSlice() {
  const hub = "sock:host";
  const devices: Device[] = [
    sysDevice(hub, HOST, "self", { ports: ["sock"], vendor: "sock", aliases: ["18 sockets"], packets: 18 }),
  ];
  const flows: Flow[] = [];
  const procs = [
    ["sock:proc:1204", "chrome", "1204"],
    ["sock:proc:882", "node", "882"],
    ["sock:proc:1", "systemd", "1"],
  ] as const;
  const peers = ["10.0.0.15", "10.0.0.33", "8.8.8.8", "1.1.1.1", "127.0.0.1"] as const;
  for (const [ip, name, pid] of procs) {
    devices.push(sysDevice(ip, name, "lan", {
      aliases: [`pid ${pid}`],
      ports: ["sock"],
      vendor: "proc",
      cpu: 8,
    }));
    flows.push(sysFlow(ip, hub, 20, "sock"));
  }
  for (let i = 0; i < peers.length; i++) {
    const peer = peers[i]!;
    const node = `sock:peer:${peer}`;
    const local = peer.startsWith("10.") || peer.startsWith("127.");
    devices.push(sysDevice(node, peer, local ? "local" : "internet", {
      aliases: [`:${443 + i}`, "state 01"],
      ports: [`${443 + i}`],
      vendor: "peer",
      cpu: 20,
    }));
    flows.push(sysFlow(procs[i % procs.length]![0], node, 40, "tcp"));
  }
  return viewSlice(hub, devices, flows);
}

export function goldenCgroupsSlice() {
  const hub = "cg:root";
  const devices: Device[] = [
    sysDevice(hub, "cgroup", "self", { ports: ["cgroup"], vendor: "cgroup", aliases: ["12 groups"] }),
  ];
  const flows: Flow[] = [];
  const slices = [
    ["cg:user.slice", "user.slice", 48],
    ["cg:user.slice/user@1000.service", "user@1000.service", 32],
    ["cg:system.slice", "system.slice", 64],
    ["cg:system.slice/docker.service", "docker.service", 22],
    ["cg:system.slice/systemd-journald.service", "systemd-journald.service", 18],
    ["cg:init.scope", "init.scope", 8],
  ] as const;
  for (const [ip, name, nproc] of slices) {
    const parent = ip.includes("/") ? ip.slice(0, ip.lastIndexOf("/")) : hub;
    const pIp = parent === "cg:root" ? hub : parent;
    if (pIp !== hub && !devices.some((d) => d.ip === pIp)) {
      devices.push(sysDevice(pIp, parent.split("/").pop() ?? parent, "gateway", {
        ports: ["cgroup"],
        vendor: "slice",
        cpu: 4,
      }));
      flows.push(sysFlow(hub, pIp, 10, "cgroup"));
    }
    devices.push(sysDevice(ip, name.split("/").pop() ?? name, "lan", {
      aliases: [`${nproc} procs`],
      ports: ["cgroup"],
      vendor: "cgroup",
      cpu: Math.min(100, nproc * 4),
      packets: nproc,
    }));
    flows.push(sysFlow(pIp, ip, Math.max(4, nproc * 4), "cgroup"));
  }
  return viewSlice(hub, devices, flows);
}

export function goldenUnitsSlice() {
  const hub = "unit:host";
  const devices: Device[] = [
    sysDevice(hub, "systemd --user", "self", {
      ports: ["unit"],
      vendor: "systemd",
      aliases: ["1 failed", "14 running"],
      cpu: 10,
    }),
  ];
  const flows: Flow[] = [];
  const units = [
    ["unit:zoto-viz.service", "zoto-viz", "active", "running", 25],
    ["unit:pipewire.service", "pipewire", "active", "running", 22],
    ["unit:docker.service", "docker", "failed", "failed", 90],
    ["unit:fwupd.service", "fwupd", "active", "running", 18],
    ["unit:ssh-agent.service", "ssh-agent", "active", "running", 20],
  ] as const;
  for (const [ip, name, active, sub, cpu] of units) {
    const failed = active === "failed";
    devices.push(sysDevice(ip, name, failed ? "internet" : "lan", {
      aliases: [sub],
      ports: [sub],
      vendor: "unit",
      cpu,
      online: !failed,
    }));
    flows.push(sysFlow(hub, ip, failed ? 80 : 18, "unit"));
  }
  return viewSlice(hub, devices, flows);
}

export function goldenUdevSlice() {
  const hub = "udev:host";
  const devices: Device[] = [
    sysDevice(hub, "udev", "self", { ports: ["udev"], vendor: "udev", aliases: ["24 devices", "6 events"], packets: 6 }),
  ];
  const flows: Flow[] = [];
  const nodes = [
    ["input/event3", "event3", "input", "present"],
    ["input/event5", "event5", "input", "new"],
    ["drm/card0", "card0", "drm", "present"],
    ["sound/card0", "card0", "sound", "present"],
    ["net/wlan0", "wlan0", "net", "present"],
    ["net/eth0", "eth0", "net", "present"],
    ["usb/1-2", "1-2", "usb", "new"],
    ["block/nvme0n1", "nvme0n1", "block", "present"],
  ] as const;
  for (const [path, leaf, kind, tag] of nodes) {
    const ip = `udev:${path}`;
    const isNew = tag === "new";
    devices.push(sysDevice(ip, leaf, isNew ? "local" : "lan", {
      aliases: [kind, tag],
      ports: [kind],
      vendor: kind,
      cpu: isNew ? 70 : 12,
      packets: isNew ? 3 : 1,
    }));
    flows.push(sysFlow(hub, ip, isNew ? 50 : 8, "udev"));
  }
  return viewSlice(hub, devices, flows);
}

export function goldenBridgeSlice(parts: {
  memory: ReturnType<typeof goldenMemorySlice>;
  disk: ReturnType<typeof goldenDiskSlice>;
  gpu: ReturnType<typeof goldenGpuSlice>;
  sockets: ReturnType<typeof goldenSocketsSlice>;
  cgroups: ReturnType<typeof goldenCgroupsSlice>;
  units: ReturnType<typeof goldenUnitsSlice>;
  udev: ReturnType<typeof goldenUdevSlice>;
}) {
  const hub = "bridge:host";
  const thermal = { pkg_c: 58, rapl_w: 42, gpu_w: 118, zones: [] };
  const devices: Device[] = [
    sysDevice(hub, HOST, "self", {
      aliases: ["58°C", "118 W", "load 0.82 0.64 0.51"],
      ports: ["bridge"],
      vendor: "bridge",
      cpu: 62,
      temp: 58,
      watts: 42,
    }),
  ];
  const flows: Flow[] = [];
  const satellites = [
    ["memory", "MEM", "local", parts.memory],
    ["disk", "DISK", "lan", parts.disk],
    ["gpu", "GPU", "gateway", parts.gpu],
    ["sockets", "SOCK", "lan", parts.sockets],
    ["cgroups", "CGROUP", "local", parts.cgroups],
    ["units", "UNITS", "lan", parts.units],
    ["udev", "DEV", "lan", parts.udev],
  ] as const;
  for (const [key, label, role, view] of satellites) {
    const satIp = `bridge:${key}`;
    const hubDev = view.devices.find((d) => d.ip === view.hub) ?? view.devices[0]!;
    devices.push(sysDevice(satIp, label, role, {
      aliases: hubDev.aliases.slice(0, 3),
      ports: [key],
      vendor: key,
      cpu: hubDev.cpu ?? 10,
      bytes_in: hubDev.bytes_in,
      bytes_out: hubDev.bytes_out,
      packets: hubDev.packets,
    }));
    flows.push(sysFlow(hub, satIp, Math.max(8, (hubDev.cpu ?? 10) * RATE * 0.4), key));
    const kids = [...view.devices]
      .filter((d) => d.ip !== view.hub)
      .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))
      .slice(0, 3);
    for (const kid of kids) {
      devices.push({ ...kid, sources: ["golden"] });
      flows.push(sysFlow(satIp, kid.ip, Math.max(4, (kid.cpu ?? 0) * RATE * 0.25), key));
    }
  }
  const cpuIp = "bridge:cpu";
  devices.push(sysDevice(cpuIp, "CPU", "lan", {
    aliases: ["58°C", "load 0.82 0.64 0.51"],
    ports: ["cpu"],
    vendor: "cpu",
    cpu: 48,
  }));
  flows.push(sysFlow(hub, cpuIp, 8 * RATE * 0.4, "cpu"));
  return { ...viewSlice(hub, devices, flows), thermal };
}

export function goldenHostViewSlices() {
  const memory = goldenMemorySlice();
  const disk = goldenDiskSlice();
  const gpu = goldenGpuSlice();
  const sockets = goldenSocketsSlice();
  const cgroups = goldenCgroupsSlice();
  const units = goldenUnitsSlice();
  const udev = goldenUdevSlice();
  const bridge = goldenBridgeSlice({ memory, disk, gpu, sockets, cgroups, units, udev });
  return {
    bluetooth: goldenBluetoothSlice(),
    memory,
    disk,
    gpu,
    sockets,
    cgroups,
    units,
    udev,
    bridge,
  };
}
