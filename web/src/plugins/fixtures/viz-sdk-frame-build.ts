import type { Device, Flow, StateMsg } from "../../core/types";
import type { VizDataFrame } from "../viz-host";
import { buildVizFrame, buildVizFrameForPlugin } from "../viz-host";
import { fatLanFixture } from "./fat-lan-state";
import { goldenLanFixture } from "./golden-lan-state";
import vmLiveStateJson from "../../../../plugins/sdk/fixtures/vm-live-state.json";

/** Host idle config used by shipped packs (`viz.idle: fixture: host`). */
export const VIZ_SDK_HOST_IDLE = { fixture: "host" as const };

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV4_G = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const MAC = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i;
const MAC_G = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
const MAC_STRUCTURAL = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const PLACEHOLDER_ID = /^host-(?:\d{2}|00|mac(?:-\d{2})?)$/;

function isPlaceholderId(id: string): boolean {
  return PLACEHOLDER_ID.test(id);
}

function isMacStructuralId(id: string): boolean {
  return MAC_STRUCTURAL.test(id);
}

function normalizeMacKey(mac: string): string {
  return mac.toLowerCase().replace(/-/g, ":");
}

function scrubbedMacPlaceholder(index: number): string {
  return index === 1 ? "host-mac" : `host-mac-${String(index).padStart(2, "0")}`;
}

function isSyntheticViewId(id: string): boolean {
  return id.includes(":") && !IPV4.test(id) && !isMacStructuralId(id);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function addStructuralId(ids: Set<string>, id: string | undefined): void {
  if (!id || isPlaceholderId(id) || isSyntheticViewId(id)) return;
  ids.add(id);
}

function collectStructuralIds(state: StateMsg): Set<string> {
  const ids = new Set<string>();
  addStructuralId(ids, state.local_ip);
  addStructuralId(ids, state.gateway);
  for (const d of state.devices) {
    addStructuralId(ids, d.ip);
    addStructuralId(ids, d.mac);
  }
  for (const f of state.flows) {
    addStructuralId(ids, f.a);
    addStructuralId(ids, f.b);
  }
  for (const key of VIZ_VIEW_KEYS) {
    const view = state.views?.[key];
    if (!view) continue;
    addStructuralId(ids, view.hub);
    addStructuralId(ids, view.self);
    for (const d of view.devices ?? []) {
      addStructuralId(ids, d.ip);
      addStructuralId(ids, d.mac);
    }
    for (const w of view.watch?.ssids ?? []) addStructuralId(ids, w);
  }
  return ids;
}

function collectHostnameTokens(state: StateMsg): Set<string> {
  const tokens = new Set<string>();
  const consider = (value: string | undefined) => {
    if (!value || isPlaceholderId(value) || value.length < 4) return;
    if (IPV4.test(value) || MAC.test(value) || value.includes(".")) tokens.add(value);
  };
  for (const d of state.devices) {
    for (const h of d.hostnames ?? []) consider(h);
    for (const n of d.names ?? []) consider(n);
  }
  for (const key of VIZ_VIEW_KEYS) {
    const view = state.views?.[key];
    if (!view) continue;
    for (const d of view.devices ?? []) {
      for (const h of d.hostnames ?? []) consider(h);
      for (const n of d.names ?? []) consider(n);
    }
  }
  return tokens;
}

export function scrubIdentifierMap(state: StateMsg): Map<string, string> {
  const sorted = [...collectStructuralIds(state)].sort((a, b) => a.localeCompare(b));
  const unique: string[] = [];
  const seenMacNorm = new Set<string>();
  for (const id of sorted) {
    if (isMacStructuralId(id)) {
      const norm = normalizeMacKey(id);
      if (seenMacNorm.has(norm)) continue;
      seenMacNorm.add(norm);
    }
    unique.push(id);
  }
  const map = new Map<string, string>();
  let hostIndex = 0;
  let macIndex = 0;
  for (const id of unique) {
    if (isMacStructuralId(id)) {
      macIndex += 1;
      const placeholder = scrubbedMacPlaceholder(macIndex);
      map.set(id, placeholder);
      map.set(normalizeMacKey(id), placeholder);
    } else {
      hostIndex += 1;
      map.set(id, `host-${String(hostIndex).padStart(2, "0")}`);
    }
  }
  return map;
}

function macPlaceholderFromMap(map: Map<string, string>, mac: string): string {
  const norm = normalizeMacKey(mac);
  return map.get(mac) ?? map.get(norm) ?? "host-mac";
}

function stringHasSensitive(value: string, hostnames: Set<string>): boolean {
  if (IPV4.test(value) || MAC.test(value)) return true;
  for (const host of hostnames) {
    const re = new RegExp(`\\b${escapeRegExp(host)}\\b`);
    if (re.test(value)) return true;
  }
  return false;
}

function scrubFreeText(value: string, map: Map<string, string>, hostnames: Set<string>): string {
  let out = value;
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  for (const from of keys) {
    if (IPV4.test(from) || isMacStructuralId(from)) out = out.split(from).join(map.get(from)!);
  }
  out = out.replace(IPV4_G, (m) => map.get(m) ?? "host-00");
  out = out.replace(MAC_G, (m) => macPlaceholderFromMap(map, m));
  for (const host of [...hostnames].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${escapeRegExp(host)}\\b`, "g");
    out = out.replace(re, map.get(host) ?? "host-00");
  }
  return out;
}

function scrubStringIfSensitive(
  value: string,
  map: Map<string, string>,
  hostnames: Set<string>,
): string {
  return stringHasSensitive(value, hostnames) ? scrubFreeText(value, map, hostnames) : value;
}

function scrubStructuralId(id: string, map: Map<string, string>): string {
  if (isPlaceholderId(id) || isSyntheticViewId(id)) return id;
  if (isMacStructuralId(id)) return macPlaceholderFromMap(map, id);
  return map.get(id) ?? (IPV4.test(id) ? scrubFreeText(id, map, new Set()) : id);
}

function assignPlaceholder(map: Map<string, string>, id: string): void {
  if (!id || map.has(id)) return;
  map.set(id, `host-${String(map.size + 1).padStart(2, "0")}`);
}

export function scrubMapForFrame(state: StateMsg, frame: VizDataFrame): Map<string, string> {
  const map = scrubIdentifierMap(state);
  const hostnames = collectHostnameTokens(state);
  for (const t of frame.talkers) {
    if (!isPlaceholderId(t.id)) assignPlaceholder(map, t.id);
  }
  for (const l of frame.links ?? []) {
    assignPlaceholder(map, l.src);
    assignPlaceholder(map, l.dst);
  }
  for (const b of frame.rf) assignPlaceholder(map, b.ssid);
  for (const h of frame.headlines) {
    if (stringHasSensitive(h.id, hostnames)) assignPlaceholder(map, h.id);
  }
  return map;
}

export function scrubVizDataFrame(
  frame: VizDataFrame,
  map: Map<string, string>,
  state?: StateMsg,
): VizDataFrame {
  const hostnames = state ? collectHostnameTokens(state) : new Set<string>();
  return {
    ...frame,
    ...(frame.contract != null ? { contract: frame.contract } : {}),
    packets: frame.packets.map((p) => ({
      ...p,
      proto: scrubStringIfSensitive(p.proto, map, hostnames),
    })),
    rf: frame.rf.map((b) => ({
      ...b,
      ssid: scrubStructuralId(b.ssid, map),
    })),
    talkers: frame.talkers.map((t) => ({
      id: scrubStructuralId(t.id, map),
      rate: t.rate,
      role: t.role,
      ...(t.failed != null ? { failed: t.failed } : {}),
    })),
    ...(frame.links?.length ? {
      links: frame.links.map((l) => ({
        src: scrubStructuralId(l.src, map),
        dst: scrubStructuralId(l.dst, map),
        rate: l.rate,
      })),
    } : {}),
    ...(frame.linksDropped != null ? { linksDropped: frame.linksDropped } : {}),
    headlines: frame.headlines.map((h) => ({
      ...h,
      id: scrubStringIfSensitive(h.id, map, hostnames),
      label: scrubStringIfSensitive(h.label, map, hostnames),
      text: scrubStringIfSensitive(h.text, map, hostnames),
      kind: h.kind ? scrubStringIfSensitive(h.kind, map, hostnames) : h.kind,
      summary: h.summary ? scrubStringIfSensitive(h.summary, map, hostnames) : h.summary,
      image: h.image ? scrubStringIfSensitive(h.image, map, hostnames) : h.image,
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
    ...(d.conn_fail != null ? { conn_fail: d.conn_fail } : {}),
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
    ...(f.rate_ab != null ? { rate_ab: f.rate_ab } : {}),
    ...(f.rate_ba != null ? { rate_ba: f.rate_ba } : {}),
    ...(f.rate_pkt_ab != null ? { rate_pkt_ab: f.rate_pkt_ab } : {}),
    ...(f.rate_pkt_ba != null ? { rate_pkt_ba: f.rate_pkt_ba } : {}),
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

function scrubDevice(d: Device, map: Map<string, string>, hostnames: Set<string>): Device {
  return {
    ...d,
    ip: scrubStructuralId(d.ip, map),
    mac: d.mac ? scrubStructuralId(d.mac, map) : d.mac,
    hostnames: (d.hostnames ?? []).map((h) => scrubStringIfSensitive(h, map, hostnames)),
    names: (d.names ?? []).map((n) => scrubStringIfSensitive(n, map, hostnames)),
    aliases: (d.aliases ?? []).map((a) => scrubStringIfSensitive(a, map, hostnames)),
    ssid: d.ssid ? scrubStructuralId(d.ssid, map) : d.ssid,
  };
}

function scrubFlow(f: Flow, map: Map<string, string>): Flow {
  return {
    ...f,
    a: scrubStructuralId(f.a, map),
    b: scrubStructuralId(f.b, map),
  };
}

function scrubViews(
  views: StateMsg["views"],
  map: Map<string, string>,
  hostnames: Set<string>,
): StateMsg["views"] {
  if (!views) return undefined;
  const out: StateMsg["views"] = {};
  for (const key of VIZ_VIEW_KEYS) {
    const view = views[key];
    if (!view) continue;
    out[key] = {
      devices: (view.devices ?? []).map((d) => scrubDevice(d, map, hostnames)),
      flows: (view.flows ?? []).map((f) => scrubFlow(f, map)),
      hub: scrubStructuralId(view.hub, map),
      self: scrubStructuralId(view.self, map),
      ...(view.watch ? {
        watch: {
          ...view.watch,
          ssids: view.watch.ssids.map((s) => scrubStructuralId(s, map)),
          slot: view.watch.slot.map((s) => scrubStructuralId(s, map)),
          plan: view.watch.plan.map((p) => ({
            ...p,
            ssids: p.ssids.map((s) => scrubStructuralId(s, map)),
          })),
          next: view.watch.next
            ? { chan: view.watch.next.chan, ssids: view.watch.next.ssids.map((s) => scrubStructuralId(s, map)) }
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
  hostnames: Set<string>,
): StateMsg["sources"] {
  if (!sources) return undefined;
  const out: StateMsg["sources"] = {};
  for (const [id, src] of Object.entries(sources)) {
    out[id] = {
      ...src,
      label: scrubStringIfSensitive(src.label, map, hostnames),
      items: (src.items ?? []).map((item) => ({
        ...item,
        title: item.title ? scrubStringIfSensitive(item.title, map, hostnames) : item.title,
        summary: item.summary ? scrubStringIfSensitive(item.summary, map, hostnames) : item.summary,
        image: item.image ? scrubStringIfSensitive(item.image, map, hostnames) : item.image,
        link: item.link ? scrubStringIfSensitive(item.link, map, hostnames) : item.link,
      })),
    };
  }
  return out;
}

export function scrubVizCaptureState(state: StateMsg): StateMsg {
  const map = scrubIdentifierMap(state);
  const hostnames = collectHostnameTokens(state);
  return {
    ...state,
    network: scrubStringIfSensitive(state.network, map, hostnames),
    local_ip: scrubStructuralId(state.local_ip, map),
    gateway: scrubStructuralId(state.gateway, map),
    devices: state.devices.map((d) => scrubDevice(d, map, hostnames)),
    flows: state.flows.map((f) => scrubFlow(f, map)),
    views: scrubViews(state.views, map, hostnames),
    sources: scrubSources(state.sources, map, hostnames),
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
  const map = scrubMapForFrame(state, raw);
  return scrubVizDataFrame(raw, map, state);
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

/** Stamp per-device `conn_fail` gauges for frozen failed fixtures (viz v2 talkers[].failed). */
export function withConnFailDevices(state: StateMsg, failByIp: Record<string, number>): StateMsg {
  return {
    ...state,
    devices: state.devices.map((d) => {
      const ratio = failByIp[d.ip];
      return ratio != null ? { ...d, conn_fail: ratio } : d;
    }),
  };
}

function scrubIdleDemoSlices(frame: VizDataFrame): VizDataFrame {
  const slices = frame.demoSlices;
  if (!frame.demo || !slices) return frame;
  const empty = emptyMonitorState(frame.t);
  const seed = buildVizFrameForPlugin(empty, 0, 0, VIZ_SDK_HOST_IDLE);
  const map = scrubMapForFrame(empty, seed);
  const scrubbed = scrubVizDataFrame(seed, map, empty);
  return {
    ...frame,
    audio: frame.audio > 0 ? frame.audio : scrubbed.audio,
    packets: slices.packets ? scrubbed.packets : frame.packets,
    rf: slices.rf ? scrubbed.rf : frame.rf,
    talkers: slices.talkers ? scrubbed.talkers : frame.talkers,
    headlines: slices.headlines ? scrubbed.headlines : frame.headlines,
  };
}

function buildLiveFrame(state: StateMsg, prevTs = 0, audio = 0.12): VizDataFrame {
  const raw = buildVizFrame(state, prevTs, audio);
  const map = scrubMapForFrame(state, raw);
  return scrubVizDataFrame(raw, map, state);
}

function buildPluginQuietFrame(state: StateMsg, prevTs = 0, audio = 0): VizDataFrame {
  const raw = buildVizFrameForPlugin(state, prevTs, audio, VIZ_SDK_HOST_IDLE);
  return scrubIdleDemoSlices(raw);
}

export function buildVizSdkGoldenLiveFrame(): VizDataFrame {
  return buildLiveFrame(goldenLanFixture());
}

export function buildVizSdkGoldenLiveFailedFrame(): VizDataFrame {
  const state = withConnFailDevices(withFailedUnitsView(goldenLanFixture()), {
    "10.0.0.15": 0.5,
    "10.0.0.22": 0.35,
  });
  return buildLiveFrame(state);
}

export function buildVizSdkFatLiveFrame(): VizDataFrame {
  return buildLiveFrame(fatLanFixture());
}

export function buildVizSdkFatLiveFailedFrame(): VizDataFrame {
  const base = fatLanFixture();
  const failByIp: Record<string, number> = {};
  for (let i = 0; i < 8; i++) {
    const ip = base.devices[i * 11]?.ip;
    if (ip) failByIp[ip] = 0.25 + (i % 5) * 0.1;
  }
  const state = withConnFailDevices(withFailedUnitsView(base), failByIp);
  return buildLiveFrame(state);
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
