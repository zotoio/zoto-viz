import type { StateMsg } from "../../core/types";
import type { VizDataFrame } from "../viz-host";
import { buildVizFrame, buildVizFrameForPlugin } from "../viz-host";
import { fatLanFixture } from "./fat-lan-state";
import { goldenLanFixture } from "./golden-lan-state";

/** Host idle config used by shipped packs (`viz.idle: fixture: host`). */
export const VIZ_SDK_HOST_IDLE = { fixture: "host" as const };

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const MAC = /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi;

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
  return [...ids].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function scrubIdentifierMap(state: StateMsg): Map<string, string> {
  const sorted = collectIdentifiers(state);
  const unique = [...new Set(sorted)].sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  unique.forEach((id, i) => map.set(id, `host-${String(i + 1).padStart(2, "0")}`));
  return map;
}

function scrubString(value: string, map: Map<string, string>): string {
  let out = value;
  for (const [from, to] of map) out = out.split(from).join(to);
  out = out.replace(IPV4, (m) => map.get(m) ?? "host-00");
  out = out.replace(MAC, () => "host-mac");
  return out;
}

export function scrubMapForFrame(state: StateMsg, frame: VizDataFrame): Map<string, string> {
  const ids = new Set(collectIdentifiers(state));
  for (const t of frame.talkers) ids.add(t.id);
  for (const h of frame.headlines) {
    ids.add(h.id);
    if (h.label) ids.add(h.label);
  }
  for (const b of frame.rf) ids.add(b.ssid);
  const unique = [...ids].sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  unique.forEach((id, i) => map.set(id, `host-${String(i + 1).padStart(2, "0")}`));
  return map;
}

export function scrubVizDataFrame(frame: VizDataFrame, map: Map<string, string>): VizDataFrame {
  return {
    ...frame,
    packets: frame.packets.map((p) => ({
      ...p,
      proto: scrubString(p.proto, map),
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
      id: scrubString(h.id, map),
      label: scrubString(h.label, map),
      text: scrubString(h.text, map),
      kind: h.kind ? scrubString(h.kind, map) : h.kind,
      summary: h.summary ? scrubString(h.summary, map) : h.summary,
      image: h.image ? scrubString(h.image, map) : h.image,
    })),
    sys: frame.sys,
  };
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

export const VIZ_SDK_FIXTURE_BUILDERS = {
  idle: buildVizSdkIdleFrame,
  "golden-live": buildVizSdkGoldenLiveFrame,
  "golden-live-failed": buildVizSdkGoldenLiveFailedFrame,
  "fat-live": buildVizSdkFatLiveFrame,
  "fat-live-failed": buildVizSdkFatLiveFailedFrame,
} as const;

export type VizSdkFixtureName = keyof typeof VIZ_SDK_FIXTURE_BUILDERS;
