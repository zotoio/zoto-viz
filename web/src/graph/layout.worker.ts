/** Worker entry for the force layout: one `LayoutSim`, driven by messages from `LayoutClient`. */

import { LayoutSim, type LayoutIn, type LayoutOut } from "./layout-core";
import { loadWasmKernel } from "./layout-wasm";

const sim = new LayoutSim();
const post = (m: LayoutOut, transfer?: Transferable[]): void => {
  (self as unknown as Worker).postMessage(m, transfer ?? []);
};

void loadWasmKernel().then((k) => {
  if (k) sim.useKernel(k);
  post({ type: "kernel", kind: sim.kernelKind });
});

self.onmessage = (ev: MessageEvent<LayoutIn>) => {
  const m = ev.data;
  switch (m.type) {
    case "structure":
      sim.setStructure(m);
      break;
    case "params":
      sim.setParams(m.params);
      break;
    case "frame": {
      const out = sim.frame(m);
      post(out, [out.pos.buffer]);
      break;
    }
    case "kernel":
      if (m.kind === "js") sim.useKernel(null);
      else void loadWasmKernel().then((k) => { if (k) sim.useKernel(k); post({ type: "kernel", kind: sim.kernelKind }); });
      break;
  }
};
