import type { DeviceKind } from "../core/types";

/**
 * Instance-shape ids. The index is what the sphere-cloud vertex shader reads.
 * 0–6 match the original set (drone-show still uses 6). Later ids are extra forms.
 */
export const NODE_SHAPE_IDS = [
  "sphere", "cube", "star", "octahedron", "diamond", "disc", "drone",
  "ring", "capsule", "crystal", "teardrop",
] as const;

export type NodeShapeId = (typeof NODE_SHAPE_IDS)[number];

/** Look pin. `auto` keeps the view's own shapes; `mixed` hashes a form per node. */
export const NODE_SHAPE_PINS = ["auto", "mixed", ...NODE_SHAPE_IDS] as const;
export type NodeShapePin = (typeof NODE_SHAPE_PINS)[number];

const INDEX: Record<NodeShapeId, number> = {
  sphere: 0,
  cube: 1,
  star: 2,
  octahedron: 3,
  diamond: 4,
  disc: 5,
  drone: 6,
  ring: 7,
  capsule: 8,
  crystal: 9,
  teardrop: 10,
};

/** Varied forms for a mixed cloud. Sphere and drone stay opt-in. */
const MIXED = [1, 2, 3, 4, 5, 7, 8, 9, 10];

/** Device type → a distinct solid, used when the view does not pin its own shapes. */
const KIND_SHAPE: Record<DeviceKind, number> = {
  self: INDEX.diamond,
  gateway: INDEX.octahedron,
  computer: INDEX.capsule,
  phone: INDEX.disc,
  tablet: INDEX.cube,
  tv: INDEX.cube,
  speaker: INDEX.ring,
  light: INDEX.star,
  camera: INDEX.crystal,
  printer: INDEX.cube,
  wifi: INDEX.ring,
  iot: INDEX.teardrop,
  local: INDEX.capsule,
  lan: INDEX.star,
  internet: INDEX.disc,
  multicast: INDEX.ring,
};

export const NODE_SHAPE_OPTIONS: { value: NodeShapePin; label: string; hint: string }[] = [
  { value: "auto", label: "auto", hint: "the view's own shapes, or a form per device type" },
  { value: "mixed", label: "mixed", hint: "each node keeps its own form" },
  { value: "sphere", label: "sphere", hint: "plain ball" },
  { value: "cube", label: "cube", hint: "box" },
  { value: "star", label: "star", hint: "six-point star" },
  { value: "octahedron", label: "octa", hint: "eight-sided solid" },
  { value: "diamond", label: "diamond", hint: "two cones" },
  { value: "disc", label: "disc", hint: "flat disc" },
  { value: "ring", label: "ring", hint: "torus" },
  { value: "capsule", label: "capsule", hint: "rounded rod" },
  { value: "crystal", label: "crystal", hint: "tall gem" },
  { value: "teardrop", label: "drop", hint: "pinched drop" },
  { value: "drone", label: "drone", hint: "hull with rotors" },
];

export function nodeShapePin(raw: string | null | undefined): NodeShapePin {
  return (NODE_SHAPE_PINS as readonly string[]).includes(raw ?? "") ? raw as NodeShapePin : "auto";
}

function hashUnit(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % MIXED.length;
}

/**
 * Shape index for one node. An explicit pin wins. `auto` keeps a view-supplied index,
 * otherwise the device type.
 */
export function nodeShapeIndex(
  pin: NodeShapePin,
  modeShape: number | undefined,
  kind: DeviceKind,
  id: string,
): number {
  if (pin === "mixed") return MIXED[hashUnit(id)] ?? INDEX.star;
  if (pin !== "auto") return INDEX[pin] ?? INDEX.sphere;
  if (modeShape !== undefined && Number.isFinite(modeShape)) return modeShape;
  return KIND_SHAPE[kind] ?? INDEX.sphere;
}
