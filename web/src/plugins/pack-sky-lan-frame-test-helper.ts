/**
 * Test-only: the viz frame the app hands a pack on a live LAN, built from a monitor
 * `StateMsg` by the same host builder main.ts uses (`mainVizBuildFrame`, viz-present-deliver.ts),
 * plus the sky uniforms the host actually renders with.
 *
 * The LAN matches UX Pro's headed real-app run at 6b172413, 35 s after pick:
 * header "420 pkt/s · 280 kB/s · 7 devices · 7 online · 7 flows · 7 active".
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { expect } from "vitest";
import type { Device, Flow, Role, StateMsg } from "../core/types";
import { parseSourceBind } from "../core/sources";
import { monoMs, type MonoMs } from "../core/viz-time";
import { mainVizBuildFrame } from "../app/viz-main-deliver";
import type { PluginSkySmokeUniforms } from "./plugin-sky-smoke-render";
import type { VizDataFrame, VizIdleConfig } from "./viz-host";

export const LAN_35S_PPS = 420;
/** Monitor `ts` (epoch s) of UX Pro's fresh Ant Colony shot: started 12:39:16.9Z + 7 s boot + 35 s. */
export const LAN_35S_EPOCH = Date.parse("2026-09-29T12:39:59Z") / 1000;

const DEVICES: [ip: string, role: Role][] = [
  ["172.30.0.10", "self"],
  ["172.30.0.1", "gateway"],
  ["172.30.0.21", "lan"],
  ["172.30.0.22", "lan"],
  ["172.30.0.23", "lan"],
  ["142.250.66.14", "internet"],
  ["104.18.32.7", "internet"],
];

/** a, b, pkt/s a->b, pkt/s b->a, protos. Sum of all directions = 420 pkt/s. */
const FLOWS: [a: string, b: string, ab: number, ba: number, protos: string[]][] = [
  ["172.30.0.10", "172.30.0.1", 60, 50, ["udp", "dns"]],
  ["172.30.0.10", "142.250.66.14", 45, 40, ["tcp", "https"]],
  ["172.30.0.21", "172.30.0.1", 35, 30, ["tcp", "http"]],
  ["172.30.0.22", "104.18.32.7", 30, 25, ["udp", "quic"]],
  ["172.30.0.23", "172.30.0.1", 25, 20, ["udp", "mdns"]],
  ["172.30.0.10", "172.30.0.21", 20, 15, ["tcp", "ssh"]],
  ["172.30.0.22", "172.30.0.23", 15, 10, ["tcp", "smb"]],
];

const AVG_PKT_BYTES = 280_000 / LAN_35S_PPS;

function device(ip: string, role: Role, i: number): Device {
  return {
    ip, mac: `02:00:00:00:00:${(16 + i).toString(16)}`, vendor: "", hostnames: [], names: [], sources: [],
    ports: [], ifaces: ["enp0s3"], aliases: [], first_seen: 0, last_seen: 0, bytes_in: 1e6, bytes_out: 1e6,
    packets: 10_000, role, online: true,
  };
}

/** Monitor snapshot at epoch `ts`, 35 s after the pick. */
export function lanState35s(ts = LAN_35S_EPOCH): StateMsg {
  const age = 35;
  const flows: Flow[] = FLOWS.map(([a, b, ab, ba, protos]) => ({
    a, b, bytes: (ab + ba) * AVG_PKT_BYTES * age, packets: (ab + ba) * age, ports: [], protos, ifaces: ["enp0s3"],
    first_seen: ts - age, last_seen: ts, rate: (ab + ba) * AVG_PKT_BYTES,
    rate_ab: ab * AVG_PKT_BYTES, rate_ba: ba * AVG_PKT_BYTES, rate_pkt_ab: ab, rate_pkt_ba: ba,
  }));
  return {
    type: "state", ts, iface: "enp0s3", interfaces: ["enp0s3"], network: "172.30.0.0/24",
    local_ip: "172.30.0.10", gateway: "172.30.0.1", uptime: age,
    stats: { pps: LAN_35S_PPS, bps: 280_000, packets: LAN_35S_PPS * age, bytes: 280_000 * age, devices: 7, online: 7, flows: 7, active_flows: 7 },
    devices: DEVICES.map(([ip, role], i) => device(ip, role, i)),
    flows,
    sources: {},
  };
}

/**
 * `count` consecutive frames the host delivers for a pack (idle config and contract as in
 * the pack's plugin.yml), ending 35 s after the pick, at `fps` present rate (UX Pro's run showed 0-7 fps).
 */
export function lanFrames35s(idle: VizIdleConfig | undefined, contract: number, count = 1, fps = 6): VizDataFrame[] {
  const out: VizDataFrame[] = [];
  let prev: MonoMs = monoMs(0);
  for (let i = 0; i < count; i++) {
    const ts = LAN_35S_EPOCH - (count - 1 - i) / fps;
    out.push(mainVizBuildFrame(lanState35s(ts), prev, 0, idle, parseSourceBind({}), contract));
    prev = monoMs(1);
  }
  return out;
}

/** backdrop.setColors writes uAccent / uBg with THREE.Color.setHex, i.e. sRGB hex -> linear. */
function hex(n: number): [number, number, number] {
  const c = new THREE.Color().setHex(n);
  return [c.r, c.g, c.b];
}

/**
 * The sky uniforms the host renders a plugin sky with. scene.ts applyLook runs every frame
 * after the viz deliver (scene.ts:4136, after markFrame at :4085 fires the present listeners)
 * and calls backdrop.setLook / setColors, whose syncPluginLook copies the look's uBright,
 * uOpacity, uAudio, rim (uAccent) and clear (uBg) over the plugin material
 * (backdrop.ts syncPluginLook), rim / clear going through THREE.Color.setHex (sRGB -> linear). A pack's own uBright / uAccent / uBg writes do not survive to
 * the draw; only its zotoVizSlots data does.
 */
export function hostLookUniforms(look: { skyBright: number; skyOpacity: number; rim: number; bg: number }, uTime = 3): PluginSkySmokeUniforms {
  return { uTime, uOpacity: look.skyOpacity, uBright: look.skyBright, uAudio: 0, uAccent: hex(look.rim), uBg: hex(look.bg) };
}

/** UX Pro's pass rule on QE's five patches: a patch is dark below luma 24; pass needs <= 2 dark. */
export const UXPRO_DARK_LUM = 24;
export const UXPRO_MAX_DARK = 2;

export function fivePatchSummary(patches: { lum: number; sd: number }[]): { dark: number; lums: number[]; median: number; text: string } {
  const lums = patches.map((p) => Math.round(p.lum));
  const dark = patches.filter((p) => p.lum < UXPRO_DARK_LUM).length;
  const median = [...lums].sort((a, b) => a - b)[2]!;
  return { dark, lums, median, text: `five-patch lumas ${lums.join("/")} (${dark}/5 below ${UXPRO_DARK_LUM}, median ${median})` };
}

/**
 * Where QE's headed harness takes fivePatchSample in the real app: the scene region
 * (x 0, y 111, 968 x 660) of the 1280 x 800 window (UX Pro's 6b172413 shots, `shot.region`),
 * so its "centre" sits below and left of the canvas centre. The 128 px smoke draw spans the
 * whole 16:10 canvas (pack-sky-host-camera-test-helper), so a canvas fraction maps straight
 * onto it. Patches are 3 x 3 px here (~30 app px; QE uses 6 x 6 app px).
 */
export const APP_QE_REGION = { x: 0, y: 111, w: 968, h: 660, viewW: 1280, viewH: 800 } as const;

export function appFivePatches(luma: readonly number[], size = 128): { lum: number; sd: number }[] {
  expect(luma.length, "render with { keepLuma: true }").toBe(size * size);
  const r = APP_QE_REGION;
  const out: { lum: number; sd: number }[] = [];
  for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
    const cx = Math.floor(((r.x + r.w * fx) / r.viewW) * size);
    const cy = Math.floor(((r.y + r.h * fy) / r.viewH) * size);
    const vals: number[] = [];
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) vals.push(luma[(size - 1 - y) * size + x]!);
    }
    const m = vals.reduce((a, v) => a + v, 0) / vals.length;
    out.push({ lum: m, sd: Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length) });
  }
  return out;
}

/** Append a row's measured numbers to `$PLUGIN_SKY_PNG_DIR/rows.txt` (visible runs only; no-op otherwise). */
export function noteRowNumbers(row: string, text: string): void {
  const dir = process.env.PLUGIN_SKY_PNG_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, "rows.txt"), `${row}: ${text}\n`);
}
