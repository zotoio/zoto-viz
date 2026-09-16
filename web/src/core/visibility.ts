/**
 * Contrast and element-visibility assessor for the live graph.
 *
 * Label WCAG can pass on a blown-out field while additive edges, sparks, and
 * a dark-theme node cloud vanish. This tool scores both layers and returns a
 * fix the renderer can apply without persisting the user's sliders.
 *
 * Node colours are mid-luma (cyan ~0.38). WCAG contrast against a mid-grey sky
 * is the wrong test for whether a sphere is visible — hue still reads. Blocking
 * failures are washed-white fields and additive marks on those fields.
 */

import {
  contrastRatio, grayHex, LABEL_MIN_CONTRAST, MUTED_MIN_CONTRAST, SKY_LUMA_CAP,
} from "./themes";

/** Additive marks (edges, glow, sparks) disappear into a field brighter than this. */
export const ADDITIVE_MAX_LUMA = 0.55;
/** Dark-theme backdrop above this is a washout even when labels still meet AA. */
export const GRAPH_WASH_LUMA = 0.5;
/** Dim a washout to this so the live/floor underlay stays, and nodes/edges read. */
export const GRAPH_TARGET_LUMA = 0.28;
/** Alias of the washout trigger (older name). */
export const GRAPH_MAX_LUMA = GRAPH_WASH_LUMA;
/** Informational floor for node/edge WCAG; not a blocking gate. */
export const GRAPH_MIN_CONTRAST = 2.5;

export type VisibilityCode =
  | "label-contrast"
  | "muted-contrast"
  | "additive-vanish"
  | "graph-washout";

export interface VisibilityInput {
  /** Backdrop luminance as the eye / framebuffer sees it, or the uncapped source. */
  backdropLuma: number;
  additive: boolean;
  /** Midnight-style themes must stay a dark viz; paper is allowed to be bright. */
  darkTheme: boolean;
  labelFgHex: number;
  labelMutedHex: number;
  nodeHexes?: number[];
  edgeHex?: number;
}

export interface VisibilityIssue {
  code: VisibilityCode;
  detail: string;
}

export interface VisibilityReport {
  ok: boolean;
  backdropLuma: number;
  labels: { fgContrast: number; mutedContrast: number; ok: boolean };
  graph: {
    additiveVanish: boolean;
    washout: boolean;
    nodeContrast: number;
    edgeContrast: number;
    ok: boolean;
  };
  issues: VisibilityIssue[];
  /** Overlay only: do not write these onto saved Look sliders. */
  fix: {
    additive: boolean;
    lumaScale: number;
    lumaCap: number;
  };
}

const DEFAULT_NODES = [0x5aa9ff, 0x66bb6a];

/**
 * Score label contrast and whether 3D marks would actually show on this backdrop.
 * `fix` is what to overlay so the next frame can pass.
 */
export function assessVisibility(input: VisibilityInput): VisibilityReport {
  const luma = Math.min(1, Math.max(0, input.backdropLuma));
  const bg = grayHex(luma);
  const fgC = contrastRatio(input.labelFgHex, bg);
  const mutedC = contrastRatio(input.labelMutedHex, bg);
  const labelOk = fgC >= LABEL_MIN_CONTRAST && mutedC >= MUTED_MIN_CONTRAST - 0.05;
  const additiveVanish = input.additive && luma > ADDITIVE_MAX_LUMA;
  const washout = input.darkTheme && luma > GRAPH_WASH_LUMA;
  const nodes = input.nodeHexes?.length ? input.nodeHexes : DEFAULT_NODES;
  let nodeContrast = Infinity;
  for (const h of nodes) nodeContrast = Math.min(nodeContrast, contrastRatio(h, bg));
  if (!Number.isFinite(nodeContrast)) nodeContrast = 1;
  const edgeHex = input.edgeHex ?? nodes[0]!;
  const edgeContrast = additiveVanish ? 1 : contrastRatio(edgeHex, bg);
  const graphOk = !additiveVanish && !washout;

  const issues: VisibilityIssue[] = [];
  if (fgC < LABEL_MIN_CONTRAST) {
    issues.push({ code: "label-contrast", detail: `label contrast ${fgC.toFixed(2)} < ${LABEL_MIN_CONTRAST}` });
  }
  if (mutedC < MUTED_MIN_CONTRAST - 0.05) {
    issues.push({ code: "muted-contrast", detail: `muted contrast ${mutedC.toFixed(2)} < ${MUTED_MIN_CONTRAST}` });
  }
  if (additiveVanish) {
    issues.push({ code: "additive-vanish", detail: "additive edges and sparks vanish on a bright field" });
  }
  if (washout) {
    issues.push({ code: "graph-washout", detail: "dark-theme graph washed out by backdrop" });
  }

  const additive = input.additive && !additiveVanish;
  const lumaCap = washout ? Math.min(SKY_LUMA_CAP, GRAPH_TARGET_LUMA) : SKY_LUMA_CAP;
  const lumaScale = luma <= 0.001 ? 1 : Math.min(1, lumaCap / luma);

  return {
    ok: issues.length === 0,
    backdropLuma: luma,
    labels: { fgContrast: fgC, mutedContrast: mutedC, ok: labelOk },
    graph: { additiveVanish, washout, nodeContrast, edgeContrast, ok: graphOk },
    issues,
    fix: { additive, lumaScale, lumaCap },
  };
}
