/**
 * Tank types: freshwater and reef never mix. Each lists its species (sim order = template order)
 * and decor (scape node prefixes / names), plus the water look the host uses. `validateTank`
 * rejects any cross-mixing; the tests run it over the sim's spawns, aggression pairs and the GLB.
 */
import { canEat, fishTemplate, type SwimFish } from "./fish-behaviour";

export type TankType = "freshwater" | "reef";

/** Biological habitat of every species and decor piece in the pack. */
export const FRESHWATER_SPECIES = ["neon", "angel", "guppy", "cory", "discus", "cichlid", "betta"] as const;
export const SALTWATER_SPECIES = ["clown", "tang", "damsel", "goby", "yellowtang", "gramma"] as const;
export const FRESHWATER_DECOR = ["substrate", "fresh-rocks", "fresh-driftwood", "fresh-plant-fern", "fresh-plant-vallisneria", "fresh-plant-rotala", "fresh-plant-moss"] as const;
export const SALTWATER_DECOR = ["substrate", "reef-rocks", "reef-coral-staghorn", "reef-coral-brain", "reef-coral-fan", "reef-anemone"] as const;

export interface TankSpec {
  type: TankType;
  water: "fresh" | "reef";
  species: readonly string[];
  /** Decor name prefixes allowed in this tank (the shared sand substrate is in both; plants and driftwood only fresh, coral and anemone only reef). */
  decor: readonly string[];
  /** Water tint (linear rgb 0..1): tannin green for freshwater, clear blue for reef. */
  tint: readonly [number, number, number];
}

export const TANKS: Record<TankType, TankSpec> = {
  freshwater: { type: "freshwater", water: "fresh", species: FRESHWATER_SPECIES, decor: FRESHWATER_DECOR, tint: [0.62, 0.66, 0.42] },
  reef: { type: "reef", water: "reef", species: SALTWATER_SPECIES, decor: SALTWATER_DECOR, tint: [0.45, 0.72, 1.0] },
};

export function tankTypeOf(water: "fresh" | "reef"): TankType {
  return water === "reef" ? "reef" : "freshwater";
}

function decorOk(spec: TankSpec, name: string): boolean {
  return spec.decor.some((d) => name === d || name.startsWith(d));
}

/** Errors for anything in a tank that belongs to the other water (empty = valid). */
export function validateTank(type: TankType, species: readonly string[], decor: readonly string[] = [],
  pairs: readonly [string, string][] = []): string[] {
  const spec = TANKS[type];
  const other = TANKS[type === "reef" ? "freshwater" : "reef"];
  const err: string[] = [];
  for (const s of species) {
    if (!spec.species.includes(s)) err.push(`${type}: species ${s} is ${other.species.includes(s) ? other.type : "unknown"}`);
  }
  for (const d of decor) {
    if (!decorOk(spec, d)) err.push(`${type}: decor ${d} does not belong in a ${type} tank`);
  }
  for (const [a, b] of pairs) {
    if (!spec.species.includes(a) || !spec.species.includes(b)) err.push(`${type}: aggression pair ${a} -> ${b} crosses tanks`);
  }
  return err;
}

/** Every predator -> prey pair the sim allows in a tank (by template name). */
export function aggressionPairs(type: TankType): [string, string][] {
  const reef = type === "reef";
  const n = TANKS[type].species.length;
  const out: [string, string][] = [];
  const f = (species: number): SwimFish => ({ id: "x", species, vigor: 0.5, x: 0, y: 0, z: 0, yaw: 0, speed: 0, vy: 0,
    turnRate: 0, phase: 0, mood: "cruise", moodT: 0, wander: 0, plant: 0, rs: 1 });
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (a !== b && canEat(f(a), f(b), reef)) out.push([fishTemplate(a, reef), fishTemplate(b, reef)]);
  }
  return out;
}
