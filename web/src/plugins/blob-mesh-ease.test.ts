/**
 * Blob Mesh radii ease toward the plan. Rates arrive about once a second, so drawing the plan
 * radius as-is made every blob snap to a new size once a second and stand still in between: the
 * pane's picture-change badge read 0 fps for seconds at a time and the view looked frozen.
 */
import { describe, expect, it } from "vitest";
import {
  BLOB_MESH_PAIR_REACH,
  BLOB_MESH_RADIUS_EASE_MAX_GAP_S,
  BLOB_MESH_SITES,
  BLOB_MESH_SLOT_BUDGET,
  packBlobMeshSlots,
  type BlobMeshSiteMap,
} from "../../../plugins/sdk/blob-mesh-budget";
import { runPackFrameHandler, VIZ_PACK_TILE_ID_OPT } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

const talker = (id: string, rate: number, role = "lan") => ({ id, rate, role });
const frameOf = (talkers: VizDataFrame["talkers"], t: number): VizDataFrame => ({ t, dt: 1 / 60, audio: 0, packets: [], rf: [], talkers, headlines: [] });
const QUIET = [talker("10.0.0.1", 40), talker("10.0.0.2", 20), talker("10.0.0.3", 10), talker("10.0.0.4", 5)];
const BUSY = [talker("10.0.0.1", 40), talker("10.0.0.2", 400), talker("10.0.0.3", 10), talker("10.0.0.4", 5)];
const radiusOf = (slot0: number[], j: number) => slot0[j * 4 + 2]!;

function hostSlot0(frame: VizDataFrame, tile: string): number[] {
  let slot0: number[] = [];
  runPackFrameHandler("blob-mesh", frame, {
    writeBuffer: (slot, data) => { if (slot === 0) slot0 = Array.from(data); },
    writeUniform: () => {},
    writeParticles: () => {},
  }, { [VIZ_PACK_TILE_ID_OPT]: tile });
  return slot0;
}

describe("blob mesh radii ease toward the plan", () => {
  it("a rate step glides over about a second instead of snapping on the next frame", () => {
    const sites: BlobMeshSiteMap = new Map();
    const before = radiusOf(packBlobMeshSlots(QUIET, 10, sites).slot0, 1);
    const step = packBlobMeshSlots(BUSY, 10 + 1 / 60, sites);
    const target = step.plan.radii[1]!;
    expect(target - before, "the step is big enough to see").toBeGreaterThan(0.015);
    const moved = (radiusOf(step.slot0, 1) - before) / (target - before);
    expect(moved, "one frame in").toBeGreaterThan(0);
    expect(moved, "one frame in").toBeLessThan(0.1);
    let last = radiusOf(step.slot0, 1);
    for (let f = 2; f <= 60; f++) {
      const r = radiusOf(packBlobMeshSlots(BUSY, 10 + f / 60, sites).slot0, 1);
      expect(r, `frame ${f} keeps growing`).toBeGreaterThan(last);
      last = r;
    }
    expect((target - last) / (target - before), "one second in").toBeLessThan(0.07);
  });

  it("no history, a clock that did not advance, or a long gap draws the plan radius", () => {
    expect(packBlobMeshSlots(BUSY, 10).slot0.filter((_, i) => i % 4 === 2)).toEqual(packBlobMeshSlots(BUSY, 10).plan.radii);
    const sites: BlobMeshSiteMap = new Map();
    packBlobMeshSlots(QUIET, 10, sites);
    const same = packBlobMeshSlots(BUSY, 10, sites);
    expect(same.slot0.filter((_, i) => i % 4 === 2), "same t").toEqual(same.plan.radii);
    packBlobMeshSlots(QUIET, 20, sites);
    const gap = packBlobMeshSlots(BUSY, 20 + BLOB_MESH_RADIUS_EASE_MAX_GAP_S, sites);
    expect(gap.slot0.filter((_, i) => i % 4 === 2), "long gap").toEqual(gap.plan.radii);
  });

  it("every eased frame keeps the coverage budget and the site-holder pair reach", () => {
    const sites: BlobMeshSiteMap = new Map();
    const steps = [QUIET, BUSY, [...BUSY, talker("10.0.0.5", 300), talker("10.0.0.6", 2)], [talker("10.0.0.9", 500)], QUIET];
    let t = 0;
    for (const talkers of steps) {
      for (let f = 0; f < 60; f++, t += 1 / 60) {
        const { slot0, plan } = packBlobMeshSlots(talkers, t, sites);
        const radii = slot0.filter((_, i) => i % 4 === 2);
        expect(radii.reduce((s, r) => s + r * r, 0), `t=${t.toFixed(2)} budget`).toBeLessThanOrEqual(BLOB_MESH_SLOT_BUDGET + 1e-9);
        const holders = plan.shownIdx.map((ti, j) => ({ id: talkers[ti]!.id, r: radii[j]! })).filter((b) => sites.has(b.id));
        if (holders.length > 1 && holders.length <= BLOB_MESH_SITES.length) {
          const two = holders.map((b) => b.r).sort((a, b) => b - a);
          expect(two[0]! + two[1]!, `t=${t.toFixed(2)} pair reach`).toBeLessThanOrEqual(BLOB_MESH_PAIR_REACH + 1e-9);
        }
      }
    }
  });

  it("the host mirror eases per tile exactly like the pack", () => {
    const sites: BlobMeshSiteMap = new Map();
    for (let f = 0; f < 90; f++) {
      const t = 50 + f / 60;
      const talkers = f < 30 ? QUIET : BUSY;
      expect(hostSlot0(frameOf(talkers, t), "ease-mirror"), `frame ${f}`).toEqual(packBlobMeshSlots(talkers, t, sites).slot0);
    }
  });
});
