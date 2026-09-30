/** Ant Colony — cutaway formicarium driven by viz frames and config.read options. */

import { parseAntColonyLook, type AntColonyLook } from "./config";
import {
  AntColonySim,
  SLOT_ANTS,
  SLOT_CHAMBERS,
  SLOT_META,
  SLOT_PHERO_A,
  SLOT_PHERO_B,
  SLOT_PHERO_C,
  SLOT_PHERO_D,
  SLOT_TUNNELS,
  createColony,
} from "./colony";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";

const host = getVizZoto();

let look: AntColonyLook = parseAntColonyLook();
let colony: AntColonySim | null = null;
let warmFrames = 0;

function paletteAccent(p: AntColonyLook["palette"]): [number, number, number] {
  if (p === "clay") return [0.92, 0.42, 0.28];
  if (p === "chalk") return [0.35, 0.82, 0.78];
  if (p === "mono") return [0.78, 0.78, 0.82];
  return [0.86, 0.62, 0.32];
}

function paletteBg(p: AntColonyLook["palette"]): [number, number, number] {
  if (p === "chalk") return [0.04, 0.06, 0.1];
  if (p === "mono") return [0.05, 0.05, 0.06];
  return [0.07, 0.05, 0.03];
}

function bindColony(next: AntColonyLook): void {
  look = next;
  colony?.dispose();
  colony = createColony(look);
  warmFrames = 0;
}

function boot(): void {
  look = parseAntColonyLook(host.getConfig?.());
  if (!colony) colony = createColony(look);
}

// The light tests import this module with no host (for cycleColonyTeardown and the re-exports), so
// getVizZoto() can be undefined here; only bind the handlers when the sandbox host is present.
if (host) {
  host.onConfig = (cfg) => {
    bindColony(parseAntColonyLook(cfg));
  };

  host.onFrame = (frame: VizDataFrame) => {
  if (!colony) boot();
  if (!colony) colony = createColony(look);
  colony.setLook(look);
  colony.tick(frame);
  if (warmFrames++ > 4) colony.markWarm();

  const slots = colony.packSlots(frame);
  host.writeBuffer(SLOT_META, slots[0]!);
  host.writeBuffer(SLOT_CHAMBERS, slots[1]!);
  host.writeBuffer(SLOT_TUNNELS, slots[2]!);
  host.writeBuffer(SLOT_PHERO_A, slots[3]!);
  host.writeBuffer(SLOT_PHERO_B, slots[4]!);
  host.writeBuffer(SLOT_PHERO_C, slots[5]!);
  host.writeBuffer(SLOT_PHERO_D, slots[6]!);
  host.writeBuffer(SLOT_ANTS, slots[7]!);

  const fail = frame.sys?.failed ?? 0;
  const accent = fail > 0.05 && look.mapFailures
    ? [1.0, 0.2, 0.33] as [number, number, number]
    : paletteAccent(look.palette);

  host.writeUniform("uBright", 0.72 + frame.audio * 0.28);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", accent);
  host.writeUniform("uBg", paletteBg(look.palette));
  host.writeUniform("uOpacity", look.preset === "minimal" ? 0.92 : 1);
  };
}

/** Drop the colony (was the onTeardown hook, which the host never calls). */
export function antColonyTeardown(): void {
  colony?.dispose();
  colony = null;
}

/** Host-less teardown harness (light tests). */
export function cycleColonyTeardown(times = 20): void {
  for (let i = 0; i < times; i++) {
    const c = createColony(look);
    c.tick({
      t: i * 0.1,
      dt: 1 / 60,
      audio: 0.1,
      packets: [{ proto: "tcp", size: 120, field: 0.4 }],
      talkers: [{ id: "a", rate: 80, role: "lan" }],
      rf: [],
      headlines: [],
      sys: { cpu: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, failed: 0, udev: 0 },
    });
    c.packSlots({
      t: i * 0.1,
      dt: 1 / 60,
      audio: 0.1,
      packets: [],
      talkers: [],
      rf: [],
      headlines: [],
    });
    c.dispose();
  }
}

export { parseAntColonyLook, ANT_DATA_MAPPING, ANT_WORK_BUDGET } from "./config";
export { AntColonySim, createColony, PG_CELLS, NEST_ENTRANCE, type ChamberSnapshot } from "./colony";
