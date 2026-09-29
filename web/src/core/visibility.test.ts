import { describe, expect, it } from "vitest";
import { contrastRatio, grayHex, sceneInk, SKY_LUMA_CAP } from "./themes";
import {
  ADDITIVE_MAX_LUMA, assessVisibility, GRAPH_TARGET_LUMA, GRAPH_WASH_LUMA,
} from "./visibility";

const midnight = {
  darkTheme: true,
  additive: true,
  nodeHexes: [0x5aa9ff, 0x66bb6a],
  edgeHex: 0x5aa9ff,
};

function inkAt(luma: number) {
  const ink = sceneInk(grayHex(luma));
  return { labelFgHex: ink.fgHex, labelMutedHex: parseInt(ink.muted.slice(1), 16) };
}

describe("assessVisibility", () => {
  it("passes a dark midnight scene with additive marks", () => {
    const luma = 0.04;
    const r = assessVisibility({ backdropLuma: luma, ...midnight, ...inkAt(luma) });
    expect(r.ok).toBe(true);
    expect(r.graph.ok).toBe(true);
    expect(r.labels.ok).toBe(true);
    expect(r.fix.additive).toBe(true);
    expect(r.fix.lumaScale).toBe(1);
    expect(r.fix.lumaCap).toBe(SKY_LUMA_CAP);
  });

  it("keeps light labels on a fractal-bright sky under the washout line", () => {
    const luma = 0.4;
    expect(sceneInk(grayHex(luma)).darkText).toBe(false);
    const r = assessVisibility({ backdropLuma: luma, ...midnight, ...inkAt(luma) });
    expect(luma).toBeLessThan(GRAPH_WASH_LUMA);
    expect(r.graph.ok).toBe(true);
    expect(r.fix.additive).toBe(true);
    expect(r.fix.lumaCap).toBe(SKY_LUMA_CAP);
  });

  it("fails a blown-white Watch view even when dark labels meet WCAG", () => {
    const luma = 0.95;
    const ink = inkAt(luma);
    expect(sceneInk(grayHex(luma)).darkText).toBe(true);
    expect(contrastRatio(ink.labelFgHex, grayHex(luma))).toBeGreaterThan(4.5);
    const r = assessVisibility({ backdropLuma: luma, ...midnight, ...ink });
    expect(r.labels.ok).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.graph.ok).toBe(false);
    expect(r.graph.additiveVanish).toBe(true);
    expect(luma).toBeGreaterThan(ADDITIVE_MAX_LUMA);
    expect(r.graph.washout).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["additive-vanish", "graph-washout"]));
    expect(r.fix.additive).toBe(false);
    expect(r.fix.lumaCap).toBe(GRAPH_TARGET_LUMA);
    expect(r.fix.lumaScale).toBeLessThan(0.5);
  });

  it("passes after the washout fix is applied", () => {
    const bad = assessVisibility({ backdropLuma: 0.95, ...midnight, ...inkAt(0.95) });
    const luma = bad.fix.lumaCap;
    const r = assessVisibility({
      backdropLuma: luma,
      ...midnight,
      additive: bad.fix.additive,
      ...inkAt(luma),
    });
    expect(sceneInk(grayHex(luma)).fg).toBe("#ffffff");
    expect(r.graph.ok).toBe(true);
    expect(r.graph.additiveVanish).toBe(false);
    expect(r.graph.washout).toBe(false);
  });

  it("lets a light theme stay bright when blending is already normal", () => {
    const luma = 0.88;
    const r = assessVisibility({
      backdropLuma: luma,
      darkTheme: false,
      additive: false,
      nodeHexes: [0x1a237e, 0x0d47a1],
      edgeHex: 0x1565c0,
      ...inkAt(luma),
    });
    expect(r.graph.washout).toBe(false);
    expect(r.graph.additiveVanish).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("does not raise the sky cap above SKY_LUMA_CAP", () => {
    const r = assessVisibility({ backdropLuma: 0.1, ...midnight, ...inkAt(0.1) });
    expect(r.fix.lumaCap).toBeLessThanOrEqual(SKY_LUMA_CAP);
  });
});
