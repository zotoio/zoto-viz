/**
 * Viz frame contract for marble-run (mirrors plugins/sdk/viz-contract.ts from PR #26).
 * Type-only surface for packs — do not import web/src/plugins/viz-host.
 */

export const VIZ_CONTRACT_VERSION = 1;

export interface VizPacketSample {
  proto: string;
  size: number;
  field: number;
}

export interface VizRfBeacon {
  ssid: string;
  rssi: number;
  channel: number;
}

export interface VizTalkerSample {
  id: string;
  rate: number;
  role: string;
}

export interface VizHeadline {
  id: string;
  label: string;
  text: string;
  kind?: string;
  summary?: string;
  image?: string;
}

export interface VizSysTelemetry {
  cpu: number;
  mem: number;
  disk: number;
  gpu: number;
  temp: number;
  watts: number;
  psi: number;
  sockets: number;
  failed: number;
  udev: number;
}

export interface VizDataFrame {
  t: number;
  dt: number;
  audio: number;
  packets: VizPacketSample[];
  rf: VizRfBeacon[];
  talkers: VizTalkerSample[];
  headlines: VizHeadline[];
  demo?: boolean;
  demoSlices?: Partial<Record<"packets" | "rf" | "talkers" | "headlines", true>>;
  sys?: VizSysTelemetry;
  spectrum?: number[];
}

export const EMPTY_SYS_TELEMETRY: VizSysTelemetry = {
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
