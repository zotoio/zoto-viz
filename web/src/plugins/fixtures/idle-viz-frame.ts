import type {
  VizDataFrame,
  VizHeadline,
  VizLinkSample,
  VizPacketSample,
  VizRfBeacon,
  VizTalkerSample,
} from "../viz-host";
import { EMPTY_SYS_TELEMETRY, VIZ_CONTRACT_VERSION } from "../viz-host";

/** Pinned seed for CI / failure-demo determinism. */
export const IDLE_VIZ_DEMO_SEED = 0x7a0707;

/** Pinned sys.failed for idle-failed fixture (0.6 → 2 failed units in HUD copy). */
export const IDLE_VIZ_FAILED_SYS = 0.6;

/** Pinned peak talker TCP failure ratio for idle-failed fixture. */
export const IDLE_VIZ_FAILED_TCP = 0.6;

/** Pre-built demo slices — reused every tick (no per-frame allocation). */
const DEMO_PACKETS: readonly VizPacketSample[] = [
  { proto: "tcp", size: 480, field: 0.62 },
  { proto: "udp", size: 96, field: 0.38 },
  { proto: "dns", size: 64, field: 0.28 },
  { proto: "tls", size: 820, field: 0.71 },
];

const DEMO_RF: readonly VizRfBeacon[] = [
  { ssid: "zoto-demo", rssi: 0.55, channel: 36 },
  { ssid: "guest-wifi", rssi: 0.42, channel: 6 },
];

const DEMO_TALKERS: readonly VizTalkerSample[] = [
  { id: "10.0.0.42", rate: 120, role: "lan" },
  { id: "10.0.0.1", rate: 88, role: "gateway" },
  { id: "8.8.8.8", rate: 64, role: "internet" },
  { id: "10.0.0.17", rate: 40, role: "lan" },
];

const DEMO_LINKS: readonly VizLinkSample[] = [
  { src: "10.0.0.42", dst: "10.0.0.1", rate: 72 },
  { src: "10.0.0.1", dst: "8.8.8.8", rate: 58 },
  { src: "10.0.0.42", dst: "8.8.8.8", rate: 44 },
  { src: "10.0.0.17", dst: "10.0.0.1", rate: 22 },
  { src: "10.0.0.17", dst: "10.0.0.42", rate: 12 },
];

const DEMO_HEADLINES: readonly VizHeadline[] = [
  { id: "demo:0", label: "Demo", text: "Zoto viz idle seed", kind: "demo" },
  { id: "demo:1", label: "Demo", text: "Live traffic wins when present", kind: "demo" },
];

const PINNED_FAILED_TALKERS: readonly VizTalkerSample[] = [
  { id: "10.0.0.42", rate: 120, role: "lan", failed: IDLE_VIZ_FAILED_TCP },
  { id: "10.0.0.1", rate: 88, role: "gateway" },
  { id: "8.8.8.8", rate: 64, role: "internet" },
  { id: "10.0.0.17", rate: 40, role: "lan" },
];

/** Deterministic per-talker failed ratios for failure-demo fixtures/tests only. */
export function demoTalkersWithFailed(): VizTalkerSample[] {
  return PINNED_FAILED_TALKERS.map((t) => ({ ...t }));
}

/**
 * Shared host demo VizDataFrame — modest counts, no allocation storms.
 * Live monitor slices always win when non-empty; this is fallback only.
 * Default idle is healthy (no faked `sys.failed` or `talkers[].failed`).
 */
export function buildIdleVizFrame(t: number, dt = 0): VizDataFrame {
  const phase = t * 0.45;
  return {
    contract: VIZ_CONTRACT_VERSION,
    t,
    dt,
    audio: 0.12 + 0.04 * Math.sin(phase),
    packets: DEMO_PACKETS as VizPacketSample[],
    rf: DEMO_RF as VizRfBeacon[],
    talkers: DEMO_TALKERS.slice(),
    links: DEMO_LINKS.slice(),
    headlines: DEMO_HEADLINES as VizHeadline[],
    sys: EMPTY_SYS_TELEMETRY,
  };
}

/** Failure demo variant — use in tests/fixtures only, not the default idle feed. */
export function buildIdleVizFrameFailed(t: number, dt = 0): VizDataFrame {
  const base = buildIdleVizFrame(t, dt);
  base.talkers = PINNED_FAILED_TALKERS.slice();
  base.sys = { ...EMPTY_SYS_TELEMETRY, failed: IDLE_VIZ_FAILED_SYS };
  return base;
}

/** Expected HUD DEGRADED copy for {@link buildIdleVizFrameFailed} (strip + stage pill). */
export function idleVizFrameFailedBadgeText(): string {
  const tcpPct = Math.round(IDLE_VIZ_FAILED_TCP * 100);
  const units = Math.max(1, Math.round(IDLE_VIZ_FAILED_SYS * 4));
  return `⚠ DEGRADED ${tcpPct}% TCP · ${units} units`;
}
