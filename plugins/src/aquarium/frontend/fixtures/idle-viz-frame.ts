import type {
  VizDataFrame,
  VizHeadline,
  VizPacketSample,
  VizRfBeacon,
  VizTalkerSample,
} from "../../../../sdk/viz-contract";

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
];

const DEMO_HEADLINES: readonly VizHeadline[] = [
  { id: "demo:0", label: "Demo", text: "Zoto viz idle seed", kind: "demo" },
  { id: "demo:1", label: "Demo", text: "Live traffic wins when present", kind: "demo" },
];

/** Host-style idle demo frame for pack tests (no web/src imports). */
export function buildIdleVizFrame(t: number, dt = 0): VizDataFrame {
  const phase = t * 0.45;
  return {
    t,
    dt,
    audio: 0.12 + 0.04 * Math.sin(phase),
    packets: [...DEMO_PACKETS],
    rf: [...DEMO_RF],
    talkers: [...DEMO_TALKERS],
    headlines: [...DEMO_HEADLINES],
    sys: { failed: 0 },
  };
}
