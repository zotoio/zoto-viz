/**
 * Real `viz.read` frame contract for pack frontends.
 * Keep aligned with `web/src/plugins/viz-host.ts` (`VizDataFrame` and nested types).
 *
 * Talkers: `{ id, rate, role }` only (role may be `gateway`). No per-talker failure.
 * Packets: `{ proto, size, field }` only — field is size normalised 0..1; no host/src/dst.
 * Failures: scene-wide via `sys.failed` only (not per-region, not from headlines or packet field).
 */

export interface VizPacketSample {
  proto: string;
  size: number;
  field: number;
}

export interface VizTalkerSample {
  id: string;
  rate: number;
  role: string;
}

export interface VizRfBeacon {
  ssid: string;
  rssi: number;
  channel: number;
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
  /** Machine-wide failure gauge 0..1 — only source for failure visuals. */
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
