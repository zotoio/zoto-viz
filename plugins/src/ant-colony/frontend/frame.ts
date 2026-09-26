/**
 * Host VizDataFrame slices this pack reads — shapes match
 * `web/src/plugins/viz-host.ts` (no runtime import across the pack boundary).
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

export type AntColonyFrame = {
  t: number;
  dt: number;
  audio: number;
  demo?: boolean;
  packets: VizPacketSample[];
  talkers: VizTalkerSample[];
  sys?: VizSysTelemetry;
};
