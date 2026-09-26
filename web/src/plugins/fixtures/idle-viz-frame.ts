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

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAILED_DEMO_TALKERS_SCRATCH: VizTalkerSample[] = [];

/** Deterministic per-talker failed ratios for failure-demo fixtures/tests only. */
export function demoTalkersWithFailed(t: number, seed = IDLE_VIZ_DEMO_SEED): VizTalkerSample[] {
  const rnd = mulberry32(seed + Math.floor(t) * 997);
  const sysFailed = 0.55 + rnd() * 0.25;
  FAILED_DEMO_TALKERS_SCRATCH.length = 0;
  for (let i = 0; i < DEMO_TALKERS.length; i++) {
    const talker = DEMO_TALKERS[i]!;
    if (talker.role === "gateway") {
      FAILED_DEMO_TALKERS_SCRATCH.push(talker);
      continue;
    }
    const aligned = i === 0;
    const peer = i === 3 && rnd() > 0.4;
    const failed = aligned || peer ? Math.min(1, sysFailed * (0.85 + rnd() * 0.2)) : undefined;
    FAILED_DEMO_TALKERS_SCRATCH.push(failed !== undefined ? { ...talker, failed } : talker);
  }
  return FAILED_DEMO_TALKERS_SCRATCH;
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
    talkers: DEMO_TALKERS as VizTalkerSample[],
    links: DEMO_LINKS as VizLinkSample[],
    headlines: DEMO_HEADLINES as VizHeadline[],
    sys: EMPTY_SYS_TELEMETRY,
  };
}

/** Failure demo variant — use in tests/fixtures only, not the default idle feed. */
export function buildIdleVizFrameFailed(t: number, dt = 0, seed = IDLE_VIZ_DEMO_SEED): VizDataFrame {
  const base = buildIdleVizFrame(t, dt);
  return {
    ...base,
    talkers: demoTalkersWithFailed(t, seed),
    sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.6 },
  };
}
