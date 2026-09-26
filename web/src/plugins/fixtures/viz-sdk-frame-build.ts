import type { Device, Flow, StateMsg } from "../../core/types";
import type { VizDataFrame } from "../viz-host";
import { buildVizFrame, buildVizFrameForPlugin } from "../viz-host";
import { fatLanFixture } from "./fat-lan-state";
import { goldenLanFixture } from "./golden-lan-state";
import vmLiveStateJson from "../../../../plugins/sdk/fixtures/vm-live-state.json";

/** Host idle config used by shipped packs (`viz.idle: fixture: host`). */
export const VIZ_SDK_HOST_IDLE = { fixture: "host" as const };

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const MAC = /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i;

const VIZ_VIEW_KEYS = [
  "wifi", "cpu", "memory", "disk", "gpu", "sockets", "units", "udev", "bridge",
] as const;

/** Empty monitor state — same shape as idle-viz-frame host-idle dogfood tests. */
export function emptyMonitorState(ts = 10): StateMsg {
  return {
    type: "state",
    ts,
    iface: "",
    interfaces: [],
    network: "",
    local_ip: "",
    gateway: "",
    uptime: 0,
    stats: {
      pps: 0, bps: 0, devices: 0, online: 0, flows: 0, active_flows: 0, packets: 0, bytes: 0,
    },
    devices: [],
    flows: [],
  };
}

function collectIdentifiers(state: StateMsg): string[] {
  const ids = new Set<string>();
  if (state.local_ip) ids.add(state.local_ip);
  if (state.gateway) ids.add(state.gateway);
  for (const d of state.devices) {
    ids.add(d.ip);
    if (d.mac) ids.add(d.mac);
    for (const h of d.hostnames ?? []) if (h) ids.add(h);
    for (const n of d.names ?? []) if (n) ids.add(n);
  }
  for (const f of state.flows) {
    ids.add(f.a);
    ids.add(f.b);
  }
  for (const key of VIZ_VIEW_KEYS) {
    const view = state.views?.[key];
    if (!view) continue;
    if (view.hub) ids.add(view.hub);
    if (view.self) ids.add(view.self);
    for (const d of view.devices ?? []) {
      ids.add(d.ip);
      if (d.mac) ids.add(d.mac);
      for (const h of d.hostnames ?? []) if (h) ids.add(h);
      for (const n of d.names ?? []) if (n) ids.add(n);
      for (const a of d.aliases ?? []) if (a) ids.add(a);
    }
    for (const w of view.watch?.ssids ?? []) if (w) ids.add(w);
  }
  return [...ids];
}

export function scrubIdentifierMap(state: StateMsg): Map<string, string> {
  const unique = [...new Set(collectIdentifiers(state))].sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  unique.forEach((id, i) => map.set(id, `host-${String(i + 1).padStart(2, "0")}`));
  return map;
}

function stringHasSensitive(value: string, map: Map<string, string>): boolean {
  if (IPV4.test(value) || MAC.test(value)) return true;
  for (const key of map.keys()) {
    if (key.length >= 4 && value.includes(key)) return true;
  }
  return false;
}

function scrubString(value: string, map: Map<string, string>): string {
  let out = value;
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  for (const from of keys) out = out.split(from).join(map.get(from)!);
  out = out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) => map.get(m) ?? "host-00");
  out = out.replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, () => "host-mac");
  return out;
}

function scrubStringIfSensitive(value: string, map: Map<string, string>): string {
  return stringHasSensitive(value, map) ? scrubString(value, map) : value;
}

function assignPlaceholder(map: Map<string, string>, id: string): void {
  if (!id || map.has(id)) return;
  map.set(id, `host-${String(map.size + 1).padStart(2, "0")}`);
}

export function scrubMapForFrame(state: StateMsg, frame: VizDataFrame): Map<string, string> {
  const map = scrubIdentifierMap(state);
  for (const t of frame.talkers) assignPlaceholder(map, t.id);
  for (const b of frame.rf) assignPlaceholder(map, b.ssid);
  for (const h of frame.headlines) {
    if (stringHasSensitive(h.id, map)) assignPlaceholder(map, h.id);
  }
  return map;
}

export function scrubVizDataFrame(frame: VizDataFrame, map: Map<string, string>): VizDataFrame {
  return {
    ...frame,
    packets: frame.packets.map((p) => ({
      ...p,
      proto: scrubStringIfSensitive(p.proto, map),
    })),
    rf: frame.rf.map((b) => ({
      ...b,
      ssid: scrubString(b.ssid, map),
    })),
    talkers: frame.talkers.map((t) => ({
      id: map.get(t.id) ?? scrubString(t.id, map),
      rate: t.rate,
      role: t.role,
    })),
    headlines: frame.headlines.map((h) => ({
      ...h,
      id: scrubStringIfSensitive(h.id, map),
      label: scrubStringIfSensitive(h.label, map),
      text: scrubStringIfSensitive(h.text, map),
      kind: h.kind ? scrubStringIfSensitive(h.kind, map) : h.kind,
      summary: h.summary ? scrubStringIfSensitive(h.summary, map) : h.summary,
      image: h.image ? scrubStringIfSensitive(h.image, map) : h.image,
    })),
    sys: frame.sys,
  };
}

function trimDevice(d: Device): Device {
  return {
    ip: d.ip,
    mac: d.mac,
    vendor: d.vendor,
    hostnames: d.hostnames ?? [],
    names: d.names ?? [],
    sources: d.sources ?? [],
    ports: d.ports ?? [],
    ifaces: d.ifaces ?? [],
    aliases: d.aliases ?? [],
    first_seen: d.first_seen,
    last_seen: d.last_seen,
    bytes_in: d.bytes_in,
    bytes_out: d.bytes_out,
    packets: d.packets,
    role: d.role,
    online: d.online,
    ...(d.cpu != null ? { cpu: d.cpu } : {}),
    ...(d.ssid != null ? { ssid: d.ssid } : {}),
    ...(d.chan != null ? { chan: d.chan } : {}),
  };
}

function trimFlow(f: Flow): Flow {
  return {
    a: f.a,
    b: f.b,
    bytes: f.bytes,
    packets: f.packets,
    ports: f.ports ?? [],
    protos: f.protos ?? [],
    ifaces: f.ifaces ?? [],
    first_seen: f.first_seen,
    last_seen: f.last_seen,
    rate: f.rate,
  };
}

function trimViews(views: StateMsg["views"]): StateMsg["views"] {
  if (!views) return undefined;
  const out: StateMsg["views"] = {};
  for (const key of VIZ_VIEW_KEYS) {
    const view = views[key];
    if (!view) continue;
    out[key] = {
      devices: (view.devices ?? []).map(trimDevice),
      flows: (view.flows ?? []).map(trimFlow),
      hub: view.hub,
      self: view.self,
      ...(view.watch ? { watch: view.watch } : {}),
      ...(view.thermal ? { thermal: view.thermal } : {}),
    };
  }
  return out;
}

/** Keep only monitor fields that `buildVizFrame` / `extractSysTelemetry` read. */
export function trimVizCaptureState(raw: StateMsg): StateMsg {
  return {
    type: "state",
    ts: raw.ts,
    iface: raw.iface ?? "",
    interfaces: raw.interfaces ?? [],
    network: raw.network ?? "",
    local_ip: raw.local_ip ?? "",
    gateway: raw.gateway ?? "",
    uptime: raw.uptime ?? 0,
    stats: {
      pps: raw.stats?.pps ?? 0,
      bps: raw.stats?.bps ?? 0,
      devices: raw.stats?.devices ?? 0,
      online: raw.stats?.online ?? 0,
      flows: raw.stats?.flows ?? 0,
      active_flows: raw.stats?.active_flows ?? 0,
      packets: raw.stats?.packets ?? 0,
      bytes: raw.stats?.bytes ?? 0,
    },
    devices: (raw.devices ?? []).map(trimDevice),
    flows: (raw.flows ?? []).map(trimFlow),
    views: trimViews(raw.views),
    sources: raw.sources,
  };
}

function scrubDevice(d: Device, map: Map<string, string>): Device {
  return {
    ...d,
    ip: map.get(d.ip) ?? scrubString(d.ip, map),
    mac: d.mac ? scrubString(d.mac, map) : d.mac,
    hostnames: (d.hostnames ?? []).map((h) => scrubStringIfSensitive(h, map)),
    names: (d.names ?? []).map((n) => scrubStringIfSensitive(n, map)),
    aliases: (d.aliases ?? []).map((a) => scrubStringIfSensitive(a, map)),
    ssid: d.ssid ? scrubString(d.ssid, map) : d.ssid,
  };
}

function scrubFlow(f: Flow, map: Map<string, string>): Flow {
  return {
    ...f,
    a: map.get(f.a) ?? scrubString(f.a, map),
    b: map.get(f.b) ?? scrubString(f.b, map),
  };
}

function scrubViews(views: StateMsg["views"], map: Map<string, string>): StateMsg["views"] {
  if (!views) return undefined;
  const out: StateMsg["views"] = {};
  for (const key of VIZ_VIEW_KEYS) {
    const view = views[key];
    if (!view) continue;
    out[key] = {
      devices: (view.devices ?? []).map((d) => scrubDevice(d, map)),
      flows: (view.flows ?? []).map((f) => scrubFlow(f, map)),
      hub: map.get(view.hub) ?? scrubString(view.hub, map),
      self: map.get(view.self) ?? scrubString(view.self, map),
      ...(view.watch ? {
        watch: {
          ...view.watch,
          ssids: view.watch.ssids.map((s) => scrubString(s, map)),
          slot: view.watch.slot.map((s) => scrubString(s, map)),
          plan: view.watch.plan.map((p) => ({
            ...p,
            ssids: p.ssids.map((s) => scrubString(s, map)),
          })),
          next: view.watch.next
            ? { chan: view.watch.next.chan, ssids: view.watch.next.ssids.map((s) => scrubString(s, map)) }
            : null,
        },
      } : {}),
      ...(view.thermal ? { thermal: view.thermal } : {}),
    };
  }
  return out;
}

function scrubSources(
  sources: StateMsg["sources"],
  map: Map<string, string>,
): StateMsg["sources"] {
  if (!sources) return undefined;
  const out: StateMsg["sources"] = {};
  for (const [id, src] of Object.entries(sources)) {
    out[id] = {
      ...src,
      label: scrubStringIfSensitive(src.label, map),
      items: (src.items ?? []).map((item) => ({
        ...item,
        title: item.title ? scrubStringIfSensitive(item.title, map) : item.title,
        summary: item.summary ? scrubStringIfSensitive(item.summary, map) : item.summary,
        image: item.image ? scrubStringIfSensitive(item.image, map) : item.image,
        link: item.link ? scrubStringIfSensitive(item.link, map) : item.link,
      })),
    };
  }
  return out;
}

export function scrubVizCaptureState(state: StateMsg): StateMsg {
  const map = scrubIdentifierMap(state);
  return {
    ...state,
    network: scrubStringIfSensitive(state.network, map),
    local_ip: map.get(state.local_ip) ?? scrubString(state.local_ip, map),
    gateway: map.get(state.gateway) ?? scrubString(state.gateway, map),
    devices: state.devices.map((d) => scrubDevice(d, map)),
    flows: state.flows.map((f) => scrubFlow(f, map)),
    views: scrubViews(state.views, map),
    sources: scrubSources(state.sources, map),
  };
}

export function trimAndScrubVizCaptureState(raw: StateMsg): StateMsg {
  return scrubVizCaptureState(trimVizCaptureState(raw));
}

export function vmLiveCaptureState(): StateMsg {
  return vmLiveStateJson as StateMsg;
}

/** Real host idle merge on an empty monitor (buildIdleVizFrame via `fixture: host`). */
export function buildVizSdkIdleFrame(): VizDataFrame {
  const state = emptyMonitorState(10);
  const raw = buildVizFrameForPlugin(state, 0, 0, VIZ_SDK_HOST_IDLE);
  return scrubVizDataFrame(raw, scrubMapForFrame(state, raw));
}

export function withFailedUnitsView(state: StateMsg, failedCount = 3): StateMsg {
  const hub = "units:hub";
  const row = {
    ip: hub,
    mac: "de:ad:be:ef:00:01",
    vendor: "fixture",
    hostnames: ["units.local"],
    names: ["units"],
    sources: ["fixture"],
    ports: [],
    ifaces: [],
    aliases: [`${failedCount} failed`],
    first_seen: 0,
    last_seen: 0,
    role: "self" as const,
    online: true,
    packets: 0,
    bytes_in: 0,
    bytes_out: 0,
  };
  return {
    ...state,
    views: {
      ...state.views,
      units: {
        devices: [row],
        flows: [],
        hub,
        self: hub,
      },
    },
  };
}

function buildLiveFrame(state: StateMsg, prevTs = 0, audio = 0.12): VizDataFrame {
  const raw = buildVizFrame(state, prevTs, audio);
  return scrubVizDataFrame(raw, scrubMapForFrame(state, raw));
}

function buildPluginQuietFrame(state: StateMsg, prevTs = 0, audio = 0): VizDataFrame {
  const raw = buildVizFrameForPlugin(state, prevTs, audio, VIZ_SDK_HOST_IDLE);
  return scrubVizDataFrame(raw, scrubMapForFrame(state, raw));
}

export function buildVizSdkGoldenLiveFrame(): VizDataFrame {
  return buildLiveFrame(goldenLanFixture());
}

export function buildVizSdkGoldenLiveFailedFrame(): VizDataFrame {
  return buildLiveFrame(withFailedUnitsView(goldenLanFixture()));
}

export function buildVizSdkFatLiveFrame(): VizDataFrame {
  return buildLiveFrame(fatLanFixture());
}

export function buildVizSdkFatLiveFailedFrame(): VizDataFrame {
  return buildLiveFrame(withFailedUnitsView(fatLanFixture()));
}

/** Quiet VM capture with host idle merge (real pack path on an empty LAN). */
export function buildVizSdkVmLiveFrame(): VizDataFrame {
  return buildPluginQuietFrame(vmLiveCaptureState());
}

export const VIZ_SDK_FIXTURE_BUILDERS = {
  idle: buildVizSdkIdleFrame,
  "golden-live": buildVizSdkGoldenLiveFrame,
  "golden-live-failed": buildVizSdkGoldenLiveFailedFrame,
  "fat-live": buildVizSdkFatLiveFrame,
  "fat-live-failed": buildVizSdkFatLiveFailedFrame,
  "vm-live": buildVizSdkVmLiveFrame,
} as const;

export type VizSdkFixtureName = keyof typeof VIZ_SDK_FIXTURE_BUILDERS;
