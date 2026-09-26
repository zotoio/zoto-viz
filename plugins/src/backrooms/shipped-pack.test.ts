import { describe, expect, it } from "vitest";
import FRAG from "./sky/fragment.glsl?raw";
import FRONT from "./frontend/index.ts?raw";
import VIS from "./visualisation.yml?raw";
import {
  BR_GRID,
  BR_MAZE_FLOATS,
  BR_PILLAR,
  BR_SLOT,
  BR_SLOT0_FLOATS,
  BR_WIN,
  backroomsEvents,
  backroomsFrame,
  backroomsSlots,
  BR_CREATURES,
  BR_DEFAULTS,
  brEdgeBlocked,
  parseBackroomsOptions,
  setBackroomsOptions,
  brEpisodeAt,
  brMazeWindow,
} from "./frontend/director";

function sdBox(px: number, pz: number, bx: number, bz: number): number {
  const dx = Math.abs(px) - bx;
  const dz = Math.abs(pz) - bz;
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
}
const mod = (a: number, n: number): number => a - n * Math.floor(a / n);

/** Distance to the nearest pillar or walled edge — the same solids `walls()` draws in the sky. */
function wallDist(x: number, z: number): number {
  let d = sdBox(mod(x, BR_GRID) - 2, mod(z, BR_GRID) - 2, BR_PILLAR, BR_PILLAR);
  const ni = Math.floor(x / BR_GRID + 0.5);
  const nk = Math.floor(z / BR_GRID + 0.5);
  const ox = x - ni * BR_GRID;
  const oz = z - nk * BR_GRID;
  if (brEdgeBlocked(ni, nk, 0)) d = Math.min(d, sdBox(ox - 2, oz, BR_PILLAR, 2));
  if (brEdgeBlocked(ni - 1, nk, 0)) d = Math.min(d, sdBox(ox + 2, oz, BR_PILLAR, 2));
  if (brEdgeBlocked(ni, nk, 1)) d = Math.min(d, sdBox(ox, oz - 2, 2, BR_PILLAR));
  if (brEdgeBlocked(ni, nk - 1, 1)) d = Math.min(d, sdBox(ox, oz + 2, 2, BR_PILLAR));
  return d;
}

interface Audit {
  camClear: number;
  crClear: number;
  maxSpeed: number;
  closest: number[];
  caught: number;
  kinds: Set<string>;
}

function audit(seconds: number): Audit {
  const out: Audit = { camClear: 9, crClear: 9, maxSpeed: 0, closest: [], caught: 0, kinds: new Set() };
  let ep = -1;
  let seen: { tau: number; d: number }[] = [];
  let catchTau = Infinity;
  let caught = false;
  const flush = (): void => {
    // The creature only closes in for the catch itself: ignore the last seconds before one.
    const near = Math.min(99, ...seen.filter((x) => x.tau < catchTau - 4).map((x) => x.d));
    if (near < 50) out.closest.push(near);
  };
  let prev: [number, number] | null = null;
  for (let t = 0.02; t < seconds; t += 1 / 30) {
    const f = backroomsFrame(t);
    const s = f.slot0;
    if (f.episode !== ep) {
      if (ep >= 0 && caught) out.caught++;
      if (ep >= 0) flush();
      ep = f.episode;
      seen = [];
      catchTau = Infinity;
      caught = false;
      prev = null;
      out.kinds.add(f.kind);
    }
    if (s[BR_SLOT.bodyVis]! > 0.5 && !caught) {
      caught = true;
      catchTau = f.tau;
    }
    const lastChase = f.tau > f.dur - 40;
    const cx = s[BR_SLOT.camX]!;
    const cz = s[BR_SLOT.camZ]!;
    out.camClear = Math.min(out.camClear, wallDist(cx, cz));
    if (s[BR_SLOT.crVis]! > 0.5) out.kinds.add(f.kind);
    if (s[BR_SLOT.crVis]! > 0.5 && !caught) {
      out.crClear = Math.min(out.crClear, wallDist(s[BR_SLOT.crX]!, s[BR_SLOT.crZ]!));
      if (!lastChase && s[BR_SLOT.cut]! < 0.5) seen.push({ tau: f.tau, d: Math.hypot(s[BR_SLOT.crX]! - cx, s[BR_SLOT.crZ]! - cz) });
    }
    if (prev && !caught && s[BR_SLOT.cut]! < 0.5 && f.tau > 0.6 && f.tau < f.dur - 0.6) out.maxSpeed = Math.max(out.maxSpeed, Math.hypot(cx - prev[0], cz - prev[1]) * 30);
    prev = [cx, cz];
  }
  return out;
}

describe("backrooms shipped pack", () => {
  it("ships the director-driven sky shader symbols", () => {
    expect(FRAG).toContain("zotoVizSlots");
    for (const fn of ["bool walled(", "float wire(", "float howler(", "float hound(", "float smiler(", "float graffiti(", "float objAt(", "vec4 osd(", "float bodyShadow("]) {
      expect(FRAG).toContain(fn);
    }
  });

  it("drives buffers from onPresent when presentTick is enabled", () => {
    expect(FRONT).toMatch(/onPresent/);
    expect(FRONT).toMatch(/writeBuffer\s*\(/);
  });

  it("fits the plugin buffer contract", () => {
    const s = backroomsSlots(12.3, new Date(2026, 8, 26, 19, 24, 15), 1.6);
    expect(s.slot0).toHaveLength(BR_SLOT0_FLOATS);
    expect(s.slot1).toHaveLength(BR_MAZE_FLOATS);
    expect(s.slot0.length).toBeLessThanOrEqual(64);
    expect(s.slot0[BR_SLOT.mark]).toBe(1);
    for (const v of [...s.slot0, ...s.slot1]) expect(Number.isFinite(v)).toBe(true);
    expect([s.slot0[BR_SLOT.year], s.slot0[BR_SLOT.month], s.slot0[BR_SLOT.day]]).toEqual([2026, 9, 26]);
    expect(s.slot0[BR_SLOT.secOfDay]).toBe(19 * 3600 + 24 * 60 + 15);
    expect(s.slot0[BR_SLOT.aspect]).toBe(1.6);
    expect(s.slot0[BR_SLOT.battery]).toBeGreaterThan(0);
  });

  it("packs walled edges the way the sky unpacks them", () => {
    const oi = -7;
    const ok = 31;
    const bits = brMazeWindow(oi, ok);
    for (let lz = 0; lz < BR_WIN; lz += 5) {
      for (let lx = 0; lx < BR_WIN; lx += 3) {
        for (let a = 0; a < 2; a++) {
          const b = (lz * BR_WIN + lx) * 2 + a;
          const f = Math.floor(b / 24);
          expect(bits[f]).toBeLessThan(2 ** 24);
          expect(((bits[f]! >>> (b - f * 24)) & 1) === 1).toBe(brEdgeBlocked(oi + lx, ok + lz, a));
        }
      }
    }
  });

  it("lays out episodes of the configured length back to back", () => {
    expect(brEpisodeAt(250).dur).toBe(120);
    expect(brEpisodeAt(250).t0).toBe(240);
    setBackroomsOptions(parseBackroomsOptions({ episode: "60" }));
    expect(brEpisodeAt(250).dur).toBe(60);
    expect(brEpisodeAt(250).t0).toBe(240);
    setBackroomsOptions(BR_DEFAULTS);
  });

  it("reads every view setting it ships", () => {
    const keys = [...VIS.matchAll(/- key: (\w+)/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      const a = JSON.stringify(parseBackroomsOptions({}));
      const flip = /true|false/.test(VIS.split(`key: ${key}`)[1]!.split("- key:")[0]!.match(/default: (\S+)/)?.[1] ?? "")
        ? "false"
        : "37";
      expect(JSON.stringify(parseBackroomsOptions({ [key]: flip })), key).not.toBe(a);
    }
  });

  it("ends every episode with the catch unless that is switched off", () => {
    for (let e = 0; e < 4; e++) {
      let caught = false;
      for (let t = e * 120 + 0.1; t < (e + 1) * 120; t += 0.5) if (backroomsFrame(t).slot0[BR_SLOT.bodyVis]! > 0.5) caught = true;
      expect(caught, `episode ${e}`).toBe(true);
    }
    setBackroomsOptions(parseBackroomsOptions({ endCatch: "false", cornerKill: "0" }));
    let any = false;
    for (let t = 0.1; t < 360; t += 0.5) if (backroomsFrame(t).slot0[BR_SLOT.bodyVis]! > 0.5) any = true;
    expect(any).toBe(false);
    setBackroomsOptions(BR_DEFAULTS);
  });

  it("sometimes takes you at a corner without a chase, and the blood follows the drag", () => {
    setBackroomsOptions(parseBackroomsOptions({ cornerKill: "100" }));
    let early = false;
    let trail = 0;
    for (let t = 0.1; t < 360; t += 0.25) {
      const f = backroomsFrame(t);
      if (f.slot0[BR_SLOT.bodyVis]! > 0.5 && f.tau < f.dur - 40) early = true;
      trail = Math.max(trail, f.slot0[BR_SLOT.trailN]!);
    }
    expect(early).toBe(true);
    expect(trail).toBeGreaterThanOrEqual(2);
    setBackroomsOptions(BR_DEFAULTS);
  });

  it("only sends the creatures that are switched on", () => {
    setBackroomsOptions(parseBackroomsOptions({ creature_lifeform: "false", creature_hunched: "false", creature_howler: "false", creature_smiler: "false" }));
    for (let t = 0.5; t < 720; t += 3) {
      const f = backroomsFrame(t);
      if (f.slot0[BR_SLOT.crVis]! > 0.5) expect(f.creature).toBe("hound");
    }
    setBackroomsOptions(BR_DEFAULTS);
  });

  it("walks open halls only, at human speeds, and only lets it catch up on a caught episode", () => {
    const a = audit(1800);
    expect(a.camClear).toBeGreaterThan(0.9);
    expect(a.crClear).toBeGreaterThan(0.3);
    expect(a.maxSpeed).toBeLessThan(5);
    expect(a.kinds.size).toBeGreaterThanOrEqual(3);
    expect(Math.min(...a.closest)).toBeGreaterThan(1.5);
    // Charges close in to a few metres before the runner breaks.
    expect(a.closest.filter((d) => d < 4).length).toBeGreaterThanOrEqual(2);
    // Sometimes it gets you: camera on the floor, the body dragged off.
    expect(a.caught).toBeGreaterThan(0);
  });

  it("cues footsteps, a gasp and creature sounds from the same track", () => {
    const ids = new Set<string>();
    for (let t = 0; t < 480; t += 0.25) for (const ev of backroomsEvents(t, t + 0.25)) ids.add(ev.id);
    for (const id of ["step", "run", "gasp", "scream", "roar", "shriek", "cstep", "drop"]) expect(ids.has(id)).toBe(true);
    // No camcorder clunks between episodes: the footage runs on until the catch.
    expect(ids.has("tapeIn") || ids.has("tapeOut")).toBe(false);
  });

  it("varies the creature per episode", () => {
    const seen = new Set<string>();
    for (let t = 0; t < 4800; t += 7) seen.add(backroomsFrame(t).creature);
    for (const c of BR_CREATURES) expect(seen.has(c)).toBe(true);
  });

  it("fades creature sounds with distance", () => {
    const vocal: number[] = [];
    for (let t = 0; t < 1440; t += 0.25) for (const ev of backroomsEvents(t, t + 0.25)) if (ev.id === "hoo" || ev.id === "cstep") vocal.push(ev.gain);
    expect(vocal.length).toBeGreaterThan(3);
    expect(Math.min(...vocal)).toBeLessThan(0.5);
    expect(Math.max(...vocal)).toBeLessThanOrEqual(1);
  });

  it("freezes, then runs, then breathes hard", () => {
    let frozen = 0;
    let pant = 0;
    let heavy = 0;
    for (let t = 0; t < 480; t += 0.5) {
      const s = backroomsFrame(t).sfx;
      if (s.frozen > 0.5) frozen++;
      if (s.pant > 0.4) pant++;
      if (s.heavy > 0.3) heavy++;
      expect(s.buzz).toBeGreaterThan(0.2);
    }
    expect(frozen).toBeGreaterThan(5);
    expect(pant).toBeGreaterThan(5);
    expect(heavy).toBeGreaterThan(2);
  });
});
