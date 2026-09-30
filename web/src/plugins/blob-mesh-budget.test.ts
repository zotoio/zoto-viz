import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BLOB_MESH_FLOOR,
  BLOB_MESH_GROWTH,
  BLOB_MESH_MAX_BLOBS,
  BLOB_MESH_SLOT_BUDGET,
} from "../../../plugins/sdk/blob-mesh-budget";
import { runPackFrameHandler } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

/**
 * #174 coverage budget rows (unit: slot data only, no render). Both writers feed slot 0:
 * the host mirror (runPackFrameHandler "blob-mesh", what the app draws) and the pack frontend.
 * Radii are the z of each (x, y, r, hue) quad.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SKY = readFileSync(path.resolve(here, "../../../plugins/src/blob-mesh/sky/fragment.glsl"), "utf8");

const EPS = 1e-9;
const talker = (ip: string, rate: number, role = "lan") => ({ id: ip, rate, role });
const frameOf = (talkers: VizDataFrame["talkers"], t = 35): VizDataFrame => ({
  t, dt: 1 / 6, audio: 0, packets: [], rf: [], talkers, headlines: [],
});

/** Live demo LAN (7 devices, 420 pkt/s), from #174's budget scan. */
const LAN7 = frameOf([
  talker("172.30.0.10", 125), talker("172.30.0.1", 100, "gateway"), talker("172.30.0.21", 50),
  talker("172.30.0.22", 45), talker("142.250.66.14", 40, "internet"), talker("172.30.0.23", 35),
  talker("104.18.32.7", 25, "internet"),
]);
const EQUAL7 = frameOf(["104.18.32.7", "142.250.66.14", "172.30.0.1", "172.30.0.10", "172.30.0.21", "172.30.0.22", "172.30.0.23"]
  .map((ip) => talker(ip, 60)));
const SINGLE = frameOf([talker("172.30.0.10", 300)]);
const BUSY1_IDLE6 = frameOf([talker("172.30.0.10", 400), ...[1, 2, 3, 4, 5, 6].map((i) => talker(`172.30.0.${30 + i}`, 1))]);
const FRAMES = { LAN7, EQUAL7, SINGLE, BUSY1_IDLE6 } as const;

function radiiOf(slot0: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 2; i < slot0.length; i += 4) out.push(slot0[i]!);
  return out;
}

function hostSlot0(frame: VizDataFrame): number[] {
  let slot0: number[] = [];
  runPackFrameHandler("blob-mesh", frame, {
    writeBuffer: (slot, data) => { if (slot === 0) slot0 = Array.from(data); },
    writeUniform: () => {},
    writeParticles: () => {},
  });
  return slot0;
}

let packOnFrame: ((f: VizDataFrame) => void) | null = null;
let packSlot0: number[] = [];
beforeAll(async () => {
  (globalThis as { zoto?: unknown }).zoto = {
    onTick: null, onConfig: null, onFrame: null,
    writeBuffer: (slot: number, data: number[] | Float32Array) => { if (slot === 0) packSlot0 = Array.from(data); },
    writeUniform: () => {},
    writeParticles: () => {},
  };
  await import("../../../plugins/src/blob-mesh/frontend/index");
  packOnFrame = (globalThis as unknown as { zoto: { onFrame: typeof packOnFrame } }).zoto.onFrame;
});

function packSlot0Of(frame: VizDataFrame): number[] {
  packSlot0 = [];
  packOnFrame!(frame);
  return packSlot0;
}

const writers = [
  ["host mirror", hostSlot0],
  ["pack frontend", packSlot0Of],
] as const;

describe("blob-mesh coverage budget (#174)", () => {
  it("the sky's minimum radius is the writers' floor (0.12, #174 option 1)", () => {
    expect(BLOB_MESH_FLOOR).toBe(0.12);
    const m = SKY.match(/float rad = max\(([0-9.]+), b\.z\)/);
    expect(m, "sky/fragment.glsl floors rad with max(<floor>, b.z)").not.toBeNull();
    expect(Number(m![1])).toBe(BLOB_MESH_FLOOR);
  });

  it("empty slots draw no idle blob once a device is written (#174 option 3)", () => {
    expect(SKY).toMatch(/live = max\(live, step\(0\.001, zotoVizSlots\[i\]\.z\)\)/);
    expect(SKY).toMatch(/float drawn = max\(step\(0\.001, b\.z\), 1\.0 - live\);/);
    expect(SKY).toMatch(/float rad = max\([0-9.]+, b\.z\) \* drawn;/);
  });

  for (const [who, slotsOf] of writers) {
    for (const [name, frame] of Object.entries(FRAMES)) {
      it(`${who}: ${name} keeps sum r^2 over drawn blobs within the slot budget`, () => {
        const radii = radiiOf(slotsOf(frame));
        expect(radii.length).toBe(Math.min(BLOB_MESH_MAX_BLOBS, frame.talkers.length));
        const sumR2 = radii.reduce((s, r) => s + r * r, 0);
        expect(sumR2, `${name} radii=${radii.map((r) => r.toFixed(3)).join(",")}`).toBeLessThanOrEqual(BLOB_MESH_SLOT_BUDGET + EPS);
      });

      it(`${who}: ${name} never writes a radius below the floor (minimum applied before scaling)`, () => {
        const radii = radiiOf(slotsOf(frame));
        for (const r of radii) expect(r, `${name} radii=${radii.map((v) => v.toFixed(3)).join(",")}`).toBeGreaterThanOrEqual(BLOB_MESH_FLOOR - EPS);
      });
    }

    it(`${who}: on the live LAN the busiest device is the largest blob and radius follows rate`, () => {
      const radii = radiiOf(slotsOf(LAN7));
      const rates = LAN7.talkers.map((t) => t.rate);
      for (let i = 1; i < radii.length; i++) {
        if (rates[i]! < rates[i - 1]!) expect(radii[i]!, `radii=${radii.map((r) => r.toFixed(4)).join(",")}`).toBeLessThan(radii[i - 1]!);
      }
      expect(radii[0]).toBe(Math.max(...radii));
    });

    it(`${who}: one busy device alone grows the full ${BLOB_MESH_GROWTH} above the floor (budget not binding)`, () => {
      const [r] = radiiOf(slotsOf(SINGLE));
      expect(r).toBeCloseTo(BLOB_MESH_FLOOR + BLOB_MESH_GROWTH, 9);
    });
  }

  it("host mirror and pack frontend write identical slot 0 on every frame", () => {
    for (const [name, frame] of Object.entries(FRAMES)) {
      expect(packSlot0Of(frame), name).toEqual(hostSlot0(frame));
    }
  });
});
