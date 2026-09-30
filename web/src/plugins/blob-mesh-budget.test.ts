import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BLOB_MESH_FLOOR,
  BLOB_MESH_MAX_BLOBS,
  BLOB_MESH_SLOT_BUDGET,
  planBlobMesh,
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
/** The quiet LAN from blob-mesh-sky.test.ts: 5 devices at 0.5 pkt/s. */
const QUIET5 = frameOf(["gateway", "lan", "internet", "lan", "local"].map((role, i) => talker(`192.168.1.${10 + i}`, 0.5, role)));
const EQUAL8 = frameOf(Array.from({ length: 8 }, (_, i) => talker(`172.30.0.${10 + i}`, 60)));
const HALF = frameOf([talker("172.30.0.10", 120), talker("172.30.0.11", 60), talker("172.30.0.12", 2)]);
const LOW_BESIDE_BUSY = frameOf([talker("172.30.0.10", 400), talker("172.30.0.31", 1)]);
const FRAMES = { LAN7, EQUAL7, SINGLE, BUSY1_IDLE6, QUIET5, EQUAL8, HALF, LOW_BESIDE_BUSY } as const;
/** Devices drawn per frame at budget 0.1152 / floor 0.12. */
const DRAWN: Record<keyof typeof FRAMES, number> = { LAN7: 7, EQUAL7: 7, SINGLE: 1, BUSY1_IDLE6: 7, QUIET5: 5, EQUAL8: 8, HALF: 3, LOW_BESIDE_BUSY: 2 };

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
      it(`${who}: ${name} draws ${DRAWN[name as keyof typeof FRAMES]} devices that use the whole slot budget (sum r^2 = B, never more)`, () => {
        const radii = radiiOf(slotsOf(frame));
        expect(radii.length).toBe(DRAWN[name as keyof typeof FRAMES]);
        const sumR2 = radii.reduce((s, r) => s + r * r, 0);
        const text = `${name} radii=${radii.map((r) => r.toFixed(4)).join(",")} sumR2=${sumR2.toFixed(6)} ratio=${(Math.max(...radii) / Math.min(...radii)).toFixed(3)}`;
        if (who === "host mirror") process.stdout.write(`[radii] ${text}\n`);
        expect(sumR2, text).toBeLessThanOrEqual(BLOB_MESH_SLOT_BUDGET + EPS);
        expect(sumR2, text).toBeGreaterThanOrEqual(BLOB_MESH_SLOT_BUDGET - 1e-6);
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

    it(`${who}: one device alone is one big blob using the whole budget (sqrt(B) = 0.339, no 0.22 cap)`, () => {
      const [r] = radiiOf(slotsOf(SINGLE));
      expect(r).toBeCloseTo(Math.sqrt(BLOB_MESH_SLOT_BUDGET), 9);
    });

    it(`${who}: the quiet LAN (5 x 0.5 pkt/s) shares the whole budget evenly, sqrt(B / 5) = 0.152 each`, () => {
      const radii = radiiOf(slotsOf(QUIET5));
      expect(radii).toHaveLength(5);
      for (const r of radii) expect(r).toBeCloseTo(Math.sqrt(BLOB_MESH_SLOT_BUDGET / 5), 9);
    });

    it(`${who}: size order matches rate order, ties equal (LAN7, BUSY1_IDLE6, shuffled input with ties)`, () => {
      const cases: [string, VizDataFrame][] = [
        ["LAN7", LAN7],
        ["BUSY1_IDLE6", BUSY1_IDLE6],
        ["SHUFFLED_TIES", frameOf([25, 100, 50, 100, 50, 12, 25].map((r, i) => talker(`10.1.0.${i + 2}`, r)))],
      ];
      for (const [name, frame] of cases) {
        const radii = radiiOf(slotsOf(frame));
        const plan = planBlobMesh(frame.talkers.map((t) => t.rate));
        const rates = plan.shownIdx.map((i) => frame.talkers[i]!.rate);
        const text = `${name} rates=${rates.join(",")} radii=${radii.map((r) => r.toFixed(4)).join(",")}`;
        for (let i = 0; i < rates.length; i++) {
          for (let j = 0; j < rates.length; j++) {
            if (rates[i]! === rates[j]!) expect(radii[i]!, text).toBeCloseTo(radii[j]!, 12);
            else if (rates[i]! > rates[j]!) expect(radii[i]!, text).toBeGreaterThan(radii[j]!);
          }
        }
      }
    });
  }

  it("growth reserve only when rates differ: 8 equal devices all fit at the floor; 8 that differ fit 7 (8 would need 0.1296)", () => {
    expect(BLOB_MESH_SLOT_BUDGET).toBeCloseTo(0.1152, 12);
    expect(BLOB_MESH_MAX_BLOBS).toBe(8);
    const equal = planBlobMesh(Array(8).fill(60));
    expect(equal.shownIdx).toHaveLength(8);
    expect(equal.hidden).toBe(0);
    for (const r of equal.radii) expect(r).toBeCloseTo(BLOB_MESH_FLOOR, 12);
    expect(6 * 0.12 ** 2 + (1.4 * 0.12) ** 2).toBeLessThanOrEqual(BLOB_MESH_SLOT_BUDGET);
    expect(7 * 0.12 ** 2 + (1.4 * 0.12) ** 2).toBeGreaterThan(BLOB_MESH_SLOT_BUDGET);
    expect(planBlobMesh([120, 60, 60, 60, 60, 60, 60, 30]).shownIdx).toHaveLength(7);
    expect(planBlobMesh(LAN7.talkers.map((t) => t.rate)).shownIdx).toHaveLength(7);
  });

  for (const [who, slotsOf] of writers) {
    it(`${who}: busiest >= 2x the quietest drawn rate gives a radius >= 1.4x, inside the budget (LAN7, BUSY1_IDLE6, two devices at exactly 2x)`, () => {
      for (const [name, frame] of [["LAN7", LAN7], ["BUSY1_IDLE6", BUSY1_IDLE6], ["PAIR2X", frameOf([talker("172.30.0.10", 90), talker("172.30.0.11", 45)])]] as const) {
        const radii = radiiOf(slotsOf(frame));
        const ratio = Math.max(...radii) / Math.min(...radii);
        const sumR2 = radii.reduce((s, r) => s + r * r, 0);
        const text = `${name} radii=${radii.map((r) => r.toFixed(4)).join(",")} ratio=${ratio.toFixed(4)} sumR2=${sumR2.toFixed(6)}`;
        process.stdout.write(`[contrast] ${who}: ${text}\n`);
        expect(ratio, text).toBeGreaterThanOrEqual(1.4 - EPS);
        expect(sumR2, text).toBeLessThanOrEqual(BLOB_MESH_SLOT_BUDGET + EPS);
      }
    });

    it(`${who}: equal rates stay equal size (EQUAL7)`, () => {
      const radii = radiiOf(slotsOf(EQUAL7));
      for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 12);
    });
  }

  it("contrast holds across a sweep of 2..11 devices with busiest >= 2x quietest drawn, floor and budget kept", () => {
    let checked = 0;
    for (let n = 2; n <= 11; n++) {
      for (const spread of [2, 2.5, 5, 40]) {
        for (const shape of [0.3, 1, 3]) {
          // busiest = spread x quietest drawn; the rest follow a power curve between them
          const rates = Array.from({ length: n }, (_, i) => 10 * (1 + (spread - 1) * (1 - i / (n - 1)) ** shape));
          const plan = planBlobMesh(rates);
          const drawn = plan.shownIdx.map((i) => rates[i]!);
          if (Math.max(...drawn) < 2 * Math.min(...drawn)) continue;
          checked++;
          const text = `n=${n} spread=${spread} shape=${shape} radii=${plan.radii.map((r) => r.toFixed(4)).join(",")}`;
          expect(Math.max(...plan.radii) / Math.min(...plan.radii), text).toBeGreaterThanOrEqual(1.4 - EPS);
          expect(plan.radii.reduce((s, r) => s + r * r, 0), text).toBeLessThanOrEqual(BLOB_MESH_SLOT_BUDGET + EPS);
          expect(Math.min(...plan.radii), text).toBeGreaterThanOrEqual(BLOB_MESH_FLOOR - EPS);
          expect(plan.shownIdx.length, text).toBe(Math.min(7, n));
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("host mirror and pack frontend write identical slot 0 on every frame", () => {
    for (const [name, frame] of Object.entries(FRAMES)) {
      expect(packSlot0Of(frame), name).toEqual(hostSlot0(frame));
    }
  });
});
