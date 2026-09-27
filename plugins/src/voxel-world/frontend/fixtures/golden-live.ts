import type { VizDataFrame } from "../viz-frame";

const SYS = {
  cpu: 0.22,
  mem: 0.18,
  disk: 0.12,
  gpu: 0.08,
  temp: 0.35,
  watts: 0.2,
  psi: 0,
  sockets: 0.4,
  failed: 0,
  udev: 0,
};

/** Steady golden-live frame (matches host idle demo shape). */
export function goldenLiveFrame(t: number): VizDataFrame {
  return {
    t,
    dt: 1 / 60,
    audio: 0.14,
    packets: [
      { proto: "tcp", size: 480, field: 0.62 },
      { proto: "udp", size: 96, field: 0.38 },
      { proto: "dns", size: 64, field: 0.28 },
      { proto: "tls", size: 820, field: 0.71 },
    ],
    rf: [],
    talkers: [
      { id: "10.0.0.42", rate: 120, role: "lan" },
      { id: "10.0.0.1", rate: 88, role: "gateway" },
      { id: "8.8.8.8", rate: 64, role: "internet" },
    ],
    headlines: [{ id: "demo:0", label: "Demo", text: "golden live", kind: "demo" }],
    demo: true,
    sys: SYS,
  };
}
