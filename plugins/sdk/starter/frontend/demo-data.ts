import type { VizDataFrame } from "../../../sdk/viz-contract";

/** Shipped demo frame so screenshots never depend on live capture. */
export const STARTER_DEMO_FRAME: VizDataFrame = {
  t: 42,
  dt: 1 / 60,
  audio: 0.15,
  packets: [
    { proto: "TCP", size: 120, field: 0.4 },
    { proto: "UDP", size: 64, field: 0.25 },
  ],
  rf: [{ ssid: "demo-ap", rssi: 0.6, channel: 36 }],
  talkers: [
    { id: "10.0.0.1", rate: 140, role: "gateway" },
    { id: "10.0.0.2", rate: 90, role: "lan" },
    { id: "8.8.8.8", rate: 60, role: "internet" },
  ],
  headlines: [
    { id: "demo:0", label: "demo", text: "Starter pack demo headline", kind: "demo" },
  ],
  demo: true,
  sys: {
    cpu: 0.2,
    mem: 0.3,
    disk: 0.1,
    gpu: 0,
    temp: 0.2,
    watts: 0.1,
    psi: 0,
    sockets: 0.2,
    failed: 0,
    udev: 0,
  },
};
