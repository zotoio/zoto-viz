import type { FabricKind, GraphSpace } from "./fabric";
import type { GraphLayout, GraphLinks } from "./graph-layouts";

/**
 * Named graph styles plugins and the Look panel can apply, extend, and combine.
 * Each recipe is a stack of the host's fabric, space, layout, and links.
 * `extends` copies another recipe first. `with` layers more recipes; later ids win.
 */

export type StylePins = {
  fabric?: FabricKind;
  graphSpace?: GraphSpace;
  graphLayout?: GraphLayout;
  graphLinks?: GraphLinks;
};

export type StyleRecipe = StylePins & {
  id: string;
  name: string;
  hint: string;
  /** The layout moves every frame. */
  animated: boolean;
  /** Volumetric placement, or a flat plane. */
  space: "3d" | "2d";
  extends?: string;
  with?: readonly string[];
};

export const STYLE_LIBRARY: readonly StyleRecipe[] = [
  {
    id: "orbit-helix",
    name: "Orbit helix",
    hint: "3D ring knots on a double helix that turns. Arrows show traffic direction.",
    animated: true,
    space: "3d",
    fabric: "orbit",
    graphSpace: "space",
    graphLayout: "helix",
    graphLinks: "arrows",
  },
  {
    id: "cloth-tide",
    name: "Cloth tide",
    hint: "3D cloth mesh riding a sea surface. Two swells cross under the nodes.",
    animated: true,
    space: "3d",
    fabric: "cloth",
    graphSpace: "space",
    graphLayout: "tide",
    graphLinks: "auto",
  },
  {
    id: "jelly-bloom",
    name: "Jelly bloom",
    hint: "3D jellyfish bells. Role petals breathe open on the pulse.",
    animated: true,
    space: "3d",
    fabric: "jelly",
    graphSpace: "space",
    graphLayout: "bloom",
    graphLinks: "auto",
  },
  {
    id: "jelly-bundle",
    name: "Jelly bundle",
    hint: "Jelly bloom with edges pulled into bundles toward the hub.",
    animated: true,
    space: "3d",
    extends: "jelly-bloom",
    graphLinks: "bundle",
  },
  {
    id: "tornado-vortex",
    name: "Tornado",
    hint: "3D funnel. Busy nodes climb a spinning column.",
    animated: true,
    space: "3d",
    fabric: "tornado",
    graphSpace: "space",
    graphLayout: "vortex",
    graphLinks: "arrows",
  },
  {
    id: "hole-knot",
    name: "Black hole",
    hint: "3D accretion disc. Every node slides a torus knot.",
    animated: true,
    space: "3d",
    fabric: "hole",
    graphSpace: "space",
    graphLayout: "knot",
    graphLinks: "both",
  },
  {
    id: "octopus-coral",
    name: "Octopus coral",
    hint: "3D mantle and tentacles on a living branch that twists from the hub.",
    animated: true,
    space: "3d",
    fabric: "octopus",
    graphSpace: "space",
    graphLayout: "coral",
    graphLinks: "arrows",
  },
  {
    id: "burst-cascade",
    name: "Burst fall",
    hint: "3D blast shards. Traffic falls down role lanes and wraps.",
    animated: true,
    space: "3d",
    fabric: "burst",
    graphSpace: "space",
    graphLayout: "cascade",
    graphLinks: "arrows",
  },
  {
    id: "neon-halo",
    name: "Neon halo",
    hint: "3D glowing tubes. Nested role rings each spin at their own rate.",
    animated: true,
    space: "3d",
    fabric: "neon",
    graphSpace: "space",
    graphLayout: "halo",
    graphLinks: "both",
  },
  {
    id: "wire-mobius",
    name: "Wire twist",
    hint: "3D wireframe on a Möbius walk that flips as it turns.",
    animated: true,
    space: "3d",
    fabric: "wire",
    graphSpace: "space",
    graphLayout: "mobius",
    graphLinks: "auto",
  },
  {
    id: "lattice-spectrum",
    name: "Lattice FFT",
    hint: "3D lattice. Height is spectrum power, X is the frequency bin.",
    animated: true,
    space: "3d",
    fabric: "lattice",
    graphSpace: "space",
    graphLayout: "spectrum",
    graphLinks: "auto",
  },
  {
    id: "beads-spine",
    name: "Bead spine",
    hint: "3D beads on a vertebral column. Hops are discs, siblings are ribs.",
    animated: true,
    space: "3d",
    fabric: "beads",
    graphSpace: "space",
    graphLayout: "spine",
    graphLinks: "arrows",
  },
  {
    id: "crystal-globe",
    name: "Crystal globe",
    hint: "3D octahedra on nested spherical shells by role.",
    animated: false,
    space: "3d",
    fabric: "crystals",
    graphSpace: "space",
    graphLayout: "globe",
    graphLinks: "bundle",
  },
  {
    id: "voxel-bars",
    name: "Voxel bars",
    hint: "3D cubes as a bar chart. Height is live byte-rate.",
    animated: false,
    space: "3d",
    fabric: "voxels",
    graphSpace: "space",
    graphLayout: "bars",
    graphLinks: "auto",
  },
  {
    id: "ribbon-ripple",
    name: "Ribbon ripple",
    hint: "2D ribbons. Hop rings expand and contract like water.",
    animated: true,
    space: "2d",
    fabric: "ribbon",
    graphSpace: "plane",
    graphLayout: "ripple",
    graphLinks: "auto",
  },
  {
    id: "ink-drift",
    name: "Ink river",
    hint: "2D brush strokes. Role streams flow along Z.",
    animated: true,
    space: "2d",
    fabric: "ink",
    graphSpace: "plane",
    graphLayout: "drift",
    graphLinks: "arrows",
  },
  {
    id: "constellation-julia",
    name: "Star julia",
    hint: "2D stars whose height is Julia escape time. Outliers pop.",
    animated: true,
    space: "3d",
    fabric: "constellation",
    graphSpace: "space",
    graphLayout: "julia",
    graphLinks: "auto",
  },
];

const BY_ID = new Map(STYLE_LIBRARY.map((row) => [row.id, row]));

export type ResolvedStyle = StylePins & {
  ids: string[];
  unknown: string[];
  animated: boolean;
  space: "3d" | "2d" | "mixed";
};

function applyPins(into: StylePins, from: StylePins | undefined): void {
  if (!from) return;
  if (from.fabric !== undefined) into.fabric = from.fabric;
  if (from.graphSpace !== undefined) into.graphSpace = from.graphSpace;
  if (from.graphLayout !== undefined) into.graphLayout = from.graphLayout;
  if (from.graphLinks !== undefined) into.graphLinks = from.graphLinks;
}

/** Walk extends, then with, then the recipe's own pins. Later layers win. */
function foldRecipe(id: string, into: StylePins, seen: Set<string>, unknown: string[]): void {
  if (seen.has(id)) return;
  const row = BY_ID.get(id);
  if (!row) {
    unknown.push(id);
    return;
  }
  seen.add(id);
  if (row.extends) foldRecipe(row.extends, into, seen, unknown);
  for (const extra of row.with ?? []) foldRecipe(extra, into, seen, unknown);
  applyPins(into, row);
}

export function styleRecipe(id: string): StyleRecipe | undefined {
  return BY_ID.get(id);
}

/**
 * Combine library ids left to right, then apply `patch` (a plugin's own fabric / layout / links).
 * Unknown ids are listed and skipped. An extends cycle is ignored after the first visit.
 */
export function resolveStyleLibrary(
  ids: readonly string[] | string | undefined,
  patch?: StylePins,
): ResolvedStyle {
  const list = (Array.isArray(ids) ? ids : ids ? [ids] : []).map((id) => id.trim()).filter(Boolean);
  const pins: StylePins = {};
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const id of list) foldRecipe(id, pins, seen, unknown);
  applyPins(pins, patch);
  const known = list.filter((id) => BY_ID.has(id));
  const animatedFlags = known.map((id) => BY_ID.get(id)!.animated);
  const spaces = new Set(known.map((id) => BY_ID.get(id)!.space));
  return {
    ...pins,
    ids: known,
    unknown,
    animated: animatedFlags.some(Boolean),
    space: spaces.size > 1 ? "mixed" : (spaces.values().next().value ?? "3d"),
  };
}

/** The single library id whose resolved pins match, if the operator has not mixed further. */
export function matchStyleLibrary(pins: StylePins): string | undefined {
  for (const row of STYLE_LIBRARY) {
    const resolved = resolveStyleLibrary(row.id);
    if (
      resolved.fabric === pins.fabric
      && resolved.graphSpace === pins.graphSpace
      && resolved.graphLayout === pins.graphLayout
      && resolved.graphLinks === pins.graphLinks
    ) return row.id;
  }
  return undefined;
}

export const STYLE_LIBRARY_OPTIONS: { value: string; label: string; hint: string }[] =
  STYLE_LIBRARY.map((row) => ({
    value: row.id,
    label: row.name,
    hint: `${row.animated ? "animated" : "still"} ${row.space}. ${row.hint}`,
  }));
