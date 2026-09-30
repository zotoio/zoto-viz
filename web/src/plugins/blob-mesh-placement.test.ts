import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BLOB_MESH_DRIFT,
  BLOB_MESH_FLOOR,
  BLOB_MESH_HOST_SPAN,
  BLOB_MESH_SITES,
  BLOB_MESH_SKY_LIFT,
  BLOB_MESH_SKY_TILT,
  BLOB_MESH_SLOT_BUDGET,
  BLOB_MESH_SLOT_TO_UV,
  BLOB_MESH_SPREAD,
  BLOB_MESH_SPREAD_MARGIN,
  blobMeshPlacement,
  blobMeshStartSite,
  blobMeshVisibleRegion,
  packBlobMeshSlots,
  type BlobMeshSiteMap,
} from "../../../plugins/sdk/blob-mesh-budget";
import { appLensSkySpan } from "./pack-sky-host-camera-test-helper";
import { lanFrames35s } from "./pack-sky-lan-frame-test-helper";
import { runPackFrameHandler, VIZ_PACK_TILE_ID_OPT } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

/**
 * Blob Mesh placement rows (#174 follow-up, reworked for #193's lattice): every drawn blob stays
 * where the default camera can see it; the busiest 4 drawn devices hold 4 lattice sites
 * (BLOB_MESH_SITES) through a site map that keeps each holder where it is; a device's start site
 * comes from its whole id (not its first character). Since #193 a place is no longer a function
 * of id and t alone: it depends on the site the device holds, which depends on the history of the
 * busiest set (the site map), so the old "depends only on id" rows are now site-map stability rows.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SKY = readFileSync(path.resolve(here, "../../../plugins/src/blob-mesh/sky/fragment.glsl"), "utf8");
const SPAN = appLensSkySpan();
/** Fine sweep for the margin and spacing rows: every 0.5 s from 0 to 60 s. */
const FINE = Array.from({ length: 121 }, (_, i) => i * 0.5);
/** Neighbour spacing of the lattice (uv): the rhombus side, sqrt(0.37^2 + 0.24^2). */
const SITE_SPACING = Math.min(...BLOB_MESH_SITES.flatMap(([ax, ay], i) => BLOB_MESH_SITES.slice(i + 1).map(([bx, by]) => Math.hypot(ax - bx, ay - by))));

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

/** Host mirror slot 0 on tile `tile` (each tile keeps its own site map; the default tile is "main"). */
function hostSlot0(frame: VizDataFrame, tile = "main"): number[] {
  let slot0: number[] = [];
  runPackFrameHandler("blob-mesh", frame, {
    writeBuffer: (slot, data) => { if (slot === 0) slot0 = Array.from(data); },
    writeUniform: () => {},
    writeParticles: () => {},
  }, { [VIZ_PACK_TILE_ID_OPT]: tile });
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

describe("blob-mesh placement: on screen, lattice sites, stable site map", () => {
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

  /**
   * #193 lattice: the 4 sites plus the shared drift stay inside the safe ellipse (so every drawn
   * centre does: extras sit on a site too), and the neighbour spacing covers the widest merge
   * distance two drawn blobs can need when 7 or 8 are drawn: radii r1 + r2 at most
   * sqrt(2 (budget - 5 floor^2)) (six or more at the floor inside the coverage budget), plus the
   * shader's BLOB_GAP (read from fragment.glsl). The drift is shared, so it never closes a pair.
   */
  it("lattice sites: 4 sites plus the shared drift stay inside the safe ellipse, and their spacing covers r1 + r2 + BLOB_GAP for any two blobs of a 7- or 8-blob frame", () => {
    const { cx, cy, ax, ay } = BLOB_MESH_SPREAD;
    const gapM = /const float BLOB_GAP = ([0-9.]+);/.exec(SKY);
    const gap = Number(gapM?.[1]);
    expect(Number.isFinite(gap) && gap > 0, "BLOB_GAP read from fragment.glsl").toBe(true);
    expect(BLOB_MESH_SITES).toHaveLength(4);
    let worst = 0;
    for (const [x, y] of BLOB_MESH_SITES) {
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * 2 * Math.PI;
        worst = Math.max(worst, Math.hypot((x + BLOB_MESH_DRIFT * Math.cos(a) - cx) / ax, (y + BLOB_MESH_DRIFT * Math.sin(a) - cy) / ay));
      }
    }
    const rSum = Math.sqrt(2 * (BLOB_MESH_SLOT_BUDGET - 5 * BLOB_MESH_FLOOR ** 2));
    const text = `sites ${BLOB_MESH_SITES.map(([x, y]) => `(${x.toFixed(3)}, ${y.toFixed(3)})`).join(" ")}, drift ${BLOB_MESH_DRIFT}: worst ellipse radius ${worst.toFixed(4)} (1 = rim); neighbour spacing ${SITE_SPACING.toFixed(4)} vs widest merge ${rSum.toFixed(4)} + ${gap} = ${(rSum + gap).toFixed(4)}`;
    process.stdout.write(`[sites] ${text}\n`);
    expect(worst, text).toBeLessThanOrEqual(1 + 1e-12);
    expect(SITE_SPACING, text).toBeGreaterThanOrEqual(rSum + gap);
  });

  it("home inset: 400 hashed ids' start sites (plus drift) stay inside the spread ellipse and keep their margin disc on screen, every 0.5 s from 0 to 60 s, and use all 4 sites", () => {
    // Meaning change (#193): a device's home is no longer a hashed point in the ellipse but its
    // start site (the lattice site it takes when free, and where it sits when it holds none), so
    // this now checks the sites the hash reaches, plus that the whole-id hash spreads over all 4.
    const { cx, cy, ax, ay } = BLOB_MESH_SPREAD;
    let worstEllipse = 0;
    let worstRim = 0;
    let at = "";
    const perSite = [0, 0, 0, 0];
    for (let i = 0; i < 400; i++) {
      const id = `10.${(i * 37) % 256}.${(i * 11) % 256}.${i % 250}`;
      perSite[blobMeshStartSite(id)]!++;
      for (const t of FINE) {
        const [x, y] = blobMeshPlacement(id, t);
        const e = Math.hypot((x * 1.7 - cx) / ax, (y * 1.7 - cy) / ay);
        if (e > worstEllipse) { worstEllipse = e; at = `${id} t=${t}`; }
        const d = discOnScreen(x, y, BLOB_MESH_SPREAD_MARGIN);
        worstRim = Math.max(worstRim, d.worst);
      }
    }
    const text = `worst ellipse radius ${worstEllipse.toFixed(4)} (1 = rim) at ${at}, worst margin-rim |screen| ${worstRim.toFixed(4)}, ids per start site ${perSite.join("/")}`;
    process.stdout.write(`[inset] ${text}\n`);
    expect(worstEllipse, `inside the spread ellipse: ${text}`).toBeLessThanOrEqual(1 + 1e-12);
    expect(worstRim, `margin disc on screen: ${text}`).toBeLessThanOrEqual(1);
    for (const n of perSite) expect(n, `every start site used, none starved: ${text}`).toBeGreaterThanOrEqual(50);
  });

  /** The busiest 4 drawn devices (rate desc, ties by input order), the ones that hold sites. */
  const busiest4 = (frame: VizDataFrame): string[] =>
    frame.talkers.map((d, i) => ({ d, i })).sort((a, b) => (b.d.rate - a.d.rate) || a.i - b.i).slice(0, 4).map((x) => x.d.id);

  for (const [who, slotsOf] of writers) {
    for (const [name, frame] of [["LAN7", LAN7], ["LAN11", LAN11]] as const) {
      // Meaning change (#193): the old row asked every pair of the 7 to stay >= 0.03 uv apart
      // (hashed homes). Now the busiest 4 hold distinct sites, pairwise >= the lattice spacing, and
      // the other 3 sit exactly on a site (their start site), joining that lump rather than
      // landing between two sites.
      it(`${who}: ${name} keeps its busiest 4 drawn blob centres >= the ${SITE_SPACING.toFixed(4)} uv site spacing apart and the other 3 on a held site, every 0.5 s from 0 to 60 s`, () => {
        let min = Infinity;
        let at = "";
        const top = busiest4(frame);
        for (const t of FINE) {
          const place = placements({ ...frame, t }, slotsOf);
          expect(place.size).toBe(7);
          const held = top.map((id) => place.get(id)!.map((c) => c * BLOB_MESH_SLOT_TO_UV));
          for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
            const d = Math.hypot(held[i]![0]! - held[j]![0]!, held[i]![1]! - held[j]![1]!);
            if (d < min) { min = d; at = `t=${t} ${top[i]}/${top[j]}`; }
          }
          for (const [id, [x, y]] of place) {
            if (top.includes(id)) continue;
            const near = Math.min(...held.map(([hx, hy]) => Math.hypot(x * BLOB_MESH_SLOT_TO_UV - hx!, y * BLOB_MESH_SLOT_TO_UV - hy!)));
            expect(near, `t=${t}: ${id} sits on a held site`).toBeLessThan(1e-9);
          }
        }
        const text = `${name}: busiest 4 ${top.join(" ")}, min pair ${min.toFixed(4)} uv at ${at}`;
        if (who === "host mirror") process.stdout.write(`[spacing] ${text}\n`);
        expect(min, text).toBeGreaterThanOrEqual(SITE_SPACING - 1e-9);
      });
    }
  }

  it("start sites come from the whole id: 24 IPs that share a first character reach all 4 sites, and a lone device sits on its start site", () => {
    // Meaning change (#193): only 4 places exist now, so "24 distinct angles" is gone; what stays
    // is that the hash reads the whole id (a first-character hash would put all 24 on one site).
    const ids = Array.from({ length: 24 }, (_, i) => `192.168.${i % 4}.${10 + i}`);
    const starts = new Set<number>();
    ids.forEach((id, i) => {
      const [x, y] = placements(frameOf([talker(id, 300)], 0), (f) => hostSlot0(f, `first-char-${i}`)).get(id)!;
      const s = blobMeshStartSite(id);
      starts.add(s);
      const [sx, sy] = BLOB_MESH_SITES[s]!;
      expect(Math.hypot(x * BLOB_MESH_SLOT_TO_UV - (sx + BLOB_MESH_DRIFT), y * BLOB_MESH_SLOT_TO_UV - sy), `${id} on start site ${s}`).toBeLessThan(1e-9);
    });
    expect(starts.size, "all 4 start sites").toBe(4);
  });

  /**
   * #193 site-map stability. A: raise a quiet device into the busiest 4 at a fixed t, so the 4th
   * drops out: the 3 incumbents keep their places and the newcomer takes the freed site; drop it
   * again and the returning device takes that site back while the 3 still don't move. B: add a
   * quiet device and remove a drawn non-holder: the busiest 4 don't move. Holds whatever history
   * the writer's map already has. Revert: reassigning sites by rank every frame -> red.
   */
  const RAISED = "142.250.66.14"; // LAN7's 5th busiest (40 pps), raised over the top
  for (const [who, slotsOf] of writers) {
    it(`${who}: site map A: when the busiest set changes, the incumbents keep their sites and the newcomer takes the freed one`, () => {
      const tile = (f: VizDataFrame) => (who === "host mirror" ? hostSlot0(f, "stability-a") : slotsOf(f));
      const top = busiest4(LAN7);
      const leaver = top[3]!;
      const before = placements(LAN7, tile);
      const raisedFrame = { ...LAN7, talkers: LAN7.talkers.map((d) => (d.id === RAISED ? { ...d, rate: 300 } : d)) };
      expect(busiest4(raisedFrame), "raised device enters, the 4th leaves").toEqual([RAISED, ...top.slice(0, 3)]);
      const raised = placements(raisedFrame, tile);
      for (const id of top.slice(0, 3)) expect(raised.get(id), `raised: incumbent ${id} keeps its place`).toEqual(before.get(id));
      expect(raised.get(RAISED), `raised: ${RAISED} takes ${leaver}'s freed site`).toEqual(before.get(leaver));
      const back = placements(LAN7, tile);
      for (const id of top.slice(0, 3)) expect(back.get(id), `back: incumbent ${id} keeps its place`).toEqual(before.get(id));
      expect(back.get(leaver), `back: ${leaver} takes the freed site again`).toEqual(before.get(leaver));
      if (who === "host mirror") process.stdout.write(`[site-map] A: incumbents ${top.slice(0, 3).join(" ")} unmoved; ${RAISED} took ${leaver}'s site, then gave it back\n`);
    });

    it(`${who}: site map B: adding a quiet device or removing a drawn non-holder doesn't move the busiest 4`, () => {
      const tile = (f: VizDataFrame) => (who === "host mirror" ? hostSlot0(f, "stability-b") : slotsOf(f));
      const top = busiest4(LAN7);
      const before = placements(LAN7, tile);
      const variants: [string, VizDataFrame][] = [
        ["added quiet 172.30.0.40", { ...LAN7, talkers: [...LAN7.talkers, talker("172.30.0.40", 1)] }],
        ["removed 172.30.0.23", { ...LAN7, talkers: LAN7.talkers.filter((d) => d.id !== "172.30.0.23") }],
        ["both", { ...LAN7, talkers: [talker("172.30.0.41", 2), ...LAN7.talkers.filter((d) => d.id !== "104.18.32.7")] }],
        ["back to LAN7", LAN7],
      ];
      for (const [what, frame] of variants) {
        expect(busiest4(frame), `${what}: same busiest 4`).toEqual(top);
        const got = placements(frame, tile);
        for (const id of top) expect(got.get(id), `${what}: ${id}`).toEqual(before.get(id));
      }
    });
  }

  it("site map C: the same history gives the same map and slots (SDK and host mirror, fresh maps)", () => {
    const raisedFrame = { ...LAN7, talkers: LAN7.talkers.map((d) => (d.id === RAISED ? { ...d, rate: 300 } : d)) };
    const history = [LAN7, raisedFrame, LAN11, LAN7, raisedFrame].map((f, i) => ({ ...f, t: i * 5 }));
    const run = () => {
      const sites: BlobMeshSiteMap = new Map();
      const slots = history.map((f) => packBlobMeshSlots(f.talkers, f.t, sites).slot0);
      return { sites: [...sites], slots };
    };
    const a = run();
    expect(run(), "SDK twice").toEqual(a);
    const hostRun = (tile: string) => history.map((f) => hostSlot0(f, tile));
    expect(hostRun("history-1"), "host tile 1 matches the SDK").toEqual(a.slots);
    expect(hostRun("history-2"), "host tile 2 matches tile 1").toEqual(hostRun("history-3"));
  });
});
