import { resolve, type ScopeStore } from "./settings-scope";

/** Packs whose own reducedMotion field inherits the global choice unless set lower. */
export const REDUCED_MOTION_PACKS = [
  "aquarium",
  "koi-pond",
  "marble-run",
  "metro-lines",
  "rocket-car-soccer",
  "fractal-zoom",
] as const;

export type ReducedMotionChoice = "match" | "on" | "off";

export function reducedMotionEnabled(choice: ReducedMotionChoice, prefersReduced: boolean): boolean {
  if (choice === "on") return true;
  if (choice === "off") return false;
  return prefersReduced;
}

/** Global choice, unless this pack already set reducedMotion on its own bag. */
export function packReducedMotion(
  store: ScopeStore,
  packId: string,
  choice: ReducedMotionChoice,
  prefersReduced: boolean,
): boolean {
  const on = reducedMotionEnabled(choice, prefersReduced);
  const withGlobal: ScopeStore = {
    ...store,
    global: { ...store.global, reducedMotion: on },
    builtin: { ...store.builtin, reducedMotion: on },
  };
  return resolve(withGlobal, "reducedMotion", {
    packId,
    viewId: `plugin:${packId}`,
    wallId: "default",
    tileId: `plugin:${packId}`,
  }) === true;
}
