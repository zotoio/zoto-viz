import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BLOB_MESH_HOST_SPAN,
  BLOB_MESH_SKY_LIFT,
  BLOB_MESH_SKY_TILT,
  BLOB_MESH_SLOT_TO_UV,
  BLOB_MESH_SPREAD,
  BLOB_MESH_SPREAD_MARGIN,
  blobMeshVisibleRegion,
} from "../../../plugins/sdk/blob-mesh-budget";
import { appLensSkySpan } from "./pack-sky-host-camera-test-helper";
import { lanFrames35s } from "./pack-sky-lan-frame-test-helper";
import { runPackFrameHandler } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

/**
 * Blob Mesh placement rows (#174 follow-up): every drawn blob stays where the default camera can
 * see it, the angle comes from the whole id (not its first character), and a device's place
 * depends on its id and t only (not its slot, its rank or the other devices).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SKY = readFileSync(path.resolve(here, "../../../plugins/src/blob-mesh/sky/fragment.glsl"), "utf8");
const SPAN = appLensSkySpan();
/** Fine sweep for the margin and spacing rows: every 0.5 s from 0 to 60 s. */
const FINE = Array.from({ length: 121 }, (_, i) => i * 0.5);
/**
 * Minimum pairwise centre distance (uv) on LAN7 and LAN11, 7 drawn, across FINE. The spread
 * achieves 0.032 there (172.30.0.22 and .23 at t = 47 s; homes are independent hashes, so the
 * closest pair is luck of the ids, and the shared drift keeps pair distances except for the
 * 2 x 0.015 wobble). 0.03 keeps a small margin under that. The old 0.18 uv knot reached 0.002,
 * and a first-character angle stacks the 172.x devices at 0.
 */
const MIN_PAIR_UV = 0.03;

const talker = (id: string, rate: number, role = "lan") => ({ id, rate, role });
const frameOf = (talkers: VizDataFrame["talkers"], t = 35): VizDataFrame => ({ t, dt: 1 / 6, audio: 0, packets: [], rf: [], talkers, headlines: [] });
const LAN7 = lanFrames35s({ fixture: "host" }, 2)[0]!;
const LAN11 = lanFrames35s({ fixture: "host" }, 2, 1, 6, 11)[0]!;
const SINGLE = frameOf([talker("172.30.0.10", 300)]);
const PAIR = frameOf([talker("172.30.0.10", 400), talker("172.30.0.31", 1)]);
const TRIPLE = frameOf([talker("172.30.0.10", 120), talker("172.30.0.11", 60), talker("172.30.0.12", 2)]);

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

function hostSlot0(frame: VizDataFrame): number[] {
  let slot0: number[] = [];
  runPackFrameHandler("blob-mesh", frame, {
    writeBuffer: (slot, data) => { if (slot === 0) slot0 = Array.from(data); },
    writeUniform: () => {},
    writeParticles: () => {},
  });
  return slot0;
}
function packSlot0Of(frame: VizDataFrame): number[] {
  packSlot0 = [];
  packOnFrame!(frame);
  return packSlot0;
}
const writers = [["host mirror", hostSlot0], ["pack frontend", packSlot0Of]] as const;

/** Per drawn device (slot order): id -> slot xy. */
function placements(frame: VizDataFrame, slotsOf: (f: VizDataFrame) => number[]): Map<string, [number, number]> {
  const slot0 = slotsOf(frame);
  const byRate = frame.talkers.map((t, i) => ({ t, i })).sort((a, b) => (b.t.rate - a.t.rate) || a.i - b.i);
  const shown = byRate.slice(0, slot0.length / 4).map((x) => x.i).sort((a, b) => a - b);
  return new Map(shown.map((ti, j) => [frame.talkers[ti]!.id, [slot0[j * 4]!, slot0[j * 4 + 1]!] as [number, number]]));
}

/** A disc of radius m (uv) around slot xy stays on screen: worst |screen| over 16 rim points and the centre. */
function discOnScreen(x: number, y: number, m: number): { ok: boolean; worst: number } {
  let ok = true;
  let worst = 0;
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    const r = k === 16 ? 0 : m;
    const s = onScreen(x + (r * Math.cos(a)) / 1.7, y + (r * Math.sin(a)) / 1.7);
    ok &&= s.ok;
    worst = Math.max(worst, Math.abs(s.sx), Math.abs(s.sy));
  }
  return { ok, worst };
}

/**
 * Independent of the SDK: invert the shader's plane map (uv = dir.xz / (0.35 + |dir.y|), tilt 45)
 * for a slot xy, back to the camera ray, and test it against the host lens (appLensSkySpan, from
 * graph/lens-fov.ts at 1280 x 800).
 */
function onScreen(x: number, y: number): { ok: boolean; sx: number; sy: number } {
  const u = x * 1.7;
  const v = y * 1.7;
  const L = 0.35;
  const T = Math.SQRT1_2;
  const q = u * u + v * v;
  const dy = (2 * q * L - Math.sqrt(4 * q * q * L * L - 4 * (q + 1) * (q * L * L - 1))) / (2 * (q + 1));
  const dx = u * (L - dy);
  const dz = v * (L - dy);
  const cy = (dy - dz) / (2 * T);
  const cz = (dy + dz) / (2 * T);
  const sx = dx / -cz;
  const sy = cy / -cz;
  return { ok: cz < 0 && Math.abs(sx) <= SPAN[0] && Math.abs(sy) <= SPAN[1], sx: sx / SPAN[0], sy: sy / SPAN[1] };
}

describe("blob-mesh placement: on screen, whole-id angle, stable per device", () => {
  it("the writer's visible region comes from the shader's plane map and the host lens", () => {
    expect(SKY).toContain(`${BLOB_MESH_SKY_TILT} * (cam.y + cam.z)`);
    expect(SKY).toContain(`${BLOB_MESH_SKY_TILT} * (cam.z - cam.y)`);
    expect(SKY).toContain(`(${BLOB_MESH_SKY_LIFT} + abs(dir.y))`);
    expect(SKY).toContain(`b.xy * ${BLOB_MESH_SLOT_TO_UV}`);
    expect(BLOB_MESH_HOST_SPAN[0]).toBeCloseTo(SPAN[0], 9);
    expect(BLOB_MESH_HOST_SPAN[1]).toBeCloseTo(SPAN[1], 9);
    const v = blobMeshVisibleRegion();
    expect(v.cx).toBeCloseTo(0, 9);
    expect(v.cy).toBeCloseTo(-0.669, 3);
    expect(v.half).toBeCloseTo(0.352, 3);
    expect(onScreen(v.cx / 1.7, v.cy / 1.7).ok).toBe(true);
    expect(onScreen(0, 0.3).ok, "the upper half of the plane is off screen").toBe(false);
  });

  for (const [who, slotsOf] of writers) {
    for (const [name, frame, drawn] of [["LAN7", LAN7, 7], ["LAN11", LAN11, 7], ["SINGLE", SINGLE, 1], ["PAIR", PAIR, 2], ["TRIPLE", TRIPLE, 3]] as const) {
      it(`${who}: ${name} keeps all ${drawn} drawn blob centres, with a ${BLOB_MESH_SPREAD_MARGIN.toFixed(3)} uv margin, inside the default camera's view every 0.5 s, 0-60 s`, () => {
        let worst = 0;
        let worstCentre = 0;
        for (const t of FINE) {
          const slot0 = slotsOf({ ...frame, t });
          expect(slot0.length / 4).toBe(drawn);
          for (let j = 0; j < slot0.length; j += 4) {
            const s = onScreen(slot0[j]!, slot0[j + 1]!);
            const d = discOnScreen(slot0[j]!, slot0[j + 1]!, BLOB_MESH_SPREAD_MARGIN);
            worst = Math.max(worst, d.worst);
            worstCentre = Math.max(worstCentre, Math.abs(s.sx), Math.abs(s.sy));
            expect(s.ok, `t=${t} slot ${j / 4} xy=(${slot0[j]!.toFixed(3)}, ${slot0[j + 1]!.toFixed(3)}) screen=(${s.sx.toFixed(2)}, ${s.sy.toFixed(2)})`).toBe(true);
            expect(d.ok, `t=${t} slot ${j / 4}: margin disc reaches |screen| ${d.worst.toFixed(2)}`).toBe(true);
          }
        }
        if (who === "host mirror") process.stdout.write(`[in-view] ${name}: worst centre |screen| ${worstCentre.toFixed(2)}, worst margin-rim |screen| ${worst.toFixed(2)} of the half-frame\n`);
      });
    }
  }

  it("the spread ellipse is safe: every point keeps its margin disc on screen (independent map), and it is wider than the old 0.18 knot", () => {
    const { cx, cy, ax, ay } = BLOB_MESH_SPREAD;
    expect(BLOB_MESH_SPREAD_MARGIN).toBeCloseTo(0.168, 12);
    let worst = 0;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * 2 * Math.PI;
      const d = discOnScreen((cx + ax * Math.cos(a)) / 1.7, (cy + ay * Math.sin(a)) / 1.7, BLOB_MESH_SPREAD_MARGIN);
      worst = Math.max(worst, d.worst);
      expect(d.ok, `ellipse point ${k}`).toBe(true);
    }
    process.stdout.write(`[spread] ellipse centre (${cx}, ${cy}) semi-axes ${ax} x ${ay}, margin ${BLOB_MESH_SPREAD_MARGIN.toFixed(3)}: worst rim |screen| ${worst.toFixed(3)}\n`);
    expect(Math.min(ax, ay)).toBeGreaterThan(0.18);
  });

  for (const [who, slotsOf] of writers) {
    for (const [name, frame] of [["LAN7", LAN7], ["LAN11", LAN11]] as const) {
      it(`${who}: ${name} keeps every pair of its 7 drawn blob centres >= ${MIN_PAIR_UV} uv apart, every 0.5 s from 0 to 60 s`, () => {
        let min = Infinity;
        let at = "";
        let meanSum = 0;
        let pairs = 0;
        let reach = 0;
        const v = blobMeshVisibleRegion();
        for (const t of FINE) {
          const slot0 = slotsOf({ ...frame, t });
          expect(slot0.length / 4).toBe(7);
          const p = Array.from({ length: 7 }, (_, j) => [slot0[j * 4]! * 1.7, slot0[j * 4 + 1]! * 1.7] as const);
          for (let i = 0; i < 7; i++) {
            reach = Math.max(reach, Math.hypot(p[i]![0] - v.cx, p[i]![1] - v.cy));
            for (let j = i + 1; j < 7; j++) {
              const d = Math.hypot(p[i]![0] - p[j]![0], p[i]![1] - p[j]![1]);
              meanSum += d;
              pairs++;
              if (d < min) { min = d; at = `t=${t} slots ${i}/${j}`; }
            }
          }
        }
        const text = `${name}: min pair ${min.toFixed(4)} uv at ${at}, mean pair ${(meanSum / pairs).toFixed(3)}, farthest from view centre ${reach.toFixed(3)}`;
        if (who === "host mirror") process.stdout.write(`[spacing] ${text}\n`);
        expect(min, text).toBeGreaterThanOrEqual(MIN_PAIR_UV);
      });
    }
  }

  it("distinct IPs that share a first character get distinct angles and places", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `192.168.${i % 4}.${10 + i}`);
    const v = blobMeshVisibleRegion();
    const seen = ids.map((id) => {
      const [x, y] = placements(frameOf([talker(id, 300)], 0), hostSlot0).get(id)!;
      return { id, x, y, ang: Math.atan2(y * 1.7 - v.cy, x * 1.7 - v.cx) };
    });
    for (let a = 0; a < seen.length; a++) {
      for (let b = a + 1; b < seen.length; b++) {
        const A = seen[a]!;
        const B = seen[b]!;
        expect(Math.abs(A.ang - B.ang) + Math.hypot(A.x - B.x, A.y - B.y), `${A.id} vs ${B.id}`).toBeGreaterThan(1e-6);
      }
    }
    const angles = new Set(seen.map((s) => s.ang.toFixed(4)));
    expect(angles.size, "24 distinct angles").toBe(24);
  });

  for (const [who, slotsOf] of writers) {
    it(`${who}: a device's place at a fixed t depends only on its id (same frame twice, reordered, one dropped, two added)`, () => {
      const base = placements(LAN7, slotsOf);
      expect(placements(LAN7, slotsOf)).toEqual(base);
      const variants: [string, VizDataFrame][] = [
        ["reversed", { ...LAN7, talkers: [...LAN7.talkers].reverse() }],
        ["dropped 172.30.0.22", { ...LAN7, talkers: LAN7.talkers.filter((d) => d.id !== "172.30.0.22") }],
        ["added two", { ...LAN7, talkers: [talker("172.30.0.40", 300), ...LAN7.talkers, talker("172.30.0.41", 90)] }],
      ];
      for (const [what, frame] of variants) {
        const got = placements(frame, slotsOf);
        let common = 0;
        for (const [id, xy] of got) {
          if (!base.has(id)) continue;
          common++;
          expect(xy, `${what}: ${id}`).toEqual(base.get(id));
        }
        expect(common, what).toBeGreaterThanOrEqual(5);
      }
    });
  }
});
