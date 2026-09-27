import type {
  VizDataFrame,
  VizHeadline,
  VizPacketSample,
  VizRfBeacon,
  VizTalkerSample,
  VizSysTelemetry,
} from "../../../sdk/viz-contract";

const IDLE_SYS: VizSysTelemetry = {
  cpu: 0,
  mem: 0,
  disk: 0,
  gpu: 0,
  temp: 0,
  watts: 0,
  psi: 0,
  sockets: 0,
  failed: 0,
  udev: 0,
};

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

/** Host idle-shaped demo frame for pack tests (no web fixture import). */
export function buildIdleVizFrame(t: number, dt = 0): VizDataFrame {
  const phase = t * 0.45;
  return {
    t,
    dt,
    audio: 0.12 + 0.04 * Math.sin(phase),
    packets: DEMO_PACKETS as VizPacketSample[],
    rf: DEMO_RF as VizRfBeacon[],
    talkers: DEMO_TALKERS as VizTalkerSample[],
    headlines: DEMO_HEADLINES as VizHeadline[],
    sys: IDLE_SYS,
  };
}
