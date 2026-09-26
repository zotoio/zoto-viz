import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SimNode, SimLink } from "d3-force-3d";
import { LabelItem, LabelLayer, labelActivity } from "./labels";
import {
  applyPhys, clampParticleCap, easePhysToward, hashAngle,
  MAX_PARTICLES as PARTICLE_CAP, particlesOnLink, pickPhys, stringPoint, stringSegs,
  type PhysEase,
} from "./physics";
import { LayoutClient } from "./layout";
import type { HostedView, HostGpu, RenderHost, Viewport } from "./render-host";
import { SoftwareGpu } from "./render-host";
import { paintSoftwareGraph, paintSoftwarePluginRain, cssHex, type SoftRect } from "./software-draw";
import { probeWebGL } from "./webgl";
import type { MosaicNode } from "./mosaic-layout";
import {
  L_BASE, L_DST, L_K, L_SRC, LINK_STRIDE, N_CHARGE, N_FIXED, N_FX, N_FY, N_FZ, N_KEY, N_RATE, N_RELAX, N_ROLE,
  N_SHELL_K, N_SHELL_R, N_SLOT, N_THETA, NODE_STRIDE, ROLES, roleIdx, type LayoutParams, type PositionsMsg,
} from "./layout-core";
import { KIND_COLOR, ROLE_COLOR, deviceKind, displayName, fmtBytes, type Device, type Flow, type Role, type StateMsg } from "../core/types";
import { sourcesSlice } from "../core/source-graph";
import { capBluetoothDevices, categorize, heat, isSysBase, paneLabelCap, topology, type ModeCtx, type ViewMode } from "../core/modes";
import { rIp, rName } from "../core/redact";
import { DEFAULT_THEME, effectiveSceneLuminance, fadeTowardPole, grayHex, guardLabelMix, hexToHsl, hslHex, sceneInk, SKY_LUMA_CAP, toCssHex, type Theme } from "../core/themes";
import { assessVisibility, type VisibilityReport } from "../core/visibility";
import { Backdrop, type BackdropKind } from "./backdrop";
import { LumaProbe } from "./lumaProbe";
import { ensureSkyRecipe } from "./sky-ai";
import { liveCam } from "../camera/livecam";
import { cameraConsumers } from "../camera/want";
import { Gaze } from "../camera/gaze";
import { FloorGrid, easeFloorPose, floorPose, type FloorPose, type FloorShape } from "./floor";
import { guardReadableAnim } from "./readable";
import { AudioPulse } from "../audio/audio";
import { liveMic, micCaptureAllowed, shouldRunMic } from "../audio/want";
import { markFrame, PaneFps } from "../core/fps";
import { timeGpu } from "../core/gpu-time";
import { CanvasChangeProbe, PaneChangeProbe } from "./pane-change";
import {
  asCanvasDeviceHeight,
  deviceRect,
  isDeviceRect,
  type GlRect,
  type GlRectMut,
  toGlRectInto,
} from "./pack-mirror-rect";
import {
  devicePxRatioFromWindow,
  devicePxRatioNumber,
} from "./render-host-device-px-ratio";
import { observeResize } from "../core/resize";
import { notePerfChange, perfOverlay, perfStress, perfWant, tickPerf, type PerfOverlay } from "../core/perf";
import { activityLookMix, centerMixForNdc } from "./cam-center";
import { PINCH_HOLD_MS, mouseWheelTick, pinchWheel, pointerCentroid, threeFingerZoomDelta, wheelCamMotion } from "./wheel-cam";
import { decoHtml, EMPTY_LOOK, type AgentLook, type DecoAt } from "./deco";
import { loadHtmlImage } from "../core/load-image";
import {
  GraphFabric, edgeHighlightBright, fabricActive, graphFaces, nodeHighlightBoost,
  resolveFabric, resolveGraphFlatten, type FabricEdgePose, type FabricKind, type FabricNodePose,
  type GraphSpace,
} from "./fabric";
import {
  graphLayoutAnimates, graphLayoutIsForce, graphLayoutPlaces, graphLinksArrows, graphLinksBundle, layoutGraph,
  pickHub, pullTowardLayout, type GraphLayout, type GraphLinks, type LayoutLink, type LayoutNode,
  type LayoutXyz,
} from "./graph-layouts";
import { VIEW_MORPH_S, mixFade, mixShape } from "./morph";

export { FABRIC_KINDS, FABRIC_OPTIONS, FABRIC_DICE, GRAPH_SPACE_OPTIONS, type FabricKind, type GraphSpace } from "./fabric";
export {
  GRAPH_LAYOUTS, GRAPH_LAYOUT_OPTIONS, GRAPH_LAYOUT_DICE, GRAPH_LINKS, GRAPH_LINK_OPTIONS, GRAPH_LINK_DICE,
  type GraphLayout, type GraphLinks,
} from "./graph-layouts";
export { VIEW_MORPH_S } from "./morph";

export const THEME_FADE_S = 1.8;

export interface Filters { lan: boolean; internet: boolean; multicast: boolean; offline: boolean; labels: boolean; cpuIdle: boolean }

export interface GNode extends SimNode {
  id: string;
  /** stable key the layout worker uses to keep this node's motion across structure resends */
  simKey: number;
  device: Device;
  /** sphere styling; every node is one instance of the shared InstancedMesh, written each frame */
  color: THREE.Color;
  /** start of a theme fade; `colorWant` is the incoming palette */
  colorFrom: THREE.Color;
  colorWant: THREE.Color;
  scale: number;
  glow: number;
  opacity: number;
  /** index into modes.SHAPES; the shared material bends the unit sphere into it per instance */
  shape: number;
  shapeFrom: number;
  shapeWant: number;
  label: LabelItem;
  labelUntil?: number;
  labelEl: HTMLDivElement;
  visible: boolean;
  active: boolean;
  rate: number;
  targetScale: number;
  /** previous position, for layout-velocity focus */
  px: number;
  py: number;
  pz: number;
  /** CPU view: wall seconds when this node went unused; opacity fades over `CPU_IDLE_FADE_S` */
  cpuIdleAt?: number;
  /** CPU view: dropped from the live slice, kept only to fade out */
  cpuGhost?: boolean;
  /** last `--fade` written on the label, so CPU opacity is not a DOM write every frame */
  labelFade?: string;
}
export interface GLink extends SimLink<GNode> { id: string; flow: Flow; source: GNode; target: GNode; visible: boolean }

const SHELL: Record<Role, number> = { self: 110, gateway: 0, local: 200, lan: 360, multicast: 440, internet: 580 };
/** a shell is crowded when the nodes on it get less ring than this each (world units; a label is ~2× this) */
const CROWD_SPACING = 56;
/** room a widened shell keeps before the next shell out (links pull that shell's nodes inward by up to ~40) */
const CROWD_GAP = 140;
/** the outermost shell has nothing beyond it to run into, so it widens by at most this factor */
const CROWD_OUTER_MAX = 1.3;
/** how long a label earned by live traffic stays on after the flow goes idle */
const LABEL_HOLD_S = 20;
/** CPU cores/processes stay on the graph this long after they go unused, fading the whole time */
const CPU_IDLE_FADE_S = 5;
/** a core under this percent is unused (processes leave the slice instead) */
const CPU_IDLE_PCT = 0.5;
/** idle cores that are still present fade down to this, not to nothing */
const CPU_IDLE_FLOOR = 0.22;
/** nodes under this share of the loudest node's log-rate keep a plain label */
const VOL_FLOOR = 0.45;
/** a hidden node whose scale has eased down to this no longer gets an instance (its target is 0.01) */
const COLLAPSED_SCALE = 0.02;
const MAX_PARTICLES = PARTICLE_CAP;
const SPHERE_CAPACITY = 512;  // instances allocated up front; grows by doubling

/** Live unicast conversation (not a tether, multicast hub, or discovery/DNS-to-gateway flak). */
function flowEarnsLabel(l: GLink): boolean {
  if (l.id.startsWith("~")) return false;
  if (l.source.device.role === "multicast" || l.target.device.role === "multicast") return false;
  const cat = categorize(l.flow.ports ?? []);
  if (cat.id === "discovery") return false;
  const gw = l.source.device.role === "gateway" || l.target.device.role === "gateway";
  if (gw && (cat.id === "dns" || cat.id === "ntp")) return false;
  return true;
}

/** Per-direction rates; older snapshots only have undirected `rate`. */
function flowDirRates(f: Flow): { ab: number; ba: number } {
  const ab = f.rate_ab, ba = f.rate_ba;
  if (typeof ab === "number" && typeof ba === "number") return { ab, ba };
  const half = (f.rate || 0) * 0.5;
  return { ab: half, ba: half };
}

function glowStrength(rate: number): number {
  return rate <= 0 ? 0 : Math.min(1, Math.log10(1 + rate) / 4);
}

function isCpuGraphId(id: string): boolean {
  return id === "cpu:host" || id.startsWith("cpu:") || id.startsWith("proc:");
}

function isCpuCoreId(id: string): boolean {
  return /^cpu:\d+$/.test(id);
}

function cpuIdleOpacity(n: GNode, wall: number): number {
  if (!n.cpuIdleAt) return n.device.online ? 1 : 0.35;
  const t = Math.min(1, Math.max(0, (wall - n.cpuIdleAt) / CPU_IDLE_FADE_S));
  const floor = n.cpuGhost && n.id.startsWith("proc:") ? 0 : CPU_IDLE_FLOOR;
  return 1 - t * (1 - floor);
}

function uniqPush(arr: string[], v: string): void {
  if (v && !arr.includes(v)) arr.push(v);
}

function cloneDevice(d: Device): Device {
  return {
    ...d,
    names: [...(d.names ?? [])],
    hostnames: [...(d.hostnames ?? [])],
    aliases: [...(d.aliases ?? [])],
    ports: [...(d.ports ?? [])],
    ifaces: [...(d.ifaces ?? [])],
    sources: [...(d.sources ?? [])],
  };
}

function stubDevice(ip: string, role: Role, extra: Partial<Device> = {}): Device {
  return {
    ip,
    mac: extra.mac ?? "",
    vendor: extra.vendor ?? "",
    hostnames: extra.hostnames ?? [],
    names: extra.names ?? (role === "gateway" ? ["gateway"] : []),
    sources: extra.sources ?? [],
    ports: extra.ports ?? [],
    ifaces: extra.ifaces ?? [],
    aliases: extra.aliases ?? [],
    first_seen: extra.first_seen ?? 0,
    last_seen: extra.last_seen ?? 0,
    bytes_in: extra.bytes_in ?? 0,
    bytes_out: extra.bytes_out ?? 0,
    packets: extra.packets ?? 0,
    role,
    online: extra.online ?? true,
  };
}

/** `ours` (or blank) follows the monitor's default-route gateway. */
function resolveGatewayIp(opts: Record<string, string> | undefined, msg: StateMsg): string {
  const raw = (opts?.gateway ?? "").trim();
  if (!raw || /^ours$/i.test(raw)) return msg.gateway;
  return raw;
}

function addAggFlow(map: Map<string, Flow>, a: string, b: string, f: Flow): void {
  if (!a || !b || a === b) return;
  let a2 = a, b2 = b, ab = f.rate_ab, ba = f.rate_ba;
  if (a2 > b2) {
    [a2, b2] = [b2, a2];
    [ab, ba] = [ba, ab];
  }
  const key = `${a2}\0${b2}`;
  const cur = map.get(key);
  if (!cur) {
    map.set(key, {
      a: a2, b: b2, bytes: f.bytes, packets: f.packets,
      ports: [...(f.ports ?? [])], protos: [...(f.protos ?? [])], ifaces: [...(f.ifaces ?? [])],
      first_seen: f.first_seen, last_seen: f.last_seen, rate: f.rate,
      ...(typeof ab === "number" ? { rate_ab: ab } : {}),
      ...(typeof ba === "number" ? { rate_ba: ba } : {}),
    });
    return;
  }
  cur.bytes += f.bytes;
  cur.packets += f.packets;
  cur.rate += f.rate;
  if (typeof ab === "number") cur.rate_ab = (cur.rate_ab ?? 0) + ab;
  if (typeof ba === "number") cur.rate_ba = (cur.rate_ba ?? 0) + ba;
  cur.first_seen = Math.min(cur.first_seen || f.first_seen, f.first_seen);
  cur.last_seen = Math.max(cur.last_seen, f.last_seen);
  for (const p of f.ports ?? []) uniqPush(cur.ports, p);
  for (const p of f.protos ?? []) uniqPush(cur.protos, p);
  for (const i of f.ifaces ?? []) uniqPush(cur.ifaces, i);
}

function wifiHop(id: string, role: Role | undefined, hub: string): "hub" | "lan" | "internet" | "skip" {
  if (id === hub) return "hub";
  if (role === "multicast") return "skip";
  if (id.startsWith("sta:")) return "lan";
  if (id.startsWith("ap:")) return role === "internet" ? "internet" : "lan";
  if (role === "internet") return "internet";
  if (role === "lan" || role === "self" || role === "local" || role === "gateway") return "lan";
  return "skip";
}

/**
 * Wi-Fi LAN and internet conversations all transit the IP gateway on this mesh.
 * RF STA–AP data edges are dropped; APs from scan stay as nodes. Foreign SSIDs stay
 * on the outer shell and are not forced through our gateway.
 */
function wifiViaGateway(msg: StateMsg, opts: Record<string, string> | undefined): { devices: Device[]; flows: Flow[]; gateway: string; localIp: string } {
  const view = msg.views?.wifi;
  const devices: Device[] = (view?.devices ?? []).map(cloneDevice);
  const radioIds = new Set(devices.map((d) => d.ip));
  const byId = new Map(devices.map((d) => [d.ip, d]));
  const ipByAddr = new Map(msg.devices.map((d) => [d.ip, d]));
  const gwIp = resolveGatewayIp(opts, msg);
  const gwDev = ipByAddr.get(gwIp);
  const gwMac = (gwDev?.mac || "").toLowerCase();
  const hub = gwMac && byId.has(`ap:${gwMac}`) ? `ap:${gwMac}` : gwIp;
  const selfId = view?.self || "";
  const staByMac = new Map<string, Device>();
  for (const d of devices) {
    if (d.ip.startsWith("sta:") && d.mac) staByMac.set(d.mac.toLowerCase(), d);
  }

  const mapIp = (ip: string): string => {
    if (!ip) return ip;
    if (ip === gwIp || ip === hub) return hub;
    if (ip.startsWith("ap:") || ip.startsWith("sta:") || ip.startsWith("bt:")) return ip;
    const d = ipByAddr.get(ip);
    if (!d) return ip;
    if (d.mac) {
      const st = staByMac.get(d.mac.toLowerCase());
      if (st) return st.ip;
    }
    if (d.role === "self" && selfId) return selfId;
    return ip;
  };

  const roleOf = (id: string): Role | undefined => byId.get(id)?.role ?? ipByAddr.get(id)?.role;

  const take = (id: string): Device | undefined => {
    const hit = byId.get(id);
    if (hit) return hit;
    const src = ipByAddr.get(id);
    const d = src
      ? cloneDevice(src)
      : (id === hub || id === gwIp)
        ? stubDevice(id, "gateway", {
          mac: gwMac,
          vendor: gwDev?.vendor ?? "",
          names: gwDev?.names?.length ? [...gwDev.names] : ["gateway"],
          hostnames: gwDev?.hostnames ? [...gwDev.hostnames] : [],
        })
        : undefined;
    if (!d) return undefined;
    byId.set(d.ip, d);
    devices.push(d);
    return d;
  };

  for (const d of devices) {
    if (d.ip === hub) d.role = "gateway";
    else if (d.role === "gateway") d.role = "lan";
  }
  const hubDev = take(hub);
  if (hubDev) hubDev.role = "gateway";

  for (const d of msg.devices) {
    if (!d.mac) continue;
    const st = staByMac.get(d.mac.toLowerCase());
    if (!st) continue;
    if (d.vendor && !st.vendor) st.vendor = d.vendor;
    for (const n of d.names ?? []) uniqPush(st.names, n);
    for (const n of d.hostnames ?? []) uniqPush(st.hostnames, n);
  }

  const flows = new Map<string, Flow>();
  const extra = new Set<string>([hub]);
  if (selfId) extra.add(selfId);

  const onWifi = (id: string): boolean =>
    id.startsWith("sta:") || id.startsWith("ap:") || id === selfId
    || roleOf(id) === "self" || roleOf(id) === "local";

  for (const f of msg.flows) {
    const a = mapIp(f.a), b = mapIp(f.b);
    const sa = wifiHop(a, roleOf(a), hub);
    const sb = wifiHop(b, roleOf(b), hub);
    if (sa === "skip" || sb === "skip") continue;
    if (sa === "lan" && onWifi(a)) { addAggFlow(flows, a, hub, f); extra.add(a); }
    if (sb === "lan" && onWifi(b)) { addAggFlow(flows, b, hub, f); extra.add(b); }
    if (sa === "internet") { addAggFlow(flows, hub, a, f); extra.add(a); }
    if (sb === "internet") { addAggFlow(flows, hub, b, f); extra.add(b); }
  }

  for (const id of extra) take(id);

  return {
    devices: devices.filter((d) => radioIds.has(d.ip) || extra.has(d.ip)),
    flows: [...flows.values()],
    gateway: hub,
    localIp: selfId || msg.local_ip,
  };
}

/** matches `cpu.py` RATE_SCALE: 1% CPU → 100 on flow.rate */
const CPU_RATE_SCALE = 100;

function cpuCoresMode(modeId: string): boolean {
  return modeId === "cores" || modeId.endsWith(":cores");
}

function cpuProcName(d: Device): string {
  return (d.names?.[0] || d.hostnames?.[0] || "proc").trim() || "proc";
}

function cpuNameId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `proc:name:${slug || "proc"}`;
}

function mergeCpuRole(members: Device[]): Role {
  const roles = new Set(members.map((m) => m.role));
  if (roles.size === 1) return members[0]!.role;
  if (roles.has("internet")) return "internet";
  if (roles.has("local")) return "local";
  return members[0]!.role;
}

function mergeCpuProcs(id: string, members: Device[]): Device {
  const name = cpuProcName(members[0]!);
  let cpu = 0, bytesIn = 0, bytesOut = 0, packets = 0;
  let first = members[0]!.first_seen, last = members[0]!.last_seen;
  const byCore = new Map<string, number>();
  for (const m of members) {
    const pct = m.cpu ?? 0;
    cpu += pct;
    bytesIn += m.bytes_in;
    bytesOut += m.bytes_out;
    packets += m.packets;
    first = Math.min(first, m.first_seen);
    last = Math.max(last, m.last_seen);
    const core = m.ports?.[0];
    if (core) byCore.set(core, (byCore.get(core) ?? 0) + pct);
  }
  const ports = [...byCore.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const one = members.length === 1 ? members[0]! : undefined;
  return {
    ...(one ? cloneDevice(one) : cloneDevice(members[0]!)),
    ip: id,
    names: [name],
    hostnames: [name],
    aliases: one ? [...(one.aliases ?? [])] : [`×${members.length}`],
    ports: one ? [...(one.ports ?? [])] : ports,
    first_seen: first,
    last_seen: last,
    bytes_in: bytesIn,
    bytes_out: bytesOut,
    packets,
    role: mergeCpuRole(members),
    online: members.some((m) => m.online),
    cpu: Math.round(cpu * 100) / 100,
    members: one ? undefined : members.map((m) => m.ip),
  };
}

function groupCpuByName(devices: Device[]): { devices: Device[]; procFlows: Flow[] } {
  const keep: Device[] = [];
  const buckets = new Map<string, Device[]>();
  for (const d of devices) {
    if (!d.ip.startsWith("proc:")) { keep.push(d); continue; }
    const id = cpuNameId(cpuProcName(d));
    const list = buckets.get(id);
    if (list) list.push(d);
    else buckets.set(id, [d]);
  }
  const grouped: Device[] = [];
  const procFlows: Flow[] = [];
  for (const [id, members] of buckets) {
    const nodeId = members.length === 1 ? members[0]!.ip : id;
    const node = mergeCpuProcs(nodeId, members);
    grouped.push(node);
    const byCore = new Map<string, { cpu: number; first: number; last: number }>();
    for (const m of members) {
      const core = m.ports?.[0];
      if (!core) continue;
      const cur = byCore.get(core);
      const pct = m.cpu ?? 0;
      if (!cur) byCore.set(core, { cpu: pct, first: m.first_seen, last: m.last_seen });
      else {
        cur.cpu += pct;
        cur.first = Math.min(cur.first, m.first_seen);
        cur.last = Math.max(cur.last, m.last_seen);
      }
    }
    for (const [core, s] of byCore) {
      const rate = s.cpu * CPU_RATE_SCALE;
      let a = nodeId, b = core;
      if (a > b) [a, b] = [b, a];
      procFlows.push({
        a, b, bytes: Math.round(rate), packets: 1,
        ports: ["cpu"], protos: ["cpu"], ifaces: [],
        first_seen: s.first, last_seen: s.last, rate,
      });
    }
  }
  return { devices: [...keep, ...grouped], procFlows };
}

function cpuSlice(msg: StateMsg, mode: ViewMode, opts: Record<string, string>): { devices: Device[]; flows: Flow[]; gateway: string; localIp: string } {
  const view = msg.views?.cpu;
  if (!view) return { devices: [], flows: [], gateway: "cpu:host", localIp: "cpu:host" };
  let devices = view.devices.filter((d) => keepCpuIdentity(d, mode.id, opts));
  let flows = view.flows;
  if ((opts.group ?? "each") === "name") {
    const g = groupCpuByName(devices);
    devices = g.devices;
    flows = [...view.flows.filter((f) => !f.a.startsWith("proc:") && !f.b.startsWith("proc:")), ...g.procFlows];
  }
  devices = devices.filter((d) => keepCpuBusy(d, mode.id, opts));
  const ids = new Set(devices.map((d) => d.ip));
  return {
    devices,
    flows: flows.filter((f) => ids.has(f.a) && ids.has(f.b)),
    gateway: view.hub || "cpu:host",
    localIp: view.self || "cpu:host",
  };
}

function keepCpuIdentity(d: Device, modeId: string, opts: Record<string, string>): boolean {
  if (d.ip === "cpu:host" || d.ip.startsWith("cpu:")) return true;
  if (!d.ip.startsWith("proc:")) return false;
  if (cpuCoresMode(modeId)) return (opts.show ?? "busy") !== "cores";
  const who = opts.who ?? "all";
  if (who === "mine" && d.role !== "local") return false;
  if (who === "kernel" && d.role !== "multicast") return false;
  return true;
}

function keepCpuBusy(d: Device, modeId: string, opts: Record<string, string>): boolean {
  if (!d.ip.startsWith("proc:")) return true;
  const pct = d.cpu ?? 0;
  if (cpuCoresMode(modeId)) {
    const show = opts.show ?? "busy";
    if (show === "busy") return pct >= 1;
    return true;
  }
  const min = Number(opts.min);
  return pct >= (Number.isFinite(min) ? min : 0.5);
}

function sysSlice(msg: StateMsg, base: string): { devices: Device[]; flows: Flow[]; gateway: string; localIp: string } {
  const view = msg.views?.[base];
  const fallback = `${base}:host`;
  if (!view) return { devices: [], flows: [], gateway: fallback, localIp: fallback };
  return {
    devices: view.devices ?? [],
    flows: view.flows ?? [],
    gateway: view.hub || fallback,
    localIp: view.self || fallback,
  };
}

function rfSlice(msg: StateMsg, mode: ViewMode, opts: Record<string, string> = {}): { devices: Device[]; flows: Flow[]; gateway: string; localIp: string } {
  const base = mode.graphBase;
  if (base === "wifi") return wifiViaGateway(msg, opts);
  if (base === "bluetooth") {
    const view = msg.views?.bluetooth;
    const devices = capBluetoothDevices(view?.devices ?? [], opts);
    const ids = new Set(devices.map((d) => d.ip));
    return {
      devices,
      flows: (view?.flows ?? []).filter((f) => ids.has(f.a) && ids.has(f.b)),
      gateway: view?.hub || "",
      localIp: view?.self || "",
    };
  }
  if (base === "cpu") return cpuSlice(msg, mode, opts);
  if (base === "sources") return sourcesSlice(msg.sources, opts);
  if (isSysBase(base)) return sysSlice(msg, base);
  return { devices: msg.devices, flows: msg.flows, gateway: msg.gateway, localIp: msg.local_ip };
}

const GLOW_VERT = `
attribute float along;
attribute float glowAb;
attribute float glowBa;
varying vec3 vColor;
varying float vAlong;
varying float vAb;
varying float vBa;
void main() {
  vColor = color;
  vAlong = along;
  vAb = glowAb;
  vBa = glowBa;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAG = `
uniform float uTime;
uniform float uSpeed;
uniform float uAmt;
uniform float uMode;
uniform float uAdditive;
varying vec3 vColor;
varying float vAlong;
varying float vAb;
varying float vBa;

float comet(float along, float phase) {
  float behind = fract(phase - along);
  return exp(-behind * 3.6);
}
float pulse(float along, float phase) {
  return 0.35 + 0.65 * 0.5 * (1.0 + sin((along - phase) * 6.2831853));
}

void main() {
  float glow = 0.0;
  if (vAb > 0.001) {
    float phase = fract(uTime * uSpeed * (0.40 + 0.70 * vAb));
    glow += vAb * (uMode < 0.5 ? comet(vAlong, phase) : pulse(vAlong, phase));
  }
  if (vBa > 0.001) {
    float phase = fract(uTime * uSpeed * (0.40 + 0.70 * vBa));
    float along = 1.0 - vAlong;
    glow += vBa * (uMode < 0.5 ? comet(along, phase) : pulse(along, phase));
  }
  glow *= uAmt;
  vec3 rgb = vColor * (0.25 + glow * 3.6);
  float a = clamp(0.12 * max(vAb, vBa) * uAmt + glow, 0.0, 1.0);
  if (uAdditive > 0.5) gl_FragColor = vec4(rgb * a, 1.0);
  else gl_FragColor = vec4(rgb, a);
}
`;

function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 1 },
      uAmt: { value: 1 },
      uMode: { value: 0 },
      uAdditive: { value: 1 },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}
const _edgeTmp = new THREE.Color();
const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const ARROW_CAP = 280;
const _hit = new THREE.Vector3();
const _sph = new THREE.Spherical();
const _sphWant = new THREE.Spherical();
const _off = new THREE.Vector3();
const _restT = new THREE.Vector3();
const _hot = new THREE.Vector3();
const _camWant = new THREE.Vector3();
const _fadeB = new THREE.Color();
const _colA = new THREE.Color();
const _colB = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
const _overlayKeep = new Set<string>();
const _bulkGoal = new THREE.Vector3();

/** Bytes/s before a node pulls the dream zoom. Quiet mDNS chatter stays out of the centroid. */
const DREAM_HOT_MIN_RATE = 400;
/** How slowly the focus point tracks shifting activity (seconds). */
const DREAM_FOCUS_TAU = 10;

/** Cinematic orbit: yaw around the captured view, a pitch nod, and a slow zoom toward busy nodes. */
export interface DreamAnim {
  /** seconds per full yaw revolution */
  yawPeriod: number;
  /** pitch nod amplitude in degrees */
  pitchDeg: number;
  /** seconds per pitch cycle */
  pitchPeriod: number;
  /** 0–1 fraction of rest radius to dolly in at the zoom peak */
  zoom: number;
  /** seconds for a full zoom in-and-out */
  zoomPeriod: number;
  /** when on, the zoom eases the look-at toward the highest-activity nodes */
  follow: boolean;
  /** cycle graph views while dreaming */
  cycle: boolean;
  /** seconds between view / motion pulses */
  cyclePeriod: number;
  /** pick new orbit/pitch/zoom within the slider ranges on each pulse */
  randomize: boolean;
  /** far-field sky behind the graph */
  backdrop: BackdropKind;
  skyOpacity: number;
  skyBright: number;
  skyAudio: boolean;
  /** 0–4 multiplier on the sky's animation clock (0 freezes it) */
  skySpeed: number;
  /** 0–1 how gently that clock's speed follows the pulse and the slider: 0 snaps, 1 glides over seconds */
  skyEase: number;
  /** minutes between Gemma sky recipes when backdrop is AI Dynamic */
  skyAiMin: number;
  /** pulse the scene clear / fog (the fill behind the sky) */
  bgAudio: boolean;
  /** empty string = scene fill follows the theme's defined bg */
  bgColor: string;
  /** 0–1 how much of the fill stays; the rest is black (dark themes) or white (light) */
  bgOpacity: number;
  gridOpacity: number;
  gridBright: number;
  gridAudio: boolean;
  /** empty string = follow the theme's grid colour */
  gridColor: string;
  /** world units on a side of each tile */
  gridSize: number;
  gridShape: FloorShape;
  /** 0–1 how hard the floor sits under the graph (0 = world-fixed, 1 = glued) */
  gridFollow: number;
  /** 0–2 multiplier on the audio / traffic pulse */
  audioSens: number;
  /** what feeds the pulse: microphone (traffic fallback), whole-network rate, or the selected node */
  audioDrive: AudioDrive;
  /** modulate dream camera orbit / pitch / zoom from the pulse */
  audioCamera: boolean;
  /** 0–2 how hard the audio / traffic pulse drives the camera (FOV, orbit speed, zoom) when audioCamera is on */
  camAudio: number;
  /** 0–2 how hard detected velocity of change (layout motion + pulse onset) drives the camera */
  camChange: number;
  /** 0–2 how hard webcam gaze steers look-at and orbit; asks for the camera when > 0 */
  camGaze: number;
  /** 0–1 how heavily the camera resists all motion (orbit, nod, zoom, gaze, framing, FOV); 0 tracks immediately */
  camInertia: number;
  /** 0–1 how slowly motion may reverse: camera steps and node velocities ease through zero instead of snapping */
  moveEase: number;
  /** tint the theme's accent, edges and roles toward the main colour in the webcam */
  camTheme: boolean;
  /** bounce and glow graph nodes from the pulse; drag a node to pin it, release to fling */
  audioNodes: boolean;
  /** random theme: off, on the view cadence, or on audio beats */
  themeCycle: ThemeCycle;
  /** random far-field sky (including live camera): same clocks as theme, independently on or off */
  skyCycle: ThemeCycle;
  /** 0.5–2 multiplier on CSS label size (and font-weight) */
  labelWeight: number;
  /** how many idle LAN / internet names to keep on besides self, gateway, selection, and live bursts */
  labelCount: number;
  /** ease labels / sparks / glow / sky / pixel density down if the 30 s average stays under 10 fps; restore on a 1-minute recovered average */
  autoTune: boolean;
  /** 0.4–2.5 multiplier on sphere radius */
  nodeWeight: number;
  /** 0.3–2.5 multiplier on edge brightness and particle size */
  edgeWeight: number;
  /** traveling highlight on active edges: off, comet (directional head), or pulse (standing wave) */
  edgeGlow: EdgeGlow;
  /** 0–2 multiplier on the glow */
  edgeGlowAmt: number;
  /** 0.25–3 multiplier on how fast the glow travels */
  edgeGlowSpeed: number;
  /** draw the graph as an animated mesh (nodes + edges are the fabric) */
  graphFabric: FabricKind;
  /** auto follows the view; plane / space force 2D or 3D layout for any plugin */
  graphSpace: GraphSpace;
  /** auto keeps the view's placement; tree / radial / globe / bars / … override any graph plugin */
  graphLayout: GraphLayout;
  /** auto keeps strings + sparks; arrows / bundle add 3d-force-graph / reagraph edge tricks */
  graphLinks: GraphLinks;
  /** simultaneous view wall: off, 2×2, 2×3, 2×4 */
  mosaic: MosaicSize;
  /** full-height hero pane for the current view; tiles keep the mosaic count */
  hero: HeroPos;
  /** live split tree (ratios + which view sits in each cell). null = build from mosaic/hero */
  mosaicTree: MosaicNode | null;
  /** view id filling the wall; the tree stays so restore works */
  mosaicMaxId: string;
  /** leaf view ids in tree order — AI may rewrite these when layout is locked */
  mosaicTiles: string[];
  /** one header palette on every mosaic tile; off gives each view its own */
  mosaicSharedTheme: boolean;
  /** When true, each mosaic pane gets a sky no other pane has. */
  mosaicUniqueSkies?: boolean;
  /** Per-tile host skies for a unique-sky wall (plugin shaders stay `plugin`). */
  mosaicSkies?: Partial<Record<string, BackdropKind>>;
  /** what the camera frames: moving/busy nodes, movers only, or the whole graph as a box */
  focus: FocusMode;
  /** 0–2 traffic-spark density */
  partAmt: number;
  /** 0.25–3 how hard byte-rate feeds spark count */
  partBusy: number;
  /** bytes/s below this spawn no sparks */
  partQuiet: number;
  /** max sparks on one edge */
  partPeak: number;
  /** global spark cap */
  partCap: number;
  /** 0.25–3 spark travel speed */
  partSpeed: number;
  /** 0.3–2.5 spark size (on top of edgeWeight) */
  partSize: number;
  /** pulse spark count and speed */
  audioParts: boolean;
  /** same-type magnet −1 repel … +1 attract (0 = off) */
  magnetSelf: number;
  magnetGateway: number;
  magnetLan: number;
  magnetLocal: number;
  magnetInternet: number;
  magnetMulticast: number;
  /** −1…+1 magnet between different types */
  magnetCross: number;
  /** 0.15–2 how far magnets reach */
  magnetRange: number;
  /** 0–2 pull toward the floor */
  gravity: number;
  /** 0–2 yaw torque around the origin */
  swirl: number;
  /** 0–2 multiplier on the existing many-body spread */
  chargeAmt: number;
  /** 0–2 multiplier on edge spring strength */
  spring: number;
  /** 0.4–2.5 multiplier on rest length of edges */
  linkSpan: number;
  /** 0.12–0.7 velocity decay (higher = heavier / less bounce) */
  drag: number;
  /** 0–2 multiplier on the origin centering force */
  centerPull: number;
  /** 0–1 sag of edges into strings (0 = straight) */
  stringAmt: number;
  /** pulse magnets, gravity, swirl, and string sag */
  audioPhysics: boolean;
}

export type MosaicSize = "off" | "4" | "6" | "8";
export type EdgeGlow = "off" | "comet" | "pulse";
export type HeroPos = "off" | "left" | "center" | "right";
export type FocusMode = "activity" | "motion" | "cloud" | "selection";

export const FOCUS_MODES: { value: FocusMode; label: string; hint: string }[] = [
  { value: "activity", label: "activity", hint: "frame the nodes that are moving or carrying traffic, and keep that cluster near the viewport centre most of the time" },
  { value: "motion", label: "motion", hint: "frame only nodes that are currently moving in the layout" },
  { value: "cloud", label: "whole graph", hint: "frame every visible node as a box that matches the viewport, not a sphere" },
  { value: "selection", label: "selection", hint: "frame the selected (or hovered) node and its neighbours — click-to-focus" },
];

export type AudioDrive = "mic" | "traffic" | "node";
export type ThemeCycle = "off" | "cadence" | "audio";

export const AUDIO_DRIVES: { value: AudioDrive; label: string; hint: string }[] = [
  { value: "mic", label: "mic", hint: "microphone; live traffic if the mic is unavailable" },
  { value: "traffic", label: "traffic", hint: "whole-network packet rate" },
  { value: "node", label: "selection", hint: "selected (or hovered) node's rate — drag a node to pick it" },
];

export const THEME_CYCLES: { value: ThemeCycle; label: string; hint: string }[] = [
  { value: "off", label: "off", hint: "keep the current theme" },
  { value: "cadence", label: "cadence", hint: "random theme on the view cadence, with a fade" },
  { value: "audio", label: "beat", hint: "random theme on audio / traffic transients" },
];

export const SKY_CYCLES: { value: ThemeCycle; label: string; hint: string }[] = [
  { value: "off", label: "off", hint: "keep the current far-field sky" },
  { value: "cadence", label: "cadence", hint: "random authored sky on the view cadence (not AI Dynamic)" },
  { value: "audio", label: "beat", hint: "random sky on audio / traffic transients — independent of theme cycle" },
];

export const EDGE_GLOWS: { value: EdgeGlow; label: string; hint: string }[] = [
  { value: "off", label: "off", hint: "no traveling highlight; particles still show traffic" },
  { value: "comet", label: "comet", hint: "a head-and-tail glow runs along each active edge in the traffic direction" },
  { value: "pulse", label: "pulse", hint: "a soft wave travels the edge; both ways when the conversation is two-sided" },
];

export const MOSAIC_SIZES: { value: MosaicSize; label: string; hint: string }[] = [
  { value: "off", label: "1×", hint: "one view, full screen" },
  { value: "4", label: "2×2", hint: "four tiles; with a center hero, two on each side" },
  { value: "6", label: "2×3", hint: "six tiles; with a center hero, four on the left and two on the right" },
  { value: "8", label: "2×4", hint: "eight tiles; with a center hero, four on each side" },
];

export const HERO_POS: { value: HeroPos; label: string; hint: string }[] = [
  { value: "off", label: "off", hint: "equal tiles; no full-height pane" },
  { value: "left", label: "left", hint: "current view full height on the left; tiles fill the right" },
  { value: "center", label: "center", hint: "current view full height in the middle; tiles split left/right (2×3 → 4+2)" },
  { value: "right", label: "right", hint: "current view full height on the right; tiles fill the left" },
];

export const DEFAULT_DREAM: DreamAnim = {
  yawPeriod: 150,
  pitchDeg: 8,
  pitchPeriod: 16,
  zoom: 0.4,
  zoomPeriod: 55,
  follow: true,
  cycle: false,
  cyclePeriod: 45,
  randomize: false,
  backdrop: "none",
  skyOpacity: 1,
  skyBright: 1,
  skyAudio: true,
  skySpeed: 1,
  skyEase: 0.55,
  skyAiMin: 5,
  bgAudio: false,
  bgColor: "",
  bgOpacity: 1,
  gridOpacity: 0.7,
  gridBright: 1,
  gridAudio: true,
  gridColor: "",
  gridSize: 50,
  gridShape: "square",
  gridFollow: 1,
  audioSens: 1,
  audioDrive: "mic",
  audioCamera: true,
  camAudio: 1,
  camChange: 0.6,
  camGaze: 0,
  camInertia: 0.55,
  moveEase: 0.45,
  camTheme: false,
  audioNodes: false,
  themeCycle: "off",
  skyCycle: "off",
  labelWeight: 1,
  labelCount: 20,
  autoTune: true,
  nodeWeight: 1,
  edgeWeight: 1,
  edgeGlow: "comet",
  edgeGlowAmt: 1,
  edgeGlowSpeed: 1,
  graphFabric: "auto",
  graphSpace: "auto",
  graphLayout: "auto",
  graphLinks: "auto",
  mosaic: "off",
  hero: "off",
  mosaicTree: null,
  mosaicMaxId: "",
  mosaicTiles: [],
  mosaicSharedTheme: false,
  focus: "activity",
  partAmt: 1,
  partBusy: 1,
  partQuiet: 0,
  partPeak: 40,
  partCap: MAX_PARTICLES,
  partSpeed: 1,
  partSize: 1,
  audioParts: false,
  magnetSelf: 0,
  magnetGateway: 0,
  magnetLan: 0,
  magnetLocal: 0,
  magnetInternet: 0,
  magnetMulticast: 0,
  magnetCross: 0,
  magnetRange: 1,
  gravity: 0,
  swirl: 0,
  chargeAmt: 1,
  spring: 1,
  linkSpan: 1,
  drag: 0.35,
  centerPull: 1,
  stringAmt: 0,
  audioPhysics: false,
};

export const DREAM_BOUNDS = {
  yawPeriod: { min: 40, max: 480, step: 10 },
  pitchDeg: { min: 0, max: 20, step: 1 },
  pitchPeriod: { min: 6, max: 40, step: 1 },
  zoom: { min: 0, max: 0.7, step: 0.05 },
  zoomPeriod: { min: 15, max: 180, step: 5 },
  cyclePeriod: { min: 15, max: 180, step: 5 },
  opacity: { min: 0, max: 1, step: 0.05 },
  bright: { min: 0, max: 2, step: 0.05 },
  skySpeed: { min: 0, max: 4, step: 0.05 },
  skyEase: { min: 0, max: 1, step: 0.05 },
  skyAiMin: { min: 1, max: 30, step: 1 },
  gridSize: { min: 16, max: 160, step: 4 },
  gridFollow: { min: 0, max: 1, step: 0.05 },
  audioSens: { min: 0, max: 2, step: 0.05 },
  camDrive: { min: 0, max: 2, step: 0.05 },
  camInertia: { min: 0, max: 1, step: 0.05 },
  moveEase: { min: 0, max: 1, step: 0.05 },
  labelWeight: { min: 0.5, max: 2, step: 0.05 },
  labelCount: { min: 8, max: 120, step: 4 },
  nodeWeight: { min: 0.4, max: 2.5, step: 0.05 },
  edgeWeight: { min: 0.3, max: 2.5, step: 0.05 },
  edgeGlowAmt: { min: 0.2, max: 2, step: 0.05 },
  edgeGlowSpeed: { min: 0.25, max: 3, step: 0.05 },
  partAmt: { min: 0, max: 2, step: 0.05 },
  partBusy: { min: 0.25, max: 3, step: 0.05 },
  partQuiet: { min: 0, max: 4000, step: 50 },
  partPeak: { min: 1, max: 80, step: 1 },
  partCap: { min: 20, max: MAX_PARTICLES, step: 20 },
  partSpeed: { min: 0.25, max: 3, step: 0.05 },
  partSize: { min: 0.3, max: 2.5, step: 0.05 },
  magnet: { min: -1, max: 1, step: 0.05 },
  magnetRange: { min: 0.15, max: 2, step: 0.05 },
  gravity: { min: 0, max: 2, step: 0.05 },
  swirl: { min: 0, max: 2, step: 0.05 },
  chargeAmt: { min: 0, max: 2, step: 0.05 },
  spring: { min: 0, max: 2, step: 0.05 },
  linkSpan: { min: 0.4, max: 2.5, step: 0.05 },
  drag: { min: 0.12, max: 0.7, step: 0.01 },
  centerPull: { min: 0, max: 2, step: 0.05 },
  stringAmt: { min: 0, max: 1, step: 0.05 },
};

/**
 * Per-instance node shapes (modes.SHAPES). Every node is an instance of one unit sphere; the vertex shader moves each
 * vertex along its own direction to the radius the shape has there, so a cube, a star or a disc costs nothing extra
 * and stays one draw call. Radii are picked for roughly equal volume, so a network's shape does not read as size.
 * The normal comes from two neighbouring surface points (finite differences), which also softens the edges a little.
 */
const SHAPE_GLSL = `
float shapeR(vec3 d, float s) {
  vec3 a = abs(d);
  if (s < 0.5) return 1.0;                                            // sphere
  if (s < 1.5) return 0.8 / max(a.x, max(a.y, a.z));                  // cube
  if (s < 2.5) { float m = max(a.x, max(a.y, a.z)); return 0.55 + 0.75 * pow(m, 10.0); }  // six-pointed star
  if (s < 3.5) return 1.46 / (a.x + a.y + a.z);                       // octahedron
  if (s < 4.5) return 1.35 / (0.95 * a.y + 1.35 * length(d.xz));      // diamond: two cones tip to base
  if (s < 5.5) return 1.15 / length(vec3(d.x, d.y * 2.6, d.z));       // disc
  float hull = 0.58 / length(vec3(d.x * 1.2, d.y * 2.05, d.z * 1.2)); // drone: squat hull
  float armX = 1.28 / max(a.y * 5.4, length(vec2(a.x * 0.38, a.z * 2.7)));
  float armZ = 1.28 / max(a.y * 5.4, length(vec2(a.z * 0.38, a.x * 2.7)));
  float tip = length(vec2(abs(d.x) - 0.62, abs(d.z) - 0.62));
  float rotor = 0.95 / length(vec3(d.x, d.y * 9.0, d.z));
  float rotorMask = 1.0 - smoothstep(0.18, 0.42, tip);
  return max(hull, max(armX, max(armZ, mix(hull, rotor, rotorMask * 0.85))));
}
vec3 shapeNormal(vec3 d, float s) {
  vec3 t1 = normalize(cross(d, abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(d, t1);
  vec3 p0 = d * shapeR(d, s);
  vec3 d1 = normalize(d + 0.02 * t1);
  vec3 d2 = normalize(d + 0.02 * t2);
  vec3 n = cross(d1 * shapeR(d1, s) - p0, d2 * shapeR(d2, s) - p0);
  n = normalize(n);
  return dot(n, d) < 0.0 ? -n : n;
}
`;

/**
 * One lit material for every node. Colour comes from `instanceColor`; the emissive glow (selection / hover / activity),
 * the opacity (offline devices) and the shape are per-instance attributes spliced into the standard shader, so the
 * whole device cloud is a single draw call instead of one mesh and one material per device.
 */
function sphereMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, transparent: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float instanceGlow;\nattribute float instanceAlpha;\nattribute float instanceShape;\nvarying float vGlow;\nvarying float vAlpha;" + SHAPE_GLSL)
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nif (instanceShape > 0.5) objectNormal = shapeNormal(normalize(position), instanceShape);")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nif (instanceShape > 0.5) { vec3 sd = normalize(position); transformed = sd * shapeR(sd, instanceShape); }\nvGlow = instanceGlow;\nvAlpha = instanceAlpha;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;\nvarying float vAlpha;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vAlpha;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance = vColor.rgb * vGlow;");
  };
  return mat;
}

/** An instanced sphere cloud with room for `cap` nodes and the extra per-instance attributes the material reads. */
function sphereCloud(material: THREE.Material, cap: number): THREE.InstancedMesh {
  // 20×16 is enough for cube/star edges to read; 32×24 was ~2.4× the vertex work per instance
  const geo = new THREE.SphereGeometry(1, 20, 16);
  geo.setAttribute("instanceGlow", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
  geo.setAttribute("instanceAlpha", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
  geo.setAttribute("instanceShape", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
  const mesh = new THREE.InstancedMesh(geo, material, cap);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false; // the bounding sphere would be the unit geometry's, not the cloud's
  return mesh;
}

export interface SceneOpts {
  /** extra mosaic pane: no microphone, lower pixel ratio, no view-cadence callbacks */
  satellite?: boolean;
  /** draw through a shared context (one canvas for the whole wall) instead of owning a canvas */
  host?: RenderHost;
}

export class NetScene implements HostedView {
  readonly renderer: HostGpu;
  /** shared renderer this scene draws through, or null when it owns `renderer` */
  private readonly host: RenderHost | null;
  /** where pointer / wheel listeners live: the shared host's pane container, or this scene's canvas */
  private readonly inputEl: HTMLElement;
  /** viewport of the last present() through the host, framebuffer pixels */
  private lastVp: Viewport | null = null;
  private readonly glVpScratch: GlRectMut = { x: 0, y: 0, w: 0, h: 0 };
  /** WebGL clear colour this scene wants (applied at present time so panes sharing a context differ) */
  private clearHex: number;
  readonly labelLayer: LabelLayer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private nodes = new Map<string, GNode>();
  private links = new Map<string, GLink>();
  /** every drawn device sphere in one draw call; labels live in `labelLayer` (positioned by hand each frame) */
  private spheres: THREE.InstancedMesh;
  private readonly sphereMat = sphereMaterial();
  private readonly fabric = new GraphFabric();
  private arrows: THREE.InstancedMesh;
  private layoutTargets = new Map<string, LayoutXyz>();
  private layoutSig = "";
  /** the force layout, ticking in a Worker; positions arrive one frame later and are copied onto the nodes */
  private readonly layout: LayoutClient;
  /** nodes in the layout, in wire order for the current `simGen` */
  private simNodes: GNode[] = [];
  private simGen = 0;
  private nextSimKey = 1;
  /** alpha floor to request with the next tick (setAnim / drag / structure bumps) */
  private pendingAlpha = 0;
  /** alpha the layout last reported, handed to mode forces */
  private layoutAlpha = 1;
  private nudgeBuf = new Float32Array(0);
  private posRecycle: Float32Array | null = null;
  private pendingPin: Float32Array | null = null;
  private pendingRelease: Float32Array | null = null;
  private lastLayoutParams: LayoutParams | null = null;
  private lines: THREE.LineSegments;
  private glowLines: THREE.LineSegments;
  private glowMat: THREE.ShaderMaterial;
  private linePos: Float32Array;
  private lineCol: Float32Array;
  private glowAlong: Float32Array;
  private glowAb: Float32Array;
  private glowBa: Float32Array;
  private glowCol: Float32Array;
  private particles: THREE.Points;
  private partPos: Float32Array;
  private partCol: Float32Array;
  private partState: { link: GLink; t: number; dir: 1 | -1; speed: number }[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(2, 2);
  private hovered: GNode | null = null;
  private selected: GNode | null = null;
  private filters: Filters = { lan: true, internet: true, multicast: false, offline: true, labels: true, cpuIdle: true };
  /** allow/block predicate from the settings cog; hides matching devices (defaults to show-all) */
  private nodeFilter: (d: Device) => boolean = () => true;
  private lastInteraction = performance.now();
  /** false while a standalone view (NetPong) owns the screen: the frame loop idles instead of rendering */
  private active = true;
  /** hide the graph and keep only sky / floor / fog (arcade views draw on top) */
  private stageOnly = false;
  private vizHeadlineText = "";
  private now = Date.now() / 1000;
  /** Host-engine stub so an empty catalog still constructs; catalog default is applied via setMode. */
  private mode: ViewMode = topology;
  private modeOpts: Record<string, string> = {};
  private lastMsg: StateMsg | null = null;
  /** raw address -> representative node, filled by the "merge names" collapse (empty when off) */
  private aliasMap = new Map<string, string>();
  private overlayObjs = new Map<string, LabelItem>();
  private decoObjs = new Map<string, LabelItem>();
  private agentLook: AgentLook = EMPTY_LOOK;
  /** unit direction to glide toward on a mode switch; distance is fitted to the focus box */
  private cameraGoalDir: THREE.Vector3 | null = null;
  /** axis-aligned box around the current focus set (not a sphere) */
  private focus = { x: 0, y: 0, z: 0, hx: 280, hy: 220, hz: 280, n: 0 };
  /** cinematic orbit: yaw, pitch nod, and zoom toward busy nodes; paused while the user drags */
  private dreaming = false;
  private dreamHeld = false;
  /** user panned / zoomed / orbited: keep that look-at instead of sliding back to the focus box */
  private lookPinned = false;
  /** Follow OrbitControls damping after release before dream / fit take the camera again. */
  private camCoastUntil = 0;
  /** Linux often drops ctrlKey after the first ctrl+two-finger tick; stay on pan for this burst. */
  private pinchWheelUntil = 0;
  private dreamYaw = 0;
  private dreamPitch = 0;
  private dreamZoom = 0;
  private dreamRest = { radius: 1, phi: Math.PI / 4, theta: 0, tx: 0, ty: 0, tz: 0 };
  /** last applied camera step; moveEase turns this toward the new error so heading cannot reverse in one frame */
  private camStep = { theta: 0, phi: 0, radius: 0, tx: 0, ty: 0, tz: 0, fov: 0 };
  private dreamFocus = new THREE.Vector3();
  private dreamFocusW = 0;
  private anim: DreamAnim = { ...DEFAULT_DREAM };
  private tune: PerfOverlay | null = null;
  private lastTuneDpr = 0;
  private baseDpr = 1;
  /** latest physics knobs from setAnim; `anim` chases these over PHYS_EASE_S */
  private physWant: PhysEase | null = null;
  private dreamPulseT = 0;
  private theme: Theme = DEFAULT_THEME;
  private rim: THREE.PointLight;
  private grid = new FloorGrid();
  private lastFloor: FloorPose = floorPose({ x: 0, y: 0, z: 0, hx: 280, hz: 280, n: 0 });
  private backdrop = new Backdrop();
  private pulse = new AudioPulse();
  /** Spectrum scene wants the microphone even when the pulse drive is traffic. */
  private wantHeard = false;
  onSelect: (d: Device | null) => void = () => {};
  /** fired on the dream cadence so the app can cycle views / reshuffle motion */
  onDreamPulse: () => void = () => {};
  /** fired on a bass transient when theme cycle is set to beat */
  onThemePulse: () => void = () => {};
  /** After this frame's look pass, so pulse and spectrum are current. */
  afterLook: (() => void) | null = null;
  /** live webcam colour for camTheme, or null when the option is off / the camera is dark */
  onCamTheme: (hex: number | null) => void = () => {};
  /** last smoothed webcam colour (packed RGB), for a theme switch to retint immediately */
  liveCamColor: number | null = null;
  /** last heat hint from a sandboxed TypeScript plugin */
  pluginHeat = 0;
  private readonly pluginHeatColor = new THREE.Color();
  private pluginColors = new Map<string, number>();
  private pulseLevel = 0;
  private pulseBass = 0;
  /** 0–1 smoothed layout speed of moving nodes (sampleFocus); feeds camChange */
  private layoutVel = 0;
  /** 0–1 smoothed |d pulse / dt| plus layout velocity, for the camera's "change" mix */
  private changeVel = 0;
  private prevPulseLevel = 0;
  private gaze = new Gaze();
  private camHue = 0;
  private camSat = 0;
  private camHueOn = false;
  private camThemeAt = 0;
  private bassSlow = 0;
  private beatCool = 0;
  private fadeT = 1;
  private viewMorphT = 1;
  private fadeFrom = { clear: 0, fog: 0, rim: 0, gridMajor: 0, gridMinor: 0 };
  private dragging: GNode | null = null;
  private readonly dragPlane = new THREE.Plane();
  private readonly dragHit = new THREE.Vector3();
  private readonly dragVel = new THREE.Vector3();
  private readonly baseFov = 55;
  private readonly satellite: boolean;
  /** mosaic equal-tile (or non-hero) graph using the main scene — same half-label budget as extras */
  private compactLabels = false;
  private raf = 0;
  /** instanceColor / instanceShape only change on snapshot restyle, not every frame */
  private instanceStyleDirty = true;
  /** the label layer needs one flush after the last label/overlay is hidden */
  private labelsDrawn = false;
  private viewW = 0;
  private viewH = 0;
  /** eased setViewOffset X (positive slides the graph left to clear the live feed) */
  private padX = 0;
  private padWant = 0;
  private readonly ro: ResizeObserver;
  private readonly onWinResize: () => void;
  private readonly onCamPtrLost: (e: PointerEvent) => void;
  /** layout stretch so a wide viewport fills with the graph instead of a sphere sitting in the middle */
  private spreadX = 1;
  private spreadZ = 1;
  /** uncrowded shell radius → widened radius, for shells more nodes share than fit around them (measureCrowds) */
  private crowdRadius = new Map<number, number>();
  /** uncrowded shell radius → 0..1 flattening multiplier for shells still crowded after widening */
  private crowdRelax = new Map<number, number>();
  /** uncrowded shell radius → charge multiplier, so a crowd's total push stays about that of a full ring */
  private crowdCharge = new Map<number, number>();

  /** The radius the mode wants for the node before crowding is taken into account. */
  private baseShell(n: GNode): number {
    return this.mode.shellRadius?.(n, SHELL) ?? SHELL[n.device.role];
  }

  /** The radius the layout actually uses: the mode's, widened when the shell is crowded. */
  private shellR(n: GNode): number {
    const r = this.baseShell(n);
    return this.crowdRadius.get(r) ?? r;
  }

  /** `rfSlice` re-filters every device and flow; its hub / self answer only changes with these three inputs. */
  private sliceMemo: { msg: StateMsg; mode: ViewMode; opts: Record<string, string>; gateway: string; localIp: string } | null = null;

  private sliceHub(): { gateway: string; localIp: string } | null {
    const msg = this.lastMsg;
    if (!msg) return null;
    const m = this.sliceMemo;
    if (m && m.msg === msg && m.mode === this.mode && m.opts === this.modeOpts) return m;
    const slice = rfSlice(msg, this.mode, this.modeOpts);
    this.sliceMemo = { msg, mode: this.mode, opts: this.modeOpts, gateway: slice.gateway, localIp: slice.localIp };
    return this.sliceMemo;
  }

  private get ctx(): ModeCtx {
    const slice = this.sliceHub();
    return {
      now: this.now, nodes: this.nodes, links: this.links, opts: this.modeOpts,
      gateway: slice?.gateway || this.lastMsg?.gateway || "",
      localIp: slice?.localIp || this.lastMsg?.local_ip || "",
      selected: this.selected, spreadX: this.spreadX, spreadZ: this.spreadZ,
      labelCount: this.tune?.labelCount ?? this.anim.labelCount,
      smallPane: this.smallPane,
      watch: this.mode.graphBase === "wifi" ? this.lastMsg?.views?.wifi?.watch : undefined,
    };
  }

  private readonly paneFps: PaneFps;

  constructor(private container: HTMLElement, opts: SceneOpts = {}) {
    this.paneFps = new PaneFps(container);
    this.satellite = !!opts.satellite;
    this.host = opts.host ?? null;
    this.clearHex = this.theme.scene.clear;
    if (this.host) {
      // shared context: the host's canvas covers the wall; this pane is a transparent window onto it
      this.renderer = this.host.renderer;
      this.baseDpr = this.host.pixelRatio;
      this.lastTuneDpr = this.baseDpr;
      this.inputEl = container;
      container.classList.add("hosted");
      this.host.add(this);
    } else {
      const capped = devicePxRatioFromWindow();
      this.baseDpr = this.satellite
        ? Math.min(1, devicePxRatioNumber(capped))
        : devicePxRatioNumber(capped);
      this.lastTuneDpr = this.baseDpr;
      this.renderer = ownRenderer(container, {
        satellite: this.satellite,
        dpr: this.baseDpr,
        clearHex: this.clearHex,
        onLost: () => this.hostContextLost(),
        onRestored: () => this.hostContextRestored(),
      });
      this.inputEl = this.renderer.domElement;
    }

    this.labelLayer = new LabelLayer();
    this.labelLayer.setSize(container.clientWidth, container.clientHeight);
    Object.assign(this.labelLayer.domElement.style, { position: "absolute", top: "0", left: "0", pointerEvents: "none" });
    container.appendChild(this.labelLayer.domElement);

    const aw = container.clientWidth, ah = container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, ah > 0 ? aw / ah : 1, 1, 12000);
    this.camera.position.set(0, 820, 820);
    this.controls = new OrbitControls(this.camera, this.inputEl);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // left-drag / one-finger orbits; two-finger / wheel zooms; ctrl+two-finger or right-drag pans
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    // Orbit has no dolly-only two-finger mode; we own two-finger zoom / ctrl-pan below.
    this.controls.touches.TWO = 4 as typeof THREE.TOUCH.PAN;
    type OrbitWheel = OrbitControls & {
      _pan(dx: number, dy: number): void;
      _handleMouseWheel(e: { deltaY: number; clientX: number; clientY: number }): void;
      _customWheelEvent(e: WheelEvent): { deltaY: number; clientX: number; clientY: number };
    };
    this.inputEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.pinUserCamera();
      const orbit = this.controls as OrbitWheel;
      // two+ real pointers: we zoom / ctrl-pan from the pointer path; don't also wheel
      if (((this.controls as { _pointers?: unknown[] })._pointers?.length ?? 0) >= 2) {
        this.captureDreamRest();
        return;
      }
      const now = performance.now();
      const ctrlPan = pinchWheel(e) || now < this.pinchWheelUntil;
      if (ctrlPan) this.pinchWheelUntil = now + PINCH_HOLD_MS;
      const motion = wheelCamMotion(e, ctrlPan);
      if (motion.zoom) {
        const custom = orbit._customWheelEvent(e);
        if (!mouseWheelTick(e) && e.deltaMode === 0) custom.deltaY = motion.zoom * 10;
        orbit._handleMouseWheel(custom);
      }
      if (motion.panX || motion.panY) {
        orbit._pan(motion.panX, motion.panY);
        this.controls.update();
      }
      this.captureDreamRest();
    }, { capture: true, passive: false });
    type GestureScale = Event & { scale: number; clientX: number; clientY: number };
    let gestureScale = 1;
    this.inputEl.addEventListener("gesturestart", (e) => {
      e.preventDefault();
      gestureScale = 1;
      this.pinUserCamera();
    }, { passive: false });
    this.inputEl.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      const g = e as GestureScale;
      const deltaY = (gestureScale - g.scale) * 80;
      gestureScale = g.scale;
      this.pinchWheelUntil = performance.now() + PINCH_HOLD_MS;
      (this.controls as OrbitWheel)._handleMouseWheel({ deltaY, clientX: g.clientX, clientY: g.clientY });
      this.captureDreamRest();
    }, { passive: false });
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener("start", () => {
      this.lastInteraction = performance.now();
      this.controls.autoRotate = false;
      this.cameraGoalDir = null;
      this.dreamHeld = true;
    });
    this.controls.addEventListener("end", () => {
      this.dreamHeld = false;
      this.pinUserCamera();
    });

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(300, 500, 400);
    this.scene.add(key);
    this.rim = new THREE.PointLight(this.theme.scene.rim, 4000, 0, 1.2);
    this.rim.position.set(-400, -200, -300);
    this.scene.add(this.rim);
    this.scene.fog = new THREE.FogExp2(this.theme.scene.fog, 0.00075);

    // faint reference grid on the "floor"
    this.grid.setColors(this.theme.scene.gridMajor, this.theme.scene.gridMinor);
    this.scene.add(this.grid.mesh);
    this.scene.add(this.backdrop.mesh);
    this.scene.add(this.backdrop.fadeMesh);
    this.scene.add(this.backdrop.liveMesh);
    this.scene.add(this.backdrop.photoMesh);
    this.backdrop.setColors(this.theme.scene.rim, this.theme.scene.clear);

    // devices
    this.spheres = sphereCloud(this.sphereMat, SPHERE_CAPACITY);
    this.scene.add(this.spheres);
    this.scene.add(this.fabric.mesh);
    const arrowGeo = new THREE.ConeGeometry(5.5, 16, 7);
    arrowGeo.translate(0, 8, 0);
    this.arrows = new THREE.InstancedMesh(arrowGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false,
    }), ARROW_CAP);
    this.arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.arrows.visible = false;
    this.scene.add(this.arrows);

    // edges
    this.linePos = new Float32Array(0);
    this.lineCol = new Float32Array(0);
    const lg = new THREE.BufferGeometry();
    // additive (dark themes): dim lines fade into the background instead of being painted darker than it (black strokes).
    // Light themes use normal blending and edgeColor() lerps from the background instead.
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);
    this.glowAlong = new Float32Array(0);
    this.glowAb = new Float32Array(0);
    this.glowBa = new Float32Array(0);
    this.glowCol = new Float32Array(0);
    this.glowMat = glowMaterial();
    this.glowLines = new THREE.LineSegments(new THREE.BufferGeometry(), this.glowMat);
    this.glowLines.frustumCulled = false;
    this.glowLines.renderOrder = 1;
    this.scene.add(this.glowLines);

    // traffic particles
    this.partPos = new Float32Array(MAX_PARTICLES * 3);
    this.partCol = new Float32Array(MAX_PARTICLES * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(this.partPos, 3));
    pg.setAttribute("color", new THREE.BufferAttribute(this.partCol, 3));
    pg.setDrawRange(0, 0);
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 3.2, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    this.applyBlending();

    // layout. Accessors consult the active mode; d3 evaluates them when nodes/links are (re)assigned,
    // which syncSimulation does on every structural change and on mode switch.
    // Layout: the forces run in a Worker (see layout-core.ts). syncSimulation resolves every mode
    // accessor (shell radius / strength, charge, link strength) into numbers on each structural change,
    // and the active mode's own `force` runs here each frame as a velocity nudge on the reported positions.
    this.layout = new LayoutClient((m) => this.onLayoutPositions(m));

    this.updateSpread();
    this.pushLayoutParams(1 / 60);

    this.onWinResize = () => this.relayout();
    window.addEventListener("resize", this.onWinResize);
    this.ro = observeResize(container, () => this.relayout())!;
    const setPointer = (e: PointerEvent | MouseEvent) => {
      const r = this.inputEl.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    this.inputEl.addEventListener("pointermove", (e) => {
      setPointer(e);
      if (this.dragging) this.moveDrag();
    });
    this.inputEl.addEventListener("pointerleave", () => {
      if (!this.dragging) this.pointer.set(2, 2);
    });
    let downAt = 0, downX = 0, downY = 0;
    const camPts = new Map<number, { x: number; y: number }>();
    let lastFinger = { x: 0, y: 0 };
    const orbit = this.controls as OrbitWheel;
    const dropCamPtr = (id: number) => { camPts.delete(id); };
    this.onCamPtrLost = (e) => dropCamPtr(e.pointerId);
    window.addEventListener("pointerup", this.onCamPtrLost);
    window.addEventListener("pointercancel", this.onCamPtrLost);
    this.inputEl.addEventListener("pointerdown", (e) => {
      camPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (camPts.size >= 2) {
        const c = pointerCentroid(camPts.values());
        lastFinger = c ?? { x: e.clientX, y: e.clientY };
        if (this.dragging) this.endDrag();
        this.pinUserCamera();
      }
      downAt = performance.now(); downX = e.clientX; downY = e.clientY;
      setPointer(e);
      if (e.button !== 0 || camPts.size >= 2) return;
      const n = this.pick();
      if (!n) return;
      e.stopImmediatePropagation();
      this.beginDrag(n);
      this.inputEl.setPointerCapture(e.pointerId);
    }, true);
    this.inputEl.addEventListener("pointermove", (e) => {
      if (!camPts.has(e.pointerId)) return;
      camPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (camPts.size < 2) return;
      const c = pointerCentroid(camPts.values());
      if (!c) return;
      const dx = c.x - lastFinger.x;
      const dy = c.y - lastFinger.y;
      lastFinger = c;
      this.pinUserCamera();
      if (e.ctrlKey || e.metaKey) {
        if (dx || dy) {
          orbit._pan(dx, dy);
          this.controls.update();
        }
      } else {
        const deltaY = threeFingerZoomDelta(dy);
        if (deltaY) orbit._handleMouseWheel({ deltaY, clientX: c.x, clientY: c.y });
      }
      this.captureDreamRest();
    }, true);
    const finishPointer = (e: PointerEvent) => {
      const multi = camPts.size >= 2;
      dropCamPtr(e.pointerId);
      const wasDrag = this.dragging;
      if (this.dragging) this.endDrag();
      if (multi) return;
      if (performance.now() - downAt < 300 && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
        setPointer(e);
        this.select(this.pick());
      } else if (wasDrag) {
        this.select(wasDrag);
      }
    };
    this.inputEl.addEventListener("pointerup", finishPointer);
    this.inputEl.addEventListener("pointercancel", (e) => {
      dropCamPtr(e.pointerId);
      if (this.dragging) this.endDrag();
    });
    this.inputEl.addEventListener("dblclick", () => {
      this.lookPinned = false;
      this.camCoastUntil = 0;
      this.cameraGoalDir = null;
    });
    this.animate = this.animate.bind(this);
    // the host drives hosted scenes from its own loop
    if (!this.host) this.raf = requestAnimationFrame(this.animate);
  }

  // ------------------------------------------------------------------ HostedView

  get viewEl(): HTMLElement { return this.container; }
  hostFrame(ts: number): void { this.animate(ts); }
  noteFrameCost(ms: number): void { this.paneFps.noteGpu(ms); }
  hostContextLost(): void {
    this.lumaProbe.reset();
    this.changeProbe.reset();
  }
  hostContextRestored(): void { this.relayout(); }

  get software(): boolean {
    return this.host?.software ?? this.renderer instanceof SoftwareGpu;
  }

  /** Paint now so a canvas JPEG is not an empty WebGL backbuffer. */
  flushFrame(): void {
    this.present();
  }

  /** Draw this frame: into the shared host's viewport for this pane, or onto the scene's own canvas. */
  private present(): void {
    // After the camera has moved this frame, so a camera-locked plugin sky is never a frame behind.
    this.backdrop.syncCamera(this.camera);
    if (this.host) {
      this.lastVp = this.host.present(this, this.clearHex, this.scene, this.camera);
    } else if (this.renderer instanceof SoftwareGpu) {
      const canvas = this.renderer.domElement;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const pr = this.renderer.getPixelRatio();
        ctx.setTransform(pr, 0, 0, pr, 0, 0);
        ctx.fillStyle = cssHex(this.clearHex);
        ctx.fillRect(0, 0, this.viewW, this.viewH);
        this.paintSoftware(ctx, { x: 0, y: 0, w: this.viewW, h: this.viewH });
      }
    } else {
      const gl = this.renderer.getContext() as WebGL2RenderingContext | null;
      const draw = () => {
        this.renderer.setClearColor(this.clearHex);
        this.renderer.render(this.scene, this.camera);
      };
      if (gl) timeGpu(gl, draw, (ms) => this.paneFps.noteGpu(ms));
      else draw();
    }
    this.notePaneChange();
  }

  /** Count a frame only when this pane's own pixels differ from the previous sample. */
  private notePaneChange(): void {
    if (this.host && !this.lastVp) return;
    const now = performance.now();
    if (this.software) {
      const canvas = this.host?.canvas ?? (this.renderer instanceof SoftwareGpu ? this.renderer.domElement : null);
      const ctx = canvas?.getContext("2d");
      const devVp = this.lastVp && isDeviceRect(this.lastVp) ? this.lastVp : null;
      if (ctx && canvas && devVp && this.canvasProbe.sample(ctx, canvas, devVp)) this.paneFps.mark(now);
      return;
    }
    const gl = (this.host?.gl ?? (this.renderer as THREE.WebGLRenderer).getContext()) as WebGL2RenderingContext | null;
    if (!gl) return;
    let vp: GlRect;
    if (this.lastVp && this.lastVp.__unit === "gl") {
      vp = this.lastVp;
    } else {
      const dev = deviceRect(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      vp = toGlRectInto(dev, asCanvasDeviceHeight(gl.drawingBufferHeight), this.glVpScratch);
    }
    this.changeProbe.tick(gl, vp, this.lastFrameTs || now, (ts) => this.paneFps.mark(ts));
  }

  paintSoftware(ctx: CanvasRenderingContext2D, rect: SoftRect): void {
    const th = this.theme.scene;
    const segs: { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number; g: number; b: number }[] = [];
    for (let i = 0; i + 5 < this.linePos.length; i += 6) {
      segs.push({
        ax: this.linePos[i]!, ay: this.linePos[i + 1]!, az: this.linePos[i + 2]!,
        bx: this.linePos[i + 3]!, by: this.linePos[i + 4]!, bz: this.linePos[i + 5]!,
        r: this.lineCol[i] ?? 0, g: this.lineCol[i + 1] ?? 0, b: this.lineCol[i + 2] ?? 0,
      });
    }
    const partN = this.particles.geometry.drawRange.count;
    const particles = [];
    for (let i = 0; i < partN; i++) {
      particles.push({
        x: this.partPos[i * 3] ?? 0, y: this.partPos[i * 3 + 1] ?? 0, z: this.partPos[i * 3 + 2] ?? 0,
        r: this.partCol[i * 3] ?? 1, g: this.partCol[i * 3 + 1] ?? 1, b: this.partCol[i * 3 + 2] ?? 1,
      });
    }
    const wall = this.now;
    const modeCtx = this.ctx;
    const nodes = [];
    for (const n of this.nodes.values()) {
      if (!n.visible && n.scale <= COLLAPSED_SCALE) continue;
      const look = this.mode.liveLook?.(n, wall, modeCtx);
      nodes.push({
        x: (n.x ?? 0) + (look?.dx ?? 0),
        y: (n.y ?? 0) + (look?.dy ?? 0),
        z: (n.z ?? 0) + (look?.dz ?? 0),
        scale: n.scale * this.anim.nodeWeight * (look?.scale ?? 1),
        r: n.color.r, g: n.color.g, b: n.color.b, a: n.opacity,
        glow: n.glow,
        shape: look?.shape ?? n.shape,
        selected: n === this.selected,
        hovered: n === this.hovered,
      });
    }
    if (this.stageOnly || this.anim.backdrop === "plugin") {
      paintSoftwarePluginRain(ctx, rect, this.now, this.pulseNow.bass, this.vizHeadlineText);
      if (this.stageOnly) return;
    }
    paintSoftwareGraph(ctx, this.camera, rect, {
      clearHex: this.clearHex,
      rimHex: th.rim,
      dark: this.theme.dark,
      gridMajor: th.gridMajor,
      gridMinor: th.gridMinor,
      floor: {
        x: this.lastFloor.x, y: this.lastFloor.y, z: this.lastFloor.z,
        span: this.lastFloor.fadeFar * 0.85,
      },
      nodes,
      segs,
      particles,
    });
  }

  setFilters(f: Partial<Filters>): void {
    Object.assign(this.filters, f);
    this.applyVisibility();
    this.syncSimulation(0.3);
  }

  get currentFilters(): Filters { return { ...this.filters }; }

  /** User allow/block filter from settings: return false to hide a device. Re-applies visibility immediately. */
  setNodeFilter(fn: (d: Device) => boolean): void {
    this.nodeFilter = fn;
    this.applyVisibility();
    this.syncSimulation(0.3);
  }

  /** Switch view mode (or just its options). Restyles from the last snapshot and re-initialises the layout forces. */
  setMode(mode: ViewMode, opts: Record<string, string>): void {
    const changed = mode !== this.mode;
    this.mode = mode;
    this.modeOpts = { ...opts };
    if (changed) {
      this.beginViewMorph();
      if (!this.satellite) notePerfChange();
      for (const o of this.overlayObjs.values()) this.labelLayer.remove(o);
      this.overlayObjs.clear();
        if (mode.camera) {
        this.cameraGoalDir = new THREE.Vector3(...mode.camera).normalize();
        this.controls.autoRotate = false;
        this.lookPinned = false;
        this.camCoastUntil = 0;
        this.lastInteraction = performance.now();
      } else {
        this.cameraGoalDir = null;
      }
    }
    if (this.lastMsg) this.update(this.lastMsg);
    this.syncSimulation(changed ? 0.6 : 0.2);
    this.stampPane();
  }

  private beginViewMorph(): void {
    this.viewMorphT = 0;
    for (const n of this.nodes.values()) n.shapeFrom = n.shape;
    this.instanceStyleDirty = true;
  }

  get currentMode(): ViewMode { return this.mode; }
  get nodeCount(): number { return this.nodes.size; }
  get pluginSkyId(): string | null { return this.backdrop.pluginSkyId(); }

  /** Pause / resume rendering and layout ticks (the data model keeps updating either way). */
  setActive(on: boolean): void {
    if (on && !this.active) this.lastFrameTs = 0; // drop the idle time so the first frame back is not a jump
    this.active = on;
    if (on && this.dreaming) this.captureDreamRest();
  }

  /** Keep the sky and floor, hide nodes / edges / labels. Used while an arcade view owns the screen. */
  setStageOnly(on: boolean): void {
    this.stageOnly = on;
    if (on) {
      // Keep horizon level so FPS plugin skies (Backrooms) are not floor-biased by the graph orbit cam.
      const t = this.controls.target;
      _off.copy(this.camera.position).sub(t);
      _sph.setFromVector3(_off);
      _sph.phi = Math.PI * 0.5;
      this.camera.position.copy(t).add(_off.setFromSpherical(_sph));
      this.camera.lookAt(t);
      this.controls.update();
    }
    this.applyGraphMarks();
    this.particles.visible = !on;
    this.arrows.visible = !on && graphLinksArrows(this.anim.graphLinks);
    this.labelLayer.domElement.style.display = on ? "none" : "";
    this.labelLayer.domElement.style.visibility = on ? "hidden" : "";
    if (on) {
      for (const n of this.nodes.values()) n.label.visible = false;
    }
    for (const obj of this.overlayObjs.values()) obj.visible = !on;
    for (const obj of this.decoObjs.values()) obj.visible = !on;
    this.applyVisibility();
  }

  private fabricKind(): FabricKind {
    return resolveFabric(this.mode.fabric, this.anim.graphFabric);
  }

  /** Hide spheres / line edges when the fabric mesh owns the graph, and hide everything in stage-only. */
  private applyGraphMarks(): void {
    const show = !this.stageOnly;
    const kind = this.fabricKind();
    const mesh = show && fabricActive(kind);
    this.spheres.visible = show && !mesh;
    this.lines.visible = show && !mesh;
    this.glowLines.visible = show && !mesh && this.anim.edgeGlow !== "off";
    this.arrows.visible = show && !mesh && graphLinksArrows(this.anim.graphLinks);
    this.fabric.mesh.visible = mesh;
    this.inputEl.dataset.fabric = kind;
  }

  private syncArrows(str: { sag: number; wave: number; hx: number; hy: number; hz: number; bundle: number }): void {
    const on = !this.stageOnly && !fabricActive(this.fabricKind()) && graphLinksArrows(this.anim.graphLinks);
    if (!on) {
      this.arrows.count = 0;
      this.arrows.visible = false;
      return;
    }
    this.arrows.visible = true;
    (this.arrows.material as THREE.MeshBasicMaterial).color.setHex(this.theme.scene.rim);
    let n = 0;
    for (const l of this.links.values()) {
      if (n >= ARROW_CAP) break;
      if (!l.visible || l.id.startsWith("~")) continue;
      const { ab, ba } = flowDirRates(l.flow);
      const fwd = ab >= ba;
      const a = fwd ? l.source : l.target;
      const b = fwd ? l.target : l.source;
      const ax = a.x ?? 0, ay = a.y ?? 0, az = a.z ?? 0;
      const bx = b.x ?? 0, by = b.y ?? 0, bz = b.z ?? 0;
      const dist = Math.hypot(bx - ax, by - ay, bz - az);
      if (dist < 12) continue;
      const t = 0.72;
      const p = this.edgePoint(ax, ay, az, bx, by, bz, t, str);
      const q = this.edgePoint(ax, ay, az, bx, by, bz, Math.min(1, t + 0.1), str);
      _dir.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (_dir.lengthSq() < 1e-8) _dir.set(bx - ax, by - ay, bz - az);
      if (_dir.lengthSq() < 1e-8) continue;
      _dir.normalize();
      _quat.setFromUnitVectors(_axisY, _dir);
      const s = Math.min(2.4, Math.max(0.65, dist / 150)) * this.anim.edgeWeight;
      this.arrows.setMatrixAt(n, _m.compose(_pos.set(p[0], p[1], p[2]), _quat, _scl.set(s, s, s)));
      n++;
    }
    this.arrows.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  /** Slowly yaw, nod, and zoom around the current camera. Dragging reframes; the orbit continues from the new view. */
  setDream(on: boolean): void {
    this.dreaming = on;
    if (on) {
      this.controls.autoRotate = false;
      this.cameraGoalDir = null;
      this.dreamPulseT = 0;
      this.captureDreamRest();
    }
  }

  get isDreaming(): boolean { return this.dreaming; }
  /** Latest audio / traffic pulse, for HUD bars and other overlays. */
  get pulseNow(): { level: number; bass: number; listening: boolean } {
    return { level: this.pulseLevel, bass: this.pulseBass, listening: this.pulse.listening };
  }

  /**
   * Open the microphone for a true spectrum while this view is the analyser.
   * Header mic Off still wins. Does not invent bins from traffic.
   */
  setHeard(on: boolean): void {
    if (this.satellite || this.wantHeard === on) return;
    this.wantHeard = on;
    this.syncPulse();
  }

  /** Live mic spectrum, low frequency first. Zeros when the mic is not capturing. */
  heardSpectrum(count = 16): { level: number; spectrum: number[] } {
    const spectrum = this.pulse.heard(count);
    let sum = 0;
    for (const v of spectrum) sum += v;
    return { level: spectrum.length ? sum / spectrum.length : 0, spectrum };
  }
  /** Live animation settings so arcade views can share the sky and floor. */
  get dreamAnim(): DreamAnim { return this.anim; }
  private get smallPane(): boolean { return this.satellite || this.compactLabels; }

  /** Half the name budget when the main graph is a mosaic tile rather than the hero / full window. */
  setCompactLabels(on: boolean): void {
    if (this.compactLabels === on) return;
    this.compactLabels = on;
    if (this.lastMsg) this.refresh();
    else this.applyVisibility();
  }

  /** Live-tweak the orbit from the settings cog. Phases keep running so sliders do not jump the camera. */
  setAnim(a: DreamAnim): void {
    a = guardReadableAnim(a);
    const dropTheme = this.anim.camTheme && !a.camTheme;
    const next = { ...a };
    if (!this.physWant) this.physWant = pickPhys(a);
    else {
      this.physWant = pickPhys(a);
      applyPhys(next, this.anim);
    }
    const layoutChanged = this.anim.graphLayout !== a.graphLayout
      || this.anim.graphSpace !== a.graphSpace
      || this.anim.graphLinks !== a.graphLinks;
    next.graphLayout = next.graphLayout ?? "auto";
    next.graphLinks = next.graphLinks ?? "auto";
    this.anim = next;
    this.backdrop.setKind(a.backdrop);
    if (!this.satellite && a.backdrop === "dynamic") ensureSkyRecipe(a.skyAiMin * 60_000);
    if (!this.satellite) {
      const want = new Set(cameraConsumers({
        backdrop: a.backdrop,
        audioCamera: a.audioCamera,
        camGaze: a.camGaze,
        camTheme: a.camTheme,
      }));
      liveCam.setWanted("live-sky", want.has("live-sky"));
      liveCam.setWanted("gaze", want.has("gaze"));
      liveCam.setWanted("cam-theme", want.has("cam-theme"));
    }
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = this.fogDensity();
    this.applyWeights();
    this.rebuildLineBuffers();
    this.rebuildParticles();
    this.applyGraphMarks();
    this.applyVisibility();
    if (layoutChanged) {
      this.layoutSig = "";
      this.syncSimulation(0.45);
    }
    if (this.satellite) return;
    if (dropTheme) {
      this.liveCamColor = null;
      this.camHueOn = false;
      this.onCamTheme(null);
    }
    this.bumpAlpha(0.08);
    this.syncPulse();
  }

  /** Start or stop the pulse microphone from the current drive + header mic toggle. */
  syncPulse(): void {
    if (this.satellite) return;
    const mic = shouldRunMic(liveMic.micPolicy, this.anim.audioDrive, this.audioLive())
      || (this.wantHeard && micCaptureAllowed());
    if (mic) void this.pulse.enable();
    else this.pulse.disable();
  }

  /** Compile a plugin sky fragment onto the far-field sphere (or restore the shipped program). */
  setPluginShader(opts: { id: string; source: string } | null): string | null {
    return this.backdrop.setPluginShader(opts);
  }

  setPluginUniform(name: string, value: number | [number, number, number]): boolean {
    return this.backdrop.setPluginUniform(name, value);
  }

  skyTime(): number {
    return this.backdrop.skyTime();
  }

  setPluginUboBuffer(buf: Float32Array): void {
    this.backdrop.setPluginUboBuffer(buf);
  }

  /** Headline crawl for the software rain fallback (HN Rain and other stage packs). */
  setVizHeadlines(text: string): void {
    this.vizHeadlineText = text.slice(0, 240);
  }

  /** Photos, SVG, and a custom sky the local agent saved on the model-named profile. */
  setAgentLook(look: AgentLook): void {
    this.agentLook = look;
    this.backdrop.setCustom(look.shader ?? null);
    if (look.shaderPhoto) {
      const href = look.shaderPhoto.startsWith("/") ? look.shaderPhoto : `/api/ai/assets/${look.shaderPhoto}`;
      void loadHtmlImage(new Image(), href).then((img) => {
        const t = new THREE.Texture(img);
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        this.backdrop.setPhoto(t);
      }).catch(() => undefined);
    } else {
      this.backdrop.setPhoto(null);
    }
    const keep = new Set(look.decos.map((d) => d.id));
    for (const d of look.decos) {
      let obj = this.decoObjs.get(d.id);
      if (!obj) {
        const el = document.createElement("div");
        el.className = "overlay agent-deco";
        obj = new LabelItem(el);
        obj.visible = !this.stageOnly;
        obj.pinned = true;
        this.labelLayer.add(obj);
        this.decoObjs.set(d.id, obj);
      }
      const html = decoHtml(d);
      if (obj.element.innerHTML !== html) obj.element.innerHTML = html;
    }
    for (const [id, obj] of this.decoObjs) {
      if (keep.has(id)) continue;
      this.labelLayer.remove(obj);
      this.decoObjs.delete(id);
    }
  }

  private placeDecos(): void {
    for (const d of this.agentLook.decos) {
      const obj = this.decoObjs.get(d.id);
      if (!obj) continue;
      this.decoPoint(d.at, _hot);
      obj.position.copy(_hot);
    }
  }

  private decoPoint(at: DecoAt, out: THREE.Vector3): THREE.Vector3 {
    if (Array.isArray(at)) return out.set(at[0], at[1], at[2]);
    if (at === "origin") return out.set(0, 0, 0);
    if (at === "selected" && this.selected) {
      return out.set(this.selected.x ?? 0, (this.selected.y ?? 0) + 18, this.selected.z ?? 0);
    }
    let n = 0, x = 0, y = 0, z = 0;
    for (const node of this.nodes.values()) {
      if (!node.visible || node.device.role !== "internet") continue;
      x += node.x ?? 0; y += node.y ?? 0; z += node.z ?? 0;
      n++;
    }
    if (!n) return out.set(0, 380, 0);
    return out.set(x / n, y / n + 24, z / n);
  }

  private lastTuneLabels = -1;
  private lastTuneParts = "";
  private lastTuneK = 0;

  private syncTuneDpr(): void {
    const k = this.tune?.dprK ?? 0;
    const want = this.baseDpr + (1 - this.baseDpr) * k;
    if (Math.abs(want - this.lastTuneDpr) < 0.04) return;
    this.lastTuneDpr = want;
    if (this.host) {
      // one canvas for the wall: only the main pane's auto-tune steers its pixel ratio
      if (!this.satellite) this.host.setPixelRatio(want);
      return;
    }
    this.renderer.setPixelRatio(want);
  }

  private applyWeights(): void {
    const a = this.anim;
    const t = this.tune;
    const host = this.satellite ? this.container : document.documentElement;
    host.style.setProperty("--label-scale", String(a.labelWeight));
    host.style.setProperty("--label-fw", String(Math.round(400 + 350 * Math.max(0, Math.min(1, a.labelWeight)))));
    (this.particles.material as THREE.PointsMaterial).size = 3.2 * a.edgeWeight * (t?.partSize ?? a.partSize);
    (this.lines.material as THREE.LineBasicMaterial).opacity = Math.min(1, 0.5 + 0.5 * a.edgeWeight);
    this.syncGlow();
  }

  private syncGlow(): void {
    const a = this.anim;
    const glowAmt = this.tune?.edgeGlowAmt ?? a.edgeGlowAmt;
    this.glowLines.visible = !this.stageOnly && !fabricActive(this.fabricKind()) && a.edgeGlow !== "off" && glowAmt > 0.02;
    const u = this.glowMat.uniforms;
    u.uAmt.value = glowAmt * a.edgeWeight;
    u.uSpeed.value = a.edgeGlowSpeed;
    u.uMode.value = a.edgeGlow === "pulse" ? 1 : 0;
    u.uAdditive.value = this.additiveMarks() ? 1 : 0;
  }

  private audioLive(): boolean {
    const a = this.anim;
    return a.skyAudio || a.bgAudio || a.gridAudio || a.audioCamera || a.audioNodes
      || a.audioPhysics || a.audioParts
      || a.themeCycle === "audio" || a.skyCycle === "audio";
  }

  private physPulse(): number {
    if (!this.anim.audioPhysics) return 1;
    return 1 + 0.85 * this.pulseLevel * this.anim.audioSens;
  }

  private bundleAmt(): number {
    return graphLinksBundle(this.anim.graphLinks) ? 0.72 : 0;
  }

  private bundleHub(): [number, number, number] {
    const id = pickHub(
      [...this.nodes.values()].filter((n) => n.visible).map((n) => ({ id: n.id, role: n.device.role })),
      this.ctx.gateway,
    );
    const n = this.nodes.get(id);
    if (!n) return [0, 0, 0];
    return [n.x ?? 0, n.y ?? 0, n.z ?? 0];
  }

  private stringNow(): { segs: number; sag: number; wave: number; hx: number; hy: number; hz: number; bundle: number } {
    const a = this.anim;
    const pulse = this.physPulse();
    const bundle = this.bundleAmt();
    const hub = bundle > 0.01 ? this.bundleHub() : [0, 0, 0] as [number, number, number];
    return {
      segs: stringSegs(a.stringAmt, bundle),
      sag: a.stringAmt * pulse,
      wave: a.audioPhysics ? this.pulseBass * a.audioSens * a.stringAmt : 0,
      hx: hub[0], hy: hub[1], hz: hub[2], bundle,
    };
  }

  private edgePoint(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    t: number,
    str: { sag: number; wave: number; hx: number; hy: number; hz: number; bundle: number },
  ): [number, number, number] {
    return stringPoint(ax, ay, az, bx, by, bz, t, str.sag, str.wave, str.hx, str.hy, str.hz, str.bundle);
  }

  private gazeWanted(): boolean {
    return this.anim.audioCamera && this.anim.camGaze > 0.01;
  }

  setPluginStyle(s: Record<string, unknown>): void {
    if (typeof s.heat === "number") {
      this.pluginHeat = Math.min(1, Math.max(0, s.heat));
      this.instanceStyleDirty = true;
    }
  }

  setPluginNodeColor(id: string, hex: number): void {
    this.pluginColors.set(id, hex >>> 0);
    this.instanceStyleDirty = true;
  }

  clearPluginStyle(): void {
    this.pluginColors.clear();
    this.pluginHeat = 0;
    this.instanceStyleDirty = true;
  }

  /** Smooth the webcam's main colour and tell the app when the theme should retint. */
  private stepCamTheme(): void {
    if (!this.anim.camTheme) return;
    const raw = liveCam.sampleMain();
    if (!raw) return;
    const c = hexToHsl(raw);
    if (c.s < 0.08) return;
    if (!this.camHueOn) {
      this.camHue = c.h;
      this.camSat = c.s;
      this.camHueOn = true;
    } else {
      let dh = c.h - this.camHue;
      if (dh > 0.5) dh -= 1;
      if (dh < -0.5) dh += 1;
      this.camHue = (this.camHue + dh * 0.14 + 1) % 1;
      this.camSat += (c.s - this.camSat) * 0.14;
    }
    const hex = hslHex(this.camHue, this.camSat, 0.52);
    const now = performance.now();
    if (this.liveCamColor === hex) return;
    if (this.liveCamColor != null && now - this.camThemeAt < 280) return;
    this.liveCamColor = hex;
    this.camThemeAt = now;
    this.onCamTheme(hex);
  }

  private driveEnergy(): number {
    if (this.anim.audioDrive === "node") {
      const n = this.dragging ?? this.selected ?? this.hovered;
      if (n) return Math.min(1, Math.log10(1 + n.rate) / 4);
    }
    return this.trafficEnergy();
  }

  private trafficEnergy(): number {
    const pps = this.lastMsg?.stats.pps ?? 0;
    return Math.min(1, Math.log10(1 + pps) / 2.4);
  }

  /** Multiply the look sky slider by package temp / RAPL on CPU views — never writes uBright. */
  private thermalSkyK(): number {
    if (this.mode.graphBase !== "cpu" && this.mode.graphBase !== "bridge") return 1;
    const t = this.lastMsg?.views?.[this.mode.graphBase]?.thermal ?? this.lastMsg?.views?.cpu?.thermal;
    if (!t) return 1;
    const w = Number(t.rapl_w) || 0;
    const c = Number(t.pkg_c) || 0;
    return Math.min(1.22, 0.88 + 0.22 * Math.min(1, w / 40) + 0.12 * Math.min(1, Math.max(0, c - 50) / 40));
  }

  /** Apply slider opacity/brightness, optionally modulated by the audio / traffic pulse. */
  private applyLook(dt: number): void {
    const a = this.anim;
    const live = this.audioLive();
    const p = live ? this.pulse.tick(this.driveEnergy()) : { level: 0, bass: 0 };
    const sens = Math.max(0, a.audioSens);
    this.pulseLevel = Math.min(1, p.level * sens);
    this.pulseBass = Math.min(1, p.bass * sens);
    const onset = Math.min(1, Math.abs(this.pulseLevel - this.prevPulseLevel) / Math.max(dt, 1 / 90) * 0.28);
    this.prevPulseLevel = this.pulseLevel;
    this.changeVel += (Math.min(1, 0.55 * this.layoutVel + 0.85 * onset) - this.changeVel) * Math.min(1, dt * 5);
    this.gaze.tick(this.gazeWanted() && !this.satellite ? liveCam.lookSample() : null, dt);
    if (!this.satellite) this.stepCamTheme();
    if (a.themeCycle === "audio" || a.skyCycle === "audio") this.stepBeat(dt);
    const skyP = a.skyAudio ? this.pulseLevel : 0;
    const floorP = a.gridAudio ? this.pulseLevel : 0;
    const skyB = a.skyAudio ? this.pulseBass : 0;
    const floorB = a.gridAudio ? this.pulseBass : 0;
    const skyOp = this.tune?.skyOpacity ?? a.skyOpacity;
    const skyBr = (this.tune?.skyBright ?? a.skyBright) * this.thermalSkyK();
    const skySp = this.tune?.skySpeed ?? a.skySpeed;
    this.paintClear();
    this.easeVisibility(dt);
    // Stage-only skies have no graph to protect. Scaling them from the luma probe
    // dims the picture on every sample, then eases back — a flash per drawn frame.
    const visK = this.stageOnly ? 1 : this.visScale;
    const stageSky = this.stageOnly || a.backdrop === "plugin";
    this.backdrop.setLook(
      stageSky ? skyOp : (a.skyAudio ? Math.min(1, skyOp * (0.28 + 0.85 * skyP)) : skyOp),
      (stageSky ? skyBr : (a.skyAudio ? skyBr * (0.4 + 1.5 * skyB) : skyBr)) * visK,
      skyP,
    );
    this.backdrop.setLumaCap(this.visCap);
    this.backdrop.setMotion(skySp, a.skyEase);
    this.paintGrid();
    this.grid.setLook(
      a.gridAudio ? Math.min(1, a.gridOpacity * (0.28 + 0.85 * floorP)) : a.gridOpacity,
      (a.gridAudio ? a.gridBright * (0.4 + 1.5 * floorB) : a.gridBright) * visK,
      floorP,
      a.gridSize,
      a.gridShape,
    );
    this.grid.setLumaCap(this.visCap);
    const i = THREE.MathUtils.clamp(this.anim.camInertia ?? 0.55, 0, 1);
    this.controls.dampingFactor = 0.25 * (1 - i) * (1 - i) + 0.015;
    const drive = this.camDrive();
    const fov = this.baseFov + 5.5 * drive.audio + 3.2 * drive.change;
    const wantFov = (fov - this.camera.fov) * this.camK(dt);
    this.camStep.fov += (wantFov - this.camStep.fov) * this.moveK(dt);
    if (Math.abs(this.camStep.fov) > 0.002 || Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += this.camStep.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Pose lerp for every camera move. 0% is immediate; 100% glides over a few seconds.
   * Pointer drag and wheel zoom skip this (k = 1) so pan / zoom still land where they were released.
   */
  private camK(dt: number): number {
    const i = THREE.MathUtils.clamp(this.anim.camInertia ?? 0.55, 0, 1);
    if (i < 0.01) return 1;
    return 1 - Math.exp(-dt / (0.12 + 3.7 * i * i));
  }

  /** How fast a motion step may change heading. 0% adopts the new delta immediately; 100% must slow through zero. */
  private moveK(dt: number): number {
    const e = THREE.MathUtils.clamp(this.anim.moveEase ?? 0.45, 0, 1);
    if (e < 0.01) return 1;
    return 1 - Math.exp(-dt / (0.06 + 2.2 * e * e));
  }

  private zeroCamStep(): void {
    this.camStep.theta = 0;
    this.camStep.phi = 0;
    this.camStep.radius = 0;
    this.camStep.tx = 0;
    this.camStep.ty = 0;
    this.camStep.tz = 0;
    this.camStep.fov = 0;
  }

  private easeCam(dt: number, wantPos: THREE.Vector3, wantTgt: THREE.Vector3): void {
    const held = this.dreamHeld || !!this.dragging;
    const k = held ? 1 : this.camK(dt);
    const e = held ? 1 : this.moveK(dt);
    if (held) this.zeroCamStep();
    const wtx = (wantTgt.x - this.controls.target.x) * k;
    const wty = (wantTgt.y - this.controls.target.y) * k;
    const wtz = (wantTgt.z - this.controls.target.z) * k;
    this.camStep.tx += (wtx - this.camStep.tx) * e;
    this.camStep.ty += (wty - this.camStep.ty) * e;
    this.camStep.tz += (wtz - this.camStep.tz) * e;
    this.controls.target.x += this.camStep.tx;
    this.controls.target.y += this.camStep.ty;
    this.controls.target.z += this.camStep.tz;
    _sph.setFromVector3(_off.copy(this.camera.position).sub(this.controls.target));
    _sphWant.setFromVector3(_off.copy(wantPos).sub(wantTgt));
    let dTheta = _sphWant.theta - _sph.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    else if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const wTheta = dTheta * k;
    const wPhi = (_sphWant.phi - _sph.phi) * k;
    const wR = (_sphWant.radius - _sph.radius) * k;
    this.camStep.theta += (wTheta - this.camStep.theta) * e;
    this.camStep.phi += (wPhi - this.camStep.phi) * e;
    this.camStep.radius += (wR - this.camStep.radius) * e;
    _sph.theta += this.camStep.theta;
    _sph.phi += this.camStep.phi;
    _sph.radius += this.camStep.radius;
    _sph.makeSafe();
    this.camera.position.copy(this.controls.target).add(_off.setFromSpherical(_sph));
  }

  /** Chase magnets / gravity / swirl / strings so AI jumps do not teleport the cloud. */
  private easePhys(dt: number): void {
    if (!this.physWant) return;
    const segs = stringSegs(this.anim.stringAmt, this.bundleAmt());
    const moving = easePhysToward(this.anim, this.physWant, dt);
    if (!moving) return;
    if (stringSegs(this.anim.stringAmt, this.bundleAmt()) !== segs) this.rebuildLineBuffers();
    this.bumpAlpha(0.08);
  }

  /** Ask the layout to warm up to at least `min` on its next tick (structure changes, drags, slider moves). */
  private bumpAlpha(min: number): void {
    if (min > this.pendingAlpha) this.pendingAlpha = min;
  }

  /**
   * Per-frame layout knobs. Sent only when something changed. Velocity decay follows the motion-ease
   * slider (the camera look pass has always been the last writer of that value); magnets carry the audio
   * pulse themselves and the magnet / gravity / swirl forces scale by it again, as before.
   */
  private pushLayoutParams(dt: number): void {
    const a = this.anim;
    const p = this.physPulse();
    const ease = THREE.MathUtils.clamp(a.moveEase ?? 0.45, 0, 1);
    const byRole: Record<string, number> = {
      self: a.magnetSelf, gateway: a.magnetGateway, local: a.magnetLocal, lan: a.magnetLan,
      multicast: a.magnetMulticast, internet: a.magnetInternet,
    };
    const params: LayoutParams = {
      spring: a.spring, chargeAmt: a.chargeAmt, linkSpan: a.linkSpan,
      drag: 0.35 - 0.22 * ease, centerPull: a.centerPull,
      magnets: ROLES.map((r) => (byRole[r] ?? 0) * p),
      magnetCross: a.magnetCross, magnetRange: a.magnetRange, gravity: a.gravity, swirl: a.swirl, pulse: p,
      spreadX: this.spreadX, spreadZ: this.spreadZ,
      flatten: resolveGraphFlatten(this.mode.flatten, this.anim.graphSpace, this.anim.graphLayout),
      moveK: Math.round(this.moveK(dt) * 1000) / 1000,
    };
    const last = this.lastLayoutParams;
    if (last && sameLayoutParams(last, params)) return;
    this.lastLayoutParams = params;
    this.layout.setParams(params);
  }

  /**
   * One layout tick per frame. The active mode's `force` runs here against the positions the worker
   * reported last frame; whatever it adds to `vx/vy/vz` is forwarded as a nudge and cleared.
   */
  private stepLayout(dt: number): void {
    this.pushLayoutParams(dt);
    if (this.layout.busy) return; // the previous tick has not answered; positions hold, requests wait
    const sim = this.simNodes;
    let nudge: Float32Array | null = null;
    const pinned = graphLayoutPlaces(this.anim.graphLayout);
    const skipMode = pinned || graphLayoutIsForce(this.anim.graphLayout);
    if (this.mode.force && sim.length && !skipMode) {
      for (const n of sim) { n.vx = 0; n.vy = 0; n.vz = 0; }
      this.mode.force(sim, this.layoutAlpha, this.ctx);
      if (this.nudgeBuf.length < sim.length * 3) this.nudgeBuf = new Float32Array(sim.length * 3);
      const b = this.nudgeBuf;
      let any = false;
      for (let i = 0; i < sim.length; i++) {
        const n = sim[i]!;
        const vx = n.vx ?? 0, vy = n.vy ?? 0, vz = n.vz ?? 0;
        b[i * 3] = vx; b[i * 3 + 1] = vy; b[i * 3 + 2] = vz;
        if (vx !== 0 || vy !== 0 || vz !== 0) any = true;
      }
      if (any) nudge = b;
    } else if (pinned && sim.length) {
      for (const n of sim) { n.vx = 0; n.vy = 0; n.vz = 0; }
      const targets = this.pinnedLayoutTargets(sim);
      if (targets.size) pullTowardLayout(sim, targets, this.layoutAlpha, 0.24);
      if (this.nudgeBuf.length < sim.length * 3) this.nudgeBuf = new Float32Array(sim.length * 3);
      const b = this.nudgeBuf;
      let any = false;
      for (let i = 0; i < sim.length; i++) {
        const n = sim[i]!;
        const vx = n.vx ?? 0, vy = n.vy ?? 0, vz = n.vz ?? 0;
        b[i * 3] = vx; b[i * 3 + 1] = vy; b[i * 3 + 2] = vz;
        if (vx !== 0 || vy !== 0 || vz !== 0) any = true;
      }
      if (any) nudge = b;
    }
    const sent = this.layout.frame({
      type: "frame", gen: this.simGen, alphaMin: this.pendingAlpha, nudge,
      pin: this.pendingPin, release: this.pendingRelease, recycle: this.posRecycle,
    });
    this.posRecycle = null;
    if (sent) {
      this.pendingAlpha = 0;
      this.pendingPin = null;
      this.pendingRelease = null;
    }
  }

  private pinnedLayoutTargets(sim: GNode[]): Map<string, LayoutXyz> {
    const kind = this.anim.graphLayout;
    if (!graphLayoutPlaces(kind)) {
      this.layoutTargets.clear();
      this.layoutSig = "";
      return this.layoutTargets;
    }
    const flatten = resolveGraphFlatten(this.mode.flatten, this.anim.graphSpace, kind);
    const live = kind === "bars" || kind === "scatter" || kind === "vortex" || kind === "hourglass" || kind === "cascade"
      || kind === "heap" || kind === "spectrum" || kind === "waterfall" || kind === "julia"
      || kind === "carrier" || kind === "phased" || kind === "matrix" || kind === "queue"
      || kind === "hilbert" || kind === "hashmap";
    const animates = graphLayoutAnimates(kind);
    const wall = performance.now() / 1000;
    const pulse = this.physPulse();
    const ids = sim.map((n) => n.id).join(",");
    const pairs: LayoutLink[] = [];
    for (const l of this.links.values()) {
      if (!l.visible || l.id.startsWith("~")) continue;
      pairs.push({ a: l.source.id, b: l.target.id });
    }
    const rates = live ? sim.map((n) => Math.round(Math.log10(1 + n.rate) * 4)).join(",") : "";
    const seen = kind === "queue" ? sim.map((n) => Math.round(n.device.last_seen)).join(",") : "";
    const spec = this.pulse.spectrum(32);
    const frames = this.pulse.waterfall();
    const tq = animates ? (Math.round(wall * 8) / 8).toFixed(3) : "";
    const pq = animates ? (Math.round(pulse * 10) / 10).toFixed(1) : "";
    const bq = (kind === "spectrum" || kind === "waterfall" || kind === "phased")
      ? spec.slice(0, 8).map((v) => Math.round(v * 20)).join(",")
      : "";
    const sig = `${kind}|${flatten}|${this.spreadX.toFixed(2)}|${this.ctx.gateway}|${ids}|${pairs.map((p) => `${p.a}>${p.b}`).join(";")}|${rates}|${seen}|${tq}|${pq}|${bq}`;
    if (sig === this.layoutSig && this.layoutTargets.size) return this.layoutTargets;
    const nodes: LayoutNode[] = sim.map((n) => ({
      id: n.id,
      role: n.device.role,
      rate: n.rate,
      bytesIn: n.device.bytes_in,
      bytesOut: n.device.bytes_out,
      ip: n.device.ip,
      chan: n.device.chan,
      lastSeen: n.device.last_seen,
    }));
    this.layoutTargets = layoutGraph(kind, nodes, pairs, {
      spreadX: this.spreadX,
      flatten,
      hub: this.ctx.gateway,
      time: wall,
      pulse,
      bins: spec,
      frames,
    });
    this.layoutSig = sig;
    return this.layoutTargets;
  }

  /** Positions from the layout. The node being dragged follows the pointer directly and is skipped. */
  private onLayoutPositions(m: PositionsMsg): void {
    this.layoutAlpha = m.alpha;
    if (m.gen === this.simGen) {
      const sim = this.simNodes, pos = m.pos;
      const n = Math.min(m.n, sim.length, pos.length / 3);
      for (let i = 0; i < n; i++) {
        const nd = sim[i]!;
        if (nd === this.dragging) continue;
        nd.x = pos[i * 3]!;
        nd.y = pos[i * 3 + 1]!;
        nd.z = pos[i * 3 + 2]!;
      }
    }
    this.posRecycle = m.pos;
  }

  /**
   * How hard each camera mix is pushing this frame. All zero when the camera chip is off, so orbit
   * sliders run as written. `audio` is bass × camAudio (orbit / FOV); `level` is the broadband pulse
   * for zoom and nod; `change` is detected velocity × camChange; `gaze` is webcam confidence × camGaze.
   */
  private camDrive(): { audio: number; level: number; change: number; gaze: number; gx: number; gy: number } {
    if (!this.anim.audioCamera) return { audio: 0, level: 0, change: 0, gaze: 0, gx: 0, gy: 0 };
    const k = Math.max(0, this.anim.camAudio);
    return {
      audio: k * this.pulseBass,
      level: k * this.pulseLevel,
      change: Math.max(0, this.anim.camChange) * this.changeVel,
      gaze: Math.max(0, this.anim.camGaze) * this.gaze.conf,
      gx: this.gaze.x,
      gy: this.gaze.y,
    };
  }

  /** Scene fill: theme bg (or a custom override), optionally throbbing toward the rim on the audio pulse. */
  private sceneFill(fadeK: number): number {
    if (this.anim.bgColor) {
      _edgeTmp.set(this.anim.bgColor);
      return _edgeTmp.getHex();
    }
    return this.mixHex(this.fadeFrom.clear, this.theme.scene.clear, fadeK);
  }

  private paintClear(): void {
    const a = this.anim;
    const s = this.theme.scene;
    const fadeK = this.fadeT * this.fadeT * (3 - 2 * this.fadeT);
    const fill = this.sceneFill(fadeK);
    const baseClear = fadeTowardPole(fill, a.bgOpacity, this.theme.dark);
    const baseFog = fadeTowardPole(
      this.anim.bgColor ? fill : this.mixHex(this.fadeFrom.fog, s.fog, fadeK),
      a.bgOpacity,
      this.theme.dark,
    );
    const rim = this.mixHex(this.fadeFrom.rim, s.rim, fadeK);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    const op = Math.min(1, Math.max(0, a.bgOpacity));
    let painted = baseClear;
    if (a.bgAudio) {
      const k = Math.min(1, this.pulseBass);
      painted = this.mixHex(baseClear, s.rim, (0.08 + 0.52 * k) * op);
      this.clearHex = painted;
      if (fog) fog.color.setHex(this.mixHex(baseFog, s.rim, (0.06 + 0.42 * k) * op));
      this.backdrop.setColors(rim, painted);
    } else {
      this.clearHex = baseClear;
      if (fog) fog.color.setHex(baseFog);
      this.backdrop.setColors(rim, baseClear);
    }
    this.syncSceneChrome(painted);
  }

  private lastSceneBg = "";
  private labelDarkText: boolean | undefined;
  /** grey standing in for the sky-adjusted scene, for label highlight contrast */
  private inkBgHex = 0x0b0e14;
  private labelFgHex = 0xf4f6fb;
  /** Last sampled WebGL luma behind labels; -1 until the first read. */
  private sampledLuma = -1;
  private readonly lumaProbe = new LumaProbe(16, 150);
  private readonly changeProbe = new PaneChangeProbe();
  private readonly canvasProbe = new CanvasChangeProbe();
  private lastVis: VisibilityReport | null = null;
  private visCap = SKY_LUMA_CAP;
  private visScale = 1;
  private lastVisAdditive: boolean | undefined;
  /** Keep #wall / #scene CSS in lockstep with the WebGL clear; header chrome stays on --bg. */
  private syncSceneChrome(hex: number): void {
    const host = this.satellite ? this.container : document.documentElement;
    const css = toCssHex(hex);
    if (css !== this.lastSceneBg) {
      this.lastSceneBg = css;
      host.style.setProperty("--scene-bg", css);
    }
    const a = this.anim;
    const pal = a.backdrop === "dynamic" ? this.backdrop.skyPalette() : undefined;
    _sph.setFromVector3(_off.copy(this.camera.position).sub(this.controls.target));
    const down = THREE.MathUtils.clamp((Math.PI / 2 - _sph.phi) / (Math.PI * 0.35), 0, 1);
    const floorHex = a.gridColor && /^#[0-9a-fA-F]{6}$/.test(a.gridColor)
      ? parseInt(a.gridColor.slice(1), 16)
      : this.theme.scene.gridMajor;
    const floorOp = a.gridAudio ? Math.min(1, a.gridOpacity * (0.28 + 0.85 * this.pulseLevel)) : a.gridOpacity;
    const floorBr = a.gridAudio ? a.gridBright * (0.4 + 1.5 * this.pulseBass) : a.gridBright;
    const sky = {
      kind: a.backdrop, opacity: a.skyOpacity, bright: a.skyBright,
      recipeA: pal?.a, recipeB: pal?.b,
      liveLuma: a.backdrop === "live" && !this.satellite ? liveCam.sampleLuma() : undefined,
      floor: { hex: floorHex, opacity: floorOp, bright: floorBr, down },
    };
    const displayed = effectiveSceneLuminance(hex, { ...sky, cap: this.visCap });
    const uncapped = effectiveSceneLuminance(hex, { ...sky, cap: false });
    // Ink follows the pixels (or the cap we are actually drawing). Do not max with the
    // uncapped webcam estimate — that picks black letters on a dimmed navy field.
    const inkLum = this.sampledLuma >= 0 ? this.sampledLuma : displayed;
    let visLuma = uncapped;
    if (this.sampledLuma >= 0 && this.visCap >= SKY_LUMA_CAP - 0.02) {
      visLuma = Math.max(visLuma, this.sampledLuma);
    }
    const inkBg = grayHex(inkLum);
    const ink = sceneInk(inkBg, this.labelDarkText);
    this.labelDarkText = ink.darkText;
    this.inkBgHex = inkBg;
    this.labelFgHex = ink.fgHex;
    this.lastVis = assessVisibility({
      backdropLuma: visLuma,
      additive: this.theme.scene.additive,
      darkTheme: this.theme.dark,
      labelFgHex: ink.fgHex,
      labelMutedHex: parseInt(ink.muted.slice(1), 16),
      nodeHexes: [this.theme.scene.lanEdge, this.theme.scene.wanEdge],
      edgeHex: this.theme.scene.lanEdge,
    });
    // Compare the live CSS, not a private cache — applyThemeChrome also writes these vars from
    // the fill alone, and skipping the write would leave light ink on a bright sky.
    if (
      host.style.getPropertyValue("--label-fg") === ink.fg
      && host.style.getPropertyValue("--label-muted") === ink.muted
      && host.style.getPropertyValue("--label-stroke") === ink.stroke
    ) return;
    host.style.setProperty("--label-fg", ink.fg);
    host.style.setProperty("--label-muted", ink.muted);
    host.style.setProperty("--label-shadow", ink.shadow);
    host.style.setProperty("--label-stroke", ink.stroke);
  }

  /**
   * Sample the framebuffer behind labels so ink tracks the real floor/sky, not just the estimate.
   * Asynchronous: the probe is fenced and harvested a frame or two later, never stalling the GPU.
   */
  private captureBackdropLuma(): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext | null;
    if (!gl || typeof gl.fenceSync !== "function") return;
    if (this.host) {
      const vp = this.lastVp;
      if (!vp) return;
      this.lumaProbe.tick(gl, vp.x + vp.w / 2, vp.y + vp.h / 2);
    } else {
      this.lumaProbe.tick(gl, gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2);
    }
    this.sampledLuma = this.lumaProbe.value;
  }

  /** Ease sky/floor dimming and blending toward the visibility tool's fix. Overlay only. */
  private easeVisibility(dt: number): void {
    const want = this.lastVis?.fix;
    const cap = want?.lumaCap ?? SKY_LUMA_CAP;
    const scale = want?.lumaScale ?? 1;
    const k = 1 - Math.exp(-dt / 0.35);
    // Snap down so a blown-out live sky does not linger; ease back up when it recovers.
    if (cap < this.visCap) this.visCap = cap;
    else this.visCap += (cap - this.visCap) * k;
    if (scale < this.visScale) this.visScale = scale;
    else this.visScale += (scale - this.visScale) * k;
    const add = want?.additive ?? this.theme.scene.additive;
    if (add !== this.lastVisAdditive) {
      this.lastVisAdditive = add;
      this.applyBlending();
    }
  }

  private stepBeat(dt: number): void {
    this.beatCool = Math.max(0, this.beatCool - dt);
    this.bassSlow += (this.pulseBass - this.bassSlow) * 0.08;
    if (this.beatCool <= 0 && this.pulseBass > 0.28 && this.pulseBass > this.bassSlow * 1.38) {
      this.beatCool = 1.6;
      this.onThemePulse();
    }
  }

  private paintGrid(): void {
    const a = this.anim;
    if (a.gridColor) {
      _edgeTmp.set(a.gridColor);
      this.grid.setColors(_edgeTmp.getHex(), _fadeB.copy(_edgeTmp).multiplyScalar(0.55).getHex());
      return;
    }
    const s = this.theme.scene;
    const k = this.fadeT * this.fadeT * (3 - 2 * this.fadeT);
    this.grid.setColors(
      this.mixHex(this.fadeFrom.gridMajor, s.gridMajor, k),
      this.mixHex(this.fadeFrom.gridMinor, s.gridMinor, k),
    );
  }

  private captureDreamRest(): void {
    _sph.setFromVector3(_off.copy(this.camera.position).sub(this.controls.target));
    const t = this.controls.target;
    this.dreamRest = { radius: _sph.radius, phi: _sph.phi, theta: _sph.theta, tx: t.x, ty: t.y, tz: t.z };
    this.dreamYaw = 0;
    this.dreamPitch = 0;
    this.dreamZoom = 0;
    this.zeroCamStep();
  }

  /** Orbit, ctrl+two-finger / right-drag pan, two-finger / wheel zoom keep this pose instead of refitting. */
  private pinUserCamera(): void {
    this.lastInteraction = performance.now();
    this.controls.autoRotate = false;
    this.cameraGoalDir = null;
    this.lookPinned = true;
    this.camCoastUntil = this.lastInteraction + 450;
    this.captureDreamRest();
  }

  /** True while the pointer, a wheel burst, or OrbitControls damping still owns the camera. */
  private userOwnsCamera(): boolean {
    return this.dreamHeld || !!this.dragging || performance.now() < this.camCoastUntil;
  }

  private followUserCameraCoast(): void {
    if (this.lookPinned && performance.now() < this.camCoastUntil) this.captureDreamRest();
  }

  /**
   * Build an axis-aligned box around the current focus set. Activity / motion weigh moving and busy
   * nodes; cloud uses every visible node. Never a bounding sphere — X and Y fit the viewport separately.
   */
  private sampleFocus(dt: number): void {
    const mode = this.anim.focus;
    const invDt = 1 / Math.max(dt, 1 / 120);
    let sx = 0, sy = 0, sz = 0, sw = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let hits = 0;
    let motion = 0, mw = 0;
    for (const n of this.nodes.values()) {
      if (!n.visible || n.scale < 0.4) continue;
      const x = n.x ?? 0, y = n.y ?? 0, z = n.z ?? 0;
      const speed = Math.hypot(x - n.px, y - n.py, z - n.pz) * invDt;
      n.px = x; n.py = y; n.pz = z;
      const heat = Math.log10(1 + n.rate);
      let w = 0;
      if (mode === "cloud") w = 1;
      else if (mode === "motion") w = speed > 10 ? Math.min(2.5, speed / 35) : 0;
      else if (mode === "selection") {
        const focus = this.selected ?? this.hovered;
        if (!focus) w = (heat > Math.log10(1 + DREAM_HOT_MIN_RATE) ? heat : 0) + (speed > 8 ? Math.min(2, speed / 40) : 0);
        else if (n === focus) w = 4;
        else {
          let nbr = false;
          for (const l of this.links.values()) {
            if (!l.visible || l.id.startsWith("~")) continue;
            if ((l.source === focus && l.target === n) || (l.target === focus && l.source === n)) { nbr = true; break; }
          }
          w = nbr ? 1.6 : 0;
        }
      }
      else w = (heat > Math.log10(1 + DREAM_HOT_MIN_RATE) ? heat : 0) + (speed > 8 ? Math.min(2, speed / 40) : 0);
      if (w <= 0) continue;
      if (speed > 8) { motion += Math.min(2, speed / 40); mw++; }
      sx += x * w; sy += y * w; sz += z * w; sw += w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      hits++;
    }
    if (hits < 1) {
      for (const n of this.nodes.values()) {
        if (!n.visible || n.scale < 0.4) continue;
        const x = n.x ?? 0, y = n.y ?? 0, z = n.z ?? 0;
        sx += x; sy += y; sz += z; sw += 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        hits++;
      }
    }
    if (hits < 1 || sw <= 0) {
      this.layoutVel += (0 - this.layoutVel) * Math.min(1, dt * 4);
      return;
    }
    const cx = sx / sw, cy = sy / sw, cz = sz / sw;
    const hx = Math.max(90, (maxX - minX) * 0.5 + 40);
    const hy = Math.max(70, (maxY - minY) * 0.5 + 40);
    const hz = Math.max(90, (maxZ - minZ) * 0.5 + 40);
    const k = this.focus.n ? 1 - Math.exp(-dt / 0.08) : 1;
    this.focus.x += (cx - this.focus.x) * k;
    this.focus.y += (cy - this.focus.y) * k;
    this.focus.z += (cz - this.focus.z) * k;
    this.focus.hx += (hx - this.focus.hx) * k;
    this.focus.hy += (hy - this.focus.hy) * k;
    this.focus.hz += (hz - this.focus.hz) * k;
    this.focus.n = hits;
    this.layoutVel += ((mw ? Math.min(1, motion / mw) : 0) - this.layoutVel) * Math.min(1, dt * 4);
  }

  /** Distance that fits the focus box in the current frustum — width and height independently, not a sphere. */
  private fitDistance(): number {
    const aspect = Number.isFinite(this.camera.aspect) && this.camera.aspect > 0 ? this.camera.aspect : 1;
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.35, aspect));
    const dist = Math.max(this.focus.hx / Math.tan(hHalf), this.focus.hy / Math.tan(vHalf)) + this.focus.hz * 0.4;
    return THREE.MathUtils.clamp(dist * 1.08, 220, 7000);
  }

  /** Auto-fit when the user has not framed the view. User pan / zoom keep their pose. */
  private frameCamera(dt: number): void {
    if (!this.focus.n) return;
    const fitR = this.fitDistance();
    const held = this.userOwnsCamera();
    const pinned = this.lookPinned && !this.cameraGoalDir;
    const recently = performance.now() - this.lastInteraction < 6000;
    const bx = this.focus.x, by = this.focus.y, bz = this.focus.z;

    if (!held && !pinned) {
      const restK = Math.min(1, dt * 1.5);
      this.dreamRest.tx += (bx - this.dreamRest.tx) * restK;
      this.dreamRest.ty += (by - this.dreamRest.ty) * restK;
      this.dreamRest.tz += (bz - this.dreamRest.tz) * restK;
      this.dreamRest.radius += (fitR - this.dreamRest.radius) * restK;
    }

    if (this.cameraGoalDir) {
      _bulkGoal.copy(this.cameraGoalDir).multiplyScalar(fitR);
      _restT.set(bx, by, bz);
      _camWant.copy(_restT).add(_bulkGoal);
      this.easeCam(dt, _camWant, _restT);
      const i = THREE.MathUtils.clamp(this.anim.camInertia ?? 0.55, 0, 1);
      if (this.camera.position.distanceTo(_camWant) < 8 + 120 * i * i) {
        this.cameraGoalDir = null;
        this.lookPinned = true;
        this.captureDreamRest();
      }
      return;
    }

    if (held || this.dreaming || pinned) return;

    _sph.setFromVector3(_off.copy(this.camera.position).sub(this.controls.target));
    const minR = fitR * 0.62;
    let nextR = _sph.radius;
    if (nextR < minR) nextR = minR;
    else if (!recently) nextR += (fitR - nextR);
    _sph.radius = THREE.MathUtils.clamp(nextR, 80, 8000);
    _restT.set(bx, by, bz);
    _camWant.copy(_restT).add(_off.setFromSpherical(_sph));
    this.easeCam(dt, _camWant, _restT);
  }

  /** Ease the dream look-at toward the current focus box (activity / motion / whole graph). */
  private updateDreamFocus(dt: number): void {
    const k = 1 - Math.exp(-dt / DREAM_FOCUS_TAU);
    _hot.set(this.focus.x, this.focus.y, this.focus.z);
    this.dreamFocus.lerp(_hot, k);
    const want = this.anim.focus === "cloud" ? 0.35 : this.focus.n > 0 ? 1 : 0;
    this.dreamFocusW += (want - this.dreamFocusW) * k;
  }

  private stepDream(dt: number): void {
    const a = this.anim;
    const d = this.camDrive();
    const yawRadS = (Math.PI * 2) / Math.max(30, a.yawPeriod);
    const pitchRadS = (Math.PI * 2) / Math.max(4, a.pitchPeriod);
    const zoomOmega = (Math.PI * 2) / Math.max(8, a.zoomPeriod);
    const cam = 1 + 0.85 * d.audio + 1.1 * d.change;
    this.dreamYaw += dt * yawRadS * cam + dt * d.gaze * d.gx * 0.7;
    this.dreamPitch += dt * pitchRadS * cam;
    this.dreamZoom += dt * zoomOmega * (1 + 0.65 * d.change);
    this.updateDreamFocus(dt);

    const rest = this.dreamRest;
    const lo = this.controls.minPolarAngle + 0.05;
    const hi = this.controls.maxPolarAngle - 0.05;
    let amp = (a.pitchDeg * Math.PI) / 180;
    if (rest.phi - amp < lo) amp = rest.phi - lo;
    if (rest.phi + amp > hi) amp = Math.min(amp, hi - rest.phi);
    amp = Math.max(0, amp) * (1 + 0.5 * d.level + 0.45 * d.change);

    const pulse = a.zoom > 0 ? 0.5 * (1 - Math.cos(this.dreamZoom)) : 0;
    const zoomPulse = pulse * (1 + 0.7 * d.level + 0.55 * d.change);
    const phase = this.dreamZoom / (Math.PI * 2);
    const hold = activityLookMix({
      focus: a.focus, pinned: this.lookPinned, focusW: this.dreamFocusW, phase,
    });
    if (!this.lookPinned && a.focus !== "cloud" && this.focus.n) {
      const crawl = (1 - Math.exp(-dt / DREAM_FOCUS_TAU)) * 0.35;
      rest.tx += (this.focus.x - rest.tx) * crawl;
      rest.ty += (this.focus.y - rest.ty) * crawl;
      rest.tz += (this.focus.z - rest.tz) * crawl;
    }
    const maxOff = Math.min(this.focus.hx, this.focus.hz) * 0.22;
    const gx = this.lookPinned ? 0 : d.gaze * d.gx, gy = this.lookPinned ? 0 : d.gaze * d.gy;
    const wander = 1 - hold;
    _hot.set(this.focus.x, this.focus.y, this.focus.z);
    _restT.set(rest.tx, rest.ty, rest.tz);
    _restT.lerp(_hot, hold);
    if (!this.lookPinned && a.focus !== "cloud" && this.focus.n) {
      _bulkGoal.copy(_hot).project(this.camera);
      const extra = (_bulkGoal.z < 0 || _bulkGoal.z > 1)
        ? 1
        : centerMixForNdc(_bulkGoal.x, _bulkGoal.y);
      if (extra > 0) _restT.lerp(_hot, extra);
    }
    _restT.x += THREE.MathUtils.clamp(gx * maxOff * 1.5 * wander, -maxOff * 1.6, maxOff * 1.6);
    _restT.y += THREE.MathUtils.clamp(gy * maxOff * 1.2 * wander, -maxOff * 1.6, maxOff * 1.6);

    const zoomW = a.follow ? this.dreamFocusW : 1;
    const radius = rest.radius * (1 - a.zoom * zoomPulse * zoomW);
    _sph.radius = THREE.MathUtils.clamp(radius, 80, 8000);
    _sph.theta = rest.theta + this.dreamYaw;
    _sph.phi = THREE.MathUtils.clamp(rest.phi + Math.sin(this.dreamPitch) * amp - gy * 0.2, lo, hi);
    _camWant.copy(_restT).add(_off.setFromSpherical(_sph));
    this.easeCam(dt, _camWant, _restT);
  }

  /** Recolour the scene for a theme. `fade` lerps fog, clear, rim, floor, and node palettes over THEME_FADE_S. */
  setTheme(t: Theme, fade = false): void {
    const cur = this.theme.scene;
    this.fadeFrom = {
      clear: this.fadeT < 1 ? this.mixHex(this.fadeFrom.clear, cur.clear, this.fadeT) : cur.clear,
      fog: this.fadeT < 1 ? this.mixHex(this.fadeFrom.fog, cur.fog, this.fadeT) : cur.fog,
      rim: this.fadeT < 1 ? this.mixHex(this.fadeFrom.rim, cur.rim, this.fadeT) : cur.rim,
      gridMajor: this.fadeT < 1 ? this.mixHex(this.fadeFrom.gridMajor, cur.gridMajor, this.fadeT) : cur.gridMajor,
      gridMinor: this.fadeT < 1 ? this.mixHex(this.fadeFrom.gridMinor, cur.gridMinor, this.fadeT) : cur.gridMinor,
    };
    if (fade) {
      for (const n of this.nodes.values()) n.colorFrom.copy(n.color);
    }
    this.theme = t;
    this.fadeT = fade ? 0 : 1;
    this.applyBlending();
    this.refresh();
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = this.fogDensity();
    if (!fade) this.applyThemeColors(1);
  }

  private mixHex(a: number, b: number, t: number): number {
    _edgeTmp.setHex(a).lerp(_fadeB.setHex(b), t);
    return _edgeTmp.getHex();
  }

  private applyThemeColors(t: number): void {
    const k = t * t * (3 - 2 * t);
    this.rim.color.setHex(this.mixHex(this.fadeFrom.rim, this.theme.scene.rim, k));
    this.paintClear();
    for (const n of this.nodes.values()) {
      if (t >= 1) n.color.copy(n.colorWant);
      else n.color.lerpColors(n.colorFrom, n.colorWant, k);
    }
    this.instanceStyleDirty = true;
  }

  get currentTheme(): Theme { return this.theme; }
  /** Eased sky/floor luma cap from the contrast+visibility tool. */
  get visibilityCap(): number { return this.visCap; }
  /** Last contrast / element-visibility report, or null before the first chrome sync. */
  visibilityReport(): VisibilityReport | null { return this.lastVis; }

  /** Additive edges/glow when the visibility tool has not forced normal blending. */
  private additiveMarks(): boolean {
    return this.lastVis?.fix.additive ?? this.theme.scene.additive;
  }

  private applyBlending(): void {
    const b = this.additiveMarks() ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of [this.lines.material as THREE.Material, this.particles.material as THREE.Material, this.glowMat]) {
      m.blending = b;
      m.needsUpdate = true;
    }
    this.syncGlow();
  }

  /** Edge colour at a given brightness: scaled toward black for additive themes, toward the background otherwise. */
  private edgeColor(out: THREE.Color, hex: number, bright: number): THREE.Color {
    if (this.additiveMarks()) return out.setHex(hex).multiplyScalar(bright);
    // light backgrounds need more contrast than the additive brightness curve gives
    return out.setHex(this.theme.scene.clear).lerp(_edgeTmp.setHex(hex), bright <= 0 ? 0 : Math.min(1, 0.45 + bright * 1.2));
  }

  /** Re-render everything derived from the last snapshot (e.g. after toggling redaction). */
  refresh(): void {
    if (this.lastMsg) this.update(this.lastMsg);
  }

  select(n: GNode | null): void {
    this.selected = n;
    this.onSelect(n ? n.device : null);
    this.applyVisibility();
  }

  /** Translate an address the server reported to the node that represents it (merged nodes), else itself. */
  resolve(ip: string): string { return this.aliasMap.get(ip) ?? ip; }
  setAliasMap(m: Map<string, string>): void { this.aliasMap = m; }

  selectIp(ip: string): void {
    const n = this.nodes.get(this.resolve(ip));
    if (n) this.select(n);
  }

  private beginDrag(n: GNode): void {
    this.dragging = n;
    this.select(n);
    this.controls.enabled = false;
    this.dreamHeld = true;
    n.fx = n.x ?? 0;
    n.fy = n.y ?? 0;
    n.fz = n.z ?? 0;
    this.dragPlane.setFromNormalAndCoplanarPoint(
      _off.copy(this.camera.position).sub(_pos.set(n.fx, n.fy, n.fz)).normalize(),
      _pos.set(n.fx, n.fy, n.fz),
    );
    this.inputEl.style.cursor = "grabbing";
    this.dragVel.set(0, 0, 0);
    this.pinDrag(n);
    this.bumpAlpha(0.2);
  }

  private moveDrag(): void {
    const n = this.dragging;
    if (!n) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragHit)) return;
    this.dragVel.set(this.dragHit.x - (n.x ?? 0), this.dragHit.y - (n.y ?? 0), this.dragHit.z - (n.z ?? 0));
    n.x = n.fx = this.dragHit.x;
    n.y = n.fy = this.dragHit.y;
    n.z = n.fz = this.dragHit.z;
    this.pinDrag(n);
  }

  /** Tell the layout where the dragged node is held this frame. */
  private pinDrag(n: GNode): void {
    const i = this.simNodes.indexOf(n);
    if (i < 0) return;
    const p = this.pendingPin ?? (this.pendingPin = new Float32Array(4));
    p[0] = i; p[1] = n.fx ?? n.x ?? 0; p[2] = n.fy ?? n.y ?? 0; p[3] = n.fz ?? n.z ?? 0;
  }

  private endDrag(): void {
    const n = this.dragging;
    this.dragging = null;
    this.controls.enabled = true;
    this.dreamHeld = false;
    if (this.dreaming) this.captureDreamRest();
    this.inputEl.style.cursor = "";
    if (!n) return;
    let vx = this.dragVel.x * 10, vy = this.dragVel.y * 10, vz = this.dragVel.z * 10;
    if (this.anim.audioNodes) {
      this.camera.getWorldDirection(_off);
      _off.cross(this.camera.up).normalize();
      const k = 40 + 90 * this.pulseBass;
      vx += _off.x * k;
      vy += _off.y * k * 0.25;
      vz += _off.z * k;
    }
    n.fx = n.fy = n.fz = undefined;
    const i = this.simNodes.indexOf(n);
    // a pin still queued for this node lands first (final pointer position), then the release flings it
    if (i >= 0) this.pendingRelease = Float32Array.of(i, vx, vy, vz);
    this.bumpAlpha(0.15);
  }

  // ------------------------------------------------------------------ data

  update(msg: StateMsg): void {
    this.now = msg.ts;
    this.lastMsg = msg;
    const slice = rfSlice(msg, this.mode, this.modeOpts);
    const view: StateMsg = { ...msg, devices: slice.devices, flows: slice.flows, gateway: slice.gateway || msg.gateway, local_ip: slice.localIp || msg.local_ip };
    let added = false;      // structural change: links appeared/disappeared
    let newNodes = 0;       // only new nodes justify warming the layout up
    const cpuView = this.mode.graphBase === "cpu";
    const wall = performance.now() / 1000;
    const seen = new Set<string>();
    for (const d of view.devices) {
      seen.add(d.ip);
      let n = this.nodes.get(d.ip);
      if (!n) { n = this.addNode(d, view); added = true; newNodes++; }
      n.device = d;
      n.cpuGhost = false;
      if (cpuView && isCpuCoreId(d.ip) && (d.cpu ?? 0) < CPU_IDLE_PCT) {
        n.cpuIdleAt ??= wall;
      } else {
        n.cpuIdleAt = undefined;
      }
    }
    // devices that vanished from the snapshot (state reset) are removed — except CPU nodes, which
    // stay on the graph and fade out for a few seconds after they go unused.
    for (const [ip, n] of this.nodes) {
      if (seen.has(ip)) continue;
      if (cpuView && isCpuGraphId(ip)) {
        if (!this.filters.cpuIdle && !isCpuCoreId(ip) && ip !== "cpu:host") {
          this.removeNode(n);
          continue;
        }
        if (!n.cpuGhost) {
          n.cpuGhost = true;
          n.cpuIdleAt ??= wall;
          n.device = { ...n.device, online: false };
        }
        continue;
      }
      this.removeNode(n);
    }

    const liveKeys = new Set<string>();
    for (const f of view.flows) {
      const id = `${f.a}|${f.b}`;
      liveKeys.add(id);
      let l = this.links.get(id);
      const a = this.nodes.get(f.a), b = this.nodes.get(f.b);
      if (!a || !b) continue;
      if (!l) {
        l = { id, flow: f, source: a, target: b, visible: true };
        this.links.set(id, l);
        added = true;
      } else l.flow = f;
    }
    for (const id of [...this.links.keys()]) {
      if (id.startsWith("~") || liveKeys.has(id)) continue;
      const l = this.links.get(id)!;
      if (cpuView && (l.source.cpuGhost || l.target.cpuGhost)) {
        l.flow = { ...l.flow, rate: 0, rate_ab: 0, rate_ba: 0 };
        continue;
      }
      this.links.delete(id);
    }

    // tether nodes without an observed conversation to their hub ("~" links): LAN and self -> gateway,
    // local (Docker / VM / tunnel subnets) -> this host. The layout then reads as a star even when only
    // broadcast traffic is visible.
    const gw = this.nodes.get(view.gateway);
    const me = this.nodes.get(view.local_ip);
    if (gw) gw.fx = gw.fy = gw.fz = 0;
    const hubFor = (n: GNode): GNode | undefined =>
      n.device.role === "lan" || n.device.role === "self" ? gw : n.device.role === "local" ? me : undefined;
    const realLinks = new Set<string>();
    for (const l of this.links.values()) {
      if (l.id.startsWith("~")) continue;
      realLinks.add(`${l.source.id}|${l.target.id}`);
      realLinks.add(`${l.target.id}|${l.source.id}`);
    }
    for (const n of this.nodes.values()) {
      const tetherId = `~${n.id}`;
      const hub = hubFor(n);
      const wants = hub !== undefined && hub !== n && !realLinks.has(`${n.id}|${hub.id}`);
      const existing = this.links.get(tetherId);
      if (wants && (!existing || existing.target !== hub)) {
        const flow: Flow = { a: n.id, b: hub.id, bytes: 0, packets: 0, ports: [], protos: [], ifaces: [], first_seen: 0, last_seen: 0, rate: 0 };
        this.links.set(tetherId, { id: tetherId, flow, source: n, target: hub, visible: true });
        added = true;
      } else if (!wants && existing) {
        this.links.delete(tetherId);
      }
    }
    for (const n of this.nodes.values()) { n.active = false; n.rate = 0; }
    for (const l of this.links.values()) {
      if (l.flow.rate <= 0) continue;
      l.source.active = l.target.active = true;
      l.source.rate += l.flow.rate;
      l.target.rate += l.flow.rate;
      if (flowEarnsLabel(l)) {
        l.source.labelUntil = this.now + LABEL_HOLD_S;
        l.target.labelUntil = this.now + LABEL_HOLD_S;
      }
    }

    // style through the active mode (visibility first, as modes rank visible nodes)
    for (const n of this.nodes.values()) n.visible = this.nodeVisible(n);
    const savedRoles = { ...ROLE_COLOR };
    Object.assign(ROLE_COLOR, this.theme.roles);
    try {
      const ctx = this.ctx;
      this.mode.prepare?.(ctx);
      for (const n of this.nodes.values()) {
        const d = n.device;
        const plug = this.pluginColors.get(n.id) ?? this.pluginColors.get(d.ip);
        n.colorWant.setHex(plug ?? this.mode.nodeColor?.(n, ctx) ?? KIND_COLOR[deviceKind(d)]);
        if (!plug && this.pluginHeat > 0) {
          n.colorWant.lerp(this.pluginHeatColor.setHex(heat(this.pluginHeat)), 0.45);
        }
        if (this.fadeT >= 1) n.color.copy(n.colorWant);
        n.targetScale = this.mode.nodeScale?.(n, ctx) ?? this.sizeFor(d);
        n.shapeWant = this.mode.nodeShape?.(n, ctx) ?? 0;
        n.shape = mixShape(n.shapeFrom, n.shapeWant, this.viewMorphT);
        if (this.viewMorphT >= 1) n.shapeFrom = n.shapeWant;
        this.setLabelText(n, this.mode.nodeLabel?.(n, ctx));
      }
      this.instanceStyleDirty = true;

      this.applyVisibility();
      this.applyVolume();
      // every snapshot: rates and roles feed the slot / charge forces, so the worker gets fresh numbers
      // even when the structure did not change (it keeps positions and velocities across the resend)
      this.syncSimulation(added && newNodes > 0 ? (this.nodes.size <= newNodes + 1 ? 1 : 0.12) : 0);
      this.rebuildLineBuffers();
      this.rebuildParticles();
    } finally {
      Object.assign(ROLE_COLOR, savedRoles);
    }
    if (this.selected) this.onSelect(this.selected.device);
    this.stampPane();
  }

  /** Mosaic chrome can read live graphBase / node counts without poking private fields. */
  private stampPane(): void {
    this.container.dataset.graphBase = this.mode.graphBase ?? "";
    this.container.dataset.nodes = String(this.nodes.size);
    this.container.dataset.viewId = this.mode.id;
  }

  /**
   * High-volume nodes get a larger title and a guarded tint in the node's own colour.
   * `--hl-mix` is capped so the mix still meets WCAG AA against the sky-adjusted fill — no bloom.
   */
  private applyVolume(): void {
    let maxLog = 0;
    for (const n of this.nodes.values()) if (n.visible && n.rate > 0) maxLog = Math.max(maxLog, Math.log10(1 + n.rate));
    const bgHex = this.inkBgHex;
    for (const n of this.nodes.values()) {
      let vol = 0;
      if (n.visible && n.rate > 0 && maxLog > 0) {
        const log = Math.log10(1 + n.rate);
        const rel = Math.max(0, (log / maxLog - VOL_FLOOR) / (1 - VOL_FLOOR));
        const abs = Math.min(1, log / 4);
        vol = rel * abs;
      }
      const el = n.labelEl;
      const nodeHex = n.color.getHex();
      const mixT = guardLabelMix(this.labelFgHex, nodeHex, bgHex, vol * 0.85);
      const q = String(Math.round(vol * 20) / 20);
      const mixQ = `${Math.round(mixT * 100)}%`;
      if (el.dataset.vol !== q) {
        el.dataset.vol = q;
        el.style.setProperty("--vol", q);
        n.label.invalidateBox();
      }
      el.classList.toggle("hot", vol >= 0.5 && mixT > 0.08);
      if (el.dataset.hlMix !== mixQ) {
        el.dataset.hlMix = mixQ;
        el.style.setProperty("--hl-mix", mixQ);
      }
      const hl = mixT > 0 ? `#${n.color.getHexString()}` : "";
      if (el.dataset.hl !== hl) {
        el.dataset.hl = hl;
        if (hl) el.style.setProperty("--hl", hl);
        else el.style.removeProperty("--hl");
      }
    }
  }

  /** Only visible nodes and links take part in the layout, so hidden multicast hubs cannot bunch LAN devices. */
  private syncSimulation(minAlpha: number): void {
    const nodes = [...this.nodes.values()].filter((n) => n.visible);
    this.measureCrowds(nodes);
    const n = nodes.length;
    const arr = new Float32Array(n * NODE_STRIDE);
    const pos = new Float32Array(n * 3);
    const idx = new Map<GNode, number>();
    for (let i = 0; i < n; i++) {
      const nd = nodes[i]!;
      idx.set(nd, i);
      const o = i * NODE_STRIDE;
      const role = nd.device.role;
      const baseR = this.baseShell(nd);
      const sk = this.mode.shellStrength?.(nd);
      const placed = graphLayoutPlaces(this.anim.graphLayout);
      const fixed = nd.fx !== undefined && nd !== this.dragging;
      arr[o + N_KEY] = nd.simKey;
      arr[o + N_ROLE] = roleIdx(role);
      arr[o + N_SHELL_R] = this.crowdRadius.get(baseR) ?? baseR;
      arr[o + N_SHELL_K] = placed ? 0 : sk ?? (role === "gateway" ? 1 : role === "internet" || role === "multicast" ? 0.6 : 0.9);
      arr[o + N_SLOT] = placed || sk === 0 ? 0 : 1;
      arr[o + N_THETA] = hashAngle(nd.id);
      arr[o + N_RELAX] = this.crowdRelax.get(baseR) ?? 1;
      arr[o + N_CHARGE] = (this.mode.charge?.(nd) ?? (role === "lan" || role === "local" ? -500 : -90)) * (this.crowdCharge.get(baseR) ?? 1);
      arr[o + N_RATE] = nd.rate;
      arr[o + N_FIXED] = fixed ? 1 : 0;
      arr[o + N_FX] = fixed ? nd.fx! : 0;
      arr[o + N_FY] = fixed ? nd.fy ?? 0 : 0;
      arr[o + N_FZ] = fixed ? nd.fz ?? 0 : 0;
      pos[i * 3] = nd.x ?? 0;
      pos[i * 3 + 1] = nd.y ?? 0;
      pos[i * 3 + 2] = nd.z ?? 0;
    }
    const links: number[] = [];
    for (const l of this.links.values()) {
      if (!l.visible) continue;
      const s = idx.get(l.source), t = idx.get(l.target);
      if (s === undefined || t === undefined) continue;
      const inet = l.source.device.role === "internet" || l.target.device.role === "internet";
      const base = inet ? 260 * this.spreadX : 160 * (0.7 + 0.3 * this.spreadX);
      const k = this.mode.linkStrength?.(l) ?? (l.id.startsWith("~") ? 0.03
        : l.source.device.role === "multicast" || l.target.device.role === "multicast" ? 0
        : 0.12);
      links.push(s, t, base, k);
    }
    const linkArr = new Float32Array(links.length);
    for (let i = 0; i < links.length; i += LINK_STRIDE) {
      linkArr[i + L_SRC] = links[i]!;
      linkArr[i + L_DST] = links[i + 1]!;
      linkArr[i + L_BASE] = links[i + 2]!;
      linkArr[i + L_K] = links[i + 3]!;
    }
    this.simNodes = nodes;
    this.simGen++;
    this.layout.setStructure({ type: "structure", gen: this.simGen, n, nodes: arr, pos, links: linkArr, minAlpha });
  }

  /**
   * Give crowded shells room. A shell that more nodes share than fit around it at CROWD_SPACING widens into the
   * space before the next shell out (the outermost by at most CROWD_OUTER_MAX). Whatever crowding is left after
   * that relaxes the shell's flattening, so the nodes use the sphere rather than one ring, and scales their charge
   * down so the crowd pushes on the shells around it about as hard as a full ring would rather than shoving them
   * to the poles. Everything scales continuously with the count, so a node arriving or leaving nudges the layout
   * instead of snapping it. Nodes a mode places itself (shell strength 0) and the pinned gateway do not count.
   */
  private measureCrowds(nodes: GNode[]): void {
    const count = new Map<number, number>();
    const flat = new Map<number, number>();  // how many of them the flatten force holds to a ring
    const flattening = this.mode.flatten !== false;
    for (const n of nodes) {
      const role = n.device.role;
      if (role === "gateway" || this.mode.shellStrength?.(n) === 0) continue;
      const r = this.baseShell(n);
      if (r < 8) continue;
      count.set(r, (count.get(r) ?? 0) + 1);
      if (flattening && (role === "lan" || role === "local" || role === "self")) flat.set(r, (flat.get(r) ?? 0) + 1);
    }
    this.crowdRadius.clear();
    this.crowdRelax.clear();
    this.crowdCharge.clear();
    const stretch = (this.spreadX + this.spreadZ) / 2;
    // nodes that fit on a shell of radius r: around its ring when flattened, over its surface otherwise
    const ring = (r: number) => (2 * Math.PI * r * stretch) / CROWD_SPACING;
    const sphere = (r: number) => (4 * Math.PI * r * r * stretch * stretch) / (CROWD_SPACING * CROWD_SPACING);
    const radii = [...count.keys()].sort((a, b) => a - b);
    radii.forEach((r, i) => {
      const c = count.get(r)!;
      const holds = (flat.get(r) ?? 0) * 2 > c ? ring : sphere;
      const fit = holds(r);
      if (c <= fit) return;
      const next = radii[i + 1];
      const room = next === undefined ? r * CROWD_OUTER_MAX : Math.max(r, next - CROWD_GAP);
      const wide = Math.min(room, holds === ring ? (r * c) / fit : r * Math.sqrt(c / fit));
      if (wide > r + 0.5) this.crowdRadius.set(r, wide);
      const left = holds(wide) / c;  // share of the crowd the widened shell holds
      if (left < 1) {
        // squared so a badly crowded ring opens into a whole sphere; a band around the equator would still
        // shove the shells outside it toward the poles
        this.crowdRelax.set(r, left * left);
        this.crowdCharge.set(r, Math.max(0.25, left));
      }
    });
  }

  private sizeFor(d: Device): number {
    if (d.role === "multicast") return 3;
    const base = d.role === "gateway" ? 10 : d.role === "self" ? 7 : 5;
    return base + Math.min(5, Math.log10(1 + d.bytes_in + d.bytes_out) * 0.45);
  }

  private addNode(d: Device, msg: StateMsg): GNode {
    const el = document.createElement("div");
    el.className = "label off";
    const label = new LabelItem(el);
    this.labelLayer.add(label);
    // spawn on the role's shell, in the direction of its first known peer so it slides in rather than flying across
    const shell = SHELL[d.role];
    const peerIp = msg.flows.find((f) => f.a === d.ip || f.b === d.ip);
    const peer = peerIp ? this.nodes.get(peerIp.a === d.ip ? peerIp.b : peerIp.a) : undefined;
    let dir = new THREE.Vector3(peer?.x ?? 0, peer?.y ?? 0, peer?.z ?? 0);
    if (dir.lengthSq() < 1) dir = new THREE.Vector3().randomDirection();
    dir.normalize().add(new THREE.Vector3().randomDirection().multiplyScalar(0.35)).normalize();
    if (d.role === "lan" || d.role === "local" || d.role === "self") dir.y *= 0.2;
    dir.normalize();
    const r = shell || 1;
    const c = new THREE.Color(this.theme.roles[d.role]);
    const n: GNode = {
      id: d.ip, simKey: this.nextSimKey++, device: d, color: c, colorFrom: c.clone(), colorWant: c.clone(), scale: 0.01, glow: 0.15, opacity: 1, shape: 0, shapeFrom: 0, shapeWant: 0,
      label, labelEl: el, visible: true, active: false, rate: 0, targetScale: this.sizeFor(d),
      x: dir.x * r * this.spreadX, y: dir.y * r, z: dir.z * r * this.spreadZ,
      px: dir.x * r * this.spreadX, py: dir.y * r, pz: dir.z * r * this.spreadZ,
    };
    this.nodes.set(d.ip, n);
    if (this.nodes.size > this.spheres.instanceMatrix.count) this.growSpheres();
    this.setLabelText(n);
    return n;
  }

  /** Double the instance capacity; the per-frame write fills the new mesh before it is first drawn. */
  private growSpheres(): void {
    const cap = Math.max(SPHERE_CAPACITY, this.spheres.instanceMatrix.count * 2);
    this.scene.remove(this.spheres);
    this.spheres.geometry.dispose();
    this.spheres.dispose();
    this.spheres = sphereCloud(this.sphereMat, cap);
    this.spheres.visible = !this.stageOnly;
    this.scene.add(this.spheres);
  }

  private removeNode(n: GNode): void {
    this.labelLayer.remove(n.label);
    this.nodes.delete(n.id);
    for (const [id, l] of this.links) if (l.source === n || l.target === n) this.links.delete(id);
    if (this.selected === n) this.select(null);
  }

  /** Drop CPU process ghosts that have finished their unused fade. Cores stay at the idle floor. */
  private pruneCpuIdle(wall: number): boolean {
    if (this.mode.graphBase !== "cpu") return false;
    let removed = false;
    for (const n of [...this.nodes.values()]) {
      if (!n.cpuGhost || !n.cpuIdleAt || wall - n.cpuIdleAt < CPU_IDLE_FADE_S) continue;
      if (n.id === "cpu:host" || isCpuCoreId(n.id)) continue;
      this.removeNode(n);
      removed = true;
    }
    if (removed) this.instanceStyleDirty = true;
    return removed;
  }

  private setLabelText(n: GNode, extra?: string): void {
    const d = n.device;
    const raw = displayName(d);
    const name = raw === d.ip ? rIp(d.ip) : rName(raw);
    const cpu = d.ip.startsWith("cpu:") || d.ip.startsWith("proc:");
    const sub = cpu
      ? (d.ip.startsWith("proc:") ? (d.aliases?.[0] ?? "") : (d.aliases?.find((a) => a.startsWith("load") || a.endsWith("cores")) ?? ""))
      : raw === d.ip ? (d.vendor || "") : rIp(d.ip) + (d.vendor ? ` · ${d.vendor}` : "");
    const html = `${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ""}${extra ? `<small class="mode">${escapeHtml(extra)}</small>` : ""}`;
    if (n.labelEl.innerHTML !== html) {
      n.labelEl.innerHTML = html;
      n.label.invalidateBox();
    }
    n.labelEl.classList.toggle("dim", !d.online || !!n.cpuIdleAt);
  }

  private nodeVisible(n: GNode): boolean {
    const d = n.device;
    if (!this.nodeFilter(d)) return false;
    if (this.mode.graphBase === "cpu" || isSysBase(this.mode.graphBase)) {
      if (this.mode.graphBase === "cpu" && !this.filters.cpuIdle && n.cpuGhost && d.ip.startsWith("proc:")) return false;
      return true;
    }
    if (d.role === "lan" && !this.filters.lan) return false;
    if (d.role === "internet" && !this.filters.internet) return false;
    if (d.role === "multicast" && !this.filters.multicast) return false;
    if (!d.online && !this.filters.offline && d.role !== "gateway" && d.role !== "self") return false;
    return true;
  }

  private applyVisibility(): void {
    const ctx = this.ctx;
    const cap = paneLabelCap(ctx);
    // one visibility pass; the label ranking below reads the flag instead of re-running the filter
    const lan: GNode[] = [], net: GNode[] = [];
    for (const n of this.nodes.values()) {
      n.visible = this.nodeVisible(n);
      if (!n.visible) continue;
      const r = n.device.role;
      if (r === "lan" || r === "local") lan.push(n);
      else if (r === "internet") net.push(n);
    }
    const byBytes = (a: GNode, b: GNode) => (b.device.bytes_in + b.device.bytes_out) - (a.device.bytes_in + a.device.bytes_out) || b.rate - a.rate;
    const topLan = new Set(lan.sort(byBytes).slice(0, cap).map((n) => n.id));
    const topNet = new Set(net.sort(byBytes).slice(0, cap).map((n) => n.id));
    for (const n of this.nodes.values()) {
      const r = n.device.role;
      const live = (n.labelUntil ?? 0) > this.now;
      const focused = n === this.selected || n === this.hovered;
      const lanKeep = (r === "lan" || r === "local") && topLan.has(n.id);
      const netKeep = r === "internet" && topNet.has(n.id);
      const byRole = r === "self" || r === "gateway" || lanKeep || netKeep;
      const showLabel = n.visible && this.filters.labels && (
        focused || live || this.mode.forceLabel?.(n, ctx) || (byRole && !this.mode.suppressLabel?.(n, ctx))
      );
      n.label.visible = !this.stageOnly && !!showLabel;
      n.labelEl.classList.toggle("off", this.stageOnly || !showLabel);
      n.label.pinned = focused;
      n.label.rank = (live ? 1e6 : 0)
        + (r === "self" || r === "gateway" ? 1e5 : 0)
        + labelActivity(n.rate, n.device.bytes_in + n.device.bytes_out);
    }
    for (const l of this.links.values()) l.visible = l.source.visible && l.target.visible;
  }

  // ------------------------------------------------------------------ buffers

  private rebuildLineBuffers(): void {
    const n = this.links.size;
    const segs = stringSegs(this.anim.stringAmt, this.bundleAmt());
    const floats = n * segs * 6;
    if (this.linePos.length !== floats) {
      this.linePos = new Float32Array(floats);
      this.lineCol = new Float32Array(floats);
      this.glowAlong = new Float32Array(n * segs * 2);
      this.glowAb = new Float32Array(n * segs * 2);
      this.glowBa = new Float32Array(n * segs * 2);
      this.glowCol = new Float32Array(floats);
      let gi = 0;
      for (let i = 0; i < n; i++) {
        for (let s = 0; s < segs; s++) {
          this.glowAlong[gi] = s / segs;
          this.glowAlong[gi + 1] = (s + 1) / segs;
          gi += 2;
        }
      }
      const pos = new THREE.BufferAttribute(this.linePos, 3);
      const col = new THREE.BufferAttribute(this.lineCol, 3);
      this.lines.geometry.setAttribute("position", pos);
      this.lines.geometry.setAttribute("color", col);
      const gg = this.glowLines.geometry;
      gg.setAttribute("position", pos);
      gg.setAttribute("color", new THREE.BufferAttribute(this.glowCol, 3));
      gg.setAttribute("along", new THREE.BufferAttribute(this.glowAlong, 1));
      gg.setAttribute("glowAb", new THREE.BufferAttribute(this.glowAb, 1));
      gg.setAttribute("glowBa", new THREE.BufferAttribute(this.glowBa, 1));
    }
  }

  private rebuildParticles(): void {
    const a = this.anim;
    const t = this.tune;
    const pulse = a.audioParts ? 1 + 0.7 * this.pulseLevel * a.audioSens : 1;
    const budget = {
      amt: (t?.partAmt ?? a.partAmt) * pulse,
      busy: a.partBusy,
      quiet: a.partQuiet,
      peak: t?.partPeak ?? a.partPeak,
      cap: clampParticleCap(t?.partCap ?? a.partCap),
    };
    const wanted: { link: GLink; count: number }[] = [];
    let total = 0;
    for (const l of this.links.values()) {
      const c = particlesOnLink(l.flow.rate, budget);
      if (c <= 0) continue;
      wanted.push({ link: l, count: c });
      total += c;
    }
    const cap = budget.cap;
    const scale = total > cap ? cap / total : 1;
    const existing = new Map<GLink, { link: GLink; t: number; dir: 1 | -1; speed: number }[]>();
    for (const p of this.partState) {
      if (!this.links.has(p.link.id)) continue;
      (existing.get(p.link) ?? existing.set(p.link, []).get(p.link)!).push(p);
    }
    const next: typeof this.partState = [];
    for (const { link, count } of wanted) {
      const c = Math.max(1, Math.round(count * scale));
      const have = existing.get(link) ?? [];
      const { ab, ba } = flowDirRates(link.flow);
      const nAb = Math.round(c * (ab + ba > 0 ? ab / (ab + ba) : 0.5));
      const haveAb = have.filter((p) => p.dir === 1);
      const haveBa = have.filter((p) => p.dir === -1);
      for (let i = 0; i < c; i++) {
        const wantAb = i < nAb;
        const pool = wantAb ? haveAb : haveBa;
        const idx = wantAb ? i : i - nAb;
        next.push(pool[idx] ?? { link, t: Math.random(), dir: wantAb ? 1 : -1, speed: 0.25 + Math.random() * 0.35 });
      }
    }
    this.partState = next;
  }

  // ------------------------------------------------------------------ frame

  private lastFrameTs = 0;

  private animate(ts: number): void {
    if (!this.host) this.raf = requestAnimationFrame(this.animate);
    markFrame(ts);
    if (!this.active) {
      this.paneFps.el.hidden = true;
      return;
    }
    this.paneFps.el.hidden = false;
    this.paneFps.tick(ts);
    if (this.satellite && this.satelliteCameraBroken()) {
      this.resize();
      this.recoverSatelliteCamera();
    }
    const dt = this.lastFrameTs ? Math.min(0.05, (ts - this.lastFrameTs) / 1000) : 0;
    this.lastFrameTs = ts;
    if (!this.satellite) {
      tickPerf(ts, this.anim.autoTune !== false, this.anim.moveEase);
      const s = perfStress();
      this.paneFps.hint((s > 0.04
        ? (perfWant() > 0.5
          ? "this pane · auto-tune easing labels, sparks, glow, and sky down"
          : "this pane · auto-tune easing back up after a 1-minute recovered average")
        : "how often this pane's picture changed in the last second"
          + (this.lastVis && !this.lastVis.ok
            ? ` · visibility: ${this.lastVis.issues.map((i) => i.code).join(", ")}`
            : ""))
        + ` · layout: ${this.layout.backend}/${this.layout.kernel}`
        + (this.software ? " · canvas 2D (this browser has no WebGL)" : ""));
    }
    this.tune = perfOverlay(this.anim, perfStress());
    this.syncTuneDpr();
    if (this.tune.labelCount !== this.lastTuneLabels) {
      this.lastTuneLabels = this.tune.labelCount;
      this.applyVisibility();
    }
    const pk = `${this.tune.partCap}|${this.tune.partPeak}|${Math.round(this.tune.partAmt * 10)}`;
    if (pk !== this.lastTuneParts) {
      this.lastTuneParts = pk;
      this.rebuildParticles();
    }
    if (this.tune.k > 0.001 || this.lastTuneK > 0.001) {
      (this.particles.material as THREE.PointsMaterial).size = 3.2 * this.anim.edgeWeight * this.tune.partSize;
      this.syncGlow();
    }
    this.lastTuneK = this.tune.k;
    this.easePhys(dt);
    const wall = ts / 1000;
    this.backdrop.tick(wall);
    if (!this.satellite && this.anim.backdrop === "dynamic") ensureSkyRecipe(this.anim.skyAiMin * 60_000);
    this.applyLook(dt);
    if (!this.satellite) this.afterLook?.();
    if (this.pruneCpuIdle(wall)) {
      this.rebuildLineBuffers();
      this.applyVisibility();
    }

    this.stepLayout(dt);

    if (this.stageOnly) {
    this.sampleFocus(dt);
        this.frameCamera(dt);
        this.controls.update();
        this.followUserCameraCoast();
        // Hold a level horizon for FPS plugin skies; skip dream pitch nod.
        if (!this.userOwnsCamera()) {
          const t = this.controls.target;
          _off.copy(this.camera.position).sub(t);
          _sph.setFromVector3(_off);
          _sph.phi = Math.PI * 0.5;
          this.camera.position.copy(t).add(_off.setFromSpherical(_sph));
          this.camera.lookAt(t);
        }
        if (this.viewMorphT < 1) {
          this.viewMorphT = Math.min(1, this.viewMorphT + dt / VIEW_MORPH_S);
          this.instanceStyleDirty = true;
        }
        if (this.fadeT < 1) {
          this.fadeT = Math.min(1, this.fadeT + dt / THEME_FADE_S);
          this.applyThemeColors(this.fadeT);
          this.paintGrid();
          this.paintClear();
        }
        this.tickViewShift(dt);
        this.present();
      return;
    }

    if (this.viewMorphT < 1) {
      this.viewMorphT = Math.min(1, this.viewMorphT + dt / VIEW_MORPH_S);
      for (const n of this.nodes.values()) n.shape = mixShape(n.shapeFrom, n.shapeWant, this.viewMorphT);
      this.instanceStyleDirty = true;
    }

    // nodes: one instance per drawn node, rewritten every frame. Hidden nodes shrink to nothing and then
    // drop out of the instance list entirely, so a filtered-down view costs what it shows, not what it holds.
    const sp = this.spheres;
    const glowAttr = sp.geometry.getAttribute("instanceGlow") as THREE.InstancedBufferAttribute;
    const alphaAttr = sp.geometry.getAttribute("instanceAlpha") as THREE.InstancedBufferAttribute;
    const shapeAttr = sp.geometry.getAttribute("instanceShape") as THREE.InstancedBufferAttribute;
    const cpuView = this.mode.graphBase === "cpu";
    const modeCtx = this.ctx;
    const liveLook = this.mode.liveLook;
    // instance indices are compacted over drawn nodes; when the drawn set changes, every colour / shape
    // slot shifts, so restyle in the same frame rather than a frame late
    let willDraw = 0;
    for (const n of this.nodes.values()) if (n.visible || n.scale > COLLAPSED_SCALE) willDraw++;
    if (willDraw !== sp.count) this.instanceStyleDirty = true;
    const styleDirty = this.instanceStyleDirty;
    let liveStyle = false;
    let ni = 0;
    let labelsOn = 0;
    const fabricNodes: FabricNodePose[] = [];
    const fabricById = new Map<string, FabricNodePose>();
    for (const n of this.nodes.values()) {
      if (!n.visible && n.scale <= COLLAPSED_SCALE) continue;
      const target = n.visible ? n.targetScale : 0.01;
      n.scale += (target - n.scale) * Math.min(1, dt * 6);
      const boost = nodeHighlightBoost(n === this.selected, n === this.hovered, n.active);
      n.glow += (boost - n.glow) * Math.min(1, dt * 8);
      if (cpuView && (n.cpuIdleAt || n.cpuGhost)) n.opacity = cpuIdleOpacity(n, wall);
      else n.opacity += ((n.device.online ? 1 : 0.35) - n.opacity) * Math.min(1, dt * 4);
      const look = liveLook?.(n, wall, modeCtx);
      const x = (n.x ?? 0) + (look?.dx ?? 0);
      const y = (n.y ?? 0) + (look?.dy ?? 0);
      const z = (n.z ?? 0) + (look?.dz ?? 0);
      const beat = this.anim.audioNodes ? 1 + 0.32 * this.pulseBass * (n === this.selected || n === this.dragging ? 1.55 : 1) : 1;
      const s = n.visible ? n.scale * beat * this.anim.nodeWeight * (look?.scale ?? 1) * (0.86 + 0.14 * mixFade(this.viewMorphT)) : 0;
      if (look?.spin != null) _quat.setFromAxisAngle(_axisY, look.spin);
      else _quat.identity();
      sp.setMatrixAt(ni, _m.compose(_pos.set(x, y, z), _quat, _scl.set(s, s, s)));
      if (look) {
        liveStyle = true;
        _colA.copy(n.color);
        if (look.hue) {
          _colA.getHSL(_hsl);
          _hsl.h = (_hsl.h + look.hue + 1) % 1;
          _colA.setHSL(_hsl.h, Math.min(1, _hsl.s + 0.15 * (look.glow ?? 0)), Math.min(1, _hsl.l + 0.1 * (look.glow ?? 0)));
        }
        sp.setColorAt(ni, _colA);
        shapeAttr.setX(ni, look.shape ?? n.shape);
      } else if (styleDirty) {
        sp.setColorAt(ni, n.color);
        shapeAttr.setX(ni, n.shape);
      }
      const instGlow = n.glow + (this.anim.audioNodes ? 0.55 * this.pulseLevel : 0) + (look?.glow ?? 0);
      glowAttr.setX(ni, instGlow);
      alphaAttr.setX(ni, n.opacity);
      const cr = look ? _colA.r : n.color.r, cg = look ? _colA.g : n.color.g, cb = look ? _colA.b : n.color.b;
      const pose: FabricNodePose = { id: n.id, x, y, z, scale: Math.max(s, 0.35), r: cr, g: cg, b: cb, glow: instGlow, opacity: n.opacity, visible: n.visible && s > 0.05 };
      fabricNodes.push(pose);
      fabricById.set(n.id, pose);
      ni++;
      if (n.label.visible) {
        labelsOn++;
        n.label.position.set(x, y + 1.9 * n.scale * this.anim.nodeWeight, z);
      }
      if (cpuView) {
        const fade = n.opacity.toFixed(3);
        if (n.labelFade !== fade) {
          n.labelFade = fade;
          n.labelEl.style.setProperty("--fade", fade);
        }
      } else if (n.labelFade !== undefined) {
        n.labelEl.style.removeProperty("--fade");
        n.labelFade = undefined;
      }
    }
    if (ni !== sp.count) this.instanceStyleDirty = true;
    sp.count = ni;
    sp.instanceMatrix.needsUpdate = true;
    glowAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    if (styleDirty || liveStyle) {
      sp.instanceColor!.needsUpdate = true;
      shapeAttr.needsUpdate = true;
      if (styleDirty) this.instanceStyleDirty = false;
    }

    // edges
    const str = this.stringNow();
    if (this.linePos.length !== this.links.size * str.segs * 6) this.rebuildLineBuffers();
    let i = 0;
    const sel = this.selected;
    const tmp = _colA, tmp2 = _colB;
    const ctx = this.ctx;
    const mode = this.mode;
    const th = this.theme.scene;
    const fabricEdges: FabricEdgePose[] = [];
    for (const l of this.links.values()) {
      const a = l.source, b = l.target;
      const ax = a.x ?? 0, ay = a.y ?? 0, az = a.z ?? 0;
      const bx = b.x ?? 0, by = b.y ?? 0, bz = b.z ?? 0;
      const tether = l.id.startsWith("~");
      let bright: number;
      if (tether) bright = this.additiveMarks() ? 0.08 : 0.22;
      else if (l.flow.rate > 0) bright = 0.35 + Math.min(0.65, Math.log10(1 + l.flow.rate) / 6);
      else bright = this.additiveMarks() ? 0.14 : 0.38;
      if (!tether && mode.linkBright) bright = mode.linkBright(l, ctx, bright);
      bright = edgeHighlightBright(bright, !!(sel && (a === sel || b === sel)), !!sel, l.visible);
      bright *= this.anim.edgeWeight * Math.min(a.opacity, b.opacity);
      const isLan = a.device.role !== "internet" && b.device.role !== "internet";
      const mc = tether ? undefined : mode.linkColor?.(l, ctx);
      const ca = Array.isArray(mc) ? mc[0] : mc ?? (tether ? th.tether : isLan ? th.lanEdge : th.wanEdge);
      const cb = Array.isArray(mc) ? mc[1] : ca;
      this.edgeColor(tmp, ca, bright);
      const lr = tmp.r, lg = tmp.g, lb = tmp.b;
      this.edgeColor(tmp2, cb, bright);
      const rr = tmp2.r, rg = tmp2.g, rb = tmp2.b;
      this.edgeColor(tmp, ca, 0.9);
      const gca = tmp.r, gcg = tmp.g, gcb = tmp.b;
      this.edgeColor(tmp2, cb, 0.9);
      const gcd = tmp2.r, gce = tmp2.g, gcf = tmp2.b;
      const { ab, ba } = flowDirRates(l.flow);
      let gab = tether || !l.visible ? 0 : glowStrength(ab);
      let gba = tether || !l.visible ? 0 : glowStrength(ba);
      if (sel && a !== sel && b !== sel) { gab *= 0.35; gba *= 0.35; }
      if (!tether && fabricById.has(a.id) && fabricById.has(b.id)) {
        fabricEdges.push({
          a: a.id, b: b.id, r0: lr, g0: lg, b0: lb, r1: rr, g1: rg, b1: rb,
          gab, gba, wave: 0.18 + 0.55 * glowStrength(l.flow.rate), visible: l.visible && bright > 0.01,
        });
      }
      for (let s = 0; s < str.segs; s++) {
        const t0 = s / str.segs, t1 = (s + 1) / str.segs;
        const u = str.segs === 1
          ? [ax, ay, az] as [number, number, number]
          : this.edgePoint(ax, ay, az, bx, by, bz, t0, str);
        const v = str.segs === 1
          ? [bx, by, bz] as [number, number, number]
          : this.edgePoint(ax, ay, az, bx, by, bz, t1, str);
        this.linePos[i] = u[0]; this.linePos[i + 1] = u[1]; this.linePos[i + 2] = u[2];
        this.linePos[i + 3] = v[0]; this.linePos[i + 4] = v[1]; this.linePos[i + 5] = v[2];
        const mix0 = t0, mix1 = t1;
        this.lineCol[i] = lr + (rr - lr) * mix0;
        this.lineCol[i + 1] = lg + (rg - lg) * mix0;
        this.lineCol[i + 2] = lb + (rb - lb) * mix0;
        this.lineCol[i + 3] = lr + (rr - lr) * mix1;
        this.lineCol[i + 4] = lg + (rg - lg) * mix1;
        this.lineCol[i + 5] = lb + (rb - lb) * mix1;
        this.glowCol[i] = gca + (gcd - gca) * mix0;
        this.glowCol[i + 1] = gcg + (gce - gcg) * mix0;
        this.glowCol[i + 2] = gcb + (gcf - gcb) * mix0;
        this.glowCol[i + 3] = gca + (gcd - gca) * mix1;
        this.glowCol[i + 4] = gcg + (gce - gcg) * mix1;
        this.glowCol[i + 5] = gcb + (gcf - gcb) * mix1;
        const gi = (i / 6) * 2;
        if (this.glowAb.length > gi + 1) {
          this.glowAb[gi] = this.glowAb[gi + 1] = gab;
          this.glowBa[gi] = this.glowBa[gi + 1] = gba;
        }
        i += 6;
      }
    }
    const pa = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const ca = this.lines.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (pa && ca) { pa.needsUpdate = true; ca.needsUpdate = true; }
    const gab = this.glowLines.geometry.getAttribute("glowAb") as THREE.BufferAttribute | undefined;
    const gba = this.glowLines.geometry.getAttribute("glowBa") as THREE.BufferAttribute | undefined;
    const gc = this.glowLines.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (gab && gba) { gab.needsUpdate = true; gba.needsUpdate = true; }
    if (gc) gc.needsUpdate = true;
    this.glowMat.uniforms.uTime.value = wall;
    this.syncGlow();
    const fabricKind = this.fabricKind();
    this.fabric.setKind(fabricKind);
    if (fabricActive(fabricKind)) {
      const pairs = fabricEdges.filter((e) => e.visible).map((e) => [e.a, e.b] as [string, string]);
      this.fabric.sync(fabricNodes, fabricEdges, graphFaces(pairs), {
        time: wall,
        pulse: this.pulseLevel,
        glowMode: this.anim.edgeGlow,
        glowAmt: (this.tune?.edgeGlowAmt ?? this.anim.edgeGlowAmt) * this.anim.edgeWeight,
        glowSpeed: this.anim.edgeGlowSpeed,
        additive: this.additiveMarks(),
        morph: this.viewMorphT,
      });
    }
    this.applyGraphMarks();
    this.syncArrows(str);

    // particles
    if (this.anim.audioParts) this.rebuildParticles();
    const partSpd = this.anim.partSpeed * (this.anim.audioParts ? 1 + 0.6 * this.pulseBass * this.anim.audioSens : 1);
    let k = 0;
    for (const p of this.partState) {
      if (k >= MAX_PARTICLES) break;
      if (!p.link.visible) continue;
      p.t += p.dir * p.speed * partSpd * dt;
      if (p.t > 1 || p.t < 0) { p.t = p.dir > 0 ? 0 : 1; }
      const a = p.link.source, b = p.link.target;
      const t = p.t;
      const pt = str.segs === 1
        ? [(a.x ?? 0) + ((b.x ?? 0) - (a.x ?? 0)) * t, (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t, (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t] as [number, number, number]
        : this.edgePoint(a.x ?? 0, a.y ?? 0, a.z ?? 0, b.x ?? 0, b.y ?? 0, b.z ?? 0, t, str);
      this.partPos[k * 3] = pt[0];
      this.partPos[k * 3 + 1] = pt[1];
      this.partPos[k * 3 + 2] = pt[2];
      const mc = mode.linkColor?.(p.link, ctx);
      if (mc === undefined) {
        const isLan = a.device.role !== "internet" && b.device.role !== "internet";
        tmp.setHex(isLan ? th.lanParticle : th.wanParticle);
      } else {
        // particles are the tinted edge colour (lighter on dark themes, darker on light ones) so they read against the edge
        tmp.setHex(Array.isArray(mc) ? mc[t < 0.5 ? 0 : 1] : mc).lerp(tmp2.setHex(th.particleTint), 0.35);
      }
      this.partCol[k * 3] = tmp.r; this.partCol[k * 3 + 1] = tmp.g; this.partCol[k * 3 + 2] = tmp.b;
      k++;
    }
    this.particles.geometry.setDrawRange(0, k);
    (this.particles.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.particles.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;

    // hover
    const h = this.pick();
    if (h !== this.hovered) {
      this.hovered = h;
      this.inputEl.style.cursor = h ? "pointer" : "";
      this.applyVisibility();
    }

    // mode overlays (cluster tags etc.)
    const ovs = mode.overlays?.(ctx);
    _overlayKeep.clear();
    if (ovs) {
      for (const o of ovs) {
        _overlayKeep.add(o.id);
        let obj = this.overlayObjs.get(o.id);
        if (!obj) {
          const el = document.createElement("div");
          el.className = "overlay";
          obj = new LabelItem(el);
          obj.visible = !this.stageOnly;
          obj.pinned = true;
          this.labelLayer.add(obj);
          this.overlayObjs.set(o.id, obj);
        }
        obj.position.set(o.x, o.y, o.z);
        if (obj.element.innerHTML !== o.html) obj.element.innerHTML = o.html;
      }
    }
    for (const [id, obj] of this.overlayObjs) if (!_overlayKeep.has(id)) { this.labelLayer.remove(obj); this.overlayObjs.delete(id); }
    this.placeDecos();

    this.sampleFocus(dt);
    this.frameCamera(dt);

    if (!this.dreaming && !this.controls.autoRotate && ts - this.lastInteraction > 20000 && !this.selected && !this.mode.camera) this.controls.autoRotate = true;
    this.controls.update();
    this.followUserCameraCoast();
    // last writer: OrbitControls.update() rebuilds the camera from its spherical, so the nod has to land after it
    if (this.dreaming && !this.userOwnsCamera() && !this.cameraGoalDir) {
      this.stepDream(dt);
      this.camera.lookAt(this.controls.target);
      if (!this.satellite && (this.anim.cycle || this.anim.randomize || this.anim.themeCycle === "cadence" || this.anim.skyCycle === "cadence")) {
        this.dreamPulseT += dt;
        if (this.dreamPulseT >= Math.max(8, this.anim.cyclePeriod)) {
          this.dreamPulseT = 0;
          this.onDreamPulse();
        }
      }
    }
    if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + dt / THEME_FADE_S);
      this.applyThemeColors(this.fadeT);
      this.paintGrid();
      this.paintClear();
    }
    this.tickViewShift(dt);
    this.syncFloor(dt);
    this.present();
    this.captureBackdropLuma();
    const labelsWanted = labelsOn > 0 || this.overlayObjs.size > 0 || this.decoObjs.size > 0;
    if (labelsWanted || this.labelsDrawn) {
      this.labelLayer.render(this.camera);
      this.labelsDrawn = labelsWanted;
    }
  }

  /** The nearest visible node under the pointer: a ray against each node's bounding sphere (radius = its scale). */
  private pick(): GNode | null {
    if (this.pointer.x > 1) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ray = this.raycaster.ray;
    const ctx = this.ctx;
    const t = performance.now() / 1000;
    let best: GNode | null = null, bestD = Infinity;
    for (const n of this.nodes.values()) {
      if (!n.visible || n.scale < 0.5) continue;
      const look = this.mode.liveLook?.(n, t, ctx);
      _sphere.center.set((n.x ?? 0) + (look?.dx ?? 0), (n.y ?? 0) + (look?.dy ?? 0), (n.z ?? 0) + (look?.dz ?? 0));
      _sphere.radius = n.scale * this.anim.nodeWeight * (look?.scale ?? 1) * (fabricActive(this.fabricKind()) ? 1.45 : 1);
      if (!ray.intersectSphere(_sphere, _hit)) continue;
      const d = _hit.distanceToSquared(ray.origin);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /** Fit the canvas to the host. Call after mosaic panes land in the layout. */
  relayout(): void {
    this.resize();
  }

  /** Mosaic extras: fix aspect and re-aim the camera after a pane is shown. */
  refit(): void {
    this.resize();
    if (this.satellite) this.recoverSatelliteCamera();
  }

  /** Slide the optical center (positive px = left) so overlays do not sit on the graph. */
  setViewShift(px: number, snap = false): void {
    this.padWant = px;
    if (snap) {
      this.padX = px;
      this.applyViewShift();
    }
  }

  private tickViewShift(dt: number): void {
    const d = this.padWant - this.padX;
    if (Math.abs(d) < 0.2) {
      if (this.padX !== this.padWant) {
        this.padX = this.padWant;
        this.applyViewShift();
      }
      return;
    }
    this.padX += d * (1 - Math.exp(-dt / 0.22));
    this.applyViewShift();
  }

  private applyViewShift(): void {
    const w = this.viewW, h = this.viewH;
    if (w < 2 || h < 2) {
      this.camera.updateProjectionMatrix();
      return;
    }
    if (Math.abs(this.padX) < 0.5) {
      if (this.camera.view) this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      return;
    }
    this.camera.setViewOffset(w, h, this.padX, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w < 2 || h < 2) return;
    const firstBox = this.viewW < 2 || this.viewH < 2 || !Number.isFinite(this.camera.aspect);
    if (w === this.viewW && h === this.viewH && !firstBox) return;
    this.viewW = w;
    this.viewH = h;
    this.camera.aspect = w / h;
    if (this.satellite && (firstBox || this.satelliteCameraBroken())) this.recoverSatelliteCamera();
    if (!this.host) {
      if (this.renderer instanceof SoftwareGpu) {
        const pr = this.renderer.getPixelRatio();
        const c = this.renderer.domElement;
        c.width = Math.max(1, Math.round(w * pr));
        c.height = Math.max(1, Math.round(h * pr));
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      } else {
        this.renderer.setSize(w, h);
      }
    }
    this.labelLayer.setSize(w, h);
    this.backdrop.setViewport(w, h);
    this.applyViewShift();
    this.updateSpread();
  }

  private satelliteCameraBroken(): boolean {
    const p = this.camera.position;
    return !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)
      || !Number.isFinite(this.camera.aspect) || this.camera.aspect <= 0;
  }

  /** Extra created while its pane was detached (0×0) can park the camera at NaN. */
  private recoverSatelliteCamera(): void {
    const cam = this.mode.camera ?? [0, 820, 820];
    this.camera.position.set(cam[0], cam[1], cam[2]);
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(this.controls.target);
    this.lookPinned = false;
    this.cameraGoalDir = new THREE.Vector3(cam[0], cam[1], cam[2]).normalize();
    this.focus.n = 0;
  }

  /** Sit the floor under the live cloud. Camera moves then keep graph and tiles together. */
  private syncFloor(dt?: number): void {
    const want = floorPose(this.focus, this.anim.gridFollow ?? 1, this.spreadX);
    const k = dt === undefined ? 1 : 1 - Math.exp(-dt / 0.32);
    this.lastFloor = easeFloorPose(this.lastFloor, want, k);
    this.grid.setPose(this.lastFloor);
  }

  /** Arcade look stage copies this so its floor stays under the same cloud. */
  alignFloor(dst: FloorGrid): void {
    dst.copyPose(this.grid);
  }

  /** Stretch the graph so its width matches the visible floor of this camera, not a 16:9 circle. */
  private updateSpread(): void {
    const aspect = Math.max(0.5, this.camera.aspect);
    // 16:9 keeps the original spherical layout; wider panes stretch X so shells fill the frame.
    const nextX = THREE.MathUtils.clamp(aspect / (16 / 9), 1, 3.2);
    const nextZ = 1;
    const changed = Math.abs(nextX - this.spreadX) > 0.04 || Math.abs(nextZ - this.spreadZ) > 0.04;
    this.spreadX = nextX;
    this.spreadZ = nextZ;
    this.syncFloor();
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = this.fogDensity();
    if (changed && this.nodes.size) this.bumpAlpha(0.18);
  }

  private fogDensity(): number {
    const base = this.anim.backdrop === "none" ? 0.00075 : 0.00022;
    return base / Math.sqrt(Math.max(1, this.spreadX));
  }

  dispose(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("resize", this.onWinResize);
    window.removeEventListener("pointerup", this.onCamPtrLost);
    window.removeEventListener("pointercancel", this.onCamPtrLost);
    this.pulse.disable();
    this.layout.dispose();
    this.arrows.geometry.dispose();
    (this.arrows.material as THREE.Material).dispose();
    this.lumaProbe.reset();
    this.controls.dispose();
    if (this.host) {
      this.host.remove(this);
      this.container.classList.remove("hosted");
    } else {
      this.renderer.forceContextLoss();
      this.renderer.dispose();
    }
    this.paneFps.dispose();
    this.changeProbe.reset();
    this.container.replaceChildren();
  }

  get currentTime(): number { return this.now; }
  peersOf(ip: string): Flow[] {
    ip = this.resolve(ip);
    return [...this.links.values()].filter((l) => !l.id.startsWith("~") && (l.flow.a === ip || l.flow.b === ip)).map((l) => l.flow)
      .sort((x, y) => y.rate - x.rate || y.bytes - x.bytes);
  }
  deviceOf(ip: string): Device | undefined { return this.nodes.get(this.resolve(ip))?.device; }
  get selectedIp(): string | null { return this.selected?.id ?? null; }
}

function ownRenderer(container: HTMLElement, opts: {
  satellite: boolean;
  dpr: number;
  clearHex: number;
  onLost: () => void;
  onRestored: () => void;
}): HostGpu {
  if (probeWebGL()) {
    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: !opts.satellite && opts.dpr < 1.3,
        alpha: false,
        preserveDrawingBuffer: !opts.satellite,
        powerPreference: opts.satellite ? "low-power" : "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
      renderer.setPixelRatio(opts.dpr);
      const bootW = Math.max(2, container.clientWidth), bootH = Math.max(2, container.clientHeight);
      renderer.setSize(bootW, bootH);
      renderer.setClearColor(opts.clearHex);
      container.appendChild(renderer.domElement);
      renderer.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); opts.onLost(); });
      renderer.domElement.addEventListener("webglcontextrestored", () => opts.onRestored());
      return renderer;
    } catch { /* fall through to canvas 2D */ }
  }
  const canvas = document.createElement("canvas");
  canvas.dataset.softgl = "";
  container.appendChild(canvas);
  return new SoftwareGpu(canvas, opts.dpr);
}

function sameLayoutParams(a: LayoutParams, b: LayoutParams): boolean {
  if (
    a.spring !== b.spring || a.chargeAmt !== b.chargeAmt || a.linkSpan !== b.linkSpan || a.drag !== b.drag ||
    a.centerPull !== b.centerPull || a.magnetCross !== b.magnetCross || a.magnetRange !== b.magnetRange ||
    a.gravity !== b.gravity || a.swirl !== b.swirl || a.pulse !== b.pulse || a.spreadX !== b.spreadX ||
    a.spreadZ !== b.spreadZ || a.flatten !== b.flatten || a.moveK !== b.moveK
  ) return false;
  for (let i = 0; i < a.magnets.length; i++) if (a.magnets[i] !== b.magnets[i]) return false;
  return true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export { fmtBytes };
