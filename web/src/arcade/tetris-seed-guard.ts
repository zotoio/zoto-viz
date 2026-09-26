/** Seeds 0–19 are used for weight tuning sweeps; 20+ are held out of sweeps only. */
export const TETRIS_TUNING_SEED_COUNT = 20;
export const TETRIS_HELD_OUT_SEED_COUNT = 60;

export function assertSweepSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed >= TETRIS_TUNING_SEED_COUNT) {
    throw new Error(`sweep seed must be an integer in [0, ${TETRIS_TUNING_SEED_COUNT - 1}], got ${seed}`);
  }
}

export function tuningSeeds(): number[] {
  return Array.from({ length: TETRIS_TUNING_SEED_COUNT }, (_, i) => i);
}

export function allBatterySeeds(): number[] {
  return Array.from({ length: TETRIS_HELD_OUT_SEED_COUNT }, (_, i) => i);
}
