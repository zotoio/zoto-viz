import { describe, expect, it } from "vitest";
import {
  EDGE_PRESETS, EdgeDamper, RAW_PRESET, edgeKindFor, emaStep, layoutDampingFor, parseEdgeDamping, resolvePreset, slew,
  type EdgeKind,
} from "./edge-damping";

const seen = (...e: [string, EdgeKind, number][]) => new Map(e.map(([id, k, r]) => [id, [k, r] as const]));

describe("edge damping presets", () => {
  it("every type has a calm, internally consistent preset", () => {
    for (const [k, p] of Object.entries(EDGE_PRESETS)) {
      expect(p.offRate, k).toBeLessThanOrEqual(p.onRate);
      expect(p.releaseS, k).toBeGreaterThanOrEqual(p.attackS);
      expect(p.lingerS, k).toBeGreaterThan(0);
      expect(p.alphaScale, k).toBeLessThanOrEqual(1);
    }
  });
  it("bursty radio sources are damped harder than packet flows", () => {
    for (const k of ["bt", "wifi"] as const) {
      expect(EDGE_PRESETS[k].lingerS).toBeGreaterThan(EDGE_PRESETS.flow.lingerS);
      expect(EDGE_PRESETS[k].springSlew).toBeLessThan(EDGE_PRESETS.flow.springSlew);
      expect(EDGE_PRESETS[k].dragFloor).toBeGreaterThan(EDGE_PRESETS.flow.dragFloor);
    }
    expect(EDGE_PRESETS.discovery.lingerS).toBeGreaterThan(EDGE_PRESETS.flow.lingerS);
  });
  it("disabled config resolves to the raw legacy preset", () => {
    expect(resolvePreset("wifi", { enabled: false, calm: 1 })).toEqual(RAW_PRESET);
  });
  it("calm scales time windows and overrides apply", () => {
    const p = resolvePreset("flow", { enabled: true, calm: 2, presets: { flow: { lingerS: 1 } } });
    expect(p.lingerS).toBe(2);
    expect(p.releaseS).toBe(EDGE_PRESETS.flow.releaseS * 2);
    expect(p.springSlew).toBeCloseTo(EDGE_PRESETS.flow.springSlew / 2);
  });
  it("parses stored config defensively", () => {
    expect(parseEdgeDamping(null)).toEqual({ enabled: true, calm: 1 });
    expect(parseEdgeDamping("{bad")).toEqual({ enabled: true, calm: 1 });
    expect(parseEdgeDamping('{"enabled":false}').enabled).toBe(false);
    expect(parseEdgeDamping({ calm: 99 }).calm).toBe(3);
    expect(parseEdgeDamping({ presets: { bt: { lingerS: 5, bogus: 1, fadeInS: -1 } } }).presets).toEqual({ bt: { lingerS: 5 } });
  });
});

describe("edge kinds", () => {
  it("classifies by graph base, tether, discovery and flow", () => {
    expect(edgeKindFor("bluetooth", "a|b", ["self", "lan"])).toBe("bt");
    expect(edgeKindFor("wifi", "a|b", ["lan", "lan"])).toBe("wifi");
    expect(edgeKindFor("cpu", "a|b", ["local", "local"])).toBe("cpu");
    expect(edgeKindFor("sources", "a|b", ["other", "other"])).toBe("graph");
    expect(edgeKindFor(undefined, "~x", ["lan", "gateway"])).toBe("tether");
    expect(edgeKindFor(undefined, "a|b", ["lan", "multicast"])).toBe("discovery");
    expect(edgeKindFor(undefined, "a|b", ["lan", "lan"], ["mDNS"])).toBe("discovery");
    expect(edgeKindFor(undefined, "a|b", ["lan", "internet"], ["tcp"])).toBe("flow");
  });
});

describe("smoothing primitives", () => {
  it("ema rises faster than it falls", () => {
    const up = emaStep(0, 100, 1, 0.5, 5);
    const down = emaStep(100, 0, 1, 0.5, 5);
    expect(up).toBeGreaterThan(100 - down);
  });
  it("slew caps the change per second", () => {
    expect(slew(0, 1, 0.5, 0.4)).toBeCloseTo(0.2);
    expect(slew(0, 1, 0.5, 0)).toBe(1);
    expect(slew(0.9, 1, 1, 0.4)).toBe(1);
  });
});

describe("EdgeDamper", () => {
  it("keeps a flapping BT edge alive across scan gaps and fades it in", () => {
    const d = new EdgeDamper();
    let t = 0;
    const presences: number[] = [];
    for (let i = 0; i < 20; i++, t += 1.15) {
      const on = i % 3 !== 2; // missing every third snapshot
      const out = d.step(t, on ? seen(["e", "bt", 40]) : seen());
      expect(out.get("e")?.keep).toBe(true);
      presences.push(out.get("e")!.presence);
    }
    expect(presences[0]).toBe(0);
    // presence never jumps more than the slew allows per snapshot
    for (let i = 1; i < presences.length; i++) {
      expect(Math.abs(presences[i]! - presences[i - 1]!)).toBeLessThanOrEqual(1.15 / EDGE_PRESETS.bt.fadeInS + 1e-6);
    }
  });
  it("removes an edge only after min life and linger, fading its spring to zero", () => {
    const d = new EdgeDamper();
    d.step(0, seen(["e", "flow", 1000]));
    d.step(1, seen(["e", "flow", 1000]));
    let last = 1;
    for (let t = 2; t < 1 + EDGE_PRESETS.flow.lingerS; t += 1) {
      const s = d.step(t, seen()).get("e");
      expect(s).toBeDefined();
      expect(s!.presence).toBeLessThanOrEqual(last + 1e-9);
      last = s!.presence;
    }
    const gone = d.step(1 + EDGE_PRESETS.flow.lingerS + 0.01, seen());
    expect(gone.has("e")).toBe(false);
    expect(d.size).toBe(0);
  });
  it("hysteresis stops a rate hovering near the threshold from toggling activity", () => {
    const d = new EdgeDamper();
    const p = EDGE_PRESETS.flow;
    let t = 0;
    for (let i = 0; i < 10; i++, t += 1) d.step(t, seen(["e", "flow", p.onRate * 4]));
    expect(d.state("e")!.active).toBe(true);
    let flips = 0;
    let was = true;
    for (let i = 0; i < 30; i++, t += 1) {
      const r = i % 2 ? p.onRate * 1.5 : p.offRate * 1.5; // noisy, always above offRate after smoothing
      const a = d.step(t, seen(["e", "flow", r])).get("e")!.active;
      if (a !== was) flips++;
      was = a;
    }
    expect(flips).toBe(0);
  });
  it("smooths a bursty rate so per-snapshot change is far smaller than raw", () => {
    const d = new EdgeDamper();
    const raw = [0, 5000, 0, 0, 8000, 10, 0, 6000, 0, 0, 7000, 0];
    const sm: number[] = [];
    raw.forEach((r, i) => sm.push(d.step(i * 1.15, seen(["e", "flow", r])).get("e")!.rate));
    const jumps = (a: number[]) => a.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - a[i]!)), 0);
    expect(jumps(sm)).toBeLessThan(jumps(raw) * 0.75);
  });
  it("disabled config behaves like the legacy raw path", () => {
    const d = new EdgeDamper({ enabled: false, calm: 1 });
    expect(d.step(0, seen(["e", "bt", 40])).get("e")).toMatchObject({ rate: 40, presence: 1 });
    expect(d.step(1, seen()).has("e")).toBe(false);
  });
  it("layout damping follows the dominant non-tether type", () => {
    const d = new EdgeDamper();
    expect(layoutDampingFor(["tether", "tether", "wifi"], d).dragFloor).toBe(EDGE_PRESETS.wifi.dragFloor);
    expect(layoutDampingFor([], d).alphaScale).toBe(EDGE_PRESETS.flow.alphaScale);
  });
});
